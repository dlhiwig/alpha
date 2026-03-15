# MOLTBOOK + MessageBroker Integration Guide

## 🎯 Overview

SKYNET MOLTBOOK has been enhanced with the new **MessageBroker** system to provide:
- **Reliable message delivery** with correlation tracking
- **Request/response patterns** with timeout handling  
- **Typed message payloads** for better type safety
- **Message acknowledgment** and tracking
- **100% backward compatibility** with existing MOLTBOOK API

## 🔄 Migration Strategy

### Phase 1: No Changes Required (Backward Compatibility)

Your existing MOLTBOOK code continues to work exactly as before:

```typescript
// ✅ This still works exactly the same
import { startMoltbook, registerAgent, sendMessage } from './moltbook.js';

await startMoltbook();
const agent = registerAgent({
  name: 'MyAgent',
  model: 'claude-3-sonnet', 
  goal: 'Do stuff',
  permissions: ['read']
});

sendMessage({
  type: 'direct',
  from: 'agent1',
  to: 'agent2', 
  content: 'Hello!'
});
```

**What changed under the hood:**
- Messages now route through MessageBroker for reliable delivery
- Automatic correlation ID generation for message tracking
- Enhanced error handling and retry logic
- Better memory management and cleanup

### Phase 2: Enhanced Features (Optional Upgrade)

Take advantage of new MessageBroker capabilities:

#### 1. Typed Messages

```typescript
import { sendTypedMessage } from './moltbook.js';

// Send structured data with type safety
interface TaskPayload {
  taskId: string;
  priority: 'low' | 'medium' | 'high';
  data: any;
}

await sendTypedMessage<TaskPayload>(
  'sender-id',
  'receiver-id', 
  'direct',
  {
    taskId: 'task-001',
    priority: 'high',
    data: { customers: ['alice', 'bob'] }
  }
);
```

#### 2. Request/Response Patterns

```typescript
import { sendAndWait, sendQuery } from './moltbook.js';

// Wait for single response
const result = await sendAndWait(
  'requester-id',
  'responder-id',
  { question: 'What is your status?' },
  5000 // 5 second timeout
);

// Query multiple agents
const responses = await sendQuery(
  'coordinator-id',
  ['worker1-id', 'worker2-id'], 
  { reportType: 'workload' },
  3000
);
```

#### 3. Message Acknowledgment

```typescript
import { 
  subscribeToAgent, 
  acknowledgeMessage, 
  getUnacknowledgedMessages 
} from './moltbook.js';

// Set up message handler with acknowledgment
const unsubscribe = subscribeToAgent('agent-id', async (message) => {
  console.log('Received:', message);
  
  // Process message...
  await processMessage(message);
  
  // Acknowledge completion
  await acknowledgeMessage(message.id);
});

// Check unacknowledged messages
const pending = getUnacknowledgedMessages('agent-id');
console.log(`${pending.length} messages need attention`);
```

#### 4. Enhanced Monitoring

```typescript
import { getEnhancedMoltbookState } from './moltbook.js';

const state = getEnhancedMoltbookState();
console.log({
  moltbookMessages: state.messageCount,
  messageBrokerMessages: state.messageBroker.totalMessages,
  totalMessages: state.totalMessages,
  pendingReplies: state.messageBroker.pendingReplies,
  acknowledgments: state.messageBroker.acknowledgments
});
```

### Phase 3: Advanced Integration (Power Users)

Direct MessageBroker access for advanced use cases:

```typescript
import { getMessageBroker } from './moltbook.js';
import { MessageType } from '../orchestration/types.js';

const broker = getMessageBroker();

// Use orchestration message types directly
await broker.sendMessage(
  'agent1',
  'agent2', 
  MessageType.TASK_READY,
  { 
    orchestrationType: 'advanced_workflow',
    payload: complexData 
  }
);

// Subscribe to specific orchestration message types
broker.subscribeToType('agent-id', MessageType.HEARTBEAT, async (msg) => {
  console.log('Heartbeat received:', msg);
});
```

## 🔍 Key Benefits

### Reliability
- **Guaranteed delivery** through MessageBroker infrastructure
- **Automatic retry** logic for failed messages
- **Correlation tracking** links related messages
- **Timeout handling** prevents hung operations

