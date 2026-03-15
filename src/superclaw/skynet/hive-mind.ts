/**
 * 👑 SKYNET Hive Mind — Queen-Led Agent Hierarchy
 * 
 * Implements Ruflo's Hive Mind pattern with:
 * - 3 Queen Types: Strategic, Tactical, Adaptive
 * - 8 Worker Types: Researcher, Coder, Analyst, Tester, Architect, Reviewer, Optimizer, Documenter
 * - Collective memory shared across the hive
 * - Queen coordination and task delegation
 * 
 * Architecture:
 * ┌─────────────────────────────────────────┐
 * │           STRATEGIC QUEEN              │ ← Long-term planning
 * │  (Architecture, Design, Direction)     │
 * ├─────────────────────────────────────────┤
 * │           TACTICAL QUEEN               │ ← Execution coordination
 * │  (Task breakdown, Assignment, Monitor) │
 * ├─────────────────────────────────────────┤
 * │           ADAPTIVE QUEEN               │ ← Optimization
 * │  (Learning, Performance, Adaptation)   │
 * ├─────────────────────────────────────────┤
 * │              WORKERS                   │
 * │  [Coder] [Tester] [Reviewer] [...]     │
 * └─────────────────────────────────────────┘
 */

import { EventEmitter } from 'events';
import { RaftConsensus, createRaftConsensus } from './raft-consensus';

// --- Types ---

export type QueenType = 'strategic' | 'tactical' | 'adaptive';
export type WorkerType = 'researcher' | 'coder' | 'analyst' | 'tester' | 'architect' | 'reviewer' | 'optimizer' | 'documenter';

export interface HiveAgent {
  id: string;
  type: 'queen' | 'worker';
  subType: QueenType | WorkerType;
  status: 'idle' | 'working' | 'blocked' | 'dead';
  currentTask?: HiveTask;
  completedTasks: number;
  failedTasks: number;
  performance: number;  // 0-1
  lastActive: number;
  metadata: Record<string, any>;
}

export interface HiveTask {
  id: string;
  type: 'planning' | 'coding' | 'testing' | 'review' | 'documentation' | 'research' | 'optimization';
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'pending' | 'assigned' | 'in-progress' | 'completed' | 'failed';
  assignedTo?: string;
  assignedBy?: string;
  dependencies: string[];
  result?: any;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface CollectiveMemory {
  decisions: Array<{ decision: string; reason: string; queen: string; timestamp: number }>;
  patterns: Array<{ pattern: string; outcome: 'success' | 'failure'; context: string }>;
  knowledge: Map<string, any>;
  taskHistory: HiveTask[];
}

export interface HiveMindConfig {
  /** Max workers per queen */
  maxWorkersPerQueen: number;
  /** Task timeout (ms) */
  taskTimeoutMs: number;
  /** Worker health check interval (ms) */
  healthCheckIntervalMs: number;
  /** Enable consensus for major decisions */
  useConsensus: boolean;
}

// --- Default Config ---

const DEFAULT_CONFIG: HiveMindConfig = {
  maxWorkersPerQueen: 8,
  taskTimeoutMs: 300000,  // 5 minutes
  healthCheckIntervalMs: 10000,
  useConsensus: true,
};

// --- Queen Classes ---

export class Queen extends EventEmitter {
  readonly id: string;
  readonly type: QueenType;
  status: 'active' | 'inactive' = 'inactive';
  workers: Map<string, HiveAgent> = new Map();
  taskQueue: HiveTask[] = [];
  
  constructor(type: QueenType) {
    super();
    this.id = `queen-${type}-${Date.now().toString(36)}`;
    this.type = type;
  }

  activate(): void {
    this.status = 'active';
    this.emit('activated', { queen: this.id, type: this.type });
  }

  deactivate(): void {
    this.status = 'inactive';
    this.emit('deactivated', { queen: this.id });
  }

  addWorker(worker: HiveAgent): void {
    this.workers.set(worker.id, worker);
    this.emit('workerAdded', { queen: this.id, worker: worker.id });
  }

  removeWorker(workerId: string): void {
    this.workers.delete(workerId);
    this.emit('workerRemoved', { queen: this.id, worker: workerId });
  }

  assignTask(task: HiveTask, workerId: string): void {
    const worker = this.workers.get(workerId);
    if (!worker) throw new Error(`Worker ${workerId} not found`);

    task.assignedTo = workerId;
    task.assignedBy = this.id;
    task.status = 'assigned';
    worker.currentTask = task;
    worker.status = 'working';

    this.emit('taskAssigned', { queen: this.id, task: task.id, worker: workerId });
  }

  getIdleWorkers(): HiveAgent[] {
    return Array.from(this.workers.values()).filter(w => w.status === 'idle');
  }

