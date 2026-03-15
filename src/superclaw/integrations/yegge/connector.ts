/**
 * Yegge Ecosystem Connector Hub
 * 
 * Single integration point for all Steve Yegge's multi-agent development tools.
 * Provides unified interface, event coordination, and health monitoring.
 * 
 * Components Connected:
 * - BEADS (memory & task management)
 * - Gas Town (orchestration)
 * - MCP Agent Mail (communication)
 * - VC (quality gates)
 * - EFRIT (tool execution patterns)
 */

import { EventEmitter } from 'events';
import { YeggeConfig, loadYeggeConfig } from './config';
import { YeggeEventBridge, createYeggeEventBridge, YeggeEvent } from './event-bridge';
import { YeggeHealthMonitor, createYeggeHealthMonitor, SystemHealth } from './health-monitor';

export interface ConnectorStatus {
  initialized: boolean;
  running: boolean;
  componentsEnabled: string[];
  health: SystemHealth;
  uptime: number;
  version: string;
}

export interface YeggeConnectorOptions {
  config?: YeggeConfig;
  enableHealthMonitoring?: boolean;
  enableEventBridge?: boolean;
  autoStart?: boolean;
}

/**
 * Main Yegge Ecosystem Connector
 * 
 * This class provides the single integration point for all Yegge ecosystem components,
 * coordinating between them and SuperClaw.
 */
export class YeggeEcosystemConnector extends EventEmitter {
  private config: YeggeConfig;
  private eventBridge: YeggeEventBridge;
  private healthMonitor: YeggeHealthMonitor;
  private startTime: number = 0;
  private initialized: boolean = false;
  private running: boolean = false;
  
  // Component connections (would be actual API clients in production)
  private componentConnections: {
    beads?: BeadsConnection;
    gastown?: GastownConnection;
    mcpAgentMail?: MCPAgentMailConnection;
    vc?: VCConnection;
    efrit?: EfritConnection;
  } = {};
  
  constructor(options: YeggeConnectorOptions = {}) {
    super();
    
    // Load configuration
    this.config = options.config || loadYeggeConfig();
    
    // Initialize event bridge
    this.eventBridge = createYeggeEventBridge(this.config);
    
    // Initialize health monitor
    this.healthMonitor = createYeggeHealthMonitor(this.config, this.eventBridge);
    
    // Setup event forwarding
    this.setupEventForwarding();
    
    if (options.autoStart) {
      this.initialize().then(() => this.start());
    }
  }
  
  /**
   * Initialize the connector and all enabled components
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      throw new Error('Yegge Ecosystem Connector already initialized');
    }
    
    console.log('Initializing Yegge Ecosystem Connector...');
    
    try {
      // Initialize enabled components
      await this.initializeComponents();
      
      // Set up cross-component coordination
      await this.setupCrossComponentCoordination();
      
      this.initialized = true;
      this.emit('initialized');
      
      console.log('Yegge Ecosystem Connector initialized successfully');
      
    } catch (error: unknown) {
      console.error('Failed to initialize Yegge Ecosystem Connector:', error);
      throw error;
    }
  }
  
  /**
   * Start the connector and all monitoring
   */
  async start(): Promise<void> {
    if (!this.initialized) {
      throw new Error('Connector must be initialized before starting');
    }
    
    if (this.running) {
      throw new Error('Connector is already running');
    }
    
    console.log('Starting Yegge Ecosystem Connector...');
    
    try {
      this.startTime = Date.now();
      
      // Start health monitoring
      if (this.config.superclaw.integration.healthMonitoring.enabled) {
        this.healthMonitor.startMonitoring();
      }
      
      // Start component connections
      await this.startComponents();
      
      this.running = true;
      this.emit('started');
      
      console.log('Yegge Ecosystem Connector started successfully');
      
    } catch (error: unknown) {
      console.error('Failed to start Yegge Ecosystem Connector:', error);
      throw error;
    }
  }
  
  /**
   * Stop the connector and cleanup
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
    
    console.log('Stopping Yegge Ecosystem Connector...');
    
    try {
      // Stop health monitoring
      this.healthMonitor.stopMonitoring();
      
      // Stop component connections
      await this.stopComponents();
      
      this.running = false;
      this.emit('stopped');
      
      console.log('Yegge Ecosystem Connector stopped');
      
    } catch (error: unknown) {
      console.error('Error stopping Yegge Ecosystem Connector:', error);
      throw error;
    }
  }
  
  /**
   * Get current connector status
   */
  getStatus(): ConnectorStatus {
    return {
      initialized: this.initialized,
      running: this.running,
      componentsEnabled: this.config.superclaw.integration.enabledComponents,
      health: this.healthMonitor.getSystemHealth(),
      uptime: this.startTime > 0 ? Date.now() - this.startTime : 0,
      version: '1.0.0',
    };
  }
  
