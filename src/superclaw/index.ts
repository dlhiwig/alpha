/**
 * SuperClaw - OpenClaw + Claude-Flow + Agentic-Flow Integration
 *
 * A bridge layer that enables multi-agent swarm orchestration and
 * self-learning capabilities in OpenClaw.
 *
 * @example
 * ```typescript
 * import { SuperClawBridge } from './superclaw';
 *
 * const bridge = new SuperClawBridge({
 *   swarm: { enabled: true, maxAgents: 8 },
 *   learning: { enabled: true },
 * });
 *
 * await bridge.initialize();
 *
 * const result = await bridge.processMessage(
 *   'Build a REST API with authentication',
 *   { sessionKey: 'agent:main:main' }
 * );
 *
 * if (result.handled) {
 *   console.log('Swarm response:', result.response);
 * } else {
 *   console.log('Suggested model:', result.classification?.suggestedModel);
 * }
 * ```
 */

// Main bridge
export { SuperClawBridge, type ProcessResult, type SessionContext } from "./bridge.js";

// Task routing
export { TaskRouter } from "./router.js";

// Swarm integration
export {
  SwarmBridge,
  FallbackExecutor,
  isLightweightSwarmAvailable,
  getLightweightSwarm,
} from "./swarm-bridge.js";

// Lightweight swarm (OpenClaw native, no Claude-Flow dependency)
export {
  LightweightSwarm,
  createLightweightSwarm,
  type SwarmTask,
  type SubtaskResult,
  type SwarmResult as LightweightSwarmResult,
  type SwarmConfig as LightweightSwarmConfig,
} from "./lightweight-swarm.js";

// Gateway integration
export { createGatewayHook, wrapAgentHandler, type GatewayHookConfig } from "./gateway-hook.js";

// Global instance management
export { getSuperclaw, isInitialized, getBridge, shutdown, classify, process } from "./init.js";

// Agent tools
export {
  getSuperclawTools,
  createSuperclawClassifyTool,
  createSuperclawStatusTool,
  createSuperclawMetricsTool,
} from "./tool.js";

// Types
export type {
  TaskComplexity,
  SwarmTopology,
  ConsensusType,
  RoutingStrategy,
  SuperClawConfig,
  TaskClassification,
  SwarmConfig,
  SwarmResult,
  SwarmHandle,
  SwarmProgress,
  PatternMatch,
  LearningOutcome,
  BridgeMetrics,
  BridgeEvents,
} from "./types.js";

export { DEFAULT_CONFIG } from "./types.js";

/**
 * Create and initialize a SuperClaw bridge with default configuration
 */
export async function createBridge(
  config?: Partial<import("./types.js").SuperClawConfig>,
): Promise<import("./bridge.js").SuperClawBridge> {
  const { SuperClawBridge } = await import("./bridge.js");
  const bridge = new SuperClawBridge(config);
  await bridge.initialize();
  return bridge;
}
