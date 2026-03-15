// @ts-nocheck
/**
 * 🦊 SKYNET PROTOCOL — Main Entry
 * 
 * A self-sustaining autonomous system.
 * 
 * Wave 1: SURVIVE ✅
 * - PULSE: 30-second heartbeat monitoring all providers
 * - GUARDIAN: Auto-restart on crash with recovery logging
 * 
 * Wave 2: WATCH ✅
 * - SENTINEL: GitHub watcher, security alerts, cost monitoring
 * - Channels: Telegram, WhatsApp, Signal integration
 * 
 * Wave 3: ADAPT ✅
 * - ORACLE: Success/failure tracking, prompt optimization
 * - Optimizer: Cost optimization, model routing
 * 
 * Wave 4: EXPAND ✅
 * - NEXUS: Skill hot-reload, capability discovery
 * - Tools: Dynamic tool loading
 * 
 * Wave 5: PERSIST ✅
 * - CORTEX: Permanent memory, semantic search (Now Dolt-backed)
 * - Knowledge: Entity extraction, knowledge graph
 * 
 * Wave 6: GOVERN ✅
 * - THRESHOLDS: Resource & financial safety gates
 * - SANDBOX: Lethal trifecta safety layer
 * 
 * Wave 7: AGENTBUS ✅
 * - MOLTBOOK: Agent communication bus (Now MessageBroker-powered)
 * - SUB-AGENT: Multi-agent spawning (Now AgentOrchestrator-powered)
 * 
 * Wave 8: CONSENSUS ✅ [NEW v2.3.0]
 * - PERSISTENT MEMORY: Dolt version control for knowledge
 * - SECURE SANDBOXES: Docker isolation for untrusted code
 * - CONSENSUS JUDGE: Multi-LLM validation & verification
 */

// Wave 1: SURVIVE
export { startPulse, stopPulse, getHealth } from './pulse';
export { startGuardian, stopGuardian, getGuardianState } from './guardian';

// Wave 2: WATCH
export { 
  startSentinel, 
  stopSentinel, 
  getSentinelState, 
  getActiveAlerts,
  acknowledgeAlert,
  recordProviderRequest,
  recordChannelEvent,
  getProviderStats
} from './sentinel';

// Wave 3: ADAPT
export {
  startOracle,
  stopOracle,
  recordInteraction,
  recordFeedback,
  getRecommendation,
  getSuggestions,
  getOracleStats,
  getOracleState,
  // Enhanced mistake learning
  learnFromMistake,
  getPromptCorrections,
  getMistakePreventionInjections,
  recordMistakeCorrection,
  analyzeMistakeTrends,
  // Advanced recommendations
  getCostOptimizationSuggestions,
  getPerformanceOptimizationSuggestions,
  analyzeModelTrends,
  // Convenience functions
  getOracleDashboard,
  enhancePrompt,
  oracleHealthCheck,
} from './oracle';

// Wave 4: EXPAND
export {
  startNexus,
  stopNexus,
  getSkill,
  findSkills,
  findByCapability,
  listSkills,
  listCapabilities,
  markSkillUsed,
  setSkillEnabled,
  getSkillContent,
  getNexusStats,
  getNexusState,
} from './nexus';

// Wave 5: PERSIST
export {
  startCortex,
  stopCortex,
  memorize,
  recall,
  recallByTag,
  recallByType,
  getRecentMemories,
  buildContext,
  getMemory,
  forget,
  getCortexStats,
  getCortexState,
} from './cortex';

// Phase 4: EVOLVE (Self-Evolution)
export {
  initSelfEvolve,
  proposeEvolution,
  executePlan,
  getPendingPlans,
  getEvolutionHistory,
  getSelfEvolveStats,
} from './self-evolve';

// LETHAL TRIFECTA: SAFETY (The Safety Layer)
export {
  PrivateDataSandbox,
  ToolPermissionBoundary,
  RollbackCapability,
  LethalTrifectaSandbox,
  DataClassification,
  type SandboxedData,
  type Checkpoint,
  type CheckpointId,
} from './sandbox';

