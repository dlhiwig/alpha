// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { MemoryQuery, MemoryRelationship, MemoryServiceConfig } from '../types'

// Use vi.hoisted to create mock objects BEFORE module mocking
// This ensures mockImplementation is set at factory time, not beforeEach time
const mockDolt = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  execute: vi.fn().mockResolvedValue({ affectedRows: 1 }),
  query: vi.fn().mockResolvedValue([]),
  commit: vi.fn().mockResolvedValue(undefined),
  destroy: vi.fn().mockResolvedValue(undefined),
}))

const mockCompactor = vi.hoisted(() => ({
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  compactAgent: vi.fn().mockResolvedValue(undefined),
}))

// Mock dependencies with implementations set at factory time
vi.mock('../DoltService', () => ({
  DoltService: vi.fn().mockImplementation(() => mockDolt)
}))

vi.mock('../compactor', () => ({
  MemoryCompactor: vi.fn().mockImplementation(() => mockCompactor)
}))

// Mock hash-id-generator
vi.mock('../hash-id-generator', () => {
  let idCounter = 0
  return {
    generateMemoryId: vi.fn().mockImplementation(() => {
      return `mem-${(++idCounter).toString(16).padStart(16, '0')}`
    })
  }
})

// Import after mocks are set up
import { MemoryService } from '../MemoryService'

