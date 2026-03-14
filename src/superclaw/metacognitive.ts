/**
 * Meta-Cognitive Self-Awareness Loop
 * Ported from SAFLA's metacognitive engine into Alpha's SKYNET layer.
 *
 * Modules:
 *   - SystemState: real-time process + OS resource snapshot
 *   - SelfAwarenessModule: state monitoring, anomaly detection, trend analysis
 *   - StrategySelector: context-aware strategy selection with learning
 *   - AdaptationEngine: outcome-based learning and parameter tuning
 *   - MetaCognitiveEngine: coordinator — think → act → reflect cycle
 */

import * as os from "node:os";

// ─── SystemState ──────────────────────────────────────────────

export interface SystemState {
  timestamp: number;
  memoryUsage: number; // 0-1 fraction (heapUsed / heapTotal)
  cpuUsage: number; // 0-1 fraction (avg across cores)
  rssMB: number;
  activeGoals: string[];
  currentStrategies: string[];
  performanceMetrics: Record<string, number>;
}

function captureSystemState(
  activeGoals: string[] = [],
  currentStrategies: string[] = [],
  performanceMetrics: Record<string, number> = {},
): SystemState {
  const mem = process.memoryUsage();
  const cpus = os.cpus();

  // Average CPU usage across all cores (idle vs total)
  let totalIdle = 0;
  let totalTick = 0;
  for (const cpu of cpus) {
    const { user, nice, sys, idle, irq } = cpu.times;
    totalIdle += idle;
    totalTick += user + nice + sys + idle + irq;
  }
  const cpuUsage = totalTick > 0 ? 1 - totalIdle / totalTick : 0;

  return {
    timestamp: Date.now(),
    memoryUsage: mem.heapTotal > 0 ? mem.heapUsed / mem.heapTotal : 0,
    cpuUsage,
    rssMB: Math.round(mem.rss / 1_048_576),
    activeGoals,
    currentStrategies,
    performanceMetrics,
  };
}

// ─── Anomaly ──────────────────────────────────────────────────

export interface Anomaly {
  type: string;
  value: number;
  threshold: number;
  timestamp: number;
}

// ─── SelfAwarenessModule ──────────────────────────────────────

export class SelfAwarenessModule {
  private stateHistory: SystemState[] = [];
  private readonly maxHistory: number;

  constructor(maxHistory = 500) {
    this.maxHistory = maxHistory;
  }

  /** Capture and store a new state snapshot */
  observe(
    activeGoals: string[] = [],
    currentStrategies: string[] = [],
    performanceMetrics: Record<string, number> = {},
  ): SystemState {
    const state = captureSystemState(activeGoals, currentStrategies, performanceMetrics);
    this.stateHistory.push(state);
    if (this.stateHistory.length > this.maxHistory) {
      this.stateHistory.splice(0, this.stateHistory.length - this.maxHistory);
    }
    return state;
  }

  /** Current state (latest or fresh capture) */
  currentState(): SystemState {
    return this.stateHistory.at(-1) ?? captureSystemState();
  }

  /** Detect anomalies relative to recent history */
  detectAnomalies(threshold = 0.85): Anomaly[] {
    const current = this.currentState();
    const anomalies: Anomaly[] = [];

    if (current.memoryUsage > threshold) {
      anomalies.push({
        type: "high_memory",
        value: current.memoryUsage,
        threshold,
        timestamp: current.timestamp,
      });
    }

    if (current.cpuUsage > threshold) {
      anomalies.push({
        type: "high_cpu",
        value: current.cpuUsage,
        threshold,
        timestamp: current.timestamp,
      });
    }

    // Rapid change detection (spike between last two states)
    if (this.stateHistory.length >= 2) {
      const prev = this.stateHistory[this.stateHistory.length - 2];
      const memDelta = Math.abs(current.memoryUsage - prev.memoryUsage);
      const cpuDelta = Math.abs(current.cpuUsage - prev.cpuUsage);

      if (memDelta > 0.3) {
        anomalies.push({
          type: "memory_spike",
          value: memDelta,
          threshold: 0.3,
          timestamp: current.timestamp,
        });
      }
      if (cpuDelta > 0.3) {
        anomalies.push({
          type: "cpu_spike",
          value: cpuDelta,
          threshold: 0.3,
          timestamp: current.timestamp,
        });
      }
    }

    return anomalies;
  }

