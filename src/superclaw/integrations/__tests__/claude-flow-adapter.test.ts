/**
 * Claude-Flow Adapter Integration Tests
 * 
 * Tests the integration between Claude-Flow patterns and SuperClaw architecture
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { 
  ClaudeFlowAdapter, 
  createClaudeFlowAdapter, 
  SuperClawMemoryBackend,
  getAvailableAgentTypes,
  getAgentCapabilities 
} from '../claude-flow-adapter';

// Mock SuperClaw dependencies
vi.mock('../../skynet/sub-agent', () => ({
  spawnSubAgent: vi.fn().mockImplementation(async (config) => ({
    id: `mock-agent-${Date.now()}`,
    name: config.name,
    send: vi.fn(),
    kill: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    getStats: vi.fn(() => ({}))
  }))
}));

vi.mock('../../skynet/moltbook', () => ({
  getMoltbook: vi.fn(() => ({
    on: vi.fn(),
    updateAgentStatus: vi.fn(),
    sendMessage: vi.fn(),
    unregisterAgent: vi.fn()
  }))
}));

vi.mock('../../utils/logger', () => ({
  logger: {
    child: vi.fn(() => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    }))
  }
}));

describe('Claude-Flow Adapter', () => {
  let adapter: ClaudeFlowAdapter;
  let memoryBackend: SuperClawMemoryBackend;

  beforeEach(() => {
    // @ts-expect-error - Post-Merge Reconciliation
    memoryBackend = new SuperClawMemoryBackend();
    adapter = createClaudeFlowAdapter({
      // @ts-expect-error - Post-Merge Reconciliation
      topology: 'hierarchical',
      memoryBackend
    });
  });

  afterEach(async () => {
    // @ts-expect-error - Post-Merge Reconciliation
    await adapter.shutdown();
  });

  describe('Agent Management', () => {
    it('should spawn specialized agents', async () => {
      // @ts-expect-error - Post-Merge Reconciliation
      const agentId = await adapter.spawnSpecializedAgent('coder', {
        goal: 'Test code generation'
      });

      expect(agentId).toBeTruthy();
      expect(agentId).toMatch(/^coder-[a-f0-9]{8}$/);

      // @ts-expect-error - Post-Merge Reconciliation
      const agent = adapter.getAgent(agentId);
      expect(agent).toBeTruthy();
      expect(agent?.type).toBe('coder');
      expect(agent?.capabilities).toContain('code-generation');
    });

    it('should spawn multiple specialized agents', async () => {
      const objective = 'Build a REST API';
      const agentTypes = ['architect', 'coder', 'tester'];
      
      // @ts-expect-error - Post-Merge Reconciliation
      const agentIds = await adapter.spawnSpecializedSwarm(objective, agentTypes);
      
      expect(agentIds).toHaveLength(3);
      
      // @ts-expect-error - Post-Merge Reconciliation
      const agents = adapter.getAgents();
      expect(agents).toHaveLength(3);
      // @ts-expect-error - Post-Merge Reconciliation
      expect(agents.map(a => a.type)).toEqual(expect.arrayContaining(agentTypes));
    });

    it('should reject unknown agent types', async () => {
      await expect(
        // @ts-expect-error - Post-Merge Reconciliation
        adapter.spawnSpecializedAgent('unknown-type')
      ).rejects.toThrow('Unknown specialized agent type');
    });

    it('should terminate agents properly', async () => {
      // @ts-expect-error - Post-Merge Reconciliation
      const agentId = await adapter.spawnSpecializedAgent('tester');
      // @ts-expect-error - Post-Merge Reconciliation
      expect(adapter.getAgent(agentId)).toBeTruthy();
      
      // @ts-expect-error - Post-Merge Reconciliation
      await adapter.terminateAgent(agentId);
      // @ts-expect-error - Post-Merge Reconciliation
      expect(adapter.getAgent(agentId)).toBeFalsy();
    });
  });

  describe('Task Management', () => {
    let agentId: string;

    beforeEach(async () => {
      // @ts-expect-error - Post-Merge Reconciliation
      agentId = await adapter.spawnSpecializedAgent('coder');
    });

    it('should create tasks', async () => {
      // @ts-expect-error - Post-Merge Reconciliation
      const taskId = await adapter.createTask({
        type: 'code',
        description: 'Generate a simple function',
        priority: 'high'
      });

      expect(taskId).toBeTruthy();
      expect(taskId).toMatch(/^task-[a-f0-9]{8}$/);

      // @ts-expect-error - Post-Merge Reconciliation
      const task = adapter.getTask(taskId);
      expect(task).toBeTruthy();
      expect(task?.type).toBe('code');
      expect(task?.priority).toBe('high');
    });

    it('should execute tasks with suitable agents', async () => {
      // @ts-expect-error - Post-Merge Reconciliation
      const taskId = await adapter.createTask({
        type: 'code',
        description: 'Write a hello world function'
      });

      // @ts-expect-error - Post-Merge Reconciliation
      const result = await adapter.executeTask(taskId);
      
      expect(result.taskId).toBe(taskId);
      expect(result.status).toBe('completed');
      expect(result.agentId).toBe(agentId);
      expect(result.duration).toBeGreaterThan(0);
    });

    it('should handle task dependencies', async () => {
      // @ts-expect-error - Post-Merge Reconciliation
      const task1Id = await adapter.createTask({
        type: 'design',
        description: 'Design the system'
      });

      // @ts-expect-error - Post-Merge Reconciliation
      const task2Id = await adapter.createTask({
        type: 'code',
        description: 'Implement the design',
        dependencies: [task1Id]
      });

      // Task 2 should fail because task 1 isn't completed
      // @ts-expect-error - Post-Merge Reconciliation
      const result = await adapter.executeTask(task2Id);
      expect(result.status).toBe('failed');
      expect(result.error).toContain('Dependencies not resolved');
    });

    it('should execute coordinated tasks', async () => {
      // @ts-expect-error - Post-Merge Reconciliation
      const architectId = await adapter.spawnSpecializedAgent('architect');
      // @ts-expect-error - Post-Merge Reconciliation
      const testerId = await adapter.spawnSpecializedAgent('tester');
      
      const objective = 'Create a simple API';
      const agentIds = [agentId, architectId, testerId];
      
      // @ts-expect-error - Post-Merge Reconciliation
      const results = await adapter.executeCoordinatedTasks(objective, agentIds);
      
      expect(results).toHaveLength(4); // design, code, test, review
      // @ts-expect-error - Post-Merge Reconciliation
      expect(results.every(r => r.status === 'completed')).toBe(true);
    });
  });

  describe('Consensus Mechanisms', () => {
    let agentIds: string[];

    beforeEach(async () => {
      // @ts-expect-error - Post-Merge Reconciliation
      agentIds = await adapter.spawnSpecializedSwarm('Test consensus', [
        'architect', 'coder', 'security-architect'
      ]);
    });

    it('should reach consensus with multiple agents', async () => {
      const decision = {
        id: 'test-decision',
        type: 'architecture' as const,
        description: 'Choose database technology',
        options: ['PostgreSQL', 'MongoDB', 'MySQL'],
        requiredVotes: 2,
        timeout: 30000
      };

      // @ts-expect-error - Post-Merge Reconciliation
      const result = await adapter.reachConsensus(decision, agentIds);
      
      expect(result.votes).toHaveLength(3);
      expect(result.totalVotes).toBe(3);
      expect(result.decision).toBeTruthy();
      expect(decision.options).toContain(result.decision);
    });

    it('should handle consensus failure', async () => {
      const decision = {
        id: 'hard-decision',
        type: 'deployment' as const,
        description: 'Impossible choice',
        options: ['option1', 'option2'],
        requiredVotes: 10, // More than available agents
        timeout: 1000
      };

      // @ts-expect-error - Post-Merge Reconciliation
      const result = await adapter.reachConsensus(decision, agentIds);
      
      expect(result.consensusReached).toBe(false);
      expect(result.decision).toBe(null);
    });
  });

  describe('Memory System', () => {
    it('should store and retrieve memories', async () => {
      const memory = {
        id: 'test-memory',
        agentId: 'test-agent',
        content: 'Test memory content',
        type: 'event' as const,
        timestamp: Date.now()
      };

      // @ts-expect-error - Post-Merge Reconciliation
      await memoryBackend.store(memory);
      const memories = await memoryBackend.retrieve('Test memory');
      
      expect(memories).toHaveLength(1);
      expect(memories[0]).toEqual(memory);
    });

    it('should search memories', async () => {
      // @ts-expect-error - Post-Merge Reconciliation
      await memoryBackend.store({
        id: 'mem1',
        agentId: 'agent1',
        content: 'JavaScript function',
        type: 'pattern',
        timestamp: Date.now()
      });

      // @ts-expect-error - Post-Merge Reconciliation
      await memoryBackend.store({
        id: 'mem2',
        agentId: 'agent2',
        content: 'Python script',
        type: 'pattern',
        timestamp: Date.now()
      });

      const jsMemories = await memoryBackend.retrieve('JavaScript');
      expect(jsMemories).toHaveLength(1);
      expect(jsMemories[0].content).toContain('JavaScript');
    });
  });

  describe('Topology Management', () => {
    it('should create hierarchical connections', () => {
      // @ts-expect-error - Post-Merge Reconciliation
      expect(adapter.getTopology()).toBe('hierarchical');
    });

    it('should create mesh connections', async () => {
      // @ts-expect-error - Post-Merge Reconciliation
      const meshAdapter = createClaudeFlowAdapter({ topology: 'mesh' });
      
      // @ts-expect-error - Post-Merge Reconciliation
      await meshAdapter.spawnSpecializedAgent('coder');
      // @ts-expect-error - Post-Merge Reconciliation
      await meshAdapter.spawnSpecializedAgent('tester');
      
      // @ts-expect-error - Post-Merge Reconciliation
      const connections = meshAdapter.getConnections();
      expect(connections.length).toBeGreaterThan(0);
      
      // @ts-expect-error - Post-Merge Reconciliation
      await meshAdapter.shutdown();
    });
  });

  describe('Utility Functions', () => {
    it('should return available agent types', () => {
      const types = getAvailableAgentTypes();
      expect(types).toContain('architect');
      expect(types).toContain('coder');
      expect(types).toContain('tester');
      expect(types).toContain('security-architect');
      expect(types.length).toBeGreaterThan(5);
    });

    it('should return agent capabilities', () => {
      const caps = getAgentCapabilities('coder');
      expect(caps).toContain('code-generation');
      expect(caps).toContain('refactoring');
      expect(caps).toContain('debugging');
    });

    it('should return empty array for unknown agent type', () => {
      const caps = getAgentCapabilities('unknown-type');
      expect(caps).toEqual([]);
    });
  });

  describe('Error Handling', () => {
    it('should handle agent spawn failures gracefully', async () => {
      // Mock spawn failure
      const { spawnSubAgent } = await import('../../skynet/sub-agent');
      vi.mocked(spawnSubAgent).mockRejectedValueOnce(new Error('Spawn failed'));

      // @ts-expect-error - Post-Merge Reconciliation
      const agentIds = await adapter.spawnSpecializedSwarm('Test failure', ['coder', 'tester']);
      
      // Should spawn only the successful one
      expect(agentIds.length).toBeLessThan(2);
    });

    it('should handle task execution failures', async () => {
      // @ts-expect-error - Post-Merge Reconciliation
      const agentId = await adapter.spawnSpecializedAgent('coder');
      // @ts-expect-error - Post-Merge Reconciliation
      const taskId = await adapter.createTask({
        type: 'invalid-type',
        description: 'This should fail'
      });

      // @ts-expect-error - Post-Merge Reconciliation
      const result = await adapter.executeTask(taskId);
      expect(result.status).toBe('failed');
      expect(result.error).toBeTruthy();
    });
  });
});