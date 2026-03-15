/**
 * Yegge Ecosystem Event Bridge
 * 
 * Unified event system connecting all Yegge components with SuperClaw:
 * - BEADS task/memory events
 * - Gas Town orchestration events  
 * - MCP Agent Mail communication events
 * - VC quality gate events
 * - EFRIT tool execution events
 * 
 * Enables cross-component coordination and SuperClaw integration.
 */

import { EventEmitter } from 'events';
import { YeggeConfig } from './config';

// Event types from each Yegge component
export type YeggeEvent = 
  | BeadsEvent
  | GastownEvent
  | MCPAgentMailEvent
  | VCEvent
  | EfritEvent
  | SuperClawYeggeEvent;

// BEADS Events - Memory & Task Management
export interface BeadsEvent {
  source: 'beads';
  type: 'task-created' | 'task-updated' | 'task-completed' | 'task-blocked' 
       | 'memory-compacted' | 'dependency-resolved' | 'epic-created';
  timestamp: number;
  data: {
    taskId?: string;
    epicId?: string;
    status?: 'ready' | 'in-progress' | 'completed' | 'blocked';
    dependencies?: string[];
    assignee?: string;
    memory?: {
      beforeSize: number;
      afterSize: number;
      compactionRatio: number;
    };
  };
}

// Gas Town Events - Multi-Agent Orchestration
export interface GastownEvent {
  source: 'gastown';
  type: 'mayor-decision' | 'agent-spawned' | 'agent-completed' | 'convoy-created' 
       | 'convoy-updated' | 'rig-created' | 'polecat-assigned' | 'work-distributed';
  timestamp: number;
  data: {
    mayorId?: string;
    agentId?: string;
    convoyId?: string;
    rigId?: string;
    polecatId?: string;
    decision?: {
      strategy: string;
      confidence: number;
      reasoning: string;
    };
    workDistribution?: {
      totalTasks: number;
      assignedTasks: number;
      queuedTasks: number;
    };
  };
}

// MCP Agent Mail Events - Inter-Agent Communication
export interface MCPAgentMailEvent {
  source: 'mcp-agent-mail';
  type: 'message-sent' | 'message-received' | 'message-read' | 'file-reserved' 
       | 'file-released' | 'agent-discovered' | 'contact-approved';
  timestamp: number;
  data: {
    messageId?: string;
    senderId?: string;
    recipientId?: string;
    threadId?: string;
    fileReservation?: {
      files: string[];
      reservationType: 'advisory' | 'exclusive';
      duration: number;
    };
    agentDiscovery?: {
      agentId: string;
      capabilities: string[];
      contactPolicy: string;
    };
  };
}

// VC Events - Quality Gates & Agent Colony
export interface VCEvent {
  source: 'vc';
  type: 'issue-claimed' | 'assessment-completed' | 'quality-gate-passed' 
       | 'quality-gate-failed' | 'issue-auto-created' | 'mission-completed';
  timestamp: number;
  data: {
    issueId?: string;
    missionId?: string;
    agentId?: string;
    assessment?: {
      strategy: string;
      steps: string[];
      risks: string[];
      confidence: number;
    };
    qualityGate?: {
      name: string;
      passed: boolean;
      output: string;
      duration: number;
    };
    mission?: {
      issuesCompleted: number;
      successRate: number;
      duration: number;
    };
  };
}

// EFRIT Events - Tool Execution
export interface EfritEvent {
  source: 'efrit';
  type: 'tool-executed' | 'session-started' | 'session-ended' | 'checkpoint-created' 
       | 'rollback-performed' | 'safety-check-failed';
  timestamp: number;
  data: {
    sessionId?: string;
    toolName?: string;
    checkpointId?: string;
    execution?: {
      command: string;
      success: boolean;
      output: string;
      duration: number;
      safetyChecks: string[];
    };
    rollback?: {
      reason: string;
      checkpointRestored: string;
      stateRecovered: boolean;
    };
  };
}