  /** Identify trends from recent state history */
  analyzeTrends(window = 5): { memory: "rising" | "falling" | "stable"; cpu: "rising" | "falling" | "stable" } {
    const recent = this.stateHistory.slice(-window);
    return {
      memory: trend(recent.map((s) => s.memoryUsage)),
      cpu: trend(recent.map((s) => s.cpuUsage)),
    };
  }

  /** Reflect: combine anomaly detection + trend analysis into a report */
  reflect(): {
    state: SystemState;
    anomalies: Anomaly[];
    trends: ReturnType<SelfAwarenessModule["analyzeTrends"]>;
    historySize: number;
  } {
    const state = this.currentState();
    return {
      state,
      anomalies: this.detectAnomalies(),
      trends: this.analyzeTrends(),
      historySize: this.stateHistory.length,
    };
  }

  getHistory(limit?: number): SystemState[] {
    if (limit) {
      return this.stateHistory.slice(-limit);
    }
    return [...this.stateHistory];
  }
}

// ─── Strategy ─────────────────────────────────────────────────

export interface Strategy {
  id: string;
  name: string;
  applicableContexts: string[];
  performanceMetrics: Record<string, number>;
  resourceRequirements: Record<string, number>;
  successRate: number;
  lastUsed: number | null;
}

interface StrategyRecord {
  strategyId: string;
  score: number;
  success: boolean;
  timestamp: number;
}

// ─── StrategySelector ─────────────────────────────────────────

export class StrategySelector {
  private strategies = new Map<string, Strategy>();
  private history: StrategyRecord[] = [];
  private readonly maxHistory = 500;

  addStrategy(strategy: Strategy): void {
    this.strategies.set(strategy.id, strategy);
  }

  getStrategy(id: string): Strategy | undefined {
    return this.strategies.get(id);
  }

  /** Select best strategy for a given context */
  select(context: {
    situation: string;
    availableCpu?: number;
    availableMemory?: number;
    timePressure?: number;
  }): Strategy | null {
    let best: Strategy | null = null;
    let bestScore = -1;

    for (const strategy of this.strategies.values()) {
      const score = this.score(strategy, context);
      if (score > bestScore) {
        bestScore = score;
        best = strategy;
      }
    }

    if (best) {
      best.lastUsed = Date.now();
    }
    return best;
  }

  /** Record a strategy execution outcome */
  recordOutcome(strategyId: string, score: number, success: boolean): void {
    this.history.push({ strategyId, score, success, timestamp: Date.now() });
    if (this.history.length > this.maxHistory) {
      this.history.splice(0, this.history.length - this.maxHistory);
    }

    // Update success rate with exponential moving average
    const strategy = this.strategies.get(strategyId);
    if (strategy) {
      const alpha = 0.1;
      strategy.successRate = alpha * (success ? 1 : 0) + (1 - alpha) * strategy.successRate;
    }
  }

  /** Get stats for a strategy */
  getStats(strategyId: string): {
    timesUsed: number;
    avgScore: number;
    successRate: number;
    trend: "improving" | "declining" | "stable" | "insufficient_data";
  } {
    const records = this.history.filter((r) => r.strategyId === strategyId);
    if (records.length === 0) {
      return { timesUsed: 0, avgScore: 0, successRate: 0, trend: "insufficient_data" };
    }
    const scores = records.map((r) => r.score);
    return {
      timesUsed: records.length,
      avgScore: mean(scores),
      successRate: records.filter((r) => r.success).length / records.length,
      trend: trend(scores) === "rising" ? "improving" : trend(scores) === "falling" ? "declining" : "stable",
    };
  }

