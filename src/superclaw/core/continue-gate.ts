/**
 * SuperClaw ContinueGate
 * 
 * Inspired by @claude-flow/guidance ContinueGate
 * Prevents runaway loops through self-throttling
 * 
 * Evaluates at each step:
 * - Budget slope (token burn rate)
 * - Rework ratio (repeated work)
 * - Coherence score (output quality)
 * - Step count (iteration limits)
 */

// --- Types ---

export interface ContinueGateConfig {
  /** Max steps before forced stop */
  maxConsecutiveSteps: number;
  
  /** Ratio of rework to total work (0.3 = 30% rework triggers throttle) */
  maxReworkRatio: number;
  
  /** Steps between checkpoints */
  checkpointIntervalSteps: number;
  
  /** Token burn rate threshold (budget/step) */
  budgetSlopeThreshold: number;
  
  /** Minimum coherence score (0-1) */
  minCoherenceScore: number;
  
  /** Maximum uncertainty before pause (0-1) */
  maxUncertaintyScore: number;
  
  /** Cooldown between throttle decisions (ms) */
  throttleCooldownMs: number;
}

export interface StepMetrics {
  stepNumber: number;
  totalTokensUsed: number;
  totalToolCalls: number;
  reworkCount: number;
  coherenceScore: number;
  uncertaintyScore: number;
  elapsedMs: number;
  lastCheckpointStep: number;
  budgetRemaining: {
    tokens: number;
    toolCalls: number;
    timeMs: number;
  };
  recentDecisions: ContinueDecision[];
}

export type ContinueDecision = 
  | 'continue'     // Keep going
  | 'checkpoint'   // Save state, then continue
  | 'throttle'     // Slow down (insert delays)
  | 'pause'        // Stop and wait for human
  | 'stop';        // Terminate swarm

export interface ContinueEvaluation {
  decision: ContinueDecision;
  reason: string;
  metrics: {
    budgetSlope: number;
    reworkRatio: number;
    coherenceScore: number;
    uncertaintyScore: number;
    stepsSinceCheckpoint: number;
  };
  suggestions?: string[];
}

// --- Default Config ---

const DEFAULT_CONFIG: ContinueGateConfig = {
  maxConsecutiveSteps: 100,
  maxReworkRatio: 0.3,
  checkpointIntervalSteps: 25,
  budgetSlopeThreshold: 0.05,
  minCoherenceScore: 0.6,
  maxUncertaintyScore: 0.7,
  throttleCooldownMs: 5000,
};

// --- ContinueGate Class ---

export class ContinueGate {
  private config: ContinueGateConfig;
  private history: ContinueEvaluation[] = [];
  private lastThrottleTime: number = 0;
  private stats = {
    decisions: {
      continue: 0,
      checkpoint: 0,
      throttle: 0,
      pause: 0,
      stop: 0,
    },
    totalEvaluations: 0,
  };

