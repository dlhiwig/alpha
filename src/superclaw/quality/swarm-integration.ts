/**
 * SuperClaw Quality Gates - Swarm Integration
 * 
 * Integrates quality gates with SuperClaw's swarm orchestration system.
 * Provides agent validation, swarm result quality assessment, and automatic
 * quality issue creation within the swarm workflow.
 */

import { SwarmResult, SwarmRoundResult, AgentResult, SynthesisResult } from '../swarm/types';
import { JudgeResult } from '../swarm/judge';
import { QualityGateRunner, QualityGateResult, QualityGateType, RecoveryStrategy, createQualityGateRunner, QualityGatePipeline } from './gates';

export interface SwarmQualityConfig {
  // Quality gate settings
  workingDir: string;
  enabledGates: QualityGateType[];
  
  // Swarm-specific quality thresholds
  minSuccessfulAgents?: number;
  maxFailureRate?: number;       // Max % of failed agents (0-1)
  minConfidenceScore?: number;   // Min synthesis confidence (0-1)
  
  // AI assessment
  aiReviewProvider?: string;
  
  // Integration with judge system
  integrateWithJudge?: boolean;
  failFastOnQuality?: boolean;   // Stop swarm early if quality gates fail
}

export interface SwarmQualityResult {
  passed: boolean;
  gateResults: QualityGateResult[];
  agentQuality: AgentQualityMetrics[];
  swarmMetrics: SwarmQualityMetrics;
  issues: SwarmQualityIssue[];
  recoveryStrategy?: RecoveryStrategy;
}

export interface AgentQualityMetrics {
  provider: string;
  role: string;
  passed: boolean;
  confidence: number;
  outputQuality: number;        // 0-1 quality score
  consistency: number;          // How consistent with other agents
  issues: string[];
}

export interface SwarmQualityMetrics {
  totalAgents: number;
  successfulAgents: number;
  failureRate: number;
  averageConfidence: number;
  consensusStrength: number;    // How well agents agreed
  diversityScore: number;       // How diverse the approaches were
  synthesisQuality: number;     // Quality of final synthesis
}

export interface SwarmQualityIssue {
  id: string;
  type: 'agent_failure' | 'consensus_weak' | 'synthesis_poor' | 'gate_failure' | 'swarm_incomplete';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  agents?: string[];           // Agents involved in the issue
  suggestion: string;
  autoFixable: boolean;
}

/**
 * Swarm Quality Assessor - evaluates swarm execution quality
 */
export class SwarmQualityAssessor {
  private config: SwarmQualityConfig;
  private qualityRunner: QualityGateRunner;
  private pipeline: QualityGatePipeline;
  
  constructor(config: SwarmQualityConfig) {
    this.config = config;
    this.qualityRunner = createQualityGateRunner({
      workingDir: config.workingDir,
      aiReviewProvider: config.aiReviewProvider as any
    });
    this.pipeline = new QualityGatePipeline(this.qualityRunner, {
      workingDir: config.workingDir
    });
  }
  
  /**
   * Assess the quality of a completed swarm execution
   */
  async assessSwarmQuality(swarmResult: SwarmResult, context?: any): Promise<SwarmQualityResult> {
    console.log(`[swarm-quality] Assessing quality of ${swarmResult.mode} swarm execution`);
    
    // Step 1: Run traditional quality gates if synthesis produced code
    let gateResults: QualityGateResult[] = [];
    if (this.shouldRunQualityGates(swarmResult)) {
      console.log(`[swarm-quality] Running ${this.config.enabledGates.length} quality gates`);
      const { results } = await this.qualityRunner.runAll(this.config.enabledGates);
      gateResults = results;
    }
    
    // Step 2: Assess individual agent quality
    const agentQuality = await this.assessAgentQuality(swarmResult);
    
    // Step 3: Calculate swarm-level metrics
    const swarmMetrics = this.calculateSwarmMetrics(swarmResult, agentQuality);
    
    // Step 4: Identify quality issues
    const issues = this.identifyQualityIssues(swarmResult, gateResults, agentQuality, swarmMetrics);
    
    // Step 5: Determine overall pass/fail
    const passed = this.determineOverallQuality(gateResults, swarmMetrics, issues);
    
    // Step 6: Generate recovery strategy if needed
    let recoveryStrategy: RecoveryStrategy | undefined;
    if (!passed) {
      console.log(`[swarm-quality] Quality assessment failed, generating recovery strategy`);
      recoveryStrategy = await this.generateSwarmRecoveryStrategy(swarmResult, gateResults, issues, context);
    }
    
    const result: SwarmQualityResult = {
      passed,
      gateResults,
      agentQuality,
      swarmMetrics,
      issues,
      recoveryStrategy
    };
    
    console.log(`[swarm-quality] Assessment complete: ${passed ? 'PASSED' : 'FAILED'} (${issues.length} issues)`);
    return result;
  }
  