  private score(
    strategy: Strategy,
    ctx: { situation: string; availableCpu?: number; availableMemory?: number; timePressure?: number },
  ): number {
    let s = 0;

    // Context match
    if (strategy.applicableContexts.includes(ctx.situation)) {
      s += 0.5;
    }

    // Resource fit
    const cpuOk = (strategy.resourceRequirements.cpu ?? 0) <= (ctx.availableCpu ?? 1);
    const memOk = (strategy.resourceRequirements.memory ?? 0) <= (ctx.availableMemory ?? 1);
    if (cpuOk && memOk) {
      s += 0.3;
    }

    // Speed vs accuracy based on time pressure
    if ((ctx.timePressure ?? 0) > 0.7) {
      s += (strategy.performanceMetrics.speed ?? 0.5) * 0.2;
    } else {
      s += (strategy.performanceMetrics.accuracy ?? 0.5) * 0.2;
    }

    return s;
  }
}

// ─── AdaptationEngine ─────────────────────────────────────────

export interface Experience {
  context: Record<string, unknown>;
  action: string;
  outcome: { success: boolean; performanceGain: number };
  timestamp?: number;
}

export class AdaptationEngine {
  private experiences: Experience[] = [];
  private learningRate = 0.1;
  private readonly adaptationThreshold = 0.2;
  private readonly maxExperiences = 5000;

  /** Record a new experience */
  addExperience(exp: Experience): void {
    this.experiences.push({ ...exp, timestamp: exp.timestamp ?? Date.now() });
    if (this.experiences.length > this.maxExperiences) {
      this.experiences.splice(0, this.experiences.length - this.maxExperiences);
    }
  }

