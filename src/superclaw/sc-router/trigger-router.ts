import { EventEmitter } from 'events';

// Simple logger interface
interface Logger {
  log(message: string, context?: string): void;
  error(message: string, trace?: string, context?: string): void;
  warn(message: string, context?: string): void;
  debug(message: string, context?: string): void;
}

// Simple console logger implementation
class ConsoleLogger implements Logger {
  log(message: string, context?: string): void {
    console.log(`[${context || 'TriggerRouter'}] ${message}`);
  }
  
  error(message: string, trace?: string, context?: string): void {
    console.error(`[${context || 'TriggerRouter'}] ${message}`, trace || '');
  }
  
  warn(message: string, context?: string): void {
    console.warn(`[${context || 'TriggerRouter'}] ${message}`);
  }
  
  debug(message: string, context?: string): void {
    console.debug(`[${context || 'TriggerRouter'}] ${message}`);
  }
}

// Core interfaces
export interface RawTrigger {
  id: string;
  type: TriggerType;
  channel: string;
  payload: any;
  metadata: TriggerMetadata;
  timestamp: Date;
  source: string;
}

export interface TriggerMetadata {
  userId?: string;
  sessionId?: string;
  ip?: string;
  userAgent?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  tags?: string[];
  context?: Record<string, any>;
}

export type TriggerType = 'http' | 'ws' | 'cli' | 'cron' | 'channel' | 'webhook';

export interface ProcessedTrigger extends RawTrigger {
  session: SessionContext;
  cortexData: CortexContext;
  routingDecision: RoutingDecision;
}

export interface SessionContext {
  sessionId: string;
  userId: string;
  agentId?: string;
  permissions: string[];
  state: Record<string, any>;
  history: TriggerHistory[];
}

export interface CortexContext {
  memory: MemoryFragment[];
  activeProjects: Project[];
  userPreferences: UserPreferences;
  contextWindow: ContextWindow;
}

export interface RoutingDecision {
  targetAgent: string;
  swarmMode: 'single' | 'parallel' | 'sequential' | 'fanout';
  agents: AgentAssignment[];
  priority: number;
  timeout: number;
}

export interface AgentAssignment {
  agentId: string;
  role: string;
  model: string;
  resources: AgentResources;
}

export interface TriggerResponse {
  success: boolean;
  data?: any;
  error?: string;
  metadata: ResponseMetadata;
}

export interface ResponseMetadata {
  executionTime: number;
  agentsUsed: string[];
  tokensUsed?: number;
  cost?: number;
  deliveryChannel: string;
}

// Dependencies (injected interfaces)
export interface ISessionManager {
  resolveSession(trigger: RawTrigger): Promise<SessionContext>;
  updateSession(sessionId: string, updates: Partial<SessionContext>): Promise<void>;
}

export interface ICortex {
  loadContext(sessionContext: SessionContext): Promise<CortexContext>;
  updateContext(sessionId: string, updates: Partial<CortexContext>): Promise<void>;
}

export interface ISwarmEngine {
  dispatch(trigger: ProcessedTrigger): Promise<TriggerResponse>;
  getAvailableAgents(): Promise<AgentInfo[]>;
  checkCapacity(): Promise<SwarmCapacity>;
}

export interface IOutputFormatter {
  format(response: TriggerResponse, trigger: RawTrigger): Promise<FormattedOutput>;
}

export interface IDeliveryService {
  deliver(output: FormattedOutput, channel: string): Promise<DeliveryResult>;
}

// Supporting types
interface TriggerHistory {
  triggerId: string;
  timestamp: Date;
  type: TriggerType;
  success: boolean;
}

interface MemoryFragment {
  id: string;
  content: string;
  timestamp: Date;
  relevance: number;
}

interface Project {
  id: string;
  name: string;
  status: string;
  context: Record<string, any>;
}

interface UserPreferences {
  defaultModel: string;
  responseFormat: string;
  timezone: string;
  language: string;
}

interface ContextWindow {
  size: number;
  tokens: number;
  relevantHistory: TriggerHistory[];
}

interface AgentResources {
  maxTokens: number;
  timeout: number;
  priority: number;
}

interface AgentInfo {
  id: string;
  name: string;
  capabilities: string[];
  status: 'available' | 'busy' | 'offline';
  load: number;
}

interface SwarmCapacity {
  maxConcurrentAgents: number;
  currentActiveAgents: number;
  queueSize: number;
  estimatedWaitTime: number;
}

interface FormattedOutput {
  content: string;
  format: 'text' | 'html' | 'json' | 'markdown';
  attachments?: Attachment[];
  metadata: Record<string, any>;
}

interface Attachment {
  filename: string;
  content: Buffer;
  mimeType: string;
}

interface DeliveryResult {
  success: boolean;
  deliveredAt: Date;
  messageId?: string;
  error?: string;
}

