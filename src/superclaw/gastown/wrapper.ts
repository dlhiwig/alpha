/**
 * GasTown Binary Wrapper
 * 
 * Node.js wrapper around the native GasTown `gt` binary.
 * Provides TypeScript interface to GasTown's orchestration capabilities.
 * 
 * INTEGRATION STRATEGY:
 * - Use native `gt` binary for all operations
 * - Parse JSON outputs where available
 * - Handle text parsing for CLI-only outputs
 * - Bridge cost/usage data to SENTINEL
 */

import { spawn, ChildProcess } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';

// ===============================
// Types
// ===============================

export interface ConvoyStatus {
  id: string;
  name: string;
  status: 'active' | 'completed' | 'paused' | 'failed';
  beads: string[];
  polecats: string[];
  progress: number; // 0-100
  totalCost: number;
  created: Date;
  updated: Date;
}

export interface PolecatInfo {
  id: string;
  name: string;
  rig: string;
  status: 'idle' | 'working' | 'offline';
  provider: string;
  hookPath: string;
  assignedBead?: string;
  startTime?: Date;
}

export interface GastownMetrics {
  convoyId: string;
  polecats: {
    id: string;
    provider: string;
    tokensUsed: number;
    cost: number;
    duration: number;
  }[];
  totalCost: number;
  totalTokens: number;
  efficiency: number; // work completed per dollar
}

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
}

// ===============================
// GasTown Binary Wrapper
// ===============================

export class GastownWrapper {
  private binaryPath: string;
  private workspacePath: string;

  constructor(binaryPath: string = '~/superclaw/gastown/gt', workspace: string = './.gastown') {
    this.binaryPath = binaryPath.replace('~', process.env.HOME || '');
    this.workspacePath = workspace;
  }

  // ===============================
  // Workspace Management
  // ===============================

  async initializeWorkspace(gitInit: boolean = true): Promise<void> {
    const args = ['install', this.workspacePath];
    if (gitInit) args.push('--git');
    
    await this.execute(args);
  }

  async addRig(name: string, gitRepo: string): Promise<void> {
    const args = ['rig', 'add', name, gitRepo];
    await this.execute(args);
  }

  async addCrew(crewName: string, rigName: string): Promise<void> {
    const args = ['crew', 'add', crewName, '--rig', rigName];
    await this.execute(args);
  }

  // ===============================
  // Convoy Operations
  // ===============================

  async createConvoy(name: string, issues: string[] = [], options: {
    notify?: boolean;
    human?: boolean;
  } = {}): Promise<string> {
    const args = ['convoy', 'create', name];
    args.push(...issues);
    
    if (options.notify) args.push('--notify');
    if (options.human) args.push('--human');

    const result = await this.execute(args);
    
    // Parse convoy ID from output
    // Expected format: "Created convoy hq-abc12 'Build Authentication'"
    const match = result.stdout.match(/Created convoy ([a-z-0-9]+)/);
    if (!match) {
      throw new Error(`Failed to parse convoy ID from output: ${result.stdout}`);
    }
    
    return match[1];
  }

  async getConvoyStatus(convoyId?: string): Promise<ConvoyStatus[]> {
    const args = ['convoy', 'list'];
    if (convoyId) args.push(convoyId);

    const result = await this.execute(args);
    
    // Parse convoy list output
    return this.parseConvoyList(result.stdout);
  }

  async getConvoyDetails(convoyId: string): Promise<ConvoyStatus> {
    const args = ['convoy', 'status', convoyId];
    const result = await this.execute(args);
    
    return this.parseConvoyDetails(result.stdout, convoyId);
  }

  async addToConvoy(convoyId: string, issueIds: string[]): Promise<void> {
    const args = ['convoy', 'add', convoyId, ...issueIds];
    await this.execute(args);
  }

  async closeConvoy(convoyId: string, force: boolean = false): Promise<void> {
    const args = ['convoy', 'close', convoyId];
    if (force) args.push('--force');
    
    await this.execute(args);
  }

  // ===============================
  // Agent Operations (Sling/Polecats)
  // ===============================

  async slingBead(beadId: string, rig: string, options: {
    agent?: string;
    force?: boolean;
  } = {}): Promise<string> {
    const args = ['sling', beadId, rig];
    
    if (options.agent) args.push('--agent', options.agent);
    if (options.force) args.push('--force');

    const result = await this.execute(args);
    
    // Parse polecat ID from sling output
    // Expected format: "Slung gt-abc12 to myproject (polecat-xyz)"
    const match = result.stdout.match(/\(polecat-([a-z0-9]+)\)/);
    return match ? `polecat-${match[1]}` : `polecat-${Date.now()}`;
  }

