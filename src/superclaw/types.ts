/**
 * SuperClaw Types
 * Type definitions for the OpenClaw + Claude-Flow + Agentic-Flow bridge
 */

export type TaskComplexity = "simple" | "medium" | "complex";

export type SwarmTopology = "mesh" | "hierarchical" | "ring" | "star";

export type ConsensusType = "raft" | "byzantine" | "gossip" | "majority";

export type RoutingStrategy = "cost" | "quality" | "balanced";

export interface SuperClawConfig {
  enabled: boolean;

  routing: {
    strategy: RoutingStrategy;
    /** Use WASM transforms for simple tasks (skip LLM) */
    agentBoosterEnabled: boolean;
    /** Prefer local Ollama models for simple tasks (faster, free) */
    preferLocal: boolean;
    /** Maximum cost per task in dollars */
    costThreshold: number;
    /** Maximum latency per task in ms */
    latencyThreshold: number;
  };

  swarm: {
    enabled: boolean;
    /** Maximum agents per swarm */
    maxAgents: number;
    /** Default topology */
    topology: SwarmTopology;
    /** Consensus algorithm */
    consensus: ConsensusType;
    /** Prevent goal drift */
    antiDrift: boolean;
    /** Checkpoint interval in ms */
    checkpointInterval: number;
    /** Task timeout in ms */
    timeout: number;
  };

  learning: {
    enabled: boolean;
    /** Store successful patterns */
    storePatterns: boolean;
    /** Minimum reward to store pattern */
    minRewardThreshold: number;
  };
}

export const DEFAULT_CONFIG: SuperClawConfig = {
  enabled: true,
  routing: {
    strategy: "balanced",
    agentBoosterEnabled: false, // Start conservative
    preferLocal: true, // Use Ollama dolphin-llama3:8b for simple tasks
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
    timeout: 300000, // 5 minutes
  },
  learning: {
    enabled: true,
    storePatterns: true,
    minRewardThreshold: 0.7,
  },
};

export interface TaskClassification {
  complexity: TaskComplexity;
  confidence: number;
  suggestedModel: string;
  suggestedAgents: string[];
  reasoning: string;
}

export interface SwarmConfig {
  task: string;
  topology?: SwarmTopology;
  maxAgents?: number;
  consensus?: ConsensusType;
  timeout?: number;
  context?: Record<string, unknown>;
}

export interface SwarmResult {
  success: boolean;
  output: string;
  agentsUsed: number;
  consensusReached: boolean;
  executionTimeMs: number;
  tokensUsed?: number;
  cost?: number;
  metadata?: Record<string, unknown>;
}

export interface SwarmHandle {
  id: string;
  status: "initializing" | "running" | "completed" | "failed" | "cancelled";
  execute: () => Promise<SwarmResult>;
  cancel: () => Promise<void>;
  getProgress: () => SwarmProgress;
}

export interface SwarmProgress {
  phase: string;
  agentsActive: number;
  tasksCompleted: number;
  tasksTotal: number;
  elapsedMs: number;
}

export interface PatternMatch {
  id: string;
  task: string;
  output: string;
  similarity: number;
  reward: number;
  success: boolean;
}

export interface LearningOutcome {
  sessionKey: string;
  task: string;
  response: string;
  success: boolean;
  latencyMs: number;
  tokensUsed: number;
  model: string;
  wasSwarm: boolean;
  agentsUsed?: number;
}

export interface BridgeMetrics {
  totalRequests: number;
  swarmRequests: number;
  singleAgentRequests: number;
  averageLatencyMs: number;
  successRate: number;
  costSaved: number;
}

export interface BridgeEvents {
  "task:classified": { task: string; classification: TaskClassification };
  "swarm:started": { id: string; config: SwarmConfig };
  "swarm:progress": { id: string; progress: SwarmProgress };
  "swarm:completed": { id: string; result: SwarmResult };
  "swarm:failed": { id: string; error: Error };
  "pattern:matched": { task: string; patterns: PatternMatch[] };
  "pattern:stored": { outcome: LearningOutcome };
}
