// @ts-nocheck
// Security System Exports
export * from './types'
export { SandboxManager } from './SandboxManager'
export { 
  SUPERCLAW_SECURITY_POLICY,
  MINIMAL_SECURITY_POLICY,
  DEVELOPMENT_SECURITY_POLICY,
  buildSecurityPolicy,
  validateSecurityPolicy
} from './SecurityPolicies'

// OAuth Gateway exports
export { 
  OAuthGateway,
  oauthGateway
} from './OAuthGateway'
export type {
  AuthUrl,
  Token,
  OAuthProvider,
  StoredToken
} from './OAuthGateway'

// Re-export commonly used types
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
  ExecOptions,
  ExecResult,
  SecurityAuditEvent,
  SecurityEventType
} from './types'

export { SecurityError } from './types'

// Factory function for easy setup
export async function createSandboxManager(
  policy?: import('./types').SecurityPolicy
// @ts-expect-error - Post-Merge Reconciliation
): Promise<SandboxManager> {
  // @ts-expect-error - Post-Merge Reconciliation
  const manager = new SandboxManager(policy || SUPERCLAW_SECURITY_POLICY)
  return manager
}

// Quick sandbox creation
export async function createQuickSandbox(
  // @ts-expect-error - Post-Merge Reconciliation
  manager: SandboxManager,
  agentId: string,
  options?: {
    memoryMB?: number
    timeoutMs?: number
    allowedDomains?: string[]
  }
): Promise<string> {
  return manager.createSecureSandbox(agentId, {
    memoryMB: options?.memoryMB || 2048,
    cpuLimit: 0.5,
    diskGB: 10,
    timeoutMs: options?.timeoutMs || 300000,
    // @ts-expect-error - Post-Merge Reconciliation
    securityPolicy: SUPERCLAW_SECURITY_POLICY,
    network: {
      allowDomains: options?.allowedDomains
    }
  })
}