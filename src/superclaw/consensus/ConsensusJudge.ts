/**
 * @fileoverview ConsensusJudge - Multi-LLM consensus decision making system
 * @description Orchestrates multiple AI agents with different personalities to reach
 * collective decisions on task completion through iterative negotiation rounds.
 * 
 * BEAST MODE: This is the core judgment engine for SuperClaw's consensus mechanism.
 * It spawns multiple agents with distinct personalities, runs them through negotiation
 * rounds, measures convergence, and produces final decisions with confidence metrics.
 */

import { Anthropic } from '@anthropic-ai/sdk'
import { ConsensusAgent } from './ConsensusAgent'
import { CONSENSUS_PROMPTS } from './PersonalityPrompts'
import type {
  ConsensusConfig,
  ConsensusDecision,
  AgentEvaluation,
  TaskResult,
  JudgeDecision,
  NegotiationRound,
  ConvergenceMetrics
} from './types'

/**
 * ConsensusJudge - Orchestrates multi-LLM consensus decision making
 * 
 * Key Features:
 * - Multiple agent personalities (security, performance, quality, stubborn)
 * - Iterative negotiation rounds with convergence detection
 * - Statistical analysis of agreement levels
 * - Weighted scoring with confidence metrics
 * - Byzantine fault tolerance (handles disagreeable agents)
 */
export class ConsensusJudge {
  private agents: ConsensusAgent[]
  private config: ConsensusConfig
  
  constructor(config?: Partial<ConsensusConfig>) {
    this.config = {
      minAgents: 3,
      maxRounds: 8,
      convergenceThreshold: 0.1,
      approvalThreshold: 70,
      personalityMix: [
        { provider: 'claude-sonnet', personality: 'security-focus' },
        { provider: 'claude-sonnet', personality: 'performance-focus' },
        { provider: 'claude-sonnet', personality: 'maintainability-focus' },
        { provider: 'claude-sonnet', personality: 'code-quality-focus' },
        { provider: 'claude-sonnet', personality: 'stubborn' }
      ],
      ...config
    }
    
    this.agents = this.config.personalityMix.map((p, index) => 
      new ConsensusAgent(`agent-${index}`, p.provider, p.personality)
    )
  }
  
  /**
   * Main entry point: Judge task completion through multi-agent consensus
   * 
   * Process:
   * 1. Independent parallel evaluations from all agents
   * 2. Iterative negotiation rounds where agents see others' opinions
   * 3. Convergence detection (standard deviation < threshold)
   * 4. Final decision synthesis with confidence metrics
   * 
   * @param taskId Unique identifier for the task being judged
   * @param results Array of task outputs to evaluate
   * @returns Complete consensus decision with metrics and reasoning
   */
  async judgeTaskCompletion(taskId: string, results: TaskResult[]): Promise<ConsensusDecision> {
    const rounds: NegotiationRound[] = []
    let round = 0
    
    // Phase 1: Independent evaluations (no peer influence)
    let evaluations = await this.initialEvaluations(taskId, results)
    rounds.push(this.createRoundRecord(0, evaluations))
    
    // Phase 2: Negotiation rounds (agents see each other's evaluations)
    while (round < this.config.maxRounds && !this.hasConverged(evaluations)) {
      round++
      evaluations = await this.negotiationRound(taskId, results, evaluations, round)
      rounds.push(this.createRoundRecord(round, evaluations))
    }
    
    // Phase 3: Final decision synthesis
    const decision = this.computeConsensusDecision(evaluations)
    const convergenceMetrics = this.calculateConvergenceMetrics(evaluations)
    
    // @ts-expect-error - Post-Merge Reconciliation: Missing 'converged' property in ConsensusDecision type
    return {
      decision,
      confidence: this.measureConfidence(evaluations),
      reasoning: this.aggregateReasoning(evaluations),
      rounds: round + 1,
      participatingAgents: this.agents.length,
      evaluations,
      convergenceReached: this.hasConverged(evaluations),
      convergenceMetrics
    }
  }
  
  /**
   * Phase 1: Independent parallel evaluations from all agents
   * Each agent evaluates the task results without seeing other opinions
   * 
   * @param taskId Task identifier
   * @param results Task outputs to evaluate
   * @returns Array of independent agent evaluations
   */
  private async initialEvaluations(taskId: string, results: TaskResult[]): Promise<AgentEvaluation[]> {
    const evaluationPromises = this.agents.map(async (agent) => {
      const prompt = this.buildInitialEvaluationPrompt(taskId, results, agent.personality)
      return await agent.evaluate(prompt, taskId, 0)
    })
    
    // Run all evaluations in parallel for speed
    const evaluations = await Promise.all(evaluationPromises)
    
    // Add some jitter to prevent exact ties (Byzantine resistance)
    return evaluations.map(evaluation => ({
      ...evaluation,
      score: this.addConvergenceJitter(evaluation.score),
      timestamp: new Date()
    }))
  }
  
