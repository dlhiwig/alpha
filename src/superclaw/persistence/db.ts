/**
 * SuperClaw Persistence Layer
 * SQLite-based storage for swarm runs, patterns, costs, and trajectories
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';

// Types
export interface SwarmRun {
  id: string;
  task: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  config?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
}

export interface AgentExecution {
  id: string;
  runId: string;
  agentType: string;
  task: string;
  model?: string;
  tier?: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: Record<string, unknown>;
  error?: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs?: number;
  createdAt: number;
  completedAt?: number;
}

export interface SonaPattern {
  id: number;
  patternHash: string;
  patternType: string;
  patternName: string;
  embedding?: number[];
  successCount: number;
  failureCount: number;
  avgQuality: number;
  lastUsedAt?: number;
  createdAt: number;
}

export interface CostDaily {
  date: string;
  tier1Count: number;
  tier2Count: number;
  tier3Count: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  estimatedSavingsUsd: number;
}

export interface Trajectory {
  id: string;
  runId?: string;
  taskHash: string;
  embedding?: number[];
  steps?: unknown[];
  outcome?: 'success' | 'failure' | 'partial';
  qualityScore?: number;
  learned: boolean;
  createdAt: number;
}

export interface RoutingDecision {
  id: number;
  runId?: string;
  taskPreview: string;
  complexityScore: number;
  selectedTier: number;
  reason: string;
  wasCorrect?: boolean;
  createdAt: number;
}

/**
 * Database wrapper for SuperClaw persistence
 */
