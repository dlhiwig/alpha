// @ts-nocheck
import type { 
  AgentEvaluation, 
  NegotiationRound, 
  ConvergenceMetrics 
} from './types'

/**
 * NegotiationEngine handles the iterative consensus process
 * where agents exchange evaluations and converge on a decision
 */
export class NegotiationEngine {
  private convergenceThreshold: number
  private maxRounds: number
  
  constructor(config: { convergenceThreshold?: number; maxRounds?: number } = {}) {
    this.convergenceThreshold = config.convergenceThreshold || 0.1
    this.maxRounds = config.maxRounds || 8
  }
  
  /**
   * Check if evaluations have converged
   * Convergence = standard deviation < threshold * mean
   */
  hasConverged(evaluations: AgentEvaluation[]): boolean {
    if (evaluations.length < 2) {return true}
    
    const scores = evaluations.map(e => e.score)
    const mean = this.calculateMean(scores)
    const stdDev = this.calculateStdDev(scores, mean)
    
    return stdDev < mean * this.convergenceThreshold
  }
  
  /**
   * Calculate convergence metrics for a set of evaluations
   */
  calculateConvergenceMetrics(evaluations: AgentEvaluation[]): ConvergenceMetrics {
    const scores = evaluations.map(e => e.score)
    const mean = this.calculateMean(scores)
    const stdDev = this.calculateStdDev(scores, mean)
    const initialScores = evaluations
      .filter(e => e.round === 0)
      .map(e => e.score)
    
    return {
      initialVariance: this.calculateVariance(initialScores),
      finalVariance: this.calculateVariance(scores),
      standardDeviation: stdDev,
      meanScore: mean,
      scoreRange: [Math.min(...scores), Math.max(...scores)]
    }
  }
  
  /**
   * Create a round record for tracking
   */
  createRoundRecord(round: number, evaluations: AgentEvaluation[]): NegotiationRound {
    return {
      round,
      evaluations,
      variance: this.calculateVariance(evaluations.map(e => e.score)),
      converged: this.hasConverged(evaluations),
      timestamp: new Date()
    }
  }
  
  /**
   * Calculate weighted consensus score
   * Weights based on agent confidence
   */
  calculateWeightedConsensus(evaluations: AgentEvaluation[]): number {
    const totalWeight = evaluations.reduce((sum, e) => sum + (e.confidence / 100), 0)
    const weightedSum = evaluations.reduce(
      (sum, e) => sum + (e.score * (e.confidence / 100)),
      0
    )
    return weightedSum / totalWeight
  }
  
  /**
   * Identify outlier evaluations
   * Outliers are more than 2 standard deviations from mean
   */
  identifyOutliers(evaluations: AgentEvaluation[]): AgentEvaluation[] {
    const scores = evaluations.map(e => e.score)
    const mean = this.calculateMean(scores)
    const stdDev = this.calculateStdDev(scores, mean)
    const threshold = 2 * stdDev
    
    return evaluations.filter(e => 
      Math.abs(e.score - mean) > threshold
    )
  }
  
  /**
   * Aggregate concerns from all evaluations
   * Deduplicate and prioritize
   */
  aggregateConcerns(evaluations: AgentEvaluation[]): string[] {
    const allConcerns = evaluations.flatMap(e => e.concerns)
    const concernCounts = new Map<string, number>()
    
    for (const concern of allConcerns) {
      const normalized = concern.toLowerCase().trim()
      concernCounts.set(normalized, (concernCounts.get(normalized) || 0) + 1)
    }
    
    // Sort by frequency
    return Array.from(concernCounts.entries())
      .toSorted((a, b) => b[1] - a[1])
      .map(([concern]) => concern)
  }
  
  /**
   * Aggregate recommendations
   */
  aggregateRecommendations(evaluations: AgentEvaluation[]): string[] {
    const allRecs = evaluations.flatMap(e => e.recommendations)
    const recCounts = new Map<string, number>()
    
    for (const rec of allRecs) {
      const normalized = rec.toLowerCase().trim()
      recCounts.set(normalized, (recCounts.get(normalized) || 0) + 1)
    }
    
    return Array.from(recCounts.entries())
      .toSorted((a, b) => b[1] - a[1])
      .map(([rec]) => rec)
  }
  
  /**
   * Synthesize reasoning from all agents
   */
  synthesizeReasoning(evaluations: AgentEvaluation[]): string {
    const reasonings = evaluations.map(e => 
      `[${e.personality}]: ${e.reasoning}`
    )
    
    // Group by agreement level
    const scores = evaluations.map(e => e.score)
    const mean = this.calculateMean(scores)
    
    const agreeing = evaluations.filter(e => Math.abs(e.score - mean) < 10)
    const dissenting = evaluations.filter(e => Math.abs(e.score - mean) >= 10)
    
    let synthesis = ''
    
    if (agreeing.length > 0) {
      synthesis += `**Consensus View (${agreeing.length} agents):**\n`
      synthesis += agreeing.map(e => `- ${e.personality}: ${e.reasoning.slice(0, 100)}...`).join('\n')
    }
    
    if (dissenting.length > 0) {
      synthesis += `\n\n**Dissenting Views (${dissenting.length} agents):**\n`
      synthesis += dissenting.map(e => `- ${e.personality}: ${e.reasoning.slice(0, 100)}...`).join('\n')
    }
    
    return synthesis
  }
  
  // Math helpers
  private calculateMean(values: number[]): number {
    if (values.length === 0) {return 0}
    return values.reduce((sum, v) => sum + v, 0) / values.length
  }
  
  private calculateVariance(values: number[]): number {
    if (values.length < 2) {return 0}
    const mean = this.calculateMean(values)
    return values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length
  }
  
  private calculateStdDev(values: number[], mean?: number): number {
    if (values.length < 2) {return 0}
    const m = mean ?? this.calculateMean(values)
    return Math.sqrt(this.calculateVariance(values))
  }
}