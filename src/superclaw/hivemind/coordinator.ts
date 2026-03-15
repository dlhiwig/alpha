/**
 * Hivemind Coordinator
 * 
 * Meta-orchestrator that manages multiple AI CLI agents as a unified swarm.
 * This is the brain of SuperClaw's multi-model architecture.
 */

import { EventEmitter } from 'events';
import { CLIAgent, CLIType, CLIResponse } from './cli-agent';
import { routeTask, analyzeTask, TaskMetadata, RoutingStrategy, RoutingDecision } from './router';
import { buildConsensus, AgentResult, ConsensusResult } from './consensus';

export interface HivemindConfig {
  preferredStrategy?: RoutingStrategy;
  maxConcurrent?: number;
  timeout?: number;
  workdir?: string;
  enabledAgents?: CLIType[];
}

export interface HivemindTask {
  id: string;
  prompt: string;
  metadata?: Partial<TaskMetadata>;
  strategy?: RoutingStrategy;
}

export interface HivemindResult {
  taskId: string;
  output: string;
  consensus?: ConsensusResult;
  routing: RoutingDecision;
  agentResults: AgentResult[];
  totalDurationMs: number;
}

/**
 * Hivemind Coordinator
 * 
 * Orchestrates multiple AI CLI tools as a unified swarm.
 */
export class HivemindCoordinator extends EventEmitter {
  private config: HivemindConfig;
  private agents: Map<string, CLIAgent> = new Map();
  private availableTypes: CLIType[] = [];
  private initialized: boolean = false;

  constructor(config: HivemindConfig = {}) {
    super();
    this.config = {
      preferredStrategy: config.preferredStrategy || 'best',
      maxConcurrent: config.maxConcurrent || 4,
      timeout: config.timeout || 120000,
      workdir: config.workdir || process.cwd(),
      enabledAgents: config.enabledAgents
    };
  }

  /**
   * Initialize the hivemind by detecting available CLI tools
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log('🧠 Initializing Hivemind...');

    // Detect available CLIs
    const allAvailable = await CLIAgent.getAvailable();
    
    // Filter by enabled agents if specified
    this.availableTypes = this.config.enabledAgents
      ? allAvailable.filter(t => this.config.enabledAgents!.includes(t))
      : allAvailable;

    console.log(`   Available agents: ${this.availableTypes.join(', ') || 'none'}`);

    if (this.availableTypes.length === 0) {
      console.warn('⚠️  No AI CLI tools found. Install claude, codex, gemini, or ollama.');
    }

    this.initialized = true;
    this.emit('initialized', { availableTypes: this.availableTypes });
  }

  /**
   * Get available agent types
   */
  getAvailableAgents(): CLIType[] {
    return [...this.availableTypes];
  }

  /**
   * Execute a task using the hivemind
   */
  async execute(task: HivemindTask): Promise<HivemindResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    const startTime = Date.now();
    console.log(`\n🎯 Hivemind Task: ${task.id}`);

    // Analyze task if metadata not provided
    const metadata: TaskMetadata = {
      ...analyzeTask(task.prompt),
      ...task.metadata
    };
    console.log(`   Type: ${metadata.type}, Complexity: ${metadata.complexity}`);

    // Route to agent(s)
    const routing = routeTask(
      metadata,
      this.availableTypes,
      task.strategy || this.config.preferredStrategy
    );
    console.log(`   Strategy: ${routing.strategy}`);
    console.log(`   Routing: ${routing.reason}`);

    // Execute based on strategy
    let agentResults: AgentResult[];

    switch (routing.strategy) {
      case 'consensus':
        agentResults = await this.executeConsensus(task, routing);
        break;

      case 'pipeline':
        agentResults = await this.executePipeline(task, routing);
        break;

      default:
        agentResults = await this.executeSingle(task, routing.primary);
    }

    // Build consensus if multiple results
    let consensus: ConsensusResult | undefined;
    let finalOutput: string;

    if (agentResults.length > 1) {
      consensus = await buildConsensus(agentResults, metadata.type);
      finalOutput = consensus.finalOutput;
      console.log(`   Consensus: ${consensus.method} (confidence: ${(consensus.confidence * 100).toFixed(0)}%)`);
    } else {
      finalOutput = agentResults[0]?.response.content || '';
    }

    const totalDurationMs = Date.now() - startTime;
    console.log(`   Duration: ${totalDurationMs}ms`);

