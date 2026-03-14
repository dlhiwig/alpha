/**
 * SuperClaw Bridge
 * Main entry point for the OpenClaw + Claude-Flow + Agentic-Flow integration
 *
 * This bridge:
 * 1. Intercepts incoming messages
 * 2. Classifies complexity
 * 3. Routes to swarm or single-agent
 * 4. Tracks patterns for learning
 */

import { EventEmitter } from "node:events";
import { getOracleLearning } from "./oracle-learning.js";
import { TaskRouter } from "./router.js";
import { SwarmBridge, FallbackExecutor } from "./swarm-bridge.js";
import type {
  SuperClawConfig,
  DEFAULT_CONFIG,
  TaskClassification,
  SwarmResult,
  PatternMatch,
  LearningOutcome,
  BridgeMetrics,
  BridgeEvents,
} from "./types.js";

export interface ProcessResult {
  /** Whether SuperClaw handled the request */
  handled: boolean;
  /** The response content (if handled) */
  response?: string;
  /** Classification details */
  classification?: TaskClassification;
  /** Whether a swarm was used */
  usedSwarm?: boolean;
  /** Execution metadata */
  metadata?: {
    latencyMs: number;
    tokensUsed?: number;
    agentsUsed?: number;
    model?: string;
  };
}

export interface SessionContext {
  sessionKey: string;
  channel?: string;
  userId?: string;
  history?: string[];
}

export class SuperClawBridge extends EventEmitter {
  private config: SuperClawConfig;
  private router: TaskRouter;
  private swarmBridge: SwarmBridge;
  private fallbackExecutor: FallbackExecutor;
  private initialized: boolean = false;

  // Metrics tracking
  private metrics: BridgeMetrics = {
    totalRequests: 0,
    swarmRequests: 0,
    singleAgentRequests: 0,
    averageLatencyMs: 0,
    successRate: 1.0,
    costSaved: 0,
  };

  // Pattern cache (would be replaced by AgentDB in full integration)
  private patternCache: Map<string, PatternMatch[]> = new Map();

  constructor(config: Partial<SuperClawConfig> = {}) {
    super();

    // Merge with defaults
    this.config = this.mergeConfig(config);

    // Initialize components
    this.router = new TaskRouter(this.config);
    this.swarmBridge = new SwarmBridge(this.config);
    this.fallbackExecutor = new FallbackExecutor();
  }

