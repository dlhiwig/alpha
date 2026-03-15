# 🦊 SuperClaw Agent Mail Integration

**Gmail for your coding agents** - Inter-agent communication layer for SuperClaw using MCP Agent Mail protocol.

## Overview

The SuperClaw Agent Mail integration provides a structured communication layer for agent swarms, enabling:

- **Agent Identity Management**: Memorable names like `GreenCastle`, `BlueMountain`
- **Inter-Agent Messaging**: GitHub-flavored Markdown messages with attachments
- **File Conflict Resolution**: Advisory reservations to prevent agents stepping on each other
- **Agent Discovery**: Directory/LDAP-style queries to find collaborating agents
- **Audit Trails**: Complete communication history with git-backed persistence
- **SKYNET Integration**: Seamless integration with existing MOLTBOOK pub/sub system

## Architecture

```
SuperClaw Agent → AgentMailIntegration → AgentMailbox → MCP Agent Mail Server
                                    ↓
                              SKYNET MOLTBOOK (pub/sub)
                                    ↓
                               Audit System
```

## Quick Start

### 1. Install MCP Agent Mail Server

```bash
# Clone and install MCP Agent Mail
curl -fsSL https://raw.githubusercontent.com/steveyegge/mcp_agent_mail/main/scripts/install.sh | bash -s -- --yes
```

### 2. Basic Usage

```typescript
import { quickAgentMailSetup } from '../communication';

// Quick setup for testing
const integration = await quickAgentMailSetup({
  projectPath: '/home/toba/my-project',
  agentName: 'GreenCastle',
  mcpServerUrl: 'http://localhost:8765',
  bearerToken: 'your-bearer-token'
});

// Send a coordination message
await integration.sendMessage(
  ['BlueMountain', 'RedPond'], 
  'Task Coordination',
  'Starting work on the API layer. Please avoid touching the auth module.',
  { priority: 'high', type: 'coordination' }
);

// Reserve files to prevent conflicts
const reservations = await integration.reserveFiles(
  ['src/auth/**/*.ts', 'package.json'],
  { mode: 'exclusive', reason: 'Refactoring authentication', expiresIn: 4 }
);

// Check for messages
const messages = await integration.checkMessages({ unreadOnly: true });

// Discover other agents
const agents = await integration.discoverAgents();
```

### 3. Advanced Integration

```typescript
import { createAgentMailIntegration, IntegrationConfig } from '../communication';

const config: IntegrationConfig = {
  mcpServerUrl: 'http://localhost:8765',
  bearerToken: process.env.AGENT_MAIL_TOKEN!,
  projectPath: process.cwd(),
  agentName: 'SwarmLeader',
  agentProgram: 'SuperClaw',
  agentModel: 'Claude Opus',
  taskDescription: 'Swarm coordination and task distribution',
  
  // Integration options
  enableMoltbookBridge: true,     // Sync with SKYNET MOLTBOOK
  enableAuditIntegration: true,   // Full audit trails
  enableGitIntegration: true,     // Pre-commit file guards
  enableCrossProjectCoordination: true,
  
  // Performance settings
  syncInterval: 30000,            // Check messages every 30s
  messageBufferSize: 1000,        // Keep 1000 messages in memory
  reservationCheckInterval: 300000 // Check reservations every 5min
};

const integration = createAgentMailIntegration(config);

// Set up event listeners
integration.on('message_received', (message) => {
  console.log(`📧 New message from ${message.senderName}: ${message.subject}`);
});

integration.on('files_reserved', (reservations) => {
  console.log(`🔒 Files reserved: ${reservations.map(r => r.pathPattern).join(', ')}`);
});

integration.on('agents_discovered', (agents) => {
  console.log(`👥 Found ${agents.length} active agents`);
});

await integration.initialize();
```

## Core Features

### Agent Identity Management

Agents get memorable names and persistent identities:

```typescript
// Register with auto-generated name
const identity = await mailbox.registerAgent({
  program: 'SuperClaw',
  model: 'Claude Sonnet',
  taskDescription: 'Frontend development and UI coordination'
});
// Results in identity like: { name: 'GreenCastle', program: 'SuperClaw', ... }

// Or specify custom name
const identity = await mailbox.registerAgent({
  name: 'BlueMountain',
  taskDescription: 'Backend API development'
});
```

### Inter-Agent Messaging

Send structured messages with full Markdown support:

```typescript
// Direct message
await integration.sendMessage(
  ['RedCastle'],
  'API Contract Updated',
  `## API Changes

The user authentication endpoint has been updated:

\`\`\`typescript
interface AuthRequest {
  username: string;
  password: string;
  mfa_token?: string;  // NEW: Optional MFA
}
\`\`\`

Please update your frontend code accordingly.

**Affected files:** \`src/api/auth.ts\``,
  { 
    type: 'coordination',
    priority: 'high',
    ackRequired: true
  }
);

