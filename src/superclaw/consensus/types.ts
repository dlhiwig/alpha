/**
 * @fileoverview Consensus types for multi-LLM decision making system
 * @description SuperClaw's consensus mechanism allows multiple LLM agents with different
 * personalities to evaluate tasks and reach collective decisions through iterative rounds
 * of negotiation until convergence or maximum rounds are reached.
 */

/**
 * Configuration for consensus decision-making process
 * @description Defines the parameters for how agents will negotiate and reach consensus
 */
export interface ConsensusConfig {
  /** Minimum number of agents required to participate in consensus */
  minAgents: number
  
  /** Maximum number of negotiation rounds before giving up */
  maxRounds: number
  
  /** Convergence threshold as decimal (e.g. 0.1 = 10% standard deviation) */
  convergenceThreshold: number
  
  /** Minimum approval score needed for task approval (0-100) */
  approvalThreshold: number
  
  /** Mix of agent personalities and their configurations */
  personalityMix: PersonalityConfig[]
}

/**
 * Configuration for an individual agent personality in the consensus
 * @description Links a provider (LLM) to a specific personality type with optional weighting
 */
export interface PersonalityConfig {
  /** LLM provider identifier (e.g. 'claude', 'gemini', 'gpt4') */
  provider: string
  
  /** The personality type this agent should embody */
  personality: AgentPersonality
  
  /** Optional weight for this agent's vote (default: 1.0) */
  weight?: number
}

/**
 * Different personality types that agents can embody during evaluation
 * @description Each personality focuses on different aspects of code quality and safety
 */
export type AgentPersonality = 
  | 'security-focus'        // Prioritizes security vulnerabilities and best practices
  | 'performance-focus'     // Focuses on efficiency and optimization
  | 'maintainability-focus' // Emphasizes code readability and long-term maintenance
  | 'code-quality-focus'    // Strict adherence to coding standards and patterns
  | 'stubborn'             // Resistant to change, highly critical
  | 'balanced'             // Considers all factors equally

/**
 * Individual agent's evaluation of a task during a consensus round
 * @description Contains the agent's score, reasoning, and specific concerns/recommendations
 */
export interface AgentEvaluation {
  /** Unique identifier for this agent */
  agentId: string
  
  /** The personality this agent is embodying */
  personality: AgentPersonality
  
  /** Numerical score from 0-100 (higher = better/more approved) */
  score: number
  
  /** Confidence level in this evaluation from 0-100 */
  confidence: number
  
  /** Detailed reasoning for the score given */
  reasoning: string
  
  /** Specific concerns or issues identified */
  concerns: string[]
  
  /** Suggestions for improvement or next steps */
  recommendations: string[]
  
  /** When this evaluation was completed */
  timestamp: Date
  
  /** Which negotiation round this evaluation belongs to */
  round: number
}

/**
 * Final consensus decision after all rounds are complete
 * @description Aggregates all agent evaluations into a single decision with metrics
 */
export interface ConsensusDecision {
  /** The final judge decision */
  decision: JudgeDecision
  
  /** Overall confidence in the consensus (0-100) */
  confidence: number
  
  /** Summary reasoning for the final decision */
  reasoning: string
  
  /** Total number of negotiation rounds completed */
  rounds: number
  
  /** Number of agents that participated */
  participatingAgents: number
  
  /** All individual agent evaluations from the final round */
  evaluations: AgentEvaluation[]
  
  /** Whether agents converged within the threshold */
  convergenceReached: boolean
  
  /** Whether agents converged (alias for convergenceReached) */
  converged: boolean
  
  /** Statistical metrics about the convergence process */
  convergenceMetrics: ConvergenceMetrics
}

/**
 * The final binary decision from the consensus process
 * @description Simplified yes/no decision with supporting details
 */
export interface JudgeDecision {
  /** Whether the task is approved (true) or rejected (false) */
  approved: boolean
  
  /** Final consensus score (0-100) */
  score: number
  
  /** Summary reasoning for approval/rejection */
  reasoning: string
  
  /** Key concerns that influenced the decision */
  concerns: string[]
  
  /** Recommended next steps or improvements */
  recommendations: string[]
  
  /** Selected implementation (for backward compatibility) */
  selectedImplementation?: string
  
  /** Feedback text (for backward compatibility) */
  feedback?: string
}

/**
 * Statistical metrics about how agents converged (or didn't) during consensus
 * @description Provides insight into the quality and stability of the consensus process
 */
export interface ConvergenceMetrics {
  /** Variance in scores at the beginning of consensus */
  initialVariance: number
  
  /** Variance in scores at the end of consensus */
  finalVariance: number
  
  /** Standard deviation of final scores */
  standardDeviation: number
  
  /** Average score across all agents */
  meanScore: number
  
  /** [minimum, maximum] score range in final round */
  scoreRange: [number, number]
}

/**
 * Result output from a task execution before consensus evaluation
 * @description The raw output that agents will evaluate for approval
 */
export interface TaskResult {
  /** Unique identifier for the task */
  taskId: string
  
  /** ID of the agent that produced this result */
  agentId: string
  
  /** The main output/result from the task */
  output: string
  
  /** Optional file paths or artifacts created during task execution */
  artifacts?: string[]
  
  /** Additional metadata about the task execution */
  metadata: Record<string, any>
}

/**
 * Data from a single round of negotiation between agents
 * @description Captures the state of consensus at a specific point in time
 */
export interface NegotiationRound {
  /** Round number (1-based) */
  round: number
  
  /** All agent evaluations from this round */
  evaluations: AgentEvaluation[]
  
  /** Statistical variance in scores for this round */
  variance: number
  
  /** Whether agents converged within threshold this round */
  converged: boolean
  
  /** When this round was completed */
  timestamp: Date
}

/**
 * Complete session tracking for an entire consensus process
 * @description Top-level container for all consensus data and state
 */
export interface ConsensusSession {
  /** Unique identifier for this consensus session */
  id: string
  
  /** ID of the task being evaluated */
  taskId: string
  
  /** Configuration used for this consensus */
  config: ConsensusConfig
  
  /** All negotiation rounds completed */
  rounds: NegotiationRound[]
  
  /** Final decision if consensus completed successfully */
  finalDecision?: ConsensusDecision
  
  /** Current status of the consensus process */
  status: ConsensusStatus
  
  /** When the consensus session began */
  startedAt: Date
  
  /** When the consensus session finished (if completed) */
  completedAt?: Date
  
  /** Total cost in USD for all LLM calls during consensus */
  costUSD: number
}

/**
 * Possible states of a consensus session
 */
export type ConsensusStatus = 
  | 'in-progress'  // Currently running, agents still negotiating
  | 'converged'    // Successfully reached consensus within threshold
  | 'max-rounds'   // Hit maximum rounds without convergence
  | 'failed'       // Error occurred during consensus
  | 'cancelled'    // Manually cancelled by user

/**
 * Template prompts used during different phases of consensus
 * @description Defines the prompt templates that guide agent behavior
 */
export interface ConsensusPrompts {
  /** Initial prompt given to agents for first evaluation */
  initial: string
  
  /** Prompt used during negotiation rounds (includes previous evaluations) */
  negotiation: string
  
  /** Final prompt for producing the consensus decision */
  final: string
}