// @ts-nocheck
import Database from 'better-sqlite3'
import * as path from 'path'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as crypto from 'crypto'

export interface DoltConfig {
  dbPath?: string
  timeout?: number
  maxRetries?: number
  retryDelay?: number
}

export interface QueryResult<T = any> {
  rows: T[]
  affectedRows?: number
  insertId?: number
}

export interface CommitInfo {
  hash: string
  message: string
  author: string
  date: string
}

export interface DiffResult {
  table: string
  operation: 'added' | 'modified' | 'deleted'
  rows: any[]
}

export class SqliteService {
  private dbPath: string
  private initialized: boolean = false
  private db: Database.Database | null = null
  private timeout: number
  private maxRetries: number
  private retryDelay: number
  
  constructor(config: DoltConfig = {}) {
    this.dbPath = config.dbPath || path.join(os.homedir(), '.superclaw', 'memory', 'beads-memory.db')
    this.timeout = config.timeout || 30000 // 30 seconds
    this.maxRetries = config.maxRetries || 3
    this.retryDelay = config.retryDelay || 1000 // 1 second
  }
  
  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }
    
    try {
      // Ensure database directory exists
      await fs.mkdir(path.dirname(this.dbPath), { recursive: true })
      
      // Initialize SQLite database
      this.db = new Database(this.dbPath)
      
      // Configure SQLite for better performance (similar to audit.ts)
      this.db.pragma('journal_mode = WAL')
      this.db.pragma('synchronous = NORMAL')
      this.db.pragma('cache_size = 10000')
      
      // Run schema migrations
      await this.runSchemaMigrations()
      
      this.initialized = true
    } catch (error: unknown) {
      throw new Error(`Failed to initialize SqliteService: ${error instanceof Error ? (error).message : String(error)}`, { cause: error })
    }
  }
  
  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    await this.ensureInitialized()
    
    if (!this.db) {
      throw new Error('Database not initialized')
    }
    
    try {
      const result = await this.retryOperation(() => {
        if (!this.db) {throw new Error('Database not initialized')}
        
        const stmt = this.db.prepare(sql)
        const rows = stmt.all(...(params || []))
        return rows as T[]
      })
      
      return result
    } catch (error: unknown) {
      throw new Error(`Query failed: ${error instanceof Error ? (error).message : String(error)}`, { cause: error })
    }
  }
  
  async execute(sql: string, params?: any[]): Promise<{ affectedRows: number }> {
    await this.ensureInitialized()
    
    if (!this.db) {
      throw new Error('Database not initialized')
    }
    
    try {
      const result = await this.retryOperation(() => {
        if (!this.db) {throw new Error('Database not initialized')}
        
        const stmt = this.db.prepare(sql)
        const info = stmt.run(...(params || []))
        return { affectedRows: info.changes }
      })
      
      return result
    } catch (error: unknown) {
      throw new Error(`Execute failed: ${error instanceof Error ? (error).message : String(error)}`, { cause: error })
    }
  }
  
  async commit(message: string): Promise<void> {
    await this.ensureInitialized()
    
    if (!this.db) {
      throw new Error('Database not initialized')
    }
    
    try {
      // Log the commit to a commits table (optional since we don't need git-versioned SQL)
      const now = new Date()
      const commitHash = crypto.randomUUID()
      
      // Create commits table if it doesn't exist
      this.db.prepare(`
        CREATE TABLE IF NOT EXISTS commits (
          hash TEXT PRIMARY KEY,
          message TEXT NOT NULL,
          author TEXT NOT NULL,
          timestamp INTEGER NOT NULL
        )
      `).run()
      
      // Insert commit record
      this.db.prepare(`
        INSERT INTO commits (hash, message, author, timestamp)
        VALUES (?, ?, ?, ?)
      `).run(commitHash, message, 'SuperClaw Agent', now.getTime())
      
      console.log(`SQLite commit logged: ${message} (${commitHash})`)
    } catch (error: unknown) {
      // Commits are optional for SQLite, so we just log errors rather than throw
      console.warn(`Commit logging failed: ${error instanceof Error ? (error).message : String(error)}`)
    }
  }
  
  async branch(name: string): Promise<void> {
    // No-op for SQLite - branches are a Dolt concept
    console.log(`SQLite: Branch operation '${name}' is not supported (no-op)`)
  }
  
  async merge(branch: string): Promise<void> {
    // No-op for SQLite - merges are a Dolt concept
    console.log(`SQLite: Merge operation for '${branch}' is not supported (no-op)`)
  }
  
  async getHistory(table?: string, limit: number = 10): Promise<CommitInfo[]> {
    await this.ensureInitialized()
    
    if (!this.db) {
      throw new Error('Database not initialized')
    }
    
    try {
      // Return commit history from our commits table
      const commits = this.db.prepare(`
        SELECT hash, message, author, timestamp
        FROM commits
        ORDER BY timestamp DESC
        LIMIT ?
      `).all(limit) as any[]
      
      return commits.map(commit => ({
        hash: commit.hash,
        message: commit.message,
        author: commit.author,
        date: new Date(commit.timestamp).toISOString()
      }))
    } catch (error: unknown) {
      // If commits table doesn't exist, return empty array
      return []
    }
  }
  
  async diff(fromCommit: string, toCommit: string = 'HEAD'): Promise<DiffResult[]> {
    // SQLite doesn't support diffs between commits like Dolt
    console.warn(`SQLite: Diff operation between '${fromCommit}' and '${toCommit}' is not supported`)
    return []
  }
  
  async getCurrentBranch(): Promise<string> {
    // SQLite only has one "branch" - main
    return 'main'
  }
  
  async listBranches(): Promise<string[]> {
    // SQLite only has one "branch" - main
    return ['main']
  }
  
  async reset(commit?: string, hard: boolean = false): Promise<void> {
    // Reset is not supported in SQLite - it's a Dolt/git concept
    console.warn(`SQLite: Reset operation is not supported`)
  }
  
  private async retryOperation<T>(operation: () => T): Promise<T> {
    let lastError: Error | null = null
    
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return operation()
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error))
        
        if (attempt < this.maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, this.retryDelay * (attempt + 1)))
        }
      }
    }
    
    throw lastError || new Error('Unknown error in retry operation')
  }
  
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize()
    }
  }
  
  private async runSchemaMigrations(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized')
    }
    
    // Default schema for agent memory (converted from MySQL to SQLite syntax)
    const schema = `
      CREATE TABLE IF NOT EXISTS agent_memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        session_id TEXT,
        memory_type TEXT NOT NULL CHECK (memory_type IN ('episodic', 'semantic', 'procedural', 'working')),
        content TEXT NOT NULL,
        metadata TEXT,
        importance_score REAL DEFAULT 0.0,
        access_count INTEGER DEFAULT 0,
        last_accessed INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );

      CREATE INDEX IF NOT EXISTS idx_agent_id ON agent_memories(agent_id);
      CREATE INDEX IF NOT EXISTS idx_session_id ON agent_memories(session_id);
      CREATE INDEX IF NOT EXISTS idx_memory_type ON agent_memories(memory_type);
      CREATE INDEX IF NOT EXISTS idx_importance ON agent_memories(importance_score);
      CREATE INDEX IF NOT EXISTS idx_created ON agent_memories(created_at);

      CREATE TABLE IF NOT EXISTS agent_contexts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        context_key TEXT NOT NULL,
        context_value TEXT NOT NULL,
        expires_at INTEGER,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        UNIQUE(agent_id, context_key)
      );

      CREATE INDEX IF NOT EXISTS idx_expires ON agent_contexts(expires_at);

      CREATE TABLE IF NOT EXISTS agent_relationships (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_agent_id TEXT NOT NULL,
        target_agent_id TEXT NOT NULL,
        relationship_type TEXT NOT NULL,
        strength REAL DEFAULT 1.0,
        metadata TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        UNIQUE(source_agent_id, target_agent_id, relationship_type)
      );

      CREATE INDEX IF NOT EXISTS idx_source ON agent_relationships(source_agent_id);
      CREATE INDEX IF NOT EXISTS idx_target ON agent_relationships(target_agent_id);
    `
    
    try {
      this.db.exec(schema)
      console.log('SQLite schema migrations completed successfully')
    } catch (error: unknown) {
      console.warn(`Schema migration warning: ${error}`)
      // Continue even if schema migration has issues
    }
  }
  
  // Cleanup method for proper shutdown
  async close(): Promise<void> {
    if (this.db) {
      this.db.close()
      this.db = null
    }
    this.initialized = false
  }
}

export default SqliteService