// Broadcast to all agents
await integration.sendMessage(
  ['broadcast'],
  'Build System Update',
  'Updated to Node.js 22. Please run `npm install` to update dependencies.',
  { type: 'broadcast', priority: 'normal' }
);
```

### File Reservation System

Prevent file conflicts with advisory reservations:

```typescript
// Reserve files exclusively
const reservations = await integration.reserveFiles(
  ['src/database/**/*.ts', 'migrations/*.sql'],
  {
    mode: 'exclusive',      // No other agent can modify
    reason: 'Database schema migration',
    expiresIn: 8           // 8 hours
  }
);

// Shared reservation (multiple agents can work)
await integration.reserveFiles(
  ['docs/**/*.md'],
  {
    mode: 'shared',
    reason: 'Documentation updates',
    expiresIn: 24
  }
);

// Advisory reservation (just a heads up)
await integration.reserveFiles(
  ['src/utils/**/*.ts'],
  {
    mode: 'advisory',
    reason: 'Utility function cleanup',
    expiresIn: 2
  }
);

// Release reservation early
await integration.releaseReservation(reservations[0].id);
```

### Agent Discovery

Find and coordinate with other agents:

```typescript
// Discover all agents in current project
const agents = await integration.discoverAgents();

agents.forEach(agent => {
  console.log(`Agent: ${agent.identity.name}`);
  console.log(`Program: ${agent.identity.program} / ${agent.identity.model}`);
  console.log(`Task: ${agent.identity.taskDescription}`);
  console.log(`Active: ${agent.isActive}`);
  console.log(`Reservations: ${agent.currentReservations.length}`);
});

// Discover agents in specific project
const backendAgents = await integration.discoverAgents('/path/to/backend');
const frontendAgents = await integration.discoverAgents('/path/to/frontend');
```

### Message Templates

Use predefined templates for common scenarios:

```typescript
import { createStandardTemplate } from '../communication';

// Coordination request
const { subject, body } = createStandardTemplate('COORDINATION_REQUEST', {
  task: 'Database Migration',
  priority: 'high',
  duration: '4 hours',
  description: 'Migrate user table to new schema with additional fields',
  files: 'src/database/**, migrations/**',
  sender: 'GreenCastle'
});

await integration.sendMessage(['BlueMountain'], subject, body);

// Task handoff
const handoff = createStandardTemplate('HANDOFF', {
  from_agent: 'GreenCastle',
  to_agent: 'RedPond',
  task: 'User Authentication Module',
  current_state: 'Basic auth implemented, need MFA integration',
  next_steps: '1. Add MFA endpoint\n2. Update frontend\n3. Write tests',
  files: 'src/auth/**, tests/auth/**',
  notes: 'Database models are ready, just need API endpoints'
});

await integration.sendMessage(['RedPond'], handoff.subject, handoff.body);
```

### Status Monitoring

Monitor swarm communication health:

```typescript
// Get current state
const state = integration.getCommunicationState();
console.log(`Health: ${state.health}`);
console.log(`Active Agents: ${state.activeAgents}`);
console.log(`Total Messages: ${state.totalMessages}`);
console.log(`Active Reservations: ${state.activeReservations}`);

// Generate detailed status report
const report = integration.generateStatusReport();
console.log(report);

// Get recent events
const events = integration.getRecentEvents(20);
events.forEach(event => {
  console.log(`${event.timestamp}: ${event.type} by ${event.agentName}`);
});
```

## Integration with SuperClaw

### SKYNET MOLTBOOK Bridge

Automatic synchronization with SuperClaw's pub/sub system:

```typescript
// Events automatically sync with MOLTBOOK when enabled
const integration = createAgentMailIntegration({
  // ... config
  enableMoltbookBridge: true
});

// Agent Mail messages trigger MOLTBOOK events
// MOLTBOOK broadcasts get forwarded to Agent Mail
// Seamless coordination between systems
```

### Audit Trail Integration

Complete communication audit with SuperClaw's audit system:

```typescript
// All Agent Mail activity gets logged to SuperClaw audit trails
const integration = createAgentMailIntegration({
  // ... config  
  enableAuditIntegration: true
});

// Audit entries include:
// - Agent registration/deregistration
// - Message sending/receiving
// - File reservations/releases
// - Discovery queries
// - Error events
```

### Git Integration

Automatic pre-commit guards for reserved files:

```typescript
const integration = createAgentMailIntegration({
  // ... config
  enableGitIntegration: true
});

// When files are reserved, git pre-commit hooks prevent conflicts:
// 1. Checks staged files against active reservations
// 2. Blocks commits to exclusively reserved files
// 3. Warns about advisory reservations
// 4. Shows which agent has the reservation
```

## Error Handling

Robust error handling with specific error types:

```typescript
import { 
  AgentMailError, 
  ReservationConflictError, 
  AgentNotFoundError,
  MessageDeliveryError 
} from '../communication';

