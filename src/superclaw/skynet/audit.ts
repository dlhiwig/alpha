/**
 * 🦊 SKYNET AUDIT TRAIL — TrustClaw-Style Compliance & Security
 * 
 * Wave 9: AUDIT
 * Comprehensive audit trail system for compliance, security, and debugging.
 * Inspired by TrustClaw's audit capabilities but enhanced for multi-agent environments.
 * 
 * Features:
 * - Auto-logging of all tool executions
 * - Auto-logging of all agent spawns
 * - Auto-logging of all cost events
 * - Persistent storage (SQLite + JSON backup)
 * - Rich query API with filters
 * - Export capabilities (JSON, CSV, Parquet)
 * - SKYNET SENTINEL integration
 * - Real-time streaming for live monitoring
 * - Privacy-safe parameter sanitization
 */

import fs from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';
import Database from 'better-sqlite3';
import { createWriteStream, WriteStream } from 'fs';
import crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════
// TYPES & INTERFACES
// ═══════════════════════════════════════════════════════════════

export interface AuditLog {
  id: string;
  timestamp: Date;
  sessionId: string;
  agentId: string;
  action: 'tool_call' | 'agent_spawn' | 'cost_event' | 'auth' | 'error' | 'system' | 'security';
  tool?: string;
  params?: any;  // Sanitized, no secrets
  result: 'success' | 'failure' | 'timeout' | 'pending';
  tokenUsage?: { input: number; output: number };
  costUsd?: number;
  durationMs: number;
  metadata?: Record<string, any>;
  errorMessage?: string;
  stackTrace?: string;
  parentLogId?: string;  // For hierarchical logging
  severity?: 'low' | 'medium' | 'high' | 'critical';
  tags?: string[];
}

export interface AuditAction {
  sessionId: string;
  agentId: string;
  action: AuditLog['action'];
  tool?: string;
  params?: any;
  result: AuditLog['result'];
  tokenUsage?: { input: number; output: number };
  costUsd?: number;
  durationMs: number;
  metadata?: Record<string, any>;
  errorMessage?: string;
  stackTrace?: string;
  parentLogId?: string;
  severity?: AuditLog['severity'];
  tags?: string[];
}

export interface AuditFilters {
  sessionId?: string;
  agentId?: string;
  action?: AuditLog['action'] | AuditLog['action'][];
  tool?: string;
  result?: AuditLog['result'] | AuditLog['result'][];
  dateFrom?: Date;
  dateTo?: Date;
  severity?: AuditLog['severity'] | AuditLog['severity'][];
  tags?: string[];
  costThreshold?: number;
  durationThreshold?: number;
  limit?: number;
  offset?: number;
  orderBy?: 'timestamp' | 'cost' | 'duration';
  orderDir?: 'asc' | 'desc';
  includeMetadata?: boolean;
}

export interface AuditStats {
  totalLogs: number;
  logsByAction: Record<string, number>;
  logsByResult: Record<string, number>;
  totalCost: number;
  averageDuration: number;
  errorRate: number;
  topAgents: Array<{ agentId: string; count: number; cost: number }>;
  topTools: Array<{ tool: string; count: number; avgDuration: number }>;
  recentErrors: AuditLog[];
  dailyStats: Array<{ date: string; count: number; cost: number }>;
}

export interface AuditConfig {
  enabled: boolean;
  dbPath?: string;
  jsonBackupPath?: string;
  maxLogsInMemory?: number;
  batchWriteSize?: number;
  enableRealTimeStream?: boolean;
  sanitizeSensitiveData?: boolean;
  retentionDays?: number;
  compressionEnabled?: boolean;
  alertOnHighSeverity?: boolean;
  notificationChannels?: string[];
}

// ═══════════════════════════════════════════════════════════════
// SENSITIVE DATA SANITIZER
// ═══════════════════════════════════════════════════════════════

class DataSanitizer {
  private static readonly SENSITIVE_KEYS = [
    'password', 'token', 'key', 'secret', 'auth', 'credential',
    'api_key', 'apikey', 'access_token', 'refresh_token',
    'private_key', 'ssh_key', 'cert', 'certificate',
    'authorization', 'bearer', 'oauth', 'jwt'
  ];

