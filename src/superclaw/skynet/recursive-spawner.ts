/**
 * 🦊 SKYNET RECURSIVE SPAWNER — Agents Spawn Agents Recursively  
 * 
 * Core recursive spawning system inspired by flow-nexus architecture.
 * Integrates credit system, topology management, and agent lifecycle.
 * 
 * Features:
 * - Recursive agent spawning with depth limits
 * - Credit-based resource management
 * - 4 topology patterns (mesh/star/ring/hierarchical)
 * - Agent role specialization
 * - Swarm coordination and task orchestration
 * - Automatic failover and recovery
 */

import { EventEmitter } from 'events';
import { SubAgent, SubAgentConfig, spawnSubAgent } from './sub-agent';
import { CreditSystem, getCreditSystem, SpawnCost } from './credit-system';
import { TopologyManager, TopologyType, TopologyConfig, TopologyNode } from './topology-manager';
import { getMoltbook } from './moltbook';
import { memorize } from './cortex';

// ═══════════════════════════════════════════════════════════════
// TYPES & INTERFACES
// ═══════════════════════════════════════════════════════════════

export type AgentRole = 'coordinator' | 'researcher' | 'coder' | 'tester' | 'reviewer' | 'deployer' | 'monitor' | 'optimizer' | 'analyst' | 'specialist';

export interface SwarmConfig {
  name: string;
  goal: string;
  topology: TopologyType;
  maxAgents: number;
  maxDepth: number;
  
  // Agent configuration
  defaultModel: string;
  roleDistribution: Partial<Record<AgentRole, number>>;
  permissions: string[];
  
  // Spawning strategy
  spawnStrategy: 'immediate' | 'demand' | 'hierarchical' | 'parallel';
  taskDecomposition: boolean;
  autoScale: boolean;
  
  // Topology specific
  topologyConfig: Partial<TopologyConfig>;
  
  // Resource limits
  resourceLimits?: SubAgentConfig['resourceLimits'];
  
  // Communication
  messageRouting: 'direct' | 'broadcast' | 'hierarchical' | 'ring';
  
  // Lifecycle
  autoKillOnCompletion: boolean;
  keepAliveSeconds?: number;
}

export interface SpawnRequest {
  parentId?: string;
  role: AgentRole;
  goal: string;
  depth: number;
  model?: string;
  permissions?: string[];
  resourceLimits?: SubAgentConfig['resourceLimits'];
  metadata?: Record<string, any>;
}