export class SuperClawDB {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const path = dbPath || join(process.cwd(), 'data', 'superclaw.db');
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.ensureSchema();
  }

  private ensureSchema(): void {
    // Check if tables exist
    const tables = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='swarm_runs'"
    ).get();
    
    if (!tables) {
      // Apply schema
      const schemaPath = join(__dirname, 'schema.sql');
      if (existsSync(schemaPath)) {
        const schema = readFileSync(schemaPath, 'utf-8');
        this.db.exec(schema);
      } else {
        // Inline minimal schema if file not found (for tests)
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS swarm_runs (
            id TEXT PRIMARY KEY, task TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
            config_json TEXT, result_json TEXT, error TEXT,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            started_at INTEGER, completed_at INTEGER, duration_ms INTEGER
          );
          CREATE TABLE IF NOT EXISTS agent_executions (
            id TEXT PRIMARY KEY, run_id TEXT NOT NULL, agent_type TEXT NOT NULL, task TEXT NOT NULL,
            model TEXT, tier INTEGER, status TEXT NOT NULL DEFAULT 'pending',
            result_json TEXT, error TEXT, input_tokens INTEGER DEFAULT 0,
            output_tokens INTEGER DEFAULT 0, cost_usd REAL DEFAULT 0, latency_ms INTEGER,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')), completed_at INTEGER
          );
          CREATE TABLE IF NOT EXISTS sona_patterns (
            id INTEGER PRIMARY KEY AUTOINCREMENT, pattern_hash TEXT UNIQUE NOT NULL,
            pattern_type TEXT NOT NULL, pattern_name TEXT NOT NULL, embedding_json TEXT,
            success_count INTEGER DEFAULT 0, failure_count INTEGER DEFAULT 0, avg_quality REAL DEFAULT 0,
            last_used_at INTEGER, created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
          );
          CREATE TABLE IF NOT EXISTS cost_daily (
            date TEXT PRIMARY KEY, tier1_count INTEGER DEFAULT 0, tier2_count INTEGER DEFAULT 0,
            tier3_count INTEGER DEFAULT 0, total_input_tokens INTEGER DEFAULT 0,
            total_output_tokens INTEGER DEFAULT 0, total_cost_usd REAL DEFAULT 0,
            estimated_savings_usd REAL DEFAULT 0
          );
          CREATE TABLE IF NOT EXISTS trajectories (
            id TEXT PRIMARY KEY, run_id TEXT, task_hash TEXT NOT NULL, embedding_json TEXT,
            steps_json TEXT, outcome TEXT, quality_score REAL, learned INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
          );
          CREATE TABLE IF NOT EXISTS routing_decisions (
            id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT, task_preview TEXT,
            complexity_score REAL, selected_tier INTEGER, reason TEXT, was_correct INTEGER,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
          );
        `);
      }
    }
  }

  // === Swarm Runs ===

  createRun(task: string, config?: Record<string, unknown>): SwarmRun {
    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    
    this.db.prepare(`
      INSERT INTO swarm_runs (id, task, status, config_json, created_at)
      VALUES (?, ?, 'pending', ?, ?)
    `).run(id, task, config ? JSON.stringify(config) : null, now);

    return { id, task, status: 'pending', config, createdAt: now };
  }

  getRun(id: string): SwarmRun | null {
    const row = this.db.prepare('SELECT * FROM swarm_runs WHERE id = ?').get(id) as any;
    if (!row) {return null;}
    return this.mapRun(row);
  }

  updateRunStatus(id: string, status: SwarmRun['status'], extra?: { 
    result?: Record<string, unknown>; 
    error?: string;
  }): void {
    const now = Math.floor(Date.now() / 1000);
    const run = this.getRun(id);
    if (!run) {return;}

    const updates: string[] = ['status = ?'];
    const params: unknown[] = [status];

    if (status === 'running' && !run.startedAt) {
      updates.push('started_at = ?');
      params.push(now);
    }

    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      updates.push('completed_at = ?');
      params.push(now);
      if (run.startedAt) {
        updates.push('duration_ms = ?');
        params.push((now - run.startedAt) * 1000);
      }
    }

    if (extra?.result) {
      updates.push('result_json = ?');
      params.push(JSON.stringify(extra.result));
    }

    if (extra?.error) {
      updates.push('error = ?');
      params.push(extra.error);
    }

    params.push(id);
    this.db.prepare(`UPDATE swarm_runs SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  listRuns(opts?: { status?: string; limit?: number }): SwarmRun[] {
    let sql = 'SELECT * FROM swarm_runs';
    const params: unknown[] = [];
    
    if (opts?.status) {
      sql += ' WHERE status = ?';
      params.push(opts.status);
    }
    
    sql += ' ORDER BY created_at DESC';
    
    if (opts?.limit) {
      sql += ' LIMIT ?';
      params.push(opts.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(r => this.mapRun(r));
  }

  private mapRun(row: any): SwarmRun {
    return {
      id: row.id,
      task: row.task,
      status: row.status,
      config: row.config_json ? JSON.parse(row.config_json) : undefined,
      result: row.result_json ? JSON.parse(row.result_json) : undefined,
      error: row.error || undefined,
      createdAt: row.created_at,
      startedAt: row.started_at || undefined,
      completedAt: row.completed_at || undefined,
      durationMs: row.duration_ms || undefined,
    };
  }

  // === Agent Executions ===

  createExecution(runId: string, agentType: string, task: string): AgentExecution {
    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    
    this.db.prepare(`
      INSERT INTO agent_executions (id, run_id, agent_type, task, status, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `).run(id, runId, agentType, task, now);

    return {
      id, runId, agentType, task, status: 'pending',
      inputTokens: 0, outputTokens: 0, costUsd: 0, createdAt: now
    };
  }

  completeExecution(id: string, data: {
    model?: string;
    tier?: number;
    status: 'completed' | 'failed';
    result?: Record<string, unknown>;
    error?: string;
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
    latencyMs?: number;
  }): void {
    const now = Math.floor(Date.now() / 1000);
    
    this.db.prepare(`
      UPDATE agent_executions SET
        model = ?, tier = ?, status = ?, result_json = ?, error = ?,
        input_tokens = ?, output_tokens = ?, cost_usd = ?, latency_ms = ?,
        completed_at = ?
      WHERE id = ?
    `).run(
      data.model || null,
      data.tier || null,
      data.status,
      data.result ? JSON.stringify(data.result) : null,
      data.error || null,
      data.inputTokens || 0,
      data.outputTokens || 0,
      data.costUsd || 0,
      data.latencyMs || null,
      now,
      id
    );
  }

  getExecutionsForRun(runId: string): AgentExecution[] {
    const rows = this.db.prepare(
      'SELECT * FROM agent_executions WHERE run_id = ? ORDER BY created_at'
    ).all(runId) as any[];
    
    return rows.map(row => ({
      id: row.id,
      runId: row.run_id,
      agentType: row.agent_type,
      task: row.task,
      model: row.model || undefined,
      tier: row.tier || undefined,
      status: row.status,
      result: row.result_json ? JSON.parse(row.result_json) : undefined,
      error: row.error || undefined,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      costUsd: row.cost_usd,
      latencyMs: row.latency_ms || undefined,
      createdAt: row.created_at,
      completedAt: row.completed_at || undefined,
    }));
  }

  // === Cost Tracking ===

  recordCost(tier: number, inputTokens: number, outputTokens: number, costUsd: number, savingsUsd: number = 0): void {
    const date = new Date().toISOString().split('T')[0];
    const tierCol = `tier${tier}_count`;
    
    this.db.prepare(`
      INSERT INTO cost_daily (date, ${tierCol}, total_input_tokens, total_output_tokens, total_cost_usd, estimated_savings_usd)
      VALUES (?, 1, ?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        ${tierCol} = ${tierCol} + 1,
        total_input_tokens = total_input_tokens + ?,
        total_output_tokens = total_output_tokens + ?,
        total_cost_usd = total_cost_usd + ?,
        estimated_savings_usd = estimated_savings_usd + ?
    `).run(date, inputTokens, outputTokens, costUsd, savingsUsd, inputTokens, outputTokens, costUsd, savingsUsd);
  }

  getCostSummary(days: number = 30): { daily: CostDaily[]; total: CostDaily } {
    const rows = this.db.prepare(`
      SELECT * FROM cost_daily 
      WHERE date >= date('now', '-' || ? || ' days')
      ORDER BY date DESC
    `).all(days) as any[];

    const daily = rows.map(r => ({
      date: r.date,
      tier1Count: r.tier1_count,
      tier2Count: r.tier2_count,
      tier3Count: r.tier3_count,
      totalInputTokens: r.total_input_tokens,
      totalOutputTokens: r.total_output_tokens,
      totalCostUsd: r.total_cost_usd,
      estimatedSavingsUsd: r.estimated_savings_usd,
    }));

    const total = daily.reduce((acc, d) => ({
      date: 'total',
      tier1Count: acc.tier1Count + d.tier1Count,
      tier2Count: acc.tier2Count + d.tier2Count,
      tier3Count: acc.tier3Count + d.tier3Count,
      totalInputTokens: acc.totalInputTokens + d.totalInputTokens,
      totalOutputTokens: acc.totalOutputTokens + d.totalOutputTokens,
      totalCostUsd: acc.totalCostUsd + d.totalCostUsd,
      estimatedSavingsUsd: acc.estimatedSavingsUsd + d.estimatedSavingsUsd,
    }), {
      date: 'total', tier1Count: 0, tier2Count: 0, tier3Count: 0,
      totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0, estimatedSavingsUsd: 0
    });

    return { daily, total };
  }

  // === SONA Patterns ===

  upsertPattern(pattern: Omit<SonaPattern, 'id' | 'createdAt'>): void {
    const now = Math.floor(Date.now() / 1000);
    
    this.db.prepare(`
      INSERT INTO sona_patterns (pattern_hash, pattern_type, pattern_name, embedding_json, success_count, failure_count, avg_quality, last_used_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pattern_hash) DO UPDATE SET
        success_count = success_count + ?,
        failure_count = failure_count + ?,
        avg_quality = (avg_quality * (success_count + failure_count) + ? * ?) / (success_count + failure_count + ? + ?),
        last_used_at = ?
    `).run(
      pattern.patternHash,
      pattern.patternType,
      pattern.patternName,
      pattern.embedding ? JSON.stringify(pattern.embedding) : null,
      pattern.successCount,
      pattern.failureCount,
      pattern.avgQuality,
      now,
      now,
      pattern.successCount,
      pattern.failureCount,
      pattern.avgQuality,
      pattern.successCount + pattern.failureCount,
      pattern.successCount,
      pattern.failureCount,
      now
    );
  }

  getTopPatterns(type?: string, limit: number = 10): SonaPattern[] {
    let sql = 'SELECT * FROM sona_patterns';
    const params: unknown[] = [];
    
    if (type) {
      sql += ' WHERE pattern_type = ?';
      params.push(type);
    }
    
    sql += ' ORDER BY success_count DESC, avg_quality DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(r => ({
      id: r.id,
      patternHash: r.pattern_hash,
      patternType: r.pattern_type,
      patternName: r.pattern_name,
      embedding: r.embedding_json ? JSON.parse(r.embedding_json) : undefined,
      successCount: r.success_count,
      failureCount: r.failure_count,
      avgQuality: r.avg_quality,
      lastUsedAt: r.last_used_at || undefined,
      createdAt: r.created_at,
    }));
  }

  // === Trajectories ===

  saveTrajectory(traj: Omit<Trajectory, 'createdAt'>): void {
    const now = Math.floor(Date.now() / 1000);
    
    this.db.prepare(`
      INSERT INTO trajectories (id, run_id, task_hash, embedding_json, steps_json, outcome, quality_score, learned, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      traj.id,
      traj.runId || null,
      traj.taskHash,
      traj.embedding ? JSON.stringify(traj.embedding) : null,
      traj.steps ? JSON.stringify(traj.steps) : null,
      traj.outcome || null,
      traj.qualityScore || null,
      traj.learned ? 1 : 0,
      now
    );
  }

  getUnlearnedTrajectories(limit: number = 100): Trajectory[] {
    const rows = this.db.prepare(`
      SELECT * FROM trajectories WHERE learned = 0 ORDER BY created_at LIMIT ?
    `).all(limit) as any[];
    
    return rows.map(r => ({
      id: r.id,
      runId: r.run_id || undefined,
      taskHash: r.task_hash,
      embedding: r.embedding_json ? JSON.parse(r.embedding_json) : undefined,
      steps: r.steps_json ? JSON.parse(r.steps_json) : undefined,
      outcome: r.outcome || undefined,
      qualityScore: r.quality_score || undefined,
      learned: !!r.learned,
      createdAt: r.created_at,
    }));
  }

  markTrajectoriesLearned(ids: string[]): void {
    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(`UPDATE trajectories SET learned = 1 WHERE id IN (${placeholders})`).run(...ids);
  }

  // === Routing Decisions ===

  recordRoutingDecision(decision: Omit<RoutingDecision, 'id' | 'createdAt'>): number {
    const now = Math.floor(Date.now() / 1000);
    
    const result = this.db.prepare(`
      INSERT INTO routing_decisions (run_id, task_preview, complexity_score, selected_tier, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      decision.runId || null,
      decision.taskPreview,
      decision.complexityScore,
      decision.selectedTier,
      decision.reason,
      now
    );

    return result.lastInsertRowid as number;
  }

  evaluateRoutingDecision(id: number, wasCorrect: boolean): void {
    this.db.prepare('UPDATE routing_decisions SET was_correct = ? WHERE id = ?').run(wasCorrect ? 1 : 0, id);
  }

  getRoutingAccuracy(): { total: number; correct: number; accuracy: number } {
    const row = this.db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN was_correct = 1 THEN 1 ELSE 0 END) as correct
      FROM routing_decisions WHERE was_correct IS NOT NULL
    `).get() as any;

    return {
      total: row.total || 0,
      correct: row.correct || 0,
      accuracy: row.total ? (row.correct / row.total) : 0,
    };
  }

  // === Utilities ===

  close(): void {
    this.db.close();
  }

  getStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    
    for (const table of ['swarm_runs', 'agent_executions', 'sona_patterns', 'trajectories', 'routing_decisions', 'cost_daily']) {
      const row = this.db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as any;
      stats[table] = row.count;
    }

    return stats;
  }
}

// Singleton instance
let instance: SuperClawDB | null = null;

export function getDB(dbPath?: string): SuperClawDB {
  if (!instance) {
    instance = new SuperClawDB(dbPath);
  }
  return instance;
}

export function closeDB(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
