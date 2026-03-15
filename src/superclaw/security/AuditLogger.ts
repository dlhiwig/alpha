import * as fs from 'fs/promises'
import * as path from 'path'
import { EventEmitter } from 'events'
import type { SecurityAuditEvent, SecurityEventType } from './types'

export class AuditLogger extends EventEmitter {
  private logPath: string
  private buffer: SecurityAuditEvent[] = []
  private flushInterval: NodeJS.Timeout | null = null
  private maxBufferSize: number = 100
  private flushIntervalMs: number = 5000
  
  constructor(config?: {
    logPath?: string
    maxBufferSize?: number
    flushIntervalMs?: number
  }) {
    super()
    this.logPath = config?.logPath || path.join(
      process.env.HOME || '~',
      '.superclaw',
      'audit',
      'security.log'
    )
    this.maxBufferSize = config?.maxBufferSize || 100
    this.flushIntervalMs = config?.flushIntervalMs || 5000
  }
  
  async initialize(): Promise<void> {
    // Ensure log directory exists
    await fs.mkdir(path.dirname(this.logPath), { recursive: true })
    
    // Start periodic flush
    this.flushInterval = setInterval(
      () => this.flush().catch(console.error),
      this.flushIntervalMs
    )
  }
  
  async log(event: Omit<SecurityAuditEvent, 'timestamp'>): Promise<void> {
    const fullEvent: SecurityAuditEvent = {
      ...event,
      timestamp: new Date()
    }
    
    this.buffer.push(fullEvent)
    this.emit('event', fullEvent)
    
    // Immediate flush for critical events
    if (event.severity === 'critical') {
      await this.flush()
    }
    
    // Flush if buffer is full
    if (this.buffer.length >= this.maxBufferSize) {
      await this.flush()
    }
  }
  
  async logSandboxCreated(sandboxId: string, agentId: string, config: any): Promise<void> {
    await this.log({
      sandboxId,
      eventType: 'sandbox_created',
      details: { agentId, config },
      severity: 'low'
    })
  }
  
  async logCommandExecuted(sandboxId: string, command: string, result: any): Promise<void> {
    await this.log({
      sandboxId,
      eventType: 'command_executed',
      details: { command, exitCode: result.exitCode },
      severity: 'low'
    })
  }
  
  async logCommandBlocked(sandboxId: string, command: string, reason: string): Promise<void> {
    await this.log({
      sandboxId,
      eventType: 'command_blocked',
      details: { command, reason },
      severity: 'high'
    })
  }
  
  async logNetworkBlocked(sandboxId: string, domain: string, reason: string): Promise<void> {
    await this.log({
      sandboxId,
      eventType: 'network_blocked',
      details: { domain, reason },
      severity: 'high'
    })
  }
  
  async logResourceLimitHit(sandboxId: string, resource: string, limit: any, actual: any): Promise<void> {
    await this.log({
      sandboxId,
      eventType: 'resource_limit_hit',
      details: { resource, limit, actual },
      severity: 'medium'
    })
  }
  
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return
    
    const events = [...this.buffer]
    this.buffer = []
    
    const lines = events.map(e => JSON.stringify(e)).join('\n') + '\n'
    await fs.appendFile(this.logPath, lines)
  }
  
  async query(filter: {
    sandboxId?: string
    eventType?: SecurityEventType
    severity?: string
    since?: Date
    until?: Date
  }): Promise<SecurityAuditEvent[]> {
    try {
      const content = await fs.readFile(this.logPath, 'utf-8')
      const events = content
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line) as SecurityAuditEvent)
      
      return events.filter(e => {
        if (filter.sandboxId && e.sandboxId !== filter.sandboxId) return false
        if (filter.eventType && e.eventType !== filter.eventType) return false
        if (filter.severity && e.severity !== filter.severity) return false
        if (filter.since && new Date(e.timestamp) < filter.since) return false
        if (filter.until && new Date(e.timestamp) > filter.until) return false
        return true
      })
    } catch (error: unknown) {
      return []
    }
  }
  
  async getStats(): Promise<{
    totalEvents: number
    byType: Record<string, number>
    bySeverity: Record<string, number>
    last24h: number
  }> {
    const events = await this.query({})
    const now = new Date()
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    
    const byType: Record<string, number> = {}
    const bySeverity: Record<string, number> = {}
    let last24h = 0
    
    for (const event of events) {
      byType[event.eventType] = (byType[event.eventType] || 0) + 1
      bySeverity[event.severity] = (bySeverity[event.severity] || 0) + 1
      if (new Date(event.timestamp) > yesterday) last24h++
    }
    
    return {
      totalEvents: events.length,
      byType,
      bySeverity,
      last24h
    }
  }
  
  async shutdown(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval)
    }
    await this.flush()
  }

  // Standard logging interface methods for compatibility
  info(message: string, context?: Record<string, any>): void {
    this.log({
      sandboxId: 'agent-mail-integration',
      eventType: 'command_executed',
      details: { message, ...context },
      severity: 'low'
    }).catch(console.error)
  }

  error(message: string, context?: Record<string, any>): void {
    this.log({
      sandboxId: 'agent-mail-integration',
      eventType: 'command_blocked',
      details: { message, ...context },
      severity: 'high'
    }).catch(console.error)
  }

  warn(message: string, context?: Record<string, any>): void {
    this.log({
      sandboxId: 'agent-mail-integration',
      eventType: 'resource_limit_hit',
      details: { message, ...context },
      severity: 'medium'
    }).catch(console.error)
  }
}