  constructor(config?: Partial<ContinueGateConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // --- Evaluation ---

  evaluate(metrics: StepMetrics): ContinueEvaluation {
    this.stats.totalEvaluations++;

    // Calculate derived metrics
    const stepsSinceCheckpoint = metrics.stepNumber - metrics.lastCheckpointStep;
    const reworkRatio = metrics.stepNumber > 0 
      ? metrics.reworkCount / metrics.stepNumber 
      : 0;
    const budgetSlope = metrics.stepNumber > 0
      ? metrics.totalTokensUsed / metrics.stepNumber
      : 0;

    const evalMetrics = {
      budgetSlope,
      reworkRatio,
      coherenceScore: metrics.coherenceScore,
      uncertaintyScore: metrics.uncertaintyScore,
      stepsSinceCheckpoint,
    };

    // Decision priority: stop > pause > throttle > checkpoint > continue

    // 1. Hard stop: Max steps exceeded
    if (metrics.stepNumber >= this.config.maxConsecutiveSteps) {
      return this.recordDecision('stop', 
        `Max steps (${this.config.maxConsecutiveSteps}) exceeded`,
        evalMetrics);
    }

    // 2. Hard stop: Budget exhausted
    if (metrics.budgetRemaining.tokens <= 0 || 
        metrics.budgetRemaining.toolCalls <= 0 ||
        metrics.budgetRemaining.timeMs <= 0) {
      return this.recordDecision('stop',
        'Budget exhausted',
        evalMetrics);
    }

    // 3. Pause: Coherence too low
    if (metrics.coherenceScore < this.config.minCoherenceScore) {
      return this.recordDecision('pause',
        `Coherence (${metrics.coherenceScore.toFixed(2)}) below threshold (${this.config.minCoherenceScore})`,
        evalMetrics,
        ['Agent may be confused — consider resetting context']);
    }

    // 4. Pause: Uncertainty too high
    if (metrics.uncertaintyScore > this.config.maxUncertaintyScore) {
      return this.recordDecision('pause',
        `Uncertainty (${metrics.uncertaintyScore.toFixed(2)}) above threshold (${this.config.maxUncertaintyScore})`,
        evalMetrics,
        ['Agent is uncertain — human guidance recommended']);
    }

    // 5. Throttle: Rework ratio too high
    if (reworkRatio > this.config.maxReworkRatio) {
      // Check cooldown to avoid constant throttling
      const now = Date.now();
      if (now - this.lastThrottleTime > this.config.throttleCooldownMs) {
        this.lastThrottleTime = now;
        return this.recordDecision('throttle',
          `Rework ratio (${(reworkRatio * 100).toFixed(1)}%) exceeds ${this.config.maxReworkRatio * 100}%`,
          evalMetrics,
          ['Consider different approach', 'Check for circular dependencies']);
      }
    }

    // 6. Throttle: Budget burn rate too high
    const expectedTokensPerStep = metrics.budgetRemaining.tokens / 
      (this.config.maxConsecutiveSteps - metrics.stepNumber);
    if (budgetSlope > expectedTokensPerStep * (1 + this.config.budgetSlopeThreshold)) {
      const now = Date.now();
      if (now - this.lastThrottleTime > this.config.throttleCooldownMs) {
        this.lastThrottleTime = now;
        return this.recordDecision('throttle',
          `Token burn rate (${budgetSlope.toFixed(0)}/step) too high`,
          evalMetrics,
          ['Consider using smaller model', 'Reduce output verbosity']);
      }
    }

    // 7. Checkpoint: Interval reached
    if (stepsSinceCheckpoint >= this.config.checkpointIntervalSteps) {
      return this.recordDecision('checkpoint',
        `${this.config.checkpointIntervalSteps} steps since last checkpoint`,
        evalMetrics);
    }

    // 8. Continue: All checks passed
    return this.recordDecision('continue', 'All metrics healthy', evalMetrics);
  }

  // --- Convenience method with history tracking ---

  evaluateWithHistory(metrics: StepMetrics): ContinueEvaluation {
    const evaluation = this.evaluate(metrics);
    
    // Add recent decisions for pattern detection
    const recentDecisions = this.history
      .slice(-5)
      .map(e => e.decision);
    
    // Detect oscillation (throttle → continue → throttle pattern)
    if (recentDecisions.length >= 4) {
      const isOscillating = recentDecisions
        .slice(-4)
        .every((d, i) => i % 2 === 0 ? d === 'throttle' : d === 'continue');
      
      if (isOscillating && evaluation.decision === 'throttle') {
        return this.recordDecision('pause',
          'Oscillation detected (throttle/continue pattern)',
          evaluation.metrics,
          ['Agent is stuck in a loop', 'Manual intervention recommended']);
      }
    }

    return evaluation;
  }

  // --- Stats ---

  getStats(): typeof this.stats {
    return { ...this.stats };
  }

  getHistory(): readonly ContinueEvaluation[] {
    return [...this.history];
  }

  reset(): void {
    this.history = [];
    this.lastThrottleTime = 0;
    this.stats = {
      decisions: { continue: 0, checkpoint: 0, throttle: 0, pause: 0, stop: 0 },
      totalEvaluations: 0,
    };
  }

  // --- Config ---

  getConfig(): Readonly<ContinueGateConfig> {
    return { ...this.config };
  }

  updateConfig(updates: Partial<ContinueGateConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  // --- Private ---

  private recordDecision(
    decision: ContinueDecision,
    reason: string,
    metrics: ContinueEvaluation['metrics'],
    suggestions?: string[]
  ): ContinueEvaluation {
    const evaluation: ContinueEvaluation = {
      decision,
      reason,
      metrics,
      suggestions,
    };

    this.history.push(evaluation);
    this.stats.decisions[decision]++;

    return evaluation;
  }
}

// --- Factory ---

export function createContinueGate(config?: Partial<ContinueGateConfig>): ContinueGate {
  return new ContinueGate(config);
}