export interface SwarmStatus {
  swarmId: string;
  name: string;
  status: 'initializing' | 'running' | 'scaling' | 'completing' | 'completed' | 'failed';
  agents: Array<{
    agentId: string;
    role: AgentRole;
    status: 'spawning' | 'running' | 'paused' | 'dead';
    depth: number;
    uptime: number;
    credits: number;
  }>;
  topology: {
    type: TopologyType;
    nodeCount: number;
    maxDepth: number;
    efficiency: number;
  };
  credits: {
    spent: number;
    remaining: number;
    emergencyMode: boolean;
  };
  performance: {
    tasksCompleted: number;
    totalUptime: number;
    avgResponseTime: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// RECURSIVE SPAWNER CLASS
// ═══════════════════════════════════════════════════════════════

export class RecursiveSpawner extends EventEmitter {
  private swarmId: string;
  private config: SwarmConfig;
  private creditSystem: CreditSystem;
  private topology: TopologyManager;
  private agents: Map<string, SubAgent>;
  private spawnQueue: SpawnRequest[];
  private status: SwarmStatus['status'] = 'initializing';
  private startTime: number;
  private completedTasks: number = 0;

  constructor(config: SwarmConfig) {
    super();
    
    this.swarmId = `swarm_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    this.config = config;
    this.agents = new Map();
    this.spawnQueue = [];
    this.startTime = Date.now();

    // Initialize credit system
    this.creditSystem = getCreditSystem({
      maxDepth: config.maxDepth,
      maxConcurrentAgents: config.maxAgents,
      emergencyThreshold: Math.max(10, Math.floor(config.maxAgents * 0.1))
    });

    // Initialize topology manager
    const topologyConfig: TopologyConfig = {
      type: config.topology,
      maxNodes: config.maxAgents,
      maxDepth: config.maxDepth,
      messageRouting: config.messageRouting,
      failoverStrategy: 'reconnect',
      ...config.topologyConfig
    };
    
    this.topology = new TopologyManager(topologyConfig);
    
    this.setupEventListeners();
    
    memorize(
      `RecursiveSpawner initialized: ${config.name} (${config.topology} topology, max ${config.maxAgents} agents)`,
      // @ts-expect-error - Post-Merge Reconciliation
      'system',
      `spawner:init:${this.swarmId}`
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // SWARM INITIALIZATION
  // ═══════════════════════════════════════════════════════════════

  async initializeSwarm(): Promise<void> {
    this.status = 'running';
    
    try {
      // Spawn initial coordinator agent
      await this.spawnInitialAgent();
      
      // Execute spawning strategy
      await this.executeSpawnStrategy();
      
      this.emit('swarmInitialized', this.getSwarmStatus());
      
      memorize(
        `Swarm initialized: ${this.config.name} with ${this.agents.size} agents`,
        'fact',
        `spawner:initialized:${this.swarmId}`
      );
      
    } catch (error: unknown) {
      this.status = 'failed';
      this.emit('swarmFailed', error);
      throw error;
    }
  }

  private async spawnInitialAgent(): Promise<void> {
    const initialRole: AgentRole = 'coordinator';
    
    await this.spawnAgent({
      role: initialRole,
      goal: `Coordinate swarm: ${this.config.goal}`,
      depth: 0,
      model: this.config.defaultModel,
      permissions: this.config.permissions,
      resourceLimits: this.config.resourceLimits
    });
  }

  private async executeSpawnStrategy(): Promise<void> {
    switch (this.config.spawnStrategy) {
      case 'immediate':
        await this.spawnAllAgentsImmediately();
        break;
      case 'demand':
        // Spawn on demand - handled by orchestrateTask
        break;
      case 'hierarchical':
        await this.spawnHierarchicalStructure();
        break;
      case 'parallel':
        await this.spawnParallelWorkers();
        break;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // AGENT SPAWNING
  // ═══════════════════════════════════════════════════════════════

  /**
   * Core recursive agent spawning method
   */
  async spawnAgent(request: SpawnRequest): Promise<SubAgent> {
    // Validate spawn request
    const validation = this.validateSpawnRequest(request);
    if (!validation.allowed) {
      throw new Error(`Spawn denied: ${validation.reason}`);
    }

    const cost = validation.cost!;
    
    try {
      // Spend credits
      this.creditSystem.spendCredits(`pending_${Date.now()}`, request.depth);
      
      // Create agent configuration
      const agentConfig: SubAgentConfig = {
        name: `${request.role}_${request.depth}_${Date.now()}`,
        model: request.model || this.config.defaultModel,
        goal: request.goal,
        permissions: request.permissions || this.config.permissions,
        resourceLimits: request.resourceLimits || this.config.resourceLimits,
        onOutput: (data) => this.handleAgentOutput(request, data),
        onError: (error) => this.handleAgentError(request, error)
      };

      // Spawn the sub-agent
      const agent = await spawnSubAgent(agentConfig);
      const agentId = agent.id;
      
      // Update credit tracking with real agent ID
      this.creditSystem.refundCredits(`pending_${Date.now()}`);
      this.creditSystem.spendCredits(agentId, request.depth);
      
      // Add to topology
      this.topology.addNode(agentId, request.role, request.depth, {
        parentId: request.parentId,
        model: agentConfig.model,
        goal: request.goal,
        spawnedBy: 'RecursiveSpawner',
        ...request.metadata
      });

      // Register agent
      this.agents.set(agentId, agent);
      
      // Setup agent event handlers
      this.setupAgentEventHandlers(agent, request);
      
      this.emit('agentSpawned', { 
        agentId, 
        role: request.role, 
        depth: request.depth, 
        cost: cost.totalCost 
      });

      memorize(
        `Agent spawned: ${request.role} at depth ${request.depth} (cost: ${cost.totalCost} credits)`,
        'fact',
        `spawner:spawn:${agentId}`
      );

      return agent;
      
    } catch (error: unknown) {
      // Refund credits on failure
      this.creditSystem.refundCredits(`pending_${Date.now()}`, true);
      throw error;
    }
  }

  /**
   * Validate if agent spawning is allowed
   */
  private validateSpawnRequest(request: SpawnRequest): {
    allowed: boolean;
    cost?: SpawnCost;
    reason?: string;
  } {
    // Check credit system
    const creditCheck = this.creditSystem.canSpawn(request.depth);
    if (!creditCheck.allowed) {
      return { allowed: false, reason: creditCheck.reason };
    }

    // Check topology limits
    if (this.agents.size >= this.config.maxAgents) {
      return { allowed: false, reason: `Maximum agents (${this.config.maxAgents}) reached` };
    }

    if (request.depth > this.config.maxDepth) {
      return { allowed: false, reason: `Depth ${request.depth} exceeds maximum ${this.config.maxDepth}` };
    }

    // Check role distribution
    const roleCount = this.countAgentsByRole();
    const maxForRole = this.config.roleDistribution[request.role];
    if (maxForRole && roleCount[request.role] >= maxForRole) {
      return { 
        allowed: false, 
        reason: `Maximum ${request.role} agents (${maxForRole}) reached` 
      };
    }

    return { allowed: true, cost: creditCheck.cost };
  }

  // ═══════════════════════════════════════════════════════════════
  // SPAWNING STRATEGIES
  // ═══════════════════════════════════════════════════════════════

  private async spawnAllAgentsImmediately(): Promise<void> {
    const roles: AgentRole[] = ['researcher', 'coder', 'tester'];
    const promises: Promise<SubAgent>[] = [];

    for (let i = 0; i < Math.min(this.config.maxAgents - 1, 5); i++) {
      const role = roles[i % roles.length];
      promises.push(this.spawnAgent({
        role,
        goal: `${role} for: ${this.config.goal}`,
        depth: 1,
        parentId: Array.from(this.agents.keys())[0] // First agent is coordinator
      }));
    }

    await Promise.all(promises);
  }

  private async spawnHierarchicalStructure(): Promise<void> {
    const coordinatorId = Array.from(this.agents.keys())[0];
    
    // Level 1: Team leads
    const teamLeads = ['researcher', 'coder', 'tester'] as AgentRole[];
    for (const role of teamLeads) {
      await this.spawnAgent({
        role,
        goal: `Lead ${role} team for: ${this.config.goal}`,
        depth: 1,
        parentId: coordinatorId
      });
    }

    // Level 2: Workers under each team lead
    const currentAgents = Array.from(this.agents.values());
    for (const lead of currentAgents.slice(1)) { // Skip coordinator
      const leadNode = this.topology.getNode(lead.id);
      if (leadNode && leadNode.role !== 'coordinator') {
        await this.spawnAgent({
          role: 'specialist',
          goal: `Support ${leadNode.role} team for: ${this.config.goal}`,
          depth: 2,
          parentId: lead.id
        });
      }
    }
  }

  private async spawnParallelWorkers(): Promise<void> {
    const coordinatorId = Array.from(this.agents.keys())[0];
    const workerCount = Math.min(this.config.maxAgents - 1, 6);
    
    const promises: Promise<SubAgent>[] = [];
    for (let i = 0; i < workerCount; i++) {
      promises.push(this.spawnAgent({
        role: 'specialist',
        goal: `Worker ${i + 1} for: ${this.config.goal}`,
        depth: 1,
        parentId: coordinatorId
      }));
    }

    await Promise.all(promises);
  }

  // ═══════════════════════════════════════════════════════════════
  // TASK ORCHESTRATION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Orchestrate a complex task across the swarm
   */
  async orchestrateTask(task: string, strategy: 'parallel' | 'sequential' | 'hierarchical' = 'parallel'): Promise<void> {
    memorize(
      `Task orchestration started: ${task} (${strategy} strategy)`,
      'fact',
      `spawner:task:${this.swarmId}:${Date.now()}`
    );

    try {
      switch (strategy) {
        case 'parallel':
          await this.orchestrateParallelTask(task);
          break;
        case 'sequential':
          await this.orchestrateSequentialTask(task);
          break;
        case 'hierarchical':
          await this.orchestrateHierarchicalTask(task);
          break;
      }

      this.completedTasks++;
      this.emit('taskCompleted', { task, strategy, agents: this.agents.size });

    } catch (error: unknown) {
      this.emit('taskFailed', { task, error });
      throw error;
    }
  }

  private async orchestrateParallelTask(task: string): Promise<void> {
    const activeAgents = Array.from(this.agents.values()).filter(a => a.running);
    
    // Broadcast task to all active agents
    const moltbook = getMoltbook();
    for (const agent of activeAgents) {
      moltbook.sendMessage({
        type: 'direct',
        to: agent.id,
        content: `TASK: ${task}`,
        from: this.swarmId
      });
    }
  }

  private async orchestrateSequentialTask(task: string): Promise<void> {
    const roles: AgentRole[] = ['researcher', 'coder', 'tester', 'reviewer', 'deployer'];
    
    for (const role of roles) {
      const agent = this.findAgentByRole(role);
      if (agent) {
        const moltbook = getMoltbook();
        moltbook.sendMessage({
          type: 'direct',
          to: agent.id,
          content: `TASK: ${task} (${role} phase)`,
          from: this.swarmId
        });
        
        // Wait for completion (simplified)
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  private async orchestrateHierarchicalTask(task: string): Promise<void> {
    // Send to coordinator first
    const coordinator = this.findAgentByRole('coordinator');
    if (coordinator) {
      const moltbook = getMoltbook();
      moltbook.sendMessage({
        type: 'direct',
        to: coordinator.id,
        content: `COORDINATE: ${task}`,
        from: this.swarmId
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // RECURSIVE SPAWN TRIGGERS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Allow agents to spawn child agents recursively
   */
  async handleAgentSpawnRequest(parentAgentId: string, spawnRequest: Omit<SpawnRequest, 'parentId' | 'depth'>): Promise<SubAgent> {
    const parentAgent = this.agents.get(parentAgentId);
    if (!parentAgent) {
      throw new Error(`Parent agent ${parentAgentId} not found`);
    }

    const parentNode = this.topology.getNode(parentAgentId);
    const newDepth = (parentNode?.depth || 0) + 1;

    return this.spawnAgent({
      ...spawnRequest,
      parentId: parentAgentId,
      depth: newDepth
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // EVENT HANDLERS
  // ═══════════════════════════════════════════════════════════════

  private setupEventListeners(): void {
    // Credit system events
    this.creditSystem.on('emergencyMode', (data) => {
      if (data.entered) {
        this.handleEmergencyMode();
      }
    });

    // Topology events
    this.topology.on('nodeRemoved', (data) => {
      this.handleNodeRemoval(data.agentId);
    });
  }

  private setupAgentEventHandlers(agent: SubAgent, request: SpawnRequest): void {
    agent.on('exit', (code, signal) => {
      this.handleAgentExit(agent.id, code, signal);
    });

    agent.on('processError', (error) => {
      this.handleAgentError(request, error.toString());
    });
  }

  private handleAgentOutput(request: SpawnRequest, data: string): void {
    // Parse for recursive spawn requests
    try {
      if (data.includes('SPAWN_REQUEST:')) {
        const spawnData = JSON.parse(data.split('SPAWN_REQUEST:')[1]);
        this.handleAgentSpawnRequest(request.parentId!, spawnData).catch(console.error);
      }
    } catch (error: unknown) {
      // Ignore parsing errors
    }

    this.emit('agentOutput', { role: request.role, depth: request.depth, data });
  }

  private handleAgentError(request: SpawnRequest, error: string): void {
    this.emit('agentError', { role: request.role, depth: request.depth, error });
  }

  private handleAgentExit(agentId: string, code: number | null, signal: string | null): void {
    // Refund credits
    const refund = this.creditSystem.refundCredits(agentId, code !== 0);
    
    // Remove from topology
    this.topology.removeNode(agentId);
    
    // Remove from agents map
    this.agents.delete(agentId);

    memorize(
      `Agent exited: ${agentId} (code: ${code}, signal: ${signal}, refund: ${refund})`,
      'fact',
      `spawner:exit:${agentId}`
    );

    // Check if swarm completed
    if (this.agents.size === 0) {
      this.handleSwarmCompletion();
    }
  }

  private handleEmergencyMode(): void {
    memorize(
      `Emergency mode activated in swarm ${this.swarmId}`,
      // @ts-expect-error - Post-Merge Reconciliation
      'alert',
      `spawner:emergency:${this.swarmId}`
    );
    
    this.emit('emergencyMode', this.getSwarmStatus());
  }

  private handleNodeRemoval(agentId: string): void {
    // Handle topology reorganization if needed
    const stats = this.topology.getTopologyStats();
    if (stats.efficiency < 0.5 && this.agents.size > 2) {
      this.emit('topologyReorganization', { efficiency: stats.efficiency });
    }
  }

  private handleSwarmCompletion(): void {
    this.status = 'completed';
    this.emit('swarmCompleted', this.getSwarmStatus());
    
    memorize(
      `Swarm completed: ${this.config.name} (${this.completedTasks} tasks, ${Date.now() - this.startTime}ms uptime)`,
      'fact',
      `spawner:completed:${this.swarmId}`
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════

  private countAgentsByRole(): Record<AgentRole, number> {
    const counts: Record<AgentRole, number> = {
      coordinator: 0, researcher: 0, coder: 0, tester: 0, reviewer: 0,
      deployer: 0, monitor: 0, optimizer: 0, analyst: 0, specialist: 0
    };

    for (const agent of this.agents.values()) {
      const node = this.topology.getNode(agent.id);
      if (node) {
        const role = node.role as AgentRole;
        counts[role] = (counts[role] || 0) + 1;
      }
    }

    return counts;
  }

  private findAgentByRole(role: AgentRole): SubAgent | undefined {
    for (const agent of this.agents.values()) {
      const node = this.topology.getNode(agent.id);
      if (node?.role === role) {
        return agent;
      }
    }
    return undefined;
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════

  getSwarmStatus(): SwarmStatus {
    const topologyStats = this.topology.getTopologyStats();
    const creditStatus = this.creditSystem.getStatus();

    return {
      swarmId: this.swarmId,
      name: this.config.name,
      status: this.status,
      agents: Array.from(this.agents.entries()).map(([agentId, agent]) => {
        const node = this.topology.getNode(agentId);
        const agentData = this.creditSystem.getActiveAgents().find(a => a.agentId === agentId);
        return {
          agentId,
          role: (node?.role || 'unknown') as AgentRole,
          status: agent.status as any,
          depth: node?.depth || 0,
          uptime: agentData?.uptime || 0,
          credits: agentData?.cost || 0
        };
      }),
      topology: {
        type: this.config.topology,
        nodeCount: topologyStats.nodeCount,
        maxDepth: topologyStats.maxDepth,
        efficiency: topologyStats.efficiency
      },
      credits: {
        spent: creditStatus.maxCredits - creditStatus.credits,
        remaining: creditStatus.credits,
        emergencyMode: creditStatus.emergencyMode
      },
      performance: {
        tasksCompleted: this.completedTasks,
        totalUptime: Date.now() - this.startTime,
        avgResponseTime: 0 // TODO: Implement
      }
    };
  }

  async killSwarm(reason = 'MANUAL'): Promise<void> {
    this.status = 'completing';
    
    // Kill all agents
    const killPromises = Array.from(this.agents.values()).map(agent => agent.kill(reason));
    await Promise.all(killPromises);
    
    // Cleanup
    this.topology.destroy();
    
    this.emit('swarmKilled', { reason, status: this.getSwarmStatus() });
  }

  destroy(): void {
    this.killSwarm('SHUTDOWN').then(() => {
      this.removeAllListeners();
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

export async function createSwarm(config: SwarmConfig): Promise<RecursiveSpawner> {
  const spawner = new RecursiveSpawner(config);
  await spawner.initializeSwarm();
  return spawner;
}

export function createMeshSwarm(name: string, goal: string, maxAgents = 10): Promise<RecursiveSpawner> {
  return createSwarm({
    name,
    goal,
    topology: 'mesh',
    maxAgents,
    maxDepth: 3,
    defaultModel: 'claude-sonnet',
    roleDistribution: {},
    permissions: ['read', 'write', 'execute'],
    spawnStrategy: 'parallel',
    taskDecomposition: true,
    autoScale: true,
    topologyConfig: { maxConnections: maxAgents },
    messageRouting: 'broadcast',
    autoKillOnCompletion: true
  });
}

export function createHierarchicalSwarm(name: string, goal: string, maxAgents = 15): Promise<RecursiveSpawner> {
  return createSwarm({
    name,
    goal,
    topology: 'hierarchical',
    maxAgents,
    maxDepth: 4,
    defaultModel: 'claude-sonnet',
    roleDistribution: { coordinator: 1, researcher: 3, coder: 5, tester: 3, reviewer: 2 },
    permissions: ['read', 'write', 'execute'],
    spawnStrategy: 'hierarchical',
    taskDecomposition: true,
    autoScale: true,
    topologyConfig: { branchingFactor: 3 },
    messageRouting: 'hierarchical',
    autoKillOnCompletion: true
  });
}