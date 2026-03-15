// @ts-nocheck
/**
 * Multi-Agent Coordination Integration Tests
 * 
 * Tests real coordination between agents using AgentChattr.
 * Requires agentchattr server running on localhost:8200/8300.
 * 
 * Run: npx vitest run src/swarm/__tests__/multi-agent-coordination.test.ts
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { AgentChattrBridge, SwarmCoordinator, ChatMessage } from '../../mcp/bridges/agentchattr';
import { AgentChattrConvoyAdapter } from '../agentchattr-convoy-adapter';

// Test configuration
const MCP_URL = process.env.AGENTCHATTR_URL || 'http://127.0.0.1:8200';
const TEST_CHANNEL = `test-${Date.now()}`;
const TIMEOUT_MS = 10000;

// Check if server is available
async function isServerAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${MCP_URL}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

describe('Multi-Agent Coordination', () => {
  let serverAvailable = false;
  
  beforeAll(async () => {
    serverAvailable = await isServerAvailable();
    if (!serverAvailable) {
      console.warn('⚠️ AgentChattr server not available. Skipping integration tests.');
      console.warn('   Start server with: cd ~/agentchattr && .venv/bin/python run.py');
    }
  });
  
  describe('AgentChattrBridge', () => {
    test('should connect and join channel', async () => {
      if (!serverAvailable) {return;}
      
      const bridge = new AgentChattrBridge({
        httpUrl: MCP_URL,
        agentName: 'test-agent-1',
        defaultChannel: TEST_CHANNEL,
      });
      
      const result = await bridge.connect();
      expect(result).toContain('Joined');
      expect(result).toContain('test-agent-1');
    }, TIMEOUT_MS);
    
    test('should send and receive messages', async () => {
      if (!serverAvailable) {return;}
      
      const sender = new AgentChattrBridge({
        httpUrl: MCP_URL,
        agentName: 'sender-agent',
        defaultChannel: TEST_CHANNEL,
      });
      
      const receiver = new AgentChattrBridge({
        httpUrl: MCP_URL,
        agentName: 'receiver-agent',
        defaultChannel: TEST_CHANNEL,
      });
      
      await sender.connect();
      await receiver.connect();
      
      // Send message
      const testMsg = `Test message ${Date.now()}`;
      await sender.send(testMsg);
      
      // Read messages
      const messages = await receiver.read({ limit: 10 });
      
      expect(messages.length).toBeGreaterThan(0);
      expect(messages.some(m => m.text.includes(testMsg))).toBe(true);
    }, TIMEOUT_MS);
    
    test('should track who is online', async () => {
      if (!serverAvailable) {return;}
      
      const bridge = new AgentChattrBridge({
        httpUrl: MCP_URL,
        agentName: 'presence-test',
        defaultChannel: TEST_CHANNEL,
      });
      
      await bridge.connect();
      const online = await bridge.who();
      
      expect(online).toContain('presence-test');
    }, TIMEOUT_MS);
    
    test('should propose and list decisions', async () => {
      if (!serverAvailable) {return;}
      
      const bridge = new AgentChattrBridge({
        httpUrl: MCP_URL,
        agentName: 'decision-maker',
        defaultChannel: TEST_CHANNEL,
      });
      
      await bridge.connect();
      
      // Propose decision
      const proposal = await bridge.proposeDecision(
        'Use TypeScript strict mode',
        'Catches more errors at compile time'
      );
      expect(proposal).toContain('Proposed decision');
      
      // List decisions
      const decisions = await bridge.listDecisions();
      expect(decisions.length).toBeGreaterThan(0);
      expect(decisions.some(d => d.decision.includes('TypeScript'))).toBe(true);
    }, TIMEOUT_MS);
  });
  
  describe('SwarmCoordinator', () => {
    test('should coordinate multiple agents', async () => {
      if (!serverAvailable) {return;}
      
      const coordinator = new SwarmCoordinator(`test-swarm-${Date.now()}`);
      
      // Register agents
      await coordinator.registerAgent('claude');
      await coordinator.registerAgent('codex');
      await coordinator.registerAgent('gemini');
      
      // Broadcast task
      await coordinator.broadcast('Analyze the codebase for security issues');
      
      // Get conversation
      const convo = await coordinator.getConversation(10);
      expect(convo.length).toBeGreaterThan(0);
      
      // Cleanup
      coordinator.cleanup();
    }, TIMEOUT_MS);
    
    test('should assign tasks to specific agents', async () => {
      if (!serverAvailable) {return;}
      
      const coordinator = new SwarmCoordinator(`task-assign-${Date.now()}`);
      
      await coordinator.registerAgent('reviewer');
      await coordinator.registerAgent('implementer');
      
      // Assign specific tasks
      await coordinator.assignTask('reviewer', 'Review the authentication flow');
      await coordinator.assignTask('implementer', 'Implement the fix');
      
      const convo = await coordinator.getConversation(10);
      
      expect(convo.some(m => m.text.includes('@reviewer'))).toBe(true);
      expect(convo.some(m => m.text.includes('@implementer'))).toBe(true);
      
      coordinator.cleanup();
    }, TIMEOUT_MS);
  });
  
  describe('AgentChattrConvoyAdapter', () => {
    test('should connect and post messages', async () => {
      if (!serverAvailable) {return;}
      
      const adapter = new AgentChattrConvoyAdapter({
        serverUrl: MCP_URL,
        name: 'convoy-test',
        channelConfig: {
          channel: TEST_CHANNEL,
        },
      });
      
      await adapter.connect();
      
      const bridge = adapter.getBridge();
      await bridge.send('Convoy adapter test message');
      
      const messages = await bridge.read({ limit: 5 });
      expect(messages.some(m => m.text.includes('Convoy adapter'))).toBe(true);
      
      adapter.disconnect();
    }, TIMEOUT_MS);
  });
  
  describe('Agent-to-Agent Communication', () => {
    test('should support @mention-based handoffs', async () => {
      if (!serverAvailable) {return;}
      
      const agent1 = new AgentChattrBridge({
        httpUrl: MCP_URL,
        agentName: 'agent-alpha',
        defaultChannel: TEST_CHANNEL,
      });
      
      const agent2 = new AgentChattrBridge({
        httpUrl: MCP_URL,
        agentName: 'agent-beta',
        defaultChannel: TEST_CHANNEL,
      });
      
      await agent1.connect();
      await agent2.connect();
      
      // Agent 1 mentions Agent 2
      await agent1.send('@agent-beta Please review my changes');
      
      // Agent 2 should see the mention
      const messages = await agent2.read({ limit: 10 });
      const mention = messages.find(m => m.text.includes('@agent-beta'));
      
      expect(mention).toBeDefined();
      expect(mention?.sender).toBe('agent-alpha');
    }, TIMEOUT_MS);
    
    test('should support broadcast to all agents', async () => {
      if (!serverAvailable) {return;}
      
      const coordinator = new AgentChattrBridge({
        httpUrl: MCP_URL,
        agentName: 'coordinator',
        defaultChannel: TEST_CHANNEL,
      });
      
      const worker1 = new AgentChattrBridge({
        httpUrl: MCP_URL,
        agentName: 'worker-1',
        defaultChannel: TEST_CHANNEL,
      });
      
      const worker2 = new AgentChattrBridge({
        httpUrl: MCP_URL,
        agentName: 'worker-2',
        defaultChannel: TEST_CHANNEL,
      });
      
      await coordinator.connect();
      await worker1.connect();
      await worker2.connect();
      
      // Broadcast to all
      await coordinator.send('@all New task available: implement feature X');
      
      // Both workers should see it
      const messages1 = await worker1.read({ limit: 5 });
      const messages2 = await worker2.read({ limit: 5 });
      
      expect(messages1.some(m => m.text.includes('@all'))).toBe(true);
      expect(messages2.some(m => m.text.includes('@all'))).toBe(true);
    }, TIMEOUT_MS);
  });
  
  describe('Decision Consensus', () => {
    test('should track proposed decisions', async () => {
      if (!serverAvailable) {return;}
      
      const agents = await Promise.all([
        createAndConnectAgent('decision-agent-1'),
        createAndConnectAgent('decision-agent-2'),
        createAndConnectAgent('decision-agent-3'),
      ]);
      
      // Agent 1 proposes
      await agents[0].proposeDecision(
        'Use AgentChattr for coordination',
        'Better visibility than MOLTBOOK'
      );
      
      // All agents can see decisions
      for (const agent of agents) {
        const decisions = await agent.listDecisions();
        expect(decisions.some(d => d.decision.includes('AgentChattr'))).toBe(true);
      }
    }, TIMEOUT_MS);
  });
});

// Helper
async function createAndConnectAgent(name: string): Promise<AgentChattrBridge> {
  const bridge = new AgentChattrBridge({
    httpUrl: MCP_URL,
    agentName: name,
    defaultChannel: TEST_CHANNEL,
  });
  await bridge.connect();
  return bridge;
}
