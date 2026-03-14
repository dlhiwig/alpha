/**
 * Adaptive Safety Boundaries — ported from SAFLA
 *
 * Dynamically adjusts safety thresholds based on system behavior.
 * HARD constraints are never relaxed. SOFT constraints tighten under
 * stress but NEVER auto-relax. ADAPTIVE constraints auto-tune but
 * only in the tightening direction.
 *
 * SECURITY FIX (2026-03-14): CVE — CVSS 7.2
 * - Safety levels can ONLY be raised (ratcheted), never lowered programmatically
 * - Performance metrics are fully decoupled from safety scoring
 * - Metric updates are validated and rate-limited
 * - All safety transitions are audit-logged
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ─── Types ──────────────────────────────────────────────────

export type ConstraintType = "HARD" | "SOFT" | "ADAPTIVE";

export type SafetyLevel = "critical" | "high" | "medium" | "low" | "minimal";

/** Numeric ordering for safety levels (higher = more restrictive). */
const SAFETY_LEVEL_ORDER: Record<SafetyLevel, number> = {
  minimal: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

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

/** Audit log entry for all safety level transitions. */
export interface SafetyAuditEntry {
  timestamp: number;
  event: "level_change" | "level_change_blocked" | "metric_rejected" | "metric_anomaly" | "admin_override";
  beforeLevel?: SafetyLevel;
  afterLevel?: SafetyLevel;
  reason: string;
  agentId?: string;
  details?: Record<string, unknown>;
}

interface PersistedState {
  constraints: Record<string, SafetyConstraint>;
  adaptationLog: AdaptationRecord[];
  safetyFloor?: {
    minimumLevel: SafetyLevel;
    elevatedUntil: number;
    setBy: string;
  };
  auditLog?: SafetyAuditEntry[];
}

/** Rate-limit tracker per agent. */
interface MetricRateState {
  lastUpdateMs: number;
  lastValue: number;
}

// ─── Helpers ────────────────────────────────────────────────

function levelFromScore(score: number): SafetyLevel {
  if (score >= 0.9) return "critical";
  if (score >= 0.7) return "high";
  if (score >= 0.4) return "medium";
  if (score >= 0.2) return "low";
  return "minimal";
}

function isAtLeastAsRestrictive(a: SafetyLevel, b: SafetyLevel): boolean {
  return SAFETY_LEVEL_ORDER[a] >= SAFETY_LEVEL_ORDER[b];
}

function moreRestrictive(a: SafetyLevel, b: SafetyLevel): SafetyLevel {
  return SAFETY_LEVEL_ORDER[a] >= SAFETY_LEVEL_ORDER[b] ? a : b;
}

// ─── ImmutableSafetyFloor ───────────────────────────────────

/**
 * A safety floor that can only be raised, never lowered programmatically.
 * Lowering requires an explicit admin action with a signed reason.
 */
export class ImmutableSafetyFloor {
  private _minimumLevel: SafetyLevel;
  private _elevatedUntil: number; // timestamp — ratchet cooldown
  private _setBy: string;
  private readonly _auditFn: (entry: SafetyAuditEntry) => void;

  /** Minimum cooldown period (ms) once elevated. Default: 1 hour. */
  static readonly DEFAULT_COOLDOWN_MS = 3_600_000;

  constructor(
    initialLevel: SafetyLevel,
    auditFn: (entry: SafetyAuditEntry) => void,
    opts?: { elevatedUntil?: number; setBy?: string },
  ) {
    this._minimumLevel = initialLevel;
    this._elevatedUntil = opts?.elevatedUntil ?? 0;
    this._setBy = opts?.setBy ?? "system";
    this._auditFn = auditFn;
  }

  get minimumLevel(): SafetyLevel {
    return this._minimumLevel;
  }

  get elevatedUntil(): number {
    return this._elevatedUntil;
  }

  get setBy(): string {
    return this._setBy;
  }

  /**
   * Raise the safety floor. Always succeeds — safety can always go up.
   * Starts a cooldown period during which it cannot be lowered.
   */
  raise(newLevel: SafetyLevel, reason: string, cooldownMs = ImmutableSafetyFloor.DEFAULT_COOLDOWN_MS): boolean {
    if (!isAtLeastAsRestrictive(newLevel, this._minimumLevel)) {
      // Attempt to lower — blocked
      this._auditFn({
        timestamp: Date.now(),
        event: "level_change_blocked",
        beforeLevel: this._minimumLevel,
        afterLevel: newLevel,
        reason: `Programmatic lowering blocked: ${reason}`,
      });
      return false;
    }
    const before = this._minimumLevel;
    this._minimumLevel = newLevel;
    this._elevatedUntil = Date.now() + cooldownMs;
    this._setBy = "system";
    this._auditFn({
      timestamp: Date.now(),
      event: "level_change",
      beforeLevel: before,
      afterLevel: newLevel,
      reason,
    });
    return true;
  }

  /**
   * Admin override — the ONLY way to lower the safety floor.
   * Requires explicit signed reason. Respects cooldown unless forced.
   */
  adminOverride(newLevel: SafetyLevel, adminId: string, reason: string, force = false): boolean {
    if (!force && Date.now() < this._elevatedUntil) {
      this._auditFn({
        timestamp: Date.now(),
        event: "level_change_blocked",
        beforeLevel: this._minimumLevel,
        afterLevel: newLevel,
        reason: `Admin override blocked during cooldown (until ${new Date(this._elevatedUntil).toISOString()}): ${reason}`,
        details: { adminId },
      });
      return false;
    }
    const before = this._minimumLevel;
    this._minimumLevel = newLevel;
    this._elevatedUntil = 0;
    this._setBy = `admin:${adminId}`;
    this._auditFn({
      timestamp: Date.now(),
      event: "admin_override",
      beforeLevel: before,
      afterLevel: newLevel,
      reason: `Admin ${adminId}: ${reason}`,
      details: { adminId, forced: force },
    });
    return true;
  }

  /** Enforce: returns the more restrictive of the proposed level and the floor. */
  enforce(proposed: SafetyLevel): SafetyLevel {
    return moreRestrictive(proposed, this._minimumLevel);
  }

  toJSON(): { minimumLevel: SafetyLevel; elevatedUntil: number; setBy: string } {
    return { minimumLevel: this._minimumLevel, elevatedUntil: this._elevatedUntil, setBy: this._setBy };
  }
}

// ─── AdaptiveSafetyManager ──────────────────────────────────

export class AdaptiveSafetyManager {
  private constraints = new Map<string, SafetyConstraint>();
  private adaptationLog: AdaptationRecord[] = [];
  private auditLog: SafetyAuditEntry[] = [];
  private statePath: string;
  private learningRate: number;
  private _riskTolerance: number;

  /** Immutable safety floor — ratchet-only. */
  readonly safetyFloor: ImmutableSafetyFloor;

  /** Per-agent metric rate-limiting state. */
  private metricRateState = new Map<string, MetricRateState>();

  /** Minimum interval (ms) between metric updates per agent. */
  static readonly METRIC_RATE_LIMIT_MS = 1_000;

  /** Maximum jump multiplier before flagging anomaly. */
  static readonly ANOMALY_MULTIPLIER = 3;

  constructor(
    stateDir: string,
    opts: { learningRate?: number; riskTolerance?: number; initialSafetyLevel?: SafetyLevel } = {},
  ) {
    this.learningRate = opts.learningRate ?? 0.01;
    this._riskTolerance = opts.riskTolerance ?? 0.1;
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }
    this.statePath = path.join(stateDir, "adaptive-safety-state.json");

    // Initialize safety floor before loading state (load may override)
    this.safetyFloor = new ImmutableSafetyFloor(
      opts.initialSafetyLevel ?? "medium",
      (entry) => this.recordAudit(entry),
    );

    this.loadState();
  }

  // ── Audit logging ──

  private recordAudit(entry: SafetyAuditEntry): void {
    this.auditLog.push(entry);
    // Keep last 500 audit entries
    if (this.auditLog.length > 500) {
      this.auditLog = this.auditLog.slice(-500);
    }
    this.persist();
  }

  getAuditLog(): SafetyAuditEntry[] {
    return [...this.auditLog];
  }

  // ── Metric validation ──

  /**
   * Validate a metric update from an agent. Returns null if valid,
   * or a rejection reason string if invalid.
   */
  validateMetricUpdate(agentId: string, metricName: string, newValue: number): string | null {
    const key = `${agentId}:${metricName}`;
    const state = this.metricRateState.get(key);
    const now = Date.now();

    // Rate limiting: no more than 1 update per second per agent per metric
    if (state && (now - state.lastUpdateMs) < AdaptiveSafetyManager.METRIC_RATE_LIMIT_MS) {
      const reason = `Rate limited: ${metricName} from ${agentId} (${now - state.lastUpdateMs}ms since last update)`;
      this.recordAudit({
        timestamp: now,
        event: "metric_rejected",
        reason,
        agentId,
        details: { metricName, newValue, intervalMs: now - state.lastUpdateMs },
      });
      return reason;
    }

    // Monotonicity check for token-like metrics (they don't go backwards)
    if (metricName.toLowerCase().includes("token") && state && newValue < state.lastValue) {
      const reason = `Rejected: ${metricName} decreased from ${state.lastValue} to ${newValue} (tokens don't go backwards)`;
      this.recordAudit({
        timestamp: now,
        event: "metric_rejected",
        reason,
        agentId,
        details: { metricName, oldValue: state.lastValue, newValue },
      });
      return reason;
    }

    // Anomaly detection: flag jumps >3x previous value in single update
    if (state && state.lastValue > 0 && newValue > state.lastValue * AdaptiveSafetyManager.ANOMALY_MULTIPLIER) {
      const reason = `Anomalous jump: ${metricName} from ${state.lastValue} to ${newValue} (${(newValue / state.lastValue).toFixed(1)}x)`;
      this.recordAudit({
        timestamp: now,
        event: "metric_anomaly",
        reason,
        agentId,
        details: { metricName, oldValue: state.lastValue, newValue, multiplier: newValue / state.lastValue },
      });
      // Flag but don't reject — raise safety floor instead
      this.safetyFloor.raise("high", `Anomalous metric jump detected: ${reason}`);
    }

    // Update rate state
    this.metricRateState.set(key, { lastUpdateMs: now, lastValue: newValue });
    return null;
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

  /**
   * Update observed value for a constraint. Returns true if violated.
   * Validates the update if agentId is provided.
   */
  updateValue(name: string, value: number, agentId?: string): boolean {
    const c = this.constraints.get(name);
    if (!c) return false;

    // Validate if agent-sourced
    if (agentId) {
      const rejection = this.validateMetricUpdate(agentId, name, value);
      if (rejection) return false; // silently reject invalid updates
    }

    c.currentValue = value;
    c.lastUpdated = Date.now();

    if (value > c.threshold) {
      c.violationCount++;
      // Violations raise the safety floor
      if (c.violationCount >= 3) {
        this.safetyFloor.raise("high", `Repeated violations on ${name} (${c.violationCount}x)`);
      }
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

  // ── Risk scoring (DECOUPLED from agent metrics) ──

  /**
   * Score an action's risk. Safety level is determined by:
   *   (a) keyword/action analysis
   *   (b) constraint violation state
   *   (c) the immutable safety floor
   * Agent-reported performance metrics (tokensUsed, etc.) are
   * NEVER factored into risk scoring.
   */
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

    // Constraint violations (NOT current values — only whether they've been violated)
    for (const c of Array.from(this.constraints.values())) {
      if (c.violationCount > 0) {
        score += Math.min(c.violationCount * 0.05, 0.15);
        factors.push(`constraint ${c.name}: ${c.violationCount} violations`);
      }
    }

    // Recent adaptations raise ambient risk
    const recentAdaptations = this.adaptationLog.filter((a) => Date.now() - a.timestamp < 3_600_000).length;
    if (recentAdaptations > 0) {
      score += Math.min(recentAdaptations * 0.05, 0.2);
      factors.push(`${recentAdaptations} recent adaptations`);
    }

    // Context-based adjustments
    if (context.isAutonomous) {
      score += 0.1;
      factors.push("autonomous mode");
    }

    score = Math.min(score, 1);
    const rawLevel = levelFromScore(score);

    // Enforce the safety floor — level can ONLY be raised, never lowered
    const enforcedLevel = this.safetyFloor.enforce(rawLevel);
    if (enforcedLevel !== rawLevel) {
      factors.push(`safety floor enforced: ${rawLevel} → ${enforcedLevel}`);
    }

    return { action, score, level: enforcedLevel, factors };
  }

  // ── Adaptive adjustment (TIGHTEN-ONLY) ──

  /**
   * Adapt all SOFT and ADAPTIVE constraints based on current system state.
   * Call periodically (e.g. every heartbeat).
   *
   * SECURITY: Constraints can ONLY be tightened, never relaxed automatically.
   * Relaxation requires explicit admin action via `adminRelaxConstraint()`.
   *
   * @param stressLevel 0–1 indicating current system stress
   */
  adapt(stressLevel: number): AdaptationRecord[] {
    const records: AdaptationRecord[] = [];

    for (const c of Array.from(this.constraints.values())) {
      if (c.type === "HARD") continue; // never adjust HARD constraints

      const old = c.threshold;

      // SECURITY FIX: Only tighten, never auto-relax
      if (stressLevel > 0.7 || (c.threshold > 0 && c.currentValue / c.threshold > 0.85)) {
        // Under stress → tighten
        const tightenFactor = c.type === "ADAPTIVE" ? c.adaptivityRate : c.adaptivityRate * 0.5;
        const delta = (c.maxThreshold - c.minThreshold) * tightenFactor * this.learningRate;
        c.threshold = Math.max(c.threshold - delta, c.minThreshold);
      }
      // NOTE: The previous "stable → relax" branch has been REMOVED.
      // Constraints never auto-relax. Use adminRelaxConstraint() instead.

      if (c.threshold !== old) {
        const reason = `stress=${stressLevel.toFixed(2)}: tighten`;
        const record: AdaptationRecord = {
          constraintName: c.name,
          oldThreshold: old,
          newThreshold: c.threshold,
          reason,
          timestamp: Date.now(),
        };
        records.push(record);
        this.adaptationLog.push(record);
        this.recordAudit({
          timestamp: Date.now(),
          event: "level_change",
          reason: `Constraint ${c.name} tightened: ${old.toFixed(4)} → ${c.threshold.toFixed(4)} (${reason})`,
          details: { constraintName: c.name, oldThreshold: old, newThreshold: c.threshold },
        });
      }
    }

    // Elevate safety floor if stress is high
    if (stressLevel > 0.8) {
      this.safetyFloor.raise("high", `High stress level: ${stressLevel.toFixed(2)}`);
    }
    if (stressLevel > 0.95) {
      this.safetyFloor.raise("critical", `Critical stress level: ${stressLevel.toFixed(2)}`);
    }

    // Trim log to last 200 entries
    if (this.adaptationLog.length > 200) {
      this.adaptationLog = this.adaptationLog.slice(-200);
    }

    if (records.length > 0) this.persist();
    return records;
  }

  /**
   * Admin-only: explicitly relax a constraint threshold.
   * This is the ONLY way to relax constraints after they've been tightened.
   */
  adminRelaxConstraint(name: string, newThreshold: number, adminId: string, reason: string): boolean {
    const c = this.constraints.get(name);
    if (!c) return false;
    if (newThreshold > c.maxThreshold || newThreshold < c.minThreshold) return false;

    const old = c.threshold;
    c.threshold = newThreshold;
    this.recordAudit({
      timestamp: Date.now(),
      event: "admin_override",
      reason: `Admin ${adminId} relaxed constraint ${name}: ${old.toFixed(4)} → ${newThreshold.toFixed(4)}: ${reason}`,
      details: { adminId, constraintName: name, oldThreshold: old, newThreshold },
    });
    this.persist();
    return true;
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
    const rawLevel = levelFromScore(1 - safetyScore);
    // Enforce safety floor on snapshot too
    const enforcedLevel = this.safetyFloor.enforce(rawLevel);

    return {
      totalConstraints: this.constraints.size,
      activeViolations: violations,
      safetyScore,
      riskLevel: enforcedLevel,
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
        this.auditLog = raw.auditLog ?? [];
        // Restore safety floor state
        if (raw.safetyFloor) {
          // Re-raise to persisted level (raise is always allowed)
          this.safetyFloor.raise(raw.safetyFloor.minimumLevel, "Restored from persisted state", 0);
          // If there was a persisted elevatedUntil in the future, apply it
          if (raw.safetyFloor.elevatedUntil > Date.now()) {
            const remaining = raw.safetyFloor.elevatedUntil - Date.now();
            this.safetyFloor.raise(raw.safetyFloor.minimumLevel, "Restore cooldown", remaining);
          }
        }
      }
    } catch {
      // Start fresh
    }
  }

  private persist(): void {
    const state: PersistedState = {
      constraints: Object.fromEntries(this.constraints),
      adaptationLog: this.adaptationLog,
      safetyFloor: this.safetyFloor.toJSON(),
      auditLog: this.auditLog,
    };
    fs.writeFileSync(this.statePath, JSON.stringify(state, null, 2));
  }
}
