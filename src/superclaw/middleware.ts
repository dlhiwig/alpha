/**
 * Agent Middleware Chain
 * Ported from DeerFlow's composable middleware pattern into Alpha's SKYNET layer.
 *
 * Each middleware has beforeModel / afterModel hooks that wrap agent message processing.
 * The chain composes middlewares in order: beforeModel runs top-down, afterModel runs bottom-up.
 */

import type { Skynet, ThresholdViolation, CortexMemory } from "./skynet.js";

// ─── Types ───────────────────────────────────────────────────

/** Context passed through the middleware chain for each agent turn */
export interface MiddlewareContext {
  /** The incoming user message */
  message: string;
  /** Session identifier */
  sessionKey: string;
  /** Channel (telegram, discord, etc.) */
  channel?: string;
  /** User identifier */
  userId?: string;
  /** Model being used */
  model?: string;
  /** Number of currently active sub-agents */
  activeSubagents: number;
  /** Memories injected by MemoryMiddleware */
  memories: CortexMemory[];
  /** Context string built from memories */
  memoryContext: string;
  /** Threshold violations found by SafetyMiddleware */
  violations: ThresholdViolation[];
  /** Whether the request was blocked by a middleware */
  blocked: boolean;
  /** Reason for blocking */
  blockReason?: string;
  /** Arbitrary metadata middlewares can attach */
  metadata: Record<string, unknown>;
}

/** Result from agent processing, passed through afterModel hooks */
export interface MiddlewareResult {
  /** The agent's response */
  response: string;
  /** Whether the agent succeeded */
  success: boolean;
  /** Latency in milliseconds */
  latencyMs: number;
  /** Tokens consumed */
  tokensUsed?: number;
  /** Model used */
  model?: string;
  /** Number of sub-agent tool calls in the response */
  subagentCallCount: number;
  /** Whether sub-agent calls were truncated */
  subagentsTruncated: boolean;
  /** Patterns detected for Oracle learning */
  patterns: string[];
}

/** A single middleware with before/after hooks around model invocation */
export interface AgentMiddleware {
  /** Unique name for logging */
  readonly name: string;

  /**
   * Runs before the model is invoked.
   * Can mutate context (inject memories, check limits, block requests).
   * Return the (possibly mutated) context.
   */
  beforeModel(context: MiddlewareContext): Promise<MiddlewareContext>;

  /**
   * Runs after the model responds.
   * Can mutate the result (truncate sub-agents, record learnings).
   * Return the (possibly mutated) result.
   */
  afterModel(context: MiddlewareContext, result: MiddlewareResult): Promise<MiddlewareResult>;
}

// ─── MiddlewareChain ─────────────────────────────────────────

/** Composes multiple middlewares into a single before/after pipeline */
export class MiddlewareChain {
  private middlewares: AgentMiddleware[] = [];

  constructor(middlewares: AgentMiddleware[] = []) {
    this.middlewares = [...middlewares];
  }

  /** Add a middleware to the end of the chain */
  use(middleware: AgentMiddleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  /** Run all beforeModel hooks in order. Stops early if context.blocked is set. */
  async runBeforeModel(context: MiddlewareContext): Promise<MiddlewareContext> {
    let ctx = context;
    for (const mw of this.middlewares) {
      if (ctx.blocked) {break;}
      try {
        ctx = await mw.beforeModel(ctx);
      } catch (err) {
        console.error(`[Middleware:${mw.name}] beforeModel error:`, err);
      }
    }
    return ctx;
  }

  /** Run all afterModel hooks in reverse order (bottom-up unwinding). */
  async runAfterModel(
    context: MiddlewareContext,
    result: MiddlewareResult,
  ): Promise<MiddlewareResult> {
    let res = result;
    for (let i = this.middlewares.length - 1; i >= 0; i--) {
      try {
        res = await this.middlewares[i].afterModel(context, res);
      } catch (err) {
        console.error(`[Middleware:${this.middlewares[i].name}] afterModel error:`, err);
      }
    }
    return res;
  }

  /** Number of registered middlewares */
  get length(): number {
    return this.middlewares.length;
  }
}

// ─── MemoryMiddleware ────────────────────────────────────────

/**
 * Injects CORTEX memories into the agent context before each turn.
 * Ported from DeerFlow's MemoryMiddleware — adapted to use Alpha's Cortex
 * instead of LangChain's memory queue.
 */
export class MemoryMiddleware implements AgentMiddleware {
  readonly name = "MemoryMiddleware";

