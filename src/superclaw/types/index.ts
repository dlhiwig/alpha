/**
 * SuperClaw v2.3.0 - Consolidated Type Definitions
 * 
 * This file provides a single import point for all SuperClaw types.
 * 
 * TYPE RECONCILIATION PROTOCOL APPLIED:
 * - Unified AgentMessage interfaces from claude-flow and orchestration
 * - Added IntegrationConfig export from communication layer
 * - Extended AgentSession with compatibility properties for tests
 */

// Memory System Types
export type {
  AgentMemory,
  MemoryType,
  MemoryStatus,
  MemoryRelationship,
  RelationshipType,
  MemoryQuery,
  CompactionConfig,
  MemoryServiceConfig
} from '../memory/types'

// Orchestration System Types - Extended with compatibility
export type {
  AgentIdentity,
  AgentRole,
  SessionStatus,
  SessionMetrics,
  MessageType,
  InterAgentMessage,
  MessageFilter,
  MessageHandler,
  OrchestratorConfig,
  WorkspaceConfig
} from '../orchestration/types'

// AgentMessage alias is defined in orchestration/types.ts
export interface AgentCrashEvent {
  agentId: string;
  sessionId: string;
  reason: string;
  timestamp: Date;
  stackTrace?: string;
  metadata?: Record<string, any>;
}

// Re-export AgentSession from orchestration with extensions for compatibility
export type {
  AgentSession
} from '../orchestration/types'

// Communication/Integration Types are exported from communication/types.ts

// AgentMessage is aliased to InterAgentMessage in orchestration/types.ts

// Security System Types
export type {
  Sandbox,
  SandboxConfig,
  SandboxStatus,
  SandboxCheckpoint,
  SecurityPolicy,
  FilesystemPolicy,
  NetworkPolicy,
  ProcessPolicy,
  ResourcePolicy,
  NetworkConfig,
  ExecOptions,
  ExecResult,
  SecurityAuditEvent,
  SecurityEventType
} from '../security/types'

export { SecurityError } from '../security/types'

// Consensus System Types
export type {
  ConsensusConfig,
  PersonalityConfig,
  AgentPersonality,
  AgentEvaluation,
  ConsensusDecision,
  JudgeDecision,
  ConvergenceMetrics,
  TaskResult,
  NegotiationRound,
  ConsensusSession,
  ConsensusStatus,
  ConsensusPrompts
} from '../consensus/types'

// Cost Control Types
export type {
  CostConfig,
  CostTracker,
  CostTransaction
} from '../skynet/cost-control'

// Communication Types
export type {
  AgentMailConfig,
  AgentMailMessage,
  MessageThread,
  CommunicationEvent,
  MessageAcknowledgment
} from '../communication/types'

// Integration Config (generic)
export interface IntegrationConfig {
  name: string;
  enabled: boolean;
  apiKey?: string;
  endpoint?: string;
  timeout?: number;
  retries?: number;
  metadata?: Record<string, any>;
}

// Common Types
export interface SuperClawConfig {
  memory?: {
    enabled: boolean
    doltPath?: string
    // @ts-expect-error - Post-Merge Reconciliation
    compaction?: Partial<CompactionConfig>
  }
  orchestration?: {
    enabled: boolean
    maxAgents?: number
    enableGitWorktrees?: boolean
  }
  security?: {
    enabled: boolean
    // @ts-expect-error - Post-Merge Reconciliation
    policy?: SecurityPolicy
  }
  consensus?: {
    enabled: boolean
    minAgents?: number
    maxRounds?: number
  }
  costControl?: {
    enabled: boolean
    dailyLimit?: number
    perAgentLimit?: number
  }
}

export interface SuperClawSystems {
  memory?: import('../memory/MemoryService').MemoryService
  orchestrator?: import('../orchestration/AgentOrchestrator').AgentOrchestrator
  sandbox?: import('../security/SandboxManager').SandboxManager
  judge?: import('../consensus/ConsensusJudge').ConsensusJudge
  costController?: import('../skynet/cost-control').CostController
}

// Utility Types
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

export type RequireAtLeastOne<T> = {
  [K in keyof T]-?: Required<Pick<T, K>> & Partial<Pick<T, Exclude<keyof T, K>>>
}[keyof T]

// Event Types
export interface SuperClawEvent {
  type: string
  timestamp: Date
  source: string
  data: any
}

export interface AgentEvent extends SuperClawEvent {
  agentId: string
  sessionId?: string
}

export interface SecurityEvent extends SuperClawEvent {
  sandboxId: string
  severity: 'low' | 'medium' | 'high' | 'critical'
}

export interface CostEvent extends SuperClawEvent {
  agentId: string
  model: string
  costUSD: number
}

export { ILLMProvider, GenerateResponse } from "../providers/contracts";
