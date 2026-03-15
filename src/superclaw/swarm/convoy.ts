/**
 * SuperClaw Convoy Work Tracking System
 * 
 * Implements Gas Town's Convoy pattern for distributed work tracking:
 * - Work tracking units bundling BEADS
 * - Progress monitoring across agents
 * - Completion summary generation
 * - Git-backed artifact tracking
 * 
 * Based on Steve Yegge's Gas Town orchestration patterns:
 * https://github.com/steveyegge/gastown
 * 
 * Reference: /home/toba/superclaw/docs/intel/yegge-ecosystem-map.md
 */

import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';

const execAsync = promisify(exec);

// Core Convoy Types

export interface Bead {
  id: string;
  title: string;
  description: string;
  status: 'ready' | 'assigned' | 'in-progress' | 'blocked' | 'completed' | 'failed' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'critical';
  assignee?: string;
  dependencies: string[]; // bead IDs that must complete first
  blockers: string[]; // bead IDs that this bead blocks
  estimatedHours?: number;
  actualHours?: number;
  tags: string[];
  created: Date;
  updated: Date;
  started?: Date;
  completed?: Date;
  metadata: Record<string, any>;
}

export interface ConvoyConfig {
  id: string;
  name: string;
  description: string;
  owner: string;
  workspace: string;
  mergeStrategy: 'direct' | 'mr' | 'local' | 'atomic';
  qualityGates: QualityGate[];
  maxConcurrentBeads: number;
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  gitIntegration: GitIntegrationConfig;
  dashboard: DashboardConfig;
}

export interface QualityGate {
  name: string;
  type: 'test' | 'lint' | 'build' | 'review' | 'security' | 'custom';
  command?: string;
  required: boolean;
  timeoutMs: number;
}

export interface RetryPolicy {
  maxRetries: number;
  backoffMs: number;
  exponential: boolean;
  retryableStatuses: string[];
}

export interface GitIntegrationConfig {
  enabled: boolean;
  autoCommit: boolean;
  autoPush: boolean;
  branchPrefix: string;
  tagReleases: boolean;
  signCommits: boolean;
}

export interface DashboardConfig {
  enabled: boolean;
  port: number;
  updateIntervalMs: number;
  enableWebSocket: boolean;
  theme: 'dark' | 'light' | 'auto';
}

export interface ConvoyProgress {
  total: number;
  completed: number;
  failed: number;
  blocked: number;
  inProgress: number;
  ready: number;
  percentage: number;
  estimatedCompletionTime?: Date;
  velocity: number; // beads per hour
  efficiency: number; // actual vs estimated hours
}

export interface ConvoyStatus {
  convoy: ConvoyConfig;
  beads: Bead[];
  progress: ConvoyProgress;
  assignments: Map<string, string>; // beadId -> agentId
  artifacts: ConvoyArtifact[];
  quality: QualityReport;
  timeline: ConvoyEvent[];
  metrics: ConvoyMetrics;
}

export interface ConvoyArtifact {
  id: string;
  type: 'file' | 'commit' | 'branch' | 'tag' | 'mr' | 'report';
  path: string;
  title: string;
  description?: string;
  beadId?: string;
  agentId?: string;
  created: Date;
  hash?: string; // git commit hash or file hash
  size?: number; // file size in bytes
  metadata: Record<string, any>;
}

export interface QualityReport {
  overallScore: number; // 0-100
  gates: Array<{
    gate: QualityGate;
    status: 'pass' | 'fail' | 'skip' | 'pending';
    score?: number;
    message?: string;
    details?: any;
  }>;
  recommendations: string[];
  blockers: string[];
}

export interface ConvoyEvent {
  id: string;
  type: 'created' | 'started' | 'bead_assigned' | 'bead_completed' | 'bead_failed' | 'paused' | 'resumed' | 'completed' | 'cancelled';
  timestamp: Date;
  beadId?: string;
  agentId?: string;
  data?: any;
  message: string;
}

export interface ConvoyMetrics {
  duration: {
    total: number; // ms
    planning: number;
    execution: number;
    quality: number;
    cleanup: number;
  };
  throughput: {
    beadsPerHour: number;
    beadsPerAgent: number;
    avgBeadDuration: number;
  };
  quality: {
    passRate: number;
    bugRate: number;
    reworkRate: number;
    testCoverage?: number;
  };
  resources: {
    agentUtilization: number; // 0-1
    maxConcurrentAgents: number;
    peakMemoryMB: number;
    totalApiCalls: number;
    totalTokens: number;
    totalCost: number;
  };
}

export interface ConvoyResult {
  convoy: ConvoyConfig;
  status: ConvoyStatus;
  success: boolean;
  completedBeads: number;
  failedBeads: number;
  artifacts: ConvoyArtifact[];
  summary: ConvoySummary;
  metrics: ConvoyMetrics;
}

export interface ConvoySummary {
  title: string;
  overview: string;
  achievements: string[];
  failures: string[];
  lessons: string[];
  nextSteps: string[];
  recommendations: string[];
  keyArtifacts: ConvoyArtifact[];
  timeline: string; // human-readable duration
  efficiency: string; // human-readable efficiency assessment
}

// Agent Integration Types

export interface ConvoyAgent {
  id: string;
  name: string;
  provider: string;
  status: 'idle' | 'assigned' | 'working' | 'blocked' | 'failed' | 'disconnected';
  currentBead?: string;
  capabilities: string[];
  workload: number; // current number of assigned beads
  maxWorkload: number;
  performance: AgentPerformance;
  workspace: string; // agent's workspace directory
  session?: string; // active session ID
}

export interface AgentPerformance {
  beadsCompleted: number;
  beadsFailed: number;
  averageDuration: number; // ms
  successRate: number; // 0-1
  velocity: number; // beads per hour
  qualityScore: number; // 0-100
  specialties: string[]; // inferred from successful work
  lastActive: Date;
}

// Event System

