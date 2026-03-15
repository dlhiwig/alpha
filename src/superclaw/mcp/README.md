# SuperClaw MCP Federation

This module integrates SuperClaw with the Model Context Protocol (MCP), enabling tool federation across agents and external systems.

## Overview

The MCP Federation system allows SuperClaw agents to:
- Share tools with other SuperClaw agents
- Discover and use tools from external MCP servers
- Expose SuperClaw tools as MCP-compliant servers
- Maintain security and authentication across federated systems

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   SuperClaw     │    │  MCP Federation │    │  External MCP   │
│    Agent A      │◄──►│   Controller    │◄──►│    Servers      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         ▲                       ▲                       ▲
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   SuperClaw     │    │  Tool Registry  │    │    Tool         │
│    Agent B      │    │   (Federated)   │    │  Discovery      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Core Components

- **FederationController**: Main orchestrator for MCP server lifecycle
- **FederatedToolRegistry**: Manages local and remote tools with discovery
- **SuperClawMCPServer**: Wraps SuperClaw tools as MCP-compliant servers
- **CLI**: Command-line interface for management and testing

## Quick Start

### 1. Basic Federation Server

```typescript
import { createBasicMCPFederation } from '@superclaw/mcp';

const federation = createBasicMCPFederation({
  server: { port: 8080, host: '127.0.0.1' }
});

await federation.start();
console.log('MCP federation running on port 8080');
```

### 2. CLI Usage

```bash
# Start federation server
npx superclaw-mcp federation --port 8080

# Serve specific tools
npx superclaw-mcp serve-tools --tools "web-search,shell" --port 8081

# List available tools
npx superclaw-mcp list-tools

# Test connection to server
npx superclaw-mcp test-connection --endpoint http://localhost:8080
```

### 3. Agent Integration

```typescript
import { getFederatedToolRegistry } from '@superclaw/mcp';

// In your SuperClaw agent
const registry = getFederatedToolRegistry();

// Execute a federated tool
const result = await registry.executeFederatedTool({
  toolName: 'web-search',
  serverId: 'external-server',
  parameters: { query: 'latest AI news' },
  context: {
    agentId: 'agent-001',
    sessionId: 'session-123',
    requestId: 'req-456',
    timestamp: new Date(),
  }
});
```

## Configuration

### Basic Configuration

```typescript
const config = {
  server: {
    port: 8080,
    host: '0.0.0.0',
    name: 'SuperClaw MCP',
    version: '1.0.0',
    maxConnections: 1000,
  },
  federation: {
    enableToolSharing: true,
    enableResourceSharing: false,
    shareLocalTools: true,
    maxConcurrentCalls: 50,
  },
  security: {
    allowedOrigins: ['*'],
    requireAuth: false,
    maxRequestsPerMinute: 1000,
    allowedTools: [],
    blockedTools: ['shell', 'exec'], // Block dangerous tools
  },
  logging: {
    level: 'info',
    enableMetrics: true,
    logRequests: true,
  },
};
```

### Secure Configuration

```typescript
const secureConfig = {
  auth: {
    type: 'jwt',
    secret: process.env.MCP_JWT_SECRET,
    issuer: 'superclaw',
    audience: 'mcp-federation',
  },
  security: {
    allowedOrigins: process.env.MCP_ALLOWED_ORIGINS?.split(',') || [],
    requireAuth: true,
    maxRequestsPerMinute: 100,
    allowedTools: ['web-search', 'file-read'], // Explicit allowlist
    blockedTools: ['shell', 'exec', 'file-write'],
  },
  discovery: {
    enabled: true,
    endpoints: process.env.MCP_DISCOVERY_ENDPOINTS?.split(',') || [],
    pollIntervalMs: 300000, // 5 minutes
    timeoutMs: 10000,
    retryCount: 3,
  },
};
```

## API Reference

### Federation Controller

#### `MCPFederationController`

Main controller class for managing MCP federation.

**Methods:**
- `start()`: Start the federation server
- `stop()`: Stop the federation server  
- `getStatus()`: Get server status and metrics
- `registerFederatedServer(id, endpoint, auth?)`: Register external server
- `executeToolForAgent(toolName, params, context)`: Execute tool for agent

#### `FederatedToolRegistry`

Registry for managing federated tools.

**Methods:**
- `registerServer(server)`: Register MCP server
- `executeFederatedTool(call)`: Execute remote tool call
- `getAllTools()`: Get all available tools (local + federated)
- `getMetrics()`: Get federation metrics

#### `SuperClawMCPServer`

Wrapper for exposing SuperClaw tools as MCP servers.

**Methods:**
- `start()`: Start the MCP server
- `stop()`: Stop the MCP server
- `getServerInfo()`: Get server information
- `getToolCapabilities()`: Get exposed tool capabilities

### Tool Execution

#### Federated Tool Call

```typescript
interface FederatedToolCall {
  toolName: string;
  serverId: string;
  parameters: Record<string, unknown>;
  context: {
    agentId?: string;
    sessionId?: string;
    requestId: string;
    timestamp: Date;
  };
}
```

#### Federated Tool Result

```typescript
interface FederatedToolResult {
  success: boolean;
  data?: any;
  error?: string;
  duration: number;
  serverId: string;
  networkLatencyMs?: number;
  requestId: string;
  metadata?: Record<string, any>;
}
```

## Security

### Authentication

The MCP federation supports multiple authentication methods:

1. **JWT**: JSON Web Tokens with configurable secrets
2. **Bearer**: Simple bearer token authentication
3. **OAuth2**: OAuth2 flow (configuration-dependent)

### Authorization

- **Tool allowlists/blocklists**: Control which tools can be accessed
- **Origin restrictions**: CORS controls for web clients
- **Rate limiting**: Requests per minute limits
- **Role-based access**: Different tool access for different agent roles

### Best Practices

1. **Use HTTPS in production**: Always encrypt traffic
2. **Rotate JWT secrets**: Regular secret rotation
3. **Principle of least privilege**: Only expose necessary tools
4. **Monitor metrics**: Track usage and failures
5. **Network isolation**: Use VPNs or private networks for internal communication

## Examples

### 1. Development Setup

```bash
# Start development federation server
npx superclaw-mcp federation --mode dev

# Start tool server for testing
npx superclaw-mcp serve-tools --tools "web-search,file-read" --port 8081

# Test the connection
npx superclaw-mcp test-connection --endpoint http://localhost:8080
```

### 2. Production Deployment

```bash
# Set environment variables
export MCP_JWT_SECRET="your-secure-secret"
export MCP_ALLOWED_ORIGINS="https://app.example.com,https://admin.example.com"
export MCP_PORT=8443

# Start secure federation server
npx superclaw-mcp federation --mode secure --host 0.0.0.0
```

### 3. Agent Integration

```typescript
import { createBasicMCPFederation, getFederatedToolRegistry } from '@superclaw/mcp';
import { AgentRole } from '@superclaw/swarm';

// Initialize federation
const federation = createBasicMCPFederation();
await federation.start();

// Register external server
await federation.registerFederatedServer(
  'external-ai-tools',
  'https://ai-tools.example.com',
  { type: 'bearer', token: 'your-api-key' }
);

// Use in agent
const registry = getFederatedToolRegistry();

async function executeAgentTask(role: AgentRole, task: string) {
  const availableTools = federation.getToolsForAgent(role, 'claude');
  
  // Execute a tool
  const result = await federation.executeToolForAgent(
    'web-search',
    { query: task },
    {
      agentId: 'agent-001',
      sessionId: 'session-123', 
      role,
      provider: 'claude',
    }
  );
  
  return result;
}
```

### 4. Custom Tool Server

```typescript
import { wrapSuperClawToolsAsMCPServer } from '@superclaw/mcp';

const server = wrapSuperClawToolsAsMCPServer({
  name: 'Custom Tool Server',
  version: '1.0.0',
  port: 8083,
  host: '127.0.0.1',
  tools: ['web-search', 'file-ops'], // Specific tools only
});

await server.start();
console.log('Custom tool server running on port 8083');
```

## Monitoring and Metrics

### Available Metrics

- `totalServers`: Number of registered servers
- `healthyServers`: Number of healthy servers  
- `totalToolCalls`: Total tool execution count
- `successfulCalls`: Successful tool executions
- `averageLatencyMs`: Average network latency
- `errorRate`: Tool execution error rate
- `topTools`: Most frequently used tools
- `serverUtilization`: Per-server usage statistics

### Accessing Metrics

```bash
# Via CLI
npx superclaw-mcp status

# Via HTTP API
curl http://localhost:8080/federation/metrics
```

```typescript
// Programmatically
const registry = getFederatedToolRegistry();
const metrics = registry.getMetrics();
console.log('Success rate:', metrics.successRate);
console.log('Top tools:', metrics.topTools);
```

## Troubleshooting

### Common Issues

1. **Connection refused**: Check if the MCP server is running and accessible
2. **Authentication failed**: Verify JWT secret or bearer token
3. **Tool not found**: Ensure tool is registered and exposed
4. **Rate limiting**: Check request rate limits in security configuration
5. **CORS errors**: Add client origin to allowedOrigins list

### Debug Mode

```bash
# Enable debug logging
npx superclaw-mcp federation --mode dev  # Automatically enables debug logs

# Or set log level directly
LOG_LEVEL=debug npx superclaw-mcp federation
```

### Health Checks

```bash
# Check server health
curl http://localhost:8080/health

# Check tool availability
curl -X POST http://localhost:8080/tools \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Contributing

The MCP federation system is designed to be extensible:

1. **New authentication methods**: Implement in `federation-controller.ts`
2. **Custom discovery protocols**: Extend the discovery system
3. **Additional security policies**: Add to the security configuration
4. **New tool wrappers**: Create custom server wrappers
5. **Protocol extensions**: Add MCP protocol extensions

See the main SuperClaw contributing guide for development setup and guidelines.