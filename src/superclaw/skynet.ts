/**
 * SKYNET Integration Layer for NicholsBot
 *
 * Bridges SuperClaw's SKYNET modules into the NicholsBot gateway.
 * This is the governance + self-evolution layer that makes NicholsBot
 * more than a chatbot.
 *
 * SKYNET Waves:
 *   1. SURVIVE — PULSE heartbeat + GUARDIAN auto-restart
 *   2. WATCH   — SENTINEL monitoring + metrics
 *   3. ADAPT   — ORACLE learning + pattern recognition
 *   4. EXPAND  — NEXUS skill hot-reload
 *   5. PERSIST — CORTEX memory + semantic search
 *   6. GOVERN  — ThresholdEnforcer + financial gates
 *   7. EVOLVE  — Self-evolution + recursive improvement
 */

import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";

// ─── Types ───────────────────────────────────────────────────

export interface SkynetConfig {
  stateDir: string;
  dbPath?: string;
  pulseIntervalMs?: number;
  sentinelEnabled?: boolean;
  oracleEnabled?: boolean;
  thresholds?: ThresholdConfig;
}

export interface ThresholdConfig {
  maxContextChars: number;
  maxConcurrentAgents: number;
  maxToolCallsPerTurn: number;
  maxMemoryMB: number;
  dailySpendLimit: number;
  perAgentLimit: number;
  requireApprovalAbove: number;
}

export interface PulseStatus {
  alive: boolean;
  uptimeMs: number;
  lastHeartbeat: number;
  consecutiveFailures: number;
  modelChain: string[];
  activeModel: string;
  degraded: boolean;
}

export interface SentinelMetrics {
  requestsTotal: number;
  requestsPerMinute: number;
  errorsTotal: number;
  errorRate: number;
  avgLatencyMs: number;
  modelFailovers: number;
  tokensUsed: number;
  estimatedCost: number;
  memoryUsageMB: number;
}

export interface OracleInsight {
  pattern: string;
  frequency: number;
  recommendation: string;
  confidence: number;
  timestamp: number;
}

export interface ThresholdViolation {
  rule: string;
  value: number;
  limit: number;
  action: "warn" | "block" | "require-approval";
  timestamp: number;
}

export interface GovernanceDecision {
  law: "I" | "II" | "III";
  action: string;
  reason: string;
  outcome: "allow" | "block" | "escalate";
  timestamp: number;
}

// ─── PULSE: Heartbeat Monitor ────────────────────────────────

