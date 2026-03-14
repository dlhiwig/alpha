/**
 * Shared Memory System for Alpha
 *
 * Enables memory sharing between all Alpha agents, supporting swarm intelligence
 * and knowledge transfer across agent boundaries.
 */

import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveSecureStatePath } from "./secure-state.js";
import type { OpenClawConfig } from "../config/config.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { createEmbeddingProvider, type EmbeddingProvider } from "../memory/embeddings.js";
import { requireNodeSqlite } from "../memory/sqlite.js";
import { validateDbPath } from "./validate-db-path.js";

const log = createSubsystemLogger("shared-memory");

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface SharedMemoryEntry {
  id: string;
  agentId: string;
  content: string;
  type: "fact" | "decision" | "lesson" | "task" | "observation";
  tags: string[];
  importance: number;
  source?: string;
  embedding?: number[];
  createdAt: number;
  accessedAt?: number;
  accessCount: number;
}

export interface SharedMemoryStoreOptions {
  agentId: string;
  content: string;
  type: "fact" | "decision" | "lesson" | "task" | "observation";
  tags: string[];
  importance: number;
  source?: string;
}

export interface SharedMemorySearchOptions {
  limit?: number;
  types?: string[];
  minImportance?: number;
  agentId?: string;
  useEmbeddings?: boolean;
}

export interface SharedMemoryStats {
  totalEntries: number;
  entriesByType: Record<string, number>;
  entriesByAgent: Record<string, number>;
  avgImportance: number;
  oldestEntry: number;
  newestEntry: number;
}