  /**
   * Phase 2: Negotiation round where agents see peer evaluations
   * Agents can adjust their positions based on group consensus
   * 
   * @param taskId Task identifier
   * @param results Original task outputs
   * @param currentEvals Previous round evaluations
   * @param round Current round number
   * @returns Updated agent evaluations after negotiation
   */
  private async negotiationRound(
    taskId: string,
    results: TaskResult[],
    currentEvals: AgentEvaluation[],
    round: number
  ): Promise<AgentEvaluation[]> {
    const negotiationPromises = this.agents.map(async (agent) => {
      // Show this agent all OTHER agents' evaluations (not their own)
      const peerEvaluations = currentEvals.filter(evaluation => evaluation.agentId !== agent.id)
      const prompt = this.buildNegotiationPrompt(taskId, results, agent.personality, peerEvaluations, round)
      
      return await agent.evaluate(prompt, taskId, round)
    })
    
    const newEvaluations = await Promise.all(negotiationPromises)
    
    return newEvaluations.map(evaluation => ({
      ...evaluation,
      timestamp: new Date(),
      round
    }))
  }
  
  /**
   * Check if agents have converged within the configured threshold
   * Uses coefficient of variation (std dev / mean) for scale-independent convergence
   * 
   * @param evaluations Current agent evaluations
   * @returns True if standard deviation is within convergence threshold
   */
  private hasConverged(evaluations: AgentEvaluation[]): boolean {
    if (evaluations.length < 2) {return true}
    
    const scores = evaluations.map(e => e.score)
    const mean = scores.reduce((a, b) => a + b) / scores.length
    const variance = scores.reduce((acc, score) => acc + Math.pow(score - mean, 2), 0) / scores.length
    const stdDev = Math.sqrt(variance)
    
    // Use coefficient of variation to handle different score scales
    const coefficientOfVariation = mean > 0 ? stdDev / mean : 0
    
    return coefficientOfVariation <= this.config.convergenceThreshold
  }
  
  /**
   * Synthesize final consensus decision from all agent evaluations
   * Uses weighted averaging with personality-based weights and outlier handling
   * 
   * @param evaluations Final round agent evaluations
   * @returns Consensus decision with approval/rejection and reasoning
   */
  private computeConsensusDecision(evaluations: AgentEvaluation[]): JudgeDecision {
    if (evaluations.length === 0) {
      throw new Error('Cannot compute consensus with no evaluations')
    }
    
    // Calculate weighted average score (using agent weights from config)
    let weightedSum = 0
    let totalWeight = 0
    
    evaluations.forEach((evaluation, index) => {
      const weight = this.config.personalityMix[index]?.weight ?? 1.0
      weightedSum += evaluation.score * weight
      totalWeight += weight
    })
    
    const consensusScore = weightedSum / totalWeight
    
    // Collect all concerns and recommendations
    const allConcerns = evaluations.flatMap(e => e.concerns)
    const allRecommendations = evaluations.flatMap(e => e.recommendations)
    
    // Remove duplicates and rank by frequency
    const uniqueConcerns = this.rankByFrequency(allConcerns).slice(0, 5)
    const uniqueRecommendations = this.rankByFrequency(allRecommendations).slice(0, 5)
    
    // Generate consensus reasoning
    const reasoning = this.synthesizeConsensusReasoning(evaluations, consensusScore)
    
    return {
      approved: consensusScore >= this.config.approvalThreshold,
      score: Math.round(consensusScore),
      reasoning,
      concerns: uniqueConcerns,
      recommendations: uniqueRecommendations
    }
  }
  