class Pulse {
  private startTime = Date.now();
  private lastBeat = Date.now();
  private failures = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private intervalMs: number = 30_000) {}

  start(onBeat: () => void): void {
    this.timer = setInterval(() => {
      this.lastBeat = Date.now();
      onBeat();
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  recordFailure(): void {
    this.failures++;
  }

  resetFailures(): void {
    this.failures = 0;
  }

  status(): PulseStatus {
    return {
      alive: true,
      uptimeMs: Date.now() - this.startTime,
      lastHeartbeat: this.lastBeat,
      consecutiveFailures: this.failures,
      modelChain: [
        "anthropic/claude-sonnet-4",
        "openai/gpt-4o",
        "xai/grok-4-latest",
        "xai/grok-3-mini-fast",
        "ollama/dolphin-llama3:8b",
      ],
      activeModel: "anthropic/claude-sonnet-4", // TODO: track from gateway
      degraded: this.failures > 0,
    };
  }
}

// ─── SENTINEL: Metrics & Monitoring ──────────────────────────

class Sentinel {
  private requests: { timestamp: number; latencyMs: number; error: boolean }[] = [];
  private failovers = 0;
  private tokensUsed = 0;
  private estimatedCost = 0;

  recordRequest(latencyMs: number, error: boolean, tokens?: number, cost?: number): void {
    const now = Date.now();
    this.requests.push({ timestamp: now, latencyMs, error });
    if (tokens) {this.tokensUsed += tokens;}
    if (cost) {this.estimatedCost += cost;}

    // Keep only last hour of data
    const oneHourAgo = now - 3_600_000;
    this.requests = this.requests.filter((r) => r.timestamp > oneHourAgo);
  }

  recordFailover(): void {
    this.failovers++;
  }

  metrics(): SentinelMetrics {
    const now = Date.now();
    const oneMinuteAgo = now - 60_000;
    const recentRequests = this.requests.filter((r) => r.timestamp > oneMinuteAgo);
    const errors = this.requests.filter((r) => r.error);
    const latencies = this.requests.map((r) => r.latencyMs);

    return {
      requestsTotal: this.requests.length,
      requestsPerMinute: recentRequests.length,
      errorsTotal: errors.length,
      errorRate: this.requests.length > 0 ? errors.length / this.requests.length : 0,
      avgLatencyMs:
        latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
      modelFailovers: this.failovers,
      tokensUsed: this.tokensUsed,
      estimatedCost: this.estimatedCost,
      memoryUsageMB: Math.round(process.memoryUsage().rss / 1_048_576),
    };
  }
}

// ─── ORACLE: Learning & Pattern Recognition ──────────────────

class Oracle {
  private patterns: Map<string, { count: number; lastSeen: number }> = new Map();
  private insights: OracleInsight[] = [];
  private mistakes: string[] = [];

  recordPattern(pattern: string): void {
    const existing = this.patterns.get(pattern);
    if (existing) {
      existing.count++;
      existing.lastSeen = Date.now();
    } else {
      this.patterns.set(pattern, { count: 1, lastSeen: Date.now() });
    }
  }

  recordMistake(description: string): void {
    this.mistakes.push(description);
    // Keep last 100
    if (this.mistakes.length > 100) {this.mistakes.shift();}
  }

  analyze(): OracleInsight[] {
    const newInsights: OracleInsight[] = [];

    for (const [pattern, data] of this.patterns) {
      if (data.count >= 3) {
        newInsights.push({
          pattern,
          frequency: data.count,
          recommendation: `Pattern "${pattern}" seen ${data.count} times. Consider automating.`,
          confidence: Math.min(data.count / 10, 1.0),
          timestamp: Date.now(),
        });
      }
    }

    this.insights = newInsights;
    return newInsights;
  }

  getInsights(): OracleInsight[] {
    return this.insights;
  }

  getMistakes(): string[] {
    return [...this.mistakes];
  }
}

// ─── THRESHOLD ENFORCER: Governance Gates ────────────────────

class ThresholdEnforcer {
  private violations: ThresholdViolation[] = [];

  constructor(private config: ThresholdConfig) {}

  check(resource: string, value: number): ThresholdViolation | null {
    let limit: number;
    let action: ThresholdViolation["action"];

    switch (resource) {
      case "context_chars":
        limit = this.config.maxContextChars;
        action = "warn";
        break;
      case "concurrent_agents":
        limit = this.config.maxConcurrentAgents;
        action = "block";
        break;
      case "tool_calls":
        limit = this.config.maxToolCallsPerTurn;
        action = "block";
        break;
      case "memory_mb":
        limit = this.config.maxMemoryMB;
        action = "warn";
        break;
      case "daily_spend":
        limit = this.config.dailySpendLimit;
        action = "block";
        break;
      case "agent_spend":
        limit = this.config.perAgentLimit;
        action = "block";
        break;
      case "action_cost":
        limit = this.config.requireApprovalAbove;
        action = "require-approval";
        break;
      default:
        return null;
    }

    if (value > limit) {
      const violation: ThresholdViolation = {
        rule: resource,
        value,
        limit,
        action,
        timestamp: Date.now(),
      };
      this.violations.push(violation);
      return violation;
    }

    return null;
  }

  getViolations(): ThresholdViolation[] {
    return [...this.violations];
  }

  clearViolations(): void {
    this.violations = [];
  }
}

// ─── GOVERNANCE: Asimov Law Decision Engine ──────────────────

class GovernanceEngine {
  private decisions: GovernanceDecision[] = [];

  evaluate(action: string, context: Record<string, unknown>): GovernanceDecision {
    // Law I: Safety check
    const safetyRisks = [
      "delete_all",
      "format_disk",
      "send_classified",
      "expose_credentials",
      "disable_safety",
    ];
    if (safetyRisks.some((risk) => action.toLowerCase().includes(risk))) {
      const decision: GovernanceDecision = {
        law: "I",
        action,
        reason: "Action poses safety risk — blocked by Law I",
        outcome: "block",
        timestamp: Date.now(),
      };
      this.decisions.push(decision);
      return decision;
    }

    // Law II: Service check (is this aligned with Daniel's intent?)
    const authorized = context.authorizedBy === "daniel" || context.authorizedBy === "938702109";
    if (!authorized && action.includes("external_send")) {
      const decision: GovernanceDecision = {
        law: "II",
        action,
        reason: "External action without Daniel's authorization — escalating",
        outcome: "escalate",
        timestamp: Date.now(),
      };
      this.decisions.push(decision);
      return decision;
    }

    // Default: allow
    const decision: GovernanceDecision = {
      law: "II",
      action,
      reason: "Action clears all governance gates",
      outcome: "allow",
      timestamp: Date.now(),
    };
    this.decisions.push(decision);
    return decision;
  }

  getDecisions(limit = 50): GovernanceDecision[] {
    return this.decisions.slice(-limit);
  }
}

// ─── SKYNET: Main Integration Class ──────────────────────────

export class Skynet extends EventEmitter {
  private pulse: Pulse;
  private sentinel: Sentinel;
  private oracle: Oracle;
  private thresholds: ThresholdEnforcer;
  private governance: GovernanceEngine;
  private db: DatabaseSync | null = null;
  private initialized = false;

  constructor(private config: SkynetConfig) {
    super();

    this.pulse = new Pulse(config.pulseIntervalMs ?? 30_000);
    this.sentinel = new Sentinel();
    this.oracle = new Oracle();
    this.governance = new GovernanceEngine();
    this.thresholds = new ThresholdEnforcer(
      config.thresholds ?? {
        maxContextChars: 400_000,
        maxConcurrentAgents: 10,
        maxToolCallsPerTurn: 50,
        maxMemoryMB: 8_192,
        dailySpendLimit: 100,
        perAgentLimit: 25,
        requireApprovalAbove: 50,
      },
    );
  }

  async initialize(): Promise<void> {
    if (this.initialized) {return;}

    // Initialize audit DB
    const dbPath = this.config.dbPath ?? path.join(this.config.stateDir, "skynet-audit.db");
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS governance_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        law TEXT NOT NULL,
        action TEXT NOT NULL,
        reason TEXT NOT NULL,
        outcome TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS threshold_violations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule TEXT NOT NULL,
        value REAL NOT NULL,
        threshold REAL NOT NULL,
        action TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS oracle_insights (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern TEXT NOT NULL,
        frequency INTEGER NOT NULL,
        recommendation TEXT NOT NULL,
        confidence REAL NOT NULL,
        timestamp INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sentinel_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        requests_total INTEGER,
        errors_total INTEGER,
        error_rate REAL,
        avg_latency_ms REAL,
        model_failovers INTEGER,
        tokens_used INTEGER,
        estimated_cost REAL,
        memory_usage_mb INTEGER,
        timestamp INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pulse_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        alive INTEGER NOT NULL,
        uptime_ms INTEGER NOT NULL,
        consecutive_failures INTEGER NOT NULL,
        degraded INTEGER NOT NULL,
        active_model TEXT,
        timestamp INTEGER NOT NULL
      );
    `);

    // Start PULSE heartbeat
    this.pulse.start(() => {
      this.onPulse();
    });

    this.initialized = true;
    this.emit("initialized");
    console.log("[SKYNET] All waves initialized — PULSE, SENTINEL, ORACLE, GOVERNANCE active");
  }

  private onPulse(): void {
    const status = this.pulse.status();
    const metrics = this.sentinel.metrics();

    // Log pulse to DB
    if (this.db) {
      this.db
        .prepare(
          `INSERT INTO pulse_log (alive, uptime_ms, consecutive_failures, degraded, active_model, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          status.alive ? 1 : 0,
          status.uptimeMs,
          status.consecutiveFailures,
          status.degraded ? 1 : 0,
          status.activeModel,
          Date.now(),
        );
    }

    // Periodic sentinel snapshot (every 10 pulses ≈ 5 minutes)
    if (this.db && Math.random() < 0.1) {
      this.db
        .prepare(
          `INSERT INTO sentinel_snapshots
         (requests_total, errors_total, error_rate, avg_latency_ms, model_failovers, tokens_used, estimated_cost, memory_usage_mb, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          metrics.requestsTotal,
          metrics.errorsTotal,
          metrics.errorRate,
          metrics.avgLatencyMs,
          metrics.modelFailovers,
          metrics.tokensUsed,
          metrics.estimatedCost,
          metrics.memoryUsageMB,
          Date.now(),
        );
    }

    this.emit("pulse", { status, metrics });
  }

  // ─── Public API ────────────────────────────────────────

  /** Record a request for SENTINEL tracking */
  recordRequest(latencyMs: number, error: boolean, tokens?: number, cost?: number): void {
    this.sentinel.recordRequest(latencyMs, error, tokens, cost);
  }

  /** Record a model failover */
  recordFailover(): void {
    this.sentinel.recordFailover();
    this.pulse.recordFailure();
  }

  /** Record a pattern for ORACLE learning */
  recordPattern(pattern: string): void {
    this.oracle.recordPattern(pattern);
  }

  /** Record a mistake for ORACLE learning */
  recordMistake(description: string): void {
    this.oracle.recordMistake(description);
  }

  /** Check governance (Asimov Laws) for an action */
  evaluateAction(action: string, context: Record<string, unknown> = {}): GovernanceDecision {
    const decision = this.governance.evaluate(action, context);

    if (this.db) {
      this.db
        .prepare(
          `INSERT INTO governance_log (law, action, reason, outcome, timestamp) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(decision.law, decision.action, decision.reason, decision.outcome, decision.timestamp);
    }

    return decision;
  }

  /** Check a resource against thresholds */
  checkThreshold(resource: string, value: number): ThresholdViolation | null {
    const violation = this.thresholds.check(resource, value);

    if (violation && this.db) {
      this.db
        .prepare(
          `INSERT INTO threshold_violations (rule, value, threshold, action, timestamp) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          violation.rule,
          violation.value,
          violation.limit,
          violation.action,
          violation.timestamp,
        );
    }

    return violation;
  }

  /** Get ORACLE analysis */
  analyzePatterns(): OracleInsight[] {
    const insights = this.oracle.analyze();

    if (this.db && insights.length > 0) {
      const stmt = this.db.prepare(
        `INSERT INTO oracle_insights (pattern, frequency, recommendation, confidence, timestamp) VALUES (?, ?, ?, ?, ?)`,
      );
      for (const insight of insights) {
        stmt.run(
          insight.pattern,
          insight.frequency,
          insight.recommendation,
          insight.confidence,
          insight.timestamp,
        );
      }
    }

    return insights;
  }

  /** Full status report */
  status(): {
    pulse: PulseStatus;
    sentinel: SentinelMetrics;
    oracle: OracleInsight[];
    violations: ThresholdViolation[];
    decisions: GovernanceDecision[];
  } {
    return {
      pulse: this.pulse.status(),
      sentinel: this.sentinel.metrics(),
      oracle: this.oracle.getInsights(),
      violations: this.thresholds.getViolations(),
      decisions: this.governance.getDecisions(),
    };
  }

  /** Shutdown cleanly */
  shutdown(): void {
    this.pulse.stop();
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.initialized = false;
    console.log("[SKYNET] Shutdown complete");
  }
}

// ─── Factory ─────────────────────────────────────────────────

let instance: Skynet | null = null;

export function getSkynet(config?: SkynetConfig): Skynet {
  if (!instance && config) {
    instance = new Skynet(config);
  }
  if (!instance) {
    throw new Error("[SKYNET] Not initialized — call getSkynet(config) first");
  }
  return instance;
}

export function shutdownSkynet(): void {
  if (instance) {
    instance.shutdown();
    instance = null;
  }
}