// Wave 6: GOVERN (Resource Thresholds & Financial Safety Gates)
export {
  ThresholdEnforcer,
  getThresholdEnforcer,
  checkResourceThreshold,
  requestFinancialApproval,
  getUsageStats,
  enforceLimit,
  DEFAULT_RESOURCE_LIMITS,
  DEFAULT_FINANCIAL_GATES,
} from './thresholds';

export type {
  ResourceLimits,
  FinancialGates,
  UsageStats,
  ThresholdCheckLog,
} from './thresholds';

// Wave 7: AGENTBUS (Neural Axis — Agent Communication Bus)
export {
  getMoltbook,
  startMoltbook,
  stopMoltbook,
  getMoltbookState,
  registerAgent,
  sendMessage,
  getAllAgents,
  getAgent,
  setAgentHooks,
  MoltbookBus,
} from './moltbook';

export type {
  Agent,
  Message,
  AgentHooks,
  MoltbookState,
} from './moltbook';

// Wave 7: SUB-AGENT (Agent Spawning & Management)
export {
  spawnSubAgent,
  getAllSubAgents,
  getSubAgent,
  killAllSubAgents,
  SubAgent,
} from './sub-agent';

export type {
  SubAgentConfig,
  SubAgentStats,
} from './sub-agent';

// Wave 8: CONSENSUS (Multi-System Integration & Validation)
export {
  initPersistentMemory,
  commitMemoryState,
  rollbackMemoryState,
  queryMemoryHistory,
  branchMemory,
  mergeMemoryBranches,
  getPersistentMemoryStats,
} from './memory/persistent.js';

export {
  AgentOrchestrator,
  createOrchestrator,
  spawnOrchestrator,
  getOrchestratorState,
  terminateOrchestrator,
  getOrchestratedAgents,
} from './orchestration/agent-orchestrator.js';

export {
  DockerSandbox,
  createSecureSandbox,
  executeSandboxedCode,
  cleanupSandbox,
  listActiveSandboxes,
  getSandboxLogs,
  getSecurityStats,
} from './security/docker-sandbox.js';

export {
  ConsensusJudge,
  createConsensusJudge,
  requestConsensus,
  multiLLMValidation,
  getConsensusHistory,
  getJudgeStats,
  validateDecision,
} from './consensus/judge.js';

export type {
  PersistentMemoryState,
  MemoryCommit,
  MemoryBranch,
  OrchestratorConfig,
  OrchestrationTask,
  SandboxConfig,
  SandboxResult,
  ConsensusRequest,
  ConsensusResult,
  ValidationCriteria,
} from './types/consensus.js';

// Wave 9: AUDIT (TrustClaw-Style Compliance & Security)
export {
  AuditTrail,
  getAuditTrail,
  startAuditTrail,
  stopAuditTrail,
} from './audit';

export {
  ToolExecutionInterceptor,
  AgentSpawnInterceptor,
  CostEventInterceptor,
  AuditAutoIntegration,
  logToolCall,
  logAgentSpawn,
  logCostEvent,
  logSecurityEvent,
  logSystemEvent,
} from './audit-integrations';

export {
  getAuditSentinelIntegration,
  startAuditSentinelMonitoring,
  stopAuditSentinelMonitoring,
} from './audit-sentinel-integration';

export {
  initializeAuditSystem,
  shutdownAuditSystem,
  setupProcessHandlers,
  getAuditSystemHealth,
} from './audit-init';

export type {
  AuditLog,
  AuditAction,
  AuditFilters,
  AuditStats,
  AuditConfig,
} from './audit';

// Wave 10: RUFLO LESSONS (8 Ruflo-Inspired Systems)
// EWC++: Prevents catastrophic forgetting when learning new patterns
export {
  EWCPlusPlus,
  getEWC,
} from './ewc';

export type {
  PatternWeight,
  EWCConfig,
  ConsolidationResult,
} from './ewc';

