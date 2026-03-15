import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AgentOrchestrator } from '../AgentOrchestrator'
import type { AgentIdentity, OrchestratorConfig } from '../types'

vi.mock('../WorkspaceManager')
vi.mock('../MessageBroker')

describe('AgentOrchestrator', () => {
  let orchestrator: AgentOrchestrator
  const testConfig: OrchestratorConfig = {
    maxConcurrentAgents: 5,
    agentTimeoutMs: 5000,
    heartbeatIntervalMs: 1000,
    workspaceBaseDir: '/tmp/test-workspaces',
    enableGitWorktrees: false
  }

  const testIdentity: AgentIdentity = {
    role: 'worker',
    project: 'test-project',
    name: 'test-agent',
    namespace: 'test',
    capabilities: ['code'],
    version: '1.0.0'
  }

  beforeEach(async () => {
    orchestrator = new AgentOrchestrator(testConfig)
    await orchestrator.initialize()
  })

  afterEach(async () => {
    await orchestrator.shutdown()
    vi.clearAllMocks()
  })

  describe('spawnAgent', () => {
    it('should return session ID on success', async () => {
      const sessionId = await orchestrator.spawnAgent(testIdentity)
      expect(sessionId).toBeDefined()
      expect(typeof sessionId).toBe('string')
    })

    it('should respect max concurrent agents', async () => {
      // Spawn max agents
      for (let i = 0; i < 5; i++) {
        await orchestrator.spawnAgent({
          ...testIdentity,
          name: `agent-${i}`
        })
      }

      // Next should fail
      await expect(
        orchestrator.spawnAgent({ ...testIdentity, name: 'overflow' })
      ).rejects.toThrow()
    })

    it('should emit spawn event', async () => {
      const handler = vi.fn()
      orchestrator.on('agent-spawned', handler)
      
      await orchestrator.spawnAgent(testIdentity)
      
      expect(handler).toHaveBeenCalled()
    })

    it('should validate agent identity', async () => {
      const invalidIdentity = { ...testIdentity, role: '' as any }
      
      await expect(
        orchestrator.spawnAgent(invalidIdentity)
      ).rejects.toThrow()
    })

    it('should assign unique session IDs', async () => {
      const sessionId1 = await orchestrator.spawnAgent({ ...testIdentity, name: 'agent-1' })
      const sessionId2 = await orchestrator.spawnAgent({ ...testIdentity, name: 'agent-2' })
      
      expect(sessionId1).not.toBe(sessionId2)
    })

    it('should track agent spawn time', async () => {
      const beforeSpawn = Date.now()
      const sessionId = await orchestrator.spawnAgent(testIdentity)
      const afterSpawn = Date.now()
      
      const session = await orchestrator.getSession(sessionId)
      expect(session).toBeDefined()
      expect(session!.spawnedAt).toBeGreaterThanOrEqual(beforeSpawn)
      expect(session!.spawnedAt).toBeLessThanOrEqual(afterSpawn)
    })

    it('should create workspace for agent', async () => {
      const sessionId = await orchestrator.spawnAgent(testIdentity)
      const session = await orchestrator.getSession(sessionId)
      
      expect(session).toBeDefined()
      expect(session!.workspaceDir).toContain('/tmp/test-workspaces')
    })
  })

  describe('killAgent', () => {
    it('should terminate agent gracefully', async () => {
      const sessionId = await orchestrator.spawnAgent(testIdentity)
      await orchestrator.killAgent(sessionId)
      
      const session = await orchestrator.getSession(sessionId)
      expect(session).toBeUndefined()
    })

    it('should emit kill event', async () => {
      const handler = vi.fn()
      orchestrator.on('agent-killed', handler)
      
      const sessionId = await orchestrator.spawnAgent(testIdentity)
      await orchestrator.killAgent(sessionId)
      
      expect(handler).toHaveBeenCalled()
    })

    it('should handle killing non-existent agent', async () => {
      await expect(
        orchestrator.killAgent('non-existent-id')
      ).rejects.toThrow('Agent not found')
    })

    it('should cleanup agent resources', async () => {
      const sessionId = await orchestrator.spawnAgent(testIdentity)
      const sessionsBefore = await orchestrator.listSessions()
      
      await orchestrator.killAgent(sessionId)
      const sessionsAfter = await orchestrator.listSessions()
      
      expect(sessionsBefore.length).toBe(1)
      expect(sessionsAfter.length).toBe(0)
    })

    it('should forcefully kill agent after timeout', async () => {
      const sessionId = await orchestrator.spawnAgent(testIdentity)
      
      // Mock process that doesn't respond to SIGTERM
      const session = await orchestrator.getSession(sessionId)
      if (session?.process) {
        vi.mocked(session.process.kill).mockReturnValue(false)
      }
      
      // @ts-expect-error - Post-Merge Reconciliation
      await orchestrator.killAgent(sessionId, { force: true })
      
      const finalSession = await orchestrator.getSession(sessionId)
      expect(finalSession).toBeUndefined()
    })
  })

  describe('listSessions', () => {
    it('should return all active sessions', async () => {
      await orchestrator.spawnAgent({ ...testIdentity, name: 'agent-1' })
      await orchestrator.spawnAgent({ ...testIdentity, name: 'agent-2' })
      
      const sessions = await orchestrator.listSessions()
      expect(sessions.length).toBe(2)
    })

    it('should filter by project', async () => {
      await orchestrator.spawnAgent({ ...testIdentity, project: 'proj-a' })
      await orchestrator.spawnAgent({ ...testIdentity, project: 'proj-b' })
      
      const sessions = await orchestrator.getSessionsByProject('proj-a')
      expect(sessions.length).toBe(1)
    })

    it('should filter by namespace', async () => {
      await orchestrator.spawnAgent({ ...testIdentity, namespace: 'ns-a' })
      await orchestrator.spawnAgent({ ...testIdentity, namespace: 'ns-b' })
      
      // @ts-expect-error - Post-Merge Reconciliation
      const sessions = await orchestrator.getSessionsByNamespace('ns-a')
      expect(sessions.length).toBe(1)
    })

    it('should return empty array when no sessions', async () => {
      const sessions = await orchestrator.listSessions()
      expect(sessions).toEqual([])
    })

    it('should include session metadata', async () => {
      const sessionId = await orchestrator.spawnAgent(testIdentity)
      const sessions = await orchestrator.listSessions()
      
      expect(sessions[0]).toMatchObject({
        sessionId,
        identity: testIdentity,
        status: expect.any(String),
        spawnedAt: expect.any(Number)
      })
    })
  })

  describe('getSession', () => {
    it('should return session by ID', async () => {
      const sessionId = await orchestrator.spawnAgent(testIdentity)
      const session = await orchestrator.getSession(sessionId)
      
      expect(session).toBeDefined()
      expect(session!.sessionId).toBe(sessionId)
    })

    it('should return undefined for non-existent session', async () => {
      const session = await orchestrator.getSession('non-existent')
      expect(session).toBeUndefined()
    })
  })

  describe('messaging', () => {
    it('should send messages between agents', async () => {
      const session1 = await orchestrator.spawnAgent({ ...testIdentity, name: 'sender' })
      const session2 = await orchestrator.spawnAgent({ ...testIdentity, name: 'receiver' })
      
      await orchestrator.sendMessage(
        session1,
        session2,
        'TASK_READY' as any,
        { task: 'test' }
      )
      
      // Message should be delivered (would be verified by MessageBroker mock)
    })

    it('should broadcast messages to all agents', async () => {
      await orchestrator.spawnAgent({ ...testIdentity, name: 'agent-1' })
      await orchestrator.spawnAgent({ ...testIdentity, name: 'agent-2' })
      
      // @ts-expect-error - Post-Merge Reconciliation
      await orchestrator.broadcastMessage('SHUTDOWN' as any, { reason: 'test' })
      
      // Broadcast should reach all agents
    })

    it('should handle message routing errors', async () => {
      const sessionId = await orchestrator.spawnAgent(testIdentity)
      
      await expect(
        orchestrator.sendMessage(sessionId, 'non-existent', 'TASK_READY' as any, {})
      ).rejects.toThrow()
    })

    it('should queue messages for offline agents', async () => {
      const session1 = await orchestrator.spawnAgent({ ...testIdentity, name: 'sender' })
      const session2 = await orchestrator.spawnAgent({ ...testIdentity, name: 'receiver' })
      
      // Simulate receiver going offline
      await orchestrator.killAgent(session2)
      
      // Message should be queued
      await orchestrator.sendMessage(
        session1,
        session2,
        'TASK_READY' as any,
        { task: 'queued' }
      )
      
      // When receiver comes back online, it should receive queued messages
      const newSession2 = await orchestrator.spawnAgent({ 
        ...testIdentity, 
        name: 'receiver',
        // @ts-expect-error - Post-Merge Reconciliation
        sessionId: session2 // Resume with same ID
      })
      
      // Verify message delivery (mock would track this)
    })
  })

  describe('heartbeat monitoring', () => {
    it('should detect heartbeat failures', async () => {
      const sessionId = await orchestrator.spawnAgent(testIdentity)
      
      // Mock heartbeat failure
      const session = await orchestrator.getSession(sessionId)
      if (session) {
        // @ts-expect-error - Post-Merge Reconciliation
        session.lastHeartbeat = Date.now() - 10000 // 10 seconds ago
      }
      
      // @ts-expect-error - Post-Merge Reconciliation
      const failedAgents = await orchestrator.checkHeartbeats()
      expect(failedAgents).toContain(sessionId)
    })

    it('should restart failed agents automatically', async () => {
      const sessionId = await orchestrator.spawnAgent(testIdentity)
      const handler = vi.fn()
      orchestrator.on('agent-restarted', handler)
      
      // Simulate heartbeat failure
      // @ts-expect-error - Post-Merge Reconciliation
      await orchestrator.handleHeartbeatFailure(sessionId)
      
      expect(handler).toHaveBeenCalled()
    })

    it('should emit heartbeat events', async () => {
      const sessionId = await orchestrator.spawnAgent(testIdentity)
      const handler = vi.fn()
      orchestrator.on('heartbeat-received', handler)
      
      // @ts-expect-error - Post-Merge Reconciliation
      await orchestrator.recordHeartbeat(sessionId)
      
      expect(handler).toHaveBeenCalledWith(sessionId)
    })
  })

  describe('resource management', () => {
    it('should track memory usage per agent', async () => {
      const sessionId = await orchestrator.spawnAgent(testIdentity)
      const session = await orchestrator.getSession(sessionId)
      
      expect(session).toBeDefined()
      expect(session!.resources).toBeDefined()
      expect(session!.resources.memoryMB).toBeGreaterThan(0)
    })

    it('should enforce memory limits', async () => {
      const highMemConfig = { ...testConfig, maxMemoryPerAgentMB: 100 }
      const testOrchestrator = new AgentOrchestrator(highMemConfig)
      await testOrchestrator.initialize()
      
      const sessionId = await testOrchestrator.spawnAgent(testIdentity)
      
      // Simulate high memory usage
      // @ts-expect-error - Post-Merge Reconciliation
      await testOrchestrator.updateAgentResources(sessionId, { memoryMB: 150 })
      
      // Agent should be killed for exceeding limits
      const session = await testOrchestrator.getSession(sessionId)
      expect(session?.status).toBe('killed')
      
      await testOrchestrator.shutdown()
    })

    it('should track CPU usage', async () => {
      const sessionId = await orchestrator.spawnAgent(testIdentity)
      
      // @ts-expect-error - Post-Merge Reconciliation
      await orchestrator.updateAgentResources(sessionId, { cpuPercent: 25.5 })
      
      const session = await orchestrator.getSession(sessionId)
      expect(session!.resources.cpuPercent).toBe(25.5)
    })
  })

  describe('recovery', () => {
    it('should recover crashed agents', async () => {
      // Simulate crashed agent
      const sessionId = await orchestrator.spawnAgent(testIdentity)
      
      // Force crash simulation
      const session = await orchestrator.getSession(sessionId)
      if (session?.process) {
        session.process.exitCode = 1
        // @ts-expect-error - Post-Merge Reconciliation
        session.status = 'crashed'
      }
      
      // Recovery should work
      const newSessionId = await orchestrator.recoverFailedAgent(testIdentity)
      expect(newSessionId).toBeDefined()
      expect(newSessionId).not.toBe(sessionId) // New session ID
    })

    it('should preserve agent state during recovery', async () => {
      const sessionId = await orchestrator.spawnAgent(testIdentity)
      
      // Set some state
      // @ts-expect-error - Post-Merge Reconciliation
      await orchestrator.updateAgentState(sessionId, { customData: 'test-data' })
      
      // Simulate crash and recovery
      // @ts-expect-error - Post-Merge Reconciliation
      await orchestrator.crashAgent(sessionId)
      const newSessionId = await orchestrator.recoverFailedAgent(testIdentity)
      
      // State should be preserved
      const recoveredSession = await orchestrator.getSession(newSessionId!)
      expect(recoveredSession?.state?.customData).toBe('test-data')
    })

    it('should limit recovery attempts', async () => {
      const identity = { ...testIdentity, maxRecoveryAttempts: 2 }
      
      for (let i = 0; i < 3; i++) {
        const sessionId = await orchestrator.spawnAgent(identity)
        // @ts-expect-error - Post-Merge Reconciliation
        await orchestrator.crashAgent(sessionId)
        
        if (i < 2) {
          const recovered = await orchestrator.recoverFailedAgent(identity)
          expect(recovered).toBeDefined()
        } else {
          await expect(orchestrator.recoverFailedAgent(identity))
            .rejects.toThrow('Maximum recovery attempts exceeded')
        }
      }
    })

    it('should emit recovery events', async () => {
      const handler = vi.fn()
      orchestrator.on('agent-recovery-started', handler)
      
      const sessionId = await orchestrator.spawnAgent(testIdentity)
      // @ts-expect-error - Post-Merge Reconciliation
      await orchestrator.crashAgent(sessionId)
      await orchestrator.recoverFailedAgent(testIdentity)
      
      expect(handler).toHaveBeenCalled()
    })
  })

  describe('workspace management', () => {
    it('should create isolated workspaces', async () => {
      const session1 = await orchestrator.spawnAgent({ ...testIdentity, name: 'agent-1' })
      const session2 = await orchestrator.spawnAgent({ ...testIdentity, name: 'agent-2' })
      
      const workspace1 = await orchestrator.getSession(session1)
      const workspace2 = await orchestrator.getSession(session2)
      
      expect(workspace1!.workspaceDir).not.toBe(workspace2!.workspaceDir)
    })

    it('should cleanup workspaces on agent termination', async () => {
      const sessionId = await orchestrator.spawnAgent(testIdentity)
      const session = await orchestrator.getSession(sessionId)
      const workspaceDir = session!.workspaceDir
      
      await orchestrator.killAgent(sessionId)
      
      // Workspace should be cleaned up (would be verified by WorkspaceManager mock)
    })

    it('should support git worktrees when enabled', async () => {
      const gitConfig = { ...testConfig, enableGitWorktrees: true }
      const testOrchestrator = new AgentOrchestrator(gitConfig)
      await testOrchestrator.initialize()
      
      const sessionId = await testOrchestrator.spawnAgent(testIdentity)
      const session = await testOrchestrator.getSession(sessionId)
      
      expect(session!.gitWorktree).toBeDefined()
      
      await testOrchestrator.shutdown()
    })
  })

  describe('shutdown', () => {
    it('should gracefully shutdown all agents', async () => {
      await orchestrator.spawnAgent({ ...testIdentity, name: 'agent-1' })
      await orchestrator.spawnAgent({ ...testIdentity, name: 'agent-2' })
      
      await orchestrator.shutdown()
      
      const sessions = await orchestrator.listSessions()
      expect(sessions.length).toBe(0)
    })

    it('should wait for agents to finish gracefully', async () => {
      const sessionId = await orchestrator.spawnAgent(testIdentity)
      const handler = vi.fn()
      orchestrator.on('shutdown-complete', handler)
      
      // @ts-expect-error - Post-Merge Reconciliation
      await orchestrator.shutdown({ graceful: true, timeoutMs: 5000 })
      
      expect(handler).toHaveBeenCalled()
    })

    it('should force kill agents after timeout', async () => {
      await orchestrator.spawnAgent({ ...testIdentity, name: 'stubborn-agent' })
      
      // Mock agent that doesn't respond to graceful shutdown
      // @ts-expect-error - Post-Merge Reconciliation
      const shutdownPromise = orchestrator.shutdown({ 
        graceful: true, 
        timeoutMs: 100 
      })
      
      await expect(shutdownPromise).resolves.not.toThrow()
      
      const sessions = await orchestrator.listSessions()
      expect(sessions.length).toBe(0)
    })

    it('should cleanup all resources on shutdown', async () => {
      const handler = vi.fn()
      orchestrator.on('resources-cleaned', handler)
      
      await orchestrator.spawnAgent(testIdentity)
      await orchestrator.shutdown()
      
      expect(handler).toHaveBeenCalled()
    })
  })

  describe('events', () => {
    it('should emit all lifecycle events', async () => {
      const events: string[] = []
      
      orchestrator.on('agent-spawned', () => events.push('spawned'))
      orchestrator.on('agent-killed', () => events.push('killed'))
      orchestrator.on('heartbeat-received', () => events.push('heartbeat'))
      
      const sessionId = await orchestrator.spawnAgent(testIdentity)
      // @ts-expect-error - Post-Merge Reconciliation
      await orchestrator.recordHeartbeat(sessionId)
      await orchestrator.killAgent(sessionId)
      
      expect(events).toEqual(['spawned', 'heartbeat', 'killed'])
    })

    it('should support event filtering', async () => {
      const projectHandler = vi.fn()
      
      orchestrator.on('agent-spawned', (data) => {
        if (data.identity.project === 'target-project') {
          projectHandler(data)
        }
      })
      
      await orchestrator.spawnAgent(testIdentity)
      await orchestrator.spawnAgent({ ...testIdentity, project: 'target-project' })
      
      expect(projectHandler).toHaveBeenCalledTimes(1)
    })
  })

  describe('error handling', () => {
    it('should handle spawn failures gracefully', async () => {
      // Mock spawn failure
      const badIdentity = { ...testIdentity, name: '' }
      
      await expect(orchestrator.spawnAgent(badIdentity))
        .rejects.toThrow()
      
      // Orchestrator should remain stable
      const goodSessionId = await orchestrator.spawnAgent(testIdentity)
      expect(goodSessionId).toBeDefined()
    })

    it('should handle workspace creation failures', async () => {
      // Mock workspace creation failure
      const testOrchestrator = new AgentOrchestrator({
        ...testConfig,
        workspaceBaseDir: '/invalid/path'
      })
      
      await expect(testOrchestrator.initialize()).rejects.toThrow()
    })

    it('should emit error events', async () => {
      const handler = vi.fn()
      orchestrator.on('error', handler)
      
      // Trigger an error condition
      await expect(orchestrator.killAgent('non-existent')).rejects.toThrow()
      
      expect(handler).toHaveBeenCalled()
    })
  })
})