  /**
   * Assess quality during swarm execution (fail-fast mode)
   */
  async assessRoundQuality(roundResult: SwarmRoundResult): Promise<{ shouldContinue: boolean; issues: SwarmQualityIssue[] }> {
    if (!this.config.failFastOnQuality) {
      return { shouldContinue: true, issues: [] };
    }
    
    const issues: SwarmQualityIssue[] = [];
    
    // Check failure rate
    const failureRate = roundResult.failed.length / roundResult.results.length;
    if (failureRate > (this.config.maxFailureRate || 0.5)) {
      issues.push({
        id: `swarm-high-failure-rate-${Date.now()}`,
        type: 'swarm_incomplete',
        severity: 'high',
        description: `High agent failure rate: ${Math.round(failureRate * 100)}% (${roundResult.failed.length}/${roundResult.results.length})`,
        agents: roundResult.failed.map(f => f.provider),
        suggestion: 'Reduce task complexity or check agent configurations',
        autoFixable: false
      });
    }
    
    // Check minimum successful agents
    if (roundResult.successful.length < (this.config.minSuccessfulAgents || 1)) {
      issues.push({
        id: `swarm-insufficient-agents-${Date.now()}`,
        type: 'swarm_incomplete',
        severity: 'critical',
        description: `Insufficient successful agents: ${roundResult.successful.length} (minimum: ${this.config.minSuccessfulAgents || 1})`,
        suggestion: 'Increase timeout, reduce complexity, or check agent health',
        autoFixable: false
      });
    }
    
    const shouldContinue = issues.filter(i => i.severity === 'critical').length === 0;
    
    if (!shouldContinue) {
      console.log(`[swarm-quality] Round quality check failed, stopping swarm early`);
    }
    
    return { shouldContinue, issues };
  }
  
  /**
   * Determine if quality gates should run based on swarm output
   */
  private shouldRunQualityGates(swarmResult: SwarmResult): boolean {
    // Run gates if synthesis contains code-like content
    const synthesis = swarmResult.synthesis;
    if (!synthesis) return false;
    
    // Simple heuristics to detect code content
    const hasCode = synthesis.patch ||
                   synthesis.solution.includes('```') ||
                   synthesis.solution.includes('function') ||
                   synthesis.solution.includes('class') ||
                   synthesis.solution.includes('import') ||
                   synthesis.solution.includes('export');
    
    // @ts-expect-error - Post-Merge Reconciliation
    return hasCode;
  }
  
  /**
   * Assess the quality of individual agent contributions
   */
  private async assessAgentQuality(swarmResult: SwarmResult): Promise<AgentQualityMetrics[]> {
    const agentMetrics: AgentQualityMetrics[] = [];
    
    for (const round of swarmResult.rounds) {
      for (const result of round.results) {
        const quality = this.calculateAgentOutputQuality(result);
        const consistency = this.calculateAgentConsistency(result, round.results);
        
        agentMetrics.push({
          provider: result.provider,
          role: result.role,
          passed: result.exitCode === 0,
          confidence: this.calculateAgentConfidence(result),
          outputQuality: quality,
          consistency,
          issues: this.identifyAgentIssues(result)
        });
      }
    }
    
    return agentMetrics;
  }
  
  /**
   * Calculate quality score for an agent's output
   */
  private calculateAgentOutputQuality(result: AgentResult): number {
    if (result.exitCode !== 0) return 0;
    if (!result.output) return 0.1;
    
    // Basic heuristics for output quality
    let score = 0.5; // Base score for successful execution
    
    // Length indicates effort (but cap to avoid rewarding verbosity)
    const lengthScore = Math.min(result.output.length / 1000, 0.3);
    score += lengthScore;
    
    // Structure indicators
    if (result.output.includes('```')) score += 0.1;          // Code blocks
    if (result.output.includes('# ') || result.output.includes('## ')) score += 0.05; // Headers
    if (result.output.includes('- ') || result.output.includes('* ')) score += 0.05;  // Lists
    
    // Avoid common low-quality patterns
    if (result.output.toLowerCase().includes('sorry') || 
        result.output.toLowerCase().includes("i can't") ||
        result.output.toLowerCase().includes("i don't know")) {
      score *= 0.7;
    }
    
    // Duration indicates appropriate thinking time
    if (result.durationMs > 5000 && result.durationMs < 60000) {
      score += 0.1; // Good thinking time
    }
    
    return Math.min(score, 1.0);
  }
  
