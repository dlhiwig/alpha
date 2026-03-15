/**
 * SuperClaw Gateway WebSocket Layer
 * Real-time event streaming for swarm operations, agent status, and cost monitoring
 */

import { WebSocket } from 'ws';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { getSwarmService, SwarmEvent } from '../core/swarm-service';
// @ts-expect-error - Post-Merge Reconciliation
import { getCostController } from '../skynet/cost-control';
import { getThresholdEnforcer } from '../skynet/thresholds';
import { EventEmitter } from 'events';

// --- Types ---

export interface WebSocketClient {
  id: string;
  socket: WebSocket;
  userId?: string;
  subscriptions: Set<string>;
  lastPing: Date;
  authenticated: boolean;
  metadata: {
    userAgent?: string;
    ip?: string;
    connectedAt: Date;
    totalMessages: number;
  };
}

export interface WebSocketMessage {
  type: string;
  payload: any;
  timestamp: Date;
  clientId?: string;
}

export interface SubscriptionRequest {
  type: 'subscribe' | 'unsubscribe';
  channels: string[];
}

export interface AuthenticationRequest {
  type: 'auth';
  token: string;
}

export interface PingPongMessage {
  type: 'ping' | 'pong';
  timestamp: Date;
}

// Event channels
export type EventChannel = 
  | 'swarm.events'        // All swarm events
  | 'agent.status'        // Agent lifecycle events
  | 'cost.updates'        // Cost tracking updates
  | 'threshold.alerts'    // Threshold violations
  | 'system.health'       // System health metrics
  | `swarm.run.${string}` // Specific run events

export interface AgentStatusEvent {
  type: 'agent.status';
  agentId: string;
  runId?: string;
  status: 'starting' | 'running' | 'idle' | 'completed' | 'failed' | 'terminated';
  model?: string;
  role?: string;
  task?: string;
  metrics?: {
    cpuUsage?: number;
    memoryUsage?: number;
    tokensProcessed?: number;
    costAccumulated?: number;
  };
  timestamp: Date;
}

export interface CostUpdateEvent {
  type: 'cost.update';
  agentId?: string;
  runId?: string;
  model: string;
  costUSD: number;
  tokensUsed: {
    input: number;
    output: number;
  };
  dailyTotal: number;
  agentTotal?: number;
  timestamp: Date;
}

export interface ThresholdAlertEvent {
  type: 'threshold.alert';
  alertType: 'warning' | 'limit' | 'emergency';
  resource: 'cost' | 'agents' | 'tokens' | 'memory';
  current: number;
  limit: number;
  percentage: number;
  agentId?: string;
  runId?: string;
  timestamp: Date;
}

export interface SystemHealthEvent {
  type: 'system.health';
  uptime: number;
  activeAgents: number;
  activeRuns: number;
  memoryUsage: {
    used: number;
    total: number;
    percentage: number;
  };
  costs: {
    today: number;
    thisHour: number;
  };
  timestamp: Date;
}

// --- WebSocket Manager ---

export class WebSocketManager extends EventEmitter {
  private clients: Map<string, WebSocketClient> = new Map();
  private swarmService = getSwarmService();
  private costController = getCostController();
  private thresholdEnforcer = getThresholdEnforcer();
  private healthInterval?: NodeJS.Timeout;
  private pingInterval?: NodeJS.Timeout;
  private apiKey?: string;

  private readonly PING_INTERVAL = 30000; // 30 seconds
  private readonly CLIENT_TIMEOUT = 60000; // 1 minute
  private readonly MAX_CLIENTS = 1000;

  constructor(apiKey?: string) {
    super();
    this.apiKey = apiKey;
    this.setupEventListeners();
    this.startHealthMonitoring();
    this.startPingPong();
  }

  // --- Client Management ---

  addClient(socket: WebSocket, request: FastifyRequest): string {
    if (this.clients.size >= this.MAX_CLIENTS) {
      socket.close(1013, 'Server overloaded');
      throw new Error('Maximum clients exceeded');
    }

    const clientId = this.generateClientId();
    const client: WebSocketClient = {
      id: clientId,
      socket,
      subscriptions: new Set(),
      lastPing: new Date(),
      authenticated: !this.apiKey, // Auto-auth if no API key required
      metadata: {
        userAgent: request.headers['user-agent'],
        ip: request.ip,
        connectedAt: new Date(),
        totalMessages: 0,
      }
    };

    this.clients.set(clientId, client);
    
    // Setup socket event handlers
    this.setupSocketHandlers(client);

    // Send welcome message
    this.sendToClient(client, {
      type: 'connection.established',
      payload: {
        clientId,
        authenticated: client.authenticated,
        availableChannels: this.getAvailableChannels(),
        serverTime: new Date().toISOString(),
      }
    });

    this.emit('client.connected', { clientId, ip: client.metadata.ip });
    
    return clientId;
  }

