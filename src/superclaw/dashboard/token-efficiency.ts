import { EventEmitter } from 'events'
import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

// Types for token efficiency tracking
export interface TokenUsage {
  timestamp: Date
  sessionId: string
  toolCategory: 'browser' | 'filesystem' | 'database' | 'api' | 'communication' | 'analysis' | 'other'
  toolName: string
  approach: 'codeagent' | 'traditional'
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costUsd: number
  provider: string
  model: string
  taskCompleted: boolean
  efficiency: number // tokens per successful task completion
  metadata?: Record<string, any>
}

export interface EfficiencyMetrics {
  today: {
    tokensSaved: number
    costSaved: number
    efficiencyRatio: number // CodeAgent vs Traditional
  }
  week: {
    tokensSaved: number
    costSaved: number
    efficiencyRatio: number
  }
  month: {
    tokensSaved: number
    costSaved: number
    efficiencyRatio: number
  }
  byCategory: Record<string, {
    codeagent: { avgTokens: number; avgCost: number; successRate: number }
    traditional: { avgTokens: number; avgCost: number; successRate: number }
    efficiency: number // ratio of codeagent/traditional
  }>
  realtime: {
    activeAgents: number
    tokensPerMinute: number
    costPerMinute: number
    currentEfficiency: number
  }
}

export interface ComparisonData {
  timestamp: Date
  codeagentTokens: number
  traditionalTokens: number
  savings: number
  category: string
}

export class TokenEfficiencyTracker extends EventEmitter {
  private db: Database.Database
  private metricsCache: EfficiencyMetrics | null = null
  private cacheExpiry: Date | null = null
  private readonly CACHE_DURATION = 60000 // 1 minute