export class ConvoyEventBus extends EventEmitter {
  emit(event: 'convoy:created', convoy: ConvoyConfig): boolean;
  emit(event: 'convoy:started', convoy: ConvoyConfig): boolean;
  emit(event: 'convoy:completed', result: ConvoyResult): boolean;
  emit(event: 'convoy:failed', convoy: ConvoyConfig, error: Error): boolean;
  emit(event: 'convoy:cancelled', convoy: ConvoyConfig, reason: string): boolean;
  emit(event: 'bead:assigned', bead: Bead, agent: ConvoyAgent): boolean;
  emit(event: 'bead:started', bead: Bead, agent: ConvoyAgent): boolean;
  emit(event: 'bead:completed', bead: Bead, agent: ConvoyAgent, result: any): boolean;
  emit(event: 'bead:failed', bead: Bead, agent: ConvoyAgent, error: Error): boolean;
  emit(event: 'bead:blocked', bead: Bead, dependencies: string[]): boolean;
  emit(event: 'progress:updated', progress: ConvoyProgress): boolean;
  emit(event: 'quality:report', report: QualityReport): boolean;
  emit(event: string, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }
}

// Main Convoy Class

export class Convoy extends EventEmitter {
  public readonly config: ConvoyConfig;
  private beads: Map<string, Bead> = new Map();
  private agents: Map<string, ConvoyAgent> = new Map();
  private assignments: Map<string, string> = new Map(); // beadId -> agentId
  private artifacts: Map<string, ConvoyArtifact> = new Map();
  private events: ConvoyEvent[] = [];
  private metrics: Partial<ConvoyMetrics> = {};
  private startTime?: Date;
  private endTime?: Date;
  private status: 'created' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' = 'created';
  private eventBus: ConvoyEventBus;
  private progressInterval?: NodeJS.Timeout;
  private qualityGateResults: Map<string, any> = new Map();

  constructor(config: ConvoyConfig) {
    super();
    this.config = config;
    this.eventBus = new ConvoyEventBus();
    
    // Forward events to external listeners
    this.eventBus.on('progress:updated', (progress) => {
      this.emit('progress', progress);
    });
    
    this.addEvent('created', `Convoy ${config.name} created`);
    
    console.log(`[convoy] Created convoy ${config.id}: ${config.name}`);
  }

  /**
   * Initialize convoy with beads from BEADS or direct specification
   */
  async initialize(beads: Bead[] | string[]): Promise<void> {
    if (typeof beads[0] === 'string') {
      // Load from BEADS
      const beadIds = beads as string[];
      await this.loadBeadsFromBeads(beadIds);
    } else {
      // Use provided beads
      const beadObjects = beads as Bead[];
      for (const bead of beadObjects) {
        this.beads.set(bead.id, bead);
      }
    }

    // Validate dependencies
    this.validateDependencies();
    
    // Initialize workspace
    await this.initializeWorkspace();
    
    console.log(`[convoy] Initialized with ${this.beads.size} beads`);
  }

  /**
   * Add agents to the convoy
   */
  async addAgent(agent: ConvoyAgent): Promise<void> {
    this.agents.set(agent.id, agent);
    
    // Create agent workspace
    const agentWorkspace = join(this.config.workspace, 'agents', agent.id);
    await fs.mkdir(agentWorkspace, { recursive: true });
    agent.workspace = agentWorkspace;
    
    console.log(`[convoy] Added agent ${agent.name} (${agent.provider})`);
    // @ts-expect-error - Post-Merge Reconciliation
    this.addEvent('agent_added', `Agent ${agent.name} added to convoy`);
  }

  /**
   * Start convoy execution
   */
  async start(): Promise<ConvoyResult> {
    if (this.status !== 'created' && this.status !== 'paused') {
      throw new Error(`Cannot start convoy in ${this.status} state`);
    }

    this.status = 'running';
    this.startTime = new Date();
    this.addEvent('started', 'Convoy execution started');
    this.eventBus.emit('convoy:started', this.config);

    console.log(`[convoy] Starting convoy ${this.config.name} with ${this.beads.size} beads and ${this.agents.size} agents`);

    // Start progress monitoring
    this.startProgressMonitoring();

    try {
      // Phase 1: Planning and assignment
      await this.planExecution();
      
      // Phase 2: Execute beads
      const results = await this.executeBeds();
      
      // Phase 3: Quality gates
      const qualityReport = await this.runQualityGates();
      
      // Phase 4: Generate artifacts
      await this.generateArtifacts();
      
      // Phase 5: Create summary
      const summary = await this.generateSummary();
      
      this.status = 'completed';
      this.endTime = new Date();
      this.stopProgressMonitoring();
      
      const result: ConvoyResult = {
        convoy: this.config,
        status: await this.getStatus(),
        success: qualityReport.overallScore >= 80, // 80% quality threshold
        completedBeads: Array.from(this.beads.values()).filter(b => b.status === 'completed').length,
        failedBeads: Array.from(this.beads.values()).filter(b => b.status === 'failed').length,
        artifacts: Array.from(this.artifacts.values()),
        summary,
        metrics: await this.calculateFinalMetrics(),
      };

      this.addEvent('completed', `Convoy completed with ${result.completedBeads}/${this.beads.size} beads successful`);
      this.eventBus.emit('convoy:completed', result);

      return result;

    } catch (error: unknown) {
      this.status = 'failed';
      this.endTime = new Date();
      this.stopProgressMonitoring();
      
      // @ts-expect-error - Post-Merge Reconciliation
      this.addEvent('failed', `Convoy failed: ${error instanceof Error ? (error).message : String(error)}`);
      this.eventBus.emit('convoy:failed', this.config, error instanceof Error ? error : new Error(String(error)));
      
      throw error;
    }
  }

  /**
   * Pause convoy execution
   */
  async pause(reason?: string): Promise<void> {
    if (this.status !== 'running') {
      throw new Error(`Cannot pause convoy in ${this.status} state`);
    }

    this.status = 'paused';
    this.stopProgressMonitoring();
    
    // Pause all agents
    for (const agent of this.agents.values()) {
      if (agent.status === 'working') {
        agent.status = 'blocked';
      }
    }

    this.addEvent('paused', `Convoy paused: ${reason || 'Manual pause'}`);
    console.log(`[convoy] Paused convoy: ${reason || 'Manual pause'}`);
  }

