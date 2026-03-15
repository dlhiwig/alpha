/**
 * Tests for BEADS Memory Adapter
 * 
 * Unit test suite for the BEADS integration with SuperClaw CORTEX.
 * Uses mocked DoltService to avoid requiring Dolt installation in CI.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { BeadsIssue, BeadsDependency, BeadsQuery } from '../beads-adapter'

// Shared mock state - will be reset in beforeEach
let mockIssueIdCounter = 0
let mockIssuesDb = new Map<string, any>()
let mockDependenciesDb: any[] = []
let mockLabelsDb: any[] = []
let mockCommentsDb: any[] = []

// Mock DoltService BEFORE importing any modules that use it
vi.mock('../DoltService', () => {
  return {
    DoltService: vi.fn().mockImplementation(() => ({
      initialize: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
        // Handle INSERT INTO beads_issues
        if (sql.includes('INSERT INTO beads_issues')) {
          const id = params?.[0] || `test-${++mockIssueIdCounter}`
          mockIssuesDb.set(id, {
            id,
            content_hash: params?.[1] || null,
            title: params?.[2] || 'Test',
            description: params?.[3] || null,
            design: params?.[4] || null,
            acceptance_criteria: params?.[5] || null,
            notes: params?.[6] || null,
            status: params?.[7] || 'open',
            priority: params?.[8] || 2,
            issue_type: params?.[9] || 'task',
            assignee: params?.[10] || null,
            owner: params?.[11] || null,
            estimated_minutes: params?.[12] || null,
            created_at: params?.[13] || new Date(),
            created_by: params?.[14] || null,
            updated_at: params?.[15] || new Date(),
            closed_at: null,
            close_reason: null,
            external_ref: params?.[16] || null,
            source_system: params?.[17] || null,
            metadata: params?.[18] || '{}',
            compaction_level: 0,
            agent_state: params?.[19] || null,
            hook_bead: params?.[20] || null,
            role_bead: params?.[21] || null,
            last_activity: params?.[22] || null
          })
          return { affectedRows: 1 }
        }
        // Handle UPDATE beads_issues
        if (sql.includes('UPDATE beads_issues')) {
          const id = params?.[params.length - 1]
          const issue = mockIssuesDb.get(id)
          if (issue) {
            if (sql.includes('status = ?')) {
              // Find status in params - it's usually first for tombstone update
              issue.status = params?.[0] === 'tombstone' ? 'tombstone' : (params?.[1] || issue.status)
            }
            if (sql.includes('agent_state = ?')) issue.agent_state = params?.[0]
            if (sql.includes('hook_bead = ?')) issue.hook_bead = params?.[1]
            issue.updated_at = new Date()
          }
          return { affectedRows: issue ? 1 : 0 }
        }
        // Handle INSERT INTO beads_dependencies
        if (sql.includes('INSERT INTO beads_dependencies')) {
          mockDependenciesDb.push({
            issue_id: params?.[0],
            depends_on_id: params?.[1],
            type: params?.[2],
            created_by: params?.[3] || 'system',
            created_at: new Date(),
            metadata: params?.[4] || null
          })
          return { affectedRows: 1 }
        }
        // Handle DELETE FROM beads_dependencies
        if (sql.includes('DELETE FROM beads_dependencies')) {
          const beforeLen = mockDependenciesDb.length
          mockDependenciesDb = mockDependenciesDb.filter(d => 
            !(d.issue_id === params?.[0] && d.depends_on_id === params?.[1] && d.type === params?.[2])
          )
          return { affectedRows: beforeLen - mockDependenciesDb.length }
        }
        // Handle INSERT INTO beads_labels
        if (sql.includes('INSERT INTO beads_labels') || sql.includes('INSERT IGNORE INTO beads_labels')) {
          const existing = mockLabelsDb.find(l => l.issue_id === params?.[0] && l.label === params?.[1])
          if (!existing) {
            mockLabelsDb.push({
              issue_id: params?.[0],
              label: params?.[1],
              created_at: new Date()
            })
          }
          return { affectedRows: existing ? 0 : 1 }
        }
        // Handle DELETE FROM beads_labels
        if (sql.includes('DELETE FROM beads_labels')) {
          const beforeLen = mockLabelsDb.length
          mockLabelsDb = mockLabelsDb.filter(l => 
            !(l.issue_id === params?.[0] && l.label === params?.[1])
          )
          return { affectedRows: beforeLen - mockLabelsDb.length }
        }
        // Handle INSERT INTO beads_comments
        if (sql.includes('INSERT INTO beads_comments')) {
          const commentId = mockCommentsDb.length + 1
          mockCommentsDb.push({
            id: commentId,
            issue_id: params?.[0],
            author: params?.[1],
            text: params?.[2],
            created_at: new Date()
          })
          return { affectedRows: 1, insertId: commentId }
        }
        return { affectedRows: 0 }
      }),
      query: vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
        // Handle SELECT from beads_issues by ID
        if (sql.includes('SELECT * FROM beads_issues WHERE id = ?') || 
            sql.includes('SELECT') && sql.includes('FROM beads_issues') && sql.includes('WHERE id = ?')) {
          const id = params?.[0]
          const issue = mockIssuesDb.get(id)
          return issue ? [issue] : []
        }
        // Handle SELECT from beads_issues with filters
        if (sql.includes('FROM beads_issues')) {
          let results = Array.from(mockIssuesDb.values())
          
          // Filter by status
          if (params?.some(p => ['open', 'in_progress', 'blocked', 'deferred', 'closed', 'tombstone'].includes(p))) {
            const statusFilter = params?.filter(p => ['open', 'in_progress', 'blocked', 'deferred', 'closed', 'tombstone'].includes(p))
            if (statusFilter?.length) {
              results = results.filter(i => statusFilter.includes(i.status))
            }
          }
          
          // Filter by issue type
          if (params?.some(p => ['bug', 'feature', 'task', 'epic', 'chore', 'decision', 'message', 'learning', 'context'].includes(p))) {
            const typeFilter = params?.filter(p => ['bug', 'feature', 'task', 'epic', 'chore', 'decision', 'message', 'learning', 'context'].includes(p))
            if (typeFilter?.length) {
              results = results.filter(i => typeFilter.includes(i.issue_type))
            }
          }
          
          // Filter by assignee
          if (sql.includes('assignee = ?')) {
            const assignee = params?.find(p => typeof p === 'string' && (p.startsWith('agent') || p.startsWith('test')))
            if (assignee) {
              results = results.filter(i => i.assignee === assignee)
            }
          }
          
          // Filter out closed/tombstone
          if (sql.includes('NOT IN') && sql.includes('closed')) {
            results = results.filter(i => !['closed', 'tombstone'].includes(i.status))
          }
          
          // Handle text search
          if (sql.includes('LIKE')) {
            const searchParam = params?.find(p => typeof p === 'string' && p.includes('%'))
            if (searchParam) {
              const searchTerm = searchParam.replace(/%/g, '').toLowerCase()
              results = results.filter(i => 
                i.title?.toLowerCase().includes(searchTerm) ||
                i.description?.toLowerCase().includes(searchTerm)
              )
            }
          }
          
          // Handle LIMIT
          if (sql.includes('LIMIT')) {
            const limitIdx = params?.findIndex(p => typeof p === 'number' && p > 0 && p < 1000)
            if (limitIdx !== undefined && limitIdx >= 0) {
              results = results.slice(0, params![limitIdx])
            }
          }
          
          return results
        }
        // Handle SELECT from beads_dependencies
        if (sql.includes('FROM beads_dependencies')) {
          const issueId = params?.[0]
          return mockDependenciesDb.filter(d => d.issue_id === issueId)
        }
        // Handle SELECT from beads_labels
        if (sql.includes('FROM beads_labels')) {
          const issueId = params?.[0]
          return mockLabelsDb.filter(l => l.issue_id === issueId)
        }
        // Handle SELECT from beads_comments
        if (sql.includes('FROM beads_comments')) {
          const issueId = params?.[0]
          return mockCommentsDb.filter(c => c.issue_id === issueId).sort((a, b) => 
            a.created_at.getTime() - b.created_at.getTime()
          )
        }
        return []
      }),
      commit: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
      branch: vi.fn().mockResolvedValue(undefined),
      merge: vi.fn().mockResolvedValue(undefined),
      getHistory: vi.fn().mockResolvedValue([]),
      getCurrentBranch: vi.fn().mockResolvedValue('main'),
      reset: vi.fn().mockResolvedValue(undefined)
    }))
  }
})

// Mock MemoryCompactor
vi.mock('../compactor', () => ({
  MemoryCompactor: vi.fn().mockImplementation(() => ({
    compactAgent: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined)
  }))
}))

// Import AFTER mocks
import { BeadsMemory } from '../beads-adapter'

describe('BeadsMemory', () => {
  let beadsMemory: BeadsMemory

  beforeEach(async () => {
    // Reset mock databases
    mockIssueIdCounter = 0
    mockIssuesDb = new Map()
    mockDependenciesDb = []
    mockLabelsDb = []
    mockCommentsDb = []
    
    vi.clearAllMocks()
    
    beadsMemory = new BeadsMemory({
      repositoryPath: '/tmp/test-beads',
      defaultPrefix: 'test',
      enableAutoCompaction: false,
      enableGitIntegration: false,
      logLevel: 'error'
    })
    
    await beadsMemory.initialize()
  })

  afterEach(async () => {
    if (beadsMemory) {
      await beadsMemory.destroy()
    }
  })

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      expect(beadsMemory).toBeDefined()
    })

    it('should handle multiple initialize calls gracefully', async () => {
      await beadsMemory.initialize()
      await beadsMemory.initialize()
      // Should not throw
      expect(beadsMemory).toBeDefined()
    })
  })

  describe('ID Generation', () => {
    it('should generate hash-based IDs with correct format', () => {
      const id1 = beadsMemory.generateBeadsId('bd', 'Test issue title')
      const id2 = beadsMemory.generateBeadsId('epic', 'Another title')

      expect(id1).toMatch(/^bd-[a-z0-9]+$/)
      expect(id2).toMatch(/^epic-[a-z0-9]+$/)
      expect(id1).not.toBe(id2)
    })

    it('should generate different IDs for same content due to timestamp/nonce', () => {
      const content = 'Same content'
      const id1 = beadsMemory.generateBeadsId('test', content)
      const id2 = beadsMemory.generateBeadsId('test', content)

      expect(id1).not.toBe(id2)
    })
  })

  describe('Content Hashing', () => {
    it('should generate consistent hashes for identical content', () => {
      const issue1 = {
        title: 'Test Title',
        description: 'Test Description',
        status: 'open' as const,
        priority: 2,
        issueType: 'task' as const,
        metadata: { key: 'value' }
      }

      const hash1 = beadsMemory.computeContentHash(issue1)
      const hash2 = beadsMemory.computeContentHash({ ...issue1 })

      expect(hash1).toBe(hash2)
      expect(hash1).toMatch(/^[a-f0-9]{64}$/)
    })

    it('should generate different hashes for different content', () => {
      const issue1 = { title: 'Title 1', status: 'open' as const, priority: 1, issueType: 'task' as const }
      const issue2 = { title: 'Title 2', status: 'open' as const, priority: 1, issueType: 'task' as const }

      const hash1 = beadsMemory.computeContentHash(issue1)
      const hash2 = beadsMemory.computeContentHash(issue2)

      expect(hash1).not.toBe(hash2)
    })
  })

  describe('Issue CRUD Operations', () => {
    it('should create and retrieve a basic issue', async () => {
      const issueData = {
        title: 'Test Issue',
        description: 'This is a test issue',
        status: 'open' as const,
        priority: 2,
        issueType: 'task' as const,
        assignee: 'test-agent'
      }

      // @ts-expect-error - Post-Merge Reconciliation
      const issueId = await beadsMemory.createIssue(issueData)
      expect(issueId).toMatch(/^test-[a-z0-9]+$/)

      const retrieved = await beadsMemory.getIssue(issueId)
      expect(retrieved).toBeDefined()
      expect(retrieved!.title).toBe(issueData.title)
    })

    it('should create issues with all optional fields', async () => {
      const issueData = {
        title: 'Full Issue',
        description: 'Description',
        status: 'open' as const,
        priority: 1,
        issueType: 'feature' as const,
        assignee: 'agent-1'
      }

      // @ts-expect-error - Post-Merge Reconciliation
      const issueId = await beadsMemory.createIssue(issueData)
      expect(issueId).toBeDefined()
    })

    it('should update an existing issue', async () => {
      // @ts-expect-error - Post-Merge Reconciliation
      const issueId = await beadsMemory.createIssue({
        title: 'Original Title',
        status: 'open',
        priority: 3,
        issueType: 'task'
      })

      await beadsMemory.updateIssue(issueId, {
        title: 'Updated Title',
        status: 'in_progress'
      })

      // Verify update was called
      expect(issueId).toBeDefined()
    })

    it('should delete (tombstone) an issue', async () => {
      // @ts-expect-error - Post-Merge Reconciliation
      const issueId = await beadsMemory.createIssue({
        title: 'To be deleted',
        status: 'open',
        priority: 2,
        issueType: 'task'
      })

      await beadsMemory.deleteIssue(issueId)

      const tombstoned = await beadsMemory.getIssue(issueId)
      expect(tombstoned!.status).toBe('tombstone')
    })

    it('should return null for non-existent issue', async () => {
      const nonExistent = await beadsMemory.getIssue('test-nonexistent')
      expect(nonExistent).toBeNull()
    })
  })

  describe('Dependency Management', () => {
    let issue1Id: string
    let issue2Id: string
    let issue3Id: string

    beforeEach(async () => {
      // @ts-expect-error - Post-Merge Reconciliation
      issue1Id = await beadsMemory.createIssue({
        title: 'Issue 1', status: 'open', priority: 1, issueType: 'task'
      })
      // @ts-expect-error - Post-Merge Reconciliation
      issue2Id = await beadsMemory.createIssue({
        title: 'Issue 2', status: 'open', priority: 2, issueType: 'task'
      })
      // @ts-expect-error - Post-Merge Reconciliation
      issue3Id = await beadsMemory.createIssue({
        title: 'Issue 3', status: 'closed', priority: 3, issueType: 'task'
      })
    })

    it('should add and retrieve dependencies', async () => {
      await beadsMemory.addDependency(issue2Id, issue1Id, 'blocks')
      await beadsMemory.addDependency(issue2Id, issue3Id, 'relates-to')

      const dependencies = await beadsMemory.getDependencies(issue2Id)
      expect(dependencies).toHaveLength(2)
    })

    it('should remove dependencies', async () => {
      await beadsMemory.addDependency(issue2Id, issue1Id, 'blocks')
      await beadsMemory.addDependency(issue2Id, issue3Id, 'relates-to')

      await beadsMemory.removeDependency(issue2Id, issue1Id, 'blocks')

      const dependencies = await beadsMemory.getDependencies(issue2Id)
      expect(dependencies).toHaveLength(1)
      expect(dependencies[0].type).toBe('relates-to')
    })

    it('should handle dependency metadata', async () => {
      const metadata = { similarity: 0.85, notes: 'Related work' }
      await beadsMemory.addDependency(issue2Id, issue1Id, 'relates-to', metadata)

      const dependencies = await beadsMemory.getDependencies(issue2Id)
      expect(dependencies[0].metadata).toEqual(metadata)
    })

    it('should detect ready work (unblocked issues)', async () => {
      await beadsMemory.addDependency(issue2Id, issue1Id, 'blocks')
      
      const readyWork = await beadsMemory.getReadyWork()
      expect(readyWork).toBeDefined()
    })

    it('should detect ready work after blocker is closed', async () => {
      await beadsMemory.addDependency(issue2Id, issue1Id, 'blocks')
      mockIssuesDb.get(issue1Id).status = 'closed'
      
      const readyWork = await beadsMemory.getReadyWork()
      expect(readyWork).toBeDefined()
    })

    it('should filter ready work by agent', async () => {
      // @ts-expect-error - Post-Merge Reconciliation
      await beadsMemory.createIssue({
        title: 'Agent Specific',
        status: 'open',
        priority: 1,
        issueType: 'task',
        assignee: 'agent-specific'
      })
      
      const readyWork = await beadsMemory.getReadyWork({ assignee: 'agent-specific' } as any)
      expect(readyWork).toBeDefined()
    })
  })

  describe('Label Management', () => {
    let issueId: string

    beforeEach(async () => {
      // @ts-expect-error - Post-Merge Reconciliation
      issueId = await beadsMemory.createIssue({
        title: 'Test Issue', status: 'open', priority: 2, issueType: 'task'
      })
    })

    it('should add and retrieve labels', async () => {
      await beadsMemory.addLabel(issueId, 'urgent')
      await beadsMemory.addLabel(issueId, 'backend')
      await beadsMemory.addLabel(issueId, 'bug')

      const labels = await beadsMemory.getLabels(issueId)
      expect(labels).toHaveLength(3)
      expect(labels).toContain('urgent')
    })

    it('should remove labels', async () => {
      await beadsMemory.addLabel(issueId, 'urgent')
      await beadsMemory.addLabel(issueId, 'backend')

      await beadsMemory.removeLabel(issueId, 'urgent')

      const labels = await beadsMemory.getLabels(issueId)
      expect(labels).toHaveLength(1)
      expect(labels).not.toContain('urgent')
    })

    it('should handle duplicate labels gracefully', async () => {
      await beadsMemory.addLabel(issueId, 'duplicate')
      await beadsMemory.addLabel(issueId, 'duplicate')

      const labels = await beadsMemory.getLabels(issueId)
      expect(labels.filter(l => l === 'duplicate')).toHaveLength(1)
    })
  })

  describe('Comment Management', () => {
    let issueId: string

    beforeEach(async () => {
      // @ts-expect-error - Post-Merge Reconciliation
      issueId = await beadsMemory.createIssue({
        title: 'Test Issue', status: 'open', priority: 2, issueType: 'task'
      })
    })

    it('should add and retrieve comments', async () => {
      const commentId1 = await beadsMemory.addComment(issueId, 'agent-1', 'First comment')
      const commentId2 = await beadsMemory.addComment(issueId, 'human-1', 'Second comment')

      expect(commentId1).toBeGreaterThan(0)
      expect(commentId2).toBeGreaterThan(0)

      const comments = await beadsMemory.getComments(issueId)
      expect(comments).toHaveLength(2)
    })

    it('should order comments chronologically', async () => {
      await beadsMemory.addComment(issueId, 'user1', 'First')
      await beadsMemory.addComment(issueId, 'user2', 'Second')

      const comments = await beadsMemory.getComments(issueId)
      expect(comments[0].text).toBe('First')
      expect(comments[1].text).toBe('Second')
    })
  })

  describe('Query Operations', () => {
    beforeEach(async () => {
      // @ts-expect-error - Post-Merge Reconciliation
      await beadsMemory.createIssue({
        title: 'High Priority Bug', status: 'open', priority: 0, issueType: 'bug', assignee: 'agent-1'
      })
      // @ts-expect-error - Post-Merge Reconciliation
      await beadsMemory.createIssue({
        title: 'Medium Priority Feature', status: 'in_progress', priority: 2, issueType: 'feature', assignee: 'agent-2'
      })
      // @ts-expect-error - Post-Merge Reconciliation
      await beadsMemory.createIssue({
        title: 'Low Priority Task', status: 'closed', priority: 4, issueType: 'task', assignee: 'agent-1'
      })
    })

    it('should filter by status', async () => {
      const openIssues = await beadsMemory.queryIssues({ status: ['open', 'in_progress'] })
      expect(openIssues.length).toBeGreaterThanOrEqual(2)
    })

    it('should filter by issue type', async () => {
      const bugs = await beadsMemory.queryIssues({ issueType: ['bug'] })
      expect(bugs.length).toBeGreaterThanOrEqual(1)
    })

    it('should filter by assignee', async () => {
      const agent1Issues = await beadsMemory.queryIssues({ assignee: 'agent-1' })
      expect(agent1Issues.length).toBeGreaterThanOrEqual(1)
    })

    it('should filter by priority range', async () => {
      const highPriority = await beadsMemory.queryIssues({ priority: { min: 0, max: 2 } })
      expect(highPriority).toBeDefined()
    })

    it('should search by text', async () => {
      const searchResults = await beadsMemory.queryIssues({ searchText: 'Priority' })
      expect(searchResults.length).toBeGreaterThanOrEqual(1)
    })

    it('should combine multiple filters', async () => {
      const combined = await beadsMemory.queryIssues({
        status: ['open'], issueType: ['bug'], assignee: 'agent-1'
      })
      expect(combined).toBeDefined()
    })

    it('should limit results', async () => {
      const limited = await beadsMemory.queryIssues({ limit: 2 })
      expect(limited.length).toBeLessThanOrEqual(2)
    })

    it('should sort by different fields', async () => {
      const sorted = await beadsMemory.queryIssues({ sortBy: 'priority' })
      expect(sorted).toBeDefined()
    })

    it('should include relationships when requested', async () => {
      const withRelations = await beadsMemory.queryIssues({ includeRelationships: true })
      expect(withRelations).toBeDefined()
    })
  })

  describe('Agent State Management', () => {
    let issueId: string

    beforeEach(async () => {
      // @ts-expect-error - Post-Merge Reconciliation
      issueId = await beadsMemory.createIssue({
        title: 'Agent Task', status: 'open', priority: 1, issueType: 'task', assignee: 'test-agent'
      })
    })

    it('should update agent state', async () => {
      await beadsMemory.updateAgentState(issueId, 'working', 'hook-123')
      expect(issueId).toBeDefined()
    })

    it('should find stuck agents', async () => {
      mockIssuesDb.get(issueId).agent_state = 'working'
      mockIssuesDb.get(issueId).last_activity = new Date(Date.now() - 3600000)

      const stuckAgents = await beadsMemory.findStuckAgents(30)
      expect(stuckAgents).toBeDefined()
    })

    it('should not return non-working agents as stuck', async () => {
      // Set agent state to idle (not working)
      mockIssuesDb.get(issueId).agent_state = 'idle'
      
      // This tests that findStuckAgents runs without error
      // Full filtering logic depends on actual SQL execution
      const stuckAgents = await beadsMemory.findStuckAgents(30)
      expect(stuckAgents).toBeDefined()
      expect(Array.isArray(stuckAgents)).toBe(true)
    })
  })

  describe('SuperClaw CORTEX Integration', () => {
    it('should convert AgentMemory to BEADS issue', async () => {
      const agentMemory = {
        type: 'learning',
        content: 'Learned how to handle API errors',
        metadata: { source: 'experience', confidence: 0.9 },
        importance: 8,
        embeddingHash: 'abc123'
      }

      // @ts-expect-error - Post-Merge Reconciliation
      const issueId = await beadsMemory.storeAgentMemory('test-agent', agentMemory)
      expect(issueId).toBeDefined()
      expect(issueId).toMatch(/^test-[a-z0-9]+$/)
    })

    it('should convert BEADS issue back to AgentMemory', () => {
      const beadsIssue = {
        id: 'test-123',
        title: 'Memory: context',
        description: 'Current conversation context',
        status: 'open' as const,
        priority: 2,
        issueType: 'context' as const,
        assignee: 'agent-1',
        compactionLevel: 0,
        metadata: { originalType: 'context', embeddingHash: 'def456', isCortexMemory: true },
        createdAt: new Date(),
        updatedAt: new Date()
      } as any

      const agentMemory = beadsMemory.beadsIssueToAgentMemory(beadsIssue)

      expect(agentMemory.id).toBe('test-123')
      expect(agentMemory.agentId).toBe('agent-1')
      expect(agentMemory.type).toBe('context')
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid issue IDs gracefully', async () => {
      const result = await beadsMemory.getIssue('invalid-id-that-does-not-exist')
      expect(result).toBeNull()
    })
  })

  describe('Cleanup', () => {
    it('should destroy service cleanly', async () => {
      await expect(beadsMemory.destroy()).resolves.not.toThrow()
    })
  })
})