// SuperClaw-specific Yegge Events
export interface SuperClawYeggeEvent {
  source: 'superclaw-yegge';
  type: 'integration-started' | 'integration-stopped' | 'health-check' 
       | 'cross-project-coordination' | 'swarm-orchestration' | 'memory-sync';
  timestamp: number;
  data: {
    component?: string;
    healthStatus?: 'healthy' | 'degraded' | 'unhealthy';
    metrics?: {
      responseTime: number;
      errorRate: number;
      memoryUsage: number;
    };
    coordination?: {
      projectCount: number;
      activeAgents: number;
      sharedMemorySize: number;
    };
  };
}

// Event filtering and routing
export interface EventFilter {
  source?: string[];
  type?: string[];
  agentId?: string[];
  projectId?: string[];
  custom?: (event: YeggeEvent) => boolean;
}

export interface EventSubscription {
  id: string;
  filter: EventFilter;
  handler: (event: YeggeEvent) => void | Promise<void>;
  priority: number; // Higher number = higher priority
}

export class YeggeEventBridge extends EventEmitter {
  private config: YeggeConfig;
  private subscriptions: Map<string, EventSubscription> = new Map();
  private eventBuffer: YeggeEvent[] = [];
  private maxBufferSize: number;
  private batchingEnabled: boolean;
  private batchTimer: NodeJS.Timeout | null = null;
  private batchInterval: number = 100; // ms
  
  constructor(config: YeggeConfig) {
    super();
    this.config = config;
    this.maxBufferSize = config.superclaw.integration.eventBridge.bufferSize;
    this.batchingEnabled = config.superclaw.integration.eventBridge.batchingEnabled;
    
    // Set up automatic event processing
    this.setupEventProcessing();
  }
  
  // Emit events from any Yegge component
  publishEvent(event: YeggeEvent): void {
    if (!this.config.superclaw.integration.eventBridge.enabled) {
      return;
    }
    
    // Add metadata
    const enrichedEvent = {
      ...event,
      timestamp: event.timestamp || Date.now(),
      bridgeId: this.generateEventId(),
    };
    
    if (this.batchingEnabled) {
      this.eventBuffer.push(enrichedEvent);
      if (this.eventBuffer.length >= this.maxBufferSize) {
        this.flushEventBuffer();
      } else {
        this.scheduleBatchFlush();
      }
    } else {
      this.processEvent(enrichedEvent);
    }
  }
  
  // Subscribe to specific events
  subscribe(subscription: EventSubscription): () => void {
    this.subscriptions.set(subscription.id, subscription);
    
    // Return unsubscribe function
    return () => {
      this.subscriptions.delete(subscription.id);
    };
  }
  
  // Process individual events
  private processEvent(event: YeggeEvent): void {
    // Get matching subscriptions
    const matchingSubscriptions = Array.from(this.subscriptions.values())
      .filter(sub => this.matchesFilter(event, sub.filter))
      .sort((a, b) => b.priority - a.priority); // High priority first
    
    // Execute handlers
    for (const subscription of matchingSubscriptions) {
      try {
        const result = subscription.handler(event);
        if (result instanceof Promise) {
          result.catch(error => {
            console.error(`Event handler error for subscription ${subscription.id}:`, error);
          });
        }
      } catch (error: unknown) {
        console.error(`Event handler error for subscription ${subscription.id}:`, error);
      }
    }
    
    // Emit for EventEmitter listeners
    this.emit('yegge-event', event);
    this.emit(`yegge-event:${event.source}`, event);
    this.emit(`yegge-event:${event.source}:${event.type}`, event);
  }
  
  // Check if event matches filter
  private matchesFilter(event: YeggeEvent, filter: EventFilter): boolean {
    if (filter.source && !filter.source.includes(event.source)) {
      return false;
    }
    
    if (filter.type && !filter.type.includes(event.type)) {
      return false;
    }
    
    if (filter.agentId) {
      const eventAgentId = this.extractAgentId(event);
      if (!eventAgentId || !filter.agentId.includes(eventAgentId)) {
        return false;
      }
    }
    
    if (filter.custom && !filter.custom(event)) {
      return false;
    }
    
    return true;
  }
  