  private setupSocketHandlers(client: WebSocketClient): void {
    const { socket } = client;

    socket.on('message', (data) => {
      try {
        client.metadata.totalMessages++;
        const message = JSON.parse(data.toString());
        this.handleClientMessage(client, message);
      } catch (error: unknown) {
        this.sendError(client, 'Invalid message format');
      }
    });

    socket.on('close', (code, reason) => {
      this.removeClient(client.id);
      this.emit('client.disconnected', { 
        clientId: client.id, 
        code, 
        reason: reason.toString(),
        totalMessages: client.metadata.totalMessages
      });
    });

    socket.on('error', (error) => {
      console.error(`WebSocket error for client ${client.id}:`, error);
      this.removeClient(client.id);
    });

    socket.on('pong', () => {
      client.lastPing = new Date();
    });
  }

  private handleClientMessage(client: WebSocketClient, message: any): void {
    // Authentication
    if (message.type === 'auth') {
      this.handleAuthentication(client, message as AuthenticationRequest);
      return;
    }

    // Require authentication for protected operations
    if (this.apiKey && !client.authenticated) {
      this.sendError(client, 'Authentication required');
      return;
    }

    // Handle different message types
    switch (message.type) {
      case 'subscribe':
      case 'unsubscribe':
        this.handleSubscription(client, message as SubscriptionRequest);
        break;
      
      case 'ping':
        this.sendToClient(client, { type: 'pong', payload: { timestamp: new Date() } });
        break;

      case 'get.status':
        this.sendSystemStatus(client);
        break;

      case 'get.runs':
        this.sendActiveRuns(client);
        break;

      default:
        this.sendError(client, `Unknown message type: ${message.type}`);
    }
  }

  private handleAuthentication(client: WebSocketClient, message: AuthenticationRequest): void {
    if (!this.apiKey) {
      client.authenticated = true;
      this.sendToClient(client, { type: 'auth.success', payload: { authenticated: true } });
      return;
    }

    if (message.token === this.apiKey) {
      client.authenticated = true;
      this.sendToClient(client, { type: 'auth.success', payload: { authenticated: true } });
    } else {
      this.sendToClient(client, { type: 'auth.failed', payload: { error: 'Invalid token' } });
      setTimeout(() => client.socket.close(1008, 'Authentication failed'), 1000);
    }
  }

  private handleSubscription(client: WebSocketClient, message: SubscriptionRequest): void {
    const { type, channels } = message;
    
    for (const channel of channels) {
      if (!this.isValidChannel(channel)) {
        this.sendError(client, `Invalid channel: ${channel}`);
        continue;
      }

      if (type === 'subscribe') {
        client.subscriptions.add(channel);
      } else {
        client.subscriptions.delete(channel);
      }
    }

    this.sendToClient(client, {
      type: 'subscription.updated',
      payload: {
        subscriptions: Array.from(client.subscriptions)
      }
    });
  }

