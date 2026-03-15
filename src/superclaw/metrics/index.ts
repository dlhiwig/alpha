import { EventEmitter } from 'events'

export interface MetricPoint {
  name: string
  value: number
  timestamp: Date
  labels?: Record<string, string>
}

export interface Counter {
  inc(value?: number): void
  inc(labels: Record<string, string>, value?: number): void
  get(): number
  reset(): void
}

export interface Gauge {
  set(value: number): void
  inc(value?: number): void
  dec(value?: number): void
  get(): number
}

export interface Histogram {
  observe(value: number): void
  observe(labels: Record<string, string>, value: number): void
  getPercentile(p: number): number
}

export class MetricsRegistry extends EventEmitter {
  private counters: Map<string, number> = new Map()
  private gauges: Map<string, number> = new Map()
  private histograms: Map<string, number[]> = new Map()
  
  counter(name: string): Counter {
    if (!this.counters.has(name)) {
      this.counters.set(name, 0)
    }
    
    return {
      inc: (valueOrLabels?: number | Record<string, string>, value?: number) => {
        const inc = typeof valueOrLabels === 'number' ? valueOrLabels : (value || 1)
        this.counters.set(name, (this.counters.get(name) || 0) + inc)
        this.emit('metric', { name, type: 'counter', value: this.counters.get(name) })
      },
      get: () => this.counters.get(name) || 0,
      reset: () => this.counters.set(name, 0)
    }
  }
  
  gauge(name: string): Gauge {
    if (!this.gauges.has(name)) {
      this.gauges.set(name, 0)
    }
    
    return {
      set: (value: number) => {
        this.gauges.set(name, value)
        this.emit('metric', { name, type: 'gauge', value })
      },
      inc: (value: number = 1) => {
        this.gauges.set(name, (this.gauges.get(name) || 0) + value)
      },
      dec: (value: number = 1) => {
        this.gauges.set(name, (this.gauges.get(name) || 0) - value)
      },
      get: () => this.gauges.get(name) || 0
    }
  }
  
  histogram(name: string): Histogram {
    if (!this.histograms.has(name)) {
      this.histograms.set(name, [])
    }
    
    return {
      observe: (valueOrLabels: number | Record<string, string>, value?: number) => {
        const obs = typeof valueOrLabels === 'number' ? valueOrLabels : value!
        this.histograms.get(name)!.push(obs)
        this.emit('metric', { name, type: 'histogram', value: obs })
      },
      getPercentile: (p: number) => {
        const values = [...this.histograms.get(name)!].sort((a, b) => a - b)
        const index = Math.ceil(values.length * p / 100) - 1
        return values[Math.max(0, index)] || 0
      }
    }
  }
  
  getAll(): { counters: Record<string, number>; gauges: Record<string, number> } {
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges)
    }
  }
}

// Pre-configured metrics
export const metrics = new MetricsRegistry()

// SKYNET Metrics
export const skynetMetrics = {
  // Memory metrics
  memoriesStored: metrics.counter('skynet_memories_stored_total'),
  memoriesCompacted: metrics.counter('skynet_memories_compacted_total'),
  memoryQueryLatency: metrics.histogram('skynet_memory_query_latency_ms'),
  
  // Orchestration metrics
  agentsSpawned: metrics.counter('skynet_agents_spawned_total'),
  agentsActive: metrics.gauge('skynet_agents_active'),
  messagesSent: metrics.counter('skynet_messages_sent_total'),
  
  // Security metrics
  sandboxesCreated: metrics.counter('skynet_sandboxes_created_total'),
  commandsExecuted: metrics.counter('skynet_commands_executed_total'),
  commandsBlocked: metrics.counter('skynet_commands_blocked_total'),
  
  // Consensus metrics
  consensusDecisions: metrics.counter('skynet_consensus_decisions_total'),
  consensusRounds: metrics.histogram('skynet_consensus_rounds'),
  consensusLatency: metrics.histogram('skynet_consensus_latency_ms'),
  
  // Cost metrics
  costTotal: metrics.gauge('skynet_cost_total_usd'),
  costByModel: metrics.gauge('skynet_cost_by_model_usd'),
  
  // System metrics
  uptime: metrics.gauge('skynet_uptime_seconds')
}

// Start uptime counter
const startTime = Date.now()
setInterval(() => {
  skynetMetrics.uptime.set(Math.floor((Date.now() - startTime) / 1000))
}, 10000)