  /**
   * Calculate how consistent an agent's output is with other agents
   */
  private calculateAgentConsistency(result: AgentResult, allResults: AgentResult[]): number {
    const otherResults = allResults.filter(r => r.provider !== result.provider && r.exitCode === 0);
    if (otherResults.length === 0) return 0.5; // No comparison possible
    
    // Simple keyword overlap consistency check
    const keywords = this.extractKeywords(result.output);
    let totalOverlap = 0;
    
    for (const other of otherResults) {
      const otherKeywords = this.extractKeywords(other.output);
      const overlap = this.calculateKeywordOverlap(keywords, otherKeywords);
      totalOverlap += overlap;
    }
    
    return totalOverlap / otherResults.length;
  }
  
  private extractKeywords(text: string): Set<string> {
    // Extract significant words (simplified)
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3 && !this.isStopWord(word));
    
    return new Set(words);
  }
  
  private isStopWord(word: string): boolean {
    const stopWords = new Set(['the', 'and', 'that', 'this', 'with', 'from', 'they', 'have', 'will', 'been', 'their']);
    return stopWords.has(word);
  }
  
  private calculateKeywordOverlap(set1: Set<string>, set2: Set<string>): number {
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    return union.size > 0 ? intersection.size / union.size : 0;
  }
  
  private calculateAgentConfidence(result: AgentResult): number {
    if (result.exitCode !== 0) return 0;
    
    // Base confidence from successful execution
    let confidence = 0.6;
    
    // Adjust based on output characteristics
    const output = result.output.toLowerCase();
    
    // Confidence indicators
    if (output.includes('definitely') || output.includes('certainly')) confidence += 0.1;
    if (output.includes('likely') || output.includes('probably')) confidence += 0.05;
    
    // Uncertainty indicators
    if (output.includes('might') || output.includes('maybe')) confidence -= 0.1;
    if (output.includes('unsure') || output.includes('unclear')) confidence -= 0.15;
    if (output.includes('not sure') || output.includes("don't know")) confidence -= 0.2;
    
    // Retry/timeout impacts confidence
    if (result.retryCount && result.retryCount > 0) {
      confidence -= result.retryCount * 0.05;
    }
    
    if (result.timedOut) {
      confidence -= 0.2;
    }
    
    return Math.max(0, Math.min(1, confidence));
  }
  
  private identifyAgentIssues(result: AgentResult): string[] {
    const issues: string[] = [];
    
    if (result.exitCode !== 0) {
      issues.push(`Agent failed with exit code ${result.exitCode}`);
    }
    
    if (result.timedOut) {
      issues.push('Agent timed out');
    }
    
    if (result.retryCount && result.retryCount > 0) {
      issues.push(`Required ${result.retryCount} retries`);
    }
    
    if (result.fallbackCount && result.fallbackCount > 0) {
      issues.push(`Used ${result.fallbackCount} fallback providers`);
    }
    
    if (!result.output || result.output.trim().length < 10) {
      issues.push('Output too short or empty');
    }
    
    const output = result.output?.toLowerCase() || '';
    if (output.includes('error') || output.includes('failed') || output.includes('exception')) {
      issues.push('Output contains error indicators');
    }
    
    return issues;
  }
  
  /**
   * Calculate swarm-level quality metrics
   */
  private calculateSwarmMetrics(swarmResult: SwarmResult, agentQuality: AgentQualityMetrics[]): SwarmQualityMetrics {
    const totalAgents = agentQuality.length;
    const successfulAgents = agentQuality.filter(a => a.passed).length;
    const failureRate = totalAgents > 0 ? (totalAgents - successfulAgents) / totalAgents : 0;
    
    const avgConfidence = agentQuality.length > 0 
      ? agentQuality.reduce((sum, a) => sum + a.confidence, 0) / agentQuality.length 
      : 0;
    
    const avgConsistency = agentQuality.length > 0
      ? agentQuality.reduce((sum, a) => sum + a.consistency, 0) / agentQuality.length
      : 0;
    
    // Diversity: how much agents disagreed (inverse of consistency, but valuable)
    const diversityScore = Math.max(0, 1 - avgConsistency);
    
    // Synthesis quality based on confidence and conflict resolution
    const synthesisQuality = this.calculateSynthesisQuality(swarmResult.synthesis);
    
    return {
      totalAgents,
      successfulAgents,
      failureRate,
      averageConfidence: avgConfidence,
      consensusStrength: avgConsistency,
      diversityScore,
      synthesisQuality
    };
  }
  
  private calculateSynthesisQuality(synthesis: SynthesisResult): number {
    if (!synthesis) return 0;
    
    let quality = synthesis.confidence || 0.5;
    
    // Adjust based on synthesis characteristics
    if (synthesis.patch && synthesis.patch.length > 0) quality += 0.1;
    if (synthesis.tests && synthesis.tests.length > 0) quality += 0.1;
    if (synthesis.fallbackPlan) quality += 0.05;
    
    // Penalize unresolved conflicts
    if (synthesis.conflicts && synthesis.conflicts.length > 0) {
      const unresolvedConflicts = synthesis.conflicts.filter(c => !c.resolution).length;
      quality -= unresolvedConflicts * 0.1;
    }
    
    return Math.max(0, Math.min(1, quality));
  }
  
  /**
   * Identify specific quality issues
   */
  private identifyQualityIssues(
    swarmResult: SwarmResult,
    gateResults: QualityGateResult[],
    agentQuality: AgentQualityMetrics[],
    swarmMetrics: SwarmQualityMetrics
  ): SwarmQualityIssue[] {
    const issues: SwarmQualityIssue[] = [];
    
    // Gate failures
    for (const gate of gateResults.filter(g => !g.passed)) {
      issues.push({
        id: `gate-failure-${gate.gate}-${Date.now()}`,
        type: 'gate_failure',
        severity: this.getGateSeverity(gate.gate),
        description: `Quality gate '${gate.gate}' failed: ${gate.error?.message || 'Unknown error'}`,
        suggestion: `Fix ${gate.gate} issues: ${gate.suggestions?.join(', ') || 'See gate output for details'}`,
        autoFixable: gate.gate === 'lint' || (gate.confidence !== undefined && gate.confidence > 0.8)
      });
    }
    
    // High agent failure rate
    if (swarmMetrics.failureRate > (this.config.maxFailureRate || 0.5)) {
      issues.push({
        id: `high-failure-rate-${Date.now()}`,
        type: 'swarm_incomplete',
        severity: 'high',
        description: `High agent failure rate: ${Math.round(swarmMetrics.failureRate * 100)}%`,
        agents: agentQuality.filter(a => !a.passed).map(a => a.provider),
        suggestion: 'Check agent configurations and reduce task complexity',
        autoFixable: false
      });
    }
    
    // Low confidence
    if (swarmMetrics.averageConfidence < (this.config.minConfidenceScore || 0.6)) {
      issues.push({
        id: `low-confidence-${Date.now()}`,
        type: 'consensus_weak',
        severity: 'medium',
        description: `Low average confidence: ${Math.round(swarmMetrics.averageConfidence * 100)}%`,
        suggestion: 'Add more context, reduce ambiguity, or use more capable models',
        autoFixable: false
      });
    }
    
    // Poor synthesis quality
    if (swarmMetrics.synthesisQuality < 0.5) {
      issues.push({
        id: `poor-synthesis-${Date.now()}`,
        type: 'synthesis_poor',
        severity: 'medium',
        description: `Synthesis quality below threshold: ${Math.round(swarmMetrics.synthesisQuality * 100)}%`,
        suggestion: 'Improve agent output quality or synthesis algorithm',
        autoFixable: false
      });
    }
    
    // Individual agent issues
    for (const agent of agentQuality) {
      if (!agent.passed && agent.issues.length > 0) {
        issues.push({
          id: `agent-failure-${agent.provider}-${Date.now()}`,
          type: 'agent_failure',
          severity: 'low',
          description: `Agent ${agent.provider} (${agent.role}) issues: ${agent.issues.join(', ')}`,
          agents: [agent.provider],
          suggestion: `Check ${agent.provider} configuration and health`,
          autoFixable: agent.issues.some(issue => issue.includes('timeout') || issue.includes('retry'))
        });
      }
    }
    
    return issues;
  }
  
  private getGateSeverity(gate: QualityGateType): 'low' | 'medium' | 'high' | 'critical' {
    switch (gate) {
      case 'security': return 'critical';
      case 'build': case 'test': return 'high';
      case 'coverage': case 'ai_review': return 'medium';
      case 'lint': case 'approval': return 'low';
      default: return 'medium';
    }
  }
  
  /**
   * Determine overall quality pass/fail
   */
  private determineOverallQuality(
    gateResults: QualityGateResult[],
    swarmMetrics: SwarmQualityMetrics,
    issues: SwarmQualityIssue[]
  ): boolean {
    // Fail if any critical issues
    if (issues.some(i => i.severity === 'critical')) {
      return false;
    }
    
    // Fail if quality gates failed (except lint which can be acceptable)
    const criticalGateFailures = gateResults.filter(g => 
      !g.passed && g.gate !== 'lint' && g.gate !== 'ai_review'
    );
    if (criticalGateFailures.length > 0) {
      return false;
    }
    
    // Fail if swarm metrics are below thresholds
    if (swarmMetrics.successfulAgents < (this.config.minSuccessfulAgents || 1)) {
      return false;
    }
    
    if (swarmMetrics.averageConfidence < (this.config.minConfidenceScore || 0.6)) {
      return false;
    }
    
    // Pass if we made it this far
    return true;
  }
  
  /**
   * Generate recovery strategy for swarm quality failures
   */
  private async generateSwarmRecoveryStrategy(
    swarmResult: SwarmResult,
    gateResults: QualityGateResult[],
    issues: SwarmQualityIssue[],
    context?: any
  ): Promise<RecoveryStrategy> {
    // Use the quality gate runner's AI if available
    // @ts-expect-error - Post-Merge Reconciliation
    if (this.qualityRunner instanceof createQualityGateRunner().constructor) {
      return (this.qualityRunner as any).generateRecoveryStrategy(gateResults, {
        ...context,
        swarmResult,
        issues
      });
    }
    
    // Fallback strategy
    const criticalIssues = issues.filter(i => i.severity === 'critical' || i.severity === 'high');
    
    if (criticalIssues.length > 0) {
      return {
        action: 'fix_in_place',
        confidence: 0.7,
        reasoning: `Found ${criticalIssues.length} critical/high severity issues requiring fixes`,
        createIssues: criticalIssues.map(issue => ({
          id: issue.id,
          title: `Swarm quality issue: ${issue.type}`,
          description: issue.description,
          gate: 'ai_review', // Map swarm issues to ai_review gate
          severity: issue.severity,
          autoFixable: issue.autoFixable,
          suggestions: [issue.suggestion],
          blocksOriginal: true
        })),
        markAsBlocked: true
      };
    } else {
      return {
        action: 'acceptable_failure',
        confidence: 0.8,
        reasoning: 'Only minor quality issues found, acceptable for continuation',
        createIssues: []
      };
    }
  }
}