  constructor(dbPath?: string) {
    super()
    
    // Initialize SQLite database
    const dataDir = path.join(process.cwd(), 'data', 'metrics')
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true })
    }
    
    this.db = new Database(dbPath || path.join(dataDir, 'token-efficiency.sqlite'))
    this.initializeDatabase()
  }

  private initializeDatabase(): void {
    // Create main tracking table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS token_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        session_id TEXT NOT NULL,
        tool_category TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        approach TEXT NOT NULL CHECK (approach IN ('codeagent', 'traditional')),
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        cost_usd REAL NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        task_completed BOOLEAN NOT NULL,
        efficiency REAL NOT NULL,
        metadata TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // Create indexes for performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_timestamp ON token_usage(timestamp);
      CREATE INDEX IF NOT EXISTS idx_category ON token_usage(tool_category);
      CREATE INDEX IF NOT EXISTS idx_approach ON token_usage(approach);
      CREATE INDEX IF NOT EXISTS idx_session ON token_usage(session_id);
    `)

    // Create aggregated metrics table for faster queries
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS efficiency_summary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        category TEXT NOT NULL,
        approach TEXT NOT NULL,
        total_tokens INTEGER NOT NULL,
        total_cost REAL NOT NULL,
        total_tasks INTEGER NOT NULL,
        successful_tasks INTEGER NOT NULL,
        avg_efficiency REAL NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(date, category, approach)
      )
    `)
  }

  // Record token usage for a tool operation
  recordUsage(usage: Omit<TokenUsage, 'efficiency'>): void {
    // Calculate efficiency (lower is better - tokens per successful task)
    const efficiency = usage.taskCompleted ? usage.totalTokens : Infinity

    const fullUsage: TokenUsage = {
      ...usage,
      efficiency
    }

    // Insert into database
    const stmt = this.db.prepare(`
      INSERT INTO token_usage (
        timestamp, session_id, tool_category, tool_name, approach,
        input_tokens, output_tokens, total_tokens, cost_usd,
        provider, model, task_completed, efficiency, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      usage.timestamp.toISOString(),
      usage.sessionId,
      usage.toolCategory,
      usage.toolName,
      usage.approach,
      usage.inputTokens,
      usage.outputTokens,
      usage.totalTokens,
      usage.costUsd,
      usage.provider,
      usage.model,
      usage.taskCompleted,
      efficiency,
      usage.metadata ? JSON.stringify(usage.metadata) : null
    )

    // Update aggregated summary
    this.updateDailySummary(usage.timestamp, fullUsage)

    // Invalidate cache
    this.metricsCache = null
    this.cacheExpiry = null

    // Emit real-time update
    this.emit('usage-recorded', fullUsage)
  }

  private updateDailySummary(date: Date, usage: TokenUsage): void {
    const dateStr = date.toISOString().split('T')[0]
    
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO efficiency_summary (
        date, category, approach, total_tokens, total_cost, 
        total_tasks, successful_tasks, avg_efficiency
      ) VALUES (
        ?, ?, ?, 
        COALESCE((SELECT total_tokens FROM efficiency_summary WHERE date = ? AND category = ? AND approach = ?), 0) + ?,
        COALESCE((SELECT total_cost FROM efficiency_summary WHERE date = ? AND category = ? AND approach = ?), 0) + ?,
        COALESCE((SELECT total_tasks FROM efficiency_summary WHERE date = ? AND category = ? AND approach = ?), 0) + 1,
        COALESCE((SELECT successful_tasks FROM efficiency_summary WHERE date = ? AND category = ? AND approach = ?), 0) + ?,
        (COALESCE((SELECT total_tokens FROM efficiency_summary WHERE date = ? AND category = ? AND approach = ?), 0) + ?) / 
        (COALESCE((SELECT successful_tasks FROM efficiency_summary WHERE date = ? AND category = ? AND approach = ?), 0) + ?)
      )
    `)

    const successIncrement = usage.taskCompleted ? 1 : 0
    const divisor = Math.max(1, successIncrement + (this.getExistingSuccessfulTasks(dateStr, usage.toolCategory, usage.approach) || 0))

    stmt.run(
      dateStr, usage.toolCategory, usage.approach,
      dateStr, usage.toolCategory, usage.approach, usage.totalTokens,
      dateStr, usage.toolCategory, usage.approach, usage.costUsd,
      dateStr, usage.toolCategory, usage.approach,
      dateStr, usage.toolCategory, usage.approach, successIncrement,
      dateStr, usage.toolCategory, usage.approach, usage.totalTokens,
      dateStr, usage.toolCategory, usage.approach, divisor
    )
  }

  private getExistingSuccessfulTasks(date: string, category: string, approach: string): number {
    const stmt = this.db.prepare(`
      SELECT successful_tasks FROM efficiency_summary 
      WHERE date = ? AND category = ? AND approach = ?
    `)
    const result = stmt.get(date, category, approach) as any
    return result?.successful_tasks || 0
  }

  // Get current efficiency metrics
  getMetrics(): EfficiencyMetrics {
    // Return cached metrics if still valid
    if (this.metricsCache && this.cacheExpiry && new Date() < this.cacheExpiry) {
      return this.metricsCache
    }

    const now = new Date()
    const today = now.toISOString().split('T')[0]
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    // Calculate period metrics
    const todayMetrics = this.calculatePeriodMetrics(today, today)
    const weekMetrics = this.calculatePeriodMetrics(weekAgo, today)
    const monthMetrics = this.calculatePeriodMetrics(monthAgo, today)

    // Calculate by-category metrics
    const byCategory = this.calculateCategoryMetrics()

    // Calculate real-time metrics
    const realtime = this.calculateRealtimeMetrics()

    this.metricsCache = {
      today: todayMetrics,
      week: weekMetrics,
      month: monthMetrics,
      byCategory,
      realtime
    }

    this.cacheExpiry = new Date(now.getTime() + this.CACHE_DURATION)
    return this.metricsCache
  }

  private calculatePeriodMetrics(startDate: string, endDate: string): { tokensSaved: number; costSaved: number; efficiencyRatio: number } {
    const stmt = this.db.prepare(`
      SELECT 
        approach,
        SUM(total_tokens) as total_tokens,
        SUM(total_cost) as total_cost,
        SUM(successful_tasks) as successful_tasks
      FROM efficiency_summary 
      WHERE date >= ? AND date <= ?
      GROUP BY approach
    `)

    const results = stmt.all(startDate, endDate) as any[]
    
    const codeagent = results.find(r => r.approach === 'codeagent') || { total_tokens: 0, total_cost: 0, successful_tasks: 0 }
    const traditional = results.find(r => r.approach === 'traditional') || { total_tokens: 0, total_cost: 0, successful_tasks: 0 }

    const tokensSaved = traditional.total_tokens - codeagent.total_tokens
    const costSaved = traditional.total_cost - codeagent.total_cost
    const efficiencyRatio = traditional.total_tokens > 0 ? codeagent.total_tokens / traditional.total_tokens : 1

    return { tokensSaved, costSaved, efficiencyRatio }
  }

  private calculateCategoryMetrics(): Record<string, any> {
    const stmt = this.db.prepare(`
      SELECT 
        category,
        approach,
        AVG(total_tokens) as avg_tokens,
        AVG(total_cost) as avg_cost,
        AVG(CAST(successful_tasks AS REAL) / total_tasks) as success_rate
      FROM efficiency_summary 
      WHERE date >= date('now', '-30 days')
      GROUP BY category, approach
    `)

    const results = stmt.all() as any[]
    const categories: Record<string, any> = {}

    for (const row of results) {
      if (!categories[row.category]) {
        categories[row.category] = {
          codeagent: { avgTokens: 0, avgCost: 0, successRate: 0 },
          traditional: { avgTokens: 0, avgCost: 0, successRate: 0 },
          efficiency: 1
        }
      }

      categories[row.category][row.approach] = {
        avgTokens: row.avg_tokens || 0,
        avgCost: row.avg_cost || 0,
        successRate: row.success_rate || 0
      }
    }

    // Calculate efficiency ratios
    for (const category in categories) {
      const codeagent = categories[category].codeagent.avgTokens
      const traditional = categories[category].traditional.avgTokens
      categories[category].efficiency = traditional > 0 ? codeagent / traditional : 1
    }

    return categories
  }

  private calculateRealtimeMetrics(): { activeAgents: number; tokensPerMinute: number; costPerMinute: number; currentEfficiency: number } {
    const stmt = this.db.prepare(`
      SELECT 
        COUNT(DISTINCT session_id) as active_agents,
        SUM(total_tokens) as recent_tokens,
        SUM(cost_usd) as recent_cost,
        AVG(CASE WHEN approach = 'codeagent' THEN total_tokens END) as codeagent_avg,
        AVG(CASE WHEN approach = 'traditional' THEN total_tokens END) as traditional_avg
      FROM token_usage 
      WHERE timestamp >= datetime('now', '-5 minutes')
    `)

    const result = stmt.get() as any
    
    return {
      activeAgents: result?.active_agents || 0,
      tokensPerMinute: (result?.recent_tokens || 0) / 5, // 5-minute window
      costPerMinute: (result?.recent_cost || 0) / 5,
      currentEfficiency: result?.traditional_avg > 0 ? (result?.codeagent_avg || 0) / result.traditional_avg : 1
    }
  }

  // Get historical comparison data for charts
  getComparisonData(days: number = 30): ComparisonData[] {
    const stmt = this.db.prepare(`
      SELECT 
        date as timestamp,
        category,
        SUM(CASE WHEN approach = 'codeagent' THEN total_tokens ELSE 0 END) as codeagent_tokens,
        SUM(CASE WHEN approach = 'traditional' THEN total_tokens ELSE 0 END) as traditional_tokens
      FROM efficiency_summary 
      WHERE date >= date('now', '-' || ? || ' days')
      GROUP BY date, category
      ORDER BY date, category
    `)

    const results = stmt.all(days) as any[]
    
    return results.map(row => ({
      timestamp: new Date(row.timestamp),
      codeagentTokens: row.codeagent_tokens,
      traditionalTokens: row.traditional_tokens,
      savings: row.traditional_tokens - row.codeagent_tokens,
      category: row.category
    }))
  }

  // Export data for reports
  exportData(format: 'json' | 'csv', days: number = 30): string {
    const stmt = this.db.prepare(`
      SELECT 
        timestamp,
        session_id,
        tool_category,
        tool_name,
        approach,
        input_tokens,
        output_tokens,
        total_tokens,
        cost_usd,
        provider,
        model,
        task_completed,
        efficiency
      FROM token_usage 
      WHERE timestamp >= datetime('now', '-' || ? || ' days')
      ORDER BY timestamp DESC
    `)

    const results = stmt.all(days) as any[]

    if (format === 'json') {
      return JSON.stringify(results, null, 2)
    } else {
      // CSV format
      if (results.length === 0) {return 'No data available'}
      
      const headers = Object.keys(results[0]).join(',')
      const rows = results.map(row => 
        Object.values(row).map(val => 
          typeof val === 'string' && val.includes(',') ? `"${val}"` : val
        ).join(',')
      )
      
      return [headers, ...rows].join('\n')
    }
  }

  // Clean up old data
  cleanup(keepDays: number = 90): number {
    const stmt = this.db.prepare(`
      DELETE FROM token_usage 
      WHERE timestamp < datetime('now', '-' || ? || ' days')
    `)
    const result = stmt.run(keepDays)

    const summaryStmt = this.db.prepare(`
      DELETE FROM efficiency_summary 
      WHERE date < date('now', '-' || ? || ' days')
    `)
    summaryStmt.run(keepDays)

    return result.changes
  }

  // Close database connection
  close(): void {
    this.db.close()
  }
}

// Singleton instance for global usage
export const tokenTracker = new TokenEfficiencyTracker()

// Utility functions for easy integration
export function trackToolUsage(
  toolName: string,
  category: TokenUsage['toolCategory'],
  sessionId: string,
  tokens: { input: number; output: number },
  cost: number,
  provider: string,
  model: string,
  success: boolean,
  approach: 'codeagent' | 'traditional' = 'codeagent',
  metadata?: Record<string, any>
) {
  tokenTracker.recordUsage({
    timestamp: new Date(),
    sessionId,
    toolCategory: category,
    toolName,
    approach,
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    totalTokens: tokens.input + tokens.output,
    costUsd: cost,
    provider,
    model,
    taskCompleted: success,
    metadata
  })
}

export function getEfficiencyMetrics(): EfficiencyMetrics {
  return tokenTracker.getMetrics()
}

export function exportEfficiencyReport(format: 'json' | 'csv' = 'json', days: number = 30): string {
  return tokenTracker.exportData(format, days)
}