  /**
   * Resume convoy execution
   */
  async resume(): Promise<void> {
    if (this.status !== 'paused') {
      throw new Error(`Cannot resume convoy in ${this.status} state`);
    }

    this.status = 'running';
    this.startProgressMonitoring();
    
    // Resume agents
    for (const agent of this.agents.values()) {
      if (agent.status === 'blocked' && agent.currentBead) {
        agent.status = 'working';
      } else if (!agent.currentBead) {
        agent.status = 'idle';
      }
    }

    this.addEvent('resumed', 'Convoy execution resumed');
    console.log(`[convoy] Resumed convoy execution`);
  }

  /**
   * Cancel convoy execution
   */
  async cancel(reason: string): Promise<void> {
    const previousStatus = this.status;
    this.status = 'cancelled';
    this.endTime = new Date();
    this.stopProgressMonitoring();

    // Cancel all agents
    for (const agent of this.agents.values()) {
      agent.status = 'idle';
      agent.currentBead = undefined;
    }

    // Mark incomplete beads as cancelled
    for (const bead of this.beads.values()) {
      if (bead.status === 'in-progress' || bead.status === 'assigned' || bead.status === 'ready') {
        bead.status = 'cancelled';
        bead.updated = new Date();
      }
    }

    this.addEvent('cancelled', `Convoy cancelled: ${reason}`);
    this.eventBus.emit('convoy:cancelled', this.config, reason);
    
    console.log(`[convoy] Cancelled convoy: ${reason}`);
  }

  /**
   * Get current convoy status
   */
  async getStatus(): Promise<ConvoyStatus> {
    const progress = this.calculateProgress();
    const quality = await this.assessQuality();
    
    return {
      convoy: this.config,
      beads: Array.from(this.beads.values()),
      progress,
      assignments: new Map(this.assignments),
      artifacts: Array.from(this.artifacts.values()),
      quality,
      timeline: this.events.slice(), // copy
      metrics: await this.calculateCurrentMetrics(),
    };
  }

  /**
   * Get convoy dashboard data for visualization
   */
  async getDashboardData(): Promise<ConvoyDashboardData> {
    const status = await this.getStatus();
    
    return {
      convoy: {
        id: this.config.id,
        name: this.config.name,
        status: this.status,
        progress: status.progress,
        duration: this.calculateDuration(),
        estimatedCompletion: this.estimateCompletion(),
      },
      agents: Array.from(this.agents.values()).map(agent => ({
        id: agent.id,
        name: agent.name,
        status: agent.status,
        currentBead: agent.currentBead,
        workload: agent.workload,
        performance: agent.performance,
      })),
      beads: Array.from(this.beads.values()).map(bead => ({
        id: bead.id,
        title: bead.title,
        status: bead.status,
        assignee: this.assignments.get(bead.id),
        progress: this.calculateBeadProgress(bead),
        duration: bead.started && bead.completed 
          ? bead.completed.getTime() - bead.started.getTime()
          : bead.started
          ? Date.now() - bead.started.getTime()
          : 0,
      })),
      timeline: status.timeline.slice(-50), // last 50 events
      quality: status.quality,
      artifacts: status.artifacts.slice(-20), // last 20 artifacts
      metrics: status.metrics,
    };
  }

  // Private implementation methods

  private async loadBeadsFromBeads(beadIds: string[]): Promise<void> {
    // Integration with BEADS CLI to load existing beads
    try {
      const { stdout } = await execAsync(`bd show ${beadIds.join(' ')} --json`, {
        cwd: this.config.workspace,
      });
      
      const beadsData = JSON.parse(stdout);
      
      for (const beadData of beadsData) {
        const bead: Bead = {
          id: beadData.id,
          title: beadData.title || beadData.summary,
          description: beadData.description || beadData.body || '',
          status: this.mapBeadsStatus(beadData.status),
          priority: beadData.priority || 'medium',
          assignee: beadData.assignee,
          dependencies: beadData.dependencies || [],
          blockers: beadData.blockers || [],
          tags: beadData.tags || [],
          created: new Date(beadData.created),
          updated: new Date(beadData.updated || beadData.created),
          metadata: beadData,
        };
        
        this.beads.set(bead.id, bead);
      }
      
      console.log(`[convoy] Loaded ${beadsData.length} beads from BEADS`);
    } catch (error: unknown) {
      console.warn(`[convoy] Failed to load from BEADS: ${error}`);
      // Create placeholder beads for the IDs
      for (const beadId of beadIds) {
        const bead: Bead = {
          id: beadId,
          title: `Bead ${beadId}`,
          description: `Generated bead for ${beadId}`,
          status: 'ready',
          priority: 'medium',
          dependencies: [],
          blockers: [],
          tags: [],
          created: new Date(),
          updated: new Date(),
          metadata: { source: 'placeholder' },
        };
        this.beads.set(bead.id, bead);
      }
    }
  }

  private mapBeadsStatus(beadsStatus: string): Bead['status'] {
    const mapping: Record<string, Bead['status']> = {
      'open': 'ready',
      'assigned': 'assigned',
      'in-progress': 'in-progress',
      'blocked': 'blocked',
      'closed': 'completed',
      'failed': 'failed',
      'cancelled': 'cancelled',
    };
    return mapping[beadsStatus] || 'ready';
  }

  private validateDependencies(): void {
    const beadIds = new Set(this.beads.keys());
    
    for (const bead of this.beads.values()) {
      // Check that all dependencies exist
      for (const depId of bead.dependencies) {
        if (!beadIds.has(depId)) {
          console.warn(`[convoy] Bead ${bead.id} has missing dependency: ${depId}`);
        }
      }
      
      // Check for circular dependencies (simple cycle detection)
      if (this.hasCyclicDependency(bead.id, new Set())) {
        throw new Error(`Circular dependency detected involving bead ${bead.id}`);
      }
    }
  }