  constructor(private skynet: Skynet) {}

  async beforeModel(context: MiddlewareContext): Promise<MiddlewareContext> {
    const cortex = this.skynet.cortex;
    if (!cortex) {return context;}

    // Recall relevant memories for this message
    const memories = cortex.recall(context.message, 5);
    const memoryContext = cortex.buildContext(context.message);

    return {
      ...context,
      memories,
      memoryContext,
    };
  }

  async afterModel(context: MiddlewareContext, result: MiddlewareResult): Promise<MiddlewareResult> {
    const cortex = this.skynet.cortex;
    if (!cortex || !result.success) {return result;}

    // Store the conversation turn as a memory (like DeerFlow's after_agent queue)
    const content = `User: ${context.message}\nAssistant: ${result.response.slice(0, 500)}`;
    cortex.memorize(content, "conversation", context.channel ?? "gateway");

    return result;
  }
}

// ─── SafetyMiddleware ────────────────────────────────────────

/**
 * Checks ThresholdEnforcer limits before each turn.
 * Blocks requests that exceed governance thresholds (cost, memory, concurrency).
 */
export class SafetyMiddleware implements AgentMiddleware {
  readonly name = "SafetyMiddleware";

  constructor(private skynet: Skynet) {}

  async beforeModel(context: MiddlewareContext): Promise<MiddlewareContext> {
    const violations: ThresholdViolation[] = [];

    // Check concurrent agents
    const agentViolation = this.skynet.checkThreshold(
      "concurrent_agents",
      context.activeSubagents,
    );
    if (agentViolation) {violations.push(agentViolation);}

    // Check memory usage
    const memMB = Math.round(process.memoryUsage().rss / 1_048_576);
    const memViolation = this.skynet.checkThreshold("memory_mb", memMB);
    if (memViolation) {violations.push(memViolation);}

    // Check context size
    const contextChars = context.message.length + context.memoryContext.length;
    const contextViolation = this.skynet.checkThreshold("context_chars", contextChars);
    if (contextViolation) {violations.push(contextViolation);}

    // Block if any violation has action "block"
    const blockingViolation = violations.find((v) => v.action === "block");

    return {
      ...context,
      violations,
      blocked: context.blocked || !!blockingViolation,
      blockReason: blockingViolation
        ? `Threshold exceeded: ${blockingViolation.rule} (${blockingViolation.value} > ${blockingViolation.limit})`
        : context.blockReason,
    };
  }

  async afterModel(_context: MiddlewareContext, result: MiddlewareResult): Promise<MiddlewareResult> {
    // Record the request cost in sentinel
    if (result.tokensUsed) {
      const estimatedCost = (result.tokensUsed / 1_000_000) * 3; // rough $/M tokens
      this.skynet.recordRequest(result.latencyMs, !result.success, result.tokensUsed, estimatedCost);
    }
    return result;
  }
}

// ─── LearningMiddleware ──────────────────────────────────────

/**
 * Feeds results back to Oracle after each turn for pattern recognition.
 * Ported from DeerFlow's pattern — Oracle learns from both successes and mistakes.
 */
export class LearningMiddleware implements AgentMiddleware {
  readonly name = "LearningMiddleware";

  constructor(private skynet: Skynet) {}

  async beforeModel(context: MiddlewareContext): Promise<MiddlewareContext> {
    // No pre-processing needed — Oracle insights are consumed at query time
    return context;
  }

