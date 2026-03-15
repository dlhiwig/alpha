// @ts-nocheck
import { EventEmitter } from 'events'

export interface HealthStatus {
  system: string
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown'
  latencyMs?: number
  details?: Record<string, any>
  lastCheck: Date
  error?: string
}

export interface OverallHealth {
  status: 'healthy' | 'degraded' | 'unhealthy'
  systems: HealthStatus[]
  uptime: number
  version: string
  timestamp: Date
}

export class HealthChecker extends EventEmitter {
  private checks: Map<string, () => Promise<HealthStatus>> = new Map()
  private lastResults: Map<string, HealthStatus> = new Map()
  private startTime: Date = new Date()
  
  registerCheck(system: string, check: () => Promise<HealthStatus>): void {
    this.checks.set(system, check)
  }
  
  async checkSystem(system: string): Promise<HealthStatus> {
    const check = this.checks.get(system)
    if (!check) {
      return {
        system,
        status: 'unknown',
        lastCheck: new Date(),
        error: 'No health check registered'
      }
    }
    
    const start = Date.now()
    try {
      const result = await check()
      result.latencyMs = Date.now() - start
      this.lastResults.set(system, result)
      return result
    } catch (error: unknown) {
      const result: HealthStatus = {
        system,
        status: 'unhealthy',
        lastCheck: new Date(),
        latencyMs: Date.now() - start,
        error: String(error)
      }
      this.lastResults.set(system, result)
      this.emit('unhealthy', result)
      return result
    }
  }
  
  async checkAll(): Promise<OverallHealth> {
    const systems: HealthStatus[] = []
    
    for (const system of this.checks.keys()) {
      const result = await this.checkSystem(system)
      systems.push(result)
    }
    
    const unhealthy = systems.filter(s => s.status === 'unhealthy').length
    const degraded = systems.filter(s => s.status === 'degraded').length
    
    let status: 'healthy' | 'degraded' | 'unhealthy'
    if (unhealthy > 0) {
      status = 'unhealthy'
    } else if (degraded > 0) {
      status = 'degraded'
    } else {
      status = 'healthy'
    }
    
    return {
      status,
      systems,
      uptime: Date.now() - this.startTime.getTime(),
      version: '2.3.0',
      timestamp: new Date()
    }
  }
  
  getLastResult(system: string): HealthStatus | undefined {
    return this.lastResults.get(system)
  }
}

// Pre-configured health checks
export function createDefaultHealthChecks(): HealthChecker {
  const checker = new HealthChecker()
  
  // Memory system check
  checker.registerCheck('memory', async () => {
    try {
      const { createMemoryService } = await import('../memory')
      const memory = await createMemoryService()
      // Quick test query
      await memory.loadAgentContext('health-check', 1)
      return {
        system: 'memory',
        status: 'healthy',
        lastCheck: new Date(),
        details: { backend: 'dolt' }
      }
    } catch (error: unknown) {
      return {
        system: 'memory',
        status: 'unhealthy',
        lastCheck: new Date(),
        error: String(error)
      }
    }
  })
  
  // Orchestration check
  checker.registerCheck('orchestration', async () => {
    try {
      const { AgentOrchestrator } = await import('../orchestration')
      const orchestrator = new AgentOrchestrator()
      const sessions = await orchestrator.listSessions()
      return {
        system: 'orchestration',
        status: 'healthy',
        lastCheck: new Date(),
        details: { activeSessions: sessions.length }
      }
    } catch (error: unknown) {
      return {
        system: 'orchestration',
        status: 'unhealthy',
        lastCheck: new Date(),
        error: String(error)
      }
    }
  })
  
  // Security check
  checker.registerCheck('security', async () => {
    try {
      const { SandboxManager } = await import('../security')
      const manager = new SandboxManager()
      const sandboxes = manager.listSandboxes()
      return {
        system: 'security',
        status: 'healthy',
        lastCheck: new Date(),
        details: { activeSandboxes: sandboxes.length }
      }
    } catch (error: unknown) {
      return {
        system: 'security',
        status: 'unhealthy',
        lastCheck: new Date(),
        error: String(error)
      }
    }
  })
  
  // Cost control check
  checker.registerCheck('cost-control', async () => {
    try {
      const { globalCostController } = await import('../skynet/cost-control')
      const status = globalCostController.getStatus()
      return {
        system: 'cost-control',
        status: status.paused ? 'degraded' : 'healthy',
        lastCheck: new Date(),
        details: {
          spent: status.spent,
          remaining: status.remaining,
          paused: status.paused
        }
      }
    } catch (error: unknown) {
      return {
        system: 'cost-control',
        status: 'unhealthy',
        lastCheck: new Date(),
        error: String(error)
      }
    }
  })
  
  return checker
}

export const healthChecker = createDefaultHealthChecks()