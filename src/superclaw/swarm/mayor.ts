/**
 * SwarmMayor - Gas Town Mayor Pattern for SuperClaw
 * 
 * Implements the MEOW pattern (Mayor-Enhanced Orchestration Workflow):
 * 1. Tell the Mayor what you want
 * 2. Mayor analyzes and breaks down into tasks
 * 3. Convoy creation with beads
 * 4. Agent spawning and work distribution
 * 5. Progress monitoring through convoy status
 * 6. Completion summary
 * 
 * Integrates Gas Town's orchestration patterns with SuperClaw's swarm system.
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { swarm } from './orchestrator';
import { SwarmResult, ProviderName, AgentRole } from './types';

// ===============================
// Gas Town Types
// ===============================

export interface Bead {
  id: string;
  title: string;
  description: string;
  status: 'ready' | 'assigned' | 'in-progress' | 'completed' | 'blocked';
  assignee?: string;
  dependencies: string[];
  created: Date;
  updated: Date;
  metadata: Record<string, any>;
}

export interface PolecatIdentity {
  personality: string;
  expertise: string[];
  workingStyle: string;
  preferences?: Record<string, any>;
}

export interface Polecat {
  id: string;
  name: string;
  provider: ProviderName;
  status: 'idle' | 'working' | 'offline';
  hook: string;
  identity: PolecatIdentity;
  created: Date;
  lastActivity: Date;
}

export interface Convoy {
  id: string;
  name: string;
  description?: string;
  beads: string[];
  status: 'active' | 'completed' | 'paused' | 'failed';
  owner: string;
  created: Date;
  updated: Date;
  mergeStrategy: 'direct' | 'mr' | 'pr';
  owned: boolean;
}

export interface Rig {
  id: string;
  name: string;
  gitRepo: string;
  baseBranch: string;
  workspacePath: string;
  settings: RigSettings;
  polecats: string[];
  hooks: string[];
  created: Date;
  updated: Date;
}

export interface RigSettings {
  runtime: {
    provider: ProviderName;
    timeout: number;
    maxConcurrency: number;
  };
  git: {
    autoCommit: boolean;
    signCommits: boolean;
    pushOnComplete: boolean;
  };
  quality: {
    requireTests: boolean;
    requireLint: boolean;
    requireBuild: boolean;
  };
}

export interface TaskAnalysis {
  beads: Bead[];
  strategy: OrchestrationStrategy;
  estimatedTime: number;
  requiredSkills: string[];
  dependencies: TaskDependency[];
  risks: string[];
}

export interface TaskDependency {
  from: string;
  to: string;
  type: 'blocks' | 'depends' | 'enables';
}

export interface OrchestrationStrategy {
  approach: 'parallel' | 'sequential' | 'hybrid';
  phases: OrchestrationPhase[];
  maxPolecats: number;
  timeAllocation: Record<string, number>;
}

export interface OrchestrationPhase {
  name: string;
  beads: string[];
  requiredRoles: AgentRole[];
  parallelism: number;
  timeoutMs: number;
}

export interface ConvoyStatus {
  convoy: Convoy;
  progress: {
    total: number;
    completed: number;
    inProgress: number;
    blocked: number;
  };
  polecats: PolecatStatus[];
  estimatedCompletion?: Date;
}

export interface PolecatStatus {
  polecat: Polecat;
  currentBead?: string;
  progress: number;
  lastUpdate: Date;
}

export interface OrchestrationResult {
  convoy: Convoy;
  beads: Bead[];
  assignments: PolecatAssignment[];
  results: SwarmResult[];
  synthesis: string;
  totalDurationMs: number;
  strategy: OrchestrationStrategy;
}

export interface PolecatAssignment {
  polecatId: string;
  beadId: string;
  assigned: Date;
  completed?: Date;
  result?: SwarmResult;
}

export interface MayorState {
  rigs: Record<string, Rig>;
  polecats: Record<string, Polecat>;
  convoys: Record<string, Convoy>;
  beads: Record<string, Bead>;
  assignments: Record<string, PolecatAssignment>;
  created: Date;
  updated: Date;
}

// ===============================
// SwarmMayor Class
// ===============================

export class SwarmMayor {
  private workspacePath: string;
  private state: MayorState;
  private statePath: string;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
    this.statePath = join(workspacePath, '.mayor-state.json');
    this.state = {
      rigs: {},
      polecats: {},
      convoys: {},
      beads: {},
      assignments: {},
      created: new Date(),
      updated: new Date(),
    };
  }

  // ===============================
  // Core Mayor Operations
  // ===============================

  /**
   * MEOW Step 1-2: Analyze task and break down into beads
   */
  async analyzeTask(task: string, context?: string): Promise<TaskAnalysis> {
    console.log(`[mayor] Analyzing task: ${task}`);

    // Use SuperClaw's swarm to analyze the task
    const analysisResult = await swarm(
      `Analyze this task and break it down into discrete, actionable subtasks:

TASK: ${task}
${context ? `CONTEXT: ${context}` : ''}

Return your analysis in this JSON format:
{
  "subtasks": [
    {
      "title": "Brief title",
      "description": "Detailed description",
      "estimatedTimeMinutes": 30,
      "skills": ["frontend", "typescript"],
      "dependencies": ["subtask-id"],
      "priority": "high|medium|low"
    }
  ],
  "strategy": {
    "approach": "parallel|sequential|hybrid",
    "reasoning": "Why this approach"
  },
  "totalEstimateMinutes": 120,
  "risks": ["potential risk 1", "potential risk 2"]
}`,
      {
        mode: 'fanout-critique',
        providers: ['claude', 'gemini'],
        json: true,
      }
    );

    // Parse the analysis
    const analysis = this.parseAnalysisResult(analysisResult);
    
    // Create beads from subtasks
    // @ts-expect-error - Post-Merge Reconciliation
    const beads = analysis.subtasks.map((subtask, index) => {
      const beadId = `bd-${Date.now()}-${index}`;
      return {
        id: beadId,
        title: subtask.title,
        description: subtask.description,
        status: 'ready' as const,
        dependencies: subtask.dependencies,
        created: new Date(),
        updated: new Date(),
        metadata: {
          estimatedTimeMinutes: subtask.estimatedTimeMinutes,
          skills: subtask.skills,
          priority: subtask.priority,
          originalTask: task,
        },
      };
    });

    // Store beads
    // @ts-expect-error - Post-Merge Reconciliation
    beads.forEach(bead => {
      this.state.beads[bead.id] = bead;
    });

    const strategy: OrchestrationStrategy = {
      approach: analysis.strategy.approach,
      phases: this.createPhases(beads, analysis.strategy.approach),
      maxPolecats: this.calculateMaxPolecats(beads),
      timeAllocation: this.calculateTimeAllocation(beads),
    };

    return {
      beads,
      strategy,
      estimatedTime: analysis.totalEstimateMinutes || 0,
      requiredSkills: this.extractUniqueSkills(beads),
      dependencies: this.extractDependencies(beads),
      risks: analysis.risks || [],
    };
  }

  /**
   * MEOW Step 3: Create convoy with beads
   */
  async createConvoy(
    name: string,
    beadIds: string[],
    options: {
      mergeStrategy?: 'direct' | 'mr' | 'pr';
      owned?: boolean;
      description?: string;
    } = {}
  ): Promise<Convoy> {
    const convoyId = `cv-${Date.now()}`;
    const convoy: Convoy = {
      id: convoyId,
      name,
      description: options.description,
      beads: beadIds,
      status: 'active',
      owner: 'mayor',
      created: new Date(),
      updated: new Date(),
      mergeStrategy: options.mergeStrategy || 'direct',
      owned: options.owned !== false,
    };

    this.state.convoys[convoyId] = convoy;
    await this.saveState();

    console.log(`[mayor] Created convoy: ${name} (${beadIds.length} beads)`);
    return convoy;
  }

  /**
   * MEOW Step 4: Spawn agents and distribute work
   */
  async orchestrate(
    task: string,
    options: {
      context?: string;
      strategy?: 'parallel' | 'sequential' | 'hybrid';
      maxPolecats?: number;
      mergeStrategy?: 'direct' | 'mr' | 'pr';
      owned?: boolean;
    } = {}
  ): Promise<OrchestrationResult> {
    const startTime = Date.now();

    // Step 1-2: Analyze and break down
    const analysis = await this.analyzeTask(task, options.context);

    // Step 3: Create convoy
    const convoy = await this.createConvoy(
      `Task: ${task.substring(0, 50)}...`,
      analysis.beads.map(b => b.id),
      {
        mergeStrategy: options.mergeStrategy,
        owned: options.owned,
        description: `Orchestrated task: ${task}`,
      }
    );

    // Step 4: Assign and execute beads
    const assignments: PolecatAssignment[] = [];
    const results: SwarmResult[] = [];

    // Get available rigs for execution
    const availableRigs = Object.values(this.state.rigs);
    if (availableRigs.length === 0) {
      // Create a default rig if none exist
      await this.addRig('default-rig', 'memory://default');
    }

    // Execute beads based on strategy
    const maxPolecats = Math.min(
      options.maxPolecats || analysis.strategy.maxPolecats,
      analysis.beads.length
    );

    if (analysis.strategy.approach === 'parallel' || analysis.strategy.approach === 'hybrid') {
      // Parallel execution
      const parallelResults = await Promise.allSettled(
        analysis.beads.slice(0, maxPolecats).map(async (bead) => {
          const assignment: PolecatAssignment = {
            polecatId: `polecat-${bead.id}`,
            beadId: bead.id,
            assigned: new Date(),
          };

          const result = await swarm(
            `${bead.title}\n\n${bead.description}`,
            {
              mode: 'fanout',
              context: `Original task: ${task}\n${options.context || ''}`,
              providers: this.selectProvidersForBead(bead),
            }
          );

          assignment.completed = new Date();
          assignment.result = result;
          assignments.push(assignment);

          // Update bead status
          this.state.beads[bead.id].status = 'completed';
          this.state.beads[bead.id].updated = new Date();

          return result;
        })
      );

      results.push(...parallelResults
        .filter(r => r.status === 'fulfilled')
        .map(r => (r as PromiseFulfilledResult<SwarmResult>).value)
      );
    } else {
      // Sequential execution
      for (const bead of analysis.beads) {
        const assignment: PolecatAssignment = {
          polecatId: `polecat-${bead.id}`,
          beadId: bead.id,
          assigned: new Date(),
        };

        const result = await swarm(
          `${bead.title}\n\n${bead.description}`,
          {
            mode: 'fanout',
            context: `Original task: ${task}\n${options.context || ''}`,
            providers: this.selectProvidersForBead(bead),
          }
        );

        assignment.completed = new Date();
        assignment.result = result;
        assignments.push(assignment);

        this.state.beads[bead.id].status = 'completed';
        this.state.beads[bead.id].updated = new Date();
        results.push(result);
      }
    }

    // Step 5-6: Synthesize results
    const synthesis = await this.synthesizeResults(results, task);

    // Update convoy status
    convoy.status = 'completed';
    convoy.updated = new Date();
    this.state.convoys[convoy.id] = convoy;
    await this.saveState();

    const totalDurationMs = Date.now() - startTime;
    console.log(`[mayor] Orchestration completed in ${totalDurationMs}ms`);

    return {
      convoy,
      beads: analysis.beads,
      assignments,
      results,
      synthesis,
      totalDurationMs,
      strategy: analysis.strategy,
    };
  }

  /**
   * MEOW Step 5: Monitor convoy status
   */
  async getConvoyStatus(convoyId: string): Promise<ConvoyStatus | undefined> {
    const convoy = this.state.convoys[convoyId];
    if (!convoy) {
      return undefined;
    }

    const beads = convoy.beads.map(id => this.state.beads[id]).filter(Boolean);
    const progress = {
      total: beads.length,
      completed: beads.filter(b => b.status === 'completed').length,
      inProgress: beads.filter(b => b.status === 'in-progress').length,
      blocked: beads.filter(b => b.status === 'blocked').length,
    };

    const polecats = Object.values(this.state.polecats)
      .filter(p => convoy.beads.some(beadId => 
        Object.values(this.state.assignments).some(a => 
          a.beadId === beadId && a.polecatId === p.id
        )
      ))
      .map(polecat => ({
        polecat,
        currentBead: this.getCurrentBeadForPolecat(polecat.id),
        progress: this.getPolecatProgress(polecat.id),
        lastUpdate: polecat.lastActivity,
      }));

    return {
      convoy,
      progress,
      polecats,
      estimatedCompletion: this.estimateCompletion(convoy, progress),
    };
  }

  // ===============================
  // Rig Management
  // ===============================

  async addRig(name: string, gitRepo: string, options: Partial<RigSettings> = {}): Promise<Rig> {
    const rigId = `rig-${name}`;
    const workspacePath = join(this.workspacePath, 'rigs', name);

    // Ensure workspace directory exists
    await fs.mkdir(workspacePath, { recursive: true });

    const defaultSettings: RigSettings = {
      runtime: {
        provider: 'claude',
        timeout: 60000,
        maxConcurrency: 5,
      },
      git: {
        autoCommit: true,
        signCommits: false,
        pushOnComplete: false,
      },
      quality: {
        requireTests: false,
        requireLint: false,
        requireBuild: false,
      },
    };

    const rig: Rig = {
      id: rigId,
      name,
      gitRepo,
      baseBranch: 'main',
      workspacePath,
      settings: { ...defaultSettings, ...options },
      polecats: [],
      hooks: [],
      created: new Date(),
      updated: new Date(),
    };

    this.state.rigs[rigId] = rig;
    await this.saveState();

    console.log(`[mayor] Added rig: ${name} -> ${workspacePath}`);
    return rig;
  }

  async createPolecat(
    name: string,
    provider: ProviderName,
    rigId: string,
    identity: Partial<PolecatIdentity> = {}
  ): Promise<Polecat> {
    const rig = this.state.rigs[rigId];
    if (!rig) {
      throw new Error(`Rig ${rigId} not found`);
    }

    const polecatId = `polecat-${name}-${Date.now()}`;
    const hookId = `hook-${polecatId}`;

    const polecat: Polecat = {
      id: polecatId,
      name,
      provider,
      status: 'idle',
      hook: hookId,
      identity: {
        personality: identity.personality || 'efficient and focused',
        expertise: identity.expertise || [],
        workingStyle: identity.workingStyle || 'methodical approach',
        preferences: identity.preferences || {},
      },
      created: new Date(),
      lastActivity: new Date(),
    };

    this.state.polecats[polecatId] = polecat;
    this.state.rigs[rigId].polecats.push(polecatId);
    await this.saveState();

    console.log(`[mayor] Created polecat: ${name} (${provider}) in rig ${rigId}`);
    return polecat;
  }

  // ===============================
  // State Management
  // ===============================

  async saveState(): Promise<void> {
    this.state.updated = new Date();
    const stateJson = JSON.stringify(this.state, null, 2);
    await fs.writeFile(this.statePath, stateJson, 'utf8');
  }

  async loadState(): Promise<void> {
    try {
      const stateJson = await fs.readFile(this.statePath, 'utf8');
      this.state = JSON.parse(stateJson);
      
      // Convert date strings back to Date objects
      this.state.created = new Date(this.state.created);
      this.state.updated = new Date(this.state.updated);
      
      Object.values(this.state.rigs).forEach(rig => {
        rig.created = new Date(rig.created);
        rig.updated = new Date(rig.updated);
      });
      
      Object.values(this.state.polecats).forEach(polecat => {
        polecat.created = new Date(polecat.created);
        polecat.lastActivity = new Date(polecat.lastActivity);
      });
      
      Object.values(this.state.convoys).forEach(convoy => {
        convoy.created = new Date(convoy.created);
        convoy.updated = new Date(convoy.updated);
      });
      
      Object.values(this.state.beads).forEach(bead => {
        bead.created = new Date(bead.created);
        bead.updated = new Date(bead.updated);
      });

    } catch (error: unknown) {
      if ((error as any).code !== 'ENOENT') {
        console.warn('[mayor] Failed to load state:', error);
      }
      // Use default state if file doesn't exist or is corrupted
    }
  }

  async listConvoys(): Promise<Convoy[]> {
    return Object.values(this.state.convoys);
  }

  // ===============================
  // Private Helper Methods
  // ===============================

  private parseAnalysisResult(result: SwarmResult): any {
    try {
      // Try to extract JSON from the synthesis
      const jsonMatch = result.synthesis.solution.match(/```json\n([\s\S]*?)\n```/) ||
                       result.synthesis.solution.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1] || jsonMatch[0]);
      }
      
      // Fallback: create simple structure from solution text
      return {
        subtasks: [{
          title: "Primary Task",
          description: result.synthesis.solution,
          estimatedTimeMinutes: 30,
          skills: [],
          dependencies: [],
          priority: "medium"
        }],
        strategy: { approach: "parallel", reasoning: "Default strategy" },
        totalEstimateMinutes: 30,
        risks: result.synthesis.risks
      };
    } catch (error: unknown) {
      console.warn('[mayor] Failed to parse analysis result:', error);
      return {
        subtasks: [{
          title: "Task Analysis Failed",
          description: result.synthesis.solution,
          estimatedTimeMinutes: 60,
          skills: [],
          dependencies: [],
          priority: "high"
        }],
        strategy: { approach: "sequential", reasoning: "Fallback due to parsing error" },
        totalEstimateMinutes: 60,
        risks: ["Task analysis parsing failed"]
      };
    }
  }

  private createPhases(beads: Bead[], approach: string): OrchestrationPhase[] {
    if (approach === 'sequential') {
      return beads.map(bead => ({
        name: bead.title,
        beads: [bead.id],
        requiredRoles: this.inferRolesFromBead(bead),
        parallelism: 1,
        timeoutMs: (bead.metadata.estimatedTimeMinutes || 30) * 60 * 1000,
      }));
    } else {
      return [{
        name: 'Parallel Execution',
        beads: beads.map(b => b.id),
        requiredRoles: this.inferRolesFromBeads(beads),
        parallelism: Math.min(beads.length, 5),
        timeoutMs: Math.max(...beads.map(b => (b.metadata.estimatedTimeMinutes || 30) * 60 * 1000)),
      }];
    }
  }

  private calculateMaxPolecats(beads: Bead[]): number {
    return Math.min(Math.max(beads.length, 1), 5);
  }

  private calculateTimeAllocation(beads: Bead[]): Record<string, number> {
    const allocation: Record<string, number> = {};
    beads.forEach(bead => {
      allocation[bead.id] = bead.metadata.estimatedTimeMinutes || 30;
    });
    return allocation;
  }

  private extractUniqueSkills(beads: Bead[]): string[] {
    const skills = new Set<string>();
    beads.forEach(bead => {
      // @ts-expect-error - Post-Merge Reconciliation
      (bead.metadata.skills || []).forEach(skill => skills.add(skill));
    });
    return Array.from(skills);
  }

  private extractDependencies(beads: Bead[]): TaskDependency[] {
    const deps: TaskDependency[] = [];
    beads.forEach(bead => {
      bead.dependencies.forEach(depId => {
        deps.push({
          from: depId,
          to: bead.id,
          type: 'blocks',
        });
      });
    });
    return deps;
  }

  private selectProvidersForBead(bead: Bead): ProviderName[] {
    const skills = bead.metadata.skills || [];
    
    if (skills.includes('frontend') || skills.includes('ui')) {
      return ['claude', 'codex'];
    } else if (skills.includes('backend') || skills.includes('api')) {
      return ['codex', 'gemini'];
    } else if (skills.includes('research') || skills.includes('analysis')) {
      return ['gemini', 'claude'];
    } else {
      return ['claude', 'gemini'];
    }
  }

  private async synthesizeResults(results: SwarmResult[], originalTask: string): Promise<string> {
    if (results.length === 0) {
      return "No results to synthesize.";
    }

    const combinedSolutions = results.map(r => r.synthesis.solution).join('\n\n---\n\n');
    
    const synthesisResult = await swarm(
      `Synthesize these results into a coherent solution for the original task:

ORIGINAL TASK: ${originalTask}

RESULTS:
${combinedSolutions}

Provide a clear, unified solution that incorporates the best aspects of each result.`,
      {
        mode: 'fanout',
        providers: ['claude'],
      }
    );

    return synthesisResult.synthesis.solution;
  }

  private inferRolesFromBead(bead: Bead): AgentRole[] {
    const skills = bead.metadata.skills || [];
    const roles: AgentRole[] = [];
    
    // @ts-expect-error - Post-Merge Reconciliation
    if (skills.some(s => ['frontend', 'ui', 'react'].includes(s))) {
      roles.push('implementer');
    }
    // @ts-expect-error - Post-Merge Reconciliation
    if (skills.some(s => ['backend', 'api', 'database'].includes(s))) {
      roles.push('implementer', 'critic');
    }
    // @ts-expect-error - Post-Merge Reconciliation
    if (skills.some(s => ['research', 'analysis'].includes(s))) {
      roles.push('researcher');
    }
    
    return roles.length > 0 ? roles : ['general'];
  }

  private inferRolesFromBeads(beads: Bead[]): AgentRole[] {
    const allRoles = new Set<AgentRole>();
    beads.forEach(bead => {
      this.inferRolesFromBead(bead).forEach(role => allRoles.add(role));
    });
    return Array.from(allRoles);
  }

  private getCurrentBeadForPolecat(polecatId: string): string | undefined {
    const assignment = Object.values(this.state.assignments)
      .find(a => a.polecatId === polecatId && !a.completed);
    return assignment?.beadId;
  }

  private getPolecatProgress(polecatId: string): number {
    const assignments = Object.values(this.state.assignments)
      .filter(a => a.polecatId === polecatId);
    
    if (assignments.length === 0) return 0;
    
    const completed = assignments.filter(a => a.completed).length;
    return completed / assignments.length;
  }

  private estimateCompletion(convoy: Convoy, progress: ConvoyStatus['progress']): Date | undefined {
    if (progress.total === 0) return undefined;
    
    const completionRate = progress.completed / progress.total;
    if (completionRate === 0) return undefined;
    
    const elapsedMs = Date.now() - convoy.created.getTime();
    const estimatedTotalMs = elapsedMs / completionRate;
    const remainingMs = estimatedTotalMs - elapsedMs;
    
    return new Date(Date.now() + remainingMs);
  }
}

