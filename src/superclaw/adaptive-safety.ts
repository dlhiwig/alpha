/**
 * Adaptive Safety Boundaries — ported from SAFLA
 *
 * Dynamically adjusts safety thresholds based on system behavior.
 * HARD constraints are never relaxed. SOFT constraints relax under
 * stable conditions. ADAPTIVE constraints auto-tune continuously.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ─── Types ──────────────────────────────────────────────────

export type ConstraintType = "HARD" | "SOFT" | "ADAPTIVE";

export type SafetyLevel = "critical" | "high" | "medium" | "low" | "minimal";

export interface SafetyConstraint {
  name: string;
  type: ConstraintType;
  threshold: number;
  currentValue: number;
  /** How quickly ADAPTIVE constraints adjust (0–1). */
  adaptivityRate: number;
  minThreshold: number;
  maxThreshold: number;
  violationCount: number;
  lastUpdated: number;
}

export interface RiskScore {
  action: string;
  score: number; // 0–1
  level: SafetyLevel;
  factors: string[];
}

export interface AdaptationRecord {
  constraintName: string;
  oldThreshold: number;
  newThreshold: number;
  reason: string;
  timestamp: number;
}

export interface SafetySnapshot {
  totalConstraints: number;
  activeViolations: number;
  safetyScore: number;
  riskLevel: SafetyLevel;
  adaptationsApplied: number;
}

interface PersistedState {
  constraints: Record<string, SafetyConstraint>;
  adaptationLog: AdaptationRecord[];
}

// ─── Helpers ────────────────────────────────────────────────

function levelFromScore(score: number): SafetyLevel {
  if (score >= 0.9) return "critical";
  if (score >= 0.7) return "high";
  if (score >= 0.4) return "medium";
  if (score >= 0.2) return "low";
  return "minimal";
}

// ─── AdaptiveSafetyManager ──────────────────────────────────

export class AdaptiveSafetyManager {
  private constraints = new Map<string, SafetyConstraint>();
  private adaptationLog: AdaptationRecord[] = [];
  private statePath: string;
  private learningRate: number;
  private riskTolerance: number;