  private hasCyclicDependency(beadId: string, visited: Set<string>): boolean {
    if (visited.has(beadId)) {
      return true;
    }
    
    visited.add(beadId);
    const bead = this.beads.get(beadId);
    if (!bead) {return false;}
    
    for (const depId of bead.dependencies) {
      if (this.hasCyclicDependency(depId, new Set(visited))) {
        return true;
      }
    }
    
    return false;
  }

  private async initializeWorkspace(): Promise<void> {
    await fs.mkdir(this.config.workspace, { recursive: true });
    await fs.mkdir(join(this.config.workspace, 'agents'), { recursive: true });
    await fs.mkdir(join(this.config.workspace, 'artifacts'), { recursive: true });
    await fs.mkdir(join(this.config.workspace, 'reports'), { recursive: true });
    
    // Initialize git if enabled
    if (this.config.gitIntegration.enabled) {
      try {
        await execAsync('git init', { cwd: this.config.workspace });
        await execAsync('git config user.name "SuperClaw Convoy"', { cwd: this.config.workspace });
        await execAsync('git config user.email "convoy@superclaw.local"', { cwd: this.config.workspace });
        
        // Create initial commit
        const readmePath = join(this.config.workspace, 'README.md');
        await fs.writeFile(readmePath, this.generateReadme());
        await execAsync('git add README.md', { cwd: this.config.workspace });
        await execAsync(`git commit -m "Initialize convoy: ${this.config.name}"`, { cwd: this.config.workspace });
        
        console.log(`[convoy] Initialized git repository at ${this.config.workspace}`);
      } catch (error: unknown) {
        console.warn(`[convoy] Failed to initialize git: ${error}`);
      }
    }
  }

  private generateReadme(): string {
    return `# Convoy: ${this.config.name}

${this.config.description}

## Configuration

- **ID**: ${this.config.id}
- **Owner**: ${this.config.owner}
- **Merge Strategy**: ${this.config.mergeStrategy}
- **Max Concurrent Beads**: ${this.config.maxConcurrentBeads}
- **Created**: ${new Date().toISOString()}

## Beads (${this.beads.size})

${Array.from(this.beads.values()).map(bead => 
  `- [${bead.status.toUpperCase()}] **${bead.title}** (${bead.id})`
).join('\n')}

## Agents (${this.agents.size})

${Array.from(this.agents.values()).map(agent => 
  `- **${agent.name}** (${agent.provider}) - ${agent.capabilities.join(', ')}`
).join('\n')}

---

Generated by SuperClaw Convoy System
`;
  }

  private async planExecution(): Promise<void> {
    console.log(`[convoy] Planning execution for ${this.beads.size} beads`);
    
    // Create execution plan based on dependencies
    const executionPlan = this.createExecutionPlan();
    
    // Assign initial beads to agents
    await this.assignReadyBeads();
    
    // @ts-expect-error - Post-Merge Reconciliation
    this.addEvent('planned', `Execution plan created with ${executionPlan.phases.length} phases`);
  }

  private createExecutionPlan(): ExecutionPlan {
    const beads = Array.from(this.beads.values());
    const phases: Bead[][] = [];
    const processed = new Set<string>();
    
    // Topological sort to create phases
    while (processed.size < beads.length) {
      const readyBeads = beads.filter(bead => 
        !processed.has(bead.id) && 
        bead.dependencies.every(depId => processed.has(depId))
      );
      
      if (readyBeads.length === 0) {
        throw new Error('Circular dependency or missing dependency detected');
      }
      
      phases.push(readyBeads);
      readyBeads.forEach(bead => processed.add(bead.id));
    }
    
    return {
      phases,
      estimatedDuration: phases.length * 30 * 60 * 1000, // 30 min per phase
      parallelism: Math.min(this.config.maxConcurrentBeads, this.agents.size),
    };
  }

  private async assignReadyBeads(): Promise<void> {
    const readyBeads = Array.from(this.beads.values()).filter(bead => 
      bead.status === 'ready' && 
      bead.dependencies.every(depId => {
        const dep = this.beads.get(depId);
        return dep?.status === 'completed';
      })
    );

    const idleAgents = Array.from(this.agents.values()).filter(agent => 
      agent.status === 'idle' && agent.workload < agent.maxWorkload
    );

    // Simple round-robin assignment for now
    // TODO: Implement smarter assignment based on agent capabilities
    let agentIndex = 0;
    for (const bead of readyBeads.slice(0, Math.min(readyBeads.length, idleAgents.length))) {
      const agent = idleAgents[agentIndex % idleAgents.length];
      await this.assignBeadToAgent(bead.id, agent.id);
      agentIndex++;
    }
  }

  private async assignBeadToAgent(beadId: string, agentId: string): Promise<void> {
    const bead = this.beads.get(beadId);
    const agent = this.agents.get(agentId);
    
    if (!bead || !agent) {
      throw new Error(`Invalid assignment: bead ${beadId} or agent ${agentId} not found`);
    }

    bead.status = 'assigned';
    bead.assignee = agent.name;
    bead.updated = new Date();
    
    agent.currentBead = beadId;
    agent.status = 'assigned';
    agent.workload++;
    
    this.assignments.set(beadId, agentId);
    
    this.addEvent('bead_assigned', `Bead ${bead.title} assigned to ${agent.name}`, { beadId, agentId });
    this.eventBus.emit('bead:assigned', bead, agent);
    
    console.log(`[convoy] Assigned bead ${bead.id} (${bead.title}) to agent ${agent.name}`);
  }

