/**
 * Consensus Algorithms for Alpha Swarm
 *
 * Ported from SuperClaw's skynet/consensus/ patterns.
 * Provides quorum voting and judge arbitration for multi-agent results.
 */

import type { SubtaskResult } from "./lightweight-swarm.js";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface ConsensusConfig {
  /** Minimum agreement ratio to reach quorum (0-1). Default: 0.66 */
  quorumThreshold: number;
  /** Minimum confidence score to consider a result valid. Default: 0.3 */
  minConfidence: number;
  /** Weight given to output length in scoring (0-1). Default: 0.3 */
  lengthWeight: number;
  /** Weight given to completeness signals in scoring (0-1). Default: 0.4 */
  completenessWeight: number;
  /** Weight given to overlap/agreement with other results (0-1). Default: 0.3 */
  overlapWeight: number;
}

export interface JudgeVerdict {
  /** The winning result */
  winner: SubtaskResult;
  /** Overall confidence in the verdict (0-1) */
  confidence: number;
  /** Why this result was chosen */
  reasoning: string;
  /** Scores for all candidates */
  scores: CandidateScore[];
  /** Whether quorum was reached */
  quorumReached: boolean;
  /** Dissenting agent IDs (those whose results disagreed significantly) */
  dissent: string[];
}

export interface CandidateScore {
  agentId: string;
  subtaskId: string;
  /** Heuristic quality score (0-1) */
  qualityScore: number;
  /** How much this result overlaps with others (0-1) */
  agreementScore: number;
  /** Combined final score (0-1) */
  finalScore: number;
}

const DEFAULT_CONSENSUS_CONFIG: ConsensusConfig = {
  quorumThreshold: 0.66,
  minConfidence: 0.3,
  lengthWeight: 0.3,
  completenessWeight: 0.4,
  overlapWeight: 0.3,
};

// ═══════════════════════════════════════════════════════════════════
// Quorum Voting
// ═══════════════════════════════════════════════════════════════════

export class QuorumVoting {
  private config: ConsensusConfig;

  constructor(config: Partial<ConsensusConfig> = {}) {
    this.config = { ...DEFAULT_CONSENSUS_CONFIG, ...config };
  }

  /**
   * Check if quorum is reached given the results.
   * Adaptive: relaxes threshold when only 2 agents are available
   * (SuperClaw fix f39d70c — with 2 agents, require both to succeed
   * rather than applying a 66% threshold that makes 1/2 fail quorum).
   */
  checkQuorum(results: SubtaskResult[]): { reached: boolean; ratio: number; threshold: number } {
    const validResults = results.filter(
      (r) => r.success && r.confidence >= this.config.minConfidence,
    );
    const ratio = results.length > 0 ? validResults.length / results.length : 0;

    // Adaptive quorum: when only 2 agents, require simple majority (>= 0.5)
    // instead of the default supermajority. With 2 agents, 1/2 = 0.5 passes.
    const threshold =
      results.length <= 2
        ? Math.min(this.config.quorumThreshold, 0.5)
        : this.config.quorumThreshold;

    return {
      reached: ratio >= threshold,
      ratio,
      threshold,
    };
  }

  /**
   * Vote on results: rank by quality and return ordered candidates.
   */
  vote(results: SubtaskResult[]): CandidateScore[] {
    const validResults = results.filter((r) => r.success && r.output.trim().length > 0);

    if (validResults.length === 0) {
      return [];
    }

    // Score each result
    const scores = validResults.map((result) => {
      const qualityScore = this.scoreQuality(result);
      const agreementScore = this.scoreAgreement(result, validResults);
      const finalScore =
        qualityScore * (1 - this.config.overlapWeight) + agreementScore * this.config.overlapWeight;

      return {
        agentId: result.agentId,
        subtaskId: result.subtaskId,
        qualityScore,
        agreementScore,
        finalScore,
      };
    });

    // Sort by final score descending
    return scores.toSorted((a, b) => b.finalScore - a.finalScore);
  }

