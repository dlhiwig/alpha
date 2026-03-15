/**
 * Security and sandbox types for container isolation
 * 
 * This module defines the complete type system for SuperClaw's security model,
 * including sandbox configuration, policies, execution controls, and audit events.
 * 
 * @author SuperClaw Security Team
 * @version 2.2.0
 */

/**
 * Configuration for a sandbox environment
 * 
 * Defines resource limits and security policies for isolated container execution.
 * All limits are hard constraints enforced by the container runtime.
 */
export interface SandboxConfig {
  /** Maximum memory allocation in megabytes */
  memoryMB: number
  
  /** CPU limit as a decimal (e.g., 1.0 = 1 core, 0.5 = half core) */
  cpuLimit: number
  
  /** Maximum disk space allocation in gigabytes */
  diskGB: number
  
  /** Maximum execution time in milliseconds before forced termination */
  timeoutMs: number
  
  /** Security policy governing filesystem, network, and process access */
  securityPolicy: SecurityPolicy
  
  /** Optional network configuration (defaults to isolated mode) */
  network?: NetworkConfig
}

/**
 * Comprehensive security policy defining access controls
 * 
 * Combines multiple policy domains to create a complete security profile
 * for sandbox execution. All policies are enforced at the kernel level.
 */
export interface SecurityPolicy {
  /** File system access controls */
  filesystem: FilesystemPolicy
  
  /** Network access and traffic controls */
  network: NetworkPolicy
  
  /** Process execution and resource controls */
  processes: ProcessPolicy
  
  /** System resource usage controls */
  resources: ResourcePolicy
}

/**
 * File system access policy
 * 
 * Defines which paths can be read from, written to, or are explicitly denied.
 * Paths are evaluated in order: deny takes precedence over allow rules.
 */
export interface FilesystemPolicy {
  /** Paths that can be read (supports glob patterns) */
  readPaths: string[]
  
  /** Paths that can be written to (supports glob patterns) */
  writePaths: string[]
  
  /** Paths that are explicitly forbidden (supports glob patterns) */
  denyPaths: string[]
}

/**
 * Network access policy
 * 
 * Controls outbound network connections and traffic patterns.
 * Inbound connections are always blocked in sandbox mode.
 */
export interface NetworkPolicy {
  /** Domains/IPs that are permitted for outbound connections */
  allowDomains: string[]
  
  /** IP ranges that are explicitly blocked (CIDR notation) */
  denyRanges: string[]
  
  /** Maximum concurrent network connections */
  maxConnections: number
  
  /** Timeout for individual network connections in milliseconds */
  connectionTimeoutMs: number
}

/**
 * Process execution policy
 * 
 * Governs which commands can be executed and resource limits per process.
 * Commands are matched by exact binary path or basename.
 */
export interface ProcessPolicy {
  /** Commands that are explicitly permitted (binary names or paths) */
  allowCommands: string[]
  
  /** Commands that are explicitly forbidden (binary names or paths) */
  denyCommands: string[]
  
  /** Maximum number of concurrent processes */
  maxProcesses: number
  
  /** Maximum memory per individual process in megabytes */
  maxMemoryMB: number
  
  /** Timeout for individual process execution in milliseconds */
  processTimeoutMs: number
}

/**
 * System resource usage policy
 * 
 * Defines limits on system resources to prevent resource exhaustion attacks.
 * Limits are enforced through cgroups and kernel quotas.
 */
export interface ResourcePolicy {
  /** Maximum file size in bytes (individual files) */
  maxFileSize: number
  
  /** Maximum total disk usage in bytes */
  maxDiskUsage: number
  
  /** Maximum network bandwidth in bytes per second */
  maxNetworkBandwidth: number
  
  /** Whether to enforce quotas strictly (kill vs. throttle) */
  quotaEnforcement: boolean
}

/**
 * Network configuration for sandbox connectivity
 * 
 * Optional network settings that override default isolation policies.
 * Use with caution as this can weaken security boundaries.
 */
export interface NetworkConfig {
  /** Specific domains to allow (overrides NetworkPolicy.allowDomains) */
  allowDomains?: string[]
  
  /** Whether to allow general internet access (security risk) */
  allowPublicTraffic?: boolean
  
  /** Whether to isolate from host network completely */
  isolateFromHost?: boolean
}

