import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MemoryCompactor, type CompactionResult, type CompactionStats } from '../compactor'
import { DoltService } from '../DoltService'

// Mock Anthropic SDK
const mockMessagesCreate = vi.fn()

vi.mock('@anthropic-ai/sdk', () => ({
  Anthropic: class MockAnthropic {
    messages = {
      create: mockMessagesCreate
    }
    
    constructor(options: any) {
      // Mock constructor
    }
  }
}))

vi.mock('../DoltService')

describe('MemoryCompactor', () => {
  let compactor: MemoryCompactor
  let mockDolt: jest.Mocked<DoltService>
  // @ts-expect-error - Post-Merge Reconciliation
  let consoleSpy: vi.SpyInstance

  // Mock database row format (snake_case fields)
  const mockMemory = {
    id: 'mem-test-123',
    agent_id: 'test-agent',
    title: 'Test Memory',
    description: 'This is a test memory with some content that should be compacted when it gets old enough and large enough to warrant compression.',
    type: 'learning',
    status: 'active',
    compaction_level: 0,
    metadata: '{"concept": "testing"}',
    created_at: new Date('2024-01-01'),
    updated_at: new Date('2024-01-01')
  }

  beforeEach(() => {
    vi.clearAllMocks()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    mockDolt = {
      query: vi.fn(),
      queryOne: vi.fn(),
      commit: vi.fn(),
    } as any

    ;(DoltService as any).mockImplementation(() => mockDolt)

    compactor = new MemoryCompactor(mockDolt, {
      olderThan: '7 days',
      minSize: 500,
      maxCompactionLevel: 2,
      compressionTarget: 0.5
    })
  })

  describe('compactStaleMemories', () => {
    it('should find and compact stale memories', async () => {
      // Setup mock stale memories
      const staleMemories = [
        { ...mockMemory, description: 'A'.repeat(1000) }, // Large enough to compact
        { ...mockMemory, id: 'mem-test-456', description: 'B'.repeat(800) }
      ]
      mockDolt.query.mockResolvedValueOnce(staleMemories)

      // Mock Claude responses
      const mockSummary1 = 'Compressed summary 1 - much shorter'
      const mockSummary2 = 'Compressed summary 2 - also short'
      
      mockMessagesCreate
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: mockSummary1 }]
        })
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: mockSummary2 }]
        })

      // Mock the memory retrieval for applying compaction
      // @ts-expect-error - Post-Merge Reconciliation
      mockDolt.queryOne
        .mockResolvedValueOnce({ description: staleMemories[0].description })
        .mockResolvedValueOnce({ description: staleMemories[1].description })

      // Mock update operations
      // @ts-expect-error - Post-Merge Reconciliation
      mockDolt.query.mockResolvedValue(undefined)

      const result = await compactor.compactStaleMemories('test-agent')

      expect(result.memoriesProcessed).toBe(2)
      expect(result.memoriesCompacted).toBe(2)
      expect(result.bytesRecovered).toBeGreaterThan(0)
      expect(result.errors).toHaveLength(0)

      // Verify the query was called correctly
      expect(mockDolt.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM agent_memories'),
        expect.arrayContaining(['test-agent', expect.any(String), 2, 500])
      )

      // Verify commit was called
      expect(mockDolt.commit).toHaveBeenCalledWith(
        expect.stringContaining('Memory compaction for agent test-agent')
      )
    })

    it('should skip small memories', async () => {
      const smallMemory = { ...mockMemory, description: 'Small' } // Under 500 chars
      // Since the SQL query filters by size, small memories shouldn't be returned
      mockDolt.query.mockResolvedValueOnce([]) // Empty result because of SQL filtering

      const result = await compactor.compactStaleMemories('test-agent')

      expect(result.memoriesProcessed).toBe(0)
      expect(result.memoriesCompacted).toBe(0)
      expect(mockMessagesCreate).not.toHaveBeenCalled()
      
      // Verify the query included the minSize filter
      expect(mockDolt.query).toHaveBeenCalledWith(
        expect.stringContaining('LENGTH(description) >= ?'),
        expect.arrayContaining([500]) // minSize
      )
    })

    it('should only apply compaction if summary is smaller', async () => {
      const memory = { ...mockMemory, description: 'Short content' }
      mockDolt.query.mockResolvedValueOnce([memory])

      // Mock Claude to return a summary that's NOT smaller
      const largeSummary = 'This summary is actually longer than the original content and should not be applied'
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: largeSummary }]
      })

      const result = await compactor.compactStaleMemories('test-agent')

      expect(result.memoriesProcessed).toBe(1)
      expect(result.memoriesCompacted).toBe(0)
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Skipped memory')
      )
    })

    it('should track compression ratio correctly', async () => {
      const largeMemory = { ...mockMemory, description: 'A'.repeat(1000) }
      mockDolt.query.mockResolvedValueOnce([largeMemory])

      const shortSummary = 'Short summary'
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: shortSummary }]
      })

      // @ts-expect-error - Post-Merge Reconciliation
      mockDolt.queryOne.mockResolvedValueOnce({ description: largeMemory.description })

      const result = await compactor.compactStaleMemories('test-agent')

      expect(result.memoriesCompacted).toBe(1)
      expect(result.bytesRecovered).toBe(1000 - shortSummary.length)

      // Verify compression ratio was logged
      expect(mockDolt.query).toHaveBeenCalledWith(
        expect.stringMatching(/UPDATE agent_memories/),
        [
          shortSummary,
          1,
          1000,
          shortSummary.length / 1000,
          largeMemory.id
        ]
      )
    })

    it('should handle compaction errors gracefully', async () => {
      const memory = { ...mockMemory, description: 'A'.repeat(1000) }
      mockDolt.query.mockResolvedValueOnce([memory])

      // Mock Claude to throw an error
      mockMessagesCreate.mockRejectedValueOnce(new Error('Claude API error'))

      const result = await compactor.compactStaleMemories('test-agent')

      expect(result.memoriesProcessed).toBe(1)
      expect(result.memoriesCompacted).toBe(0)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toContain('Claude API error')
    })

    it('should handle database errors during compaction', async () => {
      mockDolt.query.mockRejectedValueOnce(new Error('Database connection error'))

      const result = await compactor.compactStaleMemories('test-agent')

      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toContain('Database connection error')
    })

    it('should respect maxCompactionLevel config', async () => {
      const maxLevelMemory = { ...mockMemory, compaction_level: 2 }
      mockDolt.query.mockResolvedValueOnce([maxLevelMemory])

      await compactor.compactStaleMemories('test-agent')

      // Should query with maxCompactionLevel in WHERE clause
      expect(mockDolt.query).toHaveBeenCalledWith(
        expect.stringContaining('compaction_level < ?'),
        expect.arrayContaining([2])
      )
    })
  })

  describe('summarizeMemory', () => {
    it('should call Claude Haiku for summarization', async () => {
      const memory = { ...mockMemory, description: 'A'.repeat(1000) }
      const mockSummary = 'Compressed summary'

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: mockSummary }]
      })

      const result = await compactor.summarizeMemory(memory as any)

      expect(result).toBe(mockSummary)
      expect(mockMessagesCreate).toHaveBeenCalledWith({
        model: 'claude-3-haiku-20240307',
        max_tokens: 500,
        temperature: 0.1,
        messages: [{
          role: 'user',
          content: expect.stringContaining('Summarize this agent memory')
        }]
      })
    })

    it('should respect compression target in prompt', async () => {
      const memory = { ...mockMemory, description: 'A'.repeat(1000) }
      const targetLength = Math.floor(1000 * 0.5) // 50% compression target

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Summary' }]
      })

      await compactor.summarizeMemory(memory as any)

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{
            role: 'user',
            content: expect.stringContaining(`under ${targetLength} characters`)
          }]
        })
      )
    })

    it('should include memory metadata in prompt', async () => {
      const memoryWithTags = {
        ...mockMemory,
        tags: 'important, testing'
      }

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Summary' }]
      })

      await compactor.summarizeMemory(memoryWithTags as any)

      const callArgs = mockMessagesCreate.mock.calls[0][0]
      expect(callArgs.messages[0].content).toContain(memoryWithTags.title)
      expect(callArgs.messages[0].content).toContain(memoryWithTags.description)
      expect(callArgs.messages[0].content).toContain(memoryWithTags.created_at)
    })

    it('should handle empty responses from Claude', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: '' }]
      })

      await expect(compactor.summarizeMemory(mockMemory as any))
        .rejects.toThrow('Empty summary returned from Claude Haiku')
    })

    it('should handle non-text responses from Claude', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'fake' } }]
      })

      await expect(compactor.summarizeMemory(mockMemory as any))
        .rejects.toThrow('Empty summary returned from Claude Haiku')
    })
  })

  describe('deepCompact', () => {
    it('should merge related memories', async () => {
      const relatedMemories = [
        { ...mockMemory, id: 'mem-1', created_at: new Date('2024-01-01T10:00:00Z') },
        { ...mockMemory, id: 'mem-2', created_at: new Date('2024-01-01T11:00:00Z') },
        { ...mockMemory, id: 'mem-3', created_at: new Date('2024-01-01T12:00:00Z') }
      ]

      // Mock finding candidates
      mockDolt.query.mockResolvedValueOnce(relatedMemories)

      // Mock merged summary from Claude
      const mergedSummary = 'Comprehensive merged summary of all three memories'
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: mergedSummary }]
      })

      // Mock update and delete operations
      // @ts-expect-error - Post-Merge Reconciliation
      mockDolt.query.mockResolvedValue(undefined)
      mockDolt.commit.mockResolvedValue(undefined)

      await compactor.deepCompact('test-agent')

      // Verify merge query was called
      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{
            role: 'user',
            content: expect.stringContaining('Merge these related agent memories')
          }]
        })
      )

      // Verify database operations - check that UPDATE was called
      const updateCalls = mockDolt.query.mock.calls.filter(call => 
        call[0].includes('UPDATE agent_memories')
      )
      expect(updateCalls.length).toBe(1)
      expect(updateCalls[0][1]).toEqual([
        mergedSummary,
        'Merged: Test Memory (+2 others)', // Expected title format
        3, // merged_from_count
        'mem-1' // memory id
      ])

      // Verify commit
      expect(mockDolt.commit).toHaveBeenCalledWith(
        expect.stringContaining('Deep compaction (level 2)')
      )
    })

    it('should group memories by time window correctly', async () => {
      const memoriesInDifferentTimeWindows = [
        { ...mockMemory, id: 'mem-1', created_at: new Date('2024-01-01T10:00:00Z') },
        { ...mockMemory, id: 'mem-2', created_at: new Date('2024-01-01T11:00:00Z') },
        // This one is more than 24 hours later - should be in different group
        { ...mockMemory, id: 'mem-3', created_at: new Date('2024-01-03T10:00:00Z') }
      ]

      mockDolt.query.mockResolvedValueOnce(memoriesInDifferentTimeWindows)

      // Should only merge the first two (within 24h window)
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Merged summary of two memories' }]
      })

      await compactor.deepCompact('test-agent')

      // Should have been called once for the first group of 2 memories
      expect(mockMessagesCreate).toHaveBeenCalledTimes(1)
    })

    it('should handle merge failures gracefully', async () => {
      const memories = [
        { ...mockMemory, id: 'mem-1' },
        { ...mockMemory, id: 'mem-2' }
      ]
      mockDolt.query.mockResolvedValueOnce(memories)

      // Mock Claude to fail
      mockMessagesCreate.mockRejectedValueOnce(new Error('Merge failed'))

      await compactor.deepCompact('test-agent')

      // Should continue and commit despite the error
      expect(mockDolt.commit).toHaveBeenCalled()
    })

    it('should skip groups with only one memory', async () => {
      const singleMemory = [{ ...mockMemory, id: 'mem-1' }]
      mockDolt.query.mockResolvedValueOnce(singleMemory)

      await compactor.deepCompact('test-agent')

      // Should not call Claude for merging
      expect(mockMessagesCreate).not.toHaveBeenCalled()
    })
  })

  describe('getCompactionStats', () => {
    it('should return accurate statistics', async () => {
      const mockStats = {
        total_compactions: 15,
        average_compression_ratio: 0.35,
        bytes_recovered: 25000,
        last_compaction: '2024-01-15T10:30:00Z'
      }

      // @ts-expect-error - Post-Merge Reconciliation
      mockDolt.queryOne.mockResolvedValueOnce(mockStats)

      const result = await compactor.getCompactionStats('test-agent')

      expect(result).toEqual({
        totalCompactions: 15,
        averageCompressionRatio: 0.35,
        bytesRecovered: 25000,
        lastCompaction: new Date('2024-01-15T10:30:00Z')
      })

      // @ts-expect-error - Post-Merge Reconciliation
      expect(mockDolt.queryOne).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        ['test-agent']
      )
    })

    it('should handle missing stats gracefully', async () => {
      // @ts-expect-error - Post-Merge Reconciliation
      mockDolt.queryOne.mockResolvedValueOnce(null)

      const result = await compactor.getCompactionStats('test-agent')

      expect(result).toEqual({
        totalCompactions: 0,
        averageCompressionRatio: 0,
        bytesRecovered: 0,
        lastCompaction: null
      })
    })

    it('should handle partial stats data', async () => {
      const partialStats = {
        total_compactions: 5,
        // Missing some fields
        bytes_recovered: 1000
      }

      // @ts-expect-error - Post-Merge Reconciliation
      mockDolt.queryOne.mockResolvedValueOnce(partialStats)

      const result = await compactor.getCompactionStats('test-agent')

      expect(result.totalCompactions).toBe(5)
      expect(result.bytesRecovered).toBe(1000)
      expect(result.averageCompressionRatio).toBe(0)
      expect(result.lastCompaction).toBe(null)
    })
  })

  describe('applyCompaction', () => {
    it('should update memory with compressed content', async () => {
      const originalMemory = { description: 'A'.repeat(1000) }
      // @ts-expect-error - Post-Merge Reconciliation
      mockDolt.queryOne.mockResolvedValueOnce(originalMemory)

      const summary = 'Compressed version'
      await compactor.applyCompaction('mem-123', summary, 1)

      expect(mockDolt.query).toHaveBeenCalledWith(
        expect.stringMatching(/UPDATE agent_memories/),
        [
          summary,
          1, // compaction level
          1000, // original size
          summary.length / 1000, // compression ratio
          'mem-123'
        ]
      )
    })

    it('should throw error if memory not found', async () => {
      // @ts-expect-error - Post-Merge Reconciliation
      mockDolt.queryOne.mockResolvedValueOnce(null)

      await expect(compactor.applyCompaction('nonexistent', 'summary', 1))
        .rejects.toThrow('Memory nonexistent not found')
    })
  })

  describe('logCompaction', () => {
    it('should log compaction audit record', async () => {
      await compactor.logCompaction('agent-1', 'mem-123', 1000, 400, 1)

      expect(mockDolt.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO memory_compaction_audit'),
        [
          'agent-1',
          'mem-123',
          1000,
          400,
          1,
          0.4 // compression ratio
        ]
      )
    })
  })

  describe('calculateCutoffDate', () => {
    it('should calculate cutoff date for days', () => {
      const compactorInstance = new MemoryCompactor(mockDolt, { olderThan: '7 days' })
      // Access private method through any cast for testing
      const cutoff = (compactorInstance as any).calculateCutoffDate('7 days')
      
      const expected = new Date()
      expected.setDate(expected.getDate() - 7)
      
      const cutoffDate = new Date(cutoff)
      expect(Math.abs(cutoffDate.getTime() - expected.getTime())).toBeLessThan(1000) // Within 1 second
    })

    it('should calculate cutoff date for hours', () => {
      const compactorInstance = new MemoryCompactor(mockDolt)
      const cutoff = (compactorInstance as any).calculateCutoffDate('24 hours')
      
      const expected = new Date()
      expected.setHours(expected.getHours() - 24)
      
      const cutoffDate = new Date(cutoff)
      expect(Math.abs(cutoffDate.getTime() - expected.getTime())).toBeLessThan(1000)
    })

    it('should calculate cutoff date for weeks', () => {
      const compactorInstance = new MemoryCompactor(mockDolt)
      const cutoff = (compactorInstance as any).calculateCutoffDate('2 weeks')
      
      const expected = new Date()
      expected.setDate(expected.getDate() - 14)
      
      const cutoffDate = new Date(cutoff)
      expect(Math.abs(cutoffDate.getTime() - expected.getTime())).toBeLessThan(1000)
    })

    it('should handle invalid time format', () => {
      const compactorInstance = new MemoryCompactor(mockDolt)
      
      expect(() => (compactorInstance as any).calculateCutoffDate('invalid format'))
        .toThrow('Invalid olderThan format: invalid format')
    })

    it('should handle unsupported time unit', () => {
      const compactorInstance = new MemoryCompactor(mockDolt)
      
      expect(() => (compactorInstance as any).calculateCutoffDate('5 minutes'))
        .toThrow('Invalid olderThan format: 5 minutes')
    })
  })

  describe('configuration', () => {
    it('should use default configuration when none provided', () => {
      const defaultCompactor = new MemoryCompactor(mockDolt)
      
      expect((defaultCompactor as any).config).toEqual({
        olderThan: '7 days',
        minSize: 500,
        maxCompactionLevel: 2,
        compressionTarget: 0.5
      })
    })

    it('should merge provided config with defaults', () => {
      const customCompactor = new MemoryCompactor(mockDolt, {
        minSize: 1000,
        compressionTarget: 0.3
      })
      
      expect((customCompactor as any).config).toEqual({
        olderThan: '7 days',
        minSize: 1000,
        maxCompactionLevel: 2,
        compressionTarget: 0.3
      })
    })
  })

  describe('edge cases and error handling', () => {
    it('should handle empty memory list', async () => {
      mockDolt.query.mockResolvedValueOnce([])

      const result = await compactor.compactStaleMemories('test-agent')

      expect(result.memoriesProcessed).toBe(0)
      expect(result.memoriesCompacted).toBe(0)
      expect(result.bytesRecovered).toBe(0)
      expect(result.errors).toHaveLength(0)
    })

    it('should handle memories at exactly the size threshold', async () => {
      const exactSizeMemory = { ...mockMemory, description: 'A'.repeat(500) } // Exactly minSize
      mockDolt.query.mockResolvedValueOnce([exactSizeMemory])

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Short' }]
      })

      // @ts-expect-error - Post-Merge Reconciliation
      mockDolt.queryOne.mockResolvedValueOnce({ description: exactSizeMemory.description })

      const result = await compactor.compactStaleMemories('test-agent')

      expect(result.memoriesProcessed).toBe(1)
      expect(result.memoriesCompacted).toBe(1)
    })

    it('should continue processing other memories if one fails', async () => {
      const memories = [
        { ...mockMemory, id: 'mem-1', description: 'A'.repeat(1000) },
        { ...mockMemory, id: 'mem-2', description: 'B'.repeat(1000) }
      ]
      mockDolt.query.mockResolvedValueOnce(memories)

      // First one succeeds, second one fails
      mockMessagesCreate
        .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Summary 1' }] })
        .mockRejectedValueOnce(new Error('API error for second memory'))

      // @ts-expect-error - Post-Merge Reconciliation
      mockDolt.queryOne.mockResolvedValueOnce({ description: memories[0].description })

      const result = await compactor.compactStaleMemories('test-agent')

      expect(result.memoriesProcessed).toBe(2)
      expect(result.memoriesCompacted).toBe(1)
      expect(result.errors).toHaveLength(1)
    })
  })
})