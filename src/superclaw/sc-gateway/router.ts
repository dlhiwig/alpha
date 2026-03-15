/**
 * SuperClaw Gateway Router
 * Routes requests to appropriate agents based on context
 */

import { EventEmitter } from 'events';
import type { SessionInfo } from './session-manager';
import { getSessionManager } from './session-manager';
import { getSwarmService } from '../core/swarm-service';

export interface RouteContext {
  sessionId?: string;
  agentId: string;
  channel: string;
  accountId?: string;
  target: string;
  threadId?: string | number;
  requestId: string;
  timestamp: number;
  metadata: Record<string, unknown>;
}

export interface RouteRequest {
  type: 'chat' | 'task' | 'tool' | 'system';
  payload: unknown;
  context: RouteContext;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  timeout?: number;
}

export interface RouteResponse {
  requestId: string;
  success: boolean;
  data?: unknown;
  error?: string;
  agentId: string;
  processingTimeMs: number;
  metadata?: Record<string, unknown>;
}

export interface AgentCapability {
  agentId: string;
  channels: string[];
  taskTypes: string[];
  maxConcurrentRequests: number;
  currentLoad: number;
  averageResponseTime: number;
  reliability: number; // 0-1 score
  lastSeen: number;
  metadata: Record<string, unknown>;
}

export interface RoutingStrategy {
  name: string;
  selectAgent(
    request: RouteRequest,
    availableAgents: AgentCapability[]
  ): AgentCapability | null;
}

export class GatewayRouter extends EventEmitter {
  private sessionManager = getSessionManager();
  private swarmService = getSwarmService();
  private agents: Map<string, AgentCapability> = new Map();
  private activeRequests: Map<string, RouteRequest> = new Map();
  private routingStrategies: Map<string, RoutingStrategy> = new Map();
  private defaultStrategy: string = 'load-balanced';

  constructor() {
    super();
    this.initializeDefaultStrategies();
    this.startHealthMonitoring();
  }

  /**
   * Register an agent with its capabilities
   */
  registerAgent(capability: AgentCapability): void {
    this.agents.set(capability.agentId, {
      ...capability,
      lastSeen: Date.now()
    });

    this.emit('agent-registered', { agentId: capability.agentId, capability });
  }

  /**
   * Unregister an agent
   */
  unregisterAgent(agentId: string): void {
    this.agents.delete(agentId);
    this.emit('agent-unregistered', { agentId });
  }

  /**
   * Update agent status
   */
  updateAgentStatus(agentId: string, updates: Partial<AgentCapability>): void {
    const existing = this.agents.get(agentId);
    if (!existing) {
      return;
    }

    const updated: AgentCapability = {
      ...existing,
      ...updates,
      lastSeen: Date.now()
    };

    this.agents.set(agentId, updated);
    this.emit('agent-updated', { agentId, before: existing, after: updated });
  }

  /**
   * Route a request to an appropriate agent
   */
  async routeRequest(request: RouteRequest): Promise<RouteResponse> {
    const startTime = Date.now();
    
    // Store active request
    this.activeRequests.set(request.context.requestId, request);
    
    try {
      // Get or create session
      let session = request.context.sessionId 
        ? this.sessionManager.getSession(request.context.sessionId)
        : null;

      if (!session) {
        session = await this.sessionManager.createSession({
          agentId: request.context.agentId,
          channel: request.context.channel,
          accountId: request.context.accountId,
          target: request.context.target,
          threadId: request.context.threadId,
          metadata: request.context.metadata
        });
      }

      // Update session activity
      await this.sessionManager.recordActivity(session.sessionId, {
        requestType: request.type,
        requestId: request.context.requestId
      });

      // Select appropriate agent
      const selectedAgent = this.selectAgent(request);
      if (!selectedAgent) {
        throw new Error('No suitable agent available');
      }

      // Route to agent based on request type
      const response = await this.dispatchToAgent(selectedAgent, request, session);
      
      // Update agent metrics
      const processingTime = Date.now() - startTime;
      this.updateAgentMetrics(selectedAgent.agentId, processingTime, true);

      const result: RouteResponse = {
        requestId: request.context.requestId,
        success: true,
        data: response,
        agentId: selectedAgent.agentId,
        processingTimeMs: processingTime,
        metadata: {
          sessionId: session.sessionId,
          strategy: this.defaultStrategy,
          agentLoad: selectedAgent.currentLoad
        }
      };

      this.emit('request-completed', { request, response: result });
      return result;

    } catch (error: unknown) {
      const processingTime = Date.now() - startTime;
      const errorResponse: RouteResponse = {
        requestId: request.context.requestId,
        success: false,
        error: error instanceof Error ? (error as Error).message : String(error),
        agentId: request.context.agentId,
        processingTimeMs: processingTime
      };

      this.emit('request-failed', { request, error: errorResponse });
      return errorResponse;

    } finally {
      this.activeRequests.delete(request.context.requestId);
    }
  }