  /**
   * Score a single result on quality heuristics:
   * - Length (longer = more thorough, with diminishing returns)
   * - Completeness signals (code blocks, structured sections, examples)
   */
  private scoreQuality(result: SubtaskResult): number {
    const text = result.output;

    // Length score: sigmoid-like curve, plateaus around 2000 chars
    const lengthScore = Math.min(text.length / 2000, 1);

    // Completeness: check for structural signals
    let completenessScore = 0;
    const signals = [
      /```[\s\S]*?```/, // Code blocks
      /^#{1,3}\s/m, // Markdown headings
      /^\d+\.\s/m, // Numbered lists
      /^[-*]\s/m, // Bullet lists
      /\b(example|e\.g\.|for instance)\b/i, // Examples
      /\b(because|therefore|since|due to)\b/i, // Reasoning
      /\b(however|but|although|note)\b/i, // Nuance/caveats
    ];
    for (const signal of signals) {
      if (signal.test(text)) {
        completenessScore += 1 / signals.length;
      }
    }

    // Factor in the agent's own confidence
    const confidenceBonus = result.confidence * 0.2;

    return (
      lengthScore * this.config.lengthWeight +
      completenessScore * this.config.completenessWeight +
      confidenceBonus
    );
  }

  /**
   * Score how much a result agrees with others (consensus overlap).
   * Uses simple token overlap as a proxy for semantic agreement.
   */
  private scoreAgreement(result: SubtaskResult, allResults: SubtaskResult[]): number {
    if (allResults.length <= 1) {
      return 1;
    } // Single result always agrees with itself

    const tokens = this.tokenize(result.output);
    if (tokens.size === 0) {
      return 0;
    }

    const others = allResults.filter((r) => r.agentId !== result.agentId);
    let totalOverlap = 0;

    for (const other of others) {
      const otherTokens = this.tokenize(other.output);
      let overlap = 0;
      for (const token of tokens) {
        if (otherTokens.has(token)) {
          overlap++;
        }
      }
      totalOverlap += tokens.size > 0 ? overlap / tokens.size : 0;
    }

    return totalOverlap / others.length;
  }

  /** Extract meaningful tokens from text (lowercase, 4+ chars, no stop words). */
  private tokenize(text: string): Set<string> {
    const stopWords = new Set([
      "this",
      "that",
      "with",
      "from",
      "have",
      "will",
      "been",
      "were",
      "they",
      "their",
      "which",
      "would",
      "could",
      "should",
      "about",
      "there",
      "these",
      "those",
      "then",
      "than",
      "each",
      "into",
      "also",
      "some",
      "when",
      "what",
      "your",
      "more",
      "make",
      "like",
      "just",
      "over",
      "such",
      "only",
      "very",
      "does",
    ]);
    const words = text.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
    return new Set(words.filter((w) => !stopWords.has(w)));
  }
}

// ═══════════════════════════════════════════════════════════════════
// Judge Step
// ═══════════════════════════════════════════════════════════════════

export class JudgeStep {
  private quorum: QuorumVoting;
  private config: ConsensusConfig;

  constructor(config: Partial<ConsensusConfig> = {}) {
    this.config = { ...DEFAULT_CONSENSUS_CONFIG, ...config };
    this.quorum = new QuorumVoting(this.config);
  }

  /**
   * Evaluate all agent outputs and pick the winner.
   * Acts as the final arbiter after parallel execution.
   */
  evaluate(results: SubtaskResult[]): JudgeVerdict {
    const validResults = results.filter((r) => r.success);

    // Edge case: no valid results
    if (validResults.length === 0) {
      return {
        winner: results[0] || {
          agentId: "none",
          subtaskId: "none",
          success: false,
          output: "No valid results from any agent",
          latencyMs: 0,
          confidence: 0,
        },
        confidence: 0,
        reasoning: "No valid results to judge",
        scores: [],
        quorumReached: false,
        dissent: [],
      };
    }

    // Check quorum
    const quorumCheck = this.quorum.checkQuorum(results);

    // Score and rank all candidates
    const scores = this.quorum.vote(results);

    // Pick the winner (highest scored)
    const winnerScore = scores[0];
    const winner = validResults.find(
      (r) => r.agentId === winnerScore.agentId && r.subtaskId === winnerScore.subtaskId,
    )!;

    // Calculate overall confidence from score spread and quorum
    const confidence = this.calculateConfidence(scores, quorumCheck);

    // Identify dissenting agents (score significantly below winner)
    const winnerFinal = winnerScore.finalScore;
    const dissent = scores.filter((s) => winnerFinal - s.finalScore > 0.3).map((s) => s.agentId);

    // Build reasoning
    const reasoning = this.buildReasoning(winnerScore, scores, quorumCheck);

    return {
      winner,
      confidence,
      reasoning,
      scores,
      quorumReached: quorumCheck.reached,
      dissent,
    };
  }