export class TriggerRouter {
  private readonly logger = new ConsoleLogger();
  private readonly eventEmitter = new EventEmitter();

  constructor(
    private readonly sessionManager: ISessionManager,
    private readonly cortex: ICortex,
    private readonly swarmEngine: ISwarmEngine,
    private readonly outputFormatter: IOutputFormatter,
    private readonly deliveryService: IDeliveryService,
  ) {}

  /**
   * Main entry point for all triggers
   */
  async routeTrigger(rawTrigger: RawTrigger): Promise<TriggerResponse> {
    const startTime = Date.now();
    this.logger.log(`Processing trigger ${rawTrigger.id} of type ${rawTrigger.type}`);

    try {
      // Emit trigger received event
      this.eventEmitter.emit('trigger.received', rawTrigger);

      // Step 1: Resolve session context
      const sessionContext = await this.resolveSession(rawTrigger);

      // Step 2: Load cortex context
      const cortexContext = await this.loadCortexContext(sessionContext);

      // Step 3: Make routing decision
      const routingDecision = await this.makeRoutingDecision(rawTrigger, sessionContext, cortexContext);

      // Step 4: Create processed trigger
      const processedTrigger: ProcessedTrigger = {
        ...rawTrigger,
        session: sessionContext,
        cortexData: cortexContext,
        routingDecision,
      };

      // Step 5: Dispatch to swarm engine
      const response = await this.dispatchToSwarm(processedTrigger);

      // Step 6: Format and deliver output
      await this.formatAndDeliver(response, rawTrigger);

      // Step 7: Update execution metrics
      response.metadata.executionTime = Date.now() - startTime;

      this.logger.log(`Successfully processed trigger ${rawTrigger.id} in ${response.metadata.executionTime}ms`);
      this.eventEmitter.emit('trigger.completed', { trigger: rawTrigger, response });

      return response;

    } catch (error) {
      const errorResponse: TriggerResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          executionTime: Date.now() - startTime,
          agentsUsed: [],
          deliveryChannel: rawTrigger.channel,
        },
      };

      this.logger.error(
        `Failed to process trigger ${rawTrigger.id}: ${error instanceof Error ? error.message : 'Unknown error'}`, 
        error instanceof Error ? error.stack : undefined
      );
      this.eventEmitter.emit('trigger.failed', { trigger: rawTrigger, error });

