/**
 * MOLTBOOK + MessageBroker Integration Usage Examples
 * 
 * This file demonstrates how to use the enhanced MOLTBOOK with both
 * backward-compatible APIs and new MessageBroker-powered features.
 */

import {
  // Backward compatible API
  startMoltbook,
  stopMoltbook,
  registerAgent,
  sendMessage,
  getAllAgents,
  setAgentHooks,
  
  // Enhanced MessageBroker API
  sendTypedMessage,
  sendAndWait,
  sendQuery,
  subscribeToAgent,
  subscribeToMessageType,
  getEnhancedMoltbookState,
  acknowledgeMessage,
  getUnacknowledgedMessages,
  getMessageBroker,
  
  // Types
  type Agent,
  type Message,
  type TypedMessage
} from './moltbook';

async function demonstrateBackwardCompatibility() {
  console.log('🔄 BACKWARD COMPATIBILITY DEMO');
  
  // Start the MOLTBOOK system (now MessageBroker-powered)
  await startMoltbook();
  
  // Register agents using the familiar API
  const coordinator = registerAgent({
    name: 'Coordinator',
    model: 'claude-3-opus',
    goal: 'Coordinate team activities',
    permissions: ['manage', 'coordinate']
  });
  
  const worker1 = registerAgent({
    name: 'Worker1',
    model: 'claude-3-sonnet',
    goal: 'Process data',
    permissions: ['read', 'process']
  });
  
  const worker2 = registerAgent({
    name: 'Worker2', 
    model: 'claude-3-sonnet',
    goal: 'Generate reports',
    permissions: ['read', 'write']
  });
  
  // Set up lifecycle hooks (unchanged API)
  setAgentHooks({
    onSpawn: (agent) => {
      console.log(`✨ Agent spawned: ${agent.name}`);
    },
    onMessage: (agent, message) => {
      console.log(`📨 ${agent.name} received: ${message.content}`);
    },
    onDeath: (agent) => {
      console.log(`💀 Agent died: ${agent.name}`);
    }
  });
  
  // Send messages using familiar API (now routed through MessageBroker)
  sendMessage({
    type: 'direct',
    from: coordinator.id,
    to: worker1.id,
    content: 'Please process the customer data'
  });
  
  sendMessage({
    type: 'broadcast',
    from: coordinator.id,
    content: 'Team meeting at 3 PM'
  });
  
  // Query pattern (enhanced with correlation tracking)
  sendMessage({
    type: 'query', 
    from: coordinator.id,
    to: [worker1.id, worker2.id],
    content: 'What is your current workload?'
  });
  
  console.log(`👥 Total agents: ${getAllAgents().length}`);
}

async function demonstrateEnhancedFeatures() {
  console.log('\n🚀 ENHANCED MESSAGEBROKER FEATURES DEMO');
  
  const agents = getAllAgents();
  const [coordinator, worker1, worker2] = agents;
  
  // 1. Typed messaging with structured payloads
  interface TaskPayload {
    taskId: string;
    type: 'data_processing' | 'report_generation';
    priority: 'low' | 'medium' | 'high';
    data: any;
    deadline?: Date;
  }
  
  const taskId = await sendTypedMessage<TaskPayload>(
    coordinator.id,
    worker1.id,
    'direct',
    {
      taskId: 'task-001',
      type: 'data_processing', 
      priority: 'high',
      data: { customers: ['alice', 'bob', 'charlie'] },
      deadline: new Date(Date.now() + 24 * 60 * 60 * 1000)
    },
    { 
      correlationId: 'task-session-001',
      metadata: { department: 'analytics' }
    }
  );
  
  console.log(`📤 Sent typed task message: ${taskId}`);
  
  // 2. Request/Response with timeout
  try {
    interface StatusQuery {
      requestType: 'status_check';
      includeMetrics: boolean;
    }
    
    interface StatusResponse {
      status: 'idle' | 'busy' | 'error';
      currentTasks: number;
      metrics?: {
        tasksCompleted: number;
        avgProcessingTime: number;
      };
    }
    
    const response = await sendAndWait<StatusQuery, StatusResponse>(
      coordinator.id,
      worker1.id,
      {
        requestType: 'status_check',
        includeMetrics: true
      },
      5000 // 5 second timeout
    );
    
    console.log('📊 Worker status:', response);
  } catch (error: unknown) {
    console.log('⏰ Status check timed out or failed:', (error as Error).message);
  }
  
  // 3. Multi-agent query with typed responses
  interface WorkloadQuery {
    reportingPeriod: 'current' | 'today' | 'week';
  }
  
  interface WorkloadResponse {
    agentId: string;
    agentName: string;
    currentLoad: number;
    queueSize: number;
    estimatedAvailability: Date;
  }
  
  try {
    const workloadResponses = await sendQuery<WorkloadQuery, WorkloadResponse>(
      coordinator.id,
      [worker1.id, worker2.id],
      { reportingPeriod: 'current' },
      3000
    );
    
    console.log('📈 Team workload:', workloadResponses);
  } catch (error: unknown) {
    console.log('⚠️ Some agents did not respond to workload query');
  }
  
  // 4. Advanced subscriptions
  const unsubscribeWorker1 = subscribeToAgent(worker1.id, async (message) => {
    console.log(`🔔 Worker1 subscription: ${message.type} from ${message.from}`);
    
    // Auto-acknowledge messages
    await acknowledgeMessage(message.id);
  });
  
  const unsubscribeTaskMessages = subscribeToMessageType(
    worker2.id,
    'direct', 
    async (message) => {
      console.log(`📋 Worker2 received direct message: ${message.content}`);
      
      // Simulate processing time
      await new Promise(resolve => setTimeout(resolve, 100));
      
      await acknowledgeMessage(message.id);
    }
  );
  
  // 5. Message acknowledgment tracking
  const unacknowledgedWorker1 = getUnacknowledgedMessages(worker1.id);
  const unacknowledgedWorker2 = getUnacknowledgedMessages(worker2.id);
  
  console.log(`📥 Unacknowledged - Worker1: ${unacknowledgedWorker1.length}, Worker2: ${unacknowledgedWorker2.length}`);
  
  // Clean up subscriptions
  unsubscribeWorker1();
  unsubscribeTaskMessages();
}

async function demonstrateDirectMessageBrokerAccess() {
  console.log('\n🔧 DIRECT MESSAGEBROKER ACCESS DEMO');
  
  // Get direct access to MessageBroker for advanced usage
  const messageBroker = getMessageBroker();
  
  const agents = getAllAgents();
  const [coordinator, worker1] = agents;
  
  // Use MessageBroker directly for orchestration message types
  // @ts-expect-error - Post-Merge Reconciliation
  import { MessageType } from '../orchestration/types';
  
  await messageBroker.sendMessage(
    coordinator.id,
    worker1.id,
    MessageType.TASK_READY,
    {
      orchestrationType: 'advanced_coordination',
      payload: { 
        task: 'complex_analysis',
        requiresValidation: true
      }
    }
  );
  
  // Get detailed MessageBroker statistics
  const stats = messageBroker.getStats();
  console.log('🔍 MessageBroker stats:', stats);
}

async function demonstrateMonitoringAndDiagnostics() {
  console.log('\n📊 MONITORING & DIAGNOSTICS DEMO');
  
  // Enhanced state with both MOLTBOOK and MessageBroker metrics
  const enhancedState = getEnhancedMoltbookState();
  
  console.log('📈 Enhanced MOLTBOOK State:');
  console.log(`  - Running: ${enhancedState.isRunning}`);
  console.log(`  - Agents: ${enhancedState.agentCount}`);  
  console.log(`  - MOLTBOOK Messages: ${enhancedState.messageCount}`);
  console.log(`  - MessageBroker Messages: ${enhancedState.messageBroker.totalMessages}`);
  console.log(`  - Total Messages: ${enhancedState.totalMessages}`);
  console.log(`  - Active Subscriptions: ${enhancedState.messageBroker.totalSubscriptions}`);
  console.log(`  - Pending Replies: ${enhancedState.messageBroker.pendingReplies}`);
  console.log(`  - Acknowledgments: ${enhancedState.messageBroker.acknowledgments}`);
  console.log(`  - Uptime: ${enhancedState.uptime}ms`);
}

async function runDemo() {
  try {
    await demonstrateBackwardCompatibility();
    await demonstrateEnhancedFeatures();
    await demonstrateDirectMessageBrokerAccess();
    await demonstrateMonitoringAndDiagnostics();
    
    console.log('\n✅ DEMO COMPLETE - All features working!');
  } catch (error: unknown) {
    console.error('❌ Demo failed:', error);
  } finally {
    // Clean shutdown
    await stopMoltbook();
    console.log('🛑 MOLTBOOK stopped gracefully');
  }
}

// Run the demo if this file is executed directly
if (require.main === module) {
  runDemo().catch(console.error);
}

export { runDemo };