  async listPolecats(): Promise<PolecatInfo[]> {
    const args = ['agents'];
    const result = await this.execute(args);
    
    return this.parsePolecatList(result.stdout);
  }

  // ===============================
  // Cost & Metrics
  // ===============================

  async getCostMetrics(convoyId?: string): Promise<GastownMetrics> {
    // GasTown doesn't have direct cost API, so we need to 
    // estimate from convoy status and polecat activity
    const convoys = await this.getConvoyStatus(convoyId);
    const polecats = await this.listPolecats();
    
    if (convoyId) {
      const convoy = convoys.find(c => c.id === convoyId);
      if (!convoy) throw new Error(`Convoy ${convoyId} not found`);
      
      return this.estimateConvoyCosts(convoy, polecats);
    } else {
      // Return aggregated metrics for all active convoys
      return this.estimateGlobalCosts(convoys, polecats);
    }
  }

  // ===============================
  // Monitoring & Health
  // ===============================

  async getWorkspaceHealth(): Promise<{
    workspaceInit: boolean;
    rigCount: number;
    activeConvoys: number;
    activePolecats: number;
    gitHealth: boolean;
  }> {
    try {
      const convoys = await this.getConvoyStatus();
      const polecats = await this.listPolecats();
      
      // Check if workspace is initialized
      const wsResult = await this.execute(['status'], { allowFailure: true });
      const workspaceInit = wsResult.exitCode === 0;
      
      return {
        workspaceInit,
        rigCount: await this.countRigs(),
        activeConvoys: convoys.filter(c => c.status === 'active').length,
        activePolecats: polecats.filter(p => p.status === 'working').length,
        gitHealth: await this.checkGitHealth(),
      };
    } catch (error: unknown) {
      return {
        workspaceInit: false,
        rigCount: 0,
        activeConvoys: 0,
        activePolecats: 0,
        gitHealth: false,
      };
    }
  }

  // ===============================
  // Private Helpers
  // ===============================