    return {
      taskId: task.id,
      output: finalOutput,
      consensus,
      routing,
      agentResults,
      totalDurationMs
    };
  }

  /**
   * Execute with a single agent
   */
  private async executeSingle(task: HivemindTask, agentType: CLIType): Promise<AgentResult[]> {
    const agentId = `${agentType}-${Date.now()}`;
    const agent = new CLIAgent({
      id: agentId,
      type: agentType,
      workdir: this.config.workdir,
      timeout: this.config.timeout
    });

    console.log(`   📤 Sending to ${agentType}...`);
    this.emit('agent:start', { agentId, type: agentType });

    try {
      const response = await agent.execute(task.prompt);
      console.log(`   📥 ${agentType} responded in ${response.durationMs}ms`);
      this.emit('agent:complete', { agentId, type: agentType, response });

      return [{
        agentId,
        agentType,
        response
      }];
    } catch (error: unknown) {
      console.error(`   ❌ ${agentType} failed: ${error}`);
      this.emit('agent:error', { agentId, type: agentType, error });
      return [];
    }
  }

  /**
   * Execute with multiple agents for consensus
   */
  private async executeConsensus(
    task: HivemindTask,
    routing: RoutingDecision
  ): Promise<AgentResult[]> {
    const agents = [routing.primary, ...(routing.secondary || [])];
    console.log(`   📤 Sending to ${agents.length} agents for consensus...`);

    const promises = agents.map(async (agentType) => {
      const agentId = `${agentType}-${Date.now()}`;
      const agent = new CLIAgent({
        id: agentId,
        type: agentType,
        workdir: this.config.workdir,
        timeout: this.config.timeout
      });

      this.emit('agent:start', { agentId, type: agentType });

      try {
        const response = await agent.execute(task.prompt);
        console.log(`   📥 ${agentType} responded in ${response.durationMs}ms`);
        this.emit('agent:complete', { agentId, type: agentType, response });

        return {
          agentId,
          agentType,
          response
        };
      } catch (error: unknown) {
        console.error(`   ❌ ${agentType} failed: ${error}`);
        this.emit('agent:error', { agentId, type: agentType, error });
        return null;
      }
    });

    const results = await Promise.all(promises);
    return results.filter((r): r is AgentResult => r !== null);
  }

  /**
   * Execute as a pipeline (sequential with context passing)
   */
  private async executePipeline(
    task: HivemindTask,
    routing: RoutingDecision
  ): Promise<AgentResult[]> {
    const agents = [routing.primary, ...(routing.secondary || [])];
    console.log(`   📤 Executing pipeline: ${agents.join(' → ')}`);

    const results: AgentResult[] = [];
    let context = task.prompt;

    for (const agentType of agents) {
      const agentId = `${agentType}-${Date.now()}`;
      const agent = new CLIAgent({
        id: agentId,
        type: agentType,
        workdir: this.config.workdir,
        timeout: this.config.timeout
      });

      // Build prompt with context from previous step
      let prompt = context;
      if (results.length > 0) {
        const prevResult = results[results.length - 1];
        prompt = `Previous agent (${prevResult.agentType}) output:\n\n${prevResult.response.content}\n\n---\n\nContinue with: ${task.prompt}`;
      }

      this.emit('agent:start', { agentId, type: agentType });

      try {
        const response = await agent.execute(prompt);
        console.log(`   📥 ${agentType} (pipeline step ${results.length + 1}) responded in ${response.durationMs}ms`);
        this.emit('agent:complete', { agentId, type: agentType, response });

        results.push({
          agentId,
          agentType,
          response
        });

        // Update context for next step
        context = response.content;
      } catch (error: unknown) {
        console.error(`   ❌ ${agentType} failed in pipeline: ${error}`);
        this.emit('agent:error', { agentId, type: agentType, error });
        break; // Stop pipeline on failure
      }
    }

    return results;
  }

  /**
   * Execute a task with a specific agent type
   */
  async executeWith(task: HivemindTask, agentType: CLIType): Promise<HivemindResult> {
    if (!this.availableTypes.includes(agentType)) {
      throw new Error(`Agent ${agentType} is not available`);
    }

    const startTime = Date.now();
    const agentResults = await this.executeSingle(task, agentType);

    return {
      taskId: task.id,
      output: agentResults[0]?.response.content || '',
      routing: {
        primary: agentType,
        strategy: 'fastest',
        reason: 'Direct assignment'
      },
      agentResults,
      totalDurationMs: Date.now() - startTime
    };
  }

  /**
   * Shutdown all agents
   */
  async shutdown(): Promise<void> {
    for (const agent of this.agents.values()) {
      agent.kill();
    }
    this.agents.clear();
    this.initialized = false;
    console.log('🧠 Hivemind shutdown complete');
  }
}

export default HivemindCoordinator;
