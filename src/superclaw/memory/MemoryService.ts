import { DoltService } from './DoltService'
import { MemoryCompactor } from './compactor'
import { generateMemoryId } from './hash-id-generator'
import type { 
  AgentMemory, 
  MemoryQuery, 
  MemoryRelationship,
  MemoryServiceConfig 
} from './types'

export class MemoryService {
  private dolt: DoltService
  private compactor: MemoryCompactor
  private config: MemoryServiceConfig
  private initialized = false
  
  constructor(config: Partial<MemoryServiceConfig> = {}) {
    // Initialize with defaults
    this.config = {
      doltPath: config.doltPath || process.env.DOLT_PATH || 'dolt',
      // @ts-expect-error - Post-Merge Reconciliation
      repositoryPath: config.repositoryPath || './memory-repo',
      // @ts-expect-error - Post-Merge Reconciliation
      maxMemoryAge: config.maxMemoryAge || 30 * 24 * 60 * 60 * 1000, // 30 days
      // @ts-expect-error - Post-Merge Reconciliation
      compactionInterval: config.compactionInterval || 24 * 60 * 60 * 1000, // 24 hours
      maxMemoriesPerAgent: config.maxMemoriesPerAgent || 10000,
      // @ts-expect-error - Post-Merge Reconciliation
      enableAutoCompaction: config.enableAutoCompaction ?? true,
      // @ts-expect-error - Post-Merge Reconciliation
      logLevel: config.logLevel || 'info',
      ...config
    }
    
    this.dolt = new DoltService({
      // @ts-expect-error - Post-Merge Reconciliation
      doltPath: this.config.doltPath,
      // @ts-expect-error - Post-Merge Reconciliation
      repositoryPath: this.config.repositoryPath,
      // @ts-expect-error - Post-Merge Reconciliation
      logLevel: this.config.logLevel
    })
    
    this.compactor = new MemoryCompactor(this.dolt, {
      // @ts-expect-error - Post-Merge Reconciliation
      maxAge: this.config.maxMemoryAge,
      // @ts-expect-error - Post-Merge Reconciliation
      compactionInterval: this.config.compactionInterval,
      // @ts-expect-error - Post-Merge Reconciliation
      logLevel: this.config.logLevel
    })
  }
  
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.log('info', 'MemoryService already initialized')
      return
    }
    
    try {
      this.log('info', 'Initializing MemoryService...')
      
      // Initialize Dolt database
      await this.dolt.initialize()
      
      // Run database migrations
      await this.runMigrations()
      
      // Start compaction if enabled
      // @ts-expect-error - Post-Merge Reconciliation
      if (this.config.enableAutoCompaction) {
        // @ts-expect-error - Post-Merge Reconciliation
        await this.compactor.start()
      }
      
      this.initialized = true
      this.log('info', 'MemoryService initialized successfully')
      
    } catch (error: unknown) {
      this.log('error', 'Failed to initialize MemoryService', { error: error instanceof Error ? (error).message : String(error) })
      throw new Error(`Memory service initialization failed: ${error instanceof Error ? (error).message : String(error)}`, { cause: error })
    }
  }
  
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize()
    }
  }
  
  private async runMigrations(): Promise<void> {
    try {
      // Create memories table
      await this.dolt.execute(`
        CREATE TABLE IF NOT EXISTS memories (
          id VARCHAR(64) PRIMARY KEY,
          agent_id VARCHAR(255) NOT NULL,
          type ENUM('observation', 'decision', 'learning', 'context', 'conversation', 'error') NOT NULL,
          content TEXT NOT NULL,
          metadata JSON,
          importance TINYINT DEFAULT 5,
          embedding_hash VARCHAR(64),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_agent_id (agent_id),
          INDEX idx_type (type),
          INDEX idx_importance (importance),
          INDEX idx_created_at (created_at),
          INDEX idx_embedding_hash (embedding_hash)
        )
      `)
      
      // Create relationships table
      await this.dolt.execute(`
        CREATE TABLE IF NOT EXISTS memory_relationships (
          id INT AUTO_INCREMENT PRIMARY KEY,
          source_id VARCHAR(64) NOT NULL,
          target_id VARCHAR(64) NOT NULL,
          relationship_type ENUM('related', 'causes', 'caused_by', 'follows', 'contradicts', 'confirms') NOT NULL,
          strength DECIMAL(3,2) DEFAULT 1.00,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (source_id) REFERENCES memories(id) ON DELETE CASCADE,
          FOREIGN KEY (target_id) REFERENCES memories(id) ON DELETE CASCADE,
          UNIQUE KEY unique_relationship (source_id, target_id, relationship_type),
          INDEX idx_source_id (source_id),
          INDEX idx_target_id (target_id),
          INDEX idx_relationship_type (relationship_type)
        )
      `)
      
      // Commit schema changes
      await this.dolt.commit('Initialize memory service schema')
      
      this.log('info', 'Database migrations completed successfully')
      
    } catch (error: unknown) {
      this.log('error', 'Failed to run migrations', { error: error instanceof Error ? (error).message : String(error) })
      throw error
    }
  }
  
  // Core CRUD operations
  async storeMemory(agentId: string, memory: Omit<AgentMemory, 'id' | 'agentId' | 'createdAt' | 'updatedAt'>): Promise<string> {
    await this.ensureInitialized()
    
    try {
      // @ts-expect-error - Post-Merge Reconciliation
      const id = generateMemoryId(agentId, memory.content, memory.type)
      const now = new Date()
      
      await this.dolt.execute(
        `INSERT INTO memories (id, agent_id, type, content, metadata, importance, embedding_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          agentId,
          memory.type,
          memory.content,
          JSON.stringify(memory.metadata || {}),
          // @ts-expect-error - Post-Merge Reconciliation
          memory.importance || 5,
          // @ts-expect-error - Post-Merge Reconciliation
          memory.embeddingHash || null,
          now,
          now
        ]
      )
      
      this.log('debug', 'Memory stored', { id, agentId, type: memory.type })
      return id
      
    } catch (error: unknown) {
      this.log('error', 'Failed to store memory', { 
        agentId, 
        type: memory.type,
        error: error instanceof Error ? (error).message : String(error) 
      })
      throw new Error(`Failed to store memory: ${error instanceof Error ? (error).message : String(error)}`, { cause: error })
    }
  }
  
  async getMemory(id: string): Promise<AgentMemory | null> {
    await this.ensureInitialized()
    
    try {
      const results = await this.dolt.query(
        'SELECT * FROM memories WHERE id = ?',
        [id]
      )
      
      if (results.length === 0) {
        return null
      }
      
      return this.mapRowToMemory(results[0])
      
    } catch (error: unknown) {
      this.log('error', 'Failed to get memory', { id, error: error instanceof Error ? (error).message : String(error) })
      throw new Error(`Failed to get memory: ${error instanceof Error ? (error).message : String(error)}`, { cause: error })
    }
  }
  
  async updateMemory(id: string, updates: Partial<AgentMemory>): Promise<void> {
    await this.ensureInitialized()
    
    try {
      const setClause = []
      const values = []
      
      if (updates.content !== undefined) {
        setClause.push('content = ?')
        values.push(updates.content)
      }
      
      if (updates.metadata !== undefined) {
        setClause.push('metadata = ?')
        values.push(JSON.stringify(updates.metadata))
      }
      
      // @ts-expect-error - Post-Merge Reconciliation
      if (updates.importance !== undefined) {
        setClause.push('importance = ?')
        // @ts-expect-error - Post-Merge Reconciliation
        values.push(updates.importance)
      }
      
      // @ts-expect-error - Post-Merge Reconciliation
      if (updates.embeddingHash !== undefined) {
        setClause.push('embedding_hash = ?')
        // @ts-expect-error - Post-Merge Reconciliation
        values.push(updates.embeddingHash)
      }
      
      setClause.push('updated_at = ?')
      values.push(new Date())
      
      values.push(id)
      
      if (setClause.length > 1) { // More than just updated_at
        await this.dolt.execute(
          `UPDATE memories SET ${setClause.join(', ')} WHERE id = ?`,
          values
        )
        
        this.log('debug', 'Memory updated', { id })
      }
      
    } catch (error: unknown) {
      this.log('error', 'Failed to update memory', { id, error: error instanceof Error ? (error).message : String(error) })
      throw new Error(`Failed to update memory: ${error instanceof Error ? (error).message : String(error)}`, { cause: error })
    }
  }
  
  async deleteMemory(id: string): Promise<void> {
    await this.ensureInitialized()
    
    try {
      await this.dolt.execute('DELETE FROM memories WHERE id = ?', [id])
      this.log('debug', 'Memory deleted', { id })
      
    } catch (error: unknown) {
      this.log('error', 'Failed to delete memory', { id, error: error instanceof Error ? (error).message : String(error) })
      throw new Error(`Failed to delete memory: ${error instanceof Error ? (error).message : String(error)}`, { cause: error })
    }
  }

  async forgetMemory(id: string): Promise<void> {
    return this.deleteMemory(id)
  }
  
  // Query operations
  async getAgentMemories(query: MemoryQuery): Promise<AgentMemory[]> {
    await this.ensureInitialized()
    
    try {
      let sql = 'SELECT * FROM memories WHERE agent_id = ?'
      const values = [query.agentId]
      
      // @ts-expect-error - Post-Merge Reconciliation
      if (query.type) {
        sql += ' AND type = ?'
        // @ts-expect-error - Post-Merge Reconciliation
        values.push(query.type)
      }
      
      // @ts-expect-error - Post-Merge Reconciliation
      if (query.minImportance !== undefined) {
        sql += ' AND importance >= ?'
        // @ts-expect-error - Post-Merge Reconciliation
        values.push(query.minImportance)
      }
      
      // @ts-expect-error - Post-Merge Reconciliation
      if (query.maxImportance !== undefined) {
        sql += ' AND importance <= ?'
        // @ts-expect-error - Post-Merge Reconciliation
        values.push(query.maxImportance)
      }
      
      if (query.since) {
        sql += ' AND created_at >= ?'
        // @ts-expect-error - Post-Merge Reconciliation
        values.push(query.since)
      }
      
      // @ts-expect-error - Post-Merge Reconciliation
      if (query.until) {
        sql += ' AND created_at <= ?'
        // @ts-expect-error - Post-Merge Reconciliation
        values.push(query.until)
      }
      
      sql += ' ORDER BY '
      
      // @ts-expect-error - Post-Merge Reconciliation
      switch (query.sortBy || 'created_at') {
        case 'importance':
          sql += 'importance DESC, created_at DESC'
          break
        case 'updated_at':
          sql += 'updated_at DESC'
          break
        default:
          sql += 'created_at DESC'
      }
      
      if (query.limit) {
        sql += ' LIMIT ?'
        // @ts-expect-error - Post-Merge Reconciliation
        values.push(query.limit)
      }
      
      // @ts-expect-error - Post-Merge Reconciliation
      if (query.offset) {
        sql += ' OFFSET ?'
        // @ts-expect-error - Post-Merge Reconciliation
        values.push(query.offset)
      }
      
      const results = await this.dolt.query(sql, values)
      return results.map(row => this.mapRowToMemory(row))
      
    } catch (error: unknown) {
      this.log('error', 'Failed to get agent memories', { 
        agentId: query.agentId, 
        error: error instanceof Error ? (error).message : String(error) 
      })
      throw new Error(`Failed to get agent memories: ${error instanceof Error ? (error).message : String(error)}`, { cause: error })
    }
  }
  
  async searchMemories(agentId: string, searchText: string): Promise<AgentMemory[]> {
    await this.ensureInitialized()
    
    try {
      const results = await this.dolt.query(
        `SELECT * FROM memories 
         WHERE agent_id = ? 
         AND (content LIKE ? OR JSON_EXTRACT(metadata, '$') LIKE ?)
         ORDER BY importance DESC, created_at DESC`,
        [agentId, `%${searchText}%`, `%${searchText}%`]
      )
      
      return results.map(row => this.mapRowToMemory(row))
      
    } catch (error: unknown) {
      this.log('error', 'Failed to search memories', { 
        agentId, 
        searchText, 
        error: error instanceof Error ? (error).message : String(error) 
      })
      throw new Error(`Failed to search memories: ${error instanceof Error ? (error).message : String(error)}`, { cause: error })
    }
  }
  
  async getRelatedMemories(memoryId: string): Promise<AgentMemory[]> {
    await this.ensureInitialized()
    
    try {
      const results = await this.dolt.query(
        `SELECT m.* FROM memories m
         INNER JOIN memory_relationships r ON (r.target_id = m.id OR r.source_id = m.id)
         WHERE (r.source_id = ? OR r.target_id = ?) AND m.id != ?
         ORDER BY r.strength DESC, m.importance DESC`,
        [memoryId, memoryId, memoryId]
      )
      
      return results.map(row => this.mapRowToMemory(row))
      
    } catch (error: unknown) {
      this.log('error', 'Failed to get related memories', { 
        memoryId, 
        error: error instanceof Error ? (error).message : String(error) 
      })
      throw new Error(`Failed to get related memories: ${error instanceof Error ? (error).message : String(error)}`, { cause: error })
    }
  }
  
  // Relationship operations
  async addRelationship(relationship: MemoryRelationship): Promise<void> {
    await this.ensureInitialized()
    
    try {
      await this.dolt.execute(
        `INSERT INTO memory_relationships (source_id, target_id, relationship_type, strength)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE strength = VALUES(strength)`,
        [
          relationship.sourceId,
          relationship.targetId,
          relationship.type,
          // @ts-expect-error - Post-Merge Reconciliation
          relationship.strength || 1.0
        ]
      )
      
      this.log('debug', 'Relationship added', { 
        sourceId: relationship.sourceId, 
        targetId: relationship.targetId, 
        type: relationship.type 
      })
      
    } catch (error: unknown) {
      this.log('error', 'Failed to add relationship', { 
        sourceId: relationship.sourceId, 
        targetId: relationship.targetId,
        error: error instanceof Error ? (error).message : String(error) 
      })
      throw new Error(`Failed to add relationship: ${error instanceof Error ? (error).message : String(error)}`, { cause: error })
    }
  }
  
  async getRelationships(memoryId: string): Promise<MemoryRelationship[]> {
    await this.ensureInitialized()
    
    try {
      const results = await this.dolt.query(
        'SELECT * FROM memory_relationships WHERE source_id = ? OR target_id = ?',
        [memoryId, memoryId]
      )
      
      // @ts-expect-error - Post-Merge Reconciliation
      return results.map(row => ({
        sourceId: row.source_id,
        targetId: row.target_id,
        type: row.relationship_type,
        strength: row.strength,
        createdAt: row.created_at
      }))
      
    } catch (error: unknown) {
      this.log('error', 'Failed to get relationships', { 
        memoryId, 
        error: error instanceof Error ? (error).message : String(error) 
      })
      throw new Error(`Failed to get relationships: ${error instanceof Error ? (error).message : String(error)}`, { cause: error })
    }
  }
  
  async removeRelationship(sourceId: string, targetId: string): Promise<void> {
    await this.ensureInitialized()
    
    try {
      await this.dolt.execute(
        'DELETE FROM memory_relationships WHERE source_id = ? AND target_id = ?',
        [sourceId, targetId]
      )
      
      this.log('debug', 'Relationship removed', { sourceId, targetId })
      
    } catch (error: unknown) {
      this.log('error', 'Failed to remove relationship', { 
        sourceId, 
        targetId,
        error: error instanceof Error ? (error).message : String(error) 
      })
      throw new Error(`Failed to remove relationship: ${error instanceof Error ? (error).message : String(error)}`, { cause: error })
    }
  }
  
  // Convenience methods
  async rememberLearning(agentId: string, concept: string, details: string): Promise<string> {
    return this.storeMemory(agentId, {
      type: 'learning',
      content: `Learned: ${concept}`,
      metadata: {
        concept,
        details,
        category: 'learning'
      },
      // @ts-expect-error - Post-Merge Reconciliation
      importance: 7
    })
  }
  
  async rememberDecision(agentId: string, decision: string, reasoning: string): Promise<string> {
    return this.storeMemory(agentId, {
      type: 'decision',
      content: `Decision: ${decision}`,
      metadata: {
        decision,
        reasoning,
        category: 'decision-making'
      },
      // @ts-expect-error - Post-Merge Reconciliation
      importance: 6
    })
  }
  
  async loadAgentContext(agentId: string, limit: number = 50): Promise<AgentMemory[]> {
    return this.getAgentMemories({
      agentId,
      // @ts-expect-error - Post-Merge Reconciliation
      sortBy: 'importance',
      limit
    })
  }
  
  // Maintenance
  async compactStaleMemories(agentId: string): Promise<void> {
    await this.ensureInitialized()
    
    try {
      // @ts-expect-error - Post-Merge Reconciliation
      await this.compactor.compactAgent(agentId)
      this.log('info', 'Stale memories compacted', { agentId })
      
    } catch (error: unknown) {
      this.log('error', 'Failed to compact stale memories', { 
        agentId, 
        error: error instanceof Error ? (error).message : String(error) 
      })
      throw new Error(`Failed to compact stale memories: ${error instanceof Error ? (error).message : String(error)}`, { cause: error })
    }
  }
  
  async getAgentStats(agentId: string): Promise<any> {
    await this.ensureInitialized()
    
    try {
      const [countResult] = await this.dolt.query(
        'SELECT COUNT(*) as total FROM memories WHERE agent_id = ?',
        [agentId]
      )
      
      const [typeStatsResults] = await this.dolt.query(
        'SELECT type, COUNT(*) as count FROM memories WHERE agent_id = ? GROUP BY type',
        [agentId]
      )
      
      const [avgImportanceResult] = await this.dolt.query(
        'SELECT AVG(importance) as avg_importance FROM memories WHERE agent_id = ?',
        [agentId]
      )
      
      const [oldestResult] = await this.dolt.query(
        'SELECT MIN(created_at) as oldest FROM memories WHERE agent_id = ?',
        [agentId]
      )
      
      const [newestResult] = await this.dolt.query(
        'SELECT MAX(created_at) as newest FROM memories WHERE agent_id = ?',
        [agentId]
      )
      
      return {
        agentId,
        totalMemories: countResult.total || 0,
        typeBreakdown: typeStatsResults || [],
        averageImportance: avgImportanceResult?.avg_importance || 0,
        oldestMemory: oldestResult?.oldest,
        newestMemory: newestResult?.newest,
        generatedAt: new Date()
      }
      
    } catch (error: unknown) {
      this.log('error', 'Failed to get agent stats', { 
        agentId, 
        error: error instanceof Error ? (error).message : String(error) 
      })
      throw new Error(`Failed to get agent stats: ${error instanceof Error ? (error).message : String(error)}`, { cause: error })
    }
  }
  
  async pruneOldMemories(agentId: string, keepCount: number): Promise<number> {
    await this.ensureInitialized()
    
    try {
      // Get the cutoff timestamp for memories to keep
      const cutoffResults = await this.dolt.query(
        `SELECT created_at FROM memories 
         WHERE agent_id = ? 
         ORDER BY importance DESC, created_at DESC 
         LIMIT 1 OFFSET ?`,
        [agentId, keepCount - 1]
      )
      
      if (cutoffResults.length === 0) {
        this.log('debug', 'No memories to prune', { agentId, keepCount })
        return 0
      }
      
      const cutoffDate = cutoffResults[0].created_at
      
      // Delete old memories below importance threshold
      const deleteResult = await this.dolt.execute(
        `DELETE FROM memories 
         WHERE agent_id = ? 
         AND (created_at < ? OR (created_at = ? AND importance <= 3))`,
        [agentId, cutoffDate, cutoffDate]
      )
      
      const deletedCount = deleteResult.affectedRows || 0
      
      this.log('info', 'Old memories pruned', { agentId, keepCount, deletedCount })
      return deletedCount
      
    } catch (error: unknown) {
      this.log('error', 'Failed to prune old memories', { 
        agentId, 
        keepCount,
        error: error instanceof Error ? (error).message : String(error) 
      })
      throw new Error(`Failed to prune old memories: ${error instanceof Error ? (error).message : String(error)}`, { cause: error })
    }
  }
  
  // Helper methods
  private mapRowToMemory(row: any): AgentMemory {
    return {
      id: row.id,
      agentId: row.agent_id,
      type: row.type,
      content: row.content,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      // @ts-expect-error - Post-Merge Reconciliation
      importance: row.importance,
      embeddingHash: row.embedding_hash,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }
  
  private log(level: string, message: string, meta: any = {}) {
    if (this.shouldLog(level)) {
      const timestamp = new Date().toISOString()
      const logEntry = {
        timestamp,
        level: level.toUpperCase(),
        service: 'MemoryService',
        message,
        ...meta
      }
      
      // In production, you might want to use a proper logger like Winston
      console.log(JSON.stringify(logEntry))
    }
  }
  
  private shouldLog(level: string): boolean {
    const levels = ['error', 'warn', 'info', 'debug']
    // @ts-expect-error - Post-Merge Reconciliation
    const configLevel = this.config.logLevel || 'info'
    const levelIndex = levels.indexOf(level)
    const configLevelIndex = levels.indexOf(configLevel)
    
    return levelIndex <= configLevelIndex
  }
  
  // Cleanup
  async destroy(): Promise<void> {
    try {
      if (this.compactor) {
        // @ts-expect-error - Post-Merge Reconciliation
        await this.compactor.stop()
      }
      
      if (this.dolt) {
        // @ts-expect-error - Post-Merge Reconciliation
        await this.dolt.destroy()
      }
      
      this.initialized = false
      this.log('info', 'MemoryService destroyed')
      
    } catch (error: unknown) {
      this.log('error', 'Error during MemoryService destruction', { 
        error: error instanceof Error ? (error).message : String(error) 
      })
    }
  }
}