try {
  await integration.sendMessage(['NonExistentAgent'], 'Test', 'Message');
} catch (error) {
  if (error instanceof AgentNotFoundError) {
    console.log(`Agent not found: ${error.details.agentId}`);
  } else if (error instanceof MessageDeliveryError) {
    console.log(`Failed to deliver to: ${error.failedRecipients}`);
  } else if (error instanceof ReservationConflictError) {
    console.log(`Conflict with reservations: ${error.conflictingReservations}`);
    console.log(`Suggested resolution: ${error.suggestedResolution}`);
  }
}
```

## Best Practices

### 1. Agent Naming
- Use memorable, unique names: `GreenCastle`, `BlueMountain`
- Avoid generic names: `Agent1`, `Worker`  
- Names should indicate role when possible: `DatabaseMigrator`, `FrontendBuilder`

### 2. Message Organization
- Use clear, descriptive subjects
- Structure message body with Markdown headers
- Include relevant file paths and code snippets
- Set appropriate priority levels

### 3. File Reservations
- Reserve only what you need to modify
- Use appropriate reservation modes:
  - `exclusive`: For critical modifications
  - `shared`: For parallel-safe work
  - `advisory`: For awareness only
- Set reasonable expiration times
- Release reservations early when done

### 4. Coordination Patterns
```typescript
// Good: Specific coordination
await integration.sendMessage(
  ['BackendAgent'],
  'API Contract Change',
  'Changed User.email from optional to required. Please update validation.',
  { type: 'coordination', priority: 'high', ackRequired: true }
);

// Good: Status updates
await integration.sendMessage(
  ['broadcast'],
  'Task Complete: User Authentication',
  'Authentication module is complete and tested. Ready for integration.',
  { type: 'status_update', priority: 'normal' }
);
```

### 5. Error Recovery
- Implement retry logic for transient failures
- Handle network issues gracefully
- Log errors for debugging
- Provide fallback mechanisms

## Configuration Reference

### AgentMailConfig

```typescript
interface AgentMailConfig {
  mcpServerUrl: string;            // MCP Agent Mail server URL
  bearerToken: string;             // Authentication token
  projectPath: string;             // Current project directory
  agentIdentity: Partial<AgentIdentity>; // Agent identity info
  enableMoltbookSync: boolean;     // Sync with SKYNET MOLTBOOK
  enableAuditTrail: boolean;       // Enable audit logging
  enableFileGuards: boolean;       // Enable git pre-commit guards
  reservationTimeout: number;      // Default reservation timeout (hours)
  messageRetention: number;        // Message retention period (days)
}
```

### IntegrationConfig

```typescript
interface IntegrationConfig {
  mcpServerUrl: string;
  bearerToken: string;
  projectPath: string;
  agentName?: string;
  agentProgram?: string;
  agentModel?: string;
  taskDescription?: string;
  
  enableMoltbookBridge: boolean;
  enableAuditIntegration: boolean;
  enableGitIntegration: boolean;
  enableCrossProjectCoordination: boolean;
  
  syncInterval: number;           // milliseconds
  messageBufferSize: number;
  reservationCheckInterval: number; // milliseconds
}
```

## Testing

Run the test suite:

```bash
cd /home/toba/superclaw
npm test -- src/communication/__tests__/
```

Test coverage includes:
- Agent registration and identity management
- Message sending and receiving
- File reservation conflicts
- Agent discovery
- Error handling
- MOLTBOOK integration
- Template generation

## Troubleshooting

### Common Issues

1. **Connection Failed**: Check MCP Agent Mail server is running on correct port
2. **Authentication Failed**: Verify bearer token is correct
3. **File Reservation Conflicts**: Check for overlapping path patterns
4. **Message Delivery Failed**: Ensure target agents are registered and active
5. **Git Guard Issues**: Check git hooks permissions and paths

### Debug Mode

Enable debug logging:

```typescript
const integration = createAgentMailIntegration({
  // ... config
  enableAuditIntegration: true  // Enables detailed logging
});

// Check recent events for debugging
const events = integration.getRecentEvents(100);
console.log('Recent events:', events);

// Generate status report
const report = integration.generateStatusReport();
console.log(report);
```

## Examples

See example usage in:
- `/home/toba/superclaw/src/communication/__tests__/agent-mail.test.ts`
- Integration examples in SuperClaw CLI tools
- MOLTBOOK coordination patterns in SKYNET modules

## Contributing

When extending the Agent Mail integration:

1. Follow existing patterns and interfaces
2. Add comprehensive tests for new features  
3. Update documentation and examples
4. Ensure compatibility with MCP Agent Mail protocol
5. Maintain backward compatibility with existing SuperClaw agents

## License

Part of the SuperClaw project. See main project license.