/**
 * Active sandbox instance
 * 
 * Represents a running or configured sandbox with its current state,
 * configuration, and checkpoint history for rollback capabilities.
 */
export interface Sandbox {
  /** Unique sandbox identifier */
  id: string
  
  /** ID of the agent that owns this sandbox */
  agentId: string
  
  /** Container ID from the runtime (Docker/Podman) */
  containerId?: string
  
  /** Configuration used to create this sandbox */
  config: SandboxConfig
  
  /** Current operational status */
  status: SandboxStatus
  
  /** When this sandbox was created */
  createdAt: Date
  
  /** Available checkpoints for rollback operations */
  checkpoints: Map<string, SandboxCheckpoint>
}

/**
 * Possible sandbox operational states
 * 
 * Tracks the lifecycle of a sandbox from creation to termination.
 */
export type SandboxStatus = 'creating' | 'running' | 'paused' | 'stopped' | 'failed'

/**
 * Filesystem checkpoint for rollback operations
 * 
 * Captures the state of a sandbox at a specific point in time,
 * allowing rollback to known-good states after failures or attacks.
 */
export interface SandboxCheckpoint {
  /** Human-readable checkpoint name */
  name: string
  
  /** File system path to the checkpoint data */
  path: string
  
  /** When this checkpoint was created */
  createdAt: Date
  
  /** Size of the checkpoint data in bytes */
  sizeBytes: number
}

/**
 * Options for command execution within a sandbox
 * 
 * Provides fine-grained control over how commands are executed,
 * including environment, working directory, and user context.
 */
export interface ExecOptions {
  /** Command timeout in milliseconds (overrides process policy) */
  timeout?: number
  
  /** Environment variables for the command */
  env?: Record<string, string>
  
  /** Working directory for command execution */
  cwd?: string
  
  /** User to execute the command as (must exist in container) */
  user?: string
}

/**
 * Result of command execution within a sandbox
 * 
 * Contains all output, timing, and termination information from
 * a command executed in the sandbox environment.
 */
export interface ExecResult {
  /** Process exit code (0 = success) */
  exitCode: number
  
  /** Standard output from the command */
  stdout: string
  
  /** Standard error output from the command */
  stderr: string
  
  /** Total execution time in milliseconds */
  durationMs: number
  
  /** Whether the process was killed due to timeout/limits */
  killed?: boolean
  
  /** Signal that terminated the process (if killed) */
  signal?: string
}

/**
 * Security audit event for compliance and monitoring
 * 
 * Records security-relevant actions within sandboxes for audit trails,
 * threat detection, and compliance reporting.
 */
export interface SecurityAuditEvent {
  /** When this event occurred (ISO timestamp) */
  timestamp: Date
  
  /** ID of the sandbox where the event occurred */
  sandboxId: string
  
  /** Type of security event */
  eventType: SecurityEventType
  
  /** Additional event-specific data */
  details: Record<string, any>
  
  /** Severity level for alerting and prioritization */
  severity: 'low' | 'medium' | 'high' | 'critical'
}

/**
 * Types of security events that can occur in sandboxes
 * 
 * Comprehensive enumeration of all security-relevant events that
 * are tracked for audit, alerting, and threat detection purposes.
 */
export type SecurityEventType = 
  | 'sandbox_created'      // New sandbox instance created
  | 'sandbox_destroyed'    // Sandbox instance terminated
  | 'command_executed'     // Command successfully executed
  | 'command_blocked'      // Command blocked by policy
  | 'network_request'      // Outbound network connection made
  | 'network_blocked'      // Network connection blocked by policy
  | 'file_access'          // File system access granted
  | 'file_blocked'         // File system access denied by policy
  | 'resource_limit_hit'   // Resource limit exceeded (memory, CPU, etc.)
  | 'checkpoint_created'   // New checkpoint created
  | 'rollback_executed'    // Rollback to previous checkpoint performed

/**
 * Custom error class for security-related failures
 * 
 * Provides structured error handling for security violations,
 * policy enforcement failures, and sandbox operational errors.
 */
export class SecurityError extends Error {
  /**
   * Create a new SecurityError
   * 
   * @param message - Human-readable error description
   * @param code - Optional error code for programmatic handling
   */
  constructor(message: string, public code?: string) {
    super(message)
    this.name = 'SecurityError'
  }
}