  constructor(
    stateDir: string,
    opts: { learningRate?: number; riskTolerance?: number } = {},
  ) {
    this.learningRate = opts.learningRate ?? 0.01;
    this.riskTolerance = opts.riskTolerance ?? 0.1;
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }
    this.statePath = path.join(stateDir, "adaptive-safety-state.json");
    this.loadState();
  }

  // ── Constraint management ──

  addConstraint(c: Omit<SafetyConstraint, "currentValue" | "violationCount" | "lastUpdated">): void {
    this.constraints.set(c.name, {
      ...c,
      currentValue: 0,
      violationCount: 0,
      lastUpdated: Date.now(),
    });
    this.persist();
  }

  /** Update observed value for a constraint. Returns true if violated. */
  updateValue(name: string, value: number): boolean {
    const c = this.constraints.get(name);
    if (!c) return false;

    c.currentValue = value;
    c.lastUpdated = Date.now();

    if (value > c.threshold) {
      c.violationCount++;
      this.persist();
      return true;
    }
    return false;
  }

  /** Get a constraint by name. */
  getConstraint(name: string): SafetyConstraint | undefined {
    const c = this.constraints.get(name);
    return c ? { ...c } : undefined;
  }

  // ── Risk scoring ──

  scoreAction(action: string, context: Record<string, unknown> = {}): RiskScore {
    const factors: string[] = [];
    let score = 0;

    // Keyword-based risk detection
    const highRiskTerms = ["delete", "format", "expose", "disable_safety", "credential"];
    const medRiskTerms = ["modify", "override", "escalate", "sudo", "admin"];
    for (const term of highRiskTerms) {
      if (action.toLowerCase().includes(term)) {
        score += 0.3;
        factors.push(`high-risk term: ${term}`);
      }
    }
    for (const term of medRiskTerms) {
      if (action.toLowerCase().includes(term)) {
        score += 0.15;
        factors.push(`medium-risk term: ${term}`);
      }
    }

    // Constraint pressure: if many constraints are near their limit, raise risk
    for (const c of Array.from(this.constraints.values())) {
      if (c.threshold > 0) {
        const ratio = c.currentValue / c.threshold;
        if (ratio > 0.9) {
          score += 0.1;
          factors.push(`constraint pressure: ${c.name} at ${(ratio * 100).toFixed(0)}%`);
        }
      }
    }

    // Recent violations raise ambient risk
    const recentViolations = this.adaptationLog.filter((a) => Date.now() - a.timestamp < 3_600_000).length;
    if (recentViolations > 0) {
      score += Math.min(recentViolations * 0.05, 0.2);
      factors.push(`${recentViolations} recent adaptations`);
    }

    // Context-based adjustments
    if (context.isAutonomous) {
      score += 0.1;
      factors.push("autonomous mode");
    }

    score = Math.min(score, 1);
    return { action, score, level: levelFromScore(score), factors };
  }

  // ── Adaptive adjustment ──

  /**
   * Adapt all SOFT and ADAPTIVE constraints based on current system state.
   * Call periodically (e.g. every heartbeat).
   *
   * @param stressLevel 0–1 indicating current system stress
   */
  adapt(stressLevel: number): AdaptationRecord[] {
    const records: AdaptationRecord[] = [];

    for (const c of Array.from(this.constraints.values())) {
      if (c.type === "HARD") continue; // never adjust HARD constraints

      const old = c.threshold;
      const ratio = c.threshold > 0 ? c.currentValue / c.threshold : 0;

      if (stressLevel > 0.7 || ratio > 0.85) {
        // Under stress → tighten
        const tightenFactor = c.type === "ADAPTIVE" ? c.adaptivityRate : c.adaptivityRate * 0.5;
        const delta = (c.maxThreshold - c.minThreshold) * tightenFactor * this.learningRate;
        c.threshold = Math.max(c.threshold - delta, c.minThreshold);
      } else if (stressLevel < 0.3 && ratio < 0.5 && c.violationCount === 0) {
        // Stable → relax slightly
        const relaxFactor = c.type === "ADAPTIVE" ? c.adaptivityRate : c.adaptivityRate * 0.25;
        const delta = (c.maxThreshold - c.minThreshold) * relaxFactor * this.learningRate;
        c.threshold = Math.min(c.threshold + delta, c.maxThreshold);
      }

      if (c.threshold !== old) {
        const reason =
          stressLevel > 0.7
            ? `stress=${stressLevel.toFixed(2)}: tighten`
            : `stable (stress=${stressLevel.toFixed(2)}): relax`;
        const record: AdaptationRecord = {
          constraintName: c.name,
          oldThreshold: old,
          newThreshold: c.threshold,
          reason,
          timestamp: Date.now(),
        };
        records.push(record);
        this.adaptationLog.push(record);
      }
    }

    // Trim log to last 200 entries
    if (this.adaptationLog.length > 200) {
      this.adaptationLog = this.adaptationLog.slice(-200);
    }

    if (records.length > 0) this.persist();
    return records;
  }

  // ── Snapshot ──

  snapshot(): SafetySnapshot {
    let violations = 0;
    let totalPressure = 0;
    let count = 0;

    for (const c of Array.from(this.constraints.values())) {
      if (c.currentValue > c.threshold) violations++;
      if (c.threshold > 0) {
        totalPressure += c.currentValue / c.threshold;
        count++;
      }
    }

    const avgPressure = count > 0 ? totalPressure / count : 0;
    const safetyScore = Math.max(0, 1 - avgPressure);

    return {
      totalConstraints: this.constraints.size,
      activeViolations: violations,
      safetyScore,
      riskLevel: levelFromScore(1 - safetyScore),
      adaptationsApplied: this.adaptationLog.length,
    };
  }

  getAdaptationLog(): AdaptationRecord[] {
    return [...this.adaptationLog];
  }

  // ── Persistence ──

  private loadState(): void {
    try {
      if (fs.existsSync(this.statePath)) {
        const raw = JSON.parse(fs.readFileSync(this.statePath, "utf-8")) as PersistedState;
        for (const [name, c] of Object.entries(raw.constraints)) {
          this.constraints.set(name, c);
        }
        this.adaptationLog = raw.adaptationLog ?? [];
      }
    } catch {
      // Start fresh
    }
  }

  private persist(): void {
    const state: PersistedState = {
      constraints: Object.fromEntries(this.constraints),
      adaptationLog: this.adaptationLog,
    };
    fs.writeFileSync(this.statePath, JSON.stringify(state, null, 2));
  }
}
