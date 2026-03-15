/**
 * 🦊 SKYNET MOLTBOOK — Agent Communication Bus with MessageBroker Integration
 * 
 * @deprecated MOLTBOOK is being replaced by AgentChattr for swarm coordination.
 * AgentChattr provides:
 * - Human-visible coordination via web UI (localhost:8300)
 * - MCP-native tools (chat_send, chat_read, chat_decision, etc.)
 * - @mention-based task assignment
 * - Decision tracking with human approval
 * 
 * Migration: Use AgentChattrConvoyAdapter from '../swarm/agentchattr-convoy-adapter'
 * @see https://github.com/bcurts/agentchattr
 * @see /home/toba/superclaw/src/mcp/bridges/agentchattr.ts
 * 
 * --- LEGACY DOCUMENTATION ---
 * 
 * Multi-agent communication hub with message routing, agent registry, 
 * and CORTEX integration for shared memory. Enhanced with claude-flow
 * orchestration patterns for hierarchical coordination and consensus.
 * Now powered by the new MessageBroker for reliable inter-agent messaging.
 * 
 * Features:
 * - MessageBroker-powered reliable delivery with correlation tracking
 * - Agent registry and lifecycle management  
 * - Message types: direct, broadcast, query, response
 * - Integration with CORTEX for shared memory
 * - Agent lifecycle hooks: onSpawn, onMessage, onDeath
 * - Claude-Flow swarm coordination and consensus algorithms
 * - Anti-drift mechanisms and 3-tier model routing
 * - WebSocket real-time coordination
 * - 60+ agent specialization patterns
 * - Request/response patterns with timeout handling
 * - Typed message payloads with backward compatibility
 * - Message acknowledgment and unacknowledged message tracking
 * - Enhanced query/response patterns with sendAndWait
 * - Automatic cleanup and memory management
 * 
 * INTEGRATION NOTES:
 * - Uses MessageBroker internally for reliable message delivery
 * - Maintains 100% backward compatibility with existing MOLTBOOK API
 * - Maps MOLTBOOK message types to orchestration message types
 * - Supports both legacy Message format and new InterAgentMessage format
 * - Correlation IDs enable request/response tracking across both systems
 * - MessageBroker subscriptions replace internal EventEmitter routing
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import { memorize, recall, buildContext } from './cortex';
import { MessageBroker } from '../orchestration/MessageBroker';
import { MessageType, MessageHandler } from '../orchestration/types';
import { 
  ClaudeFlowAdapter, 
  SwarmCoordinator, 
  ClaudeFlowAgent, 
  AgentSpecialization,
  SwarmTopology,
  ConsensusAlgorithm 
} from './claude-flow-adapter';
import { InterAgentMessage } from "../types/index";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface Agent {
  id: string;
  name: string;
  model: string;
  goal: string;
  status: 'idle' | 'running' | 'paused' | 'dead';
  spawnTime: number;
  lastActivity: number;
  messageCount: number;
  permissions: string[];
  resourceLimits?: {
    maxTokens?: number;
    maxRequests?: number;
    maxCpuTime?: number;
    maxMemory?: number;
  };
  metadata?: Record<string, any>;
  // Claude-Flow extensions
  specialization?: AgentSpecialization;
  tier?: 'local' | 'efficient' | 'advanced';
  capabilities?: string[];
  performance?: {
    tasksCompleted: number;
    successRate: number;
    avgExecutionTime: number;
    driftScore: number;
  };
  coordination?: {
    topology: SwarmTopology;
    parentId?: string;
    childIds: string[];
    peerIds: string[];
  };
}

export interface Message {
  id: string;
  type: 'direct' | 'broadcast' | 'query' | 'response';
  from: string;
  to?: string | string[];  // For direct/query, array for multi-target
  queryId?: string;        // Links responses to queries (backward compatibility)
  correlationId?: string;  // New correlation support for MessageBroker
  content: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

// Enhanced message interface for typed payloads
export interface TypedMessage<T = any> extends Omit<Message, 'content'> {
  content: string;  // Keep for backward compatibility
  payload?: T;      // New typed payload support
}

export interface AgentHooks {
  onSpawn?: (agent: Agent) => Promise<void> | void;
  onMessage?: (agent: Agent, message: Message) => Promise<void> | void;
  onDeath?: (agent: Agent) => Promise<void> | void;
}

export interface MoltbookState {
  isRunning: boolean;
  startTime: number | null;
  agentCount: number;
  messageCount: number;
  queryCount: number;
  responseCount: number;
  uptime: number;
}

// ═══════════════════════════════════════════════════════════════
// MOLTBOOK BUS
// ═══════════════════════════════════════════════════════════════

class MoltbookBus extends EventEmitter {
  private agents = new Map<string, Agent>();
  private messages: Message[] = [];
  private queries = new Map<string, { query: Message; responses: Message[] }>();
  private hooks: AgentHooks = {};
  private isRunning = false;
  private startTime: number | null = null;
  private messageCount = 0;
  
  // MessageBroker integration
  private messageBroker: MessageBroker;
  
  // Claude-Flow integration
  private claudeFlowAdapter: ClaudeFlowAdapter;
  private swarmCoordinator: SwarmCoordinator;

  constructor(claudeFlowConfig?: {
    topology?: SwarmTopology;
    consensusAlgorithm?: ConsensusAlgorithm;
    antiDriftThreshold?: number;
    messageBrokerOptions?: {
      maxLogSize?: number;
      defaultTimeoutMs?: number;
    };
  }) {
    super();
    this.setMaxListeners(1000); // Support many agents
    
    // Initialize MessageBroker
    this.messageBroker = new MessageBroker(claudeFlowConfig?.messageBrokerOptions);
    this.setupMessageBrokerIntegration();
    
    // Initialize Claude-Flow adapter
    this.claudeFlowAdapter = new ClaudeFlowAdapter(claudeFlowConfig);
    this.swarmCoordinator = this.claudeFlowAdapter.getSwarmCoordinator();
    
    // Set up Claude-Flow event handlers
    this.setupClaudeFlowIntegration();
  }
  
  // ═══════════════════════════════════════════════════════════════
  // MESSAGEBROKER INTEGRATION
  // ═══════════════════════════════════════════════════════════════
  
  private setupMessageBrokerIntegration(): void {
    // Forward MessageBroker events to MOLTBOOK events for compatibility
    this.messageBroker.on('message', (interAgentMsg: InterAgentMessage) => {
      const moltbookMsg = this.convertInterAgentToMoltbook(interAgentMsg);
      this.messages.push(moltbookMsg);
      this.messageCount++;
      
      // Emit MOLTBOOK-style events
      this.emit('message', moltbookMsg);
      this.emit(`message:${moltbookMsg.to}`, moltbookMsg);
    });
    
    this.messageBroker.on('acknowledged', (ack) => {
      this.emit('message:acknowledged', ack);
    });
    
    this.messageBroker.on('handler_error', (error) => {
      this.emit('message:error', error);
    });
  }
  
  private convertMoltbookToInterAgent(message: Message, targetId: string): InterAgentMessage {
    // Map MOLTBOOK message types to orchestration message types
    let type: MessageType;
    switch (message.type) {
      case 'direct':
        type = MessageType.TASK_READY; // Default to task communication
        break;
      case 'broadcast':
        type = MessageType.HEARTBEAT; // Broadcasts often used for heartbeats
        break;
      case 'query':
        type = MessageType.VALIDATION_REQUEST;
        break;
      case 'response':
        type = MessageType.TASK_COMPLETE;
        break;
      default:
        type = MessageType.TASK_READY;
    }
    
    return {
      id: message.id,
      type,
      from: message.from,
      senderId: message.from, // Add required senderId field
      to: targetId,
      payload: {
        moltbookType: message.type,
        content: message.content,
        metadata: message.metadata,
        queryId: message.queryId
      },
      timestamp: new Date(message.timestamp),
      correlationId: message.correlationId || message.queryId
    };
  }
  
  private convertInterAgentToMoltbook(interAgentMsg: InterAgentMessage): Message {
    const payload = interAgentMsg.payload || {};
    
    return {
      id: interAgentMsg.id,
      type: payload.moltbookType || 'direct',
      from: interAgentMsg.from,
      to: interAgentMsg.to,
      queryId: payload.queryId,
      correlationId: interAgentMsg.correlationId,
      content: payload.content || JSON.stringify(payload),
      timestamp: interAgentMsg.timestamp.getTime(),
      metadata: payload.metadata
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // CLAUDE-FLOW INTEGRATION
  // ═══════════════════════════════════════════════════════════════
  
  private setupClaudeFlowIntegration(): void {
    const eventBus = this.claudeFlowAdapter.getEventBus();
    
    // Handle agent spawning from claude-flow
    eventBus.on('agent:spawned', (event) => {
      const agent = event.agent as ClaudeFlowAgent;
      this.registerAgent({
        name: agent.name,
        model: agent.model,
        goal: agent.goal,
        permissions: agent.permissions,
        specialization: agent.specialization,
        tier: agent.tier,
        capabilities: agent.capabilities,
        performance: agent.performance,
        coordination: agent.coordination
      });
    });
    
    // Handle task coordination
    eventBus.on('mcp:coordinate_task', (params) => {
      this.coordinateTask(params.task, params.topology, params.agentIds);
    });
    
    // Handle consensus requests  
    eventBus.on('mcp:reach_consensus', (params) => {
      this.reachConsensus(params.decision, params.algorithm, params.agentIds);
    });
    
    // Handle WebSocket coordination updates
    eventBus.on('coordination:request', (data) => {
      this.handleCoordinationRequest(data);
    });
  }
  
  async spawnSpecializedAgent(
    specialization: AgentSpecialization, 
    config?: {
      tier?: 'local' | 'efficient' | 'advanced';
      topology?: SwarmTopology;
      capabilities?: string[];
    }
  ): Promise<Agent> {
    // Use claude-flow MCP server to spawn agent
    const mcpServer = this.claudeFlowAdapter.getMCPServer();
    
    const response = await mcpServer.handleRequest({
      id: crypto.randomUUID(),
      method: 'spawn_agent',
      params: {
        specialization,
        tier: config?.tier || 'efficient',
        config: {
          topology: config?.topology || 'hierarchical',
          capabilities: config?.capabilities
        }
      }
    });
    
    if (response.result) {
      // Agent will be registered via the event handler
      const agents = Array.from(this.agents.values());
      return agents[agents.length - 1]; // Return most recently added agent
    }
    
    throw new Error('Failed to spawn specialized agent');
  }
  
  async coordinateTask(task: any, topology?: SwarmTopology, agentIds?: string[]): Promise<any> {
    const mcpServer = this.claudeFlowAdapter.getMCPServer();
    
    const response = await mcpServer.handleRequest({
      id: crypto.randomUUID(),
      method: 'coordinate_task', 
      params: {
        task,
        topology: topology || 'hierarchical',
        agentIds: agentIds || Array.from(this.agents.keys())
      }
    });
    
    return response.result;
  }
  
  async reachConsensus(
    decision: any, 
    algorithm?: ConsensusAlgorithm,
    agentIds?: string[]
  ): Promise<any> {
    const mcpServer = this.claudeFlowAdapter.getMCPServer();
    
    const response = await mcpServer.handleRequest({
      id: crypto.randomUUID(),
      method: 'reach_consensus',
      params: {
        decision,
        algorithm: algorithm || 'raft',
        agentIds: agentIds || Array.from(this.agents.keys())
      }
    });
    
    return response.result;
  }
  
  private handleCoordinationRequest(data: any): void {
    // Handle real-time coordination requests
    this.emit('coordination:request', data);
  }
  
  getSwarmStatus(): any {
    return this.swarmCoordinator.getSwarmStatus();
  }
  
  getClaudeFlowAgents(): ClaudeFlowAgent[] {
    return this.swarmCoordinator.listAgents();
  }
  
  async startClaudeFlowCoordination(options?: { wsPort?: number }): Promise<void> {
    await this.claudeFlowAdapter.start(options);
  }
  
  async stopClaudeFlowCoordination(): Promise<void> {
    await this.claudeFlowAdapter.stop();
  }

  // ═══════════════════════════════════════════════════════════════
  // BUS LIFECYCLE
  // ═══════════════════════════════════════════════════════════════

  async start(options?: { wsPort?: number }): Promise<void> {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.startTime = Date.now();
    
    // Start Claude-Flow coordination
    await this.startClaudeFlowCoordination(options);
    
    this.emit('bus:started');
    
    // Store startup in CORTEX
    memorize(
      `Moltbook agent bus with MessageBroker and Claude-Flow started at ${new Date().toISOString()}`,
      'fact',
      'moltbook:startup'
    );
    
    console.log('🚌 Moltbook agent bus with MessageBroker and Claude-Flow coordination started');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    
    // Stop Claude-Flow coordination first
    await this.stopClaudeFlowCoordination();
    
    // Kill all agents (this also cleans up MessageBroker subscriptions)
    const agentIds = Array.from(this.agents.keys());
    for (const agentId of agentIds) {
      this.killAgent(agentId);
    }
    
    // Shutdown MessageBroker
    await this.messageBroker.shutdown();
    
    this.isRunning = false;
    this.emit('bus:stopped');
    
    // Store shutdown in CORTEX with enhanced stats
    const finalStats = this.getEnhancedState();
    memorize(
      `Moltbook agent bus with MessageBroker stopped at ${new Date().toISOString()}. ` +
      `Handled ${finalStats.totalMessages} total messages (${finalStats.messageCount} MOLTBOOK + ${finalStats.messageBroker.totalMessages} MessageBroker).`,
      'fact',
      'moltbook:shutdown'
    );
    
    console.log('🚌 Moltbook agent bus with MessageBroker and Claude-Flow coordination stopped');
  }

  // Additional methods for backward compatibility
  async routeMessage(message: Message): Promise<void> {
    this.sendMessage(message);
  }

  onMessage(callback: (message: Message) => void): void {
    this.on('message', callback);
  }

  getState(): MoltbookState {
    return {
      isRunning: this.isRunning,
      startTime: this.startTime,
      agentCount: this.agents.size,
      messageCount: this.messageCount,
      queryCount: this.queries.size,
      responseCount: this.messages.filter(m => m.type === 'response').length,
      uptime: this.startTime ? Date.now() - this.startTime : 0,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // AGENT REGISTRY
  // ═══════════════════════════════════════════════════════════════

  registerAgent(agent: Omit<Agent, 'id' | 'status' | 'spawnTime' | 'lastActivity' | 'messageCount'>): Agent {
    const fullAgent: Agent = {
      ...agent,
      id: crypto.randomUUID(),
      status: 'idle',
      spawnTime: Date.now(),
      lastActivity: Date.now(),
      messageCount: 0,
    };

    this.agents.set(fullAgent.id, fullAgent);
    
    // Set up MessageBroker subscription for this agent
    this.messageBroker.subscribe(fullAgent.id, async (interAgentMsg: InterAgentMessage) => {
      const moltbookMsg = this.convertInterAgentToMoltbook(interAgentMsg);
      
      // Update agent activity
      fullAgent.lastActivity = Date.now();
      fullAgent.messageCount++;
      
      // Call lifecycle hook
      await this.hooks.onMessage?.(fullAgent, moltbookMsg);
      
      // Emit agent-specific events
      this.emit(`agent:${fullAgent.id}:message`, moltbookMsg);
      
      // Handle different message types
      switch (moltbookMsg.type) {
        case 'query':
          this.emit(`agent:${fullAgent.id}:query`, moltbookMsg);
          break;
        case 'response':
          this.emit(`agent:${fullAgent.id}:response`, moltbookMsg);
          break;
      }
    });
    
    this.emit('agent:spawn', fullAgent);
    
    // Call lifecycle hook
    this.hooks.onSpawn?.(fullAgent);
    
    // Store in CORTEX
    memorize(
      `Agent ${fullAgent.name} (${fullAgent.model}) spawned for goal: ${fullAgent.goal}`,
      'fact',
      `moltbook:agent:spawn:${fullAgent.id}`
    );
    
    console.log(`🤖 Agent spawned: ${fullAgent.name} (${fullAgent.id})`);
    return fullAgent;
  }

  unregisterAgent(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    agent.status = 'dead';
    
    // Clean up MessageBroker resources for this agent
    this.messageBroker.removeAgent(agentId);
    
    this.agents.delete(agentId);
    this.emit('agent:death', agent);
    
    // Call lifecycle hook
    this.hooks.onDeath?.(agent);
    
    // Store in CORTEX
    memorize(
      `Agent ${agent.name} died. Handled ${agent.messageCount} messages over ${Date.now() - agent.spawnTime}ms`,
      'fact',
      `moltbook:agent:death:${agentId}`
    );
    
    console.log(`💀 Agent died: ${agent.name} (${agentId})`);
    return true;
  }

  getAgent(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  getAllAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  getAgentsByStatus(status: Agent['status']): Agent[] {
    return this.getAllAgents().filter(agent => agent.status === status);
  }

  updateAgentStatus(agentId: string, status: Agent['status']): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    agent.status = status;
    agent.lastActivity = Date.now();
    this.emit('agent:status', agent, status);
    
    return true;
  }

  killAgent(agentId: string): boolean {
    return this.unregisterAgent(agentId);
  }

  // ═══════════════════════════════════════════════════════════════
  // MESSAGE ROUTING
  // ═══════════════════════════════════════════════════════════════

  sendMessage(message: Omit<Message, 'id' | 'timestamp'>): Message {
    const fullMessage: Message = {
      ...message,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      correlationId: message.correlationId || message.queryId || crypto.randomUUID(),
    };

    // Update sender activity
    const sender = this.agents.get(message.from);
    if (sender) {
      sender.lastActivity = Date.now();
      sender.messageCount++;
    }

    // Route message based on type using MessageBroker
    switch (message.type) {
      case 'direct':
        this.routeDirectMessage(fullMessage);
        break;
      case 'broadcast':
        this.routeBroadcastMessage(fullMessage);
        break;
      case 'query':
        this.routeQueryMessage(fullMessage);
        break;
      case 'response':
        this.routeResponseMessage(fullMessage);
        break;
    }

    // Store important messages in CORTEX
    if (message.content.length > 50) { // Only store substantial messages
      memorize(
        `${message.type.toUpperCase()} from ${sender?.name || message.from}: ${message.content}`,
        'conversation',
        `moltbook:message:${fullMessage.id}`
      );
    }

    return fullMessage;
  }

  // New typed messaging API
  async sendTypedMessage<T = any>(
    from: string,
    to: string,
    type: Message['type'],
    payload: T,
    options?: { correlationId?: string; metadata?: Record<string, any> }
  ): Promise<string> {
    const content = typeof payload === 'string' ? payload : JSON.stringify(payload);
    
    const message: Omit<Message, 'id' | 'timestamp'> = {
      type,
      from,
      to,
      content,
      correlationId: options?.correlationId,
      metadata: options?.metadata
    };
    
    const fullMessage = this.sendMessage(message);
    return fullMessage.id;
  }

  // Enhanced query with typed response
  async sendQuery<TQuery = any, TResponse = any>(
    from: string,
    to: string | string[],
    query: TQuery,
    timeoutMs?: number
  ): Promise<TResponse[]> {
    const correlationId = crypto.randomUUID();
    const content = typeof query === 'string' ? query : JSON.stringify(query);
    
    const targets = Array.isArray(to) ? to : [to];
    const responses: TResponse[] = [];
    
    // Track query for backward compatibility
    const queryMessage: Message = {
      id: crypto.randomUUID(),
      type: 'query',
      from,
      to,
      content,
      timestamp: Date.now(),
      correlationId,
      queryId: correlationId // Backward compatibility
    };
    
    this.queries.set(correlationId, { query: queryMessage, responses: [] });
    
    // Send queries via MessageBroker for reliable delivery
    const promises = targets.map(async (target) => {
      try {
        const response = await this.messageBroker.sendAndWait(
          from,
          target,
          MessageType.VALIDATION_REQUEST,
          {
            moltbookType: 'query',
            content,
            correlationId
          },
          timeoutMs
        );
        
        const typedResponse = typeof response.payload === 'object' && response.payload.content 
          ? JSON.parse(response.payload.content) 
          : response.payload;
          
        responses.push(typedResponse);
        return typedResponse;
      } catch (error: unknown) {
        console.error(`Query to ${target} failed:`, error);
        throw error;
      }
    });
    
    await Promise.allSettled(promises);
    return responses;
  }

  // Send and wait for single response
  async sendAndWait<TQuery = any, TResponse = any>(
    from: string,
    to: string,
    query: TQuery,
    timeoutMs?: number
  ): Promise<TResponse> {
    const responses = await this.sendQuery<TQuery, TResponse>(from, [to], query, timeoutMs);
    if (responses.length === 0) {
      throw new Error(`No response received from ${to}`);
    }
    return responses[0];
  }

  private routeDirectMessage(message: Message): void {
    if (!message.to || Array.isArray(message.to)) return;

    const target = this.agents.get(message.to as string);
    if (target) {
      // Use MessageBroker for reliable delivery
      this.messageBroker.sendMessage(
        message.from,
        message.to as string,
        MessageType.TASK_READY,
        {
          moltbookType: message.type,
          content: message.content,
          metadata: message.metadata,
          queryId: message.queryId
        },
        {
          correlationId: message.correlationId
        }
      ).catch(error => {
        console.error(`Failed to route direct message to ${message.to}:`, error);
        this.emit('message:error', { message, error });
      });
      
      console.log(`📨 Direct: ${this.agents.get(message.from)?.name} → ${target.name}`);
    }
  }

  private routeBroadcastMessage(message: Message): void {
    const activeAgents = Array.from(this.agents.entries())
      .filter(([agentId, agent]) => agentId !== message.from && agent.status !== 'dead')
      .map(([agentId]) => agentId);

    if (activeAgents.length > 0) {
      // Use MessageBroker broadcast for reliable delivery
      this.messageBroker.broadcast(
        message.from,
        MessageType.HEARTBEAT,
        {
          moltbookType: message.type,
          content: message.content,
          metadata: message.metadata
        },
        activeAgents
      ).catch(error => {
        console.error('Failed to broadcast message:', error);
        this.emit('message:error', { message, error });
      });
      
      console.log(`📢 Broadcast from ${this.agents.get(message.from)?.name} to ${activeAgents.length} agents`);
    }
  }

  private routeQueryMessage(message: Message): void {
    const correlationId = message.correlationId || message.queryId || crypto.randomUUID();
    this.queries.set(correlationId, { query: message, responses: [] });
    
    const targets = Array.isArray(message.to) ? message.to : 
                   message.to ? [message.to] : 
                   Array.from(this.agents.keys()).filter(id => id !== message.from);

    // Use MessageBroker for reliable query delivery
    for (const targetId of targets) {
      const agent = this.agents.get(targetId);
      if (agent && agent.status !== 'dead') {
        this.messageBroker.sendMessage(
          message.from,
          targetId,
          MessageType.VALIDATION_REQUEST,
          {
            moltbookType: message.type,
            content: message.content,
            metadata: message.metadata,
            queryId: message.queryId
          },
          {
            correlationId
          }
        ).catch(error => {
          console.error(`Failed to send query to ${targetId}:`, error);
          this.emit('message:error', { message, error, targetId });
        });
      }
    }
    
    console.log(`❓ Query from ${this.agents.get(message.from)?.name} to ${targets.length} agents`);
  }

  private routeResponseMessage(message: Message): void {
    const correlationId = message.correlationId || message.queryId;
    if (!correlationId) return;

    const queryData = this.queries.get(correlationId);
    if (queryData) {
      queryData.responses.push(message);
      
      // Send response via MessageBroker
      this.messageBroker.sendMessage(
        message.from,
        queryData.query.from,
        MessageType.TASK_COMPLETE,
        {
          moltbookType: message.type,
          content: message.content,
          metadata: message.metadata,
          queryId: message.queryId
        },
        {
          correlationId
        }
      ).catch(error => {
        console.error(`Failed to send response for query ${correlationId}:`, error);
        this.emit('message:error', { message, error });
      });
      
      console.log(`✅ Response to query ${correlationId} from ${this.agents.get(message.from)?.name}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // QUERY MANAGEMENT & MESSAGEBROKER INTEGRATION
  // ═══════════════════════════════════════════════════════════════

  getQueryResponses(queryId: string): Message[] {
    // Support both old queryId and new correlationId systems
    return this.queries.get(queryId)?.responses || [];
  }

  getAllMessages(agentId?: string): Message[] {
    if (!agentId) {
      // Combine local messages with MessageBroker history
      const brokerHistory = this.messageBroker.getMessageHistory()
        .map(interAgentMsg => this.convertInterAgentToMoltbook(interAgentMsg));
      
      // Merge and deduplicate by message ID
      const allMessages = [...this.messages, ...brokerHistory];
      const seen = new Set<string>();
      return allMessages.filter(msg => {
        if (seen.has(msg.id)) return false;
        seen.add(msg.id);
        return true;
      });
    }
    
    // Get messages for specific agent from MessageBroker
    const brokerMessages = this.messageBroker.getMessageHistory({ 
      from: agentId 
    }).concat(
      this.messageBroker.getMessageHistory({ to: agentId })
    ).map(interAgentMsg => this.convertInterAgentToMoltbook(interAgentMsg));
    
    const localMessages = this.messages.filter(m => m.from === agentId || m.to === agentId);
    
    // Merge and deduplicate
    const allMessages = [...localMessages, ...brokerMessages];
    const seen = new Set<string>();
    return allMessages.filter(msg => {
      if (seen.has(msg.id)) return false;
      seen.add(msg.id);
      return true;
    });
  }

  // Get MessageBroker stats integrated with MOLTBOOK stats
  getEnhancedState(): MoltbookState & {
    messageBroker: ReturnType<MessageBroker['getStats']>;
    totalMessages: number;
  } {
    const baseState = this.getState();
    const brokerStats = this.messageBroker.getStats();
    
    return {
      ...baseState,
      messageBroker: brokerStats,
      totalMessages: baseState.messageCount + brokerStats.totalMessages
    };
  }

  // Subscribe to MessageBroker events for agent
  subscribeToAgent(
    agentId: string, 
    handler: (message: Message) => Promise<void> | void
  ): () => void {
    return this.messageBroker.subscribe(agentId, async (interAgentMsg: InterAgentMessage) => {
      const moltbookMsg = this.convertInterAgentToMoltbook(interAgentMsg);
      await handler(moltbookMsg);
    });
  }

  // Subscribe to specific message type via MessageBroker
  subscribeToMessageType(
    agentId: string,
    type: Message['type'],
    handler: (message: Message) => Promise<void> | void
  ): () => void {
    return this.messageBroker.subscribe(agentId, async (interAgentMsg: InterAgentMessage) => {
      const moltbookMsg = this.convertInterAgentToMoltbook(interAgentMsg);
      if (moltbookMsg.type === type) {
        await handler(moltbookMsg);
      }
    });
  }

  // Get unacknowledged messages for an agent
  getUnacknowledgedMessages(agentId: string): Message[] {
    return this.messageBroker.getUnacknowledgedMessages(agentId)
      .map(interAgentMsg => this.convertInterAgentToMoltbook(interAgentMsg));
  }

  // Acknowledge message processing
  async acknowledgeMessage(messageId: string): Promise<void> {
    await this.messageBroker.acknowledgeMessage(messageId);
  }

  // Access to underlying MessageBroker for advanced usage
  getMessageBroker(): MessageBroker {
    return this.messageBroker;
  }

  // ═══════════════════════════════════════════════════════════════
  // CORTEX INTEGRATION
  // ═══════════════════════════════════════════════════════════════

  async buildAgentContext(agentId: string, query?: string): Promise<string> {
    const agent = this.agents.get(agentId);
    if (!agent) return '';

    try {
      // Build context from CORTEX based on agent's activity
      const contextQuery = [
        query || `Agent ${agent.name} context`,
        `moltbook agent ${agent.name}`,
        agent.goal,
      ].join(' ');
      
      const context = buildContext(contextQuery);
      return context;
    } catch (error: unknown) {
      console.error('Error building agent context:', error);
      return '';
    }
  }

  async getAgentMemories(agentId: string, query: string): Promise<any[]> {
    const agent = this.agents.get(agentId);
    if (!agent) return [];

    try {
      const searchQuery = `${query} agent:${agent.name} moltbook`;
      return recall(searchQuery, 10);
    } catch (error: unknown) {
      console.error('Error recalling agent memories:', error);
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // HOOKS
  // ═══════════════════════════════════════════════════════════════

  setHooks(hooks: AgentHooks): void {
    this.hooks = { ...this.hooks, ...hooks };
  }

  clearHooks(): void {
    this.hooks = {};
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════

let moltbookInstance: MoltbookBus | null = null;

export function getMoltbook(): MoltbookBus {
  if (!moltbookInstance) {
    moltbookInstance = new MoltbookBus();
  }
  return moltbookInstance;
}

// Convenience exports (backward compatibility)
export function startMoltbook(): Promise<void> {
  return getMoltbook().start();
}

export function stopMoltbook(): Promise<void> {
  return getMoltbook().stop();
}

export function getMoltbookState(): MoltbookState {
  return getMoltbook().getState();
}

export function registerAgent(agent: Omit<Agent, 'id' | 'status' | 'spawnTime' | 'lastActivity' | 'messageCount'>): Agent {
  return getMoltbook().registerAgent(agent);
}

export function sendMessage(message: Omit<Message, 'id' | 'timestamp'>): Message {
  return getMoltbook().sendMessage(message);
}

export function getAllAgents(): Agent[] {
  return getMoltbook().getAllAgents();
}

export function getAgent(agentId: string): Agent | undefined {
  return getMoltbook().getAgent(agentId);
}

export function setAgentHooks(hooks: AgentHooks): void {
  getMoltbook().setHooks(hooks);
}

// Enhanced MessageBroker-powered exports
export function getEnhancedMoltbookState(): ReturnType<MoltbookBus['getEnhancedState']> {
  return getMoltbook().getEnhancedState();
}

export async function sendTypedMessage<T = any>(
  from: string,
  to: string,
  type: Message['type'],
  payload: T,
  options?: { correlationId?: string; metadata?: Record<string, any> }
): Promise<string> {
  return getMoltbook().sendTypedMessage(from, to, type, payload, options);
}

export async function sendQuery<TQuery = any, TResponse = any>(
  from: string,
  to: string | string[],
  query: TQuery,
  timeoutMs?: number
): Promise<TResponse[]> {
  return getMoltbook().sendQuery(from, to, query, timeoutMs);
}

export async function sendAndWait<TQuery = any, TResponse = any>(
  from: string,
  to: string,
  query: TQuery,
  timeoutMs?: number
): Promise<TResponse> {
  return getMoltbook().sendAndWait(from, to, query, timeoutMs);
}

export function subscribeToAgent(
  agentId: string,
  handler: (message: Message) => Promise<void> | void
): () => void {
  return getMoltbook().subscribeToAgent(agentId, handler);
}

export function subscribeToMessageType(
  agentId: string,
  type: Message['type'],
  handler: (message: Message) => Promise<void> | void
): () => void {
  return getMoltbook().subscribeToMessageType(agentId, type, handler);
}

export function getUnacknowledgedMessages(agentId: string): Message[] {
  return getMoltbook().getUnacknowledgedMessages(agentId);
}

export async function acknowledgeMessage(messageId: string): Promise<void> {
  return getMoltbook().acknowledgeMessage(messageId);
}

// Export the bus class for advanced usage
export { MoltbookBus };

// Export additional types for enhanced functionality
// @ts-expect-error - Post-Merge Reconciliation
export type { TypedMessage, InterAgentMessage, MessageType };

// Access to underlying MessageBroker for advanced usage
export function getMessageBroker(): MessageBroker {
  return getMoltbook().getMessageBroker();
}

// MOLTBOOK constant for backward compatibility
export const MOLTBOOK = getMoltbook();