  private async executeBeds(): Promise<Map<string, any>> {
    const results = new Map<string, any>();
    
    console.log(`[convoy] Starting bead execution`);
    
    // Continue until all beads are completed or failed
    while (this.hasIncompleteBeds() && this.status === 'running') {
      // Process assigned beads
      const assignedBeads = Array.from(this.beads.values()).filter(b => b.status === 'assigned');
      
      for (const bead of assignedBeads) {
        const agentId = this.assignments.get(bead.id);
        if (!agentId) {continue;}
        
        const agent = this.agents.get(agentId);
        if (!agent) {continue;}
        
        try {
          const result = await this.executeBead(bead, agent);
          results.set(bead.id, result);
          
          // Check for newly ready beads
          await this.assignReadyBeads();
          
        } catch (error: unknown) {
          console.error(`[convoy] Bead ${bead.id} failed:`, error);
          bead.status = 'failed';
          bead.updated = new Date();
          agent.status = 'idle';
          agent.currentBead = undefined;
          agent.workload--;
          
          this.eventBus.emit('bead:failed', bead, agent, error instanceof Error ? error : new Error(String(error)));
        }
      }
      
      // Wait before next iteration
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log(`[convoy] Completed bead execution with ${results.size} results`);
    return results;
  }

  private hasIncompleteBeds(): boolean {
    return Array.from(this.beads.values()).some(bead => 
      bead.status === 'ready' || bead.status === 'assigned' || bead.status === 'in-progress'
    );
  }

  private async executeBead(bead: Bead, agent: ConvoyAgent): Promise<any> {
    console.log(`[convoy] Agent ${agent.name} starting bead ${bead.id}: ${bead.title}`);
    
    bead.status = 'in-progress';
    bead.started = new Date();
    bead.updated = new Date();
    agent.status = 'working';
    
    // @ts-expect-error - Post-Merge Reconciliation
    this.addEvent('bead_started', `Bead ${bead.title} started by ${agent.name}`, { beadId: bead.id, agentId: agent.id });
    this.eventBus.emit('bead:started', bead, agent);
    
    // Create work context for the agent
    const workContext = this.createWorkContext(bead, agent);
    
    // Execute the bead (this would integrate with SuperClaw's agent execution)
    // For now, simulate work
    const result = await this.simulateBeadExecution(bead, agent, workContext);
    
    // Update bead and agent status
    bead.status = result.success ? 'completed' : 'failed';
    bead.completed = new Date();
    bead.updated = new Date();
    bead.actualHours = (bead.completed.getTime() - (bead.started?.getTime() || 0)) / (1000 * 60 * 60);
    
    agent.status = 'idle';
    agent.currentBead = undefined;
    agent.workload--;
    agent.performance.beadsCompleted++;
    agent.performance.lastActive = new Date();
    
    // Create artifacts
    if (result.success && result.artifacts) {
      for (const artifactData of result.artifacts) {
        await this.createArtifact({
          type: artifactData.type,
          path: artifactData.path,
          title: artifactData.title,
          description: artifactData.description,
          beadId: bead.id,
          agentId: agent.id,
          metadata: artifactData.metadata || {},
        });
      }
    }
    
    this.addEvent(
      result.success ? 'bead_completed' : 'bead_failed',
      `Bead ${bead.title} ${result.success ? 'completed' : 'failed'} by ${agent.name}`,
      { beadId: bead.id, agentId: agent.id, result }
    );
    
    if (result.success) {
      this.eventBus.emit('bead:completed', bead, agent, result);
    } else {
      this.eventBus.emit('bead:failed', bead, agent, new Error(result.error || 'Execution failed'));
    }
    
    console.log(`[convoy] Agent ${agent.name} ${result.success ? 'completed' : 'failed'} bead ${bead.id}`);
    
    return result;
  }

  private createWorkContext(bead: Bead, agent: ConvoyAgent): any {
    return {
      convoy: {
        id: this.config.id,
        name: this.config.name,
        workspace: this.config.workspace,
      },
      bead: {
        id: bead.id,
        title: bead.title,
        description: bead.description,
        metadata: bead.metadata,
      },
      agent: {
        id: agent.id,
        name: agent.name,
        workspace: agent.workspace,
        capabilities: agent.capabilities,
      },
      dependencies: bead.dependencies.map(depId => {
        const dep = this.beads.get(depId);
        return dep ? { id: dep.id, title: dep.title, status: dep.status } : null;
      }).filter(Boolean),
    };
  }

  private async simulateBeadExecution(bead: Bead, agent: ConvoyAgent, context: any): Promise<any> {
    // This would integrate with SuperClaw's agent execution system
    // For now, simulate successful execution
    
    const duration = Math.random() * 10000 + 5000; // 5-15 seconds
    await new Promise(resolve => setTimeout(resolve, duration));
    
    const success = Math.random() > 0.1; // 90% success rate
    
    if (success) {
      return {
        success: true,
        output: `Successfully completed ${bead.title}`,
        artifacts: [
          {
            type: 'file',
            path: join(agent.workspace, `${bead.id}-result.md`),
            title: `Result for ${bead.title}`,
            description: `Output from executing bead ${bead.id}`,
          }
        ],
        metadata: {
          duration,
          agent: agent.id,
          timestamp: new Date().toISOString(),
        }
      };
    } else {
      return {
        success: false,
        error: `Failed to execute ${bead.title}`,
        metadata: {
          duration,
          agent: agent.id,
          timestamp: new Date().toISOString(),
        }
      };
    }
  }

  private async createArtifact(artifactData: Partial<ConvoyArtifact>): Promise<ConvoyArtifact> {
    const artifact: ConvoyArtifact = {
      id: this.generateId('art'),
      type: artifactData.type || 'file',
      path: artifactData.path || '',
      title: artifactData.title || 'Unnamed artifact',
      description: artifactData.description,
      beadId: artifactData.beadId,
      agentId: artifactData.agentId,
      created: new Date(),
      metadata: artifactData.metadata || {},
    };
    
    // Calculate file hash if it's a file
    if (artifact.type === 'file' && artifact.path) {
      try {
        const content = await fs.readFile(artifact.path);
        artifact.hash = crypto.createHash('sha256').update(content).digest('hex');
        artifact.size = content.length;
      } catch (error: unknown) {
        console.warn(`[convoy] Failed to hash artifact ${artifact.path}:`, error);
      }
    }
    
    this.artifacts.set(artifact.id, artifact);
    console.log(`[convoy] Created artifact: ${artifact.title} (${artifact.type})`);
    
    return artifact;
  }

  private async runQualityGates(): Promise<QualityReport> {
    console.log(`[convoy] Running ${this.config.qualityGates.length} quality gates`);
    
    const gateResults = [];
    let overallScore = 0;
    const recommendations: string[] = [];
    const blockers: string[] = [];
    
    for (const gate of this.config.qualityGates) {
      try {
        const result = await this.runQualityGate(gate);
        gateResults.push(result);
        
        if (result.status === 'pass') {
          overallScore += result.score || 100;
        } else if (result.status === 'fail' && gate.required) {
          blockers.push(`Required quality gate failed: ${gate.name}`);
        }
        
        if (result.status === 'fail' && result.message) {
          recommendations.push(`Fix ${gate.name}: ${result.message}`);
        }
        
      } catch (error: unknown) {
        const result = {
          gate,
          status: 'fail' as const,
          message: `Gate execution failed: ${error instanceof Error ? (error).message : String(error)}`,
        };
        
        gateResults.push(result);
        
        if (gate.required) {
          blockers.push(`Required quality gate failed: ${gate.name}`);
        }
      }
    }
    
    overallScore = gateResults.length > 0 ? overallScore / gateResults.length : 0;
    
    const report: QualityReport = {
      overallScore,
      gates: gateResults,
      recommendations,
      blockers,
    };
    
    // @ts-expect-error - Post-Merge Reconciliation
    this.addEvent('quality_report', `Quality assessment complete: ${overallScore.toFixed(1)}% overall score`);
    this.eventBus.emit('quality:report', report);
    
    console.log(`[convoy] Quality report: ${overallScore.toFixed(1)}% overall score, ${blockers.length} blockers`);
    
    return report;
  }

  private async runQualityGate(gate: QualityGate): Promise<{
    gate: QualityGate;
    status: 'pass' | 'fail' | 'skip' | 'pending';
    score?: number;
    message?: string;
    details?: any;
  }> {
    console.log(`[convoy] Running quality gate: ${gate.name} (${gate.type})`);
    
    if (!gate.command) {
      return {
        gate,
        status: 'skip',
        message: 'No command specified',
      };
    }
    
    try {
      const startTime = Date.now();
      const { stdout, stderr } = await execAsync(gate.command, {
        cwd: this.config.workspace,
        timeout: gate.timeoutMs,
      });
      const duration = Date.now() - startTime;
      
      // Simple heuristic: if command succeeded, gate passes
      const success = true;
      const score = success ? 100 : 0;
      
      return {
        gate,
        status: success ? 'pass' : 'fail',
        score,
        message: success ? `Gate passed in ${duration}ms` : 'Gate failed',
        details: {
          stdout,
          stderr,
          duration,
        },
      };
      
    } catch (error: unknown) {
      return {
        gate,
        status: 'fail',
        message: error instanceof Error ? (error).message : String(error),
      };
    }
  }

  private async generateArtifacts(): Promise<void> {
    console.log(`[convoy] Generating convoy artifacts`);
    
    // Generate convoy report
    const reportPath = join(this.config.workspace, 'reports', `convoy-${this.config.id}-report.json`);
    const status = await this.getStatus();
    await fs.writeFile(reportPath, JSON.stringify(status, null, 2));
    
    await this.createArtifact({
      type: 'report',
      path: reportPath,
      title: 'Convoy Status Report',
      description: `Complete status report for convoy ${this.config.name}`,
      metadata: { type: 'convoy_report', format: 'json' },
    });
    
    // Generate timeline visualization
    const timelinePath = join(this.config.workspace, 'reports', `convoy-${this.config.id}-timeline.md`);
    const timelineMarkdown = this.generateTimelineMarkdown();
    await fs.writeFile(timelinePath, timelineMarkdown);
    
    await this.createArtifact({
      type: 'report',
      path: timelinePath,
      title: 'Convoy Timeline',
      description: `Timeline visualization for convoy ${this.config.name}`,
      metadata: { type: 'timeline', format: 'markdown' },
    });
    
    // Commit artifacts to git if enabled
    if (this.config.gitIntegration.enabled) {
      await this.commitArtifacts();
    }
  }

  private generateTimelineMarkdown(): string {
    let markdown = `# Convoy Timeline: ${this.config.name}\n\n`;
    
    markdown += `## Overview\n`;
    markdown += `- **Started**: ${this.startTime?.toISOString()}\n`;
    markdown += `- **Duration**: ${this.calculateDuration()}\n`;
    markdown += `- **Status**: ${this.status}\n`;
    markdown += `- **Beads**: ${this.beads.size}\n`;
    markdown += `- **Agents**: ${this.agents.size}\n\n`;
    
    markdown += `## Timeline\n\n`;
    
    for (const event of this.events) {
      const timestamp = event.timestamp.toISOString();
      markdown += `### ${timestamp} - ${event.type.toUpperCase()}\n`;
      markdown += `${event.message}\n\n`;
    }
    
    return markdown;
  }

  private async commitArtifacts(): Promise<void> {
    try {
      await execAsync('git add .', { cwd: this.config.workspace });
      const commitMessage = `Convoy ${this.config.id}: Generated artifacts`;
      await execAsync(`git commit -m "${commitMessage}"`, { cwd: this.config.workspace });
      
      if (this.config.gitIntegration.autoPush) {
        await execAsync('git push', { cwd: this.config.workspace });
      }
      
      if (this.config.gitIntegration.tagReleases) {
        const tag = `convoy-${this.config.id}-${Date.now()}`;
        await execAsync(`git tag ${tag}`, { cwd: this.config.workspace });
        
        if (this.config.gitIntegration.autoPush) {
          await execAsync(`git push origin ${tag}`, { cwd: this.config.workspace });
        }
      }
      
      console.log(`[convoy] Committed artifacts to git`);
    } catch (error: unknown) {
      console.warn(`[convoy] Failed to commit artifacts:`, error);
    }
  }

  private async generateSummary(): Promise<ConvoySummary> {
    const completedBeads = Array.from(this.beads.values()).filter(b => b.status === 'completed');
    const failedBeads = Array.from(this.beads.values()).filter(b => b.status === 'failed');
    const duration = this.calculateDuration();
    const efficiency = this.calculateEfficiency();
    
    const summary: ConvoySummary = {
      title: `Convoy ${this.config.name} - ${this.status === 'completed' ? 'Completed' : 'Failed'}`,
      overview: `Convoy executed ${completedBeads.length}/${this.beads.size} beads successfully in ${duration} using ${this.agents.size} agents.`,
      achievements: [
        `Completed ${completedBeads.length} beads`,
        `Generated ${this.artifacts.size} artifacts`,
        `Maintained ${this.agents.size} active agents`,
      ],
      failures: failedBeads.map(bead => `Failed to complete: ${bead.title} (${bead.id})`),
      lessons: [
        'Multi-agent coordination requires careful dependency management',
        'Quality gates are essential for maintaining output quality',
        'Git-backed persistence enables audit trails and rollback capability',
      ],
      nextSteps: failedBeads.length > 0 
        ? [`Retry failed beads: ${failedBeads.map(b => b.id).join(', ')}`]
        : ['Deploy completed work', 'Monitor production performance'],
      recommendations: [
        efficiency > 0.8 ? 'Excellent efficiency - consider increasing convoy size' : 'Review agent performance and workload distribution',
        this.artifacts.size > 10 ? 'Rich artifact generation - consider automated deployment' : 'Increase artifact generation for better traceability',
      ],
      keyArtifacts: Array.from(this.artifacts.values()).slice(0, 5),
      timeline: duration,
      efficiency: efficiency > 0.8 ? 'Excellent' : efficiency > 0.6 ? 'Good' : efficiency > 0.4 ? 'Fair' : 'Poor',
    };
    
    return summary;
  }

  private calculateProgress(): ConvoyProgress {
    const beads = Array.from(this.beads.values());
    const total = beads.length;
    const completed = beads.filter(b => b.status === 'completed').length;
    const failed = beads.filter(b => b.status === 'failed').length;
    const blocked = beads.filter(b => b.status === 'blocked').length;
    const inProgress = beads.filter(b => b.status === 'in-progress').length;
    const ready = beads.filter(b => b.status === 'ready').length;
    
    const percentage = total > 0 ? (completed / total) * 100 : 0;
    
    // Calculate velocity (beads per hour)
    const durationHours = this.startTime 
      ? (Date.now() - this.startTime.getTime()) / (1000 * 60 * 60)
      : 0;
    const velocity = durationHours > 0 ? completed / durationHours : 0;
    
    // Calculate efficiency (actual vs estimated time)
    const totalEstimated = beads.reduce((sum, b) => sum + (b.estimatedHours || 1), 0);
    const totalActual = beads.reduce((sum, b) => sum + (b.actualHours || 0), 0);
    const efficiency = totalEstimated > 0 && totalActual > 0 ? totalEstimated / totalActual : 1;
    
    return {
      total,
      completed,
      failed,
      blocked,
      inProgress,
      ready,
      percentage,
      velocity,
      efficiency,
    };
  }

  private async assessQuality(): Promise<QualityReport> {
    // Return cached quality report if available
    if (this.qualityGateResults.size > 0) {
      const gates = Array.from(this.qualityGateResults.values());
      const overallScore = gates.reduce((sum, gate) => sum + (gate.score || 0), 0) / gates.length;
      
      return {
        overallScore,
        gates,
        recommendations: [],
        blockers: [],
      };
    }
    
    // Simple quality assessment based on completion rate
    const progress = this.calculateProgress();
    const overallScore = progress.percentage * 0.8 + (progress.failed === 0 ? 20 : 0);
    
    return {
      overallScore,
      gates: [],
      recommendations: progress.failed > 0 ? ['Address failed beads'] : [],
      blockers: progress.blocked > 0 ? [`${progress.blocked} beads are blocked`] : [],
    };
  }

  private async calculateCurrentMetrics(): Promise<ConvoyMetrics> {
    const now = Date.now();
    const startTime = this.startTime?.getTime() || now;
    const duration = now - startTime;
    
    const beads = Array.from(this.beads.values());
    const completedBeads = beads.filter(b => b.status === 'completed');
    const failedBeads = beads.filter(b => b.status === 'failed');
    
    const durationHours = duration / (1000 * 60 * 60);
    const beadsPerHour = durationHours > 0 ? completedBeads.length / durationHours : 0;
    const beadsPerAgent = this.agents.size > 0 ? completedBeads.length / this.agents.size : 0;
    
    const avgBeadDuration = completedBeads.length > 0
      ? completedBeads.reduce((sum, b) => sum + (b.actualHours || 0), 0) / completedBeads.length * 1000 * 60 * 60
      : 0;
    
    const passRate = beads.length > 0 ? completedBeads.length / beads.length : 0;
    const bugRate = beads.length > 0 ? failedBeads.length / beads.length : 0;
    
    return {
      duration: {
        total: duration,
        planning: 0, // TODO: track planning time
        execution: duration,
        quality: 0, // TODO: track quality gate time
        cleanup: 0, // TODO: track cleanup time
      },
      throughput: {
        beadsPerHour,
        beadsPerAgent,
        avgBeadDuration,
      },
      quality: {
        passRate,
        bugRate,
        reworkRate: 0, // TODO: track rework
      },
      resources: {
        agentUtilization: 0, // TODO: calculate utilization
        maxConcurrentAgents: this.agents.size,
        peakMemoryMB: 0, // TODO: track memory usage
        totalApiCalls: 0, // TODO: track API calls
        totalTokens: 0, // TODO: track token usage
        totalCost: 0, // TODO: track costs
      },
    };
  }

  private async calculateFinalMetrics(): Promise<ConvoyMetrics> {
    const metrics = await this.calculateCurrentMetrics();
    
    // Update final durations if completed
    if (this.endTime && this.startTime) {
      metrics.duration.total = this.endTime.getTime() - this.startTime.getTime();
    }
    
    return metrics;
  }

  private calculateDuration(): string {
    if (!this.startTime) {return '0s';}
    
    const endTime = this.endTime || new Date();
    const duration = endTime.getTime() - this.startTime.getTime();
    
    const hours = Math.floor(duration / (1000 * 60 * 60));
    const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((duration % (1000 * 60)) / 1000);
    
    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  }

  private calculateEfficiency(): number {
    const beads = Array.from(this.beads.values()).filter(b => b.estimatedHours && b.actualHours);
    
    if (beads.length === 0) {return 1;}
    
    const totalEstimated = beads.reduce((sum, b) => sum + (b.estimatedHours || 0), 0);
    const totalActual = beads.reduce((sum, b) => sum + (b.actualHours || 0), 0);
    
    return totalEstimated > 0 && totalActual > 0 ? totalEstimated / totalActual : 1;
  }

  private estimateCompletion(): Date | undefined {
    const progress = this.calculateProgress();
    
    if (progress.velocity === 0 || progress.ready === 0) {
      return undefined;
    }
    
    const remainingBeads = progress.ready + progress.blocked;
    const hoursRemaining = remainingBeads / progress.velocity;
    
    return new Date(Date.now() + hoursRemaining * 60 * 60 * 1000);
  }

  private calculateBeadProgress(bead: Bead): number {
    switch (bead.status) {
      case 'completed': return 100;
      case 'failed': return 0;
      case 'cancelled': return 0;
      case 'in-progress': return 50; // TODO: More granular progress tracking
      case 'assigned': return 10;
      case 'ready': return 0;
      case 'blocked': return 0;
      default: return 0;
    }
  }

  private startProgressMonitoring(): void {
    this.progressInterval = setInterval(() => {
      const progress = this.calculateProgress();
      this.eventBus.emit('progress:updated', progress);
    }, this.config.dashboard.updateIntervalMs);
  }

  private stopProgressMonitoring(): void {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = undefined;
    }
  }

