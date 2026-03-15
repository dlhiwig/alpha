// @ts-nocheck
/**
 * SKYNET v2.3.0 SINGULARITY - Unified Exports
 * 
 * This file provides a single import point for all SKYNET capabilities:
 * - Memory System (Dolt-backed persistent memory)
 * - Orchestration System (Multi-agent coordination)
 * - Security System (Container sandboxing)
 * - Consensus System (Multi-LLM decision making)
 * - Cost Control (Budget management)
 */

// Version info
export const SKYNET_VERSION = '2.3.0'
export const SKYNET_CODENAME = 'SINGULARITY'

// Memory System
export {
  createMemoryService,
  DoltService,
  MemoryService,
  MemoryCompactor,
  generateMemoryId,
  generateCorrelationId,
  generateSessionId,
  generateSandboxId
} from '../memory'

export type {
  AgentMemory,
  MemoryType,
  MemoryStatus,
  MemoryRelationship,
  MemoryQuery,
  CompactionConfig,
  MemoryServiceConfig
} from '../memory'

// Orchestration System
export {
  createOrchestrator,
  AgentOrchestrator,
  WorkspaceManager,
  MessageBroker
} from '../orchestration'

export type {
  AgentIdentity,
  AgentRole,
  AgentSession,
  SessionStatus,
  MessageType,
  InterAgentMessage,
  MessageFilter,
  MessageHandler,
  OrchestratorConfig
} from '../orchestration'

// Security System
export {
  createSandboxManager,
  SandboxManager,
  SUPERCLAW_SECURITY_POLICY,
  MINIMAL_SECURITY_POLICY,
  DEVELOPMENT_SECURITY_POLICY,
  buildSecurityPolicy
} from '../security'

export type {
  Sandbox,
  SandboxConfig,
  SecurityPolicy,
  ExecOptions,
  ExecResult,
  SecurityAuditEvent
} from '../security'

export { SecurityError } from '../security'

// Consensus System
export {
  createConsensusJudge,
  ConsensusJudge,
  ConsensusAgent,
  PERSONALITY_PROMPTS
} from '../consensus'

export type {
  ConsensusConfig,
  ConsensusDecision,
  AgentEvaluation,
  AgentPersonality,
  JudgeDecision,
  TaskResult
} from '../consensus'

// Cost Control
export { CostController, globalCostController } from './cost-control'

export type {
  CostConfig,
  CostTracker,
  CostTransaction
} from './cost-control'

// Existing SKYNET components (re-export)
export * from './pulse'
export * from './guardian'
export * from './sentinel'
export * from './oracle'
export * from './nexus'
export * from './cortex'
export * from './moltbook'
export * from './sub-agent'
export * from './thresholds'
export * from './sandbox'

/**
 * Initialize all SKYNET systems
 */
export async function initializeSkynet(config?: {
  memory?: boolean
  orchestration?: boolean
  security?: boolean
  consensus?: boolean
  costControl?: boolean
}): Promise<{
  // @ts-expect-error - Post-Merge Reconciliation
  memory?: MemoryService
  // @ts-expect-error - Post-Merge Reconciliation
  orchestrator?: AgentOrchestrator
  // @ts-expect-error - Post-Merge Reconciliation
  sandbox?: SandboxManager
  // @ts-expect-error - Post-Merge Reconciliation
  judge?: ConsensusJudge
  // @ts-expect-error - Post-Merge Reconciliation
  costController?: CostController
}> {
  const result: any = {}
  
  if (config?.memory !== false) {
    // @ts-expect-error - Post-Merge Reconciliation
    result.memory = await createMemoryService()
  }
  
  if (config?.orchestration !== false) {
    // @ts-expect-error - Post-Merge Reconciliation
    result.orchestrator = await createOrchestrator()
  }
  
  if (config?.security !== false) {
    // @ts-expect-error - Post-Merge Reconciliation
    result.sandbox = await createSandboxManager()
  }
  
  if (config?.consensus !== false) {
    // @ts-expect-error - Post-Merge Reconciliation
    result.judge = createConsensusJudge()
  }
  
  if (config?.costControl !== false) {
    // @ts-expect-error - Post-Merge Reconciliation
    result.costController = new CostController()
  }
  
  return result
}

// Default export for convenience
export default {
  VERSION: SKYNET_VERSION,
  CODENAME: SKYNET_CODENAME,
  initialize: initializeSkynet
}