// ═══════════════════════════════════════════════════════════════════
// DATABASE SCHEMA
// ═══════════════════════════════════════════════════════════════════

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS shared_memories (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    content TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('fact', 'decision', 'lesson', 'task', 'observation')),
    tags TEXT NOT NULL DEFAULT '[]',
    importance REAL NOT NULL DEFAULT 0.5 CHECK (importance >= 0 AND importance <= 1),
    source TEXT,
    embedding TEXT,
    created_at INTEGER NOT NULL,
    accessed_at INTEGER,
    access_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_shared_memories_agent_id ON shared_memories(agent_id);
  CREATE INDEX IF NOT EXISTS idx_shared_memories_type ON shared_memories(type);
  CREATE INDEX IF NOT EXISTS idx_shared_memories_importance ON shared_memories(importance DESC);
  CREATE INDEX IF NOT EXISTS idx_shared_memories_created_at ON shared_memories(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_shared_memories_accessed_at ON shared_memories(accessed_at DESC);

  CREATE VIRTUAL TABLE IF NOT EXISTS shared_memories_fts USING fts5(
    content,
    tags,
    source,
    content='shared_memories',
    content_rowid='rowid'
  );

  -- Trigger to keep FTS table in sync
  CREATE TRIGGER IF NOT EXISTS shared_memories_fts_insert AFTER INSERT ON shared_memories BEGIN
    INSERT INTO shared_memories_fts(rowid, content, tags, source)
    VALUES (new.rowid, new.content, new.tags, COALESCE(new.source, ''));
  END;

  CREATE TRIGGER IF NOT EXISTS shared_memories_fts_delete AFTER DELETE ON shared_memories BEGIN
    INSERT INTO shared_memories_fts(shared_memories_fts, rowid, content, tags, source)
    VALUES ('delete', old.rowid, old.content, old.tags, COALESCE(old.source, ''));
  END;

  CREATE TRIGGER IF NOT EXISTS shared_memories_fts_update AFTER UPDATE ON shared_memories BEGIN
    INSERT INTO shared_memories_fts(shared_memories_fts, rowid, content, tags, source)
    VALUES ('delete', old.rowid, old.content, old.tags, COALESCE(old.source, ''));
    INSERT INTO shared_memories_fts(rowid, content, tags, source)
    VALUES (new.rowid, new.content, new.tags, COALESCE(new.source, ''));
  END;
`;

// ═══════════════════════════════════════════════════════════════════
// SHARED MEMORY CLASS
// ═══════════════════════════════════════════════════════════════════

export class SharedMemory {
  private db: import("node:sqlite").DatabaseSync | null = null;
  private embeddingProvider: EmbeddingProvider | null = null;
  private dbPath: string;
  private config: OpenClawConfig | null = null;

  constructor(config?: OpenClawConfig) {
    this.config = config || null;
    // resolveSecureStatePath already prevents path breakout from stateDir;
    // validateDbPath adds extension check + symlink rejection (CVE fix)
    const candidatePath = resolveSecureStatePath("memory", "shared.sqlite");
    const stateDir = path.dirname(candidatePath); // .alpha/memory
    this.dbPath = validateDbPath(candidatePath, stateDir, "shared-memory");
  }

  /**
   * Initialize the shared memory system
   */
  async initialize(): Promise<void> {
    try {
      // Ensure directory exists (validateDbPath already created with 0o700)
      await fs.mkdir(path.dirname(this.dbPath), { recursive: true });

      // Initialize database
      const sqlite = requireNodeSqlite();
      this.db = new sqlite.DatabaseSync(this.dbPath);

      // Create schema
      this.db.exec(SCHEMA_SQL);

      // Initialize embeddings if configured
      if (this.config?.memory?.embeddings?.enabled) {
        try {
          this.embeddingProvider = createEmbeddingProvider({
            enabled: true,
            ...this.config.memory.embeddings,
          });
          log.info("Shared memory initialized with embeddings support");
        } catch (error) {
          log.warn("Failed to initialize embeddings for shared memory:", error);
        }
      }

      log.info(`Shared memory initialized at ${this.dbPath}`);
    } catch (error) {
      log.error("Failed to initialize shared memory:", error);
      throw error;
    }
  }

  /**
   * Store a memory entry
   */
  async store(entry: SharedMemoryStoreOptions): Promise<string> {
    if (!this.db) {
      throw new Error("Shared memory not initialized");
    }

    const id = crypto.randomUUID();
    const now = Date.now();

    // Generate embedding if provider available
    let embedding: number[] | null = null;
    if (this.embeddingProvider) {
      try {
        const result = await this.embeddingProvider.generateEmbeddings([entry.content]);
        if (result.embeddings && result.embeddings.length > 0) {
          embedding = result.embeddings[0];
        }
      } catch (error) {
        log.warn("Failed to generate embedding for memory entry:", error);
      }
    }

    // Insert into database
    const stmt = this.db.prepare(`
      INSERT INTO shared_memories (
        id, agent_id, content, type, tags, importance, source,
        embedding, created_at, access_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      entry.agentId,
      entry.content,
      entry.type,
      JSON.stringify(entry.tags),
      entry.importance,
      entry.source || null,
      embedding ? JSON.stringify(embedding) : null,
      now,
      0,
    );

    log.debug(`Stored shared memory entry: ${id} from agent ${entry.agentId}`);
    return id;
  }

  /**
   * Search shared memory entries
   */
  async search(
    query: string,
    options: SharedMemorySearchOptions = {},
  ): Promise<SharedMemoryEntry[]> {
    if (!this.db) {
      throw new Error("Shared memory not initialized");
    }

    const { limit = 10, types, minImportance, agentId, useEmbeddings = true } = options;

    let results: SharedMemoryEntry[] = [];

    // Try embedding-based search first if available
    if (useEmbeddings && this.embeddingProvider && query.trim()) {
      try {
        const queryEmbedding = await this.embeddingProvider.generateEmbeddings([query]);
        if (queryEmbedding.embeddings && queryEmbedding.embeddings.length > 0) {
          results = await this.searchByEmbedding(queryEmbedding.embeddings[0], options);
        }
      } catch (error) {
        log.warn("Embedding search failed, falling back to text search:", error);
      }
    }

    // Fallback to FTS search or if no embedding results
    if (results.length === 0 && query.trim()) {
      results = await this.searchByText(query, options);
    }

    // If still no results, try recent memories
    if (results.length === 0) {
      results = await this.recent(limit);
    }

    // Update access tracking for returned results
    for (const result of results) {
      await this.updateAccess(result.id);
    }

    return results.slice(0, limit);
  }

  /**
   * Search by embedding similarity
   */
  private async searchByEmbedding(
    queryEmbedding: number[],
    options: SharedMemorySearchOptions,
  ): Promise<SharedMemoryEntry[]> {
    if (!this.db) {
      return [];
    }

    let sql = `
      SELECT id, agent_id, content, type, tags, importance, source,
             embedding, created_at, accessed_at, access_count
      FROM shared_memories 
      WHERE embedding IS NOT NULL
    `;

    const params: any[] = [];

    // Add filters
    if (options.types && options.types.length > 0) {
      sql += ` AND type IN (${options.types.map(() => "?").join(",")})`;
      params.push(...options.types);
    }

    if (options.minImportance !== undefined) {
      sql += ` AND importance >= ?`;
      params.push(options.minImportance);
    }

    if (options.agentId) {
      sql += ` AND agent_id = ?`;
      params.push(options.agentId);
    }

    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push((options.limit || 10) * 2); // Get more for similarity calculation

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as any[];

    // Calculate similarities and sort
    const results: Array<SharedMemoryEntry & { similarity: number }> = [];

    for (const row of rows) {
      try {
        const embedding = JSON.parse(row.embedding);
        const similarity = this.cosineSimilarity(queryEmbedding, embedding);

        if (similarity > 0.1) {
          // Only include relevant results
          results.push({
            ...this.rowToEntry(row),
            similarity,
          });
        }
      } catch (error) {
        log.warn("Failed to parse embedding for entry:", row.id);
      }
    }

    // Sort by similarity and return
    return results
      .toSorted((a, b) => b.similarity - a.similarity)
      .slice(0, options.limit || 10)
      .map(({ similarity, ...entry }) => entry);
  }

  /**
   * Search by text using FTS
   */
  private async searchByText(
    query: string,
    options: SharedMemorySearchOptions,
  ): Promise<SharedMemoryEntry[]> {
    if (!this.db) {
      return [];
    }

    let sql = `
      SELECT m.id, m.agent_id, m.content, m.type, m.tags, m.importance, m.source,
             m.embedding, m.created_at, m.accessed_at, m.access_count,
             rank
      FROM shared_memories_fts fts
      JOIN shared_memories m ON m.rowid = fts.rowid
      WHERE shared_memories_fts MATCH ?
    `;

    const params: any[] = [query];

    // Add filters
    if (options.types && options.types.length > 0) {
      sql += ` AND m.type IN (${options.types.map(() => "?").join(",")})`;
      params.push(...options.types);
    }

    if (options.minImportance !== undefined) {
      sql += ` AND m.importance >= ?`;
      params.push(options.minImportance);
    }

    if (options.agentId) {
      sql += ` AND m.agent_id = ?`;
      params.push(options.agentId);
    }

    sql += ` ORDER BY rank, m.importance DESC, m.created_at DESC LIMIT ?`;
    params.push(options.limit || 10);

    try {
      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params) as any[];
      return rows.map((row) => this.rowToEntry(row));
    } catch (error) {
      log.warn("FTS search failed:", error);
      return [];
    }
  }

  /**
   * Get recent memories
   */
  async recent(limit: number = 10): Promise<SharedMemoryEntry[]> {
    if (!this.db) {
      return [];
    }

    const stmt = this.db.prepare(`
      SELECT id, agent_id, content, type, tags, importance, source,
             embedding, created_at, accessed_at, access_count
      FROM shared_memories
      ORDER BY created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(limit) as any[];
    return rows.map((row) => this.rowToEntry(row));
  }

  /**
   * Consolidate similar memories to reduce duplication
   */
  async consolidate(): Promise<number> {
    if (!this.db || !this.embeddingProvider) {
      log.warn("Consolidation requires embeddings to be enabled");
      return 0;
    }

    // Get all memories with embeddings
    const stmt = this.db.prepare(`
      SELECT id, content, embedding, importance, created_at
      FROM shared_memories
      WHERE embedding IS NOT NULL
      ORDER BY created_at DESC
    `);

    const memories = stmt.all() as any[];
    let mergedCount = 0;
    const processed = new Set<string>();

    for (let i = 0; i < memories.length; i++) {
      if (processed.has(memories[i].id)) {
        continue;
      }

      const currentMemory = memories[i];
      const currentEmbedding = JSON.parse(currentMemory.embedding);

      for (let j = i + 1; j < memories.length; j++) {
        if (processed.has(memories[j].id)) {
          continue;
        }

        const otherMemory = memories[j];
        const otherEmbedding = JSON.parse(otherMemory.embedding);

        const similarity = this.cosineSimilarity(currentEmbedding, otherEmbedding);

        if (similarity > 0.95) {
          // Very similar memories
          // Keep the one with higher importance or newer date
          const keepCurrent =
            currentMemory.importance > otherMemory.importance ||
            (currentMemory.importance === otherMemory.importance &&
              currentMemory.created_at > otherMemory.created_at);

          const idToDelete = keepCurrent ? otherMemory.id : currentMemory.id;

          // Delete the duplicate
          const deleteStmt = this.db.prepare("DELETE FROM shared_memories WHERE id = ?");
          deleteStmt.run(idToDelete);

          processed.add(idToDelete);
          mergedCount++;

          log.debug(`Consolidated duplicate memory: ${idToDelete}`);
        }
      }

      processed.add(currentMemory.id);
    }

    if (mergedCount > 0) {
      log.info(`Consolidated ${mergedCount} duplicate memories`);
    }

    return mergedCount;
  }

  /**
   * Get statistics about shared memory
   */
  async getStats(): Promise<SharedMemoryStats> {
    if (!this.db) {
      throw new Error("Shared memory not initialized");
    }

    // Total entries
    const totalStmt = this.db.prepare("SELECT COUNT(*) as count FROM shared_memories");
    const total = (totalStmt.get() as any).count;

    // Entries by type
    const typeStmt = this.db.prepare(
      "SELECT type, COUNT(*) as count FROM shared_memories GROUP BY type",
    );
    const typeRows = typeStmt.all() as any[];
    const entriesByType: Record<string, number> = {};
    for (const row of typeRows) {
      entriesByType[row.type] = row.count;
    }

    // Entries by agent
    const agentStmt = this.db.prepare(
      "SELECT agent_id, COUNT(*) as count FROM shared_memories GROUP BY agent_id",
    );
    const agentRows = agentStmt.all() as any[];
    const entriesByAgent: Record<string, number> = {};
    for (const row of agentRows) {
      entriesByAgent[row.agent_id] = row.count;
    }

    // Average importance
    const avgStmt = this.db.prepare("SELECT AVG(importance) as avg FROM shared_memories");
    const avgImportance = (avgStmt.get() as any).avg || 0;

    // Date range
    const rangeStmt = this.db.prepare(
      "SELECT MIN(created_at) as oldest, MAX(created_at) as newest FROM shared_memories",
    );
    const range = rangeStmt.get() as any;

    return {
      totalEntries: total,
      entriesByType,
      entriesByAgent,
      avgImportance,
      oldestEntry: range.oldest || 0,
      newestEntry: range.newest || 0,
    };
  }

  /**
   * Clean up old entries to manage size
   */
  async cleanup(maxEntries: number = 10000): Promise<number> {
    if (!this.db) {
      return 0;
    }

    const countStmt = this.db.prepare("SELECT COUNT(*) as count FROM shared_memories");
    const currentCount = (countStmt.get() as any).count;

    if (currentCount <= maxEntries) {
      return 0;
    }

    const deleteCount = currentCount - maxEntries;

    // Delete oldest entries with low importance first
    const deleteStmt = this.db.prepare(`
      DELETE FROM shared_memories 
      WHERE id IN (
        SELECT id FROM shared_memories 
        ORDER BY importance ASC, created_at ASC 
        LIMIT ?
      )
    `);

    deleteStmt.run(deleteCount);

    log.info(`Cleaned up ${deleteCount} old memories`);
    return deleteCount;
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════

  private rowToEntry(row: any): SharedMemoryEntry {
    return {
      id: row.id,
      agentId: row.agent_id,
      content: row.content,
      type: row.type,
      tags: JSON.parse(row.tags || "[]"),
      importance: row.importance,
      source: row.source,
      embedding: row.embedding ? JSON.parse(row.embedding) : undefined,
      createdAt: row.created_at,
      accessedAt: row.accessed_at,
      accessCount: row.access_count,
    };
  }

  private async updateAccess(id: string): Promise<void> {
    if (!this.db) {
      return;
    }

    const stmt = this.db.prepare(`
      UPDATE shared_memories 
      SET accessed_at = ?, access_count = access_count + 1 
      WHERE id = ?
    `);

    stmt.run(Date.now(), id);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }
}

// ═══════════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════════

let sharedMemoryInstance: SharedMemory | null = null;

export async function getSharedMemory(config?: OpenClawConfig): Promise<SharedMemory> {
  if (!sharedMemoryInstance) {
    sharedMemoryInstance = new SharedMemory(config);
    await sharedMemoryInstance.initialize();
  }
  return sharedMemoryInstance;
}

export async function closeSharedMemory(): Promise<void> {
  if (sharedMemoryInstance) {
    await sharedMemoryInstance.close();
    sharedMemoryInstance = null;
  }
}