      return errorResponse;
    }
  }

  /**
   * HTTP trigger handler
   */
  async handleHttpTrigger(req: any, res: any): Promise<void> {
    const rawTrigger: RawTrigger = {
      id: this.generateTriggerId(),
      type: 'http',
      channel: 'http',
      payload: {
        method: req.method,
        path: req.path,
        query: req.query,
        body: req.body,
        headers: req.headers,
      },
      metadata: {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        priority: 'normal',
      },
      timestamp: new Date(),
      source: 'http-api',
    };

    const response = await this.routeTrigger(rawTrigger);
    
    if (response.success) {
      res.status(200).json(response.data);
    } else {
      res.status(500).json({ error: response.error });
    }
  }

  /**
   * WebSocket trigger handler
   */
  async handleWebSocketTrigger(socket: any, message: any): Promise<void> {
    const rawTrigger: RawTrigger = {
      id: this.generateTriggerId(),
      type: 'ws',
      channel: 'websocket',
      payload: message,
      metadata: {
        sessionId: socket.sessionId,
        priority: 'high',
      },
      timestamp: new Date(),
      source: 'websocket',
    };

    const response = await this.routeTrigger(rawTrigger);
    socket.emit('response', response);
  }

  /**
   * CLI trigger handler
   */
  async handleCliTrigger(command: string, args: string[], context: any): Promise<TriggerResponse> {
    const rawTrigger: RawTrigger = {
      id: this.generateTriggerId(),
      type: 'cli',
      channel: 'cli',
      payload: {
        command,
        args,
        cwd: context.cwd,
        env: context.env,
      },
      metadata: {
        userId: context.userId,
        priority: 'normal',
      },
      timestamp: new Date(),
      source: 'cli',
    };

    return await this.routeTrigger(rawTrigger);
  }

  /**
   * Cron trigger handler
   */
  async handleCronTrigger(jobName: string, schedule: string, payload: any): Promise<void> {
    const rawTrigger: RawTrigger = {
      id: this.generateTriggerId(),
      type: 'cron',
      channel: 'system',
      payload: {
        jobName,
        schedule,
        data: payload,
      },
      metadata: {
        priority: 'low',
        tags: ['automated', 'cron'],
      },
      timestamp: new Date(),
      source: 'cron-scheduler',
    };

    await this.routeTrigger(rawTrigger);
  }

  /**
   * Channel trigger handler (Discord, Slack, etc.)
   */
  async handleChannelTrigger(channelType: string, channelId: string, message: any): Promise<void> {
    const rawTrigger: RawTrigger = {
      id: this.generateTriggerId(),
      type: 'channel',
      channel: `${channelType}:${channelId}`,
      payload: message,
      metadata: {
        userId: message.author?.id,
        priority: message.mentions?.everyone ? 'high' : 'normal',
        tags: [channelType, 'social'],
      },
      timestamp: new Date(),
      source: channelType,
    };

    await this.routeTrigger(rawTrigger);
  }

  /**
   * Webhook trigger handler
   */
  async handleWebhookTrigger(source: string, payload: any, headers: any): Promise<TriggerResponse> {
    const rawTrigger: RawTrigger = {
      id: this.generateTriggerId(),
      type: 'webhook',
      channel: 'webhook',
      payload,
      metadata: {
        priority: 'normal',
        tags: ['webhook', source],
        context: { headers },
      },
      timestamp: new Date(),
      source,
    };

    return await this.routeTrigger(rawTrigger);
  }

  // Private helper methods

  private async resolveSession(trigger: RawTrigger): Promise<SessionContext> {
    try {
      return await this.sessionManager.resolveSession(trigger);
    } catch (error) {
      this.logger.warn(`Failed to resolve session for trigger ${trigger.id}, creating anonymous session`);
      
      // Create anonymous session for failed session resolution
      return {
        sessionId: this.generateSessionId(),
        userId: 'anonymous',
        permissions: ['basic'],
        state: {},
        history: [],
      };
    }
  }

  private async loadCortexContext(sessionContext: SessionContext): Promise<CortexContext> {
    try {
      return await this.cortex.loadContext(sessionContext);
    } catch (error) {
      this.logger.warn(`Failed to load cortex context for session ${sessionContext.sessionId}`);
      
      // Return minimal context on failure
      return {
        memory: [],
        activeProjects: [],
        userPreferences: {
          defaultModel: 'claude-sonnet',
          responseFormat: 'text',
          timezone: 'UTC',
          language: 'en',
        },
        contextWindow: {
          size: 4096,
          tokens: 0,
          relevantHistory: [],
        },
      };
    }
  }

  private async makeRoutingDecision(
    trigger: RawTrigger,
    session: SessionContext,
    cortex: CortexContext,
  ): Promise<RoutingDecision> {
    // Default routing logic - can be enhanced with ML/rules engine
    const defaultAgent = cortex.userPreferences.defaultModel || 'claude-sonnet';
    
    // Determine swarm mode based on trigger complexity
    let swarmMode: 'single' | 'parallel' | 'sequential' | 'fanout' = 'single';
    
    if (trigger.metadata.tags?.includes('complex') || trigger.payload?.length > 10000) {
      swarmMode = 'parallel';
    }
    
    if (trigger.metadata.priority === 'urgent') {
      swarmMode = 'fanout';
    }

    return {
      targetAgent: defaultAgent,
      swarmMode,
      agents: [{
        agentId: defaultAgent,
        role: 'primary',
        model: defaultAgent,
        resources: {
          maxTokens: 4096,
          timeout: 30000,
          priority: trigger.metadata.priority === 'urgent' ? 10 : 5,
        },
      }],
      priority: this.getPriorityScore(trigger.metadata.priority),
      timeout: 60000,
    };
  }

  private async dispatchToSwarm(processedTrigger: ProcessedTrigger): Promise<TriggerResponse> {
    return await this.swarmEngine.dispatch(processedTrigger);
  }

  private async formatAndDeliver(response: TriggerResponse, trigger: RawTrigger): Promise<void> {
    try {
      const formattedOutput = await this.outputFormatter.format(response, trigger);
      await this.deliveryService.deliver(formattedOutput, trigger.channel);
    } catch (error) {
      this.logger.error(`Failed to format/deliver response for trigger ${trigger.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private generateTriggerId(): string {
    return `trigger_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getPriorityScore(priority?: string): number {
    switch (priority) {
      case 'urgent': return 10;
      case 'high': return 7;
      case 'normal': return 5;
      case 'low': return 2;
      default: return 5;
    }
  }

  /**
   * Health check for the router
   */
  async healthCheck(): Promise<{ status: string; details: any }> {
    try {
      const swarmCapacity = await this.swarmEngine.checkCapacity();
      
      return {
        status: 'healthy',
        details: {
          timestamp: new Date().toISOString(),
          swarmCapacity,
          uptime: process.uptime(),
          memoryUsage: process.memoryUsage(),
        },
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString(),
        },
      };
    }
  }

  /**
   * Get router metrics
   */
  async getMetrics(): Promise<any> {
    // Implementation would return routing metrics, performance stats, etc.
    return {
      triggersProcessed: 0, // TODO: implement counters
      averageResponseTime: 0,
      errorRate: 0,
      activeAgents: await this.swarmEngine.getAvailableAgents(),
    };
  }
}