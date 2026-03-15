import { exec } from 'child_process'
import { promisify } from 'util'
import * as path from 'path'
import * as fs from 'fs/promises'
import * as os from 'os'

const execAsync = promisify(exec)

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

export class DoltService {
  private dbPath: string
  private initialized: boolean = false
  private timeout: number
  private maxRetries: number
  private retryDelay: number
  private connectionPool: Map<string, Promise<void>> = new Map()
  
  constructor(config: DoltConfig = {}) {
    this.dbPath = config.dbPath || path.join(os.homedir(), '.superclaw', 'memory')
    this.timeout = config.timeout || 30000 // 30 seconds
    this.maxRetries = config.maxRetries || 3
    this.retryDelay = config.retryDelay || 1000 // 1 second
  }
  
  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }
    
    try {
      // Check if dolt is installed
      await this.checkDoltInstallation()
      
      // Ensure database directory exists
      await fs.mkdir(this.dbPath, { recursive: true })
      
      // Initialize dolt repo if not exists
      const isRepo = await this.isDoltRepo()
      if (!isRepo) {
        await this.exec('dolt init')
        await this.exec('dolt config --local --add user.email "superclaw@agent.local"')
        await this.exec('dolt config --local --add user.name "SuperClaw Agent"')
      }
      
      // Run schema migrations
      await this.runSchemaMigrations()
      
      this.initialized = true
    } catch (error: unknown) {
      throw new Error(`Failed to initialize DoltService: ${error instanceof Error ? (error).message : String(error)}`, { cause: error })
    }
  }
  
  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    await this.ensureInitialized()
    
    const parameterizedSql = this.parameterizeSql(sql, params)
    
    try {
      const result = await this.retryOperation(async () => {
        const output = await this.exec(`dolt sql -r json -q "${parameterizedSql}"`)
        return this.parseJsonOutput(output)
      })
      
      return result as T[]
    } catch (error: unknown) {
      throw new Error(`Query failed: ${error instanceof Error ? (error).message : String(error)}`, { cause: error })
    }
  }
  
  async execute(sql: string, params?: any[]): Promise<{ affectedRows: number }> {
    await this.ensureInitialized()
    
    const parameterizedSql = this.parameterizeSql(sql, params)
    
    try {
      const result = await this.retryOperation(async () => {
        const output = await this.exec(`dolt sql -r json -q "${parameterizedSql}"`)
        return this.parseExecuteResult(output)
      })
      
      return { affectedRows: result.affectedRows || 0 }
    } catch (error: unknown) {
      throw new Error(`Execute failed: ${error instanceof Error ? (error).message : String(error)}`, { cause: error })
    }
  }
  
  async commit(message: string): Promise<void> {
    await this.ensureInitialized()
    
    try {
      // Check if there are changes to commit first
      const status = await this.exec('dolt status')
      if (status.includes('nothing to commit')) {
        // No changes, skip commit
        return
      }
      
      // Add all changes to staging
      await this.exec('dolt add .')
      
      // Commit with message
      await this.exec(`dolt commit -m "${this.escapeShellArg(message)}"`)
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      // Ignore "no changes to commit" errors
      if (errorMsg.includes('no changes added to commit') || errorMsg.includes('nothing to commit')) {
        return
      }
      throw new Error(`Commit failed: ${errorMsg}`, { cause: error })
    }
  }
  
  async branch(name: string): Promise<void> {
    await this.ensureInitialized()
    
    try {
      await this.exec(`dolt checkout -b "${this.escapeShellArg(name)}"`)
    } catch (error: unknown) {
      throw new Error(`Branch creation failed: ${error instanceof Error ? (error).message : String(error)}`, { cause: error })
    }
  }
  
  async merge(branch: string): Promise<void> {
    await this.ensureInitialized()
    
    try {
      await this.exec(`dolt merge "${this.escapeShellArg(branch)}"`)
    } catch (error: unknown) {
      throw new Error(`Merge failed: ${error instanceof Error ? (error).message : String(error)}`, { cause: error })
    }
  }
  
  async getHistory(table?: string, limit: number = 10): Promise<CommitInfo[]> {
    await this.ensureInitialized()
    
    try {
      const tableFilter = table ? `-- ${this.escapeShellArg(table)}` : ''
      const output = await this.exec(`dolt log --oneline --limit ${limit} ${tableFilter}`)
      
      return this.parseLogOutput(output)
    } catch (error: unknown) {
      throw new Error(`Get history failed: ${error instanceof Error ? (error).message : String(error)}`, { cause: error })
    }
  }
  
  async diff(fromCommit: string, toCommit: string = 'HEAD'): Promise<DiffResult[]> {
    await this.ensureInitialized()
    
    try {
      const output = await this.exec(`dolt diff --data "${this.escapeShellArg(fromCommit)}" "${this.escapeShellArg(toCommit)}"`)
      return this.parseDiffOutput(output)
    } catch (error: unknown) {
      throw new Error(`Diff failed: ${error instanceof Error ? (error).message : String(error)}`, { cause: error })
    }
  }
  
  async getCurrentBranch(): Promise<string> {
    await this.ensureInitialized()
    
    try {
      const output = await this.exec('dolt branch --show-current')
      return output.trim()
    } catch (error: unknown) {
      throw new Error(`Get current branch failed: ${error instanceof Error ? (error).message : String(error)}`, { cause: error })
    }
  }
  
  async listBranches(): Promise<string[]> {
    await this.ensureInitialized()
    
    try {
      const output = await this.exec('dolt branch')
      return output
        .split('\n')
        .map(line => line.replace(/^\*\s*/, '').trim())
        .filter(line => line.length > 0)
    } catch (error: unknown) {
      throw new Error(`List branches failed: ${error instanceof Error ? (error).message : String(error)}`, { cause: error })
    }
  }
  
  async reset(commit?: string, hard: boolean = false): Promise<void> {
    await this.ensureInitialized()
    
    try {
      const hardFlag = hard ? '--hard' : ''
      const commitRef = commit ? this.escapeShellArg(commit) : 'HEAD'
      await this.exec(`dolt reset ${hardFlag} ${commitRef}`)
    } catch (error: unknown) {
      throw new Error(`Reset failed: ${error instanceof Error ? (error).message : String(error)}`, { cause: error })
    }
  }
  
  private async exec(command: string): Promise<string> {
    const poolKey = command
    
    // Simple connection pooling - prevent duplicate operations
    if (this.connectionPool.has(poolKey)) {
      await this.connectionPool.get(poolKey)
    }
    
    const operation = this.executeCommand(command)
    this.connectionPool.set(poolKey, operation.then(() => {}))
    
    try {
      const result = await operation
      this.connectionPool.delete(poolKey)
      return result
    } catch (error: unknown) {
      this.connectionPool.delete(poolKey)
      throw error
    }
  }
  
  private async executeCommand(command: string): Promise<string> {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: this.dbPath,
        timeout: this.timeout,
        encoding: 'utf8'
      })
      
      if (stderr && !stderr.includes('Warning:')) {
        console.warn(`Dolt warning: ${stderr}`)
      }
      
      return stdout
    } catch (error: any) {
      throw new Error(`Command failed: ${command} - ${(error as Error).message || error}`, { cause: error })
    }
  }
  
  private async retryOperation<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null
    
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await operation()
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error))
        
        if (attempt < this.maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, this.retryDelay * (attempt + 1)))
        }
      }
    }
    
    throw lastError || new Error('Unknown error in retry operation')
  }
  
  private escapeValue(value: any): string {
    if (value === null || value === undefined) {
      return 'NULL'
    }
    
    if (typeof value === 'string') {
      return `'${value.replace(/'/g, "''")}'`
    }
    
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value)
    }
    
    if (value instanceof Date) {
      return `'${value.toISOString()}'`
    }
    
    if (typeof value === 'object') {
      return `'${JSON.stringify(value).replace(/'/g, "''")}'`
    }
    
    return `'${String(value).replace(/'/g, "''")}'`
  }
  
  private escapeShellArg(arg: string): string {
    return arg.replace(/['"\\$`]/g, '\\$&')
  }
  
  private parameterizeSql(sql: string, params?: any[]): string {
    if (!params || params.length === 0) {
      return sql
    }
    
    let paramIndex = 0
    return sql.replace(/\?/g, () => {
      if (paramIndex < params.length) {
        return this.escapeValue(params[paramIndex++])
      }
      return '?'
    })
  }
  
  private parseJsonOutput(output: string): any[] {
    try {
      if (!output.trim()) {
        return []
      }
      
      // Dolt outputs each row as a separate JSON object
      const lines = output.trim().split('\n')
      return lines.map(line => JSON.parse(line))
    } catch (error: unknown) {
      throw new Error(`Failed to parse JSON output: ${error instanceof Error ? (error).message : String(error)}`, { cause: error })
    }
  }
  
  private parseExecuteResult(output: string): { affectedRows: number } {
    try {
      // Try to extract affected rows from output
      const match = output.match(/(\d+)\s+rows?\s+(affected|inserted|updated|deleted)/i)
      const affectedRows = match ? parseInt(match[1], 10) : 0
      
      return { affectedRows }
    } catch (error: unknown) {
      return { affectedRows: 0 }
    }
  }
  
  private parseLogOutput(output: string): CommitInfo[] {
    const commits: CommitInfo[] = []
    const lines = output.trim().split('\n')
    
    for (const line of lines) {
      if (!line.trim()) {continue}
      
      // Parse format: hash message (author, date)
      const match = line.match(/^([a-f0-9]+)\s+(.+?)\s+\(([^,]+),\s*(.+)\)$/)
      if (match) {
        commits.push({
          hash: match[1],
          message: match[2].trim(),
          author: match[3].trim(),
          date: match[4].trim()
        })
      }
    }
    
    return commits
  }
  
  private parseDiffOutput(output: string): DiffResult[] {
    // This is a simplified parser - Dolt diff output can be complex
    const results: DiffResult[] = []
    
    try {
      const lines = output.split('\n')
      let currentTable = ''
      let currentOperation: 'added' | 'modified' | 'deleted' = 'modified'
      let currentRows: any[] = []
      
      for (const line of lines) {
        if (line.startsWith('diff --dolt')) {
          // New table diff section
          const tableMatch = line.match(/a\/(\w+)/)
          currentTable = tableMatch ? tableMatch[1] : ''
        } else if (line.startsWith('+') && !line.startsWith('+++')) {
          currentOperation = 'added'
          // Parse added row data
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          currentOperation = 'deleted'
          // Parse deleted row data
        }
      }
      
      if (currentTable) {
        results.push({
          table: currentTable,
          operation: currentOperation,
          rows: currentRows
        })
      }
    } catch (error: unknown) {
      console.warn(`Failed to parse diff output: ${error}`)
    }
    
    return results
  }
  
  private async checkDoltInstallation(): Promise<void> {
    try {
      await execAsync('dolt version', { timeout: 5000 })
    } catch (error: unknown) {
      throw new Error('Dolt is not installed or not in PATH. Please install Dolt first.', { cause: error })
    }
  }
  
  private async isDoltRepo(): Promise<boolean> {
    try {
      await fs.access(path.join(this.dbPath, '.dolt'))
      return true
    } catch {
      return false
    }
  }
  
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize()
    }
  }
  
  private async runSchemaMigrations(): Promise<void> {
    // Default schema for agent memory
    const schema = `
      CREATE TABLE IF NOT EXISTS agent_memories (
        id INT PRIMARY KEY AUTO_INCREMENT,
        agent_id VARCHAR(255) NOT NULL,
        session_id VARCHAR(255),
        memory_type ENUM('episodic', 'semantic', 'procedural', 'working') NOT NULL,
        content JSON NOT NULL,
        metadata JSON,
        importance_score FLOAT DEFAULT 0.0,
        access_count INT DEFAULT 0,
        last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_agent_id (agent_id),
        INDEX idx_session_id (session_id),
        INDEX idx_memory_type (memory_type),
        INDEX idx_importance (importance_score),
        INDEX idx_created (created_at)
      );

      CREATE TABLE IF NOT EXISTS agent_contexts (
        id INT PRIMARY KEY AUTO_INCREMENT,
        agent_id VARCHAR(255) NOT NULL,
        context_key VARCHAR(255) NOT NULL,
        context_value JSON NOT NULL,
        expires_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_agent_context (agent_id, context_key),
        INDEX idx_expires (expires_at)
      );

      CREATE TABLE IF NOT EXISTS agent_relationships (
        id INT PRIMARY KEY AUTO_INCREMENT,
        source_agent_id VARCHAR(255) NOT NULL,
        target_agent_id VARCHAR(255) NOT NULL,
        relationship_type VARCHAR(100) NOT NULL,
        strength FLOAT DEFAULT 1.0,
        metadata JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_relationship (source_agent_id, target_agent_id, relationship_type),
        INDEX idx_source (source_agent_id),
        INDEX idx_target (target_agent_id)
      );
    `
    
    try {
      await this.exec(`dolt sql --query "${schema}"`)
      
      // Check if we need to commit the schema
      const status = await this.exec('dolt status')
      if (status.includes('Changes to be committed:') || status.includes('Changes not staged for commit:')) {
        await this.commit('Initialize agent memory schema')
      }
    } catch (error: unknown) {
      console.warn(`Schema migration warning: ${error}`)
      // Continue even if schema migration has issues
    }
  }
}

export default DoltService