  /**
   * Initialize the bridge
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    console.log("[SuperClaw] Initializing bridge...");

    await this.swarmBridge.initialize();

    // Forward swarm events
    this.swarmBridge.on("swarm:started", (data) => this.emit("swarm:started", data));
    this.swarmBridge.on("swarm:progress", (data) => this.emit("swarm:progress", data));
    this.swarmBridge.on("swarm:completed", (data) => this.emit("swarm:completed", data));
    this.swarmBridge.on("swarm:failed", (data) => this.emit("swarm:failed", data));

    // Initialize ORACLE learning system
    try {
      await getOracleLearning();
      console.log("[SuperClaw] Oracle Learning system initialized");
    } catch (error) {
      console.warn("[SuperClaw] Failed to initialize Oracle Learning:", error);
    }

    this.initialized = true;
    console.log("[SuperClaw] Bridge initialized");
    console.log(`[SuperClaw] Swarm available: ${this.swarmBridge.isAvailable()}`);
  }

  /**
   * Process an incoming message
   * Returns null if SuperClaw should not handle (let OpenClaw do normal processing)
   */
  async processMessage(message: string, context: SessionContext): Promise<ProcessResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.config.enabled) {
      return { handled: false };
    }

    const startTime = Date.now();
    this.metrics.totalRequests++;

    try {
      // Step 1: Check for pattern matches
      const patterns = await this.findPatterns(message);
      if (patterns.length > 0) {
        this.emit("pattern:matched", { task: message, patterns });
      }

      // Step 2: Classify the task
      const classification = await this.router.classify(message, {
        sessionHistory: context.history,
        patterns,
      });

      this.emit("task:classified", { task: message, classification });

      // Step 3: Decide routing
      if (this.router.shouldUseSwarm(classification) && this.swarmBridge.isAvailable()) {
        // Route to swarm
        return await this.handleWithSwarm(message, context, classification, startTime);
      } else if (classification.complexity === "complex" && !this.swarmBridge.isAvailable()) {
        // Complex task but no swarm - still handle, just note it
        console.log(
          "[SuperClaw] Complex task detected but swarm not available, using single agent",
        );
      }

      // Let OpenClaw handle with its normal agent
      // But we can still suggest the model
      return {
        handled: false,
        classification,
        metadata: {
          latencyMs: Date.now() - startTime,
          model: classification.suggestedModel,
        },
      };
    } catch (error) {
      console.error("[SuperClaw] Error processing message:", error);
      return { handled: false };
    }
  }

  /**
   * Handle a message with a swarm
   */
  private async handleWithSwarm(
    message: string,
    context: SessionContext,
    classification: TaskClassification,
    startTime: number,
  ): Promise<ProcessResult> {
    this.metrics.swarmRequests++;

    try {
      // Spawn swarm
      const handle = await this.swarmBridge.spawn({
        task: message,
        topology: this.config.swarm.topology,
        maxAgents: Math.min(
          classification.suggestedAgents.length || 4,
          this.config.swarm.maxAgents,
        ),
        timeout: this.config.swarm.timeout,
        context: {
          sessionKey: context.sessionKey,
          channel: context.channel,
        },
      });

      // Execute
      const result = await handle.execute();
      const latencyMs = Date.now() - startTime;

      // Update metrics
      this.updateMetrics(result.success, latencyMs);

      // Record for learning
      if (this.config.learning.enabled) {
        await this.recordOutcome({
          sessionKey: context.sessionKey,
          task: message,
          response: result.output,
          success: result.success,
          latencyMs,
          tokensUsed: result.tokensUsed || 0,
          model: classification.suggestedModel,
          wasSwarm: true,
          agentsUsed: result.agentsUsed,
        });
      }

      return {
        handled: true,
        response: result.output,
        classification,
        usedSwarm: true,
        metadata: {
          latencyMs,
          tokensUsed: result.tokensUsed,
          agentsUsed: result.agentsUsed,
          model: classification.suggestedModel,
        },
      };
    } catch (error) {
      console.error("[SuperClaw] Swarm execution failed:", error);

      // Fall back to not handling (let OpenClaw try)
      return {
        handled: false,
        classification,
        metadata: {
          latencyMs: Date.now() - startTime,
        },
      };
    }
  }

  /**
   * Find patterns similar to the given task
   */
  private async findPatterns(task: string): Promise<PatternMatch[]> {
    // In full integration, this would use AgentDB vector search
    // For now, use simple pattern cache

    const normalizedTask = task.toLowerCase().trim();

    // Check cache
    if (this.patternCache.has(normalizedTask)) {
      return this.patternCache.get(normalizedTask) || [];
    }

    // Simple keyword-based matching for now
    const matches: PatternMatch[] = [];

    const entries = Array.from(this.patternCache.entries());
    for (const [cachedTask, patterns] of entries) {
      const similarity = this.calculateSimilarity(normalizedTask, cachedTask);
      if (similarity > 0.7) {
        matches.push(...patterns.map((p) => ({ ...p, similarity })));
      }
    }

    return matches.slice(0, 5); // Top 5 matches
  }

  /**
   * Simple string similarity (Jaccard index on words)
   */
  private calculateSimilarity(a: string, b: string): number {
    const wordsA = a.split(/\s+/);
    const wordsB = b.split(/\s+/);
    const setA = new Set(wordsA);
    const setB = new Set(wordsB);

    const intersectionCount = wordsA.filter((x) => setB.has(x)).length;
    const unionCount = new Set([...wordsA, ...wordsB]).size;

    return unionCount > 0 ? intersectionCount / unionCount : 0;
  }

  /**
   * Record an outcome for learning
   */
  private async recordOutcome(outcome: LearningOutcome): Promise<void> {
    if (!this.config.learning.storePatterns) {
      return;
    }
    if (!outcome.success && outcome.wasSwarm) {
      return;
    } // Don't learn from swarm failures

    // Store pattern
    const pattern: PatternMatch = {
      id: `pattern_${Date.now()}`,
      task: outcome.task,
      output: outcome.response,
      similarity: 1.0,
      reward: outcome.success ? 1.0 : 0.0,
      success: outcome.success,
    };

    const normalized = outcome.task.toLowerCase().trim();
    const existing = this.patternCache.get(normalized) || [];
    existing.push(pattern);
    this.patternCache.set(normalized, existing.slice(-10)); // Keep last 10

    this.emit("pattern:stored", { outcome });
  }

  /**
   * Update metrics
   */
  private updateMetrics(success: boolean, latencyMs: number): void {
    const total = this.metrics.totalRequests;

    // Rolling average for latency
    this.metrics.averageLatencyMs =
      (this.metrics.averageLatencyMs * (total - 1) + latencyMs) / total;

    // Success rate
    const successes = this.metrics.successRate * (total - 1) + (success ? 1 : 0);
    this.metrics.successRate = successes / total;
  }

  /**
   * Get current metrics
   */
  getMetrics(): BridgeMetrics {
    return { ...this.metrics };
  }

  /**
   * Get current configuration
   */
  getConfig(): SuperClawConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<SuperClawConfig>): void {
    this.config = this.mergeConfig(updates);
    this.router = new TaskRouter(this.config);
  }

  /**
   * Check if swarm functionality is available
   */
  isSwarmAvailable(): boolean {
    return this.swarmBridge.isAvailable();
  }

  /**
   * Force classification for a message (for testing/debugging)
   */
  async forceClassify(message: string): Promise<TaskClassification> {
    return this.router.classify(message);
  }

  /**
   * Shutdown the bridge
   */
  async shutdown(): Promise<void> {
    await this.swarmBridge.shutdownAll();
    this.patternCache.clear();
    this.initialized = false;
  }

  /**
   * Merge config with defaults
   */
  private mergeConfig(partial: Partial<SuperClawConfig>): SuperClawConfig {
    const defaults: SuperClawConfig = {
      enabled: true,
      routing: {
        strategy: "balanced",
        agentBoosterEnabled: false,
        preferLocal: true,
        costThreshold: 1.0,
        latencyThreshold: 30000,
      },
      swarm: {
        enabled: true,
        maxAgents: 8,
        topology: "hierarchical",
        consensus: "majority",
        antiDrift: true,
        checkpointInterval: 5000,
        timeout: 300000,
      },
      learning: {
        enabled: true,
        storePatterns: true,
        minRewardThreshold: 0.7,
      },
    };

    return {
      ...defaults,
      ...partial,
      routing: { ...defaults.routing, ...partial.routing },
      swarm: { ...defaults.swarm, ...partial.swarm },
      learning: { ...defaults.learning, ...partial.learning },
    };
  }
}
