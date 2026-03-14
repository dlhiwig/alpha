/**
 * Delta Evaluation System — ported from SAFLA
 *
 * Measures improvement over time by comparing current run metrics
 * against previous runs. Calculates performance, efficiency, stability,
 * and capability deltas with adaptive weighting.
 */

import fs from "node:fs";
import path from "node:path";

// ─── Types ──────────────────────────────────────────────────

export interface DeltaMetrics {
  performance_delta: number;
  efficiency_delta: number;
  stability_delta: number;
  capability_delta: number;
  confidence: number;
  timestamp: number;
}

export interface DeltaResult {
  overall_delta: number;
  metrics: DeltaMetrics;
  context: string | null;
  metadata: Record<string, unknown>;
}

export interface RunData {
  reward?: number;
  tokens_used?: number;
  throughput?: number;
  resources_used?: number;
  variance?: number;
  capabilities?: number;
  [key: string]: unknown;
}

export interface AdaptiveWeights {
  performance: number;
  efficiency: number;
  stability: number;
  capability: number;
}

export interface BatchRequest {
  requestId: string;
  current: RunData;
  previous: RunData;
  context?: string;
}

export interface BatchResult {
  requestId: string;
  result: DeltaResult;
  processingTimeMs: number;
}

interface EvalHistoryEntry {
  result: DeltaResult;
  savedAt: number;
}

// ─── Delta calculators ──────────────────────────────────────

function performanceDelta(current: RunData, previous: RunData): number {
  const curReward = current.reward ?? 0;
  const prevReward = previous.reward ?? 0;
  const tokens = Math.max(current.tokens_used ?? 1, 1e-8);
  return (curReward - prevReward) / tokens;
}

function efficiencyDelta(current: RunData, previous: RunData): number {
  const curThroughput = current.throughput ?? 0;
  const prevThroughput = previous.throughput ?? 0;
  const resources = Math.max(current.resources_used ?? 1, 1e-8);
  return (curThroughput - prevThroughput) / resources;
}

function stabilityDelta(current: RunData, previous: RunData): number {
  // Lower variance = better stability, so invert the sign
  const curVariance = current.variance ?? 0;
  const prevVariance = previous.variance ?? 0;
  return prevVariance - curVariance;
}

function capabilityDelta(current: RunData, previous: RunData): number {
  const curCap = current.capabilities ?? 0;
  const prevCap = previous.capabilities ?? 0;
  return curCap - prevCap;
}

// ─── Weight adjustment ──────────────────────────────────────

const DEFAULT_WEIGHTS: AdaptiveWeights = {
  performance: 0.4,
  efficiency: 0.3,
  stability: 0.2,
  capability: 0.1,
};

function weightsForContext(context: string | null | undefined): AdaptiveWeights {
  if (!context) return { ...DEFAULT_WEIGHTS };
  const lower = context.toLowerCase();
  if (lower.includes("performance")) return { performance: 0.6, efficiency: 0.2, stability: 0.1, capability: 0.1 };
  if (lower.includes("efficiency")) return { performance: 0.2, efficiency: 0.6, stability: 0.1, capability: 0.1 };
  if (lower.includes("stability")) return { performance: 0.2, efficiency: 0.1, stability: 0.6, capability: 0.1 };
  if (lower.includes("capability")) return { performance: 0.1, efficiency: 0.1, stability: 0.2, capability: 0.6 };
  return { ...DEFAULT_WEIGHTS };
}

// ─── DeltaEvaluator ─────────────────────────────────────────

export class DeltaEvaluator {
  private historyPath: string;
  private history: EvalHistoryEntry[] = [];

  constructor(stateDir: string) {
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }
    this.historyPath = path.join(stateDir, "delta-eval-history.json");
    this.loadHistory();
  }

  /** Evaluate improvement between current and previous run data. */
  evaluate(current: RunData, previous: RunData, context?: string): DeltaResult {
    const perfD = performanceDelta(current, previous);
    const effD = efficiencyDelta(current, previous);
    const stabD = stabilityDelta(current, previous);
    const capD = capabilityDelta(current, previous);

    const w = weightsForContext(context);
    const overall = w.performance * perfD + w.efficiency * effD + w.stability * stabD + w.capability * capD;

    // Confidence based on how many non-zero deltas we computed
    const deltas = [perfD, effD, stabD, capD];
    const nonZero = deltas.filter((d) => Math.abs(d) > 1e-12).length;
    const confidence = Math.min(nonZero / 4, 1.0);

    const metrics: DeltaMetrics = {
      performance_delta: perfD,
      efficiency_delta: effD,
      stability_delta: stabD,
      capability_delta: capD,
      confidence,
      timestamp: Date.now(),
    };

    const result: DeltaResult = {
      overall_delta: overall,
      metrics,
      context: context ?? null,
      metadata: {},
    };

    this.history.push({ result, savedAt: Date.now() });
    this.persistHistory();

    return result;
  }

  /** Evaluate a batch of requests. */
  evaluateBatch(requests: BatchRequest[]): BatchResult[] {
    return requests.map((req) => {
      const start = performance.now();
      const result = this.evaluate(req.current, req.previous, req.context);
      return {
        requestId: req.requestId,
        result,
        processingTimeMs: performance.now() - start,
      };
    });
  }

  /** Get the full evaluation history. */
  getHistory(): EvalHistoryEntry[] {
    return [...this.history];
  }

  /** Compute a trend from the last N evaluations. */
  trend(n = 10): { improving: boolean; avgDelta: number } {
    const slice = this.history.slice(-n);
    if (slice.length === 0) return { improving: false, avgDelta: 0 };
    const avg = slice.reduce((sum, e) => sum + e.result.overall_delta, 0) / slice.length;
    return { improving: avg > 0, avgDelta: avg };
  }

  // ── Persistence ──

  private loadHistory(): void {
    try {
      if (fs.existsSync(this.historyPath)) {
        const raw = fs.readFileSync(this.historyPath, "utf-8");
        this.history = JSON.parse(raw) as EvalHistoryEntry[];
      }
    } catch {
      this.history = [];
    }
  }

  private persistHistory(): void {
    // Keep last 500 entries to avoid unbounded growth
    if (this.history.length > 500) {
      this.history = this.history.slice(-500);
    }
    fs.writeFileSync(this.historyPath, JSON.stringify(this.history, null, 2));
  }
}
