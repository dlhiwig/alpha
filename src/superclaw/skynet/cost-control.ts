import { EventEmitter } from 'events'
import { promises as fs } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface CostConfig {
  dailyLimit: number      // e.g. $50
  perAgentLimit: number   // e.g. $5
  warningThreshold: number // e.g. 0.8 (80%)
  pauseOnLimit: boolean
  notifyChannel?: string
  persistencePath?: string
  emergencyContact?: string
  allowOverride: boolean  // Allow manual override of limits
  hardCapMultiplier: number // Hard cap as multiplier of dailyLimit (e.g. 1.5 = 150%)
}

export interface CostTracker {
  date: string           // YYYY-MM-DD
  totalSpent: number
  byAgent: Map<string, number>
  byModel: Map<string, number>
  transactions: CostTransaction[]
  warnings: CostWarning[]
  overrides: CostOverride[]
}

export interface CostTransaction {
  timestamp: Date
  agentId: string
  model: string
  inputTokens: number
  outputTokens: number
  costUSD: number
  requestId?: string
  taskType?: string
}

export interface CostWarning {
  timestamp: Date
  type: 'threshold' | 'agent-limit' | 'daily-limit' | 'hard-cap'
  message: string
  spent: number
  limit: number
  agentId?: string
}

export interface CostOverride {
  timestamp: Date
  type: 'resume' | 'increase-limit' | 'emergency'
  reason: string
  previousLimit?: number
  newLimit?: number
  authorizedBy?: string
}

export interface BudgetCheckResult {
  allowed: boolean
  reason?: string
  remaining: number
  warningMessage?: string
  estimatedCost: number
  actualLimit: number
}

export class CostController extends EventEmitter {
  private config: CostConfig
  private tracker: CostTracker
  private paused: boolean = false
  private hardCapReached: boolean = false
  private lastPersisted: number = 0
  private persistenceInterval: NodeJS.Timer | null = null

  constructor(config: Partial<CostConfig> = {}) {
    super()
    this.config = {
      dailyLimit: 50,
      perAgentLimit: 5,
      warningThreshold: 0.8,
      pauseOnLimit: true,
      allowOverride: true,
      hardCapMultiplier: 2.0,
      persistencePath: join(homedir(), '.superclaw', 'cost-tracking'),
      ...config
    }
    
    this.tracker = this.initializeTracker()
    this.setupPersistence()
    this.loadPersistedData()
    
    // Auto-reset at midnight
    this.scheduleDailyReset()
    
    // Set up event handlers
    this.setupEventHandlers()
  }