  private static readonly SENSITIVE_PATTERNS = [
    /sk-[a-zA-Z0-9]{16,}/g,  // OpenAI/Anthropic API keys (reduced min length)
    /sk-ant-api03-[a-zA-Z0-9_-]+/g, // Anthropic API keys
    /sk-proj-[a-zA-Z0-9_-]+/g, // OpenAI project keys
    /ghp_[a-zA-Z0-9]{36}/g,   // GitHub personal access tokens
    /ghp_[a-zA-Z0-9]{12,}/g,  // GitHub tokens (shorter variants)
    /xoxb-[a-zA-Z0-9-]{50,}/g, // Slack bot tokens
    /ya29\.[a-zA-Z0-9\-_.~]{50,}/g, // Google OAuth tokens
    /AKIA[0-9A-Z]{16}/g,      // AWS access keys
    /[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{4}/g, // Credit cards
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, // Emails (optional)
  ];

  static sanitize(obj: any, depth = 0): any {
    if (depth > 10) return '[MAX_DEPTH]'; // Prevent infinite recursion
    
    if (obj === null || obj === undefined) return obj;
    
    if (typeof obj === 'string') {
      return this.sanitizeString(obj);
    }
    
    if (typeof obj === 'object') {
      if (Array.isArray(obj)) {
        return obj.map(item => this.sanitize(item, depth + 1));
      }
      
      const sanitized: any = {};
      for (const [key, value] of Object.entries(obj)) {
        if (this.isSensitiveKey(key)) {
          sanitized[key] = '[REDACTED]';
        } else {
          sanitized[key] = this.sanitize(value, depth + 1);
        }
      }
      return sanitized;
    }
    
    return obj;
  }

  private static isSensitiveKey(key: string): boolean {
    const lowerKey = key.toLowerCase();
    return this.SENSITIVE_KEYS.some(sensitiveKey => 
      lowerKey.includes(sensitiveKey)
    );
  }

  private static sanitizeString(str: string): string {
    let sanitized = str;
    for (const pattern of this.SENSITIVE_PATTERNS) {
      sanitized = sanitized.replace(pattern, '[REDACTED]');
    }
    return sanitized;
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN AUDIT TRAIL CLASS
// ═══════════════════════════════════════════════════════════════

export class AuditTrail extends EventEmitter {
  private db: Database.Database | null = null;
  private config: Required<AuditConfig>;
  private jsonStream: WriteStream | null = null;
  private batchBuffer: AuditLog[] = [];
  private stats: Partial<AuditStats> = {};
  private retentionCleanupTimer: NodeJS.Timeout | null = null;

  // @ts-expect-error - Post-Merge Reconciliation
  constructor(config: AuditConfig = {}) {
    super();
    
    this.config = {
      enabled: config.enabled ?? true,
      dbPath: config.dbPath ?? path.join(process.cwd(), 'data', 'audit-trail.db'),
      jsonBackupPath: config.jsonBackupPath ?? path.join(process.cwd(), 'data', 'audit-trail.jsonl'),
      maxLogsInMemory: config.maxLogsInMemory ?? 10000,
      batchWriteSize: config.batchWriteSize ?? 100,
      enableRealTimeStream: config.enableRealTimeStream ?? true,
      sanitizeSensitiveData: config.sanitizeSensitiveData ?? true,
      retentionDays: config.retentionDays ?? 365,
      compressionEnabled: config.compressionEnabled ?? true,
      alertOnHighSeverity: config.alertOnHighSeverity ?? true,
      notificationChannels: config.notificationChannels ?? []
    };

    this.initialize();
  }

  // ═══════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════

  private async initialize(): Promise<void> {
    if (!this.config.enabled) return;

    try {
      // Ensure data directory exists
      await fs.mkdir(path.dirname(this.config.dbPath), { recursive: true });

      // Initialize SQLite database
      this.db = new Database(this.config.dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
      this.db.pragma('cache_size = 10000');

      // Create tables
      this.createTables();
      
      // Initialize JSON backup stream
      if (this.config.jsonBackupPath) {
        this.jsonStream = createWriteStream(this.config.jsonBackupPath, { flags: 'a' });
      }

      // Start retention cleanup timer (daily)
      this.retentionCleanupTimer = setInterval(() => {
        this.cleanupOldLogs();
      }, 24 * 60 * 60 * 1000);

      this.emit('initialized');
      console.log('🦊 AUDIT TRAIL initialized successfully');
    } catch (error: unknown) {
      console.error('Failed to initialize audit trail:', error);
      this.emit('error', error);
    }
  }

  private createTables(): void {
    if (!this.db) return;

    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        action TEXT NOT NULL,
        tool TEXT,
        params TEXT,
        result TEXT NOT NULL,
        token_usage_input INTEGER,
        token_usage_output INTEGER,
        cost_usd REAL,
        duration_ms INTEGER NOT NULL,
        metadata TEXT,
        error_message TEXT,
        stack_trace TEXT,
        parent_log_id TEXT,
        severity TEXT,
        tags TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_timestamp ON audit_logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_session_id ON audit_logs(session_id);
      CREATE INDEX IF NOT EXISTS idx_agent_id ON audit_logs(agent_id);
      CREATE INDEX IF NOT EXISTS idx_action ON audit_logs(action);
      CREATE INDEX IF NOT EXISTS idx_tool ON audit_logs(tool);
      CREATE INDEX IF NOT EXISTS idx_result ON audit_logs(result);
      CREATE INDEX IF NOT EXISTS idx_severity ON audit_logs(severity);
      CREATE INDEX IF NOT EXISTS idx_cost ON audit_logs(cost_usd);

      CREATE TABLE IF NOT EXISTS swarm_tasks (
        id TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        assigned_agent TEXT,
        parent_task_id TEXT,
        priority INTEGER DEFAULT 0,
        result TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS swarm_kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        agent_id TEXT,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS swarm_worker_results (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        result TEXT,
        tokens_used INTEGER,
        cost_usd REAL,
        duration_ms INTEGER,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (task_id) REFERENCES swarm_tasks(id)
      );

      CREATE INDEX IF NOT EXISTS idx_swarm_tasks_status ON swarm_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_swarm_tasks_agent ON swarm_tasks(assigned_agent);
      CREATE INDEX IF NOT EXISTS idx_swarm_results_task ON swarm_worker_results(task_id);
    `;

    this.db.exec(createTableSQL);
  }

  // ═══════════════════════════════════════════════════════════════
  // CORE LOGGING METHODS
  // ═══════════════════════════════════════════════════════════════

  public log(action: AuditAction): void {
    if (!this.config.enabled || !this.db) return;

    // Validate and sanitize input data
    const sanitizedAction = {
      ...action,
      sessionId: action.sessionId || 'unknown',
      agentId: action.agentId || 'unknown',
      durationMs: Math.max(0, action.durationMs || 0), // Ensure non-negative
    };

    const logEntry: AuditLog = {
      id: this.generateLogId(),
      timestamp: new Date(),
      sessionId: sanitizedAction.sessionId,
      agentId: sanitizedAction.agentId,
      action: sanitizedAction.action,
      tool: sanitizedAction.tool,
      params: this.config.sanitizeSensitiveData 
        ? DataSanitizer.sanitize(sanitizedAction.params)
        : sanitizedAction.params,
      result: sanitizedAction.result,
      tokenUsage: sanitizedAction.tokenUsage,
      costUsd: sanitizedAction.costUsd,
      durationMs: sanitizedAction.durationMs,
      metadata: sanitizedAction.metadata,
      errorMessage: sanitizedAction.errorMessage,
      stackTrace: sanitizedAction.stackTrace,
      parentLogId: sanitizedAction.parentLogId,
      severity: sanitizedAction.severity || 'low',
      tags: sanitizedAction.tags
    };

    // Add to batch buffer
    this.batchBuffer.push(logEntry);

    // Write immediately for high-severity events
    if (logEntry.severity === 'critical' || logEntry.severity === 'high') {
      this.flushBatch();
      if (this.config.alertOnHighSeverity) {
        this.emit('high_severity', logEntry);
      }
    }

    // Flush batch if it reaches the configured size
    if (this.batchBuffer.length >= this.config.batchWriteSize) {
      this.flushBatch();
    }

    // Emit real-time event
    if (this.config.enableRealTimeStream) {
      this.emit('log', logEntry);
    }
  }

  private flushBatch(): void {
    if (!this.db || this.batchBuffer.length === 0) return;

    const insertSQL = `
      INSERT INTO audit_logs (
        id, timestamp, session_id, agent_id, action, tool, params,
        result, token_usage_input, token_usage_output, cost_usd,
        duration_ms, metadata, error_message, stack_trace,
        parent_log_id, severity, tags
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const insert = this.db.prepare(insertSQL);
    const insertMany = this.db.transaction((logs: AuditLog[]) => {
      for (const log of logs) {
        insert.run(
          log.id,
          log.timestamp.getTime(),
          log.sessionId,
          log.agentId,
          log.action,
          log.tool,
          JSON.stringify(log.params),
          log.result,
          log.tokenUsage?.input,
          log.tokenUsage?.output,
          log.costUsd,
          log.durationMs,
          JSON.stringify(log.metadata),
          log.errorMessage,
          log.stackTrace,
          log.parentLogId,
          log.severity,
          JSON.stringify(log.tags)
        );

        // Also write to JSON backup
        if (this.jsonStream) {
          this.jsonStream.write(JSON.stringify(log) + '\n');
        }
      }
    });

    try {
      insertMany(this.batchBuffer);
      this.batchBuffer = [];
    } catch (error: unknown) {
      console.error('Failed to flush audit batch:', error);
      this.emit('error', error);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // QUERY METHODS
  // ═══════════════════════════════════════════════════════════════

  public query(filters: AuditFilters = {}): AuditLog[] {
    if (!this.db) return [];

    let sql = 'SELECT * FROM audit_logs WHERE 1=1';
    const params: any[] = [];

    // Build WHERE clause
    if (filters.sessionId) {
      sql += ' AND session_id = ?';
      params.push(filters.sessionId);
    }

    if (filters.agentId) {
      sql += ' AND agent_id = ?';
      params.push(filters.agentId);
    }

    if (filters.action) {
      if (Array.isArray(filters.action)) {
        sql += ` AND action IN (${filters.action.map(() => '?').join(',')})`;
        params.push(...filters.action);
      } else {
        sql += ' AND action = ?';
        params.push(filters.action);
      }
    }

    if (filters.tool) {
      sql += ' AND tool = ?';
      params.push(filters.tool);
    }

    if (filters.result) {
      if (Array.isArray(filters.result)) {
        sql += ` AND result IN (${filters.result.map(() => '?').join(',')})`;
        params.push(...filters.result);
      } else {
        sql += ' AND result = ?';
        params.push(filters.result);
      }
    }

    if (filters.dateFrom) {
      sql += ' AND timestamp >= ?';
      params.push(filters.dateFrom.getTime());
    }

    if (filters.dateTo) {
      sql += ' AND timestamp <= ?';
      params.push(filters.dateTo.getTime());
    }

    if (filters.severity) {
      if (Array.isArray(filters.severity)) {
        sql += ` AND severity IN (${filters.severity.map(() => '?').join(',')})`;
        params.push(...filters.severity);
      } else {
        sql += ' AND severity = ?';
        params.push(filters.severity);
      }
    }

    if (filters.costThreshold) {
      sql += ' AND cost_usd >= ?';
      params.push(filters.costThreshold);
    }

    if (filters.durationThreshold) {
      sql += ' AND duration_ms >= ?';
      params.push(filters.durationThreshold);
    }

    // ORDER BY
    const orderBy = filters.orderBy || 'timestamp';
    const orderDir = filters.orderDir || 'desc';
    
    // Map friendly names to actual column names
    const columnMap: Record<string, string> = {
      'duration': 'duration_ms',
      'cost': 'cost_usd',
      'timestamp': 'timestamp'
    };
    
    const actualColumn = columnMap[orderBy] || orderBy;
    sql += ` ORDER BY ${actualColumn} ${orderDir}`;

    // LIMIT/OFFSET
    if (filters.limit) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
    }

    if (filters.offset) {
      sql += ' OFFSET ?';
      params.push(filters.offset);
    }

    try {
      const rows = this.db.prepare(sql).all(...params) as any[];
      return rows.map(this.rowToAuditLog);
    } catch (error: unknown) {
      console.error('Failed to query audit logs:', error);
      return [];
    }
  }

  private rowToAuditLog(row: any): AuditLog {
    return {
      id: row.id,
      timestamp: new Date(row.timestamp),
      sessionId: row.session_id,
      agentId: row.agent_id,
      action: row.action,
      tool: row.tool,
      params: row.params ? JSON.parse(row.params) : undefined,
      result: row.result,
      tokenUsage: row.token_usage_input || row.token_usage_output ? {
        input: row.token_usage_input || 0,
        output: row.token_usage_output || 0
      } : undefined,
      costUsd: row.cost_usd,
      durationMs: row.duration_ms,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      errorMessage: row.error_message,
      stackTrace: row.stack_trace,
      parentLogId: row.parent_log_id,
      severity: row.severity,
      tags: row.tags ? JSON.parse(row.tags) : undefined
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // EXPORT METHODS
  // ═══════════════════════════════════════════════════════════════

  public export(format: 'json' | 'csv' | 'parquet', filters?: AuditFilters): string {
    const logs = this.query(filters);

    switch (format) {
      case 'json':
        return JSON.stringify(logs, null, 2);
      
      case 'csv':
        return this.exportToCsv(logs);
      
      case 'parquet':
        // For now, return JSON formatted for parquet conversion
        // In a real implementation, you'd use a parquet library
        return JSON.stringify({
          schema: this.getParquetSchema(),
          data: logs
        }, null, 2);
      
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  private exportToCsv(logs: AuditLog[]): string {
    if (logs.length === 0) return '';

    const headers = [
      'id', 'timestamp', 'sessionId', 'agentId', 'action', 'tool',
      'result', 'tokenUsage_input', 'tokenUsage_output', 'costUsd',
      'durationMs', 'errorMessage', 'severity'
    ];

    const csvRows = [headers.join(',')];

    for (const log of logs) {
      const row = [
        log.id,
        log.timestamp.toISOString(),
        log.sessionId,
        log.agentId,
        log.action,
        log.tool || '',
        log.result,
        log.tokenUsage?.input || '',
        log.tokenUsage?.output || '',
        log.costUsd || '',
        log.durationMs,
        log.errorMessage || '',
        log.severity || ''
      ].map(field => `"${String(field).replace(/"/g, '""')}"`);

      csvRows.push(row.join(','));
    }

    return csvRows.join('\n');
  }

  private getParquetSchema(): any {
    return {
      id: { type: 'string' },
      timestamp: { type: 'timestamp' },
      sessionId: { type: 'string' },
      agentId: { type: 'string' },
      action: { type: 'string' },
      tool: { type: 'string', optional: true },
      result: { type: 'string' },
      tokenUsage: { type: 'object', optional: true },
      costUsd: { type: 'float', optional: true },
      durationMs: { type: 'int64' },
      severity: { type: 'string' }
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // STATISTICS & ANALYTICS
  // ═══════════════════════════════════════════════════════════════

  public getStats(dateFrom?: Date, dateTo?: Date): AuditStats {
    if (!this.db) {
      return {
        totalLogs: 0,
        logsByAction: {},
        logsByResult: {},
        totalCost: 0,
        averageDuration: 0,
        errorRate: 0,
        topAgents: [],
        topTools: [],
        recentErrors: [],
        dailyStats: []
      };
    }

    const filters: AuditFilters = {};
    if (dateFrom) filters.dateFrom = dateFrom;
    if (dateTo) filters.dateTo = dateTo;

    let whereClause = '1=1';
    const params: any[] = [];

    if (dateFrom) {
      whereClause += ' AND timestamp >= ?';
      params.push(dateFrom.getTime());
    }

    if (dateTo) {
      whereClause += ' AND timestamp <= ?';
      params.push(dateTo.getTime());
    }

    // Total logs
    const totalLogs = this.db.prepare(`SELECT COUNT(*) as count FROM audit_logs WHERE ${whereClause}`).get(...params) as any;

    // Logs by action
    const logsByAction = this.db.prepare(`
      SELECT action, COUNT(*) as count 
      FROM audit_logs 
      WHERE ${whereClause} 
      GROUP BY action
    `).all(...params) as any[];

    // Logs by result
    const logsByResult = this.db.prepare(`
      SELECT result, COUNT(*) as count 
      FROM audit_logs 
      WHERE ${whereClause} 
      GROUP BY result
    `).all(...params) as any[];

    // Total cost and average duration
    const costAndDuration = this.db.prepare(`
      SELECT 
        COALESCE(SUM(cost_usd), 0) as totalCost,
        AVG(duration_ms) as avgDuration
      FROM audit_logs 
      WHERE ${whereClause}
    `).get(...params) as any;

    // Error rate
    const errorCount = this.db.prepare(`
      SELECT COUNT(*) as count 
      FROM audit_logs 
      WHERE ${whereClause} AND result = 'failure'
    `).get(...params) as any;

    // Top agents
    const topAgents = this.db.prepare(`
      SELECT 
        agent_id as agentId, 
        COUNT(*) as count,
        COALESCE(SUM(cost_usd), 0) as cost
      FROM audit_logs 
      WHERE ${whereClause} 
      GROUP BY agent_id 
      ORDER BY count DESC 
      LIMIT 10
    `).all(...params) as any[];

    // Top tools
    const topTools = this.db.prepare(`
      SELECT 
        tool, 
        COUNT(*) as count,
        AVG(duration_ms) as avgDuration
      FROM audit_logs 
      WHERE ${whereClause} AND tool IS NOT NULL 
      GROUP BY tool 
      ORDER BY count DESC 
      LIMIT 10
    `).all(...params) as any[];

    // Recent errors
    const recentErrors = this.db.prepare(`
      SELECT * FROM audit_logs 
      WHERE ${whereClause} AND result = 'failure' 
      ORDER BY timestamp DESC 
      LIMIT 5
    `).all(...params) as any[];

    // Daily stats
    const dailyStats = this.db.prepare(`
      SELECT 
        DATE(timestamp/1000, 'unixepoch') as date,
        COUNT(*) as count,
        COALESCE(SUM(cost_usd), 0) as cost
      FROM audit_logs 
      WHERE ${whereClause} 
      GROUP BY DATE(timestamp/1000, 'unixepoch') 
      ORDER BY date DESC 
      LIMIT 30
    `).all(...params) as any[];

    return {
      totalLogs: totalLogs.count,
      logsByAction: Object.fromEntries(logsByAction.map(r => [r.action, r.count])),
      logsByResult: Object.fromEntries(logsByResult.map(r => [r.result, r.count])),
      totalCost: costAndDuration.totalCost || 0,
      averageDuration: costAndDuration.avgDuration || 0,
      errorRate: totalLogs.count > 0 ? (errorCount.count / totalLogs.count) : 0,
      topAgents: topAgents.map(a => ({
        agentId: a.agentId,
        count: a.count,
        cost: a.cost || 0
      })),
      topTools: topTools.map(t => ({
        tool: t.tool,
        count: t.count,
        avgDuration: t.avgDuration || 0
      })),
      recentErrors: recentErrors.map(this.rowToAuditLog),
      dailyStats: dailyStats.map(d => ({
        date: d.date,
        count: d.count,
        cost: d.cost || 0
      }))
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // CONVENIENCE METHODS
  // ═══════════════════════════════════════════════════════════════

  public logToolCall(params: {
    sessionId: string;
    agentId: string;
    tool: string;
    params: any;
    result: 'success' | 'failure' | 'timeout';
    durationMs: number;
    tokenUsage?: { input: number; output: number };
    costUsd?: number;
    errorMessage?: string;
  }): void {
    this.log({
      ...params,
      action: 'tool_call',
      severity: params.result === 'failure' ? 'medium' : 'low'
    });
  }

  public logAgentSpawn(params: {
    sessionId: string;
    agentId: string;
    parentAgentId?: string;
    result: 'success' | 'failure';
    durationMs: number;
    metadata?: any;
  }): void {
    this.log({
      ...params,
      action: 'agent_spawn',
      severity: 'low',
      parentLogId: params.parentAgentId
    });
  }

  public logCostEvent(params: {
    sessionId: string;
    agentId: string;
    costUsd: number;
    tokenUsage: { input: number; output: number };
    metadata?: any;
  }): void {
    this.log({
      ...params,
      action: 'cost_event',
      result: 'success',
      durationMs: 0,
      severity: params.costUsd > 1.0 ? 'medium' : 'low'
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // SWARM STATE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════

  // Swarm task management
  public createTask(description: string, opts?: { priority?: number; parentTaskId?: string; assignedAgent?: string }): string {
    if (!this.db) throw new Error('Database not initialized')
    
    const id = crypto.randomUUID()
    const now = Date.now()
    
    this.db.prepare(`
      INSERT INTO swarm_tasks (id, description, status, assigned_agent, parent_task_id, priority, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      description,
      'pending',
      opts?.assignedAgent || null,
      opts?.parentTaskId || null,
      opts?.priority || 0,
      now,
      now
    )
    
    return id
  }

  public updateTask(taskId: string, updates: { status?: string; result?: string; error?: string; assignedAgent?: string }): void {
    if (!this.db) throw new Error('Database not initialized')
    
    const setClauses = []
    const values = []
    
    if (updates.status !== undefined) {
      setClauses.push('status = ?')
      values.push(updates.status)
    }
    
    if (updates.result !== undefined) {
      setClauses.push('result = ?')
      values.push(updates.result)
    }
    
    if (updates.error !== undefined) {
      setClauses.push('error = ?')
      values.push(updates.error)
    }
    
    if (updates.assignedAgent !== undefined) {
      setClauses.push('assigned_agent = ?')
      values.push(updates.assignedAgent)
    }
    
    // Always update timestamp
    setClauses.push('updated_at = ?')
    values.push(Date.now())
    
    // Set completed_at if status is being set to completed
    if (updates.status === 'completed') {
      setClauses.push('completed_at = ?')
      values.push(Date.now())
    }
    
    values.push(taskId) // For WHERE clause
    
    if (setClauses.length > 1) { // More than just timestamp
      this.db.prepare(`
        UPDATE swarm_tasks 
        SET ${setClauses.join(', ')} 
        WHERE id = ?
      `).run(...values)
    }
  }

  public getTask(taskId: string): any {
    if (!this.db) throw new Error('Database not initialized')
    
    return this.db.prepare('SELECT * FROM swarm_tasks WHERE id = ?').get(taskId)
  }

  public listTasks(filters?: { status?: string; assignedAgent?: string; limit?: number }): any[] {
    if (!this.db) throw new Error('Database not initialized')
    
    let sql = 'SELECT * FROM swarm_tasks WHERE 1=1'
    const params: any[] = []
    
    if (filters?.status) {
      sql += ' AND status = ?'
      params.push(filters.status)
    }
    
    if (filters?.assignedAgent) {
      sql += ' AND assigned_agent = ?'
      params.push(filters.assignedAgent)
    }
    
    sql += ' ORDER BY priority ASC, created_at ASC'
    
    if (filters?.limit) {
      sql += ' LIMIT ?'
      params.push(filters.limit)
    }
    
    return this.db.prepare(sql).all(...params)
  }

  // Shared key-value store
  public setKV(key: string, value: string, agentId?: string): void {
    if (!this.db) throw new Error('Database not initialized')
    
    this.db.prepare(`
      INSERT OR REPLACE INTO swarm_kv (key, value, agent_id, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(key, value, agentId || null, Date.now())
  }

  public getKV(key: string): string | null {
    if (!this.db) throw new Error('Database not initialized')
    
    const result = this.db.prepare('SELECT value FROM swarm_kv WHERE key = ?').get(key) as any
    return result ? result.value : null
  }

  public deleteKV(key: string): void {
    if (!this.db) throw new Error('Database not initialized')
    
    this.db.prepare('DELETE FROM swarm_kv WHERE key = ?').run(key)
  }

  public listKV(prefix?: string): Array<{key: string; value: string; agent_id: string}> {
    if (!this.db) throw new Error('Database not initialized')
    
    let sql = 'SELECT key, value, agent_id FROM swarm_kv'
    const params: any[] = []
    
    if (prefix) {
      sql += ' WHERE key LIKE ?'
      params.push(`${prefix}%`)
    }
    
    sql += ' ORDER BY key'
    
    return this.db.prepare(sql).all(...params) as any[]
  }

  // Worker results
  public logWorkerResult(taskId: string, workerId: string, result: string, meta?: { tokensUsed?: number; costUsd?: number; durationMs?: number }): string {
    if (!this.db) throw new Error('Database not initialized')
    
    const id = crypto.randomUUID()
    const now = Date.now()
    
    this.db.prepare(`
      INSERT INTO swarm_worker_results (id, task_id, worker_id, result, tokens_used, cost_usd, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      taskId,
      workerId,
      result,
      meta?.tokensUsed || null,
      meta?.costUsd || null,
      meta?.durationMs || null,
      now
    )
    
    return id
  }

  public getWorkerResults(taskId: string): any[] {
    if (!this.db) throw new Error('Database not initialized')
    
    return this.db.prepare(`
      SELECT * FROM swarm_worker_results 
      WHERE task_id = ? 
      ORDER BY created_at ASC
    `).all(taskId)
  }

  // ═══════════════════════════════════════════════════════════════
  // MAINTENANCE & CLEANUP
  // ═══════════════════════════════════════════════════════════════

  private async cleanupOldLogs(): Promise<void> {
    if (!this.db || this.config.retentionDays <= 0) return;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);

    try {
      const result = this.db.prepare(
        'DELETE FROM audit_logs WHERE timestamp < ?'
      ).run(cutoffDate.getTime());

      if (result.changes > 0) {
        console.log(`🦊 AUDIT: Cleaned up ${result.changes} old log entries`);
      }
    } catch (error: unknown) {
      console.error('Failed to cleanup old audit logs:', error);
    }
  }

  public async close(): Promise<void> {
    // Flush any remaining logs
    this.flushBatch();

    // Close database
    if (this.db) {
      this.db.close();
      this.db = null;
    }

    // Close JSON stream
    if (this.jsonStream) {
      this.jsonStream.end();
      this.jsonStream = null;
    }

    // Clear cleanup timer
    if (this.retentionCleanupTimer) {
      clearInterval(this.retentionCleanupTimer);
      this.retentionCleanupTimer = null;
    }

    console.log('🦊 AUDIT TRAIL closed successfully');
  }

  // ═══════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════

  private generateLogId(): string {
    return `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  public isEnabled(): boolean {
    return this.config.enabled;
  }

  public getConfig(): Required<AuditConfig> {
    return { ...this.config };
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════

let auditTrailInstance: AuditTrail | null = null;

export function getAuditTrail(config?: AuditConfig): AuditTrail {
  if (!auditTrailInstance) {
    auditTrailInstance = new AuditTrail(config);
  }
  return auditTrailInstance;
}

export function startAuditTrail(config?: AuditConfig): AuditTrail {
  return getAuditTrail(config);
}

export function stopAuditTrail(): void {
  if (auditTrailInstance) {
    auditTrailInstance.close();
    auditTrailInstance = null;
  }
}

// Test helper to set the singleton instance
export function setAuditTrailInstance(instance: AuditTrail | null): void {
  auditTrailInstance = instance;
}