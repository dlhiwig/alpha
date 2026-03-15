/**
 * BEADS Memory Adapter for SuperClaw CORTEX
 * 
 * This adapter integrates Steve Yegge's BEADS system into SuperClaw's existing
 * memory architecture, providing persistent, dependency-aware task tracking
 * with git-backed storage and AI-powered memory compaction.
 * 
 * Key Features:
 * - Hash-based collision-resistant IDs (bd-a1b2 format)
 * - Dependency graph with blocking/non-blocking relationships
 * - Memory decay through AI-powered compaction
 * - Hierarchical task breakdown (Epic → Task → Sub-task)
 * - Git integration for version control and collaboration
 * - Agent state tracking and coordination
 * 
 * @fileoverview BEADS integration for SuperClaw memory system
 * @version 1.0.0
 * @author SuperClaw Subagent
 */

import { SqliteService } from './SqliteService'
import { MemoryCompactor } from './compactor'
import { generateMemoryId } from './hash-id-generator'
import { exec } from 'child_process'
import { promisify } from 'util'
import * as crypto from 'crypto'
import * as path from 'path'
import * as fs from 'fs/promises'
import type { 
  AgentMemory, 
  MemoryQuery,
  MemoryServiceConfig,
  MemoryType,
  MemoryStatus
} from './types'

const execAsync = promisify(exec)

/**
 * BEADS-specific types extending SuperClaw memory model
 */
export interface BeadsIssue {
  /** Hash-based ID (e.g., bd-a1b2, epic-c3d4) */
  id: string
  
  /** Content hash for deduplication */
  contentHash?: string
  
  /** Issue title (1-500 chars) */
  title: string
  
  /** Detailed description */
  description?: string
  
  /** Design documentation */
  design?: string
  
  /** Acceptance criteria */
  acceptanceCriteria?: string
  
  /** Additional notes */
  notes?: string
  
  /** Current status */
  status: BeadsStatus
  
  /** Priority level (0=P0/critical, 4=P4/backlog) */
  priority: number
  
  /** Issue type classification */
  issueType: BeadsIssueType
  
  /** Assigned agent or user */
  assignee?: string
  
  /** Owner for attribution */
  owner?: string
  
  /** Estimated effort in minutes */
  estimatedMinutes?: number
  
  /** Creation timestamp */
  createdAt: Date
  
  /** Creator identifier */
  createdBy?: string
  
  /** Last update timestamp */
  updatedAt: Date
  
  /** Close timestamp */
  closedAt?: Date
  
  /** Reason for closure */
  closeReason?: string
  
  /** External system reference */
  externalRef?: string
  
  /** Source system for federation */
  sourceSystem?: string
  
  /** Custom metadata as JSON */
  metadata?: Record<string, any>
  
  /** Compaction metadata */
  compactionLevel: number
  compactedAt?: Date
  compactedAtCommit?: string
  originalSize?: number
  
  /** Agent-specific fields */
  agentState?: AgentState
  hookBead?: string
  roleBead?: string
  lastActivity?: Date
  
  /** Relational data (populated on demand) */
  dependencies?: BeadsDependency[]
  labels?: string[]
  comments?: BeadsComment[]
}

export interface BeadsDependency {
  issueId: string
  dependsOnId: string
  type: DependencyType
  createdAt: Date
  createdBy: string
  metadata?: Record<string, any>
  threadId?: string
}

export interface BeadsComment {
  id: number
  issueId: string
  author: string
  text: string
  createdAt: Date
}

/**
 * BEADS status enumeration
 */
export type BeadsStatus = 
  | 'open' 
  | 'in_progress' 
  | 'blocked' 
  | 'deferred' 
  | 'closed'
  | 'tombstone'

/**
 * BEADS issue types
 */
export type BeadsIssueType = 
  | 'bug' 
  | 'feature' 
  | 'task' 
  | 'epic' 
  | 'chore' 
  | 'decision' 
  | 'message'
  | 'learning'
  | 'context'
  | 'capability'
  | 'relationship'

/**
 * BEADS dependency types with workflow semantics
 */
export type DependencyType =
  // Workflow dependencies (affect ready work calculation)
  | 'blocks'              // A blocks B - B cannot start until A is done
  | 'parent-child'        // A contains B - epic/subtask relationship
  | 'conditional-blocks'  // B runs only if A fails
  | 'waits-for'          // A waits for B - similar to blocks
  // Knowledge graph links
  | 'relates-to'         // Loose knowledge connections
  | 'replies-to'         // Conversation threading
  | 'duplicates'         // Deduplication links
  | 'supersedes'         // Version chains
  // Entity relationships
  | 'authored-by'        // Creator attribution
  | 'assigned-to'        // Work assignment
  | 'approved-by'        // Validation chains
  | 'attests'           // Skill certification
  // Federation & tracking
  | 'tracks'            // Cross-project references
  | 'caused-by'         // Audit trail linkage
  | 'validates'         // Quality gates
  | 'delegated-from'    // Work delegation chains

/**
 * Agent state enumeration
 */
export type AgentState = 
  | 'idle' 
  | 'spawning' 
  | 'working' 
  | 'stuck' 
  | 'done' 
  | 'stopped' 
  | 'dead'

/**
 * Query interface for BEADS issues
 */
export interface BeadsQuery {
  agentId?: string
  status?: BeadsStatus[]
  issueType?: BeadsIssueType[]
  assignee?: string
  priority?: { min?: number; max?: number }
  since?: Date
  until?: Date
  limit?: number
  offset?: number
  sortBy?: 'created_at' | 'updated_at' | 'priority' | 'title'
  includeRelationships?: boolean
  searchText?: string
}

/**
 * Ready work detection options
 */
export interface ReadyWorkOptions {
  agentId?: string
  priorities?: number[]
  excludeTypes?: BeadsIssueType[]
  limit?: number
}

