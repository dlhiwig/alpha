/**
 * HybridMemoryService - 3-Tier Memory Architecture
 * 
 * Combines SQLite FTS5 (fast path) + Dolt (versioned archive) + MemoryCompactor
 * Based on ClawdBoss architecture: https://clawdboss.ai/posts/give-your-clawdbot-permanent-memory
 * 
 * Tier 1: MEMORY.md - Critical facts injected every turn (20-30 items)
 * Tier 2: SQLite + FTS5 - Fast factual lookups, 80% of queries
 * Tier 3: Dolt - Versioned archive, compaction, semantic search fallback
 * 
 * @fileoverview Hybrid memory system with TTL decay and decision extraction
 */

import Database from 'better-sqlite3';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import type { DoltService } from './DoltService';
import { MemoryCompactor } from './compactor';
import type { AgentMemory, CompactionConfig } from './types';

// --- Types ---

export type DecayTier = 'permanent' | 'stable' | 'active' | 'session' | 'checkpoint';

export interface MemoryFact {
  id: string;
  agentId: string;
  category: string;      // e.g., 'person', 'project', 'decision', 'preference'
  entity: string;        // e.g., 'daughter', 'DEFIT', 'database choice'
  key: string;           // e.g., 'birthday', 'tech_stack', 'rationale'
  value: string;         // The actual fact
  source: string;        // Where this came from (conversation, import, etc.)
  decayTier: DecayTier;
  ttlMs: number | null;  // null = permanent
  lastAccessedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface HybridMemoryConfig {
  /** Path to SQLite database file */
  sqlitePath: string;
  /** Path to MEMORY.md file */
  memoryMdPath: string;
  /** Dolt service for versioned archive */
  doltService?: DoltService;
  /** Compaction config */
  compactionConfig?: Partial<CompactionConfig>;
  /** Max facts in MEMORY.md (default: 30) */
  maxMemoryMdFacts?: number;
  /** Enable auto-decision extraction (default: true) */
  autoExtractDecisions?: boolean;
}

export interface SearchOptions {
  category?: string;
  entity?: string;
  decayTier?: DecayTier;
  limit?: number;
  includeExpired?: boolean;
}

export interface SearchResult {
  fact: MemoryFact;
  score: number;
  source: 'fts5' | 'dolt';
}

// TTL values by decay tier
const TTL_BY_TIER: Record<DecayTier, number | null> = {
  permanent: null,           // Never expires
  stable: 90 * 24 * 60 * 60 * 1000,    // 90 days
  active: 14 * 24 * 60 * 60 * 1000,    // 14 days
  session: 24 * 60 * 60 * 1000,        // 24 hours
  checkpoint: 4 * 60 * 60 * 1000,      // 4 hours
};

// Decision extraction patterns
const DECISION_PATTERNS = [
  /(?:we |i )?decided to (?:use |go with )?(.+?) because (.+)/i,
  /(?:we |i )?chose (.+?) over (.+?) (?:for|because) (.+)/i,
  /(?:always|never) (.+)/i,
  /the decision is to (.+)/i,
  /(?:we're |we are )?going with (.+?) (?:for|because) (.+)/i,
];

// Category classification patterns
const CATEGORY_PATTERNS: Array<{ pattern: RegExp; category: string; tier: DecayTier }> = [
  { pattern: /birthday|born|anniversary/i, category: 'person', tier: 'permanent' },
  { pattern: /email|phone|address|contact/i, category: 'contact', tier: 'permanent' },
  { pattern: /api[_ ]?key|token|secret|password/i, category: 'credential', tier: 'permanent' },
  { pattern: /decided|chose|picked|selected/i, category: 'decision', tier: 'permanent' },
  { pattern: /always|never|must|should/i, category: 'convention', tier: 'permanent' },
  { pattern: /project|repo|codebase/i, category: 'project', tier: 'stable' },
  { pattern: /tech[_ ]?stack|framework|library/i, category: 'project', tier: 'stable' },
  { pattern: /sprint|task|todo|working on/i, category: 'task', tier: 'active' },
  { pattern: /debug|error|issue|bug/i, category: 'debug', tier: 'session' },
  { pattern: /checkpoint|before|about to/i, category: 'checkpoint', tier: 'checkpoint' },
];

// --- HybridMemoryService ---

export class HybridMemoryService extends EventEmitter {
  private db: Database.Database;
  private config: Required<HybridMemoryConfig>;
  private compactor: MemoryCompactor | null = null;
  private dolt: DoltService | null = null;
  
  constructor(config: HybridMemoryConfig) {
    super();
    
    this.config = {
      sqlitePath: config.sqlitePath,
      memoryMdPath: config.memoryMdPath,
      doltService: config.doltService ?? null,
      compactionConfig: config.compactionConfig ?? {},
      maxMemoryMdFacts: config.maxMemoryMdFacts ?? 30,
      autoExtractDecisions: config.autoExtractDecisions ?? true,
    } as Required<HybridMemoryConfig>;
    
    // Initialize SQLite with FTS5
    this.db = new Database(this.config.sqlitePath);
    this.initializeSchema();
    
    // Initialize Dolt compactor if service provided
    if (config.doltService) {
      this.dolt = config.doltService;
      this.compactor = new MemoryCompactor(config.doltService, config.compactionConfig);
    }
    
    // Start TTL cleanup interval
    this.startCleanupInterval();
  }
  
  // --- Schema Initialization ---
  
  private initializeSchema(): void {
    // Main facts table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS facts (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        category TEXT NOT NULL,
        entity TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        source TEXT DEFAULT 'conversation',
        decay_tier TEXT NOT NULL DEFAULT 'active',
        ttl_ms INTEGER,
        last_accessed_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_facts_agent ON facts(agent_id);
      CREATE INDEX IF NOT EXISTS idx_facts_category ON facts(category);
      CREATE INDEX IF NOT EXISTS idx_facts_entity ON facts(entity);
      CREATE INDEX IF NOT EXISTS idx_facts_decay ON facts(decay_tier);
      CREATE INDEX IF NOT EXISTS idx_facts_ttl ON facts(ttl_ms, last_accessed_at);
    `);
    
    // FTS5 virtual table for full-text search
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(
        entity,
        key,
        value,
        content='facts',
        content_rowid='rowid'
      );
      
      -- Triggers to keep FTS5 in sync
      CREATE TRIGGER IF NOT EXISTS facts_ai AFTER INSERT ON facts BEGIN
        INSERT INTO facts_fts(rowid, entity, key, value)
        VALUES (NEW.rowid, NEW.entity, NEW.key, NEW.value);
      END;
      
      CREATE TRIGGER IF NOT EXISTS facts_ad AFTER DELETE ON facts BEGIN
        INSERT INTO facts_fts(facts_fts, rowid, entity, key, value)
        VALUES ('delete', OLD.rowid, OLD.entity, OLD.key, OLD.value);
      END;
      
      CREATE TRIGGER IF NOT EXISTS facts_au AFTER UPDATE ON facts BEGIN
        INSERT INTO facts_fts(facts_fts, rowid, entity, key, value)
        VALUES ('delete', OLD.rowid, OLD.entity, OLD.key, OLD.value);
        INSERT INTO facts_fts(rowid, entity, key, value)
        VALUES (NEW.rowid, NEW.entity, NEW.key, NEW.value);
      END;
    `);
    
    // Checkpoints table for pre-flight saves
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        task_description TEXT NOT NULL,
        current_state TEXT NOT NULL,
        expected_outcome TEXT,
        files_modified TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_checkpoints_agent ON checkpoints(agent_id);
      CREATE INDEX IF NOT EXISTS idx_checkpoints_expires ON checkpoints(expires_at);
    `);
  }
  
  // --- Core CRUD Operations ---
  
  /**
   * Store a fact with automatic classification
   */
  async storeFact(
    agentId: string,
    text: string,
    options: {
      category?: string;
      entity?: string;
      key?: string;
      source?: string;
      decayTier?: DecayTier;
    } = {}
  ): Promise<MemoryFact> {
    // Auto-classify if not provided
    const classification = this.classifyFact(text);
    const category = options.category ?? classification.category;
    const decayTier = options.decayTier ?? classification.tier;
    
    // Parse entity and key from text if not provided
    const parsed = this.parseEntityKey(text);
    const entity = options.entity ?? parsed.entity;
    const key = options.key ?? parsed.key;
    const value = parsed.value || text;
    
    const now = Date.now();
    const id = this.generateId();
    const ttlMs = TTL_BY_TIER[decayTier];
    
    const stmt = this.db.prepare(`
      INSERT INTO facts (id, agent_id, category, entity, key, value, source, decay_tier, ttl_ms, last_accessed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      id,
      agentId,
      category,
      entity,
      key,
      value,
      options.source ?? 'conversation',
      decayTier,
      ttlMs,
      now,
      now,
      now
    );
    
    const fact: MemoryFact = {
      id,
      agentId,
      category,
      entity,
      key,
      value,
      source: options.source ?? 'conversation',
      decayTier,
      ttlMs,
      lastAccessedAt: new Date(now),
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };
    
    this.emit('factStored', fact);
    
    // Auto-extract decisions if enabled
    if (this.config.autoExtractDecisions && category !== 'decision') {
      const decision = this.extractDecision(text);
      if (decision) {
        await this.storeFact(agentId, decision, {
          category: 'decision',
          decayTier: 'permanent',
          source: 'auto-extracted',
        });
      }
    }
    
    return fact;
  }
  
  /**
   * Fast factual lookup using FTS5 (Tier 2)
   */
  search(agentId: string, query: string, options: SearchOptions = {}): SearchResult[] {
    const limit = options.limit ?? 10;
    const results: SearchResult[] = [];
    
    // Build FTS5 query
    const ftsQuery = query.split(/\s+/).map(term => `"${term}"*`).join(' OR ');
    
    const stmt = this.db.prepare(`
      SELECT 
        f.*,
        bm25(facts_fts) as score
      FROM facts_fts
      JOIN facts f ON facts_fts.rowid = f.rowid
      WHERE facts_fts MATCH ?
        AND f.agent_id = ?
        ${options.category ? 'AND f.category = ?' : ''}
        ${options.entity ? 'AND f.entity = ?' : ''}
        ${options.decayTier ? 'AND f.decay_tier = ?' : ''}
        ${!options.includeExpired ? 'AND (f.ttl_ms IS NULL OR f.last_accessed_at + f.ttl_ms > ?)' : ''}
      ORDER BY score
      LIMIT ?
    `);
    
    const params: any[] = [ftsQuery, agentId];
    if (options.category) {params.push(options.category);}
    if (options.entity) {params.push(options.entity);}
    if (options.decayTier) {params.push(options.decayTier);}
    if (!options.includeExpired) {params.push(Date.now());}
    params.push(limit);
    
    const rows = stmt.all(...params) as any[];
    
    for (const row of rows) {
      // Touch access time (refresh TTL)
      this.touchFact(row.id);
      
      results.push({
        fact: this.rowToFact(row),
        score: Math.abs(row.score), // BM25 returns negative scores
        source: 'fts5',
      });
    }
    
    return results;
  }
  
  /**
   * Get fact by exact entity/key lookup
   */
  getFact(agentId: string, entity: string, key: string): MemoryFact | null {
    const stmt = this.db.prepare(`
      SELECT * FROM facts
      WHERE agent_id = ? AND entity = ? AND key = ?
      AND (ttl_ms IS NULL OR last_accessed_at + ttl_ms > ?)
      LIMIT 1
    `);
    
    const row = stmt.get(agentId, entity, key, Date.now()) as any;
    if (!row) {return null;}
    
    // Touch access time
    this.touchFact(row.id);
    
    return this.rowToFact(row);
  }
  
  /**
   * Get all facts for an entity
   */
  getEntityFacts(agentId: string, entity: string): MemoryFact[] {
    const stmt = this.db.prepare(`
      SELECT * FROM facts
      WHERE agent_id = ? AND entity = ?
      AND (ttl_ms IS NULL OR last_accessed_at + ttl_ms > ?)
      ORDER BY created_at DESC
    `);
    
    const rows = stmt.all(agentId, entity, Date.now()) as any[];
    return rows.map(row => {
      this.touchFact(row.id);
      return this.rowToFact(row);
    });
  }
  
  /**
   * Update fact access time (refresh TTL)
   */
  private touchFact(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE facts SET last_accessed_at = ? WHERE id = ?
    `);
    stmt.run(Date.now(), id);
  }
  
  /**
   * Delete a fact
   */
  deleteFact(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM facts WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }
  
  // --- Checkpoint System ---
  
  /**
   * Create a pre-flight checkpoint before risky operations
   */
  createCheckpoint(
    agentId: string,
    taskDescription: string,
    currentState: string,
    options: {
      expectedOutcome?: string;
      filesModified?: string[];
    } = {}
  ): string {
    const id = this.generateId();
    const now = Date.now();
    const expiresAt = now + TTL_BY_TIER.checkpoint!;
    
    const stmt = this.db.prepare(`
      INSERT INTO checkpoints (id, agent_id, task_description, current_state, expected_outcome, files_modified, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      id,
      agentId,
      taskDescription,
      currentState,
      options.expectedOutcome ?? '',
      JSON.stringify(options.filesModified ?? []),
      now,
      expiresAt
    );
    
    this.emit('checkpointCreated', { id, agentId, taskDescription });
    return id;
  }
  
  /**
   * Get the latest checkpoint for an agent
   */
  getLatestCheckpoint(agentId: string): {
    id: string;
    taskDescription: string;
    currentState: string;
    expectedOutcome: string;
    filesModified: string[];
    createdAt: Date;
  } | null {
    const stmt = this.db.prepare(`
      SELECT * FROM checkpoints
      WHERE agent_id = ? AND expires_at > ?
      ORDER BY created_at DESC
      LIMIT 1
    `);
    
    const row = stmt.get(agentId, Date.now()) as any;
    if (!row) {return null;}
    
    return {
      id: row.id,
      taskDescription: row.task_description,
      currentState: row.current_state,
      expectedOutcome: row.expected_outcome,
      filesModified: JSON.parse(row.files_modified || '[]'),
      createdAt: new Date(row.created_at),
    };
  }
  
  // --- MEMORY.md Integration (Tier 1) ---
  
  /**
   * Get critical facts for MEMORY.md injection
   */
  getCriticalFacts(agentId: string): MemoryFact[] {
    const stmt = this.db.prepare(`
      SELECT * FROM facts
      WHERE agent_id = ?
      AND decay_tier = 'permanent'
      AND (ttl_ms IS NULL OR last_accessed_at + ttl_ms > ?)
      ORDER BY 
        CASE category
          WHEN 'decision' THEN 1
          WHEN 'convention' THEN 2
          WHEN 'person' THEN 3
          WHEN 'contact' THEN 4
          WHEN 'project' THEN 5
          ELSE 6
        END,
        last_accessed_at DESC
      LIMIT ?
    `);
    
    const rows = stmt.all(agentId, Date.now(), this.config.maxMemoryMdFacts) as any[];
    return rows.map(row => this.rowToFact(row));
  }
  
  /**
   * Generate MEMORY.md content from critical facts
   */
  generateMemoryMd(agentId: string): string {
    const facts = this.getCriticalFacts(agentId);
    
    // Group by category
    const grouped = new Map<string, MemoryFact[]>();
    for (const fact of facts) {
      const existing = grouped.get(fact.category) ?? [];
      existing.push(fact);
      grouped.set(fact.category, existing);
    }
    
    let md = '# Critical Memory\n\n';
    md += `*Auto-generated from ${facts.length} permanent facts*\n\n`;
    
    // Decisions first
    if (grouped.has('decision')) {
      md += '## Decisions\n';
      for (const fact of grouped.get('decision')!) {
        md += `- **${fact.entity}**: ${fact.value}\n`;
      }
      md += '\n';
      grouped.delete('decision');
    }
    
    // Conventions next
    if (grouped.has('convention')) {
      md += '## Conventions\n';
      for (const fact of grouped.get('convention')!) {
        md += `- ${fact.value}\n`;
      }
      md += '\n';
      grouped.delete('convention');
    }
    
    // Remaining categories
    for (const [category, catFacts] of grouped) {
      md += `## ${this.titleCase(category)}\n`;
      for (const fact of catFacts) {
        md += `- **${fact.entity}** ${fact.key}: ${fact.value}\n`;
      }
      md += '\n';
    }
    
    return md;
  }
  
  /**
   * Write MEMORY.md to disk
   */
  async syncMemoryMd(agentId: string): Promise<void> {
    const content = this.generateMemoryMd(agentId);
    await fs.promises.writeFile(this.config.memoryMdPath, content, 'utf-8');
    this.emit('memoryMdSynced', { agentId, path: this.config.memoryMdPath });
  }
  
  // --- Dolt Integration (Tier 3) ---
  
  /**
   * Archive facts to Dolt for versioning
   */
  async archiveToDolt(agentId: string): Promise<void> {
    if (!this.dolt) {
      console.warn('[HybridMemory] Dolt not configured, skipping archive');
      return;
    }
    
    // Get all facts for agent
    const stmt = this.db.prepare('SELECT * FROM facts WHERE agent_id = ?');
    const rows = stmt.all(agentId) as any[];
    
    // Convert to Dolt format and upsert
    for (const row of rows) {
      await this.dolt.query(`
        INSERT INTO agent_memories (id, agent_id, title, description, type, status, compaction_level, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'active', 0, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          description = VALUES(description),
          updated_at = VALUES(updated_at)
      `, [
        row.id,
        row.agent_id,
        `${row.entity}:${row.key}`,
        row.value,
        row.category,
        JSON.stringify({ decayTier: row.decay_tier, source: row.source }),
        new Date(row.created_at).toISOString(),
        new Date(row.updated_at).toISOString(),
      ]);
    }
    
    await this.dolt.commit(`Archive ${rows.length} facts from SQLite for agent ${agentId}`);
    this.emit('archivedToDolt', { agentId, factCount: rows.length });
  }
  
  /**
   * Run compaction on Dolt memories
   */
  async runCompaction(agentId: string): Promise<void> {
    if (!this.compactor) {
      console.warn('[HybridMemory] Compactor not configured');
      return;
    }
    
    const result = await this.compactor.compactStaleMemories(agentId);
    this.emit('compactionComplete', { agentId, result });
  }
  
  // --- TTL Cleanup ---
  
  private startCleanupInterval(): void {
    // Run cleanup every hour
    setInterval(() => this.cleanupExpired(), 60 * 60 * 1000);
  }
  
  /**
   * Remove expired facts
   */
  cleanupExpired(): number {
    const stmt = this.db.prepare(`
      DELETE FROM facts
      WHERE ttl_ms IS NOT NULL
      AND last_accessed_at + ttl_ms < ?
    `);
    
    const result = stmt.run(Date.now());
    
    // Also cleanup expired checkpoints
    const checkpointStmt = this.db.prepare(`
      DELETE FROM checkpoints WHERE expires_at < ?
    `);
    checkpointStmt.run(Date.now());
    
    if (result.changes > 0) {
      this.emit('cleanupComplete', { deletedFacts: result.changes });
    }
    
    return result.changes;
  }
  
  // --- Helpers ---
  
  private classifyFact(text: string): { category: string; tier: DecayTier } {
    for (const { pattern, category, tier } of CATEGORY_PATTERNS) {
      if (pattern.test(text)) {
        return { category, tier };
      }
    }
    return { category: 'general', tier: 'active' };
  }
  
  private extractDecision(text: string): string | null {
    for (const pattern of DECISION_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        return text; // Return the full decision text
      }
    }
    return null;
  }
  