  // Check before making API call
  async checkBudget(agentId: string, model: string, estimatedTokens: { input: number; output: number }): Promise<BudgetCheckResult> {
    const estimatedCost = this.estimateCost(model, estimatedTokens.input, estimatedTokens.output)
    
    // Hard cap check (emergency brake)
    const hardCap = this.config.dailyLimit * this.config.hardCapMultiplier
    if (this.tracker.totalSpent + estimatedCost > hardCap) {
      this.hardCapReached = true
      this.paused = true
      this.addWarning('hard-cap', `EMERGENCY: Hard cap of $${hardCap.toFixed(2)} would be exceeded`, this.tracker.totalSpent, hardCap)
      this.emit('emergency-stop', { 
        type: 'hard-cap', 
        spent: this.tracker.totalSpent, 
        hardCap,
        estimatedCost,
        agentId 
      })
      
      return { 
        allowed: false, 
        reason: `EMERGENCY STOP: Hard cap of $${hardCap.toFixed(2)} would be exceeded`, 
        remaining: 0,
        estimatedCost,
        actualLimit: hardCap
      }
    }

    if (this.paused) {
      return { 
        allowed: false, 
        reason: 'Cost controller paused - manual intervention required', 
        remaining: 0,
        estimatedCost,
        actualLimit: this.config.dailyLimit
      }
    }
    
    const dailyRemaining = this.config.dailyLimit - this.tracker.totalSpent
    const agentSpent = this.tracker.byAgent.get(agentId) || 0
    const agentRemaining = this.config.perAgentLimit - agentSpent

    // Check daily limit
    if (estimatedCost > dailyRemaining) {
      if (this.config.pauseOnLimit) this.paused = true
      this.addWarning('daily-limit', `Daily limit of $${this.config.dailyLimit} would be exceeded`, this.tracker.totalSpent, this.config.dailyLimit)
      this.emit('limit-reached', { type: 'daily', spent: this.tracker.totalSpent, agentId })
      
      return { 
        allowed: false, 
        reason: `Daily limit of $${this.config.dailyLimit.toFixed(2)} would be exceeded`, 
        remaining: dailyRemaining,
        estimatedCost,
        actualLimit: this.config.dailyLimit
      }
    }
    
    // Check per-agent limit
    if (estimatedCost > agentRemaining) {
      this.addWarning('agent-limit', `Agent ${agentId} limit of $${this.config.perAgentLimit} would be exceeded`, agentSpent, this.config.perAgentLimit, agentId)
      this.emit('limit-reached', { type: 'agent', agentId, spent: agentSpent })
      
      return { 
        allowed: false, 
        reason: `Agent ${agentId} limit of $${this.config.perAgentLimit.toFixed(2)} would be exceeded`, 
        remaining: agentRemaining,
        estimatedCost,
        actualLimit: this.config.perAgentLimit
      }
    }
    
    // Warning threshold check
    const newTotal = this.tracker.totalSpent + estimatedCost
    const warningLevel = this.config.dailyLimit * this.config.warningThreshold
    let warningMessage: string | undefined
    
    if (newTotal > warningLevel && this.tracker.totalSpent <= warningLevel) {
      const percentage = (newTotal / this.config.dailyLimit * 100).toFixed(1)
      warningMessage = `Warning: ${percentage}% of daily budget will be consumed ($${newTotal.toFixed(2)}/$${this.config.dailyLimit})`
      
      this.addWarning('threshold', warningMessage, newTotal, this.config.dailyLimit)
      this.emit('warning', { 
        spent: newTotal, 
        limit: this.config.dailyLimit,
        percentage: parseFloat(percentage),
        agentId,
        model
      })
    }
    
    return { 
      allowed: true, 
      remaining: Math.min(dailyRemaining, agentRemaining),
      warningMessage,
      estimatedCost,
      actualLimit: Math.min(this.config.dailyLimit, this.config.perAgentLimit + agentSpent)
    }
  }
  
  // Record actual cost after API call
  recordCost(transaction: Omit<CostTransaction, 'timestamp'>): void {
    const fullTransaction: CostTransaction = {
      ...transaction,
      timestamp: new Date()
    }
    
    this.tracker.transactions.push(fullTransaction)
    this.tracker.totalSpent += transaction.costUSD
    
    const agentSpent = this.tracker.byAgent.get(transaction.agentId) || 0
    this.tracker.byAgent.set(transaction.agentId, agentSpent + transaction.costUSD)
    
    const modelSpent = this.tracker.byModel.get(transaction.model) || 0
    this.tracker.byModel.set(transaction.model, modelSpent + transaction.costUSD)
    
    this.emit('cost-recorded', fullTransaction)
    
    // Trigger persistence if significant cost or time passed
    if (transaction.costUSD > 1.0 || Date.now() - this.lastPersisted > 30000) {
      this.persistTracker()
    }
  }
  
  // Enhanced model cost estimation with latest rates
  estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    const rates: Record<string, { input: number; output: number }> = {
      // Claude (per 1M tokens in USD)
      'claude-opus-4-20250514': { input: 15, output: 75 },
      'claude-sonnet-4-20250514': { input: 3, output: 15 },
      'claude-3-5-sonnet-20241022': { input: 3, output: 15 },
      'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
      
      // OpenAI
      'gpt-4o': { input: 5, output: 15 },
      'gpt-4o-mini': { input: 0.15, output: 0.60 },
      'gpt-4-turbo': { input: 10, output: 30 },
      'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
      
      // Google
      'gemini-2.0-flash': { input: 0.075, output: 0.30 },
      'gemini-1.5-pro': { input: 1.25, output: 5.00 },
      
      // Others
      'kimi-k2.5': { input: 0.60, output: 3.00 },
      'deepseek-chat': { input: 0.14, output: 0.28 },
      
      // NVIDIA NIM
      'nvidia/nemotron-3-nano-30b-a3b': { input: 0.48, output: 1.44 },
      'z-ai/glm5': { input: 1.00, output: 3.00 },
      'qwen/qwen3.5-397b-a17b': { input: 0.80, output: 2.40 }
    }
    