  /**
   * Merge outputs using judge verdict — returns the best result
   * plus a consensus summary when multiple agents agree.
   */
  mergeWithVerdict(results: SubtaskResult[]): {
    success: boolean;
    output: string;
    consensusReached: boolean;
    confidence: number;
    reasoning: string;
  } {
    const verdict = this.evaluate(results);

    if (!verdict.quorumReached && results.length > 1) {
      // No quorum: fall back to concatenating all valid outputs with a warning
      const validOutputs = results
        .filter((r) => r.success && r.output.trim())
        .map((r) => `## Agent ${r.subtaskId}\n${r.output}`)
        .join("\n\n---\n\n");

      return {
        success: results.some((r) => r.success),
        output: `> **Note:** Quorum not reached (${(verdict.confidence * 100).toFixed(0)}% confidence). Showing all agent outputs.\n\n${validOutputs}`,
        consensusReached: false,
        confidence: verdict.confidence,
        reasoning: verdict.reasoning,
      };
    }

    return {
      success: verdict.winner.success,
      output: verdict.winner.output,
      consensusReached: verdict.quorumReached,
      confidence: verdict.confidence,
      reasoning: verdict.reasoning,
    };
  }

  /**
   * Confidence = blend of winner's score, score spread, and quorum ratio.
   */
  private calculateConfidence(
    scores: CandidateScore[],
    quorum: { reached: boolean; ratio: number },
  ): number {
    if (scores.length === 0) {
      return 0;
    }

    const topScore = scores[0].finalScore;

    // How tight is the pack? Closer scores = more agreement = higher confidence
    let spreadBonus = 0;
    if (scores.length > 1) {
      const avgScore = scores.reduce((sum, s) => sum + s.finalScore, 0) / scores.length;
      const spread = topScore - avgScore;
      // Low spread (all similar) = high agreement = bonus
      spreadBonus = Math.max(0, 0.3 - spread);
    }

    // Quorum factor
    const quorumFactor = quorum.reached ? 1 : 0.5;

    return Math.min(1, (topScore + spreadBonus) * quorumFactor);
  }

  private buildReasoning(
    winner: CandidateScore,
    scores: CandidateScore[],
    quorum: { reached: boolean; ratio: number; threshold: number },
  ): string {
    const parts: string[] = [];

    parts.push(`Winner: agent ${winner.agentId} (score: ${winner.finalScore.toFixed(2)})`);

    if (quorum.reached) {
      parts.push(
        `Quorum reached: ${(quorum.ratio * 100).toFixed(0)}% >= ${(quorum.threshold * 100).toFixed(0)}%`,
      );
    } else {
      parts.push(
        `Quorum NOT reached: ${(quorum.ratio * 100).toFixed(0)}% < ${(quorum.threshold * 100).toFixed(0)}%`,
      );
    }

    parts.push(`Candidates evaluated: ${scores.length}`);

    if (scores.length > 1) {
      const runnerUp = scores[1];
      const margin = winner.finalScore - runnerUp.finalScore;
      parts.push(`Margin over runner-up: ${(margin * 100).toFixed(1)}%`);
    }

    return parts.join(". ");
  }
}

// ═══════════════════════════════════════════════════════════════════
// Factory functions
// ═══════════════════════════════════════════════════════════════════

export function createQuorumVoting(config?: Partial<ConsensusConfig>): QuorumVoting {
  return new QuorumVoting(config);
}

export function createJudgeStep(config?: Partial<ConsensusConfig>): JudgeStep {
  return new JudgeStep(config);
}