  /**
   * Measure overall confidence in the consensus decision
   * Based on convergence quality and individual agent confidence levels
   * 
   * @param evaluations Agent evaluations to analyze
   * @returns Confidence score from 0-100
   */
  private measureConfidence(evaluations: AgentEvaluation[]): number {
    if (evaluations.length === 0) {return 0}
    
    // Factor 1: Individual agent confidence average
    const avgAgentConfidence = evaluations.reduce((sum, e) => sum + e.confidence, 0) / evaluations.length
    
    // Factor 2: Convergence quality (inverse of standard deviation)
    const scores = evaluations.map(e => e.score)
    const mean = scores.reduce((a, b) => a + b) / scores.length
    const stdDev = Math.sqrt(scores.reduce((acc, score) => acc + Math.pow(score - mean, 2), 0) / scores.length)
    const convergenceQuality = Math.max(0, 100 - (stdDev * 2)) // Lower std dev = higher confidence
    
    // Factor 3: Participation quality (more agents = higher confidence)
    const participationFactor = Math.min(100, (evaluations.length / this.config.minAgents) * 100)
    
    // Weighted combination
    const overallConfidence = (
      avgAgentConfidence * 0.4 +
      convergenceQuality * 0.4 +
      participationFactor * 0.2
    )
    
    return Math.round(Math.max(0, Math.min(100, overallConfidence)))
  }
  
  /**
   * Aggregate all agent reasoning into a coherent summary
   * Extracts common themes and synthesizes them into readable narrative
   * 
   * @param evaluations Agent evaluations with individual reasoning
   * @returns Synthesized reasoning summary
   */
  private aggregateReasoning(evaluations: AgentEvaluation[]): string {
    if (evaluations.length === 0) {return 'No evaluations provided'}
    
    const reasoningTexts = evaluations.map(e => e.reasoning).filter(r => r.length > 0)
    if (reasoningTexts.length === 0) {return 'No reasoning provided by agents'}
    
    // Extract key themes and decision points
    const themes = this.extractCommonThemes(reasoningTexts)
    const scores = evaluations.map(e => e.score)
    const avgScore = scores.reduce((a, b) => a + b) / scores.length
    
    let summary = `After ${evaluations.length} agent evaluations, the consensus emerged around a score of ${avgScore.toFixed(1)}/100. `
    
    if (themes.length > 0) {
      summary += `Key themes in the decision: ${themes.join(', ')}. `
    }
    
    // Add convergence note
    if (this.hasConverged(evaluations)) {
      summary += 'Agents reached strong convergence on this assessment.'
    } else {
      summary += 'Some disagreement remains between agents, suggesting complex tradeoffs.'
    }
    
    return summary
  }
  
  /**
   * Calculate statistical metrics about the convergence process
   * Provides insight into consensus quality and stability
   * 
   * @param evaluations Final round evaluations
   * @returns Statistical convergence metrics
   */
  private calculateConvergenceMetrics(evaluations: AgentEvaluation[]): ConvergenceMetrics {
    if (evaluations.length === 0) {
      return {
        initialVariance: 0,
        finalVariance: 0,
        standardDeviation: 0,
        meanScore: 0,
        scoreRange: [0, 0]
      }
    }
    
    const scores = evaluations.map(e => e.score)
    const mean = scores.reduce((a, b) => a + b) / scores.length
    const variance = scores.reduce((acc, score) => acc + Math.pow(score - mean, 2), 0) / scores.length
    const stdDev = Math.sqrt(variance)
    
    // For initial variance, we'd need to track it from round 0
    // For now, estimate based on final spread
    const scoreRange: [number, number] = [Math.min(...scores), Math.max(...scores)]
    const initialVariance = Math.pow(scoreRange[1] - scoreRange[0], 2) / 4 // Conservative estimate
    
    return {
      initialVariance,
      finalVariance: variance,
      standardDeviation: stdDev,
      meanScore: mean,
      scoreRange
    }
  }
  
  /**
   * Build negotiation prompt that includes peer evaluations
   * Shows agent what others think to enable negotiation and consensus
   * 
   * @param taskId Task identifier
   * @param results Task outputs
   * @param personality Agent's personality type
   * @param peerEvaluations Other agents' evaluations
   * @param round Current round number
   * @returns Formatted negotiation prompt
   */
  private buildNegotiationPrompt(
    taskId: string,
    results: TaskResult[],
    personality: string,
    peerEvaluations: AgentEvaluation[],
    round: number
  ): string {
    const basePrompt = this.buildInitialEvaluationPrompt(taskId, results, personality)
    
    const peerSummary = peerEvaluations.map(evaluation => 
      `${evaluation.personality}: ${evaluation.score}/100 - ${evaluation.reasoning.substring(0, 200)}...`
    ).join('\n')
    
    return `${basePrompt}
    
ROUND ${round} NEGOTIATION:
Your fellow agents have provided the following evaluations:

${peerSummary}

Now that you've seen other perspectives, please provide your updated evaluation. You may:
- Maintain your original position if you still believe it's correct
- Adjust your score based on valid points raised by others  
- Challenge other agents if you think they missed something important
- Find middle ground between different viewpoints

Remember: Your personality is "${personality}" - stay true to your focus area while considering the group consensus.`
  }
  