    // Default to Claude Sonnet if model not found
    const rate = rates[model] || rates['claude-sonnet-4-20250514']
    const cost = (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000
    
    // Add 10% buffer for estimation errors
    return cost * 1.1
  }
  
  // Get comprehensive status
  getStatus(): {
    date: string
    spent: number
    limit: number
    remaining: number
    percentage: number
    paused: boolean
    hardCapReached: boolean
    topAgents: Array<{ agentId: string; spent: number; percentage: number }>
    topModels: Array<{ model: string; spent: number; percentage: number }>
    recentTransactions: CostTransaction[]
    warnings: CostWarning[]
    overrides: CostOverride[]
    config: CostConfig
    projectedDaily?: number
  } {
    const topAgents = Array.from(this.tracker.byAgent.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([agentId, spent]) => ({ 
        agentId, 
        spent, 
        percentage: (spent / this.config.perAgentLimit) * 100 
      }))
    
    const topModels = Array.from(this.tracker.byModel.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([model, spent]) => ({ 
        model, 
        spent, 
        percentage: (spent / this.tracker.totalSpent) * 100 
      }))
    
    const recentTransactions = this.tracker.transactions
      .slice(-10)
      .reverse()
      
    // Project daily spend based on current rate
    const now = new Date()
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const hoursElapsed = (now.getTime() - startOfDay.getTime()) / (1000 * 60 * 60)
    const projectedDaily = hoursElapsed > 0 ? (this.tracker.totalSpent / hoursElapsed) * 24 : undefined
    
    return {
      date: this.tracker.date,
      spent: this.tracker.totalSpent,
      limit: this.config.dailyLimit,
      remaining: this.config.dailyLimit - this.tracker.totalSpent,
      percentage: (this.tracker.totalSpent / this.config.dailyLimit) * 100,
      paused: this.paused,
      hardCapReached: this.hardCapReached,
      topAgents,
      topModels,
      recentTransactions,
      warnings: this.tracker.warnings.slice(-20), // Last 20 warnings
      overrides: this.tracker.overrides,
      config: this.config,
      projectedDaily
    }
  }
  
  // Emergency controls
  emergencyStop(reason: string, authorizedBy?: string): void {
    this.paused = true
    this.addOverride('emergency', reason, undefined, undefined, authorizedBy)
    this.emit('emergency-stop', { reason, authorizedBy, timestamp: new Date() })
    this.persistTracker()
  }
  
  // Resume after limit/pause
  resume(reason: string, authorizedBy?: string): boolean {
    if (this.hardCapReached && !this.config.allowOverride) {
      this.emit('resume-denied', { reason: 'Hard cap reached, manual intervention required' })
      return false
    }
    
    this.paused = false
    this.addOverride('resume', reason, undefined, undefined, authorizedBy)
    this.emit('resumed', { reason, authorizedBy, timestamp: new Date() })
    this.persistTracker()
    return true
  }
  
  // Increase limits (with authorization)
  increaseDailyLimit(newLimit: number, reason: string, authorizedBy?: string): boolean {
    if (!this.config.allowOverride) {
      return false
    }
    
    const previousLimit = this.config.dailyLimit
    this.config.dailyLimit = newLimit
    this.addOverride('increase-limit', reason, previousLimit, newLimit, authorizedBy)
    this.emit('limit-increased', { previousLimit, newLimit, reason, authorizedBy })
    this.persistTracker()
    return true
  }
  
  // Reset for new day
  resetDaily(): void {
    this.archiveCurrentDay()
    this.tracker = this.initializeTracker()
    this.paused = false
    this.hardCapReached = false
    this.emit('reset', { date: this.tracker.date })
    this.persistTracker()
  }
  