  async afterModel(context: MiddlewareContext, result: MiddlewareResult): Promise<MiddlewareResult> {
    // Extract and record patterns from the interaction
    const patterns: string[] = [];

    // Pattern: model + channel combination
    if (result.model && context.channel) {
      const pattern = `${result.model}:${context.channel}`;
      this.skynet.recordPattern(pattern);
      patterns.push(pattern);
    }

    // Pattern: task complexity signal (sub-agent usage)
    if (result.subagentCallCount > 0) {
      this.skynet.recordPattern(`subagent_spawn:${result.subagentCallCount}`);
      patterns.push(`subagent_spawn:${result.subagentCallCount}`);
    }

    // Pattern: latency bucket
    const latencyBucket =
      result.latencyMs < 2000 ? "fast" : result.latencyMs < 10000 ? "medium" : "slow";
    this.skynet.recordPattern(`latency:${latencyBucket}`);
    patterns.push(`latency:${latencyBucket}`);

    // Record mistakes for Oracle analysis
    if (!result.success) {
      this.skynet.recordMistake(
        `Failed on "${context.message.slice(0, 100)}" via ${result.model ?? "unknown"} (${result.latencyMs}ms)`,
      );
    }

    return { ...result, patterns };
  }
}

// ─── SubagentLimitMiddleware ─────────────────────────────────

/** Valid range for max concurrent sub-agents (matching DeerFlow: [2, 4]) */
const MIN_SUBAGENT_LIMIT = 2;
const MAX_SUBAGENT_LIMIT = 4;

function clampSubagentLimit(value: number): number {
  return Math.max(MIN_SUBAGENT_LIMIT, Math.min(MAX_SUBAGENT_LIMIT, value));
}

/**
 * Caps concurrent sub-agents per model response.
 * Ported directly from DeerFlow's SubagentLimitMiddleware.
 *
 * When a model response contains more than maxConcurrent "task" / sub-agent
 * tool calls, excess calls are truncated. This is more reliable than
 * prompt-based limits.
 */
export class SubagentLimitMiddleware implements AgentMiddleware {
  readonly name = "SubagentLimitMiddleware";
  readonly maxConcurrent: number;

  constructor(maxConcurrent = 4) {
    this.maxConcurrent = clampSubagentLimit(maxConcurrent);
  }

  async beforeModel(context: MiddlewareContext): Promise<MiddlewareContext> {
    // Check if we're already at the sub-agent limit globally
    if (context.activeSubagents >= this.maxConcurrent) {
      return {
        ...context,
        blocked: true,
        blockReason: `Sub-agent limit reached (${context.activeSubagents}/${this.maxConcurrent})`,
      };
    }
    return context;
  }

  async afterModel(context: MiddlewareContext, result: MiddlewareResult): Promise<MiddlewareResult> {
    // Truncate excess sub-agent calls in the response
    if (result.subagentCallCount <= this.maxConcurrent) {
      return result;
    }

    const dropped = result.subagentCallCount - this.maxConcurrent;
    console.warn(
      `[SubagentLimitMiddleware] Truncated ${dropped} excess sub-agent call(s) (limit: ${this.maxConcurrent})`,
    );

    return {
      ...result,
      subagentCallCount: this.maxConcurrent,
      subagentsTruncated: true,
    };
  }
}

// ─── Factory: create the default middleware chain ─────────────

/**
 * Build the default Alpha middleware chain wired to a SKYNET instance.
 * Order matters: Safety checks first, then memory injection, then sub-agent limits.
 * Learning runs last in afterModel (bottom-up) so it sees the final result.
 */
export function createDefaultMiddlewareChain(skynet: Skynet): MiddlewareChain {
  return new MiddlewareChain([
    new SafetyMiddleware(skynet),
    new MemoryMiddleware(skynet),
    new SubagentLimitMiddleware(MAX_SUBAGENT_LIMIT),
    new LearningMiddleware(skynet),
  ]);
}

/**
 * Create a fresh MiddlewareContext for an incoming message.
 */
export function createMiddlewareContext(params: {
  message: string;
  sessionKey: string;
  channel?: string;
  userId?: string;
  model?: string;
  activeSubagents?: number;
}): MiddlewareContext {
  return {
    message: params.message,
    sessionKey: params.sessionKey,
    channel: params.channel,
    userId: params.userId,
    model: params.model,
    activeSubagents: params.activeSubagents ?? 0,
    memories: [],
    memoryContext: "",
    violations: [],
    blocked: false,
    metadata: {},
  };
}

/**
 * Create a MiddlewareResult from agent processing output.
 */
export function createMiddlewareResult(params: {
  response: string;
  success: boolean;
  latencyMs: number;
  tokensUsed?: number;
  model?: string;
  subagentCallCount?: number;
}): MiddlewareResult {
  return {
    response: params.response,
    success: params.success,
    latencyMs: params.latencyMs,
    tokensUsed: params.tokensUsed,
    model: params.model,
    subagentCallCount: params.subagentCallCount ?? 0,
    subagentsTruncated: false,
    patterns: [],
  };
}
