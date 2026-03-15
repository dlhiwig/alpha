// @ts-nocheck
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

// =============================================================================
// CORE BRIDGE & INITIALIZATION
// =============================================================================

// Main bridge
export { SuperClawBridge, type ProcessResult, type SessionContext } from "./bridge.js";

// Task routing
export { TaskRouter } from "./router.js";

// Global instance management
export {
  getSuperclaw,
  isInitialized,
  getBridge,
  getSkynetInstance,
  getNemotronModule,
  shutdown,
  classify,
  process,
} from "./init.js";

// =============================================================================
// SKYNET SUBSYSTEMS - Governance + Self-Evolution
// =============================================================================

export * from "./skynet/index.js";

// =============================================================================
// SWARM ORCHESTRATION
// =============================================================================

export * from "./swarm/index.js";

// Swarm bridge integration
export {
  SwarmBridge,
  FallbackExecutor,
  isLightweightSwarmAvailable,
  getLightweightSwarm,
  isSuperClawSwarmAvailable,
  getSuperClawExecutor,
} from "./swarm-bridge.js";

// Real SuperClaw swarm executor
export {
  SuperClawSwarmExecutor,
  createSuperClawSwarmExecutor,
  type ProviderConfig,
  type ProviderResult,
} from "./superclaw-swarm-executor.js";

// Lightweight swarm (OpenClaw native, no Claude-Flow dependency)
export {
  LightweightSwarm,
  createLightweightSwarm,
  type SwarmTask,
  type SubtaskResult,
  type SwarmResult as LightweightSwarmResult,
  type SwarmConfig as LightweightSwarmConfig,
} from "./lightweight-swarm.js";

// =============================================================================
// PROVIDERS - LLM Adapters
// =============================================================================

export * from "./providers/index.js";
export * from "./cli-providers/index.js";

// =============================================================================
// MCP (Model Context Protocol) FEDERATION
// =============================================================================

export * from "./mcp/index.js";

// =============================================================================
// ORACLE - Learning & Pattern Recognition
// =============================================================================

export * from "./oracle/index.js";

// Oracle learning engine
export {
  getOracleLearning,
} from "./oracle-learning.js";

// =============================================================================
// CORTEX - Memory & Knowledge Graph
// =============================================================================

export * from "./cortex/index.js";

// =============================================================================
// CONSENSUS - Voting & Verification
// =============================================================================

export * from "./consensus/index.js";

// Consensus algorithms (quorum + judge)
export {
  QuorumVoting,
  JudgeStep,
  createQuorumVoting,
  createJudgeStep,
  type ConsensusConfig,
  type JudgeVerdict,
  type CandidateScore,
} from "./consensus.js";

// =============================================================================
// HIVEMIND - Distributed Agent Intelligence
// =============================================================================

export * from "./hivemind/index.js";

// =============================================================================
// VOICE - Speech & Audio
// =============================================================================

export * from "./voice/index.js";

// =============================================================================
// COMMUNICATION - Messaging & Channels
// =============================================================================

export * from "./communication/index.js";

// =============================================================================
// COORDINATION - Task Distribution
// =============================================================================

export * from "./coordination/index.js";

// =============================================================================
// ORCHESTRATION - Workflow Management
// =============================================================================

export * from "./orchestration/index.js";

// =============================================================================
// MEMORY SYSTEMS
// =============================================================================

export * from "./memory/index.js";
export * from "./sc-memory/index.js";

// Memory updater
export {
  updateMemory,
  pruneOldMemories,
  consolidateMemories,
} from "./memory-updater.js";

// =============================================================================
// PERSISTENCE - Database & State
// =============================================================================

export * from "./persistence/index.js";

// =============================================================================
// MESSAGE BUS - Event System
// =============================================================================

export * from "./message-bus/index.js";

// =============================================================================
// METRICS & MONITORING
// =============================================================================

export * from "./metrics/index.js";

// =============================================================================
// HEALTH & DIAGNOSTICS
// =============================================================================