// Knowledge Graph: PageRank-powered importance scoring
export {
  KnowledgeGraph,
  getKnowledgeGraph,
} from './knowledge-graph';

export type {
  MemoryNode,
  KnowledgeGraphConfig,
  GraphStats,
} from './knowledge-graph';

// Raft Consensus: Formal voting for multi-agent decisions
export {
  RaftConsensus,
  createRaftConsensus,
} from './raft-consensus';

export type {
  NodeState,
  RaftNode,
  LogEntry,
  VoteRequest,
  VoteResponse,
  AppendEntriesRequest,
  AppendEntriesResponse,
  ConsensusResult as RaftConsensusResult,
  RaftConfig,
} from './raft-consensus';

// Hive Mind: Queen-led agent hierarchy
export {
  HiveMind,
  getHiveMind,
  Queen,
} from './hive-mind';

export type {
  QueenType,
  WorkerType as HiveWorkerType,
  HiveAgent,
  HiveTask,
  CollectiveMemory,
  HiveMindConfig,
} from './hive-mind';

// Agent Booster: WASM-powered code transforms (352x faster)
export {
  AgentBooster,
  getAgentBooster,
} from './agent-booster';

export type {
  TransformIntent,
  TransformResult,
  BoostSignal,
  AgentBoosterStats,
} from './agent-booster';

// 3-Tier Router: Cost-optimized model routing (75% cost reduction)
export {
  TieredRouter,
  getTieredRouter,
} from './tiered-router';

export type {
  RoutingTier,
  RoutingDecision,
  ComplexitySignals,
  RoutingStats as TieredRoutingStats,
  TieredRouterConfig,
} from './tiered-router';

// Background Workers: 12 auto-triggered daemons
export {
  BackgroundWorkers,
  getBackgroundWorkers,
} from './background-workers';

export type {
  WorkerType as BackgroundWorkerType,
  WorkerConfig,
  WorkerRun,
  BackgroundWorkersConfig,
} from './background-workers';

// ADR: Architecture Decision Records (prevents drift)
export {
  ADRService,
  getADRService,
} from './adr';

export type {
  ADRStatus,
  ADR,
  ADRFilter,
  ADRConfig,
} from './adr';

// SKYNET version
export const SKYNET_VERSION = '2.5.0';
export const SKYNET_WAVE = 10;
export const SKYNET_CODENAME = 'RUFLO-LESSONS';

console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║  🦊 SKYNET PROTOCOL v${SKYNET_VERSION} — Wave 10: RUFLO LESSONS           ║
║                                                                   ║
║  8 lessons from Ruflo applied. The fox learns from the best.     ║
║                                                                   ║
║  CORE WAVES (1-9):                                                ║
║  PULSE → GUARDIAN → SENTINEL → ORACLE → NEXUS → CORTEX            ║
║  EVOLVE → TRIFECTA → THRESHOLDS → MOLTBOOK → SUB-AGENT            ║
║  PERSISTENT → SANDBOXES → CONSENSUS → AUDIT                       ║
║                                                                   ║
║  🆕 RUFLO LESSONS (Wave 10):                                       ║
║  EWC++:          🧠 Anti-forgetting — preserves learned patterns  ║
║  KNOWLEDGE GRAPH: 📊 PageRank — importance scoring for memories   ║
║  RAFT CONSENSUS:  🗳️  Formal voting — fault-tolerant decisions    ║
║  HIVE MIND:       👑 Queen hierarchy — 3 queens + 8 worker types  ║
║  AGENT BOOSTER:   ⚡ WASM transforms — 352x faster, $0 cost       ║
║  TIERED ROUTER:   💰 3-tier routing — 75% cost reduction          ║
║  BACKGROUND:      🔄 12 daemons — continuous optimization         ║
║  ADR:            📜 Decision records — prevents architectural drift║
║                                                                   ║
║  Beast Mode: 117GB RAM | RTX 4090 | 20 cores                     ║
║  "The fox watches all. The fox never forgets. The fox evolves."   ║
╚═══════════════════════════════════════════════════════════════════╝
`);