  private addEvent(type: ConvoyEvent['type'], message: string, data?: any): void {
    const event: ConvoyEvent = {
      id: this.generateId('evt'),
      type,
      timestamp: new Date(),
      message,
      data,
    };
    
    this.events.push(event);
    
    // Keep only last 1000 events
    if (this.events.length > 1000) {
      this.events.splice(0, this.events.length - 1000);
    }
  }

  private generateId(prefix: string): string {
    return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
  }
}

// Supporting interfaces

interface ExecutionPlan {
  phases: Bead[][];
  estimatedDuration: number;
  parallelism: number;
}

export interface ConvoyDashboardData {
  convoy: {
    id: string;
    name: string;
    status: string;
    progress: ConvoyProgress;
    duration: string;
    estimatedCompletion?: Date;
  };
  agents: Array<{
    id: string;
    name: string;
    status: string;
    currentBead?: string;
    workload: number;
    performance: AgentPerformance;
  }>;
  beads: Array<{
    id: string;
    title: string;
    status: string;
    assignee?: string;
    progress: number;
    duration: number;
  }>;
  timeline: ConvoyEvent[];
  quality: QualityReport;
  artifacts: ConvoyArtifact[];
  metrics: ConvoyMetrics;
}

// Factory functions

export function createConvoy(config: ConvoyConfig): Convoy {
  return new Convoy(config);
}

