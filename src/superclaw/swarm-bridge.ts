/**
 * SuperClaw Swarm Bridge
 * Bridges OpenClaw to SuperClaw's real swarm implementation via llm-run CLI
 */

import { EventEmitter } from "node:events";
// Import lightweight swarm as fallback
import { LightweightSwarm, createLightweightSwarm } from "./lightweight-swarm.js";
// Import ORACLE learning for self-improvement
import { getOracleLearning } from "./oracle-learning.js";
// Import shared memory for storing swarm results
import { getSharedMemory } from "./shared-memory.js";
// Import the real SuperClaw swarm executor
import {
  SuperClawSwarmExecutor,
  createSuperClawSwarmExecutor,
} from "./superclaw-swarm-executor.js";
import type {
  SwarmConfig,
  SwarmResult,
  SwarmHandle,
  SwarmProgress,
  SuperClawConfig,
  SwarmTopology,
  ConsensusType,
} from "./types.js";

// Real SuperClaw swarm executor
let superclawExecutor: SuperClawSwarmExecutor | null = null;

// Lightweight swarm instance for fallback
let lightweightSwarm: LightweightSwarm | null = null;

/**
 * Check if SuperClaw real swarm is available
 */
async function loadSuperClawSwarm(): Promise<boolean> {
  if (superclawExecutor) {
    return true;
  }

  try {
    // Initialize the real SuperClaw executor
    superclawExecutor = createSuperClawSwarmExecutor();

    // Do a quick health check
    const health = await superclawExecutor.healthCheck();
    const workingProviders = health.filter((h) => h.status === "ok");

    if (workingProviders.length === 0) {
      console.log("[SuperClaw] No working providers found, falling back to lightweight swarm");
      lightweightSwarm = createLightweightSwarm();
      superclawExecutor = null;
      return false;
    }

    console.log(
      `[SuperClaw] Real swarm available with ${workingProviders.length} providers: ${workingProviders.map((p) => p.provider).join(", ")}`,
    );
    return true;
  } catch (error) {
    // SuperClaw real swarm not available - use lightweight swarm
    console.log(
      `[SuperClaw] Real swarm failed to initialize: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.log("[SuperClaw] Using lightweight swarm (OpenClaw native)");
    lightweightSwarm = createLightweightSwarm();
    superclawExecutor = null;
    return false;
  }
}

/**
 * Check if real SuperClaw swarm is available
 */
export function isSuperClawSwarmAvailable(): boolean {
  return superclawExecutor !== null;
}

/**
 * Check if lightweight swarm is available (always true as fallback)
 */
export function isLightweightSwarmAvailable(): boolean {
  return lightweightSwarm !== null || superclawExecutor !== null;
}

/**
 * Get the lightweight swarm instance
 */
export function getLightweightSwarm(): LightweightSwarm | null {
  if (!lightweightSwarm) {
    lightweightSwarm = createLightweightSwarm();
  }
  return lightweightSwarm;
}

/**
 * Get the real SuperClaw swarm executor
 */
export function getSuperClawExecutor(): SuperClawSwarmExecutor | null {
  return superclawExecutor;
}

export class SwarmBridge extends EventEmitter {
  private config: SuperClawConfig;
  private activeSwarms: Map<
    string,
    {
      startTime: number;
      config: SwarmConfig;
    }
  > = new Map();
  private superclawAvailable: boolean | null = null;

  constructor(config: SuperClawConfig) {
    super();
    this.config = config;
  }

  /**
   * Initialize the bridge and check for SuperClaw real swarm
   */
  async initialize(): Promise<void> {
    this.superclawAvailable = await loadSuperClawSwarm();

    if (this.superclawAvailable) {
      console.log("[SuperClaw] Real swarm integration available via llm-run");
    } else {
      console.log("[SuperClaw] Real swarm not available - using lightweight fallback");
    }
  }

  /**
   * Check if swarm functionality is available
   */
  isAvailable(): boolean {
    return (
      this.config.swarm.enabled && (this.superclawAvailable === true || lightweightSwarm !== null)
    );
  }

  /**
   * Spawn a new swarm for a task
   */
  async spawn(swarmConfig: SwarmConfig): Promise<SwarmHandle> {
    if (!this.isAvailable()) {
      throw new Error(
        "Swarm functionality not available. Enable swarms in config and ensure llm-run is available.",
      );
    }

    const swarmId = `swarm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const startTime = Date.now();

    // Store reference
    this.activeSwarms.set(swarmId, {
      startTime,
      config: swarmConfig,
    });

    // Emit start event
    this.emit("swarm:started", { id: swarmId, config: swarmConfig });

    // Create handle
    const handle: SwarmHandle = {
      id: swarmId,
      status: "initializing",
      execute: () => this.executeSwarm(swarmId, swarmConfig),
      cancel: () => this.cancelSwarm(swarmId),
      getProgress: () => this.getProgress(swarmId),
    };

    return handle;
  }

  /**
   * Execute the swarm task
   */
  private async executeSwarm(swarmId: string, config: SwarmConfig): Promise<SwarmResult> {
    const swarm = this.activeSwarms.get(swarmId);
    if (!swarm) {
      throw new Error(`Swarm ${swarmId} not found`);
    }

    const { startTime } = swarm;

    // Get ORACLE recommendation before execution
    let oracleRecommendation = null;
    let bestProvider = null;
    try {
      const oracle = await getOracleLearning();
      const taskType = this.classifyTaskType(config.task);
      oracleRecommendation = await oracle.getRecommendation(taskType);
      bestProvider = oracleRecommendation.bestProvider;

      console.log(
        `[Oracle] Recommendation for ${taskType}: ${bestProvider} (confidence: ${(oracleRecommendation.confidence * 100).toFixed(1)}%)`,
      );

      // Log avoid patterns if any
      if (oracleRecommendation.avoidPatterns.length > 0) {
        console.log(`[Oracle] Avoid patterns: ${oracleRecommendation.avoidPatterns.join(", ")}`);
      }
    } catch (error) {
      console.warn(
        `[Oracle] Failed to get recommendation: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    try {
      // Use real SuperClaw executor if available, otherwise fallback to lightweight
      let result: SwarmResult;

      if (this.superclawAvailable && superclawExecutor) {
        console.log(`[SuperClaw] Executing swarm ${swarmId} with real SuperClaw via llm-run`);

        // Prepare config for SuperClaw executor
        const executorConfig = {
          ...config,
          maxAgents: config.maxAgents || this.config.swarm.maxAgents,
          timeout: config.timeout || this.config.swarm.timeout,
        };

        result = await superclawExecutor.execute(executorConfig);
      } else if (lightweightSwarm) {
        console.log(`[SuperClaw] Executing swarm ${swarmId} with lightweight fallback`);

        // Use lightweight swarm as fallback
        const taskClassification = {
          complexity: "complex" as const,
          confidence: 0.8,
          suggestedModel: "anthropic/claude-sonnet-4-20250514",
          suggestedAgents: ["coder", "reviewer"],
          reasoning: "Swarm task",
        };

        const swarmTasks = await lightweightSwarm.decomposeTask(config.task, taskClassification);
        const swarmResult = await lightweightSwarm.executeSwarm(swarmTasks);

        // Map lightweight result to SwarmResult format
        result = {
          success: swarmResult.success,
          output: swarmResult.mergedOutput,
          agentsUsed: swarmResult.agentsUsed,
          consensusReached: swarmResult.consensusReached,
          executionTimeMs: swarmResult.totalLatencyMs,
          metadata: { swarmId, mode: "lightweight", consensus: true },
        };
      } else {
        throw new Error("No swarm implementation available");
      }

      // Add swarm metadata
      result.metadata = {
        ...result.metadata,
        swarmId,
        topology: config.topology,
      };

      // Store successful swarm results in shared memory
      if (result.success) {
        try {
          const sharedMemory = await getSharedMemory();
          await sharedMemory.store({
            agentId: swarmId,
            content: result.output,
            type: result.consensusReached ? "decision" : "observation",
            tags: ["swarm", config.topology || "fanout", ...(config.tags || [])],
            importance: result.consensusReached ? 0.8 : 0.6,
            source: `swarm:${swarmId}:${config.task.slice(0, 50)}`,
          });
          console.log(`[SharedMemory] Stored swarm result ${swarmId} in shared memory`);
        } catch (error) {
          console.warn(
            `[SharedMemory] Failed to store swarm result: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      // Record interaction in ORACLE for learning
      try {
        const oracle = await getOracleLearning();
        const taskType = this.classifyTaskType(config.task);
        await oracle.recordInteraction({
          provider: bestProvider || "unknown",
          taskType,
          prompt: config.task,
          success: result.success,
          latencyMs: result.executionTimeMs,
          cost: this.estimateSwarmCost(result),
          responseLength: result.output.length,
        });
        console.log(
          `[Oracle] Recorded swarm interaction: ${result.success ? "✓" : "✗"} ${taskType}`,
        );
      } catch (error) {
        console.warn(
          `[Oracle] Failed to record interaction: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      this.emit("swarm:completed", { id: swarmId, result });

      return result;
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;

      this.emit("swarm:failed", { id: swarmId, error });

      // Learn from this failure in ORACLE
      try {
        const oracle = await getOracleLearning();
        const taskType = this.classifyTaskType(config.task);
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Record failed interaction
        await oracle.recordInteraction({
          provider: bestProvider || "unknown",
          taskType,
          prompt: config.task,
          success: false,
          latencyMs: executionTimeMs,
        });

        // Learn from the mistake pattern
        await oracle.learnFromMistake({
          pattern: `Swarm execution failed: ${errorMessage.slice(0, 100)}`,
          rootCause: this.categorizeFailure(errorMessage),
          correction: this.suggestCorrection(errorMessage),
          severity: this.classifyFailureSeverity(errorMessage),
          contexts: [taskType, config.topology || "fanout"],
          tags: ["swarm", "failure", taskType],
        });

        console.log(
          `[Oracle] Learned from swarm failure: ${taskType} - ${errorMessage.slice(0, 50)}`,
        );
      } catch (oracleError) {
        console.warn(
          `[Oracle] Failed to learn from failure: ${oracleError instanceof Error ? oracleError.message : String(oracleError)}`,
        );
      }

      return {
        success: false,
        output: `Swarm execution failed: ${error instanceof Error ? error.message : String(error)}`,
        agentsUsed: 0,
        consensusReached: false,
        executionTimeMs,
        metadata: { swarmId },
      };
    } finally {
      // Cleanup
      await this.cleanupSwarm(swarmId);
    }
  }

  /**
   * Cancel a running swarm
   */
  private async cancelSwarm(swarmId: string): Promise<void> {
    const swarm = this.activeSwarms.get(swarmId);
    if (!swarm) {
      return;
    }

    try {
      if (this.superclawAvailable && superclawExecutor) {
        await superclawExecutor.cancel(swarmId);
      }
      // For lightweight swarm, cancellation is not implemented yet
    } catch (e) {
      // Ignore shutdown errors
    }

    await this.cleanupSwarm(swarmId);
  }

  /**
   * Get progress of a running swarm
   */
  private getProgress(swarmId: string): SwarmProgress {
    const swarm = this.activeSwarms.get(swarmId);
    if (!swarm) {
      return {
        phase: "unknown",
        agentsActive: 0,
        tasksCompleted: 0,
        tasksTotal: 0,
        elapsedMs: 0,
      };
    }

    const elapsedMs = Date.now() - swarm.startTime;

    // Try to get progress from SuperClaw executor
    if (this.superclawAvailable && superclawExecutor) {
      const progress = superclawExecutor.getProgress(swarmId);
      if (progress) {
        return progress;
      }
    }

    // Default progress for lightweight swarm
    return {
      phase: "running",
      agentsActive: swarm.config.maxAgents || 2,
      tasksCompleted: 0,
      tasksTotal: swarm.config.maxAgents || 2,
      elapsedMs,
    };
  }

  /**
   * Clean up a swarm
   */
  private async cleanupSwarm(swarmId: string): Promise<void> {
    const swarm = this.activeSwarms.get(swarmId);
    if (!swarm) {
      return;
    }

    try {
      // No special cleanup needed for llm-run based execution
    } catch (e) {
      // Ignore cleanup errors
    }

    this.activeSwarms.delete(swarmId);
  }

  /**
   * Get count of active swarms
   */
  getActiveCount(): number {
    return this.activeSwarms.size;
  }

  /**
   * Shutdown all active swarms
   */
  async shutdownAll(): Promise<void> {
    const swarmIds = Array.from(this.activeSwarms.keys());
    await Promise.all(swarmIds.map((id) => this.cancelSwarm(id)));
  }

  /**
   * Get swarm health status
   */
  async getHealthStatus(): Promise<{ provider: string; status: "ok" | "error"; error?: string }[]> {
    if (this.superclawAvailable && superclawExecutor) {
      return await superclawExecutor.healthCheck();
    }

    // For lightweight swarm, return basic status
    return [{ provider: "lightweight", status: "ok" }];
  }

  // ═══════════════════════════════════════════════════════════════════
  // ORACLE INTEGRATION HELPERS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Classify task type for ORACLE learning
   */
  private classifyTaskType(task: string): string {
    const taskLower = task.toLowerCase();

    if (/\b(code|function|implement|class|api|programming|debug|fix)\b/.test(taskLower)) {
      return "coding";
    }
    if (/\b(research|analyze|investigate|study|find|search)\b/.test(taskLower)) {
      return "research";
    }
    if (/\b(write|create|generate|draft|compose|author)\b/.test(taskLower)) {
      return "generation";
    }
    if (/\b(explain|describe|summarize|clarify|interpret)\b/.test(taskLower)) {
      return "explanation";
    }
    if (/\b(test|validate|verify|check|review)\b/.test(taskLower)) {
      return "testing";
    }
    if (/\b(plan|strategy|design|architect|outline)\b/.test(taskLower)) {
      return "planning";
    }
    if (/\b(optimize|improve|enhance|refactor)\b/.test(taskLower)) {
      return "optimization";
    }

    return "general";
  }

  /**
   * Estimate cost of a swarm execution
   */
  private estimateSwarmCost(result: SwarmResult): number {
    // Rough estimation based on agents used and output length
    const baseAgentCost = 0.002; // ~$0.002 per agent
    const outputCostPerChar = 0.000001; // Very rough estimate

    return result.agentsUsed * baseAgentCost + result.output.length * outputCostPerChar;
  }

  /**
   * Categorize failure for better learning
   */
  private categorizeFailure(errorMessage: string): string {
    const errorLower = errorMessage.toLowerCase();

    if (/timeout|time.*out|deadline|expired/.test(errorLower)) {
      return "timeout";
    }
    if (/quota|limit|rate.*limit|too.*many/.test(errorLower)) {
      return "rate_limit";
    }
    if (/auth|unauthorized|permission|forbidden|api.*key/.test(errorLower)) {
      return "authentication";
    }
    if (/network|connection|unreachable|dns/.test(errorLower)) {
      return "network";
    }
    if (/memory|resource|cpu|disk/.test(errorLower)) {
      return "resource";
    }
    if (/parsing|format|invalid.*json|syntax/.test(errorLower)) {
      return "format";
    }
    if (/provider|model|unavailable|not.*found/.test(errorLower)) {
      return "provider_unavailable";
    }

    return "unknown";
  }

  /**
   * Suggest correction based on failure type
   */
  private suggestCorrection(errorMessage: string): string {
    const failureType = this.categorizeFailure(errorMessage);

    switch (failureType) {
      case "timeout":
        return "Increase timeout or break task into smaller parts";
      case "rate_limit":
        return "Add delay between requests or use different provider";
      case "authentication":
        return "Check API credentials and permissions";
      case "network":
        return "Check network connectivity and retry";
      case "resource":
        return "Reduce task complexity or increase resource limits";
      case "format":
        return "Validate input format and fix syntax errors";
      case "provider_unavailable":
        return "Use alternative provider or retry later";
      default:
        return "Review error details and adjust task parameters";
    }
  }

  /**
   * Classify failure severity for learning prioritization
   */
  private classifyFailureSeverity(errorMessage: string): "low" | "medium" | "high" {
    const failureType = this.categorizeFailure(errorMessage);

    switch (failureType) {
      case "timeout":
      case "rate_limit":
      case "network":
        return "medium";
      case "authentication":
      case "provider_unavailable":
        return "high";
      case "resource":
      case "format":
        return "low";
      default:
        return "medium";
    }
  }
}

/**
 * Fallback executor for when Claude-Flow is not available
 * Runs task as a single agent instead of a swarm
 */
export class FallbackExecutor {
  async execute(task: string): Promise<SwarmResult> {
    // This would integrate with OpenClaw's normal agent execution
    // For now, return a placeholder that indicates swarm is unavailable
    return {
      success: false,
      output: "Swarm execution not available. Claude-Flow is not installed.",
      agentsUsed: 0,
      consensusReached: false,
      executionTimeMs: 0,
      metadata: {
        fallback: true,
        reason: "claude-flow-not-installed",
      },
    };
  }
}
