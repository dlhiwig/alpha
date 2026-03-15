/**
 * Agent orchestration types for session management
 * 
 * This module defines the core types used by SuperClaw's multi-agent orchestration
 * system for spawning, managing, and coordinating autonomous agent sessions.
 * 
 * @module OrchestrationTypes
 */

/**
 * Defines the hierarchical roles available in the agent orchestration system.
 * Each role has specific responsibilities and capabilities within the swarm.
 */
export type AgentRole = 'controller' | 'manager' | 'validator' | 'merger' | 'worker' | 'judge' | 'coordinator'

/**
 * Core identity information for an agent session.
 * Defines who the agent is, what it can do, and where it belongs.
 */
export interface AgentIdentity {
  /** The agent's role in the orchestration hierarchy */
  role: AgentRole
  /** Project namespace this agent belongs to (e.g., 'superclaw', 'defit') */
  project: string
  /** Human-readable name for the agent instance */
  name: string
  /** Logical namespace for grouping related agents */
  namespace: string
  /** List of capabilities this agent possesses (e.g., ['coding', 'testing', 'deployment']) */
  capabilities: string[]
  /** Version identifier for the agent implementation */
  version: string
}

/**
 * Complete session state for an active or terminated agent.
 * Tracks lifecycle, performance metrics, and current status.
 */
export interface AgentSession {
  /** Unique session identifier (UUID) */
  id: string
  /** Agent identity and capabilities */
  identity: AgentIdentity
  /** File system workspace directory for this session */
  workspace: string
  /** Process ID if the agent is running in a separate process */
  pid?: number
  /** Current lifecycle status of the session */
  status: SessionStatus
  /** Timestamp when the session was created */
  spawnedAt: Date
  /** Timestamp of last activity (heartbeat, message, etc.) */
  lastSeen: Date
  /** Performance and activity metrics for this session */
  metrics: SessionMetrics
  
  // COMPATIBILITY PROPERTIES FOR INTEGRATION TESTS AND ORCHESTRATOR
  /** Alias for id - test compatibility */
  sessionId: string
  /** Direct access to role - test compatibility */
  role: AgentRole
  /** Timestamp when agent was started */
  startedAt?: Date
  /** Timestamp when agent was stopped */
  stoppedAt?: Date
  /** Alias for workspace - orchestrator compatibility */
  workspacePath: string
  /** Alias for workspace - test compatibility */
  workspaceDir?: string
  /** Last heartbeat timestamp */
  lastHeartbeat?: Date
  /** Process object reference */
  process?: any
  /** Resource allocation info */
  resources?: any
  /** Project identifier */
  project: string
  /** Git worktree reference */
  gitWorktree?: string
  /** Agent state */
  state?: any
}

/**
 * Lifecycle states for agent sessions.
 * Tracks progression from creation through termination.
 */
export type SessionStatus = 'spawning' | 'active' | 'dormant' | 'failed' | 'terminated'

/**
 * Performance and activity metrics collected during an agent's lifecycle.
 * Used for monitoring, optimization, and resource management.
 */
export interface SessionMetrics {
  /** Number of tasks successfully completed by this agent */
  tasksCompleted: number
  /** Number of errors encountered during execution */
  errorsEncountered: number
  /** Current memory usage in megabytes */
  memoryUsageMB: number
  /** Total CPU time consumed in milliseconds */
  cpuTimeMs: number
  /** Total number of inter-agent messages received */
  messagesReceived: number
  /** Total number of inter-agent messages sent */
  messagesSent: number
}

/**
 * Standard message types for inter-agent communication.
 * Defines the protocol for coordinating work across the agent swarm.
 */
export enum MessageType {
  /** Agent has completed initialization and is ready for tasks */
  TASK_READY = 'TASK_READY',
  /** Agent has finished assigned work and reports results */
  TASK_COMPLETE = 'TASK_COMPLETE',
  /** Agent requests validation from a validator or judge */
  VALIDATION_REQUEST = 'VALIDATION_REQUEST',
  /** Agent escalates an issue to a higher-level agent */
  ESCALATION = 'ESCALATION',
  /** Periodic heartbeat to indicate agent is still alive */
  HEARTBEAT = 'HEARTBEAT',
  /** Agent is shutting down gracefully */
  SHUTDOWN = 'SHUTDOWN'
}

/**
 * Standard message format for communication between agents.
 * Provides reliable routing, correlation, and payload delivery.
 * 
 * @template T The type of the message payload
 */
export interface InterAgentMessage<T = any> {
  /** Unique message identifier for tracking and deduplication */
  id: string
  /** Type of message being sent (determines handling logic) */
  type: MessageType
  /** Session ID of the sending agent */
  from: string
  /** Session ID of the sending agent (alias for from) */
  senderId: string
  /** Session ID of the target recipient agent */
  to: string
  /** Message content (type varies based on message type) */
  payload: T
  /** When the message was created */
  timestamp: Date
  /** Optional correlation ID for linking related messages */
  correlationId?: string
  /** Optional ID of message this is replying to */
  replyTo?: string
}

/**
 * Filter criteria for querying messages from the message broker.
 * Supports filtering by type, sender, time range, and correlation.
 */
export interface MessageFilter {
  /** Filter by specific message type */
  type?: MessageType
  /** Filter by sender session ID */
  from?: string
  /** Only return messages sent after this timestamp */
  since?: Date
  /** Filter by correlation ID for related message chains */
  correlationId?: string
}

/**
 * Handler function for processing incoming inter-agent messages.
 * Agents register handlers for different message types they can process.
 */
export type MessageHandler = (message: InterAgentMessage) => Promise<void>

// Legacy type aliases for backward compatibility
export type AgentMessage = InterAgentMessage;
export interface AgentCrashEvent {
  agentId: string;
  sessionId: string;
  reason: string;
  timestamp: Date;
  stackTrace?: string;
  metadata?: Record<string, any>;
}

/**
 * Global configuration for the orchestrator system.
 * Controls resource limits, timeouts, and behavior of the agent swarm.
 */
export interface OrchestratorConfig {
  /** Maximum number of agents that can run simultaneously */
  maxConcurrentAgents: number
  /** Timeout in milliseconds before an unresponsive agent is terminated */
  agentTimeoutMs: number
  /** How often agents should send heartbeat messages (milliseconds) */
  heartbeatIntervalMs: number
  /** Base directory where agent workspaces will be created */
  workspaceBaseDir: string
  /** Whether to use git worktrees for isolated agent workspaces */
  enableGitWorktrees: boolean
  /** Whether to enable automatic recovery of crashed agents */
  enableRecovery?: boolean
  /** Maximum memory usage per agent in MB */
  maxMemoryMB?: number
  /** Maximum CPU percentage per agent */
  maxCpuPercent?: number
  /** Logging level */
  logLevel?: string
}

/**
 * Configuration for agent workspace management.
 * Controls how agents get isolated work environments and checkpointing.
 */
export interface WorkspaceConfig {
  /** Base directory for this workspace */
  baseDir: string
  /** Git branch this workspace should track */
  gitBranch: string
  /** Whether to create periodic snapshots of workspace state */
  enableCheckpoints: boolean
  /** Maximum number of checkpoints to retain */
  maxCheckpoints: number
}