  private parseEntityKey(text: string): { entity: string; key: string; value: string } {
    // Try to extract entity:key = value patterns
    const patterns = [
      /(?:my |the )?(\w+)'s (\w+) is (.+)/i,           // "daughter's birthday is June 3rd"
      /(\w+) (\w+):\s*(.+)/i,                          // "Project status: in progress"
      /(.+?) = (.+)/i,                                  // "preference = dark mode"
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return {
          entity: match[1].toLowerCase(),
          key: match[2]?.toLowerCase() ?? 'note',
          value: match[3] ?? match[2] ?? text,
        };
      }
    }
    
    // Default: use first word as entity, rest as value
    const words = text.split(/\s+/);
    return {
      entity: words[0]?.toLowerCase() ?? 'general',
      key: 'note',
      value: text,
    };
  }
  
  private rowToFact(row: any): MemoryFact {
    return {
      id: row.id,
      agentId: row.agent_id,
      category: row.category,
      entity: row.entity,
      key: row.key,
      value: row.value,
      source: row.source,
      decayTier: row.decay_tier as DecayTier,
      ttlMs: row.ttl_ms,
      lastAccessedAt: new Date(row.last_accessed_at),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
  
  private generateId(): string {
    return `fact_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  private titleCase(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
  
  // --- Stats ---
  
  getStats(agentId: string): {
    totalFacts: number;
    byCategory: Record<string, number>;
    byTier: Record<DecayTier, number>;
    checkpointCount: number;
  } {
    const factsStmt = this.db.prepare(`
      SELECT 
        COUNT(*) as total,
        category,
        decay_tier
      FROM facts
      WHERE agent_id = ?
      GROUP BY category, decay_tier
    `);
    
    const rows = factsStmt.all(agentId) as any[];
    
    const byCategory: Record<string, number> = {};
    const byTier: Record<DecayTier, number> = {
      permanent: 0,
      stable: 0,
      active: 0,
      session: 0,
      checkpoint: 0,
    };
    let total = 0;
    
    for (const row of rows) {
      byCategory[row.category] = (byCategory[row.category] ?? 0) + row.total;
      byTier[row.decay_tier as DecayTier] += row.total;
      total += row.total;
    }
    
    const checkpointStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM checkpoints
      WHERE agent_id = ? AND expires_at > ?
    `);
    const checkpointRow = checkpointStmt.get(agentId, Date.now()) as any;
    
    return {
      totalFacts: total,
      byCategory,
      byTier,
      checkpointCount: checkpointRow?.count ?? 0,
    };
  }
  
  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }
}

// --- Factory ---

export function createHybridMemory(config: HybridMemoryConfig): HybridMemoryService {
  return new HybridMemoryService(config);
}

export default HybridMemoryService;