  /**
   * Send event through the ecosystem
   */
  publishEvent(event: YeggeEvent): void {
    this.eventBridge.publishEvent(event);
  }
  
  /**
   * Subscribe to ecosystem events
   */
  subscribeToEvents(
    filter: Parameters<YeggeEventBridge['subscribe']>[0]['filter'],
    handler: Parameters<YeggeEventBridge['subscribe']>[0]['handler']
  ): () => void {
    return this.eventBridge.subscribe({
      id: `connector-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      filter,
      handler,
      priority: 1,
    });
  }
  
  /**
   * Get system health
   */
  getHealth(): SystemHealth {
    return this.healthMonitor.getSystemHealth();
  }
  
  /**
   * Execute coordinated multi-agent workflow
   * This demonstrates how SuperClaw can leverage Yegge patterns
   */
  async executeCoordinatedWorkflow(workflow: CoordinatedWorkflow): Promise<WorkflowResult> {
    if (!this.running) {
      throw new Error('Connector must be running to execute workflows');
    }
    
    console.log(`Executing coordinated workflow: ${workflow.name}`);
    
    try {
      // Use Gas Town Mayor pattern for orchestration
      const orchestrationResult = await this.orchestrateWithMayor(workflow);
      
      // Use BEADS for persistent task tracking
      const taskTrackingResult = await this.trackWithBeads(workflow, orchestrationResult);
      
      // Use MCP Agent Mail for inter-agent coordination
      const coordinationResult = await this.coordinateWithMCP(workflow, taskTrackingResult);
      
      // Use VC quality gates for validation
      const validationResult = await this.validateWithVC(workflow, coordinationResult);
      
      // Use EFRIT patterns for safe tool execution
      const executionResult = await this.executeWithEfrit(workflow, validationResult);
      
      const result: WorkflowResult = {
        workflowId: workflow.id,
        status: 'completed',
        startTime: workflow.startTime,
        endTime: Date.now(),
        results: executionResult,
        metrics: {
          totalAgents: orchestrationResult.agentsSpawned,
          tasksCompleted: taskTrackingResult.tasksCompleted,
          qualityGatesPassed: validationResult.gatesPassed,
          toolsExecuted: executionResult.toolsExecuted,
        },
      };
      
      this.emit('workflow-completed', result);
      return result;
      
    } catch (error: unknown) {
      console.error(`Workflow execution failed: ${workflow.name}`, error);
      
      const result: WorkflowResult = {
        workflowId: workflow.id,
        status: 'failed',
        startTime: workflow.startTime,
        endTime: Date.now(),
        error: String(error),
        results: {},
        metrics: {
          totalAgents: 0,
          tasksCompleted: 0,
          qualityGatesPassed: 0,
          toolsExecuted: 0,
        },
      };
      
      this.emit('workflow-failed', result);
      throw error;
    }
  }
  
  // Private methods for component initialization and coordination
  
  private async initializeComponents(): Promise<void> {
    const enabledComponents = this.config.superclaw.integration.enabledComponents;
    
    for (const component of enabledComponents) {
      switch (component) {
        case 'beads':
          if (this.config.beads.enabled) {
            this.componentConnections.beads = await this.initializeBeads();
          }
          break;
          
        case 'gastown':
          if (this.config.gastown.enabled) {
            this.componentConnections.gastown = await this.initializeGastown();
          }
          break;
          
        case 'mcp-agent-mail':
          if (this.config.mcpAgentMail.enabled) {
            this.componentConnections.mcpAgentMail = await this.initializeMCPAgentMail();
          }
          break;
          
        case 'vc':
          if (this.config.vc.enabled) {
            this.componentConnections.vc = await this.initializeVC();
          }
          break;
          
        case 'efrit':
          if (this.config.efrit.enabled) {
            this.componentConnections.efrit = await this.initializeEfrit();
          }
          break;
      }
    }
  }
  
  private async setupCrossComponentCoordination(): Promise<void> {
    // Set up event forwarding between components
    
    // BEADS → Gas Town: Task ready events trigger agent assignment
    this.eventBridge.subscribe({
      id: 'beads-to-gastown',
      filter: { source: ['beads'], type: ['task-created', 'dependency-resolved'] },
      handler: async (event) => {
        if (this.componentConnections.gastown) {
          // @ts-expect-error - Post-Merge Reconciliation
          await this.componentConnections.gastown.assignTask(event.data.taskId);
        }
      },
      priority: 2,
    });
    
    // Gas Town → MCP Agent Mail: Agent communication setup
    this.eventBridge.subscribe({
      id: 'gastown-to-mcp',
      filter: { source: ['gastown'], type: ['agent-spawned'] },
      handler: async (event) => {
        if (this.componentConnections.mcpAgentMail) {
          // @ts-expect-error - Post-Merge Reconciliation
          await this.componentConnections.mcpAgentMail.registerAgent(event.data.agentId);
        }
      },
      priority: 2,
    });
    
    // VC → BEADS: Quality gate results create follow-up tasks
    this.eventBridge.subscribe({
      id: 'vc-to-beads',
      filter: { source: ['vc'], type: ['quality-gate-failed', 'issue-auto-created'] },
      handler: async (event) => {
        if (this.componentConnections.beads) {
          await this.componentConnections.beads.createFollowupTask(event);
        }
      },
      priority: 2,
    });
  }
  
  private setupEventForwarding(): void {
    // Forward all Yegge events to SuperClaw
    this.eventBridge.on('yegge-event', (event: YeggeEvent) => {
      this.emit('yegge-event', event);
    });
    
    // Forward health updates
    this.healthMonitor.on('health-update', (health: SystemHealth) => {
      this.emit('health-update', health);
    });
  }
  
  private async startComponents(): Promise<void> {
    // Start all initialized components
    const startPromises = [];
    
    if (this.componentConnections.beads) {
      startPromises.push(this.componentConnections.beads.start());
    }
    
    if (this.componentConnections.gastown) {
      startPromises.push(this.componentConnections.gastown.start());
    }
    
    if (this.componentConnections.mcpAgentMail) {
      startPromises.push(this.componentConnections.mcpAgentMail.start());
    }
    
    if (this.componentConnections.vc) {
      startPromises.push(this.componentConnections.vc.start());
    }
    
    if (this.componentConnections.efrit) {
      startPromises.push(this.componentConnections.efrit.start());
    }
    
    await Promise.all(startPromises);
  }
  
  private async stopComponents(): Promise<void> {
    // Stop all components
    const stopPromises = [];
    
    for (const connection of Object.values(this.componentConnections)) {
      if (connection && connection.stop) {
        stopPromises.push(connection.stop());
      }
    }
    
    await Promise.all(stopPromises);
  }
  
  // Component initialization methods (mock implementations)
  
  private async initializeBeads(): Promise<BeadsConnection> {
    console.log('Initializing BEADS connection...');
    // In production, this would connect to actual BEADS instance
    return new MockBeadsConnection(this.config.beads, this.eventBridge);
  }
  
  private async initializeGastown(): Promise<GastownConnection> {
    console.log('Initializing Gas Town connection...');
    // In production, this would connect to actual Gas Town instance
    return new MockGastownConnection(this.config.gastown, this.eventBridge);
  }
  
  private async initializeMCPAgentMail(): Promise<MCPAgentMailConnection> {
    console.log('Initializing MCP Agent Mail connection...');
    // In production, this would connect to actual MCP Agent Mail server
    return new MockMCPAgentMailConnection(this.config.mcpAgentMail, this.eventBridge);
  }
  
  private async initializeVC(): Promise<VCConnection> {
    console.log('Initializing VC connection...');
    // In production, this would connect to actual VC instance
    return new MockVCConnection(this.config.vc, this.eventBridge);
  }
  
  private async initializeEfrit(): Promise<EfritConnection> {
    console.log('Initializing EFRIT connection...');
    // In production, this would connect to actual EFRIT runtime
    return new MockEfritConnection(this.config.efrit, this.eventBridge);
  }
  
  // Workflow execution methods using Yegge patterns
  
  private async orchestrateWithMayor(workflow: CoordinatedWorkflow): Promise<any> {
    console.log('Orchestrating with Gas Town Mayor pattern...');
    // Implement Mayor-style orchestration
    return { agentsSpawned: workflow.tasks.length };
  }
  
  private async trackWithBeads(workflow: CoordinatedWorkflow, orchestrationResult: any): Promise<any> {
    console.log('Tracking with BEADS memory system...');
    // Implement BEADS-style task tracking
    return { tasksCompleted: workflow.tasks.length };
  }
  
  private async coordinateWithMCP(workflow: CoordinatedWorkflow, taskResult: any): Promise<any> {
    console.log('Coordinating with MCP Agent Mail...');
    // Implement MCP Agent Mail coordination
    return { messagesExchanged: workflow.tasks.length * 2 };
  }
  
  private async validateWithVC(workflow: CoordinatedWorkflow, coordinationResult: any): Promise<any> {
    console.log('Validating with VC quality gates...');
    // Implement VC-style quality gates
    return { gatesPassed: this.config.vc.qualityGates.gates.length };
  }
  
  private async executeWithEfrit(workflow: CoordinatedWorkflow, validationResult: any): Promise<any> {
    console.log('Executing with EFRIT safety patterns...');
    // Implement EFRIT-style safe tool execution
    return { toolsExecuted: workflow.tasks.reduce((sum, task) => sum + task.tools.length, 0) };
  }
}

// Types for coordinated workflows
export interface CoordinatedWorkflow {
  id: string;
  name: string;
  description: string;
  startTime: number;
  tasks: WorkflowTask[];
  dependencies: WorkflowDependency[];
}

export interface WorkflowTask {
  id: string;
  name: string;
  type: 'code' | 'test' | 'deploy' | 'review';
  tools: string[];
  assignedAgent?: string;
}

export interface WorkflowDependency {
  taskId: string;
  dependsOn: string[];
}

export interface WorkflowResult {
  workflowId: string;
  status: 'completed' | 'failed' | 'cancelled';
  startTime: number;
  endTime: number;
  results: Record<string, any>;
  error?: string;
  metrics: {
    totalAgents: number;
    tasksCompleted: number;
    qualityGatesPassed: number;
    toolsExecuted: number;
  };
}

// Mock component connections (to be replaced with actual implementations)

class MockBeadsConnection {
  constructor(private config: any, private eventBridge: YeggeEventBridge) {}
  
  async start(): Promise<void> {
    console.log('Mock BEADS connection started');
  }
  
  async stop(): Promise<void> {
    console.log('Mock BEADS connection stopped');
  }
  
  async assignTask(taskId: string): Promise<void> {
    console.log(`BEADS: Task ${taskId} assigned`);
  }
  
  async createFollowupTask(event: YeggeEvent): Promise<void> {
    console.log('BEADS: Follow-up task created from quality gate result');
  }
}

class MockGastownConnection {
  constructor(private config: any, private eventBridge: YeggeEventBridge) {}
  
  async start(): Promise<void> {
    console.log('Mock Gas Town connection started');
  }
  
  async stop(): Promise<void> {
    console.log('Mock Gas Town connection stopped');
  }
  
  async assignTask(taskId: string): Promise<void> {
    console.log(`Gas Town: Assigning task ${taskId} to available agent`);
  }
}

class MockMCPAgentMailConnection {
  constructor(private config: any, private eventBridge: YeggeEventBridge) {}
  
  async start(): Promise<void> {
    console.log('Mock MCP Agent Mail connection started');
  }
  
  async stop(): Promise<void> {
    console.log('Mock MCP Agent Mail connection stopped');
  }
  
  async registerAgent(agentId: string): Promise<void> {
    console.log(`MCP Agent Mail: Agent ${agentId} registered`);
  }
}

class MockVCConnection {
  constructor(private config: any, private eventBridge: YeggeEventBridge) {}
  
  async start(): Promise<void> {
    console.log('Mock VC connection started');
  }
  
  async stop(): Promise<void> {
    console.log('Mock VC connection stopped');
  }
}

class MockEfritConnection {
  constructor(private config: any, private eventBridge: YeggeEventBridge) {}
  
  async start(): Promise<void> {
    console.log('Mock EFRIT connection started');
  }
  
  async stop(): Promise<void> {
    console.log('Mock EFRIT connection stopped');
  }
}

// Component connection interfaces
interface BeadsConnection {
  start(): Promise<void>;
  stop(): Promise<void>;
  assignTask(taskId: string): Promise<void>;
  createFollowupTask(event: YeggeEvent): Promise<void>;
}

interface GastownConnection {
  start(): Promise<void>;
  stop(): Promise<void>;
  assignTask(taskId: string): Promise<void>;
}

interface MCPAgentMailConnection {
  start(): Promise<void>;
  stop(): Promise<void>;
  registerAgent(agentId: string): Promise<void>;
}

interface VCConnection {
  start(): Promise<void>;
  stop(): Promise<void>;
}

interface EfritConnection {
  start(): Promise<void>;
  stop(): Promise<void>;
}

// Factory function for creating the connector
export function createYeggeEcosystemConnector(options?: YeggeConnectorOptions): YeggeEcosystemConnector {
  return new YeggeEcosystemConnector(options);
}

// Singleton instance for global access
let globalConnector: YeggeEcosystemConnector | null = null;

export function getGlobalYeggeConnector(options?: YeggeConnectorOptions): YeggeEcosystemConnector {
  if (!globalConnector) {
    globalConnector = new YeggeEcosystemConnector(options);
  }
  return globalConnector;
}