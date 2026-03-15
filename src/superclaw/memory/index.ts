// Memory System Exports
export * from './types'
export * from './hash-id-generator'
export { DoltService } from './DoltService'
export { MemoryService } from './MemoryService'
export { MemoryCompactor } from './compactor'

// Hybrid Memory (SQLite FTS5 + Dolt)
export { 
  HybridMemoryService, 
  createHybridMemory as createFTS5HybridMemory 
} from './HybridMemoryService'
export type {
  MemoryFact,
  DecayTier,
  HybridMemoryConfig,
  SearchOptions,
  SearchResult
} from './HybridMemoryService'

// BEADS Integration
export { BeadsMemory } from './beads-adapter'
export type {
  BeadsIssue,
  BeadsDependency,
  BeadsComment,
  BeadsStatus,
  BeadsIssueType,
  DependencyType,
  AgentState,
  BeadsQuery,
  ReadyWorkOptions,
  BeadsMemoryConfig
} from './beads-adapter'

// Re-export commonly used types
export type {
  AgentMemory,
  MemoryType,
  MemoryStatus,
  MemoryRelationship,
  RelationshipType,
  MemoryQuery,
  CompactionConfig,
  MemoryServiceConfig
} from './types'

// Factory functions for easy setup

/**
 * Create a traditional SuperClaw memory service
 */
export async function createMemoryService(config?: {
  doltPath?: string
  enableCompaction?: boolean
  compactionConfig?: Partial<import('./types').CompactionConfig>
// @ts-expect-error - Post-Merge Reconciliation
}): Promise<MemoryService> {
  // @ts-expect-error - Post-Merge Reconciliation
  const service = new MemoryService({
    doltPath: config?.doltPath || '~/.superclaw/memory',
    compaction: {
      olderThan: '7 days',
      minSize: 500,
      maxCompactionLevel: 2,
      compressionTarget: 0.5,
      ...config?.compactionConfig
    },
    maxMemoriesPerAgent: 10000,
    enableRelationships: true
  })
  
  await service.initialize()
  return service
}

/**
 * Create a BEADS-based memory service with dependency tracking
 */
export async function createBeadsMemory(config?: {
  repositoryPath?: string
  defaultPrefix?: string
  enableGitIntegration?: boolean
  enableAutoCompaction?: boolean
  logLevel?: 'error' | 'warn' | 'info' | 'debug'
// @ts-expect-error - Post-Merge Reconciliation
}): Promise<BeadsMemory> {
  const { BeadsMemory } = await import('./beads-adapter')
  
  const service = new BeadsMemory({
    repositoryPath: config?.repositoryPath || '~/.superclaw/beads-memory',
    defaultPrefix: config?.defaultPrefix || 'bd',
    enableGitIntegration: config?.enableGitIntegration ?? true,
    enableAutoCompaction: config?.enableAutoCompaction ?? true,
    maxMemoryAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    compactionInterval: 24 * 60 * 60 * 1000, // 24 hours
    logLevel: config?.logLevel || 'info'
  })
  
  await service.initialize()
  return service
}

/**
 * Create hybrid memory service that uses both traditional and BEADS memory
 */
export async function createHybridMemory(config?: {
  traditionMemoryPath?: string
  beadsMemoryPath?: string
  preferBeads?: boolean
}) {
  const [traditional, beads] = await Promise.all([
    createMemoryService({ doltPath: config?.traditionMemoryPath }),
    createBeadsMemory({ repositoryPath: config?.beadsMemoryPath })
  ])
  
  return {
    traditional,
    beads,
    
    /**
     * Store memory using preferred backend
     */
    async storeMemory(agentId: string, memory: any) {
      if (config?.preferBeads) {
        return await beads.storeAgentMemory(agentId, memory)
      } else {
        return await traditional.storeMemory(agentId, memory)
      }
    },
    
    /**
     * Query across both systems
     */
    async queryMemories(agentId: string, query: any) {
      const [traditionalResults, beadsResults] = await Promise.all([
        traditional.getAgentMemories({ agentId, ...query }),
        beads.queryIssues({ assignee: agentId, ...query })
      ])
      
      return {
        traditional: traditionalResults,
        // @ts-expect-error - Post-Merge Reconciliation
        beads: beadsResults.map(issue => beads.beadsIssueToAgentMemory(issue))
      }
    },
    
    async destroy() {
      await Promise.all([
        traditional.destroy(),
        beads.destroy()
      ])
    }
  }
}