  // Extract agent ID from event data
  private extractAgentId(event: YeggeEvent): string | null {
    switch (event.source) {
      case 'beads':
        return event.data.assignee || null;
      case 'gastown':
        return event.data.agentId || event.data.polecatId || null;
      case 'mcp-agent-mail':
        return event.data.senderId || event.data.recipientId || null;
      case 'vc':
        return event.data.agentId || null;
      case 'efrit':
        return event.data.sessionId || null;
      default:
        return null;
    }
  }
  
  // Batching support
  private scheduleBatchFlush(): void {
    if (this.batchTimer) {
      return; // Already scheduled
    }
    
    this.batchTimer = setTimeout(() => {
      this.flushEventBuffer();
    }, this.batchInterval);
  }
  
  private flushEventBuffer(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    
    if (this.eventBuffer.length === 0) {
      return;
    }
    
    const events = [...this.eventBuffer];
    this.eventBuffer = [];
    
    // Process all buffered events
    for (const event of events) {
      this.processEvent(event);
    }
    
    // Emit batch event
    this.emit('yegge-event-batch', events);
  }
  
  // Event processing setup
  private setupEventProcessing(): void {
    // Handle process shutdown gracefully
    process.on('beforeExit', () => {
      this.flushEventBuffer();
    });
    
    // Set up health monitoring events
    if (this.config.superclaw.integration.healthMonitoring.enabled) {
      setInterval(() => {
        this.publishEvent({
          source: 'superclaw-yegge',
          type: 'health-check',
          timestamp: Date.now(),
          data: {
            healthStatus: 'healthy',
            metrics: {
              responseTime: 0,
              errorRate: 0,
              memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024, // MB
            },
          },
        });
      }, this.config.superclaw.integration.healthMonitoring.checkInterval * 1000);
    }
  }
  
  // Utility methods
  private generateEventId(): string {
    return `yegge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  // Get current statistics
  getStatistics(): {
    subscriptions: number;
    bufferedEvents: number;
    totalEventsProcessed: number;
  } {
    return {
      subscriptions: this.subscriptions.size,
      bufferedEvents: this.eventBuffer.length,
      totalEventsProcessed: 0, // Would track in production
    };
  }
  
  // Clear all subscriptions and buffers
  reset(): void {
    this.subscriptions.clear();
    this.eventBuffer = [];
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
  }
}

// Factory function for creating event bridge
export function createYeggeEventBridge(config: YeggeConfig): YeggeEventBridge {
  return new YeggeEventBridge(config);
}

// Helper functions for common event patterns
export class YeggeEventHelpers {
  static createBeadsTaskEvent(
    type: 'task-created' | 'task-updated' | 'task-completed',
    taskId: string,
    status?: string,
    assignee?: string
  ): BeadsEvent {
    return {
      source: 'beads',
      type,
      timestamp: Date.now(),
      data: {
        taskId,
        status: status as any,
        assignee,
      },
    };
  }
  
  static createGastownOrchestrationEvent(
    type: 'mayor-decision' | 'agent-spawned' | 'convoy-created',
    data: Partial<GastownEvent['data']>
  ): GastownEvent {
    return {
      source: 'gastown',
      type,
      timestamp: Date.now(),
      data,
    };
  }
  
  static createVCQualityGateEvent(
    gateName: string,
    passed: boolean,
    output: string,
    duration: number
  ): VCEvent {
    return {
      source: 'vc',
      type: passed ? 'quality-gate-passed' : 'quality-gate-failed',
      timestamp: Date.now(),
      data: {
        qualityGate: {
          name: gateName,
          passed,
          output,
          duration,
        },
      },
    };
  }
  
  static createMCPAgentMailEvent(
    type: 'message-sent' | 'file-reserved' | 'agent-discovered',
    data: Partial<MCPAgentMailEvent['data']>
  ): MCPAgentMailEvent {
    return {
      source: 'mcp-agent-mail',
      type,
      timestamp: Date.now(),
      data,
    };
  }
}

// Export singleton instance
let globalEventBridge: YeggeEventBridge | null = null;

export function getGlobalYeggeEventBridge(config?: YeggeConfig): YeggeEventBridge {
  if (!globalEventBridge && config) {
    globalEventBridge = new YeggeEventBridge(config);
  }
  
  if (!globalEventBridge) {
    throw new Error('Yegge Event Bridge not initialized. Provide config first.');
  }
  
  return globalEventBridge;
}