  // Get cost breakdown by time periods
  getCostBreakdown(): {
    hourly: Array<{ hour: number; cost: number; transactions: number }>
    byModel: Array<{ model: string; cost: number; percentage: number }>
    byAgent: Array<{ agentId: string; cost: number; percentage: number }>
  } {
    const hourly = Array.from({ length: 24 }, (_, i) => ({ hour: i, cost: 0, transactions: 0 }))
    
    this.tracker.transactions.forEach(tx => {
      const hour = tx.timestamp.getHours()
      hourly[hour].cost += tx.costUSD
      hourly[hour].transactions += 1
    })
    
    const byModel = Array.from(this.tracker.byModel.entries())
      .map(([model, cost]) => ({
        model,
        cost,
        percentage: (cost / this.tracker.totalSpent) * 100
      }))
      .sort((a, b) => b.cost - a.cost)
      
    const byAgent = Array.from(this.tracker.byAgent.entries())
      .map(([agentId, cost]) => ({
        agentId,
        cost,
        percentage: (cost / this.tracker.totalSpent) * 100
      }))
      .sort((a, b) => b.cost - a.cost)
    
    return { hourly, byModel, byAgent }
  }
  
  // Private methods
  private initializeTracker(): CostTracker {
    return {
      date: new Date().toISOString().split('T')[0],
      totalSpent: 0,
      byAgent: new Map(),
      byModel: new Map(),
      transactions: [],
      warnings: [],
      overrides: []
    }
  }
  
  private addWarning(type: CostWarning['type'], message: string, spent: number, limit: number, agentId?: string): void {
    this.tracker.warnings.push({
      timestamp: new Date(),
      type,
      message,
      spent,
      limit,
      agentId
    })
  }
  
  private addOverride(type: CostOverride['type'], reason: string, previousLimit?: number, newLimit?: number, authorizedBy?: string): void {
    this.tracker.overrides.push({
      timestamp: new Date(),
      type,
      reason,
      previousLimit,
      newLimit,
      authorizedBy
    })
  }
  
  private setupPersistence(): void {
    // Auto-persist every 60 seconds if there are changes
    this.persistenceInterval = setInterval(() => {
      if (Date.now() - this.lastPersisted > 60000) {
        this.persistTracker()
      }
    }, 60000)
    
    // Persist on process exit
    process.on('beforeExit', () => this.persistTracker())
    process.on('SIGINT', () => {
      this.persistTracker()
      process.exit(0)
    })
  }
  
  private async persistTracker(): Promise<void> {
    try {
      await fs.mkdir(this.config.persistencePath!, { recursive: true })
      
      const data = {
        ...this.tracker,
        byAgent: Array.from(this.tracker.byAgent.entries()),
        byModel: Array.from(this.tracker.byModel.entries()),
        paused: this.paused,
        hardCapReached: this.hardCapReached,
        config: this.config,
        lastPersisted: new Date().toISOString()
      }
      
      const filePath = join(this.config.persistencePath!, `cost-tracker-${this.tracker.date}.json`)
      await fs.writeFile(filePath, JSON.stringify(data, null, 2))
      this.lastPersisted = Date.now()
      
      this.emit('persisted', { filePath, totalSpent: this.tracker.totalSpent })
    } catch (error: unknown) {
      this.emit('persistence-error', error)
    }
  }
  
  private async loadPersistedData(): Promise<void> {
    try {
      const today = new Date().toISOString().split('T')[0]
      const filePath = join(this.config.persistencePath!, `cost-tracker-${today}.json`)
      
      const data = JSON.parse(await fs.readFile(filePath, 'utf8'))
      
      if (data.date === today) {
        this.tracker = {
          ...data,
          byAgent: new Map(data.byAgent),
          byModel: new Map(data.byModel)
        }
        this.paused = data.paused || false
        this.hardCapReached = data.hardCapReached || false
        
        this.emit('loaded', { 
          filePath, 
          totalSpent: this.tracker.totalSpent,
          transactionCount: this.tracker.transactions.length
        })
      }
    } catch (error: unknown) {
      // File doesn't exist or is corrupted - start fresh
      this.emit('load-failed', error)
    }
  }
  