export * from "./health/index.js";

// =============================================================================
// QUALITY ASSURANCE
// =============================================================================

export * from "./quality/index.js";

// =============================================================================
// SECURITY
// =============================================================================

export * from "./security/index.js";
export * from "./security-sc/index.js";

// Adaptive safety
export {
  AdaptiveSafetyController,
  type SafetyProfile,
  type RiskAssessment,
} from "./adaptive-safety.js";

// Skill marketplace security scanner
export {
  SkillScanner,
  type ScanResult,
  type Finding,
  type FindingCategory,
  type Severity,
} from "./skill-scanner.js";

// LLM output sanitization (CVE fix — CVSS 7.5)
export {
  sanitizeLLMOutput,
  safeCommitMessage,
  sanitizeShellArg,
  escapeForShell,
} from "./sanitize.js";

// =============================================================================
// TOOLS & UTILITIES
// =============================================================================

export * from "./sc-tools/index.js";
export * from "./sc-utils/index.js";
export * from "./utils/index.js";

// Agent tools
export {
  getSuperclawTools,
  createSuperclawClassifyTool,
  createSuperclawStatusTool,
  createSuperclawMetricsTool,
} from "./tool.js";

// =============================================================================
// SKILLS
// =============================================================================

export * from "./sc-skills/index.js";

// =============================================================================
// CORE TYPES & CONFIGURATION
// =============================================================================

export * from "./types/index.js";
export * from "./sc-types/index.js";
export * from "./core/index.js";

// Main types
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

// =============================================================================
// LLM INTEGRATIONS
// =============================================================================

export * from "./llm/index.js";

// Nemotron local LLM integration (auditor + judge)
export {
  NemotronClient,
  NemotronAuditor,
  NemotronJudge,
  attachNemotronModule,
  type NemotronClientConfig,
  type NemotronModule,
  type Finding,
  type AuditResult,
  type AgentResponse,
  type JudgeResult,
  type RiskLevel as NemotronRiskLevel,
} from "./nemotron-integration.js";

// =============================================================================
// GATEWAY INTEGRATION
// =============================================================================

export * from "./sc-gateway/index.js";

export { 
  createGatewayHook, 
  wrapAgentHandler, 
  type GatewayHookConfig 
} from "./gateway-hook.js";

// =============================================================================
// STANDALONE MODULES
// =============================================================================

export * from "./standalone/index.js";

// =============================================================================
// INTEGRATIONS
// =============================================================================

// Sona integration
export * from "./integrations/sona/index.js";

// Yegge integration
export * from "./integrations/yegge/index.js";

// =============================================================================
// CLAUDE FLOW
// =============================================================================

export * from "./claude-flow/index.js";

// =============================================================================
// METACOGNITIVE REASONING
// =============================================================================

export {
  MetacognitiveEngine,
  type MetacognitiveConfig,
  type ReasoningTrace,
  type Insight,
} from "./metacognitive.js";

// =============================================================================
// SELF-EVOLUTION ENGINE
// =============================================================================

export {
  SelfEvolver,
  getSelfEvolver,
  shutdownSelfEvolver,
  type SelfEvolverConfig,
  type EvolutionOpportunity,
  type EvolutionPlan,
  type CodePatch,
  type SelfEvolveStats,
  type RiskLevel,
  type GovernanceRoute,
} from "./self-evolve.js";

// =============================================================================
// DELTA EVALUATION
// =============================================================================

export {
  DeltaEvaluator,
  type DeltaReport,
  type Delta,
} from "./delta-eval.js";

// =============================================================================
// API ENDPOINT
// =============================================================================

export {
  createSuperClawAPI,
  type SuperClawAPIConfig,
} from "./api-endpoint.js";

// =============================================================================
// MIDDLEWARE
// =============================================================================

export {
  createSuperClawMiddleware,
  type MiddlewareConfig,
} from "./middleware.js";

// =============================================================================
// CONVENIENCE FACTORY
// =============================================================================

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