  private removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.socket.terminate();
      this.clients.delete(clientId);
    }
  }

  // --- Event Broadcasting ---

  private setupEventListeners(): void {
    // Swarm events
    this.swarmService.on('swarm-event', (event: SwarmEvent) => {
      this.broadcastToChannel('swarm.events', {
        type: 'swarm.event',
        payload: event
      });

      // Also broadcast to specific run channel if runId exists
      if ('runId' in event) {
        this.broadcastToChannel(`swarm.run.${event.runId}`, {
          type: 'swarm.event',
          payload: event
        });
      }

      // Generate agent status events from swarm events
      if (event.event === 'task.started' || event.event === 'task.completed' || event.event === 'task.failed') {
        const agentEvent: AgentStatusEvent = {
          type: 'agent.status',
          agentId: event.taskId,
          runId: event.runId,
          status: event.event === 'task.started' ? 'running' : 
                  event.event === 'task.completed' ? 'completed' : 'failed',
          role: event.role,
          timestamp: new Date()
        };
        
        this.broadcastToChannel('agent.status', {
          type: 'agent.status',
          payload: agentEvent
        });
      }
    });

    // Cost controller events
    this.costController.on('cost-update', (data: any) => {
      const costEvent: CostUpdateEvent = {
        type: 'cost.update',
        agentId: data.agentId,
        runId: data.runId,
        model: data.model,
        costUSD: data.costUSD,
        tokensUsed: data.tokensUsed || { input: 0, output: 0 },
        dailyTotal: data.dailyTotal,
        agentTotal: data.agentTotal,
        timestamp: new Date()
      };

      this.broadcastToChannel('cost.updates', {
        type: 'cost.update',
        payload: costEvent
      });
    });

    // Threshold alerts
    // @ts-expect-error - Post-Merge Reconciliation
    this.thresholdEnforcer.on('threshold-violation', (data: any) => {
      const alertEvent: ThresholdAlertEvent = {
        type: 'threshold.alert',
        alertType: data.severity === 'critical' ? 'emergency' : 
                   data.severity === 'high' ? 'limit' : 'warning',
        resource: data.resource,
        current: data.current,
        limit: data.limit,
        percentage: (data.current / data.limit) * 100,
        agentId: data.agentId,
        runId: data.runId,
        timestamp: new Date()
      };

      this.broadcastToChannel('threshold.alerts', {
        type: 'threshold.alert',
        payload: alertEvent
      });
    });
  }

  private broadcastToChannel(channel: EventChannel, message: Omit<WebSocketMessage, 'timestamp'>): void {
    const fullMessage: WebSocketMessage = {
      ...message,
      timestamp: new Date()
    };

    for (const client of this.clients.values()) {
      if (client.subscriptions.has(channel) && client.socket.readyState === WebSocket.OPEN) {
        try {
          client.socket.send(JSON.stringify(fullMessage));
        } catch (error: unknown) {
          console.error(`Failed to send message to client ${client.id}:`, error);
          this.removeClient(client.id);
        }
      }
    }
  }

  // --- System Monitoring ---

  private startHealthMonitoring(): void {
    this.healthInterval = setInterval(() => {
      this.broadcastSystemHealth();
    }, 30000); // Every 30 seconds
  }

  private broadcastSystemHealth(): void {
    const memUsage = process.memoryUsage();
    const costStats = this.costController.getTodayStats();
    
    const healthEvent: SystemHealthEvent = {
      type: 'system.health',
      uptime: process.uptime(),
      // @ts-expect-error - Post-Merge Reconciliation
      activeAgents: this.swarmService.getActiveAgentCount?.() || 0,
      // @ts-expect-error - Post-Merge Reconciliation
      activeRuns: this.swarmService.getActiveRunCount?.() || 0,
      memoryUsage: {
        used: memUsage.heapUsed,
        total: memUsage.heapTotal,
        percentage: (memUsage.heapUsed / memUsage.heapTotal) * 100
      },
      costs: {
        today: costStats?.totalSpent || 0,
        thisHour: costStats?.lastHourSpent || 0
      },
      timestamp: new Date()
    };

    this.broadcastToChannel('system.health', {
      type: 'system.health',
      payload: healthEvent
    });
  }

  private startPingPong(): void {
    this.pingInterval = setInterval(() => {
      const now = new Date();
      
      for (const client of this.clients.values()) {
        // Check for stale connections
        const timeSinceLastPing = now.getTime() - client.lastPing.getTime();
        
        if (timeSinceLastPing > this.CLIENT_TIMEOUT) {
          console.log(`Removing stale client ${client.id}`);
          this.removeClient(client.id);
          continue;
        }

        // Send ping
        if (client.socket.readyState === WebSocket.OPEN) {
          try {
            client.socket.ping();
          } catch (error: unknown) {
            console.error(`Failed to ping client ${client.id}:`, error);
            this.removeClient(client.id);
          }
        }
      }
    }, this.PING_INTERVAL);
  }

  // --- Utility Methods ---

  private sendToClient(client: WebSocketClient, message: Omit<WebSocketMessage, 'timestamp' | 'clientId'>): void {
    if (client.socket.readyState === WebSocket.OPEN) {
      const fullMessage: WebSocketMessage = {
        ...message,
        timestamp: new Date(),
        clientId: client.id
      };
      
      try {
        client.socket.send(JSON.stringify(fullMessage));
      } catch (error: unknown) {
        console.error(`Failed to send message to client ${client.id}:`, error);
        this.removeClient(client.id);
      }
    }
  }

  private sendError(client: WebSocketClient, error: string): void {
    this.sendToClient(client, {
      type: 'error',
      payload: { error }
    });
  }

  private sendSystemStatus(client: WebSocketClient): void {
    const status = this.swarmService.getStatus();
    const costStats = this.costController.getTodayStats();
    const thresholds = this.thresholdEnforcer.getLimits();

    this.sendToClient(client, {
      type: 'system.status',
      payload: {
        swarm: status,
        costs: costStats,
        thresholds,
        clients: {
          total: this.clients.size,
          authenticated: Array.from(this.clients.values()).filter(c => c.authenticated).length
        }
      }
    });
  }

  private sendActiveRuns(client: WebSocketClient): void {
    const runs = this.swarmService.listRuns(50);
    this.sendToClient(client, {
      type: 'active.runs',
      payload: { runs }
    });
  }

  private generateClientId(): string {
    return `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private isValidChannel(channel: string): boolean {
    const validChannels = [
      'swarm.events',
      'agent.status', 
      'cost.updates',
      'threshold.alerts',
      'system.health'
    ];
    
    return validChannels.includes(channel) || channel.startsWith('swarm.run.');
  }

  private getAvailableChannels(): string[] {
    return [
      'swarm.events',
      'agent.status',
      'cost.updates', 
      'threshold.alerts',
      'system.health',
      'swarm.run.{runId}' // Dynamic channels
    ];
  }

  // --- Public API ---

  getStats() {
    return {
      totalClients: this.clients.size,
      authenticatedClients: Array.from(this.clients.values()).filter(c => c.authenticated).length,
      totalSubscriptions: Array.from(this.clients.values()).reduce((sum, c) => sum + c.subscriptions.size, 0),
      uptime: process.uptime()
    };
  }

  getClients() {
    return Array.from(this.clients.values()).map(client => ({
      id: client.id,
      authenticated: client.authenticated,
      subscriptions: Array.from(client.subscriptions),
      lastPing: client.lastPing,
      metadata: client.metadata
    }));
  }

  broadcastMessage(channel: EventChannel, message: any): void {
    this.broadcastToChannel(channel, {
      type: 'broadcast',
      payload: message
    });
  }

  shutdown(): void {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
    }
    
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    for (const client of this.clients.values()) {
      client.socket.close(1001, 'Server shutting down');
    }
    
    this.clients.clear();
  }
}

// --- Singleton Instance ---

let wsManager: WebSocketManager | null = null;

export function getWebSocketManager(apiKey?: string): WebSocketManager {
  if (!wsManager) {
    wsManager = new WebSocketManager(apiKey);
  }
  return wsManager;
}

// --- Fastify Plugin ---

export async function registerWebSocketRoutes(app: FastifyInstance, apiKey?: string): Promise<void> {
  const wsManager = getWebSocketManager(apiKey);

  // Global WebSocket endpoint for real-time events
  app.get('/ws', { websocket: true }, (socket, request) => {
    try {
      const clientId = wsManager.addClient(socket, request);
      console.log(`WebSocket client connected: ${clientId} from ${request.ip}`);
    } catch (error: unknown) {
      console.error('Failed to add WebSocket client:', error);
      socket.close(1013, 'Server error');
    }
  });

  // Run-specific WebSocket endpoint (maintains backward compatibility)
  app.get('/v1/swarm/:runId/stream', { websocket: true }, (socket, request) => {
    try {
      const { runId } = request.params as { runId: string };
      const clientId = wsManager.addClient(socket, request);
      
      // Auto-subscribe to run-specific events
      const client = wsManager['clients'].get(clientId);
      if (client) {
        client.subscriptions.add(`swarm.run.${runId}`);
        client.subscriptions.add('swarm.events');
        
        wsManager['sendToClient'](client, {
          type: 'auto.subscribed',
          payload: {
            channels: [`swarm.run.${runId}`, 'swarm.events'],
            runId
          }
        });
      }
      
      console.log(`WebSocket client connected for run ${runId}: ${clientId}`);
    } catch (error: unknown) {
      console.error('Failed to add run-specific WebSocket client:', error);
      socket.close(1013, 'Server error');
    }
  });

  // WebSocket stats endpoint
  app.get('/ws/stats', async () => {
    return wsManager.getStats();
  });

  // WebSocket clients endpoint
  app.get('/ws/clients', async () => {
    return { clients: wsManager.getClients() };
  });

  // Broadcast endpoint for admin use
  app.post('/ws/broadcast', async (request, reply) => {
    const body = request.body as { 
      channel: EventChannel;
      message: any;
    };

    if (!body.channel || !body.message) {
      reply.code(400).send({ error: 'channel and message are required' });
      return;
    }

    try {
      wsManager.broadcastMessage(body.channel, body.message);
      return { success: true, message: 'Broadcast sent' };
    } catch (error: unknown) {
      reply.code(500).send({ error: 'Failed to broadcast message' });
    }
  });

  // Graceful shutdown handler
  app.addHook('onClose', async () => {
    wsManager.shutdown();
  });
}