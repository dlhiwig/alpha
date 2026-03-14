/**
 * SKYNET Integration Layer for Alpha
 *
 * Bridges SuperClaw's SKYNET modules into the Alpha gateway.
 * This is the governance + self-evolution layer that makes Alpha
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

import * as crypto from "node:crypto";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  SelfEvolver,
  type SelfEvolverConfig,
  type EvolutionPlan,
  type SelfEvolveStats,
  type EvolutionOpportunity,
} from "./self-evolve.js";
import { MetaCognitiveEngine, type MetaCognitiveReport } from "./metacognitive.js";
import { DeltaEvaluator, type DeltaResult, type RunData } from "./delta-eval.js";
import {
  AdaptiveSafetyManager,
  type SafetySnapshot,
  type RiskScore,
  type AdaptationRecord,
} from "./adaptive-safety.js";
import { resolveAndValidateDbPath, validateDbPath } from "./validate-db-path.js";

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

// ─── CORTEX Types ────────────────────────────────────────────

export type MemoryKind = "conversation" | "fact" | "decision" | "preference" | "task";

export interface CortexMemory {
  id: string;
  kind: MemoryKind;
  content: string;
  summary: string;
  tags: string[];
  source: string;
  importance: number;
  accessCount: number;
  createdAt: number;
  lastAccessed: number | null;
}

export interface KnowledgeEdge {
  sourceId: string;
  targetId: string;
  relation: string;
  strength: number;
}

export interface CortexStats {
  totalMemories: number;
  totalQueries: number;
  graphNodes: number;
  graphEdges: number;
  dbSizeBytes: number;
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
    if (tokens) {
      this.tokensUsed += tokens;
    }
    if (cost) {
      this.estimatedCost += cost;
    }

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
    if (this.mistakes.length > 100) {
      this.mistakes.shift();
    }
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

// ─── CORTEX: Persistent Memory & Knowledge Graph ─────────────

const EMBEDDING_DIMS = 256;

export class Cortex {
  private db: DatabaseSync;
  private totalQueries = 0;

  constructor(stateDir: string) {
    const dbPath = validateDbPath(
      path.join(stateDir, "cortex.db"),
      stateDir,
      "cortex",
    );

    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        summary TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        source TEXT NOT NULL DEFAULT 'unknown',
        importance REAL NOT NULL DEFAULT 0.5,
        access_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_accessed INTEGER,
        embedding BLOB
      );

      CREATE TABLE IF NOT EXISTS knowledge_graph (
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relation TEXT NOT NULL,
        strength REAL NOT NULL DEFAULT 1.0,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (source_id, target_id, relation)
      );

      CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);
      CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);
      CREATE INDEX IF NOT EXISTS idx_kg_source ON knowledge_graph(source_id);
      CREATE INDEX IF NOT EXISTS idx_kg_target ON knowledge_graph(target_id);
    `);
  }

  /** Store a memory, returns its ID */
  memorize(content: string, kind: MemoryKind = "conversation", source = "unknown"): string {
    const id = `mem_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const summary = this.summarize(content);
    const tags = JSON.stringify(this.extractTags(content));
    const importance = this.scoreImportance(content, kind);
    const embedding = this.embed(content);

    this.db
      .prepare(
        `INSERT INTO memories (id, kind, content, summary, tags, source, importance, created_at, embedding)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        kind,
        content,
        summary,
        tags,
        source,
        importance,
        Date.now(),
        Buffer.from(new Float64Array(embedding).buffer),
      );

    // Auto-extract entities into knowledge graph
    this.extractAndLinkEntities(id, content);

    return id;
  }

  /** Semantic search across memories */
  recall(query: string, limit = 10): CortexMemory[] {
    this.totalQueries++;
    const queryEmb = this.embed(query);
    const queryTokens = this.tokenize(query);

    // Get candidate memories (recent + all for scoring)
    const rows = this.db.prepare("SELECT * FROM memories ORDER BY created_at DESC").all() as any[];

    const scored: { row: any; score: number }[] = [];

    for (const row of rows) {
      let score = 0;

      // Embedding similarity
      if (row.embedding) {
        const memEmb = Array.from(
          new Float64Array(
            (row.embedding as Buffer).buffer.slice(
              row.embedding.byteOffset,
              row.embedding.byteOffset + row.embedding.byteLength,
            ),
          ),
        );
        score += this.cosineSim(queryEmb, memEmb) * 0.5;
      }

      // Token overlap (keyword match)
      const memTokens = this.tokenize(row.content);
      const overlap = queryTokens.filter((t) => memTokens.includes(t)).length;
      if (queryTokens.length > 0) {
        score += (overlap / queryTokens.length) * 0.3;
      }

      // Recency boost
      const ageMs = Date.now() - row.created_at;
      const recency = 1 / (1 + ageMs / (7 * 86_400_000));
      score += recency * 0.1;

      // Importance boost
      score += (row.importance as number) * 0.1;

      if (score > 0.05) {
        scored.push({ row, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);

    const results: CortexMemory[] = [];
    const now = Date.now();

    for (const { row } of scored.slice(0, limit)) {
      // Update access count
      this.db
        .prepare(
          "UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id = ?",
        )
        .run(now, row.id);

      results.push({
        id: row.id,
        kind: row.kind,
        content: row.content,
        summary: row.summary,
        tags: JSON.parse(row.tags),
        source: row.source,
        importance: row.importance,
        accessCount: row.access_count + 1,
        createdAt: row.created_at,
        lastAccessed: now,
      });
    }

    return results;
  }

  /** Get a single memory by ID */
  getMemory(id: string): CortexMemory | null {
    const row = this.db.prepare("SELECT * FROM memories WHERE id = ?").get(id) as any;
    if (!row) {
      return null;
    }
    return this.rowToMemory(row);
  }

  /** Delete a memory */
  forget(id: string): boolean {
    const result = this.db.prepare("DELETE FROM memories WHERE id = ?").run(id);
    this.db.prepare("DELETE FROM knowledge_graph WHERE source_id = ? OR target_id = ?").run(id, id);
    return result.changes > 0;
  }

  /** Get recent memories */
  recent(limit = 10): CortexMemory[] {
    const rows = this.db
      .prepare("SELECT * FROM memories ORDER BY created_at DESC LIMIT ?")
      .all(limit) as any[];
    return rows.map((r) => this.rowToMemory(r));
  }

  /** Search by kind */
  recallByKind(kind: MemoryKind, limit = 10): CortexMemory[] {
    const rows = this.db
      .prepare("SELECT * FROM memories WHERE kind = ? ORDER BY created_at DESC LIMIT ?")
      .all(kind, limit) as any[];
    return rows.map((r) => this.rowToMemory(r));
  }

  /** Search by tag */
  recallByTag(tag: string, limit = 10): CortexMemory[] {
    const tagLower = tag.toLowerCase();
    const rows = this.db
      .prepare("SELECT * FROM memories ORDER BY importance DESC, created_at DESC")
      .all() as any[];

    const results: CortexMemory[] = [];
    for (const row of rows) {
      const tags: string[] = JSON.parse(row.tags);
      if (tags.some((t) => t.toLowerCase() === tagLower)) {
        results.push(this.rowToMemory(row));
        if (results.length >= limit) {
          break;
        }
      }
    }
    return results;
  }

  /** Build context string for a query */
  buildContext(query: string): string {
    const relevant = this.recall(query, 5);
    if (relevant.length === 0) {
      return "";
    }

    const lines = relevant.map((m) => {
      const date = new Date(m.createdAt).toISOString().split("T")[0];
      return `[${date}] (${m.kind}) ${m.summary}`;
    });

    return `## Relevant Context from Memory\n\n${lines.join("\n")}\n`;
  }

  /** Add a relationship between memories */
  addEdge(sourceId: string, targetId: string, relation: string, strength = 1.0): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO knowledge_graph (source_id, target_id, relation, strength, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(sourceId, targetId, relation, strength, Date.now());
  }

  /** Get related memories via knowledge graph */
  getRelated(memoryId: string): CortexMemory[] {
    const edges = this.db
      .prepare(
        "SELECT target_id FROM knowledge_graph WHERE source_id = ? UNION SELECT source_id FROM knowledge_graph WHERE target_id = ?",
      )
      .all(memoryId, memoryId) as any[];

    const ids = [...new Set(edges.map((e) => e.target_id ?? e.source_id))];
    const results: CortexMemory[] = [];

    for (const id of ids) {
      const mem = this.getMemory(id);
      if (mem) {
        results.push(mem);
      }
    }

    return results;
  }

  /** Get knowledge graph edges */
  getEdges(limit = 100): KnowledgeEdge[] {
    const rows = this.db
      .prepare("SELECT * FROM knowledge_graph ORDER BY created_at DESC LIMIT ?")
      .all(limit) as any[];

    return rows.map((r) => ({
      sourceId: r.source_id,
      targetId: r.target_id,
      relation: r.relation,
      strength: r.strength,
    }));
  }

  /** Statistics */
  stats(): CortexStats {
    const memCount = (this.db.prepare("SELECT COUNT(*) as c FROM memories").get() as any).c;
    const nodeCount = (
      this.db
        .prepare(
          "SELECT COUNT(DISTINCT source_id) + COUNT(DISTINCT target_id) as c FROM knowledge_graph",
        )
        .get() as any
    ).c;
    const edgeCount = (this.db.prepare("SELECT COUNT(*) as c FROM knowledge_graph").get() as any).c;

    const dbPath = (this.db as any).name ?? "";
    let dbSize = 0;
    try {
      dbSize = fs.statSync(dbPath).size;
    } catch {
      // DB path not accessible, skip
    }

    return {
      totalMemories: memCount,
      totalQueries: this.totalQueries,
      graphNodes: nodeCount,
      graphEdges: edgeCount,
      dbSizeBytes: dbSize,
    };
  }

  /** Close the database */
  close(): void {
    this.db.close();
  }

  // ─── Private helpers ───────────────────────────────────

  private rowToMemory(row: any): CortexMemory {
    return {
      id: row.id,
      kind: row.kind,
      content: row.content,
      summary: row.summary,
      tags: JSON.parse(row.tags),
      source: row.source,
      importance: row.importance,
      accessCount: row.access_count,
      createdAt: row.created_at,
      lastAccessed: row.last_accessed,
    };
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2);
  }

  private embed(text: string): number[] {
    const tokens = this.tokenize(text);
    const vec = new Array(EMBEDDING_DIMS).fill(0);

    for (let i = 0; i < tokens.length; i++) {
      const hash = crypto.createHash("md5").update(tokens[i]).digest();
      for (let j = 0; j < 4; j++) {
        const dim = hash.readUInt8(j) % EMBEDDING_DIMS;
        vec[dim] += 1 / (1 + Math.log(i + 1));
      }
    }

    const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    if (mag > 0) {
      for (let i = 0; i < vec.length; i++) {
        vec[i] /= mag;
      }
    }

    return vec;
  }

  private cosineSim(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      return 0;
    }
    let dot = 0,
      magA = 0,
      magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    magA = Math.sqrt(magA);
    magB = Math.sqrt(magB);
    return magA === 0 || magB === 0 ? 0 : dot / (magA * magB);
  }

  private summarize(content: string, maxLen = 120): string {
    const first = content.match(/^[^.!?]+[.!?]/);
    if (first && first[0].length <= maxLen) {
      return first[0].trim();
    }
    if (content.length <= maxLen) {
      return content;
    }
    return content.slice(0, maxLen - 3).trim() + "...";
  }

  private extractTags(content: string): string[] {
    const tags: string[] = [];
    const hashtags = content.match(/#\w+/g);
    if (hashtags) {
      tags.push(...hashtags.map((t) => t.slice(1).toLowerCase()));
    }

    if (/\b(meeting|call|discussion)\b/i.test(content)) {
      tags.push("meeting");
    }
    if (/\b(task|todo|action)\b/i.test(content)) {
      tags.push("task");
    }
    if (/\b(decision|decided|agreed)\b/i.test(content)) {
      tags.push("decision");
    }
    if (/\b(bug|error|issue|problem)\b/i.test(content)) {
      tags.push("issue");
    }
    if (/\b(code|function|api|database)\b/i.test(content)) {
      tags.push("technical");
    }

    return [...new Set(tags)];
  }

  private scoreImportance(content: string, kind: string): number {
    let score = 0.5;
    if (kind === "decision") {
      score += 0.2;
    }
    if (kind === "task") {
      score += 0.1;
    }
    if (kind === "preference") {
      score += 0.15;
    }
    if (/\b(important|critical|urgent|must)\b/i.test(content)) {
      score += 0.2;
    }
    if (/\b(remember|don't forget|note)\b/i.test(content)) {
      score += 0.1;
    }
    score += Math.min(0.1, content.length / 5000);
    return Math.min(1, score);
  }

  private extractAndLinkEntities(memoryId: string, content: string): void {
    const entities: string[] = [];

    // Named entities (capitalized words)
    const names = content.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g);
    if (names) {
      const skip = new Set([
        "The",
        "This",
        "That",
        "What",
        "When",
        "Where",
        "How",
        "They",
        "There",
      ]);
      for (const name of names) {
        if (name.length > 2 && !skip.has(name)) {
          entities.push(name);
        }
      }
    }

    // Link co-occurring entities
    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length && j < i + 5; j++) {
        const edgeId = `entity_${crypto.createHash("md5").update(entities[i]).digest("hex").slice(0, 8)}`;
        const targetId = `entity_${crypto.createHash("md5").update(entities[j]).digest("hex").slice(0, 8)}`;

        this.db
          .prepare(
            `INSERT OR REPLACE INTO knowledge_graph (source_id, target_id, relation, strength, created_at)
             VALUES (?, ?, 'co-occurs', 1.0, ?)`,
          )
          .run(edgeId, targetId, Date.now());
      }
    }
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

  /** CORTEX persistent memory — available after initialize() */
  cortex: Cortex | null = null;

  /** EVOLVE: self-evolution engine — available after initialize() */
  selfEvolver: SelfEvolver | null = null;

  /** DELTA: performance improvement evaluator — available after initialize() */
  deltaEvaluator: DeltaEvaluator | null = null;

  /** SAFETY: adaptive safety boundary manager — available after initialize() */
  adaptiveSafety: AdaptiveSafetyManager | null = null;

  /** META-COGNITIVE: self-awareness loop — available after initialize() */
  metacognitive: MetaCognitiveEngine | null = null;

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
    if (this.initialized) {
      return;
    }

    // Initialize audit DB — validated against path injection (CVSS 8.1)
    const dbPath = resolveAndValidateDbPath(
      this.config.dbPath,
      this.config.stateDir,
      "skynet-audit.db",
      "skynet-audit",
    );

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

    // Initialize CORTEX persistent memory
    this.cortex = new Cortex(this.config.stateDir);
    const cortexStats = this.cortex.stats();
    console.log(
      `[SKYNET] CORTEX initialized — ${cortexStats.totalMemories} memories, ${cortexStats.graphNodes} graph nodes`,
    );

    // Initialize EVOLVE: self-evolution engine
    this.selfEvolver = new SelfEvolver({ stateDir: this.config.stateDir });
    await this.selfEvolver.initialize();
    console.log("[SKYNET] EVOLVE initialized — self-evolution with PR governance active");

    // Initialize META-COGNITIVE self-awareness loop
    this.metacognitive = new MetaCognitiveEngine(60_000);
    this.metacognitive.onAnomaly = (anomaly) => {
      this.oracle.recordPattern(`anomaly:${anomaly.type}`);
      console.log(
        `[SKYNET:META] Anomaly detected: ${anomaly.type} (${anomaly.value.toFixed(2)} > ${anomaly.threshold})`,
      );
    };
    this.metacognitive.onReport = (report) => {
      if (report.anomalies.length > 0) {
        this.oracle.recordPattern(`meta:anomalies_in_cycle:${report.cycleCount}`);
      }
      if (report.adaptationApplied) {
        this.oracle.recordPattern("meta:adaptation_applied");
      }
    };
    this.metacognitive.start();
    console.log("[SKYNET] META-COGNITIVE initialized — self-awareness loop active (60s cycle)");

    // Initialize DELTA evaluator — measures improvement over time
    this.deltaEvaluator = new DeltaEvaluator(this.config.stateDir);
    console.log("[SKYNET] DELTA evaluator initialized — performance improvement tracking active");

    // Initialize ADAPTIVE SAFETY — dynamic threshold adjustment
    this.adaptiveSafety = new AdaptiveSafetyManager(this.config.stateDir);
    // Seed default adaptive constraints from current ThresholdEnforcer config
    const tc = this.config.thresholds ?? {
      maxContextChars: 400_000,
      maxConcurrentAgents: 10,
      maxToolCallsPerTurn: 50,
      maxMemoryMB: 8_192,
      dailySpendLimit: 100,
      perAgentLimit: 25,
      requireApprovalAbove: 50,
    };
    // Only add constraints if they don't already exist (persisted state takes precedence)
    if (!this.adaptiveSafety.getConstraint("memory_mb")) {
      this.adaptiveSafety.addConstraint({
        name: "memory_mb",
        type: "ADAPTIVE",
        threshold: tc.maxMemoryMB,
        adaptivityRate: 0.1,
        minThreshold: tc.maxMemoryMB * 0.5,
        maxThreshold: tc.maxMemoryMB * 1.5,
      });
    }
    if (!this.adaptiveSafety.getConstraint("context_chars")) {
      this.adaptiveSafety.addConstraint({
        name: "context_chars",
        type: "SOFT",
        threshold: tc.maxContextChars,
        adaptivityRate: 0.05,
        minThreshold: tc.maxContextChars * 0.6,
        maxThreshold: tc.maxContextChars * 1.2,
      });
    }
    if (!this.adaptiveSafety.getConstraint("daily_spend")) {
      this.adaptiveSafety.addConstraint({
        name: "daily_spend",
        type: "HARD",
        threshold: tc.dailySpendLimit,
        adaptivityRate: 0,
        minThreshold: tc.dailySpendLimit,
        maxThreshold: tc.dailySpendLimit,
      });
    }
    console.log("[SKYNET] ADAPTIVE SAFETY initialized — dynamic boundary management active");

    // Start PULSE heartbeat
    this.pulse.start(() => {
      this.onPulse();
    });

    this.initialized = true;
    this.emit("initialized");
    console.log(
      "[SKYNET] All waves initialized — PULSE, SENTINEL, ORACLE, CORTEX, EVOLVE, META-COGNITIVE, DELTA, ADAPTIVE-SAFETY, GOVERNANCE active",
    );
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

    // Adaptive safety: feed system-level metrics and run adaptation
    // SECURITY: Only system-observable metrics (memory, error rate) are fed.
    // Agent-reported metrics (tokensUsed, estimatedCost) are NOT used for
    // safety scoring to prevent manipulation via metrics gaming (CVSS 7.2).
    if (this.adaptiveSafety) {
      this.adaptiveSafety.updateValue("memory_mb", metrics.memoryUsageMB, "system");
      // Compute stress from error rate + memory pressure (system-observable only)
      const stressLevel = Math.min(
        metrics.errorRate + (metrics.memoryUsageMB / (this.config.thresholds?.maxMemoryMB ?? 8_192)),
        1,
      );
      const adaptations = this.adaptiveSafety.adapt(stressLevel);
      if (adaptations.length > 0) {
        this.oracle.recordPattern(`safety:adapted:${adaptations.map((a) => a.constraintName).join(",")}`);
      }
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

  /** DELTA: evaluate improvement between current and previous run data */
  evaluateDelta(current: RunData, previous: RunData, context?: string): DeltaResult | null {
    if (!this.deltaEvaluator) return null;
    const result = this.deltaEvaluator.evaluate(current, previous, context);
    // Feed trend into Oracle
    const trend = this.deltaEvaluator.trend();
    if (trend.improving) {
      this.oracle.recordPattern("delta:improving");
    } else if (trend.avgDelta < -0.1) {
      this.oracle.recordPattern("delta:degrading");
      this.oracle.recordMistake(`Performance degrading: avg delta ${trend.avgDelta.toFixed(4)}`);
    }
    return result;
  }

  /** DELTA: get performance trend from recent evaluations */
  getDeltaTrend(n = 10): { improving: boolean; avgDelta: number } {
    return this.deltaEvaluator?.trend(n) ?? { improving: false, avgDelta: 0 };
  }

  /** SAFETY: score risk for an action */
  scoreActionRisk(action: string, context: Record<string, unknown> = {}): RiskScore | null {
    return this.adaptiveSafety?.scoreAction(action, context) ?? null;
  }

  /** SAFETY: get current safety snapshot */
  safetySnapshot(): SafetySnapshot | null {
    return this.adaptiveSafety?.snapshot() ?? null;
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

  /** Trigger a self-evolution cycle: detect opportunities from Oracle data */
  async triggerSelfEvolution(): Promise<{
    opportunities: EvolutionOpportunity[];
    stats: SelfEvolveStats;
  }> {
    if (!this.selfEvolver) {
      throw new Error("[SKYNET] SelfEvolver not initialized");
    }

    // Gather Oracle data
    const insights = this.oracle.getInsights();
    const mistakes = this.oracle.getMistakes().map((m) => ({
      pattern: m,
      rootCause: "Detected by Oracle",
      correction: "Review and fix",
      severity: "low" as const,
    }));

    // Detect opportunities
    const opportunities = this.selfEvolver.detectOpportunities(insights, mistakes);

    return {
      opportunities,
      stats: this.selfEvolver.getStats(),
    };
  }

  /** Full status report */
  status(): {
    pulse: PulseStatus;
    sentinel: SentinelMetrics;
    oracle: OracleInsight[];
    cortex: CortexStats | null;
    selfEvolve: SelfEvolveStats | null;
    metacognitive: ReturnType<MetaCognitiveEngine["status"]> | null;
    violations: ThresholdViolation[];
    decisions: GovernanceDecision[];
    deltaTrend: { improving: boolean; avgDelta: number };
    safety: SafetySnapshot | null;
  } {
    return {
      pulse: this.pulse.status(),
      sentinel: this.sentinel.metrics(),
      oracle: this.oracle.getInsights(),
      cortex: this.cortex?.stats() ?? null,
      selfEvolve: this.selfEvolver?.getStats() ?? null,
      metacognitive: this.metacognitive?.status() ?? null,
      violations: this.thresholds.getViolations(),
      decisions: this.governance.getDecisions(),
      deltaTrend: this.deltaEvaluator?.trend() ?? { improving: false, avgDelta: 0 },
      safety: this.adaptiveSafety?.snapshot() ?? null,
    };
  }

  /** Shutdown cleanly */
  shutdown(): void {
    this.pulse.stop();
    if (this.metacognitive) {
      this.metacognitive.stop();
      this.metacognitive = null;
    }
    if (this.selfEvolver) {
      this.selfEvolver.shutdown().catch(() => {});
      this.selfEvolver = null;
    }
    if (this.cortex) {
      this.cortex.close();
      this.cortex = null;
    }
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
