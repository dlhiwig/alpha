/**
 * 🌊 Claude-Flow Integration Adapter for SuperClaw AgentBus
 * 
 * Wraps claude-flow's MCP server and coordination patterns into SuperClaw's skynet architecture.
 * Provides hierarchical coordination, consensus algorithms, and anti-drift mechanisms.
 * 
 * Key Features:
 * - MCP server integration with SuperClaw agents
 * - Swarm coordination with hierarchical and mesh topologies
 * - Consensus algorithms: Raft, Byzantine, CRDT
 * - Real-time WebSocket coordination
 * - Anti-drift mechanisms and 3-tier model routing
 * - 60+ agent specialization patterns
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';

// ═══════════════════════════════════════════════════════════════
// CLAUDE-FLOW INTEGRATION TYPES
// ═══════════════════════════════════════════════════════════════

export type AgentSpecialization = 
  // Core Development
  | 'coder' | 'architect' | 'refactor-specialist' | 'code-reviewer' | 'debugger'
  | 'security-auditor' | 'performance-optimizer' | 'documentation-writer'
  // Testing & Quality
  | 'unit-tester' | 'integration-tester' | 'e2e-tester' | 'load-tester' 
  | 'security-tester' | 'accessibility-tester' | 'ui-tester' | 'api-tester'
  // DevOps & Infrastructure
  | 'deployer' | 'ci-cd-specialist' | 'infrastructure-engineer' | 'monitoring-specialist'
  | 'backup-specialist' | 'disaster-recovery' | 'container-specialist' | 'kubernetes-specialist'
  // Data & Analytics
  | 'data-engineer' | 'ml-engineer' | 'data-analyst' | 'etl-specialist'
  | 'database-admin' | 'data-scientist' | 'bi-analyst' | 'metrics-collector'
  // Design & UX
  | 'ui-designer' | 'ux-designer' | 'graphic-designer' | 'brand-specialist'
  | 'accessibility-designer' | 'interaction-designer' | 'visual-designer'
  // Product & Management
  | 'product-manager' | 'project-manager' | 'requirements-analyst' | 'stakeholder-liaison'
  | 'scrum-master' | 'agile-coach' | 'risk-analyst' | 'compliance-officer'
  // Specialized Domains
  | 'blockchain-developer' | 'game-developer' | 'mobile-developer' | 'embedded-developer'
  | 'ai-researcher' | 'nlp-specialist' | 'computer-vision' | 'robotics-engineer'
  // Operations & Support
  | 'sre' | 'incident-responder' | 'user-support' | 'training-specialist'
  | 'technical-writer' | 'community-manager' | 'evangelist' | 'consultant'
  // Coordination & Oversight
  | 'coordinator' | 'orchestrator' | 'supervisor' | 'validator' | 'synthesizer';

export type SwarmTopology = 'hierarchical' | 'mesh' | 'simple' | 'adaptive';
export type ConsensusAlgorithm = 'raft' | 'byzantine' | 'crdt' | 'simple-majority';
export type ModelTier = 'local' | 'efficient' | 'advanced';

export interface ClaudeFlowAgent {
  id: string;
  name: string;
  model: string;
  goal: string;
  status: 'idle' | 'running' | 'paused' | 'dead';
  spawnTime: number;
  lastActivity: number;
  messageCount: number;
  permissions: string[];
  specialization: AgentSpecialization;
  tier: ModelTier;
  capabilities: string[];
  performance: {
    tasksCompleted: number;
    successRate: number;
    avgExecutionTime: number;
    driftScore: number; // Anti-drift metric
  };
  coordination: {
    topology: SwarmTopology;
    parentId?: string;
    childIds: string[];
    peerIds: string[];
  };
}

export interface SwarmConfig {
  topology: SwarmTopology;
  maxAgents: number;
  consensusAlgorithm: ConsensusAlgorithm;
  antiDriftThreshold: number;
  modelRouting: {
    local: string[];    // Local model capabilities
    efficient: string[]; // Mid-tier model capabilities  
    advanced: string[];  // High-tier model capabilities
  };
}

export interface ConsensusDecision {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  requiredVotes?: number;
  timeoutMs?: number;
}

export interface ConsensusResult {
  decision: unknown;
  votes: Array<{ agentId: string; vote: unknown; timestamp: number }>;
  consensusReached: boolean;
  algorithm: ConsensusAlgorithm;
  confidence: number;
}

export interface TaskCoordinationResult {
  taskId: string;
  assignedAgents: string[];
  executionOrder: string[];
  dependencies: Record<string, string[]>;
  estimatedDuration: number;
}

// ═══════════════════════════════════════════════════════════════
// MCP SERVER INTEGRATION
// ═══════════════════════════════════════════════════════════════

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(params: Record<string, unknown>): Promise<unknown>;
}

export interface MCPRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface MCPResponse {
  id: string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

export class ClaudeFlowMCPServer {
  private tools: Map<string, MCPTool> = new Map();
  private eventBus: EventEmitter;
  private running = false;
  
  constructor(eventBus: EventEmitter) {
    this.eventBus = eventBus;
    this.setupDefaultTools();
  }
  
  private setupDefaultTools(): void {
    // Agent Management Tools
    this.registerTool({
      name: 'spawn_agent',
      description: 'Spawn a new specialized agent',
      inputSchema: {
        type: 'object',
        properties: {
          specialization: { type: 'string' },
          tier: { type: 'string' },
          config: { type: 'object' }
        },
        required: ['specialization']
      },
      execute: async (params) => {
        this.eventBus.emit('mcp:spawn_agent', params);
        return { success: true, agentId: crypto.randomUUID() };
      }
    });
    
    // Coordination Tools
    this.registerTool({
      name: 'coordinate_task',
      description: 'Coordinate task execution across agents',
      inputSchema: {
        type: 'object',
        properties: {
          task: { type: 'object' },
          topology: { type: 'string' },
          agentIds: { type: 'array' }
        },
        required: ['task']
      },
      execute: async (params) => {
        this.eventBus.emit('mcp:coordinate_task', params);
        return { success: true, coordinationId: crypto.randomUUID() };
      }
    });
    
    // Consensus Tools
    this.registerTool({
      name: 'reach_consensus',
      description: 'Reach consensus among agents using specified algorithm',
      inputSchema: {
        type: 'object',
        properties: {
          decision: { type: 'object' },
          algorithm: { type: 'string' },
          agentIds: { type: 'array' }
        },
        required: ['decision', 'agentIds']
      },
      execute: async (params) => {
        this.eventBus.emit('mcp:reach_consensus', params);
        return { success: true, consensusId: crypto.randomUUID() };
      }
    });
  }
  
  registerTool(tool: MCPTool): void {
    this.tools.set(tool.name, tool);
  }
  
  async handleRequest(request: MCPRequest): Promise<MCPResponse> {
    const tool = this.tools.get(request.method);
    if (!tool) {
      return {
        id: request.id,
        error: { code: -32601, message: `Method not found: ${request.method}` }
      };
    }
    
    try {
      const result = await tool.execute(request.params);
      return { id: request.id, result };
    } catch (error: unknown) {
      return {
        id: request.id,
        error: { 
          code: -32603, 
          message: error instanceof Error ? (error as Error).message : 'Internal error' 
        }
      };
    }
  }
  
  listTools(): MCPTool[] {
    return Array.from(this.tools.values());
  }
  
  async start(): Promise<void> {
    this.running = true;
  }
  
  async stop(): Promise<void> {
    this.running = false;
  }
}

// ═══════════════════════════════════════════════════════════════
// SWARM COORDINATION ENGINE
// ═══════════════════════════════════════════════════════════════

export class SwarmCoordinator {
  private agents: Map<string, ClaudeFlowAgent> = new Map();
  private eventBus: EventEmitter;
  private wsServer?: WebSocketServer;
  private connections: Map<string, WebSocket> = new Map();
  private config: SwarmConfig;
  private driftDetector: DriftDetector;
  
  constructor(eventBus: EventEmitter, config: SwarmConfig) {
    this.eventBus = eventBus;
    this.config = config;
    this.driftDetector = new DriftDetector(config.antiDriftThreshold);
    this.setupEventHandlers();
  }
  
  private setupEventHandlers(): void {
    this.eventBus.on('mcp:spawn_agent', (params) => this.handleSpawnAgent(params));
    this.eventBus.on('mcp:coordinate_task', (params) => this.handleCoordinateTask(params));
    this.eventBus.on('mcp:reach_consensus', (params) => this.handleReachConsensus(params));
  }
  
  async startWebSocketServer(port: number = 8080): Promise<void> {
    this.wsServer = new WebSocketServer({ port });
    
    this.wsServer.on('connection', (ws, req) => {
      const agentId = req.url?.split('?agentId=')[1];
      if (agentId) {
        this.connections.set(agentId, ws);
        
        ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            this.handleWebSocketMessage(agentId, message);
          } catch (error: unknown) {
            console.error('WebSocket message parse error:', error);
          }
        });
        
        ws.on('close', () => {
          this.connections.delete(agentId);
        });
      }
    });
  }
  
  private handleWebSocketMessage(agentId: string, message: any): void {
    // Real-time coordination message handling
    switch (message.type) {
      case 'task_update':
        this.updateTaskStatus(agentId, message.taskId, message.status);
        break;
      case 'drift_report':
        this.driftDetector.recordDrift(agentId, message.driftScore);
        break;
      case 'coordination_request':
        this.handleCoordinationRequest(agentId, message);
        break;
    }
  }
  
  private async handleSpawnAgent(params: any): Promise<void> {
    const agent: ClaudeFlowAgent = {
      id: crypto.randomUUID(),
      name: `${params.specialization}-${Date.now()}`,
      model: this.selectModelTier(params.specialization),
      goal: `Specialized ${params.specialization} agent`,
      status: 'idle',
      spawnTime: Date.now(),
      lastActivity: Date.now(),
      messageCount: 0,
      permissions: this.getSpecializationPermissions(params.specialization),
      specialization: params.specialization,
      tier: params.tier || this.inferModelTier(params.specialization),
      capabilities: this.getSpecializationCapabilities(params.specialization),
      performance: {
        tasksCompleted: 0,
        successRate: 1.0,
        avgExecutionTime: 0,
        driftScore: 0
      },
      coordination: {
        topology: this.config.topology,
        childIds: [],
        peerIds: []
      }
    };
    
    this.agents.set(agent.id, agent);
    this.updateTopology(agent);
    
    this.eventBus.emit('agent:spawned', { agent });
  }
  
  private async handleCoordinateTask(params: any): Promise<TaskCoordinationResult> {
    const task = params.task;
    const suitableAgents = this.findSuitableAgents(task.type || task.specialization);
    
    // Apply anti-drift mechanism
    const validAgents = suitableAgents.filter(agent => 
      agent.performance.driftScore < this.config.antiDriftThreshold
    );
    
    // Determine execution order based on dependencies
    const executionOrder = this.calculateExecutionOrder(validAgents, task);
    
    const result: TaskCoordinationResult = {
      taskId: task.id || crypto.randomUUID(),
      assignedAgents: validAgents.map(a => a.id),
      executionOrder,
      dependencies: this.analyzeDependencies(task),
      estimatedDuration: this.estimateDuration(validAgents, task)
    };
    
    // Broadcast coordination plan via WebSocket
    this.broadcastCoordination(result);
    
    return result;
  }
  
  private async handleReachConsensus(params: any): Promise<ConsensusResult> {
    const { decision, algorithm, agentIds } = params;
    
    switch (algorithm || this.config.consensusAlgorithm) {
      case 'raft':
        return await this.raftConsensus(decision, agentIds);
      case 'byzantine':
        return await this.byzantineConsensus(decision, agentIds);
      case 'crdt':
        return await this.crdtConsensus(decision, agentIds);
      default:
        return await this.simpleMajorityConsensus(decision, agentIds);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // CONSENSUS ALGORITHMS
  // ═══════════════════════════════════════════════════════════════
  
  private async raftConsensus(decision: ConsensusDecision, agentIds: string[]): Promise<ConsensusResult> {
    // Simplified Raft implementation for agent coordination
    const leader = this.selectLeader(agentIds);
    const votes: Array<{ agentId: string; vote: unknown; timestamp: number }> = [];
    
    // Leader proposes
    votes.push({
      agentId: leader.id,
      vote: 'approve',
      timestamp: Date.now()
    });
    
    // Collect follower votes
    for (const agentId of agentIds.filter(id => id !== leader.id)) {
      const agent = this.agents.get(agentId);
      if (agent) {
        // Simulate vote based on agent's track record
        const vote = agent.performance.successRate > 0.7 ? 'approve' : 'reject';
        votes.push({
          agentId,
          vote,
          timestamp: Date.now()
        });
      }
    }
    
    const approvals = votes.filter(v => v.vote === 'approve').length;
    const majority = Math.floor(agentIds.length / 2) + 1;
    
    return {
      decision: approvals >= majority ? decision.payload : null,
      votes,
      consensusReached: approvals >= majority,
      algorithm: 'raft',
      confidence: approvals / agentIds.length
    };
  }
  
  private async byzantineConsensus(decision: ConsensusDecision, agentIds: string[]): Promise<ConsensusResult> {
    // Byzantine Fault Tolerant consensus for unreliable agents
    const votes: Array<{ agentId: string; vote: unknown; timestamp: number }> = [];
    
    for (const agentId of agentIds) {
      const agent = this.agents.get(agentId);
      if (agent) {
        // Consider drift score and success rate for Byzantine tolerance
        const isFaulty = agent.performance.driftScore > this.config.antiDriftThreshold ||
                        agent.performance.successRate < 0.5;
        
        const vote = isFaulty ? 
          (Math.random() > 0.5 ? 'approve' : 'reject') : // Faulty agent random vote
          (agent.performance.successRate > 0.8 ? 'approve' : 'reject');
        
        votes.push({
          agentId,
          vote,
          timestamp: Date.now()
        });
      }
    }
    
    const reliableVotes = votes.filter(v => {
      const agent = this.agents.get(v.agentId);
      return agent && agent.performance.driftScore < this.config.antiDriftThreshold;
    });
    
    const approvals = reliableVotes.filter(v => v.vote === 'approve').length;
    const requiredApprovals = Math.floor(2 * reliableVotes.length / 3) + 1;
    
    return {
      decision: approvals >= requiredApprovals ? decision.payload : null,
      votes,
      consensusReached: approvals >= requiredApprovals,
      algorithm: 'byzantine',
      confidence: approvals / reliableVotes.length
    };
  }
  
  private async crdtConsensus(decision: ConsensusDecision, agentIds: string[]): Promise<ConsensusResult> {
    // Conflict-free Replicated Data Type consensus for eventual consistency
    const votes: Array<{ agentId: string; vote: unknown; timestamp: number }> = [];
    
    // In CRDT, we merge all agent inputs and resolve conflicts
    for (const agentId of agentIds) {
      const agent = this.agents.get(agentId);
      if (agent) {
        // Each agent contributes its "view" of the decision
        const vote = {
          ...decision.payload,
          agentId,
          weight: agent.performance.successRate,
          timestamp: Date.now()
        };
        
        votes.push({
          agentId,
          vote,
          timestamp: Date.now()
        });
      }
    }
    
    // Merge votes using last-writer-wins with weights
    const mergedDecision = this.mergeVotes(votes);
    
    return {
      decision: mergedDecision,
      votes,
      consensusReached: true, // CRDT always reaches consensus
      algorithm: 'crdt',
      confidence: 1.0
    };
  }
  
  private async simpleMajorityConsensus(decision: ConsensusDecision, agentIds: string[]): Promise<ConsensusResult> {
    const votes: Array<{ agentId: string; vote: unknown; timestamp: number }> = [];
    
    for (const agentId of agentIds) {
      const agent = this.agents.get(agentId);
      if (agent) {
        const vote = agent.performance.successRate > 0.6 ? 'approve' : 'reject';
        votes.push({
          agentId,
          vote,
          timestamp: Date.now()
        });
      }
    }
    
    const approvals = votes.filter(v => v.vote === 'approve').length;
    const majority = Math.floor(agentIds.length / 2) + 1;
    
    return {
      decision: approvals >= majority ? decision.payload : null,
      votes,
      consensusReached: approvals >= majority,
      algorithm: 'simple-majority',
      confidence: approvals / agentIds.length
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // HELPER METHODS
  // ═══════════════════════════════════════════════════════════════
  
  private selectModelTier(specialization: AgentSpecialization): string {
    const { local, efficient, advanced } = this.config.modelRouting;
    
    if (local.includes(specialization)) return 'dolphin-llama3:8b';
    if (efficient.includes(specialization)) return 'claude-sonnet';
    return 'claude-opus'; // Advanced tier
  }
  
  private inferModelTier(specialization: AgentSpecialization): ModelTier {
    const simpleTasks = ['documentation-writer', 'technical-writer', 'user-support'];
    const complexTasks = ['architect', 'security-auditor', 'ai-researcher', 'ml-engineer'];
    
    if (simpleTasks.includes(specialization)) return 'local';
    if (complexTasks.includes(specialization)) return 'advanced';
    return 'efficient';
  }
  
  private getSpecializationCapabilities(specialization: AgentSpecialization): string[] {
    const capabilityMap: Record<string, string[]> = {
      'coder': ['code', 'debug', 'refactor'],
      'architect': ['design', 'system-analysis', 'technical-leadership'],
      'tester': ['test', 'qa', 'validation'],
      'security-auditor': ['security', 'audit', 'vulnerability-analysis'],
      'deployer': ['deployment', 'ci-cd', 'infrastructure'],
      'data-engineer': ['etl', 'data-processing', 'pipeline-management'],
      'ui-designer': ['ui-design', 'user-experience', 'prototyping'],
      'coordinator': ['coordination', 'project-management', 'communication']
      // Add more mappings as needed
    };
    
    return capabilityMap[specialization] || [specialization.replace('-', '_')];
  }
  
  private getSpecializationPermissions(specialization: AgentSpecialization): string[] {
    // Define permissions based on specialization
    const basePermissions = ['read:memory', 'write:logs'];
    
    if (['deployer', 'infrastructure-engineer'].includes(specialization)) {
      basePermissions.push('execute:deployment', 'manage:infrastructure');
    }
    
    if (['security-auditor', 'security-tester'].includes(specialization)) {
      basePermissions.push('audit:security', 'scan:vulnerabilities');
    }
    
    return basePermissions;
  }
  
  private updateTopology(agent: ClaudeFlowAgent): void {
    if (this.config.topology === 'hierarchical') {
      const leader = Array.from(this.agents.values()).find(a => a.coordination.parentId === undefined);
      if (leader && agent.id !== leader.id) {
        agent.coordination.parentId = leader.id;
        leader.coordination.childIds.push(agent.id);
      }
    } else if (this.config.topology === 'mesh') {
      // Connect to all existing agents
      for (const existingAgent of Array.from(this.agents.values())) {
        if (existingAgent.id !== agent.id) {
          agent.coordination.peerIds.push(existingAgent.id);
          existingAgent.coordination.peerIds.push(agent.id);
        }
      }
    }
  }
  
  private findSuitableAgents(taskType: string): ClaudeFlowAgent[] {
    return Array.from(this.agents.values()).filter(agent => 
      agent.capabilities.includes(taskType) ||
      agent.specialization.includes(taskType as any)
    );
  }
  
  private calculateExecutionOrder(agents: ClaudeFlowAgent[], task: any): string[] {
    // Simple ordering based on specialization hierarchy
    const order: string[] = [];
    
    // Prioritize architects and coordinators first
    const architects = agents.filter(a => a.specialization === 'architect');
    const coordinators = agents.filter(a => a.specialization === 'coordinator');
    
    order.push(...architects.map(a => a.id));
    order.push(...coordinators.map(a => a.id));
    
    // Add remaining agents
    const remaining = agents.filter(a => 
      !architects.includes(a) && !coordinators.includes(a)
    );
    order.push(...remaining.map(a => a.id));
    
    return order;
  }
  
  private analyzeDependencies(task: any): Record<string, string[]> {
    // Simple dependency analysis - can be enhanced
    return task.dependencies || {};
  }
  
  private estimateDuration(agents: ClaudeFlowAgent[], task: any): number {
    if (agents.length === 0) return 0;
    
    const avgExecutionTime = agents.reduce((sum, agent) => 
      sum + agent.performance.avgExecutionTime, 0) / agents.length;
    
    return avgExecutionTime * (task.complexity || 1);
  }
  
  private selectLeader(agentIds: string[]): ClaudeFlowAgent {
    const candidates = agentIds
      .map(id => this.agents.get(id))
      .filter(Boolean) as ClaudeFlowAgent[];
    
    // Select agent with highest success rate and lowest drift
    return candidates.reduce((best, current) => {
      const bestScore = best.performance.successRate - best.performance.driftScore;
      const currentScore = current.performance.successRate - current.performance.driftScore;
      return currentScore > bestScore ? current : best;
    });
  }
  
  private mergeVotes(votes: Array<{ agentId: string; vote: unknown; timestamp: number }>): unknown {
    // Simple CRDT merge - last writer wins with weight consideration
    return votes.reduce((merged, vote) => {
      const agent = this.agents.get(vote.agentId);
      if (agent && typeof vote.vote === 'object') {
        return { ...merged, ...vote.vote };
      }
      return merged;
    }, {});
  }
  
  private broadcastCoordination(result: TaskCoordinationResult): void {
    const message = JSON.stringify({
      type: 'coordination_update',
      result,
      timestamp: Date.now()
    });
    
    for (const [agentId, ws] of Array.from(this.connections.entries())) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    }
  }
  
  private updateTaskStatus(agentId: string, taskId: string, status: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      // Update performance metrics
      if (status === 'completed') {
        agent.performance.tasksCompleted++;
      }
      
      agent.lastActivity = Date.now();
      
      // Broadcast status update
      this.eventBus.emit('task:status_updated', { agentId, taskId, status });
    }
  }
  
  private handleCoordinationRequest(agentId: string, message: any): void {
    // Handle real-time coordination requests
    this.eventBus.emit('coordination:request', { agentId, ...message });
  }
  
  // Public API
  getAgent(agentId: string): ClaudeFlowAgent | undefined {
    return this.agents.get(agentId);
  }
  
  listAgents(): ClaudeFlowAgent[] {
    return Array.from(this.agents.values());
  }
  
  getSwarmStatus(): {
    agentCount: number;
    topology: SwarmTopology;
    activeConnections: number;
    averageDrift: number;
  } {
    const agents = this.listAgents();
    const avgDrift = agents.length > 0 ? 
      agents.reduce((sum, a) => sum + a.performance.driftScore, 0) / agents.length : 0;
    
    return {
      agentCount: agents.length,
      topology: this.config.topology,
      activeConnections: this.connections.size,
      averageDrift: avgDrift
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// ANTI-DRIFT DETECTION
// ═══════════════════════════════════════════════════════════════

export class DriftDetector {
  private threshold: number;
  private driftHistory: Map<string, number[]> = new Map();
  
  constructor(threshold: number) {
    this.threshold = threshold;
  }
  
  recordDrift(agentId: string, driftScore: number): void {
    const history = this.driftHistory.get(agentId) || [];
    history.push(driftScore);
    
    // Keep only last 10 measurements
    if (history.length > 10) {
      history.shift();
    }
    
    this.driftHistory.set(agentId, history);
  }
  
  getDriftScore(agentId: string): number {
    const history = this.driftHistory.get(agentId) || [];
    if (history.length === 0) return 0;
    
    // Return average drift over recent history
    return history.reduce((sum, score) => sum + score, 0) / history.length;
  }
  
  isDrifting(agentId: string): boolean {
    return this.getDriftScore(agentId) > this.threshold;
  }
  
  getAgentsWithDrift(): string[] {
    const drifting: string[] = [];
    
    for (const [agentId] of Array.from(this.driftHistory.keys()).map(k => [k])) {
      if (this.isDrifting(agentId)) {
        drifting.push(agentId);
      }
    }
    
    return drifting;
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN INTEGRATION CLASS
// ═══════════════════════════════════════════════════════════════

export class ClaudeFlowAdapter {
  private mcpServer: ClaudeFlowMCPServer;
  private swarmCoordinator: SwarmCoordinator;
  private eventBus: EventEmitter;
  
  constructor(config?: Partial<SwarmConfig>) {
    this.eventBus = new EventEmitter();
    
    const defaultConfig: SwarmConfig = {
      topology: 'hierarchical',
      maxAgents: 50,
      consensusAlgorithm: 'raft',
      antiDriftThreshold: 0.3,
      modelRouting: {
        local: ['documentation-writer', 'technical-writer', 'user-support'],
        efficient: ['coder', 'tester', 'reviewer', 'designer'],
        advanced: ['architect', 'security-auditor', 'ai-researcher', 'coordinator']
      }
    };
    
    const finalConfig = { ...defaultConfig, ...config };
    
    this.mcpServer = new ClaudeFlowMCPServer(this.eventBus);
    this.swarmCoordinator = new SwarmCoordinator(this.eventBus, finalConfig);
  }
  
  async start(options: { mcpPort?: number; wsPort?: number } = {}): Promise<void> {
    await this.mcpServer.start();
    await this.swarmCoordinator.startWebSocketServer(options.wsPort);
    
    console.log('🌊 Claude-Flow Adapter started');
  }
  
  async stop(): Promise<void> {
    await this.mcpServer.stop();
    console.log('🌊 Claude-Flow Adapter stopped');
  }
  
  getMCPServer(): ClaudeFlowMCPServer {
    return this.mcpServer;
  }
  
  getSwarmCoordinator(): SwarmCoordinator {
    return this.swarmCoordinator;
  }
  
  getEventBus(): EventEmitter {
    return this.eventBus;
  }
}

export default ClaudeFlowAdapter;