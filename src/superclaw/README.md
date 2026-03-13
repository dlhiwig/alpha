# SuperClaw Integration

SuperClaw provides intelligent task routing for OpenClaw, directing tasks to the most appropriate model based on complexity.

## Quick Start

### 1. Import the router in your agent config

```typescript
import { classifyTask, getSuggestedModel } from './superclaw';

// Before calling the agent, classify the task
const classification = await classifyTask(userMessage);
const model = getSuggestedModel(classification);
```

### 2. Use the gateway hook (recommended)

```typescript
import { createGatewayHook } from './superclaw/gateway-hook';
import { createSuperClawBridge } from './superclaw/bridge';

const bridge = createSuperClawBridge({
  enableSwarm: false, // Until claude-flow is installed
  modelMapping: {
    simple: 'anthropic/claude-haiku',
    medium: 'anthropic/claude-sonnet-4',
    complex: 'anthropic/claude-opus-4-5',
  },
});

const hook = createGatewayHook(bridge, { logDecisions: true });
```

### 3. Classification Logic

Tasks are classified as:

- **Simple** (< 50 tokens, no code/analysis): Use cheapest model
- **Medium** (50-200 tokens, some complexity): Use balanced model
- **Complex** (> 200 tokens, code/analysis/multi-step): Use best model or swarm

## Files

- `types.ts` — Type definitions
- `router.ts` — Task classification logic
- `bridge.ts` — Main bridge class
- `gateway-hook.ts` — OpenClaw gateway integration
- `swarm-bridge.ts` — Claude-Flow swarm integration (when available)

## Testing

```bash
cd /home/toba/openclaw
npm test src/superclaw/bridge.test.ts
```

## Status

- ✅ Router and classification working
- ✅ Gateway hooks ready
- ⏳ Claude-Flow integration (pending npm install)
- 📋 ruvector memory (Phase 2)
- 📋 SAFLA feedback loops (Phase 3)
