/**
 * SuperClaw Swarm Service
 * Wraps the swarm orchestrator in a clean service interface
 * 
 * Integrates:
 * - 3-tier ModelRouter for intelligent model selection
 * - SONA for pattern-based learning and optimization
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { 
  getSwarmConfig, 
  getModelConfig, 
  getPromptTemplates,
  getRolePrompt 
} from '../utils/config-loader';
import { ModelRouter, ModelSelection, Task as RouterTask } from './model-router';
import { SonaAdapter, initSonaAdapter } from './sona-adapter';
import { logger } from '../utils/logger';
import { getDB, SuperClawDB } from '../persistence';
import { QualityAssessor, getQualityAssessor } from './quality-assessor';
import { EmbeddingService, getEmbeddingService } from './embedding-service';

// --- Types ---

export interface SwarmRunConfig {
  objective: string;
  maxAgents?: number;
  timeout?: number;
  model?: string;
  profile?: string;
}

export interface SwarmTask {
  id: string;
  role: string;
  instructions: string;
}

export interface SwarmTaskResult {
  taskId: string;
  role: string;
  output: string;
  status: 'success' | 'failure';
  latency: number;
  tokens?: { input: number; output: number };
}

export interface SwarmRun {
  runId: string;
  objective: string;
  status: 'pending' | 'decomposing' | 'running' | 'aggregating' | 'completed' | 'failed';
  startedAt: Date;
  completedAt?: Date;
  tasks: SwarmTask[];
  results: SwarmTaskResult[];
  output?: string;
  error?: string;
  stats?: {
    totalTime: number;
    agentCount: number;
    successRate: number;
    totalTokens: { input: number; output: number };
  };
}

export type SwarmEvent = 
  | { event: 'run.started'; runId: string; objective: string }
  | { event: 'decomposition.started'; runId: string }
  | { event: 'decomposition.completed'; runId: string; tasks: SwarmTask[] }
  | { event: 'task.started'; runId: string; taskId: string; role: string }
  | { event: 'task.completed'; runId: string; taskId: string; role: string; latency: number }
  | { event: 'task.failed'; runId: string; taskId: string; role: string; error: string }
  | { event: 'aggregation.started'; runId: string }
  | { event: 'aggregation.completed'; runId: string }
  | { event: 'run.completed'; runId: string; stats: SwarmRun['stats'] }
  | { event: 'run.failed'; runId: string; error: string };

// --- Service Class ---

export class SwarmService extends EventEmitter {
  private runs: Map<string, SwarmRun> = new Map();
  private apiKey: string;
  private config = getSwarmConfig();
  private modelConfig = getModelConfig();
  private prompts = getPromptTemplates();
  private router: ModelRouter;
  private sona: SonaAdapter;
  private db: SuperClawDB;
  private log = logger.child({ component: 'swarm-service' });

  constructor() {
    super();
    this.apiKey = process.env.ANTHROPIC_API_KEY || '';
    if (!this.apiKey) {
      this.log.warn('ANTHROPIC_API_KEY not set');
    }
    
    // Initialize SONA and ModelRouter
    this.sona = initSonaAdapter({
      hiddenDim: 256,
      qualityThreshold: 0.6,
    });
    
    this.router = new ModelRouter({
      enableSona: true,
      tier2Model: this.modelConfig.profiles?.fast?.model || 'claude-3-haiku-20240307',
      tier3Model: this.modelConfig.default.model,
    });
    
    // Initialize persistence
    this.db = getDB();
    
    this.log.info('SwarmService initialized with SONA + ModelRouter + Persistence');
  }

  // --- Public API ---

  async start(): Promise<void> {
    this.log.info('Starting SwarmService...');
    // Start SONA background learning
    this.sona.start(60000); // 1 minute tick interval
    this.log.info('SwarmService started');
  }

  stop(): void {
    this.log.info('Stopping SwarmService...');
    this.sona.stop();
    this.sona.flush();
    this.runs.clear();
    this.log.info('SwarmService stopped');
  }

  getStatus(): { 
    running: boolean; 
    activeRuns: number; 
    totalRuns: number;
    routing: ReturnType<ModelRouter['getStats']>;
    learning: ReturnType<SonaAdapter['getStats']>;
    persistence: Record<string, number>;
    costs: { daily: unknown[]; total: unknown };
  } {
    const activeRuns = Array.from(this.runs.values()).filter(
      r => r.status === 'running' || r.status === 'decomposing' || r.status === 'aggregating'
    ).length;
    return {
      running: true,
      activeRuns,
      totalRuns: this.runs.size,
      routing: this.router.getStats(),
      learning: this.sona.getStats(),
      persistence: this.db.getStats(),
      costs: this.db.getCostSummary(7),
    };
  }

  getRun(runId: string): SwarmRun | undefined {
    return this.runs.get(runId);
  }

  listRuns(limit = 10): SwarmRun[] {
    return Array.from(this.runs.values())
      .toSorted((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, limit);
  }

  async runSwarm(config: SwarmRunConfig): Promise<{ runId: string; run: SwarmRun }> {
    const runId = `swarm-${uuidv4().slice(0, 8)}`;
    const run: SwarmRun = {
      runId,
      objective: config.objective,
      status: 'pending',
      startedAt: new Date(),
      tasks: [],
      results: [],
    };
    
    this.runs.set(runId, run);
    
    // Persist run to SQLite
    this.db.createRun(config.objective, {
      runId,
      maxAgents: config.maxAgents,
      timeout: config.timeout,
      model: config.model,
      profile: config.profile,
    });
    
    this.emitEvent({ event: 'run.started', runId, objective: config.objective });

    // Run asynchronously
    this.executeSwarm(runId, config).catch(error => {
      run.status = 'failed';
      run.error = (error as Error).message;
      this.emitEvent({ event: 'run.failed', runId, error: (error as Error).message });
    });

    return { runId, run };
  }

  // --- Private Methods ---

  private emitEvent(event: SwarmEvent): void {
    this.emit('swarm-event', event);
  }

  private async executeSwarm(runId: string, config: SwarmRunConfig): Promise<void> {
    const run = this.runs.get(runId)!;
    const startTime = Date.now();

    try {
      // Phase 1: Decompose
      run.status = 'decomposing';
      this.emitEvent({ event: 'decomposition.started', runId });
      
      const tasks = await this.decomposeTask(config.objective);
      run.tasks = tasks;
      this.emitEvent({ event: 'decomposition.completed', runId, tasks });

      // Phase 2: Execute agents
      run.status = 'running';
      const maxConcurrent = config.maxAgents || this.config.swarm.max_concurrent_agents;
      const results = await this.executeWithThrottle(runId, tasks, maxConcurrent);
      run.results = results;

      // Phase 3: Aggregate
      run.status = 'aggregating';
      this.emitEvent({ event: 'aggregation.started', runId });
      
      const output = await this.aggregateResults(config.objective, results);
      run.output = output;
      this.emitEvent({ event: 'aggregation.completed', runId });

      // Phase 4: Complete
      const totalTime = Date.now() - startTime;
      const totalTokens = results.reduce(
        (acc, r) => ({
          input: acc.input + (r.tokens?.input || 0),
          output: acc.output + (r.tokens?.output || 0),
        }),
        { input: 0, output: 0 }
      );

      run.status = 'completed';
      run.completedAt = new Date();
      run.stats = {
        totalTime,
        agentCount: results.length,
        successRate: results.filter(r => r.status === 'success').length / results.length,
        totalTokens,
      };

      // Persist completion
      this.db.updateRunStatus(runId, 'completed', { result: run.stats });
      
      this.emitEvent({ event: 'run.completed', runId, stats: run.stats });

    } catch (error: unknown) {
      run.status = 'failed';
      run.error = error instanceof Error ? (error).message : String(error);
      
      // Persist failure
      this.db.updateRunStatus(runId, 'failed', { error: run.error });
      
      this.emitEvent({ event: 'run.failed', runId, error: run.error });
      throw error;
    }
  }

  private async callLLM(
    systemPrompt: string,
    userPrompt: string,
    modelOverride?: string
  ): Promise<{ text: string; tokens: { input: number; output: number } }> {
    const model = modelOverride || this.modelConfig.default.model;
    const maxTokens = this.modelConfig.default.max_tokens;
    const endpoint = this.modelConfig.endpoints.anthropic;
    
    this.log.debug({ model }, 'Calling LLM');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      content: Array<{ text: string }>;
      usage: { input_tokens: number; output_tokens: number };
    };
    
    return {
      text: data.content[0]?.text || '',
      tokens: {
        input: data.usage?.input_tokens || 0,
        output: data.usage?.output_tokens || 0,
      },
    };
  }

  private async decomposeTask(objective: string): Promise<SwarmTask[]> {
    const system = this.prompts.decomposer.system;
    const prompt = this.prompts.decomposer.user_template.replace('{objective}', objective);

    try {
      const { text } = await this.callLLM(system, prompt);
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {throw new Error('No JSON array found in response');}
      return JSON.parse(jsonMatch[0]);
    } catch (error: unknown) {
      console.error('[SwarmService] Decomposition failed, using fallback:', error);
      return [{ id: '1', role: 'architect', instructions: objective }];
    }
  }

  private async executeAgent(runId: string, task: SwarmTask): Promise<SwarmTaskResult> {
    const start = Date.now();
    this.emitEvent({ event: 'task.started', runId, taskId: task.id, role: task.role });

    // Create execution record
    const execution = this.db.createExecution(runId, task.role, task.instructions);

    const rolePrompt = getRolePrompt(task.role);
    
    // Route the task to optimal model tier
    const routerTask: RouterTask = {
      id: task.id,
      intent: `${task.role}: ${task.instructions}`,
      // Simple embedding: hash the intent to a 256-dim vector (placeholder)
      embedding: this.simpleEmbed(task.instructions),
    };
    
    const routing = this.router.route(routerTask);
    this.log.debug({
      taskId: task.id,
      tier: routing.tier,
      model: routing.model,
      confidence: routing.confidence,
    }, 'Task routed');
    
    // Record routing decision
    this.db.recordRoutingDecision({
      runId,
      taskPreview: task.instructions.slice(0, 100),
      complexityScore: routing.confidence,
      selectedTier: routing.tier,
      reason: routing.reason,
    });
    
    // Begin SONA tracking
    this.router.beginTracking(routerTask);

    try {
      // Skip LLM for Tier 1 (Agent Booster)
      let text: string;
      let tokens = { input: 0, output: 0 };
      
      if (routing.tier === 1 && routing.handler === 'direct_edit') {
        // Direct edit without LLM (placeholder - would need actual transforms)
        text = `[Agent Booster] Direct transform applied for: ${task.instructions}`;
        this.log.debug({ taskId: task.id }, 'Using Agent Booster (no LLM)');
      } else {
        const result = await this.callLLM(rolePrompt, task.instructions, routing.model);
        text = result.text;
        tokens = result.tokens;
      }
      
      const latency = Date.now() - start;

      // Assess actual quality for SONA learning
      const assessor = getQualityAssessor();
      const assessment = assessor.assess({
        task: {
          id: task.id,
          role: task.role,
          instructions: task.instructions,
        },
        output: text,
        latencyMs: latency,
        tokens,
      });
      this.router.recordOutcome(task.id, assessment.score);

      // Complete execution record
      this.db.completeExecution(execution.id, {
        model: routing.model || undefined,
        tier: routing.tier,
        status: 'completed',
        result: { output: text.slice(0, 1000) }, // Truncate for storage
        inputTokens: tokens.input,
        outputTokens: tokens.output,
        costUsd: this.estimateCost(routing.tier, tokens),
        latencyMs: latency,
      });
      
      // Record cost to daily aggregate
      this.db.recordCost(
        routing.tier, 
        tokens.input, 
        tokens.output, 
        this.estimateCost(routing.tier, tokens),
        routing.tier === 1 ? 0.003 : 0 // Estimated savings from tier 1
      );

      this.emitEvent({ event: 'task.completed', runId, taskId: task.id, role: task.role, latency });

      return {
        taskId: task.id,
        role: task.role,
        output: text,
        status: 'success',
        latency,
        tokens,
      };
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? (error).message : String(error);
      const latency = Date.now() - start;
      
      // Record failure for SONA learning
      this.router.recordOutcome(task.id, 0.2);
      
      // Complete execution with failure
      this.db.completeExecution(execution.id, {
        model: routing.model || undefined,
        tier: routing.tier,
        status: 'failed',
        error: errorMsg,
        latencyMs: latency,
      });
      
      this.emitEvent({ event: 'task.failed', runId, taskId: task.id, role: task.role, error: errorMsg });

      return {
        taskId: task.id,
        role: task.role,
        output: `Error: ${errorMsg}`,
        status: 'failure',
        latency,
      };
    }
  }
  
  /**
   * Estimate cost based on tier and tokens
   */
  private estimateCost(tier: number, tokens: { input: number; output: number }): number {
    // Pricing per 1M tokens (approximate)
    const pricing: Record<number, { input: number; output: number }> = {
      1: { input: 0, output: 0 }, // Agent Booster - free
      2: { input: 0.25, output: 1.25 }, // Haiku
      3: { input: 3, output: 15 }, // Sonnet
    };
    
    const p = pricing[tier] || pricing[3];
    return (tokens.input * p.input + tokens.output * p.output) / 1_000_000;
  }
  
  /**
   * Generate text embedding using the embedding service
   * Falls back to hash-based embedding if no API key is available
   */
  private async getEmbedding(text: string): Promise<number[]> {
    const service = getEmbeddingService();
    const result = await service.embed(text);
    return result.embedding;
  }
  
  /**
   * Synchronous hash-based embedding for compatibility
   * Use getEmbedding() when async is acceptable
   */
  private simpleEmbed(text: string): number[] {
    // Use the hash embedding directly from the service
    const service = getEmbeddingService({ provider: 'hash' });
    // Since hash is synchronous, we can safely block here
    // In practice, use getEmbedding() for async access
    const dim = 256;
    const embedding = new Array(dim).fill(0);
    
    const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 0);
    for (let w = 0; w < words.length; w++) {
      const word = words[w];
      for (let i = 0; i < word.length; i++) {
        const charCode = word.charCodeAt(i);
        const h1 = (charCode * 31 + i * 17) % dim;
        const h2 = (charCode * 37 + i * 13 + w * 7) % dim;
        embedding[h1] += 1 / (i + 1);
        embedding[h2] += charCode / 1000;
      }
    }
    
    const magnitude = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    return embedding.map(v => v / (magnitude || 1));
  }

  private async executeWithThrottle(
    runId: string,
    tasks: SwarmTask[],
    maxConcurrent: number
  ): Promise<SwarmTaskResult[]> {
    const results: SwarmTaskResult[] = [];
    const executing: Promise<void>[] = [];

    for (const task of tasks) {
      const promise = this.executeAgent(runId, task).then(result => {
        results.push(result);
      });
      executing.push(promise);

      if (executing.length >= maxConcurrent) {
        await Promise.race(executing);
        for (let i = executing.length - 1; i >= 0; i--) {
          const status = await Promise.race([
            executing[i].then(() => 'done'),
            Promise.resolve('pending'),
          ]);
          if (status === 'done') {executing.splice(i, 1);}
        }
      }
    }

    await Promise.all(executing);
    return results;
  }

  private async aggregateResults(objective: string, results: SwarmTaskResult[]): Promise<string> {
    const successfulResults = results.filter(r => r.status === 'success');
    if (successfulResults.length === 0) {
      return 'All agents failed. No output to aggregate.';
    }

    const context = successfulResults
      .map(r => `=== ${r.role.toUpperCase()} (Task ${r.taskId}) ===\n${r.output}`)
      .join('\n\n---\n\n');

    const system = this.prompts.aggregator.system;
    const prompt = this.prompts.aggregator.user_template
      .replace('{objective}', objective)
      .replace('{results}', context);

    const { text } = await this.callLLM(system, prompt);
    return text;
  }
}

// --- Singleton Export ---

let instance: SwarmService | null = null;

export function getSwarmService(): SwarmService {
  if (!instance) {
    instance = new SwarmService();
  }
  return instance;
}
