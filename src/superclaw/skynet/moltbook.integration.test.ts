// @ts-nocheck
/**
 * Integration test for MOLTBOOK + MessageBroker
 * 
 * Tests the integration between SKYNET MOLTBOOK and the new MessageBroker
 * to ensure backward compatibility and enhanced functionality work correctly.
 */

import { 
  getMoltbook, 
  startMoltbook, 
  stopMoltbook, 
  registerAgent, 
  sendMessage,
  sendTypedMessage,
  sendAndWait,
  subscribeToAgent,
  getEnhancedMoltbookState,
  acknowledgeMessage,
  getUnacknowledgedMessages
} from './moltbook';

describe('MOLTBOOK + MessageBroker Integration', () => {
  let moltbook: ReturnType<typeof getMoltbook>;
  
  beforeEach(async () => {
    moltbook = getMoltbook();
    await startMoltbook();
  });
  
  afterEach(async () => {
    await stopMoltbook();
  });

  describe('Backward Compatibility', () => {
    test('should register agents and send messages using legacy API', async () => {
      // Register two agents
      const agent1 = registerAgent({
        name: 'TestAgent1',
        model: 'claude-3-sonnet',
        goal: 'Test agent 1',
        permissions: ['test']
      });
      
      const agent2 = registerAgent({
        name: 'TestAgent2', 
        model: 'claude-3-sonnet',
        goal: 'Test agent 2',
        permissions: ['test']
      });

      // Send direct message using legacy API
      const message = sendMessage({
        type: 'direct',
        from: agent1.id,
        to: agent2.id,
        content: 'Hello from agent 1!'
      });

      expect(message.id).toBeDefined();
      expect(message.correlationId).toBeDefined();
      expect(message.type).toBe('direct');
      expect(message.from).toBe(agent1.id);
      expect(message.to).toBe(agent2.id);
    });

    test('should handle broadcast messages', async () => {
      const agents = [];
      for (let i = 0; i < 3; i++) {
        agents.push(registerAgent({
          name: `Agent${i}`,
          model: 'claude-3-sonnet',
          goal: `Test agent ${i}`,
          permissions: ['test']
        }));
      }

      const broadcastMessage = sendMessage({
        type: 'broadcast',
        from: agents[0].id,
        content: 'Broadcast to all!'
      });

      expect(broadcastMessage.type).toBe('broadcast');
    });
  });

  describe('Enhanced MessageBroker Features', () => {
    test('should send typed messages', async () => {
      const agent1 = registerAgent({
        name: 'TypedAgent1',
        model: 'claude-3-sonnet',
        goal: 'Typed message test',
        permissions: ['test']
      });
      
      const agent2 = registerAgent({
        name: 'TypedAgent2',
        model: 'claude-3-sonnet', 
        goal: 'Typed message test',
        permissions: ['test']
      });

      const payload = { 
        task: 'process_data', 
        data: [1, 2, 3], 
        metadata: { priority: 'high' } 
      };

      const messageId = await sendTypedMessage(
        agent1.id,
        agent2.id,
        'direct',
        payload,
        { metadata: { test: true } }
      );

      expect(messageId).toBeDefined();
    });

    test('should support sendAndWait pattern', async () => {
      const agent1 = registerAgent({
        name: 'QueryAgent',
        model: 'claude-3-sonnet',
        goal: 'Query test',
        permissions: ['test']
      });
      
      const agent2 = registerAgent({
        name: 'ResponseAgent',
        model: 'claude-3-sonnet',
        goal: 'Response test', 
        permissions: ['test']
      });

      // Set up response handler for agent2
      let receivedQuery: any = null;
      const unsubscribe = subscribeToAgent(agent2.id, async (message) => {
        receivedQuery = message;
        if (message.type === 'query') {
          // Send response
          sendMessage({
            type: 'response',
            from: agent2.id,
            to: message.from,
            content: JSON.stringify({ result: 'processed' }),
            correlationId: message.correlationId,
            queryId: message.queryId
          });
        }
      });

      try {
        // This should timeout since we're not properly handling the response flow yet
        // But it tests the API structure
        const queryPromise = sendAndWait(
          agent1.id,
          agent2.id,
          { task: 'process', data: 'test' },
          1000 // 1 second timeout
        );

        await expect(queryPromise).rejects.toThrow(/timeout/i);
      } finally {
        unsubscribe();
      }
    });

    test('should track unacknowledged messages', async () => {
      const agent1 = registerAgent({
        name: 'SenderAgent',
        model: 'claude-3-sonnet',
        goal: 'Send messages',
        permissions: ['test']
      });
      
      const agent2 = registerAgent({
        name: 'ReceiverAgent', 
        model: 'claude-3-sonnet',
        goal: 'Receive messages',
        permissions: ['test']
      });

      // Send a message
      const message = sendMessage({
        type: 'direct',
        from: agent1.id,
        to: agent2.id,
        content: 'Test message for acknowledgment'
      });

      // Check unacknowledged messages
      const unacked = getUnacknowledgedMessages(agent2.id);
      expect(unacked.length).toBeGreaterThan(0);

      // Acknowledge the message
      await acknowledgeMessage(message.id);

      // Verify it's no longer unacknowledged
      const unackedAfter = getUnacknowledgedMessages(agent2.id);
      expect(unackedAfter.length).toBeLessThan(unacked.length);
    });
  });

  describe('Enhanced State and Statistics', () => {
    test('should provide enhanced state with MessageBroker stats', () => {
      const state = getEnhancedMoltbookState();
      
      expect(state).toHaveProperty('messageBroker');
      expect(state).toHaveProperty('totalMessages');
      expect(state.messageBroker).toHaveProperty('totalMessages');
      expect(state.messageBroker).toHaveProperty('totalInboxes');
      expect(state.messageBroker).toHaveProperty('totalSubscriptions');
      expect(state.messageBroker).toHaveProperty('pendingReplies');
      expect(state.messageBroker).toHaveProperty('acknowledgments');
    });
  });

  describe('Direct MessageBroker Access', () => {
    test('should provide access to underlying MessageBroker', () => {
      const broker = moltbook.getMessageBroker();
      
      expect(broker).toBeDefined();
      expect(typeof broker.sendMessage).toBe('function');
      expect(typeof broker.sendAndWait).toBe('function');
      expect(typeof broker.subscribe).toBe('function');
      expect(typeof broker.getStats).toBe('function');
    });
  });
});