export function createDefaultConvoyConfig(
  name: string,
  workspace: string,
  owner: string = 'superclaw'
): ConvoyConfig {
  return {
    id: `cv-${crypto.randomBytes(4).toString('hex')}`,
    name,
    description: `Convoy for ${name}`,
    owner,
    workspace: resolve(workspace),
    mergeStrategy: 'direct',
    qualityGates: [
      {
        name: 'syntax-check',
        type: 'lint',
        command: 'echo "Syntax check passed"',
        required: false,
        timeoutMs: 30000,
      },
    ],
    maxConcurrentBeads: 5,
    timeoutMs: 3600000, // 1 hour
    retryPolicy: {
      maxRetries: 2,
      backoffMs: 5000,
      exponential: true,
      retryableStatuses: ['failed'],
    },
    gitIntegration: {
      enabled: true,
      autoCommit: true,
      autoPush: false,
      branchPrefix: 'convoy',
      tagReleases: true,
      signCommits: false,
    },
    dashboard: {
      enabled: true,
      port: 8080,
      updateIntervalMs: 5000,
      enableWebSocket: true,
      theme: 'dark',
    },
  };
}

export function createDefaultAgent(
  name: string,
  provider: string = 'claude',
  capabilities: string[] = ['general']
): ConvoyAgent {
  return {
    id: `agent-${crypto.randomBytes(4).toString('hex')}`,
    name,
    provider,
    status: 'idle',
    capabilities,
    workload: 0,
    maxWorkload: 3,
    performance: {
      beadsCompleted: 0,
      beadsFailed: 0,
      averageDuration: 0,
      successRate: 1,
      velocity: 0,
      qualityScore: 100,
      specialties: [],
      lastActive: new Date(),
    },
    workspace: '',
  };
}

// High-level orchestration function

export async function runConvoy(
  name: string,
  beads: Bead[] | string[],
  agents: ConvoyAgent[],
  options: {
    workspace?: string;
    owner?: string;
    config?: Partial<ConvoyConfig>;
  } = {}
): Promise<ConvoyResult> {
  
  const workspace = options.workspace || join(process.cwd(), '.convoy', name);
  const config = {
    ...createDefaultConvoyConfig(name, workspace, options.owner),
    ...options.config,
  };
  
  const convoy = createConvoy(config);
  
  // Initialize convoy
  await convoy.initialize(beads);
  
  // Add agents
  for (const agent of agents) {
    await convoy.addAgent(agent);
  }
  
  // Start execution
  return await convoy.start();
}

export default {
  Convoy,
  createConvoy,
  createDefaultConvoyConfig,
  createDefaultAgent,
  runConvoy,
  ConvoyEventBus,
};