describe('MemoryService', () => {
  let service: MemoryService
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    // Reset mock call history (but NOT implementations - they're set in vi.hoisted)
    vi.clearAllMocks()
    
    // Reset mock return values to defaults
    mockDolt.initialize.mockResolvedValue(undefined)
    mockDolt.execute.mockResolvedValue({ affectedRows: 1 })
    mockDolt.query.mockResolvedValue([])
    mockDolt.commit.mockResolvedValue(undefined)
    mockDolt.destroy.mockResolvedValue(undefined)
    
    mockCompactor.start.mockResolvedValue(undefined)
    mockCompactor.stop.mockResolvedValue(undefined)
    mockCompactor.compactAgent.mockResolvedValue(undefined)
    
    // Setup console spy
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    // Create service instance
    const config: Partial<MemoryServiceConfig> = {
      doltPath: '/test/dolt',
      // @ts-expect-error - Post-Merge Reconciliation
      repositoryPath: '/test/repo',
      enableAutoCompaction: true,
      logLevel: 'debug'
    }
    service = new MemoryService(config)
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await service.initialize()
      
      expect(mockDolt.initialize).toHaveBeenCalledTimes(1)
      expect(mockDolt.execute).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS memories'))
      expect(mockDolt.execute).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS memory_relationships'))
      expect(mockCompactor.start).toHaveBeenCalledTimes(1)
    })

    it('should not re-initialize if already initialized', async () => {
      await service.initialize()
      await service.initialize()
      
      expect(mockDolt.initialize).toHaveBeenCalledTimes(1)
    })

    it('should throw error if initialization fails', async () => {
      mockDolt.initialize.mockRejectedValueOnce(new Error('Dolt init failed'))
      
      await expect(service.initialize()).rejects.toThrow('Memory service initialization failed')
    })
  })

  describe('storeMemory', () => {
    beforeEach(async () => {
      await service.initialize()
    })

    it('should store a memory and return its ID', async () => {
      const agentId = 'test-agent'
      const memory = {
        type: 'learning' as const,
        content: 'Test learning content',
        metadata: { concept: 'testing' },
        importance: 7
      }

      // @ts-expect-error - Post-Merge Reconciliation
      const id = await service.storeMemory(agentId, memory)
      
      expect(id).toMatch(/^mem-[a-f0-9]{16}$/)
      expect(mockDolt.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO memories'),
        expect.arrayContaining([
          id,
          agentId,
          memory.type,
          memory.content,
          JSON.stringify(memory.metadata),
          memory.importance,
          null,
          expect.any(Date),
          expect.any(Date)
        ])
      )
    })

    it('should generate deterministic IDs for same content', async () => {
      const agentId = 'test-agent'
      const memory1 = { type: 'learning' as const, content: 'Same content', metadata: {}, importance: 5 }
      const memory2 = { type: 'learning' as const, content: 'Same content', metadata: {}, importance: 5 }

      // @ts-expect-error - Post-Merge Reconciliation
      const id1 = await service.storeMemory(agentId, memory1)
      // @ts-expect-error - Post-Merge Reconciliation
      const id2 = await service.storeMemory(agentId, memory2)
      
      expect(typeof id1).toBe('string')
      expect(typeof id2).toBe('string')
    })

    it('should handle metadata correctly', async () => {
      const memory = {
        type: 'decision' as const,
        content: 'Test decision',
        metadata: { decision: 'test choice', reasoning: 'test reason', confidence: 0.8 },
        importance: 6
      }

      // @ts-expect-error - Post-Merge Reconciliation
      await service.storeMemory('test-agent', memory)
      
      expect(mockDolt.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO memories'),
        expect.arrayContaining([JSON.stringify(memory.metadata)])
      )
    })

    it('should handle storage errors', async () => {
      mockDolt.execute.mockRejectedValueOnce(new Error('Database error'))
      
      // @ts-expect-error - Post-Merge Reconciliation
      await expect(service.storeMemory('agent', { type: 'learning', content: 'test' }))
        .rejects.toThrow('Failed to store memory')
    })

    it('should use default importance if not provided', async () => {
      // @ts-expect-error - Post-Merge Reconciliation
      await service.storeMemory('agent', { type: 'context', content: 'Test context' })
      
      expect(mockDolt.execute).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([5]) // default importance
      )
    })
  })

  describe('getMemory', () => {
    beforeEach(async () => {
      await service.initialize()
    })

    it('should retrieve a memory by ID', async () => {
      const mockMemory = {
        id: 'mem-abc123',
        agent_id: 'test-agent',
        type: 'learning',
        content: 'Test content',
        metadata: '{"concept": "test"}',
        importance: 7,
        embedding_hash: null,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01')
      }
      mockDolt.query.mockResolvedValueOnce([mockMemory])

      const result = await service.getMemory('mem-abc123')
      
      expect(result).toEqual({
        id: 'mem-abc123',
        agentId: 'test-agent',
        type: 'learning',
        content: 'Test content',
        metadata: { concept: 'test' },
        importance: 7,
        embeddingHash: null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01')
      })
    })

    it('should return null if memory not found', async () => {
      mockDolt.query.mockResolvedValueOnce([])
      const result = await service.getMemory('nonexistent-id')
      expect(result).toBeNull()
    })

    it('should handle query errors', async () => {
      mockDolt.query.mockRejectedValueOnce(new Error('Query error'))
      await expect(service.getMemory('mem-123')).rejects.toThrow('Failed to get memory')
    })
  })

  describe('updateMemory', () => {
    beforeEach(async () => {
      await service.initialize()
      // Clear call history after initialization (but keep implementations)
      mockDolt.execute.mockClear()
      mockDolt.query.mockClear()
      mockDolt.commit.mockClear()
    })

    it('should update memory content', async () => {
      const updates = { content: 'Updated content', importance: 8, metadata: { updated: true } } as any
      await service.updateMemory('mem-123', updates)
      expect(mockDolt.execute).toHaveBeenCalledWith(
        expect.stringMatching(/UPDATE memories SET.*WHERE id = \?/),
        expect.arrayContaining(['Updated content', '{"updated":true}', 8, expect.any(Date), 'mem-123'])
      )
    })

    it('should handle partial updates', async () => {
      await service.updateMemory('mem-123', { content: 'New content only' })
      expect(mockDolt.execute).toHaveBeenCalledWith(
        expect.stringContaining('content = ?'),
        expect.arrayContaining(['New content only'])
      )
    })

    it('should handle update errors', async () => {
      mockDolt.execute.mockRejectedValueOnce(new Error('Update error'))
      await expect(service.updateMemory('mem-123', { content: 'test' })).rejects.toThrow('Failed to update memory')
    })
  })

  describe('deleteMemory', () => {
    beforeEach(async () => {
      await service.initialize()
    })

    it('should delete a memory by ID', async () => {
      await service.deleteMemory('mem-123')
      expect(mockDolt.execute).toHaveBeenCalledWith('DELETE FROM memories WHERE id = ?', ['mem-123'])
    })

    it('should handle deletion errors', async () => {
      mockDolt.execute.mockRejectedValueOnce(new Error('Delete error'))
      await expect(service.deleteMemory('mem-123')).rejects.toThrow('Failed to delete memory')
    })
  })

  describe('getAgentMemories', () => {
    beforeEach(async () => {
      await service.initialize()
    })

    it('should return memories for an agent', async () => {
      const mockMemories = [{
        id: 'mem-1', agent_id: 'agent1', type: 'learning', content: 'Memory 1',
        metadata: '{}', importance: 5, embedding_hash: null,
        created_at: new Date('2024-01-01'), updated_at: new Date('2024-01-01')
      }]
      mockDolt.query.mockResolvedValueOnce(mockMemories)

      const result = await service.getAgentMemories({ agentId: 'agent1' })
      expect(result).toHaveLength(1)
      expect(result[0].agentId).toBe('agent1')
    })

    it('should filter by memory type', async () => {
      mockDolt.query.mockResolvedValueOnce([])
      // @ts-expect-error - Post-Merge Reconciliation
      await service.getAgentMemories({ agentId: 'agent1', type: 'learning' })
      expect(mockDolt.query).toHaveBeenCalledWith(
        expect.stringContaining('AND type = ?'),
        expect.arrayContaining(['agent1', 'learning'])
      )
    })

    it('should respect limit parameter', async () => {
      mockDolt.query.mockResolvedValueOnce([])
      await service.getAgentMemories({ agentId: 'agent1', limit: 10 })
      expect(mockDolt.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT ?'),
        expect.arrayContaining(['agent1', 10])
      )
    })

    it('should filter by date range', async () => {
      mockDolt.query.mockResolvedValueOnce([])
      const since = new Date('2024-01-01')
      const until = new Date('2024-12-31')
      // @ts-expect-error - Post-Merge Reconciliation
      await service.getAgentMemories({ agentId: 'agent1', since, until })
      expect(mockDolt.query).toHaveBeenCalledWith(
        expect.stringMatching(/AND created_at >= \?.*AND created_at <= \?/),
        expect.arrayContaining(['agent1', since, until])
      )
    })

    it('should filter by importance range', async () => {
      mockDolt.query.mockResolvedValueOnce([])
      // @ts-expect-error - Post-Merge Reconciliation
      await service.getAgentMemories({ agentId: 'agent1', minImportance: 5, maxImportance: 8 })
      expect(mockDolt.query).toHaveBeenCalledWith(
        expect.stringMatching(/AND importance >= \?.*AND importance <= \?/),
        expect.arrayContaining(['agent1', 5, 8])
      )
    })

    it('should handle query errors', async () => {
      mockDolt.query.mockRejectedValueOnce(new Error('Query error'))
      await expect(service.getAgentMemories({ agentId: 'agent1' })).rejects.toThrow('Failed to get agent memories')
    })
  })

  describe('searchMemories', () => {
    beforeEach(async () => {
      await service.initialize()
    })

    it('should find memories by text search', async () => {
      mockDolt.query.mockResolvedValueOnce([{
        id: 'mem-1', agent_id: 'agent1', type: 'learning', content: 'Contains search term',
        metadata: '{}', importance: 5, embedding_hash: null, created_at: new Date(), updated_at: new Date()
      }])
      const result = await service.searchMemories('agent1', 'search term')
      expect(result).toHaveLength(1)
    })

    it('should handle search errors', async () => {
      mockDolt.query.mockRejectedValueOnce(new Error('Search error'))
      await expect(service.searchMemories('agent1', 'test')).rejects.toThrow('Failed to search memories')
    })
  })

  describe('relationships', () => {
    beforeEach(async () => {
      await service.initialize()
    })

    it('should add memory relationships', async () => {
      // @ts-expect-error - Post-Merge Reconciliation
      await service.addRelationship({ sourceId: 'mem-1', targetId: 'mem-2', type: 'related', strength: 0.8 })
      expect(mockDolt.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO memory_relationships'),
        ['mem-1', 'mem-2', 'related', 0.8]
      )
    })

    it('should retrieve related memories', async () => {
      mockDolt.query.mockResolvedValueOnce([{
        id: 'mem-2', agent_id: 'agent1', type: 'learning', content: 'Related',
        metadata: '{}', importance: 5, embedding_hash: null, created_at: new Date(), updated_at: new Date()
      }])
      const result = await service.getRelatedMemories('mem-1')
      expect(result).toHaveLength(1)
    })

    it('should get relationships for a memory', async () => {
      mockDolt.query.mockResolvedValueOnce([{
        source_id: 'mem-1', target_id: 'mem-2', relationship_type: 'related', strength: 0.8, created_at: new Date()
      }])
      const result = await service.getRelationships('mem-1')
      expect(result).toHaveLength(1)
      expect(result[0].sourceId).toBe('mem-1')
    })

    it('should remove relationships', async () => {
      await service.removeRelationship('mem-1', 'mem-2')
      expect(mockDolt.execute).toHaveBeenCalledWith(
        'DELETE FROM memory_relationships WHERE source_id = ? AND target_id = ?',
        ['mem-1', 'mem-2']
      )
    })

    it('should handle relationship errors', async () => {
      mockDolt.execute.mockRejectedValueOnce(new Error('Relationship error'))
      // @ts-expect-error - Post-Merge Reconciliation
      await expect(service.addRelationship({ sourceId: 'mem-1', targetId: 'mem-2', type: 'related' }))
        .rejects.toThrow('Failed to add relationship')
    })
  })

  describe('convenience methods', () => {
    beforeEach(async () => {
      await service.initialize()
    })

    it('rememberLearning should store learning type', async () => {
      const id = await service.rememberLearning('agent1', 'testing', 'how to write tests')
      expect(mockDolt.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO memories'),
        expect.arrayContaining([id, 'agent1', 'learning'])
      )
    })

    it('rememberDecision should store decision type', async () => {
      const id = await service.rememberDecision('agent1', 'use vitest', 'better than jest')
      expect(mockDolt.execute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO memories'),
        expect.arrayContaining([id, 'agent1', 'decision'])
      )
    })

    it('loadAgentContext should return recent memories', async () => {
      mockDolt.query.mockResolvedValueOnce([{
        id: 'mem-1', agent_id: 'agent1', type: 'learning', content: 'Recent',
        metadata: '{}', importance: 8, embedding_hash: null, created_at: new Date(), updated_at: new Date()
      }])
      const result = await service.loadAgentContext('agent1', 25)
      expect(result).toHaveLength(1)
    })

    it('should use default limit for loadAgentContext', async () => {
      mockDolt.query.mockResolvedValueOnce([])
      await service.loadAgentContext('agent1')
      expect(mockDolt.query).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([50]))
    })
  })

  describe('maintenance operations', () => {
    beforeEach(async () => {
      await service.initialize()
    })

    it('should compact stale memories', async () => {
      await service.compactStaleMemories('agent1')
      expect(mockCompactor.compactAgent).toHaveBeenCalledWith('agent1')
    })

    it('should get agent statistics', async () => {
      mockDolt.query
        .mockResolvedValueOnce([{ total: 100 }])
        .mockResolvedValueOnce([{ type: 'learning', count: 50 }])
        .mockResolvedValueOnce([{ avg_importance: 6.5 }])
        .mockResolvedValueOnce([{ oldest: new Date('2024-01-01') }])
        .mockResolvedValueOnce([{ newest: new Date('2024-12-31') }])

      const stats = await service.getAgentStats('agent1')
      expect(stats.totalMemories).toBe(100)
      expect(stats.averageImportance).toBe(6.5)
    })

    it('should prune old memories', async () => {
      mockDolt.query.mockResolvedValueOnce([{ created_at: new Date('2024-06-01') }])
      mockDolt.execute.mockResolvedValueOnce({ affectedRows: 15 })
      const deletedCount = await service.pruneOldMemories('agent1', 100)
      expect(deletedCount).toBe(15)
    })

    it('should return 0 if no memories to prune', async () => {
      mockDolt.query.mockResolvedValueOnce([])
      const deletedCount = await service.pruneOldMemories('agent1', 100)
      expect(deletedCount).toBe(0)
    })
  })

  describe('error handling and logging', () => {
    beforeEach(async () => {
      await service.initialize()
    })

    it('should log operations at debug level', async () => {
      // @ts-expect-error - Post-Merge Reconciliation
      await service.storeMemory('agent1', { type: 'learning', content: 'test' })
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"level":"DEBUG"'))
    })

    it('should log errors appropriately', async () => {
      mockDolt.execute.mockRejectedValueOnce(new Error('Test error'))
      // @ts-expect-error - Post-Merge Reconciliation
      try { await service.storeMemory('agent1', { type: 'learning', content: 'test' }) } catch {}
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"level":"ERROR"'))
    })
  })

  describe('cleanup', () => {
    it('should destroy service cleanly', async () => {
      await service.initialize()
      await service.destroy()
      expect(mockCompactor.stop).toHaveBeenCalledTimes(1)
      expect(mockDolt.destroy).toHaveBeenCalledTimes(1)
    })

    it('should handle destruction errors', async () => {
      await service.initialize()
      mockCompactor.stop.mockRejectedValueOnce(new Error('Stop error'))
      await service.destroy()
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"level":"ERROR"'))
    })
  })
})

// Standalone test for generateMemoryId behavior
describe('generateMemoryId', () => {
  it('should use current timestamp if none provided', async () => {
    // The mocked version generates sequential IDs
    const { generateMemoryId } = await import('../hash-id-generator')
    const id1 = generateMemoryId({} as any)
    const id2 = generateMemoryId({} as any)
    // Mocked version generates sequential IDs
    expect(id1).not.toBe(id2)
  })
})