/**
 * BEADS Memory Adapter implementing SuperClaw CORTEX interface
 */
export class BeadsMemory {
  private dolt: SqliteService
  private compactor?: MemoryCompactor
  private config: BeadsMemoryConfig
  private initialized = false
  
  constructor(config: Partial<BeadsMemoryConfig> = {}) {
    this.config = {
      doltPath: config.doltPath || process.env.DOLT_PATH || 'dolt',
      repositoryPath: config.repositoryPath || './beads-memory',
      defaultPrefix: config.defaultPrefix || 'bd',
      maxMemoryAge: config.maxMemoryAge || 30 * 24 * 60 * 60 * 1000,
      compactionInterval: config.compactionInterval || 24 * 60 * 60 * 1000,
      enableAutoCompaction: config.enableAutoCompaction ?? true,
      enableGitIntegration: config.enableGitIntegration ?? true,
      logLevel: config.logLevel || 'info',
      ...config
    }
    
    this.dolt = new SqliteService({
      dbPath: this.config.repositoryPath,
      timeout: 30000,
      maxRetries: 3
    })
    
    // Initialize compactor only if auto-compaction is enabled and API key is available
    // NOTE: Compactor disabled for SQLite transition - it was designed for DoltService
    if (false && this.config.enableAutoCompaction && process.env.ANTHROPIC_API_KEY) {
      try {
        // this.compactor = new MemoryCompactor(this.dolt, {
        //   olderThan: '30 days',
        //   minSize: 500,
        //   maxCompactionLevel: 2,
        //   compressionTarget: 0.5
        // })
      } catch (error: unknown) {
        this.log('warn', 'Failed to initialize MemoryCompactor, compaction disabled', { 
          error: error instanceof Error ? (error as Error).message : String(error) 
        })
        // Continue without compactor
      }
    }
  }
  
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.log('info', 'BeadsMemory already initialized')
      return
    }
    
    try {
      this.log('info', 'Initializing BEADS memory system...')
      
      // Initialize Dolt database
      await this.dolt.initialize()
      
      // Run BEADS schema migrations
      await this.runBeadsSchema()
      
      // Compactor is ready for use (no start method needed)
      
      // Configure git integration
      if (this.config.enableGitIntegration) {
        await this.setupGitIntegration()
      }
      
      this.initialized = true
      this.log('info', 'BEADS memory system initialized successfully')
      
    } catch (error: unknown) {
      this.log('error', 'Failed to initialize BEADS memory', { 
        error: error instanceof Error ? (error as Error).message : String(error) 
      })
      throw new Error(`BEADS memory initialization failed: ${error instanceof Error ? (error as Error).message : String(error)}`)
    }
  }
  
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize()
    }
  }
  
  /**
   * Create BEADS database schema compatible with SuperClaw
   */
  private async runBeadsSchema(): Promise<void> {
    try {
      // Issues table with BEADS extensions
      await this.dolt.execute(`
        CREATE TABLE IF NOT EXISTS beads_issues (
          id VARCHAR(255) PRIMARY KEY,
          content_hash VARCHAR(64),
          title VARCHAR(500) NOT NULL,
          description TEXT,
          design TEXT,
          acceptance_criteria TEXT,
          notes TEXT,
          status VARCHAR(32) NOT NULL DEFAULT 'open',
          priority INT NOT NULL DEFAULT 2,
          issue_type VARCHAR(32) NOT NULL DEFAULT 'task',
          assignee VARCHAR(255),
          owner VARCHAR(255),
          estimated_minutes INT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          created_by VARCHAR(255),
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          closed_at DATETIME,
          close_reason TEXT,
          external_ref VARCHAR(255),
          source_system VARCHAR(255),
          metadata JSON,
          
          -- Compaction fields
          compaction_level INT DEFAULT 0,
          compacted_at DATETIME,
          compacted_at_commit VARCHAR(64),
          original_size INT,
          
          -- Agent fields
          agent_state VARCHAR(32),
          hook_bead VARCHAR(255),
          role_bead VARCHAR(255),
          last_activity DATETIME,
          
          -- Indexes for performance
          INDEX idx_beads_status (status),
          INDEX idx_beads_priority (priority),
          INDEX idx_beads_issue_type (issue_type),
          INDEX idx_beads_assignee (assignee),
          INDEX idx_beads_created_at (created_at),
          INDEX idx_beads_agent_state (agent_state),
          INDEX idx_beads_content_hash (content_hash)
        )
      `)
      
      // Dependencies table with rich relationship types
      await this.dolt.execute(`
        CREATE TABLE IF NOT EXISTS beads_dependencies (
          issue_id VARCHAR(255) NOT NULL,
          depends_on_id VARCHAR(255) NOT NULL,
          type VARCHAR(32) NOT NULL DEFAULT 'blocks',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          created_by VARCHAR(255) NOT NULL,
          metadata JSON,
          thread_id VARCHAR(255),
          PRIMARY KEY (issue_id, depends_on_id, type),
          INDEX idx_beads_deps_issue (issue_id),
          INDEX idx_beads_deps_depends_on (depends_on_id),
          INDEX idx_beads_deps_type (type),
          INDEX idx_beads_deps_thread (thread_id),
          FOREIGN KEY (issue_id) REFERENCES beads_issues(id) ON DELETE CASCADE
        )
      `)
      
      // Labels table
      await this.dolt.execute(`
        CREATE TABLE IF NOT EXISTS beads_labels (
          issue_id VARCHAR(255) NOT NULL,
          label VARCHAR(255) NOT NULL,
          PRIMARY KEY (issue_id, label),
          INDEX idx_beads_labels_label (label),
          FOREIGN KEY (issue_id) REFERENCES beads_issues(id) ON DELETE CASCADE
        )
      `)
      
      // Comments table
      await this.dolt.execute(`
        CREATE TABLE IF NOT EXISTS beads_comments (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          issue_id VARCHAR(255) NOT NULL,
          author VARCHAR(255) NOT NULL,
          text TEXT NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_beads_comments_issue (issue_id),
          INDEX idx_beads_comments_created_at (created_at),
          FOREIGN KEY (issue_id) REFERENCES beads_issues(id) ON DELETE CASCADE
        )
      `)
      
      // Events table for audit trail
      await this.dolt.execute(`
        CREATE TABLE IF NOT EXISTS beads_events (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          issue_id VARCHAR(255) NOT NULL,
          event_type VARCHAR(32) NOT NULL,
          actor VARCHAR(255) NOT NULL,
          old_value TEXT,
          new_value TEXT,
          comment TEXT,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_beads_events_issue (issue_id),
          INDEX idx_beads_events_type (event_type),
          INDEX idx_beads_events_created_at (created_at),
          FOREIGN KEY (issue_id) REFERENCES beads_issues(id) ON DELETE CASCADE
        )
      `)
      
      // Commit schema changes
      await this.dolt.commit('Initialize BEADS schema')
      
      this.log('info', 'BEADS database schema created successfully')
      
    } catch (error: unknown) {
      this.log('error', 'Failed to create BEADS schema', { 
        error: error instanceof Error ? (error as Error).message : String(error) 
      })
      throw error
    }
  }
  
  /**
   * Setup git integration for JSONL export/import
   */
  private async setupGitIntegration(): Promise<void> {
    try {
      const repoPath = this.config.repositoryPath
      
      // Check if git repo exists
      try {
        await execAsync('git rev-parse --git-dir', { cwd: repoPath })
      } catch {
        // Initialize git repo
        await execAsync('git init', { cwd: repoPath })
        await execAsync('git config user.email "beads@superclaw.ai"', { cwd: repoPath })
        await execAsync('git config user.name "SuperClaw BEADS"', { cwd: repoPath })
      }
      
      this.log('debug', 'Git integration configured', { repoPath })
      
    } catch (error: unknown) {
      this.log('warn', 'Failed to setup git integration', { 
        error: error instanceof Error ? (error as Error).message : String(error) 
      })
      // Non-fatal - continue without git
    }
  }
  
  /**
   * Generate hash-based BEADS ID
   */
  generateBeadsId(prefix: string = this.config.defaultPrefix, content: string): string {
    const timestamp = Date.now()
    const nonce = Math.floor(Math.random() * 10000)
    const input = `${content}|${timestamp}|${nonce}`
    const hash = crypto.createHash('sha256').update(input).digest('hex')
    
    // Use base36 encoding for collision resistance (as per BEADS spec)
    const shortHash = parseInt(hash.slice(0, 8), 16).toString(36)
    
    return `${prefix}-${shortHash}`
  }
  
  /**
   * Compute content hash for deduplication
   */
  computeContentHash(issue: Partial<BeadsIssue>): string {
    const content = [
      issue.title || '',
      issue.description || '',
      issue.design || '',
      issue.acceptanceCriteria || '',
      issue.notes || '',
      issue.status || 'open',
      issue.priority || 2,
      issue.issueType || 'task',
      issue.assignee || '',
      JSON.stringify(issue.metadata || {})
    ].join('|')
    
    return crypto.createHash('sha256').update(content).digest('hex')
  }
  
  // ===== Core CRUD Operations =====
  
  /**
   * Create a new BEADS issue
   */
  async createIssue(issue: Omit<BeadsIssue, 'id' | 'createdAt' | 'updatedAt' | 'contentHash'>): Promise<string> {
    await this.ensureInitialized()
    
    try {
      const id = this.generateBeadsId(this.config.defaultPrefix, issue.title)
      const contentHash = this.computeContentHash(issue)
      const now = new Date()
      
      await this.dolt.execute(
        `INSERT INTO beads_issues (
          id, content_hash, title, description, design, acceptance_criteria, notes,
          status, priority, issue_type, assignee, owner, estimated_minutes,
          created_at, created_by, updated_at, external_ref, source_system, metadata,
          agent_state, hook_bead, role_bead, last_activity
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, contentHash, issue.title, issue.description, issue.design, 
          issue.acceptanceCriteria, issue.notes, issue.status, issue.priority, 
          issue.issueType, issue.assignee, issue.owner, issue.estimatedMinutes,
          now, issue.createdBy, now, issue.externalRef, issue.sourceSystem,
          JSON.stringify(issue.metadata || {}), issue.agentState, issue.hookBead, 
          issue.roleBead, issue.lastActivity
        ]
      )
      
      // Add labels if provided
      if (issue.labels && issue.labels.length > 0) {
        for (const label of issue.labels) {
          await this.addLabel(id, label)
        }
      }
      
      // Record creation event
      await this.recordEvent(id, 'created', 'system', null, null, `Created: ${issue.title}`)
      
      this.log('debug', 'BEADS issue created', { id, title: issue.title, type: issue.issueType })
      return id
      
    } catch (error: unknown) {
      this.log('error', 'Failed to create BEADS issue', { 
        title: issue.title, 
        error: error instanceof Error ? (error as Error).message : String(error) 
      })
      throw new Error(`Failed to create issue: ${error instanceof Error ? (error as Error).message : String(error)}`)
    }
  }
  
  /**
   * Get a BEADS issue by ID
   */
  async getIssue(id: string, includeRelationships: boolean = false): Promise<BeadsIssue | null> {
    await this.ensureInitialized()
    
    try {
      const results = await this.dolt.query(
        'SELECT * FROM beads_issues WHERE id = ?',
        [id]
      )
      
      if (results.length === 0) {
        return null
      }
      
      const issue = this.mapRowToBeadsIssue(results[0])
      
      if (includeRelationships) {
        // Load dependencies, labels, and comments
        issue.dependencies = await this.getDependencies(id)
        issue.labels = await this.getLabels(id)
        issue.comments = await this.getComments(id)
      }
      
      return issue
      
    } catch (error: unknown) {
      this.log('error', 'Failed to get BEADS issue', { 
        id, 
        error: error instanceof Error ? (error as Error).message : String(error) 
      })
      throw new Error(`Failed to get issue: ${error instanceof Error ? (error as Error).message : String(error)}`)
    }
  }
  
  /**
   * Update an existing BEADS issue
   */
  async updateIssue(id: string, updates: Partial<BeadsIssue>): Promise<void> {
    await this.ensureInitialized()
    
    try {
      const setClause = []
      const values = []
      
      // Build dynamic update query
      const updateFields = [
        'title', 'description', 'design', 'acceptance_criteria', 'notes',
        'status', 'priority', 'issue_type', 'assignee', 'owner', 'estimated_minutes',
        'closed_at', 'close_reason', 'external_ref', 'source_system',
        'agent_state', 'hook_bead', 'role_bead', 'last_activity'
      ]
      
      for (const field of updateFields) {
        const value = (updates as any)[this.toCamelCase(field)]
        if (value !== undefined) {
          setClause.push(`${field} = ?`)
          values.push(value)
        }
      }
      
      if (updates.metadata !== undefined) {
        setClause.push('metadata = ?')
        values.push(JSON.stringify(updates.metadata))
      }
      
      // Always update content hash and timestamp
      const contentHash = this.computeContentHash(updates)
      setClause.push('content_hash = ?', 'updated_at = ?')
      values.push(contentHash, new Date())
      
      values.push(id) // For WHERE clause
      
      if (setClause.length > 2) { // More than just hash and timestamp
        await this.dolt.execute(
          `UPDATE beads_issues SET ${setClause.join(', ')} WHERE id = ?`,
          values
        )
        
        // Record update event
        await this.recordEvent(id, 'updated', 'system', null, null, 'Issue updated')
        
        this.log('debug', 'BEADS issue updated', { id })
      }
      
    } catch (error: unknown) {
      this.log('error', 'Failed to update BEADS issue', { 
        id, 
        error: error instanceof Error ? (error as Error).message : String(error) 
      })
      throw new Error(`Failed to update issue: ${error instanceof Error ? (error as Error).message : String(error)}`)
    }
  }
  
  /**
   * Delete a BEADS issue (sets status to tombstone)
   */
  async deleteIssue(id: string): Promise<void> {
    await this.ensureInitialized()
    
    try {
      // Soft delete - set status to tombstone
      await this.dolt.execute(
        'UPDATE beads_issues SET status = ?, updated_at = ? WHERE id = ?',
        ['tombstone', new Date(), id]
      )
      
      // Record deletion event
      await this.recordEvent(id, 'tombstoned', 'system', null, null, 'Issue tombstoned')
      
      this.log('debug', 'BEADS issue tombstoned', { id })
      
    } catch (error: unknown) {
      this.log('error', 'Failed to tombstone BEADS issue', { 
        id, 
        error: error instanceof Error ? (error as Error).message : String(error) 
      })
      throw new Error(`Failed to delete issue: ${error instanceof Error ? (error as Error).message : String(error)}`)
    }
  }
  
  // ===== Query Operations =====
  
  /**
   * Query BEADS issues with flexible filtering
   */
  async queryIssues(query: BeadsQuery): Promise<BeadsIssue[]> {
    await this.ensureInitialized()
    
    try {
      let sql = 'SELECT * FROM beads_issues WHERE 1=1'
      const values: any[] = []
      
      // Build WHERE conditions
      if (query.agentId) {
        sql += ' AND assignee = ?'
        values.push(query.agentId)
      }
      
      if (query.status && query.status.length > 0) {
        sql += ` AND status IN (${query.status.map(() => '?').join(', ')})`
        values.push(...query.status)
      }
      
      if (query.issueType && query.issueType.length > 0) {
        sql += ` AND issue_type IN (${query.issueType.map(() => '?').join(', ')})`
        values.push(...query.issueType)
      }
      
      if (query.assignee) {
        sql += ' AND assignee = ?'
        values.push(query.assignee)
      }
      
      if (query.priority?.min !== undefined) {
        sql += ' AND priority >= ?'
        values.push(query.priority.min)
      }
      
      if (query.priority?.max !== undefined) {
        sql += ' AND priority <= ?'
        values.push(query.priority.max)
      }
      
      if (query.since) {
        sql += ' AND created_at >= ?'
        values.push(query.since)
      }
      
      if (query.until) {
        sql += ' AND created_at <= ?'
        values.push(query.until)
      }
      
      if (query.searchText) {
        sql += ' AND (title LIKE ? OR description LIKE ? OR notes LIKE ?)'
        const searchPattern = `%${query.searchText}%`
        values.push(searchPattern, searchPattern, searchPattern)
      }
      
      // ORDER BY
      const sortBy = query.sortBy || 'created_at'
      sql += ` ORDER BY ${sortBy} DESC`
      
      // LIMIT and OFFSET
      if (query.limit) {
        sql += ' LIMIT ?'
        values.push(query.limit)
      }
      
      if (query.offset) {
        sql += ' OFFSET ?'
        values.push(query.offset)
      }
      
      const results = await this.dolt.query(sql, values)
      const issues = results.map(row => this.mapRowToBeadsIssue(row))
      
      // Load relationships if requested
      if (query.includeRelationships) {
        for (const issue of issues) {
          issue.dependencies = await this.getDependencies(issue.id)
          issue.labels = await this.getLabels(issue.id)
          issue.comments = await this.getComments(issue.id)
        }
      }
      
      return issues
      
    } catch (error: unknown) {
      this.log('error', 'Failed to query BEADS issues', { 
        query, 
        error: error instanceof Error ? (error as Error).message : String(error) 
      })
      throw new Error(`Failed to query issues: ${error instanceof Error ? (error as Error).message : String(error)}`)
    }
  }
  
  /**
   * Get ready work (unblocked issues) for agent coordination
   */
  async getReadyWork(options: ReadyWorkOptions = {}): Promise<BeadsIssue[]> {
    await this.ensureInitialized()
    
    try {
      let sql = `
        SELECT i.* FROM beads_issues i
        LEFT JOIN beads_dependencies d ON i.id = d.issue_id
        LEFT JOIN beads_issues blocker ON d.depends_on_id = blocker.id
        WHERE i.status IN ('open', 'in_progress')
        GROUP BY i.id
        HAVING COUNT(CASE 
          WHEN d.type IN ('blocks', 'parent-child', 'waits-for') 
           AND blocker.status NOT IN ('closed', 'tombstone')
          THEN 1 
        END) = 0
      `
      
      const values: any[] = []
      
      // Add filters
      if (options.agentId) {
        sql += ' AND i.assignee = ?'
        values.push(options.agentId)
      }
      
      if (options.priorities && options.priorities.length > 0) {
        sql += ` AND i.priority IN (${options.priorities.map(() => '?').join(', ')})`
        values.push(...options.priorities)
      }
      
      if (options.excludeTypes && options.excludeTypes.length > 0) {
        sql += ` AND i.issue_type NOT IN (${options.excludeTypes.map(() => '?').join(', ')})`
        values.push(...options.excludeTypes)
      }
      
      sql += ' ORDER BY i.priority ASC, i.created_at ASC'
      
      if (options.limit) {
        sql += ' LIMIT ?'
        values.push(options.limit)
      }
      
      const results = await this.dolt.query(sql, values)
      return results.map(row => this.mapRowToBeadsIssue(row))
      
    } catch (error: unknown) {
      this.log('error', 'Failed to get ready work', { 
        options, 
        error: error instanceof Error ? (error as Error).message : String(error) 
      })
      throw new Error(`Failed to get ready work: ${error instanceof Error ? (error as Error).message : String(error)}`)
    }
  }
  
  // ===== Dependency Operations =====
  
  /**
   * Add a dependency relationship between issues
   */
  async addDependency(sourceId: string, targetId: string, type: DependencyType = 'blocks', metadata?: Record<string, any>): Promise<void> {
    await this.ensureInitialized()
    
    try {
      await this.dolt.execute(
        `INSERT INTO beads_dependencies (issue_id, depends_on_id, type, created_by, metadata)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE 
           metadata = VALUES(metadata),
           created_at = CURRENT_TIMESTAMP`,
        [
          sourceId, 
          targetId, 
          type, 
          'system',
          JSON.stringify(metadata || {})
        ]
      )
      
      // Record event
      await this.recordEvent(sourceId, 'dependency_added', 'system', null, targetId, `Added ${type} dependency`)
      
      this.log('debug', 'Dependency added', { sourceId, targetId, type })
      
    } catch (error: unknown) {
      this.log('error', 'Failed to add dependency', { 
        sourceId, 
        targetId, 
        type,
        error: error instanceof Error ? (error as Error).message : String(error) 
      })
      throw new Error(`Failed to add dependency: ${error instanceof Error ? (error as Error).message : String(error)}`)
    }
  }
  
  /**
   * Remove a dependency relationship
   */
  async removeDependency(sourceId: string, targetId: string, type?: DependencyType): Promise<void> {
    await this.ensureInitialized()
    
    try {
      let sql = 'DELETE FROM beads_dependencies WHERE issue_id = ? AND depends_on_id = ?'
      const values = [sourceId, targetId]
      
      if (type) {
        sql += ' AND type = ?'
        values.push(type)
      }
      
      await this.dolt.execute(sql, values)
      
      // Record event
      await this.recordEvent(sourceId, 'dependency_removed', 'system', targetId, null, `Removed ${type || 'any'} dependency`)
      
      this.log('debug', 'Dependency removed', { sourceId, targetId, type })
      
    } catch (error: unknown) {
      this.log('error', 'Failed to remove dependency', { 
        sourceId, 
        targetId, 
        type,
        error: error instanceof Error ? (error as Error).message : String(error) 
      })
      throw new Error(`Failed to remove dependency: ${error instanceof Error ? (error as Error).message : String(error)}`)
    }
  }
  
  /**
   * Get all dependencies for an issue
   */
  async getDependencies(issueId: string): Promise<BeadsDependency[]> {
    await this.ensureInitialized()
    
    try {
      const results = await this.dolt.query(
        'SELECT * FROM beads_dependencies WHERE issue_id = ? ORDER BY created_at DESC',
        [issueId]
      )
      
      return results.map(row => ({
        issueId: row.issue_id,
        dependsOnId: row.depends_on_id,
        type: row.type as DependencyType,
        createdAt: row.created_at,
        createdBy: row.created_by,
        metadata: row.metadata ? JSON.parse(row.metadata) : {},
        threadId: row.thread_id
      }))
      
    } catch (error: unknown) {
      this.log('error', 'Failed to get dependencies', { 
        issueId, 
        error: error instanceof Error ? (error as Error).message : String(error) 
      })
      throw new Error(`Failed to get dependencies: ${error instanceof Error ? (error as Error).message : String(error)}`)
    }
  }
  
  // ===== Label Operations =====
  
  async addLabel(issueId: string, label: string): Promise<void> {
    await this.ensureInitialized()
    
    try {
      await this.dolt.execute(
        'INSERT IGNORE INTO beads_labels (issue_id, label) VALUES (?, ?)',
        [issueId, label]
      )
      
      this.log('debug', 'Label added', { issueId, label })
      
    } catch (error: unknown) {
      this.log('error', 'Failed to add label', { 
        issueId, 
        label,
        error: error instanceof Error ? (error as Error).message : String(error) 
      })
      throw new Error(`Failed to add label: ${error instanceof Error ? (error as Error).message : String(error)}`)
    }
  }
  
  async removeLabel(issueId: string, label: string): Promise<void> {
    await this.ensureInitialized()
    
    try {
      await this.dolt.execute(
        'DELETE FROM beads_labels WHERE issue_id = ? AND label = ?',
        [issueId, label]
      )
      
      this.log('debug', 'Label removed', { issueId, label })
      
    } catch (error: unknown) {
      this.log('error', 'Failed to remove label', { 
        issueId, 
        label,
        error: error instanceof Error ? (error as Error).message : String(error) 
      })
      throw new Error(`Failed to remove label: ${error instanceof Error ? (error as Error).message : String(error)}`)
    }
  }
  
  async getLabels(issueId: string): Promise<string[]> {
    await this.ensureInitialized()
    
    try {
      const results = await this.dolt.query(
        'SELECT label FROM beads_labels WHERE issue_id = ? ORDER BY label',
        [issueId]
      )
      
      return results.map(row => row.label)
      
    } catch (error: unknown) {
      this.log('error', 'Failed to get labels', { 
        issueId, 
        error: error instanceof Error ? (error as Error).message : String(error) 
      })
      throw new Error(`Failed to get labels: ${error instanceof Error ? (error as Error).message : String(error)}`)
    }
  }
  
  // ===== Comment Operations =====
  
  async addComment(issueId: string, author: string, text: string): Promise<number> {
    await this.ensureInitialized()
    
    try {
      await this.dolt.execute(
        'INSERT INTO beads_comments (issue_id, author, text) VALUES (?, ?, ?)',
        [issueId, author, text]
      )
      
      // Get the last insert ID by querying
      const lastIdResult = await this.dolt.query(
        'SELECT LAST_INSERT_ID() as id'
      )
      const commentId = lastIdResult[0]?.id || Date.now() // Fallback to timestamp
      
      // Record event
      await this.recordEvent(issueId, 'comment_added', author, null, null, 'Comment added')
      
      this.log('debug', 'Comment added', { issueId, author, commentId })
      return commentId
      
    } catch (error: unknown) {
      this.log('error', 'Failed to add comment', { 
        issueId, 
        author,
        error: error instanceof Error ? (error as Error).message : String(error) 
      })
      throw new Error(`Failed to add comment: ${error instanceof Error ? (error as Error).message : String(error)}`)
    }
  }
  
  async getComments(issueId: string): Promise<BeadsComment[]> {
    await this.ensureInitialized()
    
    try {
      const results = await this.dolt.query(
        'SELECT * FROM beads_comments WHERE issue_id = ? ORDER BY created_at ASC',
        [issueId]
      )
      
      return results.map(row => ({
        id: row.id,
        issueId: row.issue_id,
        author: row.author,
        text: row.text,
        createdAt: row.created_at
      }))
      
    } catch (error: unknown) {
      this.log('error', 'Failed to get comments', { 
        issueId, 
        error: error instanceof Error ? (error as Error).message : String(error) 
      })
      throw new Error(`Failed to get comments: ${error instanceof Error ? (error as Error).message : String(error)}`)
    }
  }
  
  // ===== Agent Operations =====
  
  /**
   * Update agent state for coordination
   */
  async updateAgentState(issueId: string, state: AgentState, hookBead?: string): Promise<void> {
    await this.ensureInitialized()
    
    try {
      await this.dolt.execute(
        'UPDATE beads_issues SET agent_state = ?, hook_bead = ?, last_activity = ? WHERE id = ?',
        [state, hookBead, new Date(), issueId]
      )
      
      // Record event
      await this.recordEvent(issueId, 'agent_state_changed', 'system', null, state, `Agent state: ${state}`)
      
      this.log('debug', 'Agent state updated', { issueId, state, hookBead })
      
    } catch (error: unknown) {
      this.log('error', 'Failed to update agent state', { 
        issueId, 
        state,
        error: error instanceof Error ? (error as Error).message : String(error) 
      })
      throw new Error(`Failed to update agent state: ${error instanceof Error ? (error as Error).message : String(error)}`)
    }
  }
  
  /**
   * Find stuck agents (no activity for timeout period)
   */
  async findStuckAgents(timeoutMinutes: number = 60): Promise<BeadsIssue[]> {
    await this.ensureInitialized()
    
    try {
      const cutoffTime = new Date(Date.now() - timeoutMinutes * 60 * 1000)
      
      const results = await this.dolt.query(
        `SELECT * FROM beads_issues 
         WHERE agent_state = 'working' 
         AND (last_activity IS NULL OR last_activity < ?)
         ORDER BY last_activity ASC`,
        [cutoffTime]
      )
      
      return results.map(row => this.mapRowToBeadsIssue(row))
      
    } catch (error: unknown) {
      this.log('error', 'Failed to find stuck agents', { 
        timeoutMinutes,
        error: error instanceof Error ? (error as Error).message : String(error) 
      })
      throw new Error(`Failed to find stuck agents: ${error instanceof Error ? (error as Error).message : String(error)}`)
    }
  }
  
  // ===== Memory Compaction =====
  
  /**
   * Compact old memories using AI summarization
   */
  async compactMemories(olderThanDays: number = 30): Promise<void> {
    await this.ensureInitialized()
    
    if (!this.compactor) {
      this.log('warn', 'Compaction requested but no compactor available')
      return
    }
    
    try {
      const cutoffDate = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000)
      
      const candidates = await this.dolt.query(
        `SELECT * FROM beads_issues 
         WHERE status IN ('closed', 'tombstone')
         AND compaction_level = 0
         AND created_at < ?
         ORDER BY created_at ASC
         LIMIT 100`,
        [cutoffDate]
      )
      
      this.log('info', `Found ${candidates.length} issues for compaction`)
      
      for (const row of candidates) {
        await this.compactIssue(row.id)
      }
      
    } catch (error: unknown) {
      this.log('error', 'Failed to compact memories', { 
        olderThanDays,
        error: error instanceof Error ? (error as Error).message : String(error) 
      })
      throw new Error(`Failed to compact memories: ${error instanceof Error ? (error as Error).message : String(error)}`)
    }
  }
  
  private async compactIssue(issueId: string): Promise<void> {
    try {
      const issue = await this.getIssue(issueId, true)
      if (!issue) return
      
      // Calculate original size
      const originalSize = JSON.stringify(issue).length
      
      // Summarize using AI (placeholder - implement with actual LLM)
      const summary = await this.summarizeIssue(issue)
      
      // Update with compacted version
      await this.dolt.execute(
        `UPDATE beads_issues 
         SET description = ?, compaction_level = 1, compacted_at = ?, original_size = ?
         WHERE id = ?`,
        [summary, new Date(), originalSize, issueId]
      )
      
      this.log('debug', 'Issue compacted', { issueId, originalSize, compactedSize: summary.length })
      
    } catch (error: unknown) {
      this.log('error', 'Failed to compact issue', { 
        issueId,
        error: error instanceof Error ? (error as Error).message : String(error) 
      })
    }
  }
  
  private async summarizeIssue(issue: BeadsIssue): Promise<string> {
    // Placeholder for AI summarization
    // TODO: Integrate with Claude Haiku for memory compaction
    const key_points = [
      issue.title,
      issue.status,
      issue.closeReason || 'No close reason provided'
    ].filter(Boolean)
    
    return `COMPACTED: ${key_points.join(' | ')}`
  }
  
  // ===== JSONL Export/Import for Git Integration =====
  
  /**
   * Export issues to JSONL format for git tracking
   */
  async exportToJsonl(outputPath?: string): Promise<string> {
    await this.ensureInitialized()
    
    try {
      const filepath = outputPath || path.join(this.config.repositoryPath, 'issues.jsonl')
      
      // Get all non-ephemeral issues
      const issues = await this.queryIssues({ 
        includeRelationships: true,
        limit: 10000 
      })
      
      // Convert to JSONL
      const jsonlLines = issues.map(issue => JSON.stringify(issue)).join('\n')
      
      // Write atomically
      const tempPath = `${filepath}.tmp`
      await fs.writeFile(tempPath, jsonlLines, 'utf-8')
      await fs.rename(tempPath, filepath)
      
      this.log('info', 'Exported to JSONL', { filepath, issueCount: issues.length })
      return filepath
      
    } catch (error: unknown) {
      this.log('error', 'Failed to export to JSONL', { 
        outputPath,
        error: error instanceof Error ? (error as Error).message : String(error) 
      })
      throw new Error(`Failed to export to JSONL: ${error instanceof Error ? (error as Error).message : String(error)}`)
    }
  }
  
  /**
   * Import issues from JSONL format after git pull
   */
  async importFromJsonl(inputPath?: string): Promise<number> {
    await this.ensureInitialized()
    
    try {
      const filepath = inputPath || path.join(this.config.repositoryPath, 'issues.jsonl')
      
      const content = await fs.readFile(filepath, 'utf-8')
      const lines = content.split('\n').filter(line => line.trim())
      
      let imported = 0
      
      for (const line of lines) {
        try {
          const issue: BeadsIssue = JSON.parse(line)
          await this.upsertIssue(issue)
          imported++
        } catch (error: unknown) {
          this.log('warn', 'Failed to import issue from JSONL line', { 
            line: line.substring(0, 100),
            error: error instanceof Error ? (error as Error).message : String(error) 
          })
        }
      }
      
      this.log('info', 'Imported from JSONL', { filepath, imported, total: lines.length })
      return imported
      
    } catch (error: unknown) {
      this.log('error', 'Failed to import from JSONL', { 
        inputPath,
        error: error instanceof Error ? (error as Error).message : String(error) 
      })
      throw new Error(`Failed to import from JSONL: ${error instanceof Error ? (error as Error).message : String(error)}`)
    }
  }
  
  private async upsertIssue(issue: BeadsIssue): Promise<void> {
    // Check if issue exists
    const existing = await this.getIssue(issue.id)
    
    if (existing) {
      // Update existing issue
      await this.updateIssue(issue.id, issue)
    } else {
      // Create new issue
      await this.createIssue(issue)
    }
    
    // Update relationships
    if (issue.dependencies) {
      // Remove existing dependencies
      await this.dolt.execute('DELETE FROM beads_dependencies WHERE issue_id = ?', [issue.id])
      
      // Add new dependencies
      for (const dep of issue.dependencies) {
        await this.addDependency(dep.issueId, dep.dependsOnId, dep.type, dep.metadata)
      }
    }
    
    if (issue.labels) {
      // Remove existing labels
      await this.dolt.execute('DELETE FROM beads_labels WHERE issue_id = ?', [issue.id])
      
      // Add new labels
      for (const label of issue.labels) {
        await this.addLabel(issue.id, label)
      }
    }
  }
  
  // ===== SuperClaw CORTEX Integration =====
  
  /**
   * Convert SuperClaw AgentMemory to BEADS issue
   */
  async storeAgentMemory(agentId: string, memory: Omit<AgentMemory, 'id' | 'agentId' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const beadsIssue: Omit<BeadsIssue, 'id' | 'createdAt' | 'updatedAt' | 'contentHash'> = {
      title: memory.title,
      description: memory.description,
      status: 'open',
      priority: 2, // Default medium priority
      issueType: this.memoryTypeToBeadsType(memory.type),
      assignee: agentId,
      createdBy: agentId,
      metadata: {
        ...memory.metadata,
        originalType: memory.type,
        isCortexMemory: true,
        compactionLevel: memory.compactionLevel,
        originalSize: memory.originalSize
      },
      compactionLevel: memory.compactionLevel
    }
    
    return await this.createIssue(beadsIssue)
  }
  
  /**
   * Convert BEADS issue back to SuperClaw AgentMemory
   */
  beadsIssueToAgentMemory(issue: BeadsIssue): AgentMemory {
    // @ts-expect-error - Post-Merge Reconciliation
    return {
      id: issue.id,
      agentId: issue.assignee || 'unknown',
      title: issue.title,
      description: issue.description || '',
      type: this.beadsTypeToMemoryType(issue.issueType),
      status: this.beadsStatusToMemoryStatus(issue.status),
      compactionLevel: issue.compactionLevel,
      originalSize: issue.originalSize,
      compactedAt: issue.compactedAt,
      metadata: issue.metadata || {},
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt
    }
  }
  
  // ===== Helper Methods =====
  
  private mapRowToBeadsIssue(row: any): BeadsIssue {
    return {
      id: row.id,
      contentHash: row.content_hash,
      title: row.title,
      description: row.description,
      design: row.design,
      acceptanceCriteria: row.acceptance_criteria,
      notes: row.notes,
      status: row.status as BeadsStatus,
      priority: row.priority,
      issueType: row.issue_type as BeadsIssueType,
      assignee: row.assignee,
      owner: row.owner,
      estimatedMinutes: row.estimated_minutes,
      createdAt: row.created_at,
      createdBy: row.created_by,
      updatedAt: row.updated_at,
      closedAt: row.closed_at,
      closeReason: row.close_reason,
      externalRef: row.external_ref,
      sourceSystem: row.source_system,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      compactionLevel: row.compaction_level || 0,
      compactedAt: row.compacted_at,
      compactedAtCommit: row.compacted_at_commit,
      originalSize: row.original_size,
      agentState: row.agent_state as AgentState,
      hookBead: row.hook_bead,
      roleBead: row.role_bead,
      lastActivity: row.last_activity
    }
  }
  
  private toCamelCase(str: string): string {
    return str.replace(/_([a-z])/g, (g) => g[1].toUpperCase())
  }
  
  // Helper method for priority conversion (unused but kept for future use)
  private importanceToBeadsPriority(importance: number): number {
    // Convert 1-10 importance to 0-4 priority (inverted)
    return Math.max(0, Math.min(4, Math.floor((10 - importance) / 2)))
  }
  
  private memoryTypeToBeadsType(memoryType: string): BeadsIssueType {
    const mapping: Record<string, BeadsIssueType> = {
      'learning': 'learning',
      'context': 'context', 
      'capability': 'capability',
      'relationship': 'relationship',
      'decision': 'decision',
      'observation': 'task',
      'conversation': 'message',
      'error': 'bug'
    }
    
    return mapping[memoryType] || 'task'
  }
  
  private beadsTypeToMemoryType(beadsType: BeadsIssueType): MemoryType {
    const mapping: Record<BeadsIssueType, MemoryType> = {
      'learning': 'learning',
      'context': 'context',
      'capability': 'capability', 
      'relationship': 'relationship',
      'decision': 'decision',
      'task': 'learning', // Default to learning
      'message': 'context',
      'bug': 'learning',
      'feature': 'capability',
      'epic': 'context',
      'chore': 'learning'
    }
    
    return mapping[beadsType] || 'learning'
  }
  
  private beadsStatusToMemoryStatus(status: BeadsStatus): MemoryStatus {
    const mapping: Record<BeadsStatus, MemoryStatus> = {
      'open': 'active',
      'in_progress': 'active',
      'blocked': 'active',
      'deferred': 'archived',
      'closed': 'archived',
      'tombstone': 'archived'
    }
    
    return mapping[status] || 'active'
  }
  
  private async recordEvent(issueId: string, eventType: string, actor: string, oldValue: string | null, newValue: string | null, comment?: string): Promise<void> {
    try {
      await this.dolt.execute(
        'INSERT INTO beads_events (issue_id, event_type, actor, old_value, new_value, comment) VALUES (?, ?, ?, ?, ?, ?)',
        [issueId, eventType, actor, oldValue, newValue, comment]
      )
    } catch (error: unknown) {
      this.log('warn', 'Failed to record event', { issueId, eventType, error: error instanceof Error ? (error as Error).message : String(error) })
    }
  }
  
  private log(level: string, message: string, meta: any = {}) {
    if (this.shouldLog(level)) {
      const timestamp = new Date().toISOString()
      const logEntry = {
        timestamp,
        level: level.toUpperCase(),
        service: 'BeadsMemory',
        message,
        ...meta
      }
      
      console.log(JSON.stringify(logEntry))
    }
  }
  
  private shouldLog(level: string): boolean {
    const levels = ['error', 'warn', 'info', 'debug']
    const configLevel = this.config.logLevel || 'info'
    const levelIndex = levels.indexOf(level)
    const configLevelIndex = levels.indexOf(configLevel)
    
    return levelIndex <= configLevelIndex
  }
  
  async destroy(): Promise<void> {
    try {
      // No specific cleanup needed for compactor
      
      // DoltService cleanup (if it has a destroy method)
      // The DoltService doesn't appear to have a destroy method, so we skip this
      
      this.initialized = false
      this.log('info', 'BeadsMemory destroyed')
      
    } catch (error: unknown) {
      this.log('error', 'Error during BeadsMemory destruction', { 
        error: error instanceof Error ? (error as Error).message : String(error) 
      })
    }
  }
}

/**
 * Configuration interface for BEADS memory system
 */
export interface BeadsMemoryConfig {
  /** Path to Dolt executable */
  doltPath: string
  
  /** Repository path for Dolt database */
  repositoryPath: string
  
  /** Default prefix for BEADS IDs */
  defaultPrefix: string
  
  /** Maximum age for memory compaction */
  maxMemoryAge: number
  
  /** Compaction check interval */
  compactionInterval: number
  
  /** Enable automatic compaction */
  enableAutoCompaction: boolean
  
  /** Enable git integration */
  enableGitIntegration: boolean
  
  /** Logging level */
  logLevel: 'error' | 'warn' | 'info' | 'debug'
}

export default BeadsMemory