/**
 * Integration with SuperClaw Judge system
 */
export async function integrateQualityWithJudge(
  judgeResult: JudgeResult,
  qualityResult: SwarmQualityResult,
  context?: any
): Promise<JudgeResult> {
  if (!qualityResult.passed) {
    // Quality assessment failed - modify judge result
    const qualityIssuesDescription = qualityResult.issues
      .map(issue => `- ${issue.description}`)
      .join('\n');
    
    const modifiedJudgeResult: JudgeResult = {
      ...judgeResult,
      decision: 'blocked_by_quality_gates',
      reasoning: `${judgeResult.reasoning}\n\n🚨 QUALITY GATES FAILED:\n${qualityIssuesDescription}`,
      finalConfidence: Math.min(judgeResult.finalConfidence, qualityResult.swarmMetrics.averageConfidence),
      qualityScore: qualityResult.swarmMetrics.synthesisQuality
    };
    
    return modifiedJudgeResult;
  }
  
  // Quality passed - enhance judge result with quality metrics
  return {
    ...judgeResult,
    reasoning: `${judgeResult.reasoning}\n\n✅ Quality gates passed (${qualityResult.gateResults.length} gates, ${qualityResult.swarmMetrics.successfulAgents}/${qualityResult.swarmMetrics.totalAgents} agents)`,
    qualityScore: qualityResult.swarmMetrics.synthesisQuality
  };
}