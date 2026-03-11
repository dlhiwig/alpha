/**
 * SuperClaw Swarm Bridge
 * Bridges OpenClaw to Claude-Flow SwarmCoordinator
 */

import { EventEmitter } from "node:events";
import type {
  SwarmConfig,
  SwarmResult,
  SwarmHandle,
  SwarmProgress,
  SuperClawConfig,
  SwarmTopology,
  ConsensusType,
} from "./types.js";

// Type definitions for Claude-Flow (will be replaced with actual imports when integrated)
interface ClaudeFlowSwarmConfig {
  mode?: string;
  strategy?: string;
  logging?: { level: string };
  maxAgents?: number;
}

interface ClaudeFlowObjective {
  description: string;
  priority?: string;
  constraints?: Record<string, unknown>;
}

interface ClaudeFlowSwarmResult {
  success: boolean;
  output: string;
  metrics?: {
    agentsUsed: number;
    executionTimeMs: number;
    tokensUsed?: number;
  };
}

// Import lightweight swarm as fallback
import { LightweightSwarm, createLightweightSwarm } from "./lightweight-swarm.js";

// Placeholder for Claude-Flow import
// In real integration: import { SwarmCoordinator } from 'claude-flow';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let SwarmCoordinator: any = null;

// Lightweight swarm instance for fallback
let lightweightSwarm: LightweightSwarm | null = null;

/**
 * Check if Claude-Flow is available
 */
async function loadClaudeFlow(): Promise<boolean> {
  if (SwarmCoordinator) return true;

  try {
    // Dynamic import to avoid hard dependency
    // @ts-expect-error - claude-flow may not be installed
    const claudeFlow = await import("claude-flow");
    SwarmCoordinator = claudeFlow.SwarmCoordinator;
    return true;
  } catch {
    // Claude-Flow not installed - use lightweight swarm
    console.log("[SuperClaw] Using lightweight swarm (OpenClaw native)");
    lightweightSwarm = createLightweightSwarm();
    return false;
  }
}

/**
 * Check if lightweight swarm is available (always true as fallback)
 */
export function isLightweightSwarmAvailable(): boolean {
  return lightweightSwarm !== null || SwarmCoordinator !== null;
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

export class SwarmBridge extends EventEmitter {
  private config: SuperClawConfig;
  private activeSwarms: Map<
    string,
    {
      coordinator: any;
      startTime: number;
      config: SwarmConfig;
    }
  > = new Map();
  private claudeFlowAvailable: boolean | null = null;

  constructor(config: SuperClawConfig) {
    super();
    this.config = config;
  }

  /**
   * Initialize the bridge and check for Claude-Flow
   */
  async initialize(): Promise<void> {
    this.claudeFlowAvailable = await loadClaudeFlow();

    if (this.claudeFlowAvailable) {
      console.log("[SuperClaw] Claude-Flow swarm integration available");
    } else {
      console.log("[SuperClaw] Claude-Flow not installed - swarm features disabled");
      console.log("[SuperClaw] To enable: npm install claude-flow@alpha");
    }
  }

  /**
   * Check if swarm functionality is available
   */
  isAvailable(): boolean {
    return this.claudeFlowAvailable === true && this.config.swarm.enabled;
  }

  /**
   * Spawn a new swarm for a task
   */
  async spawn(swarmConfig: SwarmConfig): Promise<SwarmHandle> {
    if (!this.isAvailable()) {
      throw new Error(
        "Swarm functionality not available. Install claude-flow or enable swarms in config.",
      );
    }

    const swarmId = `swarm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const startTime = Date.now();

    // Map topology to Claude-Flow mode
    const mode = this.mapTopology(swarmConfig.topology || this.config.swarm.topology);

    // Create Claude-Flow coordinator
    const coordinator = new SwarmCoordinator({
      mode,
      strategy: "auto",
      logging: { level: "error" }, // Keep it quiet
      maxAgents: swarmConfig.maxAgents || this.config.swarm.maxAgents,
    } as ClaudeFlowSwarmConfig);

    // Store reference
    this.activeSwarms.set(swarmId, {
      coordinator,
      startTime,
      config: swarmConfig,
    });

    // Initialize coordinator
    await coordinator.initialize();

    // Set up event forwarding
    this.setupEventForwarding(swarmId, coordinator);

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

    const { coordinator, startTime } = swarm;

    try {
      // Set objective
      await coordinator.setObjective({
        description: config.task,
        priority: "high",
        constraints: config.context,
      } as ClaudeFlowObjective);

      // Execute with timeout
      const timeoutMs = config.timeout || this.config.swarm.timeout;
      const resultPromise = coordinator.execute();

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Swarm execution timeout")), timeoutMs);
      });

      const result = (await Promise.race([resultPromise, timeoutPromise])) as ClaudeFlowSwarmResult;

      const executionTimeMs = Date.now() - startTime;

      const swarmResult: SwarmResult = {
        success: result.success,
        output: result.output || "",
        agentsUsed: result.metrics?.agentsUsed || 1,
        consensusReached: result.success,
        executionTimeMs,
        tokensUsed: result.metrics?.tokensUsed,
        metadata: {
          swarmId,
          topology: config.topology,
        },
      };

      this.emit("swarm:completed", { id: swarmId, result: swarmResult });

      return swarmResult;
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;

      this.emit("swarm:failed", { id: swarmId, error });

      return {
        success: false,
        output: `Swarm execution failed: ${error instanceof Error ? error.message : String(error)}`,
        agentsUsed: 0,
        consensusReached: false,
        executionTimeMs,
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
    if (!swarm) return;

    try {
      await swarm.coordinator.shutdown();
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

    // Try to get metrics from coordinator
    let metrics = {
      phase: "running",
      agentsActive: 1,
      tasksCompleted: 0,
      tasksTotal: 1,
    };

    try {
      const status = swarm.coordinator.getStatus?.();
      if (status) {
        metrics = {
          phase: status.phase || "running",
          agentsActive: status.activeAgents || 1,
          tasksCompleted: status.completedTasks || 0,
          tasksTotal: status.totalTasks || 1,
        };
      }
    } catch (e) {
      // Coordinator may not support getStatus
    }

    return {
      ...metrics,
      elapsedMs,
    };
  }

  /**
   * Clean up a swarm
   */
  private async cleanupSwarm(swarmId: string): Promise<void> {
    const swarm = this.activeSwarms.get(swarmId);
    if (!swarm) return;

    try {
      if (swarm.coordinator.shutdown) {
        await swarm.coordinator.shutdown();
      }
    } catch (e) {
      // Ignore cleanup errors
    }

    this.activeSwarms.delete(swarmId);
  }

  /**
   * Set up event forwarding from Claude-Flow to SuperClaw events
   */
  private setupEventForwarding(swarmId: string, coordinator: any): void {
    if (!coordinator.on) return;

    coordinator.on("agent.spawned", (event: any) => {
      this.emit("swarm:progress", {
        id: swarmId,
        progress: this.getProgress(swarmId),
      });
    });

    coordinator.on("task.completed", (event: any) => {
      this.emit("swarm:progress", {
        id: swarmId,
        progress: this.getProgress(swarmId),
      });
    });

    coordinator.on("error", (error: Error) => {
      this.emit("swarm:failed", { id: swarmId, error });
    });
  }

  /**
   * Map SuperClaw topology to Claude-Flow mode
   */
  private mapTopology(topology: SwarmTopology): string {
    const mapping: Record<SwarmTopology, string> = {
      mesh: "mesh",
      hierarchical: "hierarchical",
      ring: "ring",
      star: "star",
    };
    return mapping[topology] || "hierarchical";
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