  getBestWorkerForTask(task: HiveTask): HiveAgent | null {
    const idle = this.getIdleWorkers();
    if (idle.length === 0) return null;

    // Match task type to worker type
    const typeMap: Record<string, WorkerType[]> = {
      'coding': ['coder', 'architect'],
      'testing': ['tester', 'analyst'],
      'review': ['reviewer', 'architect'],
      'documentation': ['documenter', 'researcher'],
      'research': ['researcher', 'analyst'],
      'optimization': ['optimizer', 'coder'],
      'planning': ['architect', 'researcher'],
    };

    const preferredTypes = typeMap[task.type] || [];

    // Find best match
    for (const preferredType of preferredTypes) {
      const match = idle.find(w => w.subType === preferredType);
      if (match) return match;
    }

    // Return highest performing idle worker
    return idle.sort((a, b) => b.performance - a.performance)[0] || null;
  }
}

// --- Hive Mind Service ---

export class HiveMind extends EventEmitter {
  private config: HiveMindConfig;
  private queens: Map<QueenType, Queen> = new Map();
  private allAgents: Map<string, HiveAgent> = new Map();
  private collectiveMemory: CollectiveMemory;
  private consensus?: RaftConsensus;
  private healthCheckTimer?: NodeJS.Timeout;

  constructor(config: Partial<HiveMindConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    this.collectiveMemory = {
      decisions: [],
      patterns: [],
      knowledge: new Map(),
      taskHistory: [],
    };

    // Initialize queens
    this.initializeQueens();
  }

  /**
   * Initialize the hive mind
   */
  async initialize(): Promise<void> {
    // Activate all queens
    for (const queen of this.queens.values()) {
      queen.activate();
    }

    // Initialize consensus if enabled
    if (this.config.useConsensus) {
      this.consensus = createRaftConsensus('hive-leader');
      for (const [type] of this.queens) {
        this.consensus.addPeer(`queen-${type}`);
      }
      this.consensus.start();
    }

    // Start health checks
    this.healthCheckTimer = setInterval(
      () => this.performHealthCheck(),
      this.config.healthCheckIntervalMs
    );

    this.emit('initialized', { queens: this.queens.size });
  }

  /**
   * Spawn a worker
   */
  spawnWorker(type: WorkerType, queenType: QueenType = 'tactical'): HiveAgent {
    const queen = this.queens.get(queenType);
    if (!queen) throw new Error(`Queen ${queenType} not found`);

    if (queen.workers.size >= this.config.maxWorkersPerQueen) {
      throw new Error(`Queen ${queenType} has max workers`);
    }

    const worker: HiveAgent = {
      id: `worker-${type}-${Date.now().toString(36)}`,
      type: 'worker',
      subType: type,
      status: 'idle',
      completedTasks: 0,
      failedTasks: 0,
      performance: 0.5,
      lastActive: Date.now(),
      metadata: {},
    };

    queen.addWorker(worker);
    this.allAgents.set(worker.id, worker);

    this.emit('workerSpawned', { worker: worker.id, type, queen: queenType });
    return worker;
  }

  /**
   * Submit a task to the hive
   */
  async submitTask(task: Omit<HiveTask, 'id' | 'status' | 'createdAt'>): Promise<HiveTask> {
    const fullTask: HiveTask = {
      ...task,
      id: `task-${Date.now().toString(36)}`,
      status: 'pending',
      createdAt: Date.now(),
    };

    // Route to appropriate queen
    const queen = this.routeTaskToQueen(fullTask);
    queen.taskQueue.push(fullTask);

    // Try to assign immediately
    await this.processTaskQueue(queen);

    this.emit('taskSubmitted', { task: fullTask.id, queen: queen.id });
    return fullTask;
  }

  /**
   * Make a collective decision
   */
  async makeDecision(
    decision: string,
    options: string[],
    reason?: string
  ): Promise<{ selectedOption: string; consensus: boolean }> {
    if (this.config.useConsensus && this.consensus) {
      const result = await this.consensus.proposeDecision(decision, options);
      
      // Record in collective memory
      this.collectiveMemory.decisions.push({
        decision,
        reason: reason || '',
        queen: 'consensus',
        timestamp: Date.now(),
      });

      return {
        selectedOption: result.selectedOption,
        consensus: result.consensus,
      };
    }

    // Fallback: strategic queen decides
    const selectedOption = options[0];
    this.collectiveMemory.decisions.push({
      decision,
      reason: reason || '',
      queen: 'strategic',
      timestamp: Date.now(),
    });

    return { selectedOption, consensus: true };
  }

  /**
   * Record a pattern outcome for learning
   */
  recordPattern(pattern: string, outcome: 'success' | 'failure', context: string): void {
    this.collectiveMemory.patterns.push({ pattern, outcome, context });

    // Notify adaptive queen
    const adaptive = this.queens.get('adaptive');
    if (adaptive) {
      adaptive.emit('patternRecorded', { pattern, outcome, context });
    }

    this.emit('patternRecorded', { pattern, outcome });
  }

  /**
   * Store knowledge in collective memory
   */
  storeKnowledge(key: string, value: any): void {
    this.collectiveMemory.knowledge.set(key, value);
    this.emit('knowledgeStored', { key });
  }

  /**
   * Retrieve knowledge from collective memory
   */
  getKnowledge(key: string): any {
    return this.collectiveMemory.knowledge.get(key);
  }