  /**
   * Get available agents for a request
   */
  getAvailableAgents(request: RouteRequest): AgentCapability[] {
    return Array.from(this.agents.values()).filter(agent => {
      // Check if agent supports the channel
      if (!agent.channels.includes(request.context.channel)) {
        return false;
      }

      // Check if agent supports the task type
      if (!agent.taskTypes.includes(request.type)) {
        return false;
      }

      // Check if agent is not overloaded
      if (agent.currentLoad >= agent.maxConcurrentRequests) {
        return false;
      }

      // Check if agent is alive (seen in last 5 minutes)
      const fiveMinutes = 5 * 60 * 1000;
      if (Date.now() - agent.lastSeen > fiveMinutes) {
        return false;
      }

      return true;
    });
  }

  /**
   * Select the best agent for a request using configured strategy
   */
  private selectAgent(request: RouteRequest): AgentCapability | null {
    const availableAgents = this.getAvailableAgents(request);
    if (availableAgents.length === 0) {
      return null;
    }

    const strategy = this.routingStrategies.get(this.defaultStrategy);
    if (!strategy) {
      // Fallback to first available
      return availableAgents[0];
    }

    return strategy.selectAgent(request, availableAgents);
  }

  /**
   * Dispatch request to selected agent
   */
  private async dispatchToAgent(
    agent: AgentCapability, 
    request: RouteRequest, 
    session: SessionInfo
  ): Promise<unknown> {
    // Increment agent load
    this.updateAgentStatus(agent.agentId, { 
      currentLoad: agent.currentLoad + 1 
    });

    try {
      switch (request.type) {
        case 'chat':
          return await this.handleChatRequest(agent, request, session);
        case 'task':
          return await this.handleTaskRequest(agent, request, session);
        case 'tool':
          return await this.handleToolRequest(agent, request, session);
        case 'system':
          return await this.handleSystemRequest(agent, request, session);
        default:
          throw new Error(`Unsupported request type: ${request.type}`);
      }
    } finally {
      // Decrement agent load
      this.updateAgentStatus(agent.agentId, { 
        currentLoad: Math.max(0, agent.currentLoad - 1) 
      });
    }
  }

  /**
   * Handle chat request
   */
  private async handleChatRequest(
    agent: AgentCapability,
    request: RouteRequest,
    session: SessionInfo
  ): Promise<unknown> {
    // For now, delegate to swarm service
    // In future, could route to specific chat agents
    const { runId } = await this.swarmService.runSwarm({
      objective: String(request.payload),
      maxAgents: 1,
      timeout: request.timeout || 30000,
      // @ts-expect-error - Post-Merge Reconciliation
      context: {
        sessionId: session.sessionId,
        channel: session.channel,
        agentId: agent.agentId
      }
    });

    return { runId, sessionId: session.sessionId };
  }

  /**
   * Handle task request
   */
  private async handleTaskRequest(
    agent: AgentCapability,
    request: RouteRequest,
    session: SessionInfo
  ): Promise<unknown> {
    const payload = request.payload as any;
    const { runId } = await this.swarmService.runSwarm({
      objective: payload.objective || String(request.payload),
      maxAgents: payload.maxAgents || 3,
      timeout: request.timeout || 300000,
      // @ts-expect-error - Post-Merge Reconciliation
      context: {
        sessionId: session.sessionId,
        channel: session.channel,
        agentId: agent.agentId
      }
    });

    return { runId, sessionId: session.sessionId };
  }

  /**
   * Handle tool request
   */
  private async handleToolRequest(
    agent: AgentCapability,
    request: RouteRequest,
    session: SessionInfo
  ): Promise<unknown> {
    // Tool requests could be routed to specialized tool agents
    // For now, treat as lightweight task
    return this.handleTaskRequest(agent, request, session);
  }

  /**
   * Handle system request
   */
  private async handleSystemRequest(
    agent: AgentCapability,
    request: RouteRequest,
    session: SessionInfo
  ): Promise<unknown> {
    const payload = request.payload as any;
    
    switch (payload.action) {
      case 'status':
        return this.getSystemStatus();
      case 'metrics':
        return this.getAgentMetrics();
      case 'sessions':
        return this.getSessionStats();
      default:
        throw new Error(`Unsupported system action: ${payload.action}`);
    }
  }