  private async archiveCurrentDay(): Promise<void> {
    try {
      const archivePath = join(this.config.persistencePath!, 'archive')
      await fs.mkdir(archivePath, { recursive: true })
      
      const sourceFile = join(this.config.persistencePath!, `cost-tracker-${this.tracker.date}.json`)
      const archiveFile = join(archivePath, `cost-tracker-${this.tracker.date}.json`)
      
      await fs.copyFile(sourceFile, archiveFile)
      this.emit('archived', { date: this.tracker.date, totalSpent: this.tracker.totalSpent })
    } catch (error: unknown) {
      this.emit('archive-error', error)
    }
  }
  
  private scheduleDailyReset(): void {
    const now = new Date()
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0)
    const msUntilMidnight = tomorrow.getTime() - now.getTime()
    
    setTimeout(() => {
      this.resetDaily()
      // Schedule next reset
      setInterval(() => this.resetDaily(), 24 * 60 * 60 * 1000)
    }, msUntilMidnight)
  }
  
  private setupEventHandlers(): void {
    this.on('warning', (data) => {
      console.warn(`💰 COST WARNING: ${data.spent.toFixed(2)}/${data.limit} (${data.percentage}%) - Agent: ${data.agentId}, Model: ${data.model}`)
    })
    
    this.on('limit-reached', (data) => {
      console.error(`🚨 COST LIMIT REACHED: ${data.type} - Agent: ${data.agentId || 'N/A'}, Spent: $${data.spent.toFixed(2)}`)
    })
    
    this.on('emergency-stop', (data) => {
      console.error(`🔴 EMERGENCY STOP: ${data.type} - Hard cap protection activated`)
    })
    
    this.on('cost-recorded', (transaction) => {
      if (transaction.costUSD > 5.0) {
        console.log(`💸 Large transaction: $${transaction.costUSD.toFixed(2)} - ${transaction.model} (${transaction.agentId})`)
      }
    })
  }
  
  // Cleanup
  destroy(): void {
    if (this.persistenceInterval) {
      // @ts-expect-error - Post-Merge Reconciliation
      clearInterval(this.persistenceInterval)
    }
    this.persistTracker()
    this.removeAllListeners()
  }
}

// Singleton for global cost control
export const globalCostController = new CostController({
  dailyLimit: 100,      // Higher limit for development
  perAgentLimit: 25,    // Higher per-agent limit
  warningThreshold: 0.75,
  pauseOnLimit: true,
  allowOverride: true,
  hardCapMultiplier: 1.5, // 150% hard cap
  notifyChannel: process.env.SUPERCLAW_NOTIFY_CHANNEL
})

// Export additional utilities
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  }).format(amount)
}

export function summarizeCosts(controller: CostController): string {
  const status = controller.getStatus()
  const breakdown = controller.getCostBreakdown()
  
  let summary = `📊 Daily Cost Summary (${status.date})\n`
  summary += `💰 Spent: ${formatCurrency(status.spent)} / ${formatCurrency(status.limit)} (${status.percentage.toFixed(1)}%)\n`
  summary += `🚦 Status: ${status.paused ? '🔴 PAUSED' : '🟢 Active'}${status.hardCapReached ? ' 🚨 HARD CAP' : ''}\n`
  
  if (status.projectedDaily) {
    summary += `📈 Projected Daily: ${formatCurrency(status.projectedDaily)}\n`
  }
  
  summary += `\n🤖 Top Agents:\n`
  status.topAgents.slice(0, 3).forEach(agent => {
    summary += `  • ${agent.agentId}: ${formatCurrency(agent.spent)} (${agent.percentage.toFixed(1)}%)\n`
  })
  
  summary += `\n🧠 Top Models:\n`
  breakdown.byModel.slice(0, 3).forEach(model => {
    summary += `  • ${model.model}: ${formatCurrency(model.cost)} (${model.percentage.toFixed(1)}%)\n`
  })
  
  return summary
}