  /** Learn patterns from accumulated experiences */
  learnPatterns(): { patternsFound: number; rules: string[] } {
    if (this.experiences.length < 3) {
      return { patternsFound: 0, rules: [] };
    }

    const buckets = new Map<string, { successes: number; total: number; gains: number[] }>();

    for (const exp of this.experiences) {
      const key = `${exp.action}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { successes: 0, total: 0, gains: [] };
        buckets.set(key, bucket);
      }
      bucket.total++;
      if (exp.outcome.success) {
        bucket.successes++;
      }
      bucket.gains.push(exp.outcome.performanceGain);
    }

    const rules: string[] = [];
    for (const [action, data] of buckets) {
      const rate = data.successes / data.total;
      const avgGain = mean(data.gains);
      if (rate > 0.6) {
        rules.push(`action "${action}" succeeds ${(rate * 100).toFixed(0)}% (avg gain ${avgGain.toFixed(2)})`);
      } else if (rate < 0.4) {
        rules.push(`action "${action}" fails ${((1 - rate) * 100).toFixed(0)}% — consider alternatives`);
      }
    }

    return { patternsFound: rules.length, rules };
  }

  /**
   * Adapt parameters based on a performance gap.
   * Returns true if adaptation was applied.
   */
  adapt(performanceGap: number): { adapted: boolean; newLearningRate: number } {
    if (performanceGap < this.adaptationThreshold) {
      return { adapted: false, newLearningRate: this.learningRate };
    }

    // Increase learning rate toward the gap, capped at 0.5
    this.learningRate = Math.min(0.5, this.learningRate * 1.1);
    return { adapted: true, newLearningRate: this.learningRate };
  }

  /** Adjust learning rate based on recent success */
  adjustLearningRate(recentSuccessRate: number, contextComplexity: number): void {
    if (recentSuccessRate > 0.8 && contextComplexity < 0.5) {
      this.learningRate = Math.min(0.5, this.learningRate * 1.05);
    } else if (recentSuccessRate < 0.4 || contextComplexity > 0.8) {
      this.learningRate = Math.max(0.01, this.learningRate * 0.95);
    }
  }

  getLearningRate(): number {
    return this.learningRate;
  }

  getExperienceCount(): number {
    return this.experiences.length;
  }
}

// ─── MetaCognitiveEngine ──────────────────────────────────────

export interface MetaCognitiveReport {
  timestamp: number;
  state: SystemState;
  anomalies: Anomaly[];
  trends: { memory: string; cpu: string };
  adaptationApplied: boolean;
  patternsFound: number;
  cycleCount: number;
}

/**
 * Coordinates all metacognitive modules in a think → act → reflect cycle.
 * Runs a periodic self-check every `intervalMs` (default 60 s).
 */
export class MetaCognitiveEngine {
  readonly awareness: SelfAwarenessModule;
  readonly strategies: StrategySelector;
  readonly adaptation: AdaptationEngine;

  private timer: ReturnType<typeof setInterval> | null = null;
  private cycleCount = 0;
  private running = false;
  private reports: MetaCognitiveReport[] = [];
  private readonly maxReports = 100;

  /** Optional hook: called with each anomaly so Skynet can feed Oracle */
  onAnomaly?: (anomaly: Anomaly) => void;
  /** Optional hook: called each cycle with the full report */
  onReport?: (report: MetaCognitiveReport) => void;

  constructor(private intervalMs = 60_000) {
    this.awareness = new SelfAwarenessModule();
    this.strategies = new StrategySelector();
    this.adaptation = new AdaptationEngine();
  }

  /** Start the periodic self-check loop */
  start(): void {
    if (this.running) return;
    this.running = true;

    // Run one cycle immediately, then schedule
    this.cycle();
    this.timer = setInterval(() => this.cycle(), this.intervalMs);
  }

  /** Stop the periodic loop */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Run a single think → act → reflect cycle */
  cycle(): MetaCognitiveReport {
    this.cycleCount++;

    // ── THINK: observe current state ──
    const state = this.awareness.observe();

    // ── ACT: detect anomalies and adapt ──
    const anomalies = this.awareness.detectAnomalies();
    const trends = this.awareness.analyzeTrends();

    // Notify each anomaly (so Skynet/Oracle can track patterns)
    for (const a of anomalies) {
      this.onAnomaly?.(a);
    }

    // Determine performance gap from error-rate metric if available
    const errorRate = state.performanceMetrics.errorRate ?? 0;
    const adaptResult = this.adaptation.adapt(errorRate);

    // ── REFLECT: learn from accumulated experiences ──
    const { patternsFound } = this.adaptation.learnPatterns();

    const report: MetaCognitiveReport = {
      timestamp: Date.now(),
      state,
      anomalies,
      trends,
      adaptationApplied: adaptResult.adapted,
      patternsFound,
      cycleCount: this.cycleCount,
    };

    this.reports.push(report);
    if (this.reports.length > this.maxReports) {
      this.reports.splice(0, this.reports.length - this.maxReports);
    }

    this.onReport?.(report);
    return report;
  }

  isRunning(): boolean {
    return this.running;
  }

  getCycleCount(): number {
    return this.cycleCount;
  }

  getReports(limit = 10): MetaCognitiveReport[] {
    return this.reports.slice(-limit);
  }

  /** Summary for status dashboards */
  status(): {
    running: boolean;
    cycleCount: number;
    lastReport: MetaCognitiveReport | null;
    experienceCount: number;
    learningRate: number;
  } {
    return {
      running: this.running,
      cycleCount: this.cycleCount,
      lastReport: this.reports.at(-1) ?? null,
      experienceCount: this.adaptation.getExperienceCount(),
      learningRate: this.adaptation.getLearningRate(),
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function trend(values: number[]): "rising" | "falling" | "stable" {
  if (values.length < 3) return "stable";
  const recent = values.slice(-3);
  const diffs: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    diffs.push(recent[i] - recent[i - 1]);
  }
  const avgDiff = mean(diffs);
  if (avgDiff > 0.05) return "rising";
  if (avgDiff < -0.05) return "falling";
  return "stable";
}