  /**
   * Get hive status
   */
  getStatus(): {
    queens: Array<{ type: QueenType; status: string; workerCount: number; taskQueueSize: number }>;
    totalWorkers: number;
    totalAgents: number;
    decisions: number;
    patterns: number;
    knowledge: number;
  } {
    const queens = Array.from(this.queens.entries()).map(([type, queen]) => ({
      type,
      status: queen.status,
      workerCount: queen.workers.size,
      taskQueueSize: queen.taskQueue.length,
    }));

    return {
      queens,
      totalWorkers: Array.from(this.queens.values()).reduce((sum, q) => sum + q.workers.size, 0),
      totalAgents: this.allAgents.size + this.queens.size,
      decisions: this.collectiveMemory.decisions.length,
      patterns: this.collectiveMemory.patterns.length,
      knowledge: this.collectiveMemory.knowledge.size,
    };
  }

  /**
   * Shutdown the hive
   */
  async shutdown(): Promise<void> {
    if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);
    if (this.consensus) this.consensus.stop();

    for (const queen of this.queens.values()) {
      queen.deactivate();
    }

    this.emit('shutdown');
  }

  // --- Private Methods ---

  private initializeQueens(): void {
    const queenTypes: QueenType[] = ['strategic', 'tactical', 'adaptive'];
    
    for (const type of queenTypes) {
      const queen = new Queen(type);
      this.queens.set(type, queen);
      
      // Set up queen event forwarding
      queen.on('taskAssigned', (data) => this.emit('taskAssigned', data));
      queen.on('workerAdded', (data) => this.emit('workerAdded', data));
    }
  }

  private routeTaskToQueen(task: HiveTask): Queen {
    // Route based on task type
    const routingMap: Record<string, QueenType> = {
      'planning': 'strategic',
      'coding': 'tactical',
      'testing': 'tactical',
      'review': 'tactical',
      'documentation': 'tactical',
      'research': 'strategic',
      'optimization': 'adaptive',
    };

    const queenType = routingMap[task.type] || 'tactical';
    return this.queens.get(queenType)!;
  }

  private async processTaskQueue(queen: Queen): Promise<void> {
    while (queen.taskQueue.length > 0) {
      const task = queen.taskQueue[0];
      
      // Check dependencies
      const depsComplete = task.dependencies.every(depId => {
        const dep = this.collectiveMemory.taskHistory.find(t => t.id === depId);
        return dep?.status === 'completed';
      });

      if (!depsComplete) {
        break;  // Wait for dependencies
      }

      // Find available worker
      const worker = queen.getBestWorkerForTask(task);
      if (!worker) {
        break;  // No workers available
      }

      // Assign task
      queen.taskQueue.shift();
      queen.assignTask(task, worker.id);
      
      // Simulate task execution (in real impl, would dispatch to actual agent)
      this.executeTask(task, worker, queen);
    }
  }

  private async executeTask(task: HiveTask, worker: HiveAgent, queen: Queen): Promise<void> {
    task.status = 'in-progress';
    task.startedAt = Date.now();

    // Simulate execution time based on priority
    const execTime = task.priority === 'critical' ? 1000 : 
                     task.priority === 'high' ? 2000 : 
                     task.priority === 'medium' ? 3000 : 5000;

    setTimeout(() => {
      // Simulate success (90% success rate)
      const success = Math.random() > 0.1;

      if (success) {
        task.status = 'completed';
        task.result = { success: true, output: `Completed: ${task.description}` };
        worker.completedTasks++;
        worker.performance = Math.min(1, worker.performance + 0.02);
      } else {
        task.status = 'failed';
        task.result = { success: false, error: 'Simulated failure' };
        worker.failedTasks++;
        worker.performance = Math.max(0, worker.performance - 0.05);
      }

      task.completedAt = Date.now();
      worker.status = 'idle';
      worker.currentTask = undefined;
      worker.lastActive = Date.now();

      // Store in history
      this.collectiveMemory.taskHistory.push(task);

      this.emit('taskCompleted', { task: task.id, success, worker: worker.id });

      // Process next task
      this.processTaskQueue(queen);
    }, execTime);
  }

  private performHealthCheck(): void {
    const now = Date.now();

    for (const agent of this.allAgents.values()) {
      // Check for stuck workers
      if (agent.status === 'working' && agent.currentTask) {
        const elapsed = now - (agent.currentTask.startedAt || 0);
        if (elapsed > this.config.taskTimeoutMs) {
          // Task timed out
          agent.currentTask.status = 'failed';
          agent.currentTask.result = { error: 'Timeout' };
          agent.status = 'idle';
          agent.failedTasks++;
          agent.performance = Math.max(0, agent.performance - 0.1);
          
          this.emit('taskTimeout', { task: agent.currentTask.id, worker: agent.id });
        }
      }

      // Check for dead workers (no activity in 5 minutes)
      if (now - agent.lastActive > 300000) {
        agent.status = 'dead';
        this.emit('workerDead', { worker: agent.id });
      }
    }
  }
}

// --- Factory ---

let instance: HiveMind | null = null;

export function getHiveMind(config?: Partial<HiveMindConfig>): HiveMind {
  if (!instance) {
    instance = new HiveMind(config);
  }
  return instance;
}

export default HiveMind;