  private async execute(args: string[], options: {
    allowFailure?: boolean;
    timeout?: number;
  } = {}): Promise<ExecutionResult> {
    const startTime = Date.now();
    
    return new Promise((resolve, reject) => {
      const proc = spawn(this.binaryPath, args, {
        cwd: this.workspacePath,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      const timeoutHandle = options.timeout ? setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error(`Command timeout after ${options.timeout}ms`));
      }, options.timeout) : null;

      proc.on('close', (code) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        
        const duration = Date.now() - startTime;
        const result: ExecutionResult = {
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code || 0,
          duration,
        };

        if (code !== 0 && !options.allowFailure) {
          reject(new Error(`Command failed with code ${code}: ${stderr}`));
        } else {
          resolve(result);
        }
      });

      proc.on('error', (error) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        reject(error);
      });
    });
  }

  private parseConvoyList(output: string): ConvoyStatus[] {
    const lines = output.split('\n').filter(line => line.trim());
    const convoys: ConvoyStatus[] = [];
    
    for (const line of lines) {
      // Parse convoy list format
      // Example: "hq-abc12  Build Auth     active    3/5 beads   $2.50"
      const match = line.match(/^([a-z-0-9]+)\s+([^\s]+.*?)\s+(active|completed|paused|failed)\s+(\d+)\/(\d+)\s+beads(?:\s+\$([\d.]+))?/);
      
      if (match) {
        convoys.push({
          id: match[1],
          name: match[2].trim(),
          status: match[3] as ConvoyStatus['status'],
          beads: [], // Will be filled by separate call if needed
          polecats: [],
          progress: (parseInt(match[4]) / parseInt(match[5])) * 100,
          totalCost: parseFloat(match[6] || '0'),
          created: new Date(), // Placeholder
          updated: new Date(),
        });
      }
    }
    
    return convoys;
  }

  private parseConvoyDetails(output: string, convoyId: string): ConvoyStatus {
    // Parse detailed convoy status output
    const lines = output.split('\n');
    const convoy: ConvoyStatus = {
      id: convoyId,
      name: '',
      status: 'active',
      beads: [],
      polecats: [],
      progress: 0,
      totalCost: 0,
      created: new Date(),
      updated: new Date(),
    };

    // Parse convoy details from gt convoy status output
    for (const line of lines) {
      if (line.includes('Name:')) {
        convoy.name = line.split('Name:')[1].trim();
      } else if (line.includes('Status:')) {
        convoy.status = line.split('Status:')[1].trim().toLowerCase() as ConvoyStatus['status'];
      } else if (line.includes('Beads:')) {
        // Extract bead IDs
        const beadMatch = line.match(/gt-[a-z0-9]+/g);
        if (beadMatch) convoy.beads.push(...beadMatch);
      }
    }

    return convoy;
  }

  private parsePolecatList(output: string): PolecatInfo[] {
    const lines = output.split('\n').filter(line => line.trim());
    const polecats: PolecatInfo[] = [];

    for (const line of lines) {
      // Parse polecat list format
      // Example: "polecat-abc12  myrig    working  claude  gt-xyz45  hook/myrig/polecat-abc12"
      const match = line.match(/^(polecat-[a-z0-9]+)\s+(\S+)\s+(idle|working|offline)\s+(\S+)(?:\s+(gt-[a-z0-9]+))?\s+(\S+)/);
      
      if (match) {
        polecats.push({
          id: match[1],
          name: match[1],
          rig: match[2],
          status: match[3] as PolecatInfo['status'],
          provider: match[4],
          assignedBead: match[5],
          hookPath: match[6],
          startTime: new Date(),
        });
      }
    }

    return polecats;
  }

  private estimateConvoyCosts(convoy: ConvoyStatus, polecats: PolecatInfo[]): GastownMetrics {
    // Estimate costs based on convoy progress and known provider rates
    const providerCosts = {
      claude: 0.003,   // $3 per 1K tokens (rough average)
      gemini: 0.075,   // $0.075 per 1K tokens
      codex: 0.002,    // $2 per 1K tokens
    };

    const convoyPolecats = polecats.filter(p => 
      convoy.beads.some(bead => p.assignedBead === bead)
    );

    const polecatMetrics = convoyPolecats.map(p => ({
      id: p.id,
      provider: p.provider,
      tokensUsed: this.estimateTokenUsage(p),
      cost: this.estimatePolecatCost(p, providerCosts),
      duration: this.estimatePolecatDuration(p),
    }));

    const totalCost = polecatMetrics.reduce((sum, p) => sum + p.cost, 0);
    const totalTokens = polecatMetrics.reduce((sum, p) => sum + p.tokensUsed, 0);

    return {
      convoyId: convoy.id,
      polecats: polecatMetrics,
      totalCost,
      totalTokens,
      efficiency: convoy.progress / Math.max(totalCost, 0.01), // progress per dollar
    };
  }

  private estimateGlobalCosts(convoys: ConvoyStatus[], polecats: PolecatInfo[]): GastownMetrics {
    // Aggregate costs across all active convoys
    const activeConvoys = convoys.filter(c => c.status === 'active');
    
    let totalCost = 0;
    let totalTokens = 0;
    let allPolecatMetrics: any[] = [];

    for (const convoy of activeConvoys) {
      const metrics = this.estimateConvoyCosts(convoy, polecats);
      totalCost += metrics.totalCost;
      totalTokens += metrics.totalTokens;
      allPolecatMetrics.push(...metrics.polecats);
    }

    return {
      convoyId: 'global',
      polecats: allPolecatMetrics,
      totalCost,
      totalTokens,
      efficiency: activeConvoys.length / Math.max(totalCost, 0.01),
    };
  }

  private estimateTokenUsage(polecat: PolecatInfo): number {
    // Rough estimation based on polecat activity
    // This would be more accurate with actual GasTown metrics
    const baseTokens = 1000; // Base tokens per task
    const durationMultiplier = polecat.startTime ? 
      (Date.now() - polecat.startTime.getTime()) / (1000 * 60) : 1; // minutes
    
    return Math.floor(baseTokens * Math.max(1, durationMultiplier / 10));
  }

  private estimatePolecatCost(polecat: PolecatInfo, rates: Record<string, number>): number {
    const rate = rates[polecat.provider] || 0.002; // Default to codex rate
    const tokens = this.estimateTokenUsage(polecat);
    return (tokens / 1000) * rate;
  }

  private estimatePolecatDuration(polecat: PolecatInfo): number {
    return polecat.startTime ? Date.now() - polecat.startTime.getTime() : 0;
  }

  private async countRigs(): Promise<number> {
    try {
      const result = await this.execute(['rig', 'list'], { allowFailure: true });
      return result.stdout.split('\n').filter(line => line.trim()).length;
    } catch {
      return 0;
    }
  }

  private async checkGitHealth(): Promise<boolean> {
    try {
      await this.execute(['status'], { allowFailure: true });
      return true;
    } catch {
      return false;
    }
  }
}

// ===============================
// Factory Functions
// ===============================

export function createGastownWrapper(
  workspace?: string,
  binaryPath?: string
): GastownWrapper {
  return new GastownWrapper(binaryPath, workspace);
}

export async function initializeGastownWorkspace(
  workspacePath: string,
  gitInit: boolean = true
): Promise<GastownWrapper> {
  const wrapper = createGastownWrapper(workspacePath);
  await wrapper.initializeWorkspace(gitInit);
  return wrapper;
}