  /**
   * Initialize default routing strategies
   */
  private initializeDefaultStrategies(): void {
    // Load-balanced strategy
    this.routingStrategies.set('load-balanced', {
      name: 'load-balanced',
      selectAgent: (request, agents) => {
        return agents.reduce((best, current) => {
          if (!best) return current;
          
          const bestScore = best.reliability * (1 - best.currentLoad / best.maxConcurrentRequests);
          const currentScore = current.reliability * (1 - current.currentLoad / current.maxConcurrentRequests);
          
          return currentScore > bestScore ? current : best;
        });
      }
    });

    // Round-robin strategy
    let roundRobinIndex = 0;
    this.routingStrategies.set('round-robin', {
      name: 'round-robin',
      selectAgent: (request, agents) => {
        if (agents.length === 0) return null;
        const selected = agents[roundRobinIndex % agents.length];
        roundRobinIndex++;
        return selected;
      }
    });

    // Priority to fastest strategy
    this.routingStrategies.set('fastest', {
      name: 'fastest',
      selectAgent: (request, agents) => {
        return agents.reduce((fastest, current) => {
          if (!fastest) return current;
          return current.averageResponseTime < fastest.averageResponseTime ? current : fastest;
        });
      }
    });
  }

  /**
   * Update agent performance metrics
   */
  private updateAgentMetrics(agentId: string, responseTime: number, success: boolean): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    const alpha = 0.1; // Exponential moving average factor
    const newAverageResponseTime = agent.averageResponseTime * (1 - alpha) + responseTime * alpha;
    
    // Update reliability based on success/failure
    const reliabilityDelta = success ? 0.01 : -0.05;
    const newReliability = Math.max(0, Math.min(1, agent.reliability + reliabilityDelta));

    this.updateAgentStatus(agentId, {
      averageResponseTime: newAverageResponseTime,
      reliability: newReliability
    });
  }

  /**
   * Start health monitoring for agents
   */
  private startHealthMonitoring(): void {
    setInterval(() => {
      const now = Date.now();
      const healthTimeout = 10 * 60 * 1000; // 10 minutes

      for (const [agentId, agent] of this.agents.entries()) {
        if (now - agent.lastSeen > healthTimeout) {
          this.unregisterAgent(agentId);
        }
      }
    }, 60 * 1000); // Check every minute
  }

  /**
   * Get system status
   */
  private getSystemStatus(): object {
    return {
      totalAgents: this.agents.size,
      activeRequests: this.activeRequests.size,
      strategies: Array.from(this.routingStrategies.keys()),
      defaultStrategy: this.defaultStrategy,
      uptime: process.uptime(),
      timestamp: Date.now()
    };
  }

  /**
   * Get agent metrics
   */
  private getAgentMetrics(): object {
    const agents = Array.from(this.agents.values());
    return {
      agents: agents.map(agent => ({
        agentId: agent.agentId,
        channels: agent.channels,
        taskTypes: agent.taskTypes,
        currentLoad: agent.currentLoad,
        maxLoad: agent.maxConcurrentRequests,
        loadPercentage: Math.round((agent.currentLoad / agent.maxConcurrentRequests) * 100),
        averageResponseTime: Math.round(agent.averageResponseTime),
        reliability: Math.round(agent.reliability * 100),
        lastSeen: agent.lastSeen
      })),
      totals: {
        totalAgents: agents.length,
        totalCurrentLoad: agents.reduce((sum, a) => sum + a.currentLoad, 0),
        totalMaxLoad: agents.reduce((sum, a) => sum + a.maxConcurrentRequests, 0),
        averageReliability: agents.reduce((sum, a) => sum + a.reliability, 0) / agents.length || 0
      }
    };
  }

  /**
   * Get session statistics
   */
  private getSessionStats(): object {
    return this.sessionManager.getStats();
  }

  /**
   * Set routing strategy
   */
  setRoutingStrategy(strategyName: string): boolean {
    if (this.routingStrategies.has(strategyName)) {
      this.defaultStrategy = strategyName;
      return true;
    }
    return false;
  }

  /**
   * Add custom routing strategy
   */
  addRoutingStrategy(strategy: RoutingStrategy): void {
    this.routingStrategies.set(strategy.name, strategy);
  }

  /**
   * Get router statistics
   */
  getStats(): object {
    return {
      agents: this.getAgentMetrics(),
      sessions: this.getSessionStats(),
      system: this.getSystemStatus()
    };
  }
}

// Singleton instance
let routerInstance: GatewayRouter | null = null;

export function getGatewayRouter(): GatewayRouter {
  if (!routerInstance) {
    routerInstance = new GatewayRouter();
  }
  return routerInstance;
}