// @ts-nocheck
// Consensus System Exports
export * from './types'
export { ConsensusJudge } from './ConsensusJudge'
export { ConsensusAgent } from './ConsensusAgent'
export {
  PERSONALITY_PROMPTS,
  INITIAL_EVALUATION_PROMPT,
  NEGOTIATION_PROMPT,
  SYNTHESIS_PROMPT
} from './PersonalityPrompts'

// Re-export commonly used types
export type {
  ConsensusConfig,
  ConsensusDecision,
  AgentEvaluation,
  AgentPersonality,
  JudgeDecision,
  TaskResult,
  NegotiationRound,
  ConsensusSession,
  ConsensusStatus,
  ConvergenceMetrics
} from './types'

// Factory function for easy setup
// @ts-expect-error - Post-Merge Reconciliation
export function createConsensusJudge(config?: Partial<import('./types').ConsensusConfig>): ConsensusJudge {
  // @ts-expect-error - Post-Merge Reconciliation
  return new ConsensusJudge({
    minAgents: 3,
    maxRounds: 8,
    convergenceThreshold: 0.1,
    approvalThreshold: 70,
    ...config
  })
}

// Quick consensus evaluation
export async function quickConsensus(
  // @ts-expect-error - Post-Merge Reconciliation
  judge: ConsensusJudge,
  taskId: string,
  output: string,
  metadata?: Record<string, any>
): Promise<import('./types').ConsensusDecision> {
  return judge.judgeTaskCompletion(taskId, [{
    taskId,
    agentId: 'quick-eval',
    output,
    metadata: metadata || {}
  }])
}

// Simplified consensus for code review
export async function reviewCode(
  // @ts-expect-error - Post-Merge Reconciliation
  judge: ConsensusJudge,
  code: string,
  context?: string
): Promise<import('./types').ConsensusDecision> {
  return judge.judgeTaskCompletion('code-review', [{
    taskId: 'code-review',
    agentId: 'code-reviewer',
    output: code,
    metadata: { context }
  }])
}