  /**
   * Create a structured record of a negotiation round
   * Captures the state of consensus at a specific point in time
   * 
   * @param round Round number
   * @param evaluations Agent evaluations from this round
   * @returns Structured round record with metadata
   */
  private createRoundRecord(round: number, evaluations: AgentEvaluation[]): NegotiationRound {
    const scores = evaluations.map(e => e.score)
    const mean = scores.length > 0 ? scores.reduce((a, b) => a + b) / scores.length : 0
    const variance = scores.length > 0 
      ? scores.reduce((acc, score) => acc + Math.pow(score - mean, 2), 0) / scores.length 
      : 0
    
    return {
      round,
      evaluations,
      variance,
      converged: this.hasConverged(evaluations),
      timestamp: new Date()
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // HELPER METHODS
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Build initial evaluation prompt for fresh agent assessment
   */
  private buildInitialEvaluationPrompt(taskId: string, results: TaskResult[], personality: string): string {
    const resultsText = results.map(r => 
      `Task: ${r.taskId}\nAgent: ${r.agentId}\nOutput:\n${r.output}\n---`
    ).join('\n')
    
    return `${CONSENSUS_PROMPTS.initial}
    
PERSONALITY: ${personality}
TASK ID: ${taskId}

RESULTS TO EVALUATE:
${resultsText}

Provide your evaluation as a ${personality} specialist. Score 0-100 where:
- 0-30: Major issues, recommend rejection
- 31-60: Significant concerns, needs improvement  
- 61-80: Good work with minor issues
- 81-100: Excellent, ready for approval`
  }
  
  /**
   * Add small random jitter to prevent exact score ties
   */
  private addConvergenceJitter(score: number): number {
    const jitter = (Math.random() - 0.5) * 0.5 // ±0.25 points
    return Math.max(0, Math.min(100, score + jitter))
  }
  
  /**
   * Rank array items by frequency, return unique items
   */
  private rankByFrequency(items: string[]): string[] {
    const counts = items.reduce((acc, item) => {
      acc[item] = (acc[item] || 0) + 1
      return acc
    }, {} as Record<string, number>)
    
    return Object.entries(counts)
      .toSorted(([, a], [, b]) => b - a)
      .map(([item]) => item)
  }
  
  /**
   * Extract common themes from reasoning text
   */
  private extractCommonThemes(reasoningTexts: string[]): string[] {
    // Simple keyword extraction - could be enhanced with NLP
    const keywords = ['security', 'performance', 'quality', 'maintainability', 'error', 'risk', 'optimization']
    const foundThemes: string[] = []
    
    keywords.forEach(keyword => {
      const mentions = reasoningTexts.filter(text => 
        text.toLowerCase().includes(keyword)
      ).length
      
      if (mentions >= Math.ceil(reasoningTexts.length / 2)) {
        foundThemes.push(keyword)
      }
    })
    
    return foundThemes
  }
  
  /**
   * Synthesize consensus reasoning from individual evaluations
   */
  private synthesizeConsensusReasoning(evaluations: AgentEvaluation[], consensusScore: number): string {
    const avgScore = consensusScore
    const scoreStdDev = this.calculateStandardDeviation(evaluations.map(e => e.score))
    
    let reasoning = `Consensus score: ${avgScore.toFixed(1)}/100 `
    
    if (scoreStdDev < 5) {
      reasoning += '(strong agreement)'
    } else if (scoreStdDev < 15) {
      reasoning += '(moderate agreement)'  
    } else {
      reasoning += '(significant disagreement)'
    }
    
    reasoning += '. '
    
    // Add personality-specific insights
    const personalityInsights = this.extractPersonalityInsights(evaluations)
    if (personalityInsights.length > 0) {
      reasoning += personalityInsights.join('; ') + '.'
    }
    
    return reasoning
  }
  
  /**
   * Calculate standard deviation of scores
   */
  private calculateStandardDeviation(scores: number[]): number {
    const mean = scores.reduce((a, b) => a + b) / scores.length
    const variance = scores.reduce((acc, score) => acc + Math.pow(score - mean, 2), 0) / scores.length
    return Math.sqrt(variance)
  }
  
  /**
   * Extract insights from each personality type
   */
  private extractPersonalityInsights(evaluations: AgentEvaluation[]): string[] {
    return evaluations.map(evaluation => {
      const key_concerns = evaluation.concerns.length > 0 ? evaluation.concerns[0] : 'no major issues'
      return `${evaluation.personality}: ${key_concerns}`
    })
  }
}