// ===============================
// Factory Functions and High-Level API
// ===============================

export function createMayor(workspacePath: string): SwarmMayor {
  return new SwarmMayor(workspacePath);
}

export async function initializeGasTownWorkspace(workspacePath: string): Promise<SwarmMayor> {
  await fs.mkdir(workspacePath, { recursive: true });
  const mayor = createMayor(workspacePath);
  await mayor.loadState();
  return mayor;
}

/**
 * High-level Gas Town swarm API
 */
export async function gastownSwarm(
  task: string,
  options: {
    workspace?: string;
    context?: string;
    strategy?: 'parallel' | 'sequential' | 'hybrid';
    maxPolecats?: number;
    mergeStrategy?: 'direct' | 'mr' | 'pr';
    owned?: boolean;
    providers?: ProviderName[];
  } = {}
): Promise<OrchestrationResult> {
  const workspacePath = options.workspace || join(process.cwd(), '.gastown');
  const mayor = await initializeGasTownWorkspace(workspacePath);
  
  return mayor.orchestrate(task, {
    context: options.context,
    strategy: options.strategy,
    maxPolecats: options.maxPolecats,
    mergeStrategy: options.mergeStrategy,
    owned: options.owned,
  });
}

// For the test file compatibility
// @ts-expect-error - Post-Merge Reconciliation
export type { Rig };
export const Mayor = SwarmMayor;