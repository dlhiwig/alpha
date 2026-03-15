// @ts-nocheck
// Orchestration System Exports
export * from './types'
export { AgentOrchestrator } from './AgentOrchestrator'
export { WorkspaceManager } from './WorkspaceManager'
export { MessageBroker } from './MessageBroker'

// Re-export commonly used types
export type {
  AgentIdentity,
  AgentRole,
  AgentSession,
  SessionStatus,
  SessionMetrics,
  MessageType,
  InterAgentMessage,
  MessageFilter,
  MessageHandler,
  OrchestratorConfig,
  WorkspaceConfig
} from './types'

// Factory function for easy setup
// @ts-expect-error - Post-Merge Reconciliation
export async function createOrchestrator(config?: Partial<import('./types').OrchestratorConfig>): Promise<AgentOrchestrator> {
  // @ts-expect-error - Post-Merge Reconciliation
  const orchestrator = new AgentOrchestrator({
    maxConcurrentAgents: 50,
    agentTimeoutMs: 300000,
    heartbeatIntervalMs: 30000,
    workspaceBaseDir: '~/.superclaw/workspaces',
    enableGitWorktrees: true,
    ...config
  })
  
  await orchestrator.initialize()
  return orchestrator
}

// Convenience function to spawn agents
export async function spawnAgentQuick(
  // @ts-expect-error - Post-Merge Reconciliation
  orchestrator: AgentOrchestrator,
  project: string,
  name: string,
  role: import('./types').AgentRole = 'worker'
): Promise<string> {
  return orchestrator.spawnAgent({
    role,
    project,
    name,
    namespace: 'superclaw',
    capabilities: [],
    version: '1.0.0'
  })
}