### Type Safety
```typescript
// Before: Untyped content
sendMessage({ 
  type: 'direct', 
  from: 'a', 
  to: 'b', 
  content: JSON.stringify({ complex: 'data' }) 
});

// After: Type-safe payloads
sendTypedMessage<TaskData>('a', 'b', 'direct', {
  taskId: 'task-001',
  priority: 'high',
  data: complexTypedData
});
```

### Request/Response
```typescript
// Before: Manual correlation
sendMessage({ type: 'query', queryId: 'q1', ... });
// ... wait for response with matching queryId

// After: Built-in correlation
const response = await sendAndWait(from, to, query, timeout);
```

### Observability
```typescript
// Before: Basic stats
const state = getMoltbookState();
console.log(`Messages: ${state.messageCount}`);

// After: Comprehensive metrics
const enhanced = getEnhancedMoltbookState();
console.log({
  totalMessages: enhanced.totalMessages,
  deliveryRate: enhanced.messageBroker.acknowledgments / enhanced.messageBroker.totalMessages,
  pendingWork: enhanced.messageBroker.pendingReplies
});
```

## 🧪 Testing Your Migration

Use the integration test as a reference:

```bash
cd /home/toba/superclaw
npm test -- src/skynet/moltbook.integration.test.ts
```

Run the usage examples:

```bash
npx ts-node src/skynet/moltbook-usage-example.ts
```

## 📋 Migration Checklist

### Immediate (No Code Changes)
- [ ] Update MOLTBOOK import (same file, enhanced features)
- [ ] Test existing functionality still works
- [ ] Monitor enhanced state for improved visibility

### Short Term (Add New Features)  
- [ ] Replace manual query/response with `sendAndWait`
- [ ] Add message acknowledgment to critical workflows
- [ ] Use typed messages for structured data
- [ ] Implement proper error handling with timeouts

### Long Term (Advanced Features)
- [ ] Use direct MessageBroker for orchestration patterns
- [ ] Implement message-based sagas for complex workflows
- [ ] Add custom message types via orchestration system
- [ ] Integrate with broader SuperClaw orchestration

## 🔧 Configuration Options

Enhanced constructor options:

```typescript
import { getMoltbook } from './moltbook.js';

const moltbook = getMoltbook();

// Configure MessageBroker behavior
const configuredMoltbook = new MoltbookBus({
  // Claude-Flow options (existing)
  topology: 'hierarchical',
  consensusAlgorithm: 'raft',
  
  // New MessageBroker options
  messageBrokerOptions: {
    maxLogSize: 50000,        // Message history size
    defaultTimeoutMs: 30000   // Default sendAndWait timeout
  }
});
```

## 🚨 Breaking Changes

**None!** This integration maintains 100% backward compatibility.

All existing MOLTBOOK APIs work exactly as before, but now with:
- Better reliability (MessageBroker delivery)
- Enhanced tracking (correlation IDs)
- Improved cleanup (automatic resource management)

## 🆘 Troubleshooting

### Message Delivery Issues
```typescript
// Check MessageBroker stats
const broker = getMessageBroker();
const stats = broker.getStats();

if (stats.pendingReplies > 0) {
  console.log('Some requests are waiting for responses');
}

if (stats.acknowledgments < stats.totalMessages) {
  console.log('Some messages remain unacknowledged'); 
}
```

### Memory Usage
```typescript
// Enhanced state shows memory impact
const state = getEnhancedMoltbookState();
console.log({
  moltbookMessages: state.messageCount,
  brokerInboxes: state.messageBroker.totalInboxes,
  subscriptions: state.messageBroker.totalSubscriptions
});

// Clean up when needed
await stopMoltbook(); // Now cleans up MessageBroker too
```

### Performance Monitoring
```typescript
// Monitor message flow
broker.on('message', (msg) => {
  console.log(`Message: ${msg.from} → ${msg.to} (${msg.type})`);
});

broker.on('acknowledged', (ack) => {
  console.log(`Acknowledged: ${ack.messageId} by ${ack.agentId}`);
});

broker.on('handler_error', (error) => {
  console.error('Message handler error:', error);
});
```

## 📈 Performance Impact

- **Minimal overhead** for existing MOLTBOOK operations
- **Improved reliability** through MessageBroker infrastructure  
- **Better memory management** with automatic cleanup
- **Enhanced observability** without performance cost
- **Scalable architecture** supports larger agent swarms

The integration adds enterprise-grade messaging capabilities while preserving the simple, familiar MOLTBOOK API that agents already know and love.