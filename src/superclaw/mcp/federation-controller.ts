/**
 * MCP Federation Controller
 * 
 * Main orchestrator for SuperClaw's federated MCP server system.
 * Manages server lifecycle, tool sharing, and cross-agent communication.
 */

// Import types conditionally for optional dependencies
type FastifyInstance = any;
type FastifyRequest = any;
type FastifyReply = any;
type SocketStream = any;
import {
  MCPFederationConfig,
  FederatedServer,
  FederatedToolCall,
  FederatedToolResult,
  MCPServerInfo,
  MCPMessage,
  MCPResponse,
  AuthConfig,
  SecurityPolicy,
  SuperClawMCPBridge,
  ToolCapability,
  ToolDiscoveryResult,
} from './types';
import { getFederatedToolRegistry, FederatedToolRegistry } from './tool-registry';
import { getToolRegistry, ToolDefinition } from '../sc-tools/registry';
import { AgentRole, ProviderName } from '../swarm/types';

export class MCPFederationController implements SuperClawMCPBridge {
  private config: MCPFederationConfig;
  private registry: FederatedToolRegistry;
  private server?: FastifyInstance;
  private isRunning = false;
  private discoveryInterval?: NodeJS.Timeout;
  private healthCheckInterval?: NodeJS.Timeout;
  
  // Bridge properties
  public localTools = new Map<string, ToolDefinition>();
  public federatedTools = new Map<string, ToolCapability>();
  public serverConnections = new Map<string, FederatedServer>();

  constructor(config: MCPFederationConfig) {
    this.config = config;
    this.registry = getFederatedToolRegistry();
    this.initializeLocalTools();
    this.setupEventHandlers();
  }

  // --- Server Lifecycle ---

  /**
   * Start the MCP federation server
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Federation controller is already running');
    }

    try {
      await this.setupFastifyServer();
      await this.startDiscovery();
      await this.startHealthChecks();
      
      this.isRunning = true;
      console.log(`MCP Federation Controller started on ${this.config.server.host}:${this.config.server.port}`);
    } catch (error: unknown) {
      console.error('Failed to start MCP Federation Controller:', error);
      throw error;
    }
  }

  /**
   * Stop the MCP federation server
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    try {
      if (this.discoveryInterval) {
        clearInterval(this.discoveryInterval);
        this.discoveryInterval = undefined;
      }

      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = undefined;
      }

      if (this.server) {
        await this.server.close();
        this.server = undefined;
      }

      this.isRunning = false;
      console.log('MCP Federation Controller stopped');
    } catch (error: unknown) {
      console.error('Error stopping MCP Federation Controller:', error);
      throw error;
    }
  }

  /**
   * Get server status
   */
  getStatus(): {
    running: boolean;
    servers: number;
    tools: number;
    uptime: number;
    metrics: any;
  } {
    return {
      running: this.isRunning,
      servers: this.serverConnections.size,
      tools: this.federatedTools.size + this.localTools.size,
      uptime: process.uptime(),
      metrics: this.registry.getMetrics(),
    };
  }

  // --- SuperClawMCPBridge Implementation ---

  /**
   * Wrap a SuperClaw tool as an MCP-compatible capability
   */
  wrapTool(tool: ToolDefinition): ToolCapability {
    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      serverId: 'local',
      category: tool.metadata?.category || 'local',
      riskLevel: tool.metadata?.riskLevel || 'medium',
    };
  }

  /**
   * Execute a federated tool call
   */
  async executeFederatedTool(call: FederatedToolCall): Promise<FederatedToolResult> {
    // Check if it's a local tool
    if (call.serverId === 'local') {
      return this.executeLocalTool(call);
    }

    // Execute on remote server
    return this.registry.executeFederatedTool(call);
  }

  /**
   * Register a local tool for sharing
   */
  shareTool(toolName: string): void {
    const localRegistry = getToolRegistry();
    const tool = localRegistry.get(toolName);
    
    if (!tool) {
      throw new Error(`Local tool '${toolName}' not found`);
    }

    this.localTools.set(toolName, tool);
    const capability = this.wrapTool(tool);
    this.federatedTools.set(toolName, capability);
    
    console.log(`Shared local tool: ${toolName}`);
  }

  /**
   * Discover tools from a remote server
   */
  async discoverTools(serverId: string): Promise<ToolDiscoveryResult> {
    const server = this.serverConnections.get(serverId);
    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }

    // This will be handled by the registry
    return this.registry['discoverServerTools'](serverId);
  }

  // --- Agent Integration ---

  /**
   * Get tools available to a specific agent role
   */
  getToolsForAgent(role: AgentRole, provider: ProviderName): ToolCapability[] {
    const allTools = this.registry.getAllTools();
    
    // Filter tools based on agent role and security policies
    return allTools.filter(tool => {
      if ('source' in tool && tool.source === 'local') {
        return true; // Local tools always available
      }
      
      const capability = tool as ToolCapability;
      
      // Apply security filtering
      if (this.config.security.blockedTools.includes(capability.name)) {
        return false;
      }
      
      if (this.config.security.allowedTools.length > 0 && 
          !this.config.security.allowedTools.includes(capability.name)) {
        return false;
      }
      
      // Role-based filtering (can be extended)
      switch (role) {
        case 'implementer':
          return capability.category !== 'admin';
        case 'critic':
          return true; // Critics can access all tools for review
        case 'researcher':
          return capability.category !== 'system';
        default:
          return capability.riskLevel !== 'high';
      }
    }) as ToolCapability[];
  }

  /**
   * Execute tool for SuperClaw agent
   */
  async executeToolForAgent(
    toolName: string,
    parameters: Record<string, unknown>,
    context: {
      agentId: string;
      sessionId: string;
      role: AgentRole;
      provider: ProviderName;
    }
  ): Promise<FederatedToolResult> {
    const requestId = `${context.sessionId}-${Date.now()}`;
    
    // Find the tool
    let serverId = 'local';
    const federatedTool = Array.from(this.federatedTools.values()).find(t => t.name === toolName);
    
    if (federatedTool) {
      serverId = federatedTool.serverId;
    }

    const call: FederatedToolCall = {
      toolName,
      serverId,
      parameters,
      context: {
        agentId: context.agentId,
        sessionId: context.sessionId,
        requestId,
        timestamp: new Date(),
      },
    };

    // Check security policies
    if (!this.isToolCallAllowed(call, context.role)) {
      return {
        success: false,
        error: 'Tool call not allowed by security policy',
        duration: 0,
        serverId,
        requestId,
      };
    }

    return this.executeFederatedTool(call);
  }

  // --- Server Management ---

  /**
   * Register a new federated server
   */
  async registerFederatedServer(
    id: string,
    endpoint: string,
    auth?: { type: 'jwt' | 'oauth2' | 'bearer'; token?: string }
  ): Promise<void> {
    const server: FederatedServer = {
      id,
      name: `Server ${id}`,
      endpoint,
      capabilities: { tools: [] },
      auth,
      health: 'healthy',
    };

    try {
      await this.registry.registerServer(server);
      this.serverConnections.set(id, server);
      
      console.log(`Registered federated server: ${id} (${endpoint})`);
    } catch (error: unknown) {
      console.error(`Failed to register server ${id}:`, error);
      throw error;
    }
  }

  /**
   * Unregister a federated server
   */
  unregisterFederatedServer(id: string): void {
    this.registry.unregisterServer(id);
    this.serverConnections.delete(id);
    
    console.log(`Unregistered federated server: ${id}`);
  }

  /**
   * List all registered servers
   */
  listServers(): FederatedServer[] {
    return Array.from(this.serverConnections.values());
  }

  // --- Private Methods ---

  private initializeLocalTools(): void {
    const localRegistry = getToolRegistry();
    const tools = localRegistry.list();
    
    for (const tool of tools) {
      this.localTools.set(tool.name, tool);
      
      // Auto-share if enabled in config
      if (this.config.federation.shareLocalTools) {
        const capability = this.wrapTool(tool);
        this.federatedTools.set(tool.name, capability);
      }
    }
    
    console.log(`Initialized ${tools.length} local tools`);
  }

  private setupEventHandlers(): void {
    this.registry.on('server_connected', (event) => {
      console.log(`Server connected: ${event.data.serverId}`);
    });

    this.registry.on('server_disconnected', (event) => {
      console.log(`Server disconnected: ${event.data.serverId}`);
    });

    this.registry.on('tool_discovered', (event) => {
      if (this.config.logging.level === 'debug') {
        console.log(`Tool discovered: ${event.data.toolName} on ${event.data.serverId}`);
      }
    });

    this.registry.on('tool_called', (event) => {
      if (this.config.logging.logRequests) {
        console.log(`Tool called: ${event.data.toolName} on ${event.data.serverId}`);
      }
    });
  }

  private async setupFastifyServer(): Promise<void> {
    const fastify = require('fastify')({ logger: this.config.logging.level !== 'error' });
    
    // Register WebSocket support
    await fastify.register(require('@fastify/websocket'));

    // CORS and security
    await fastify.register(require('@fastify/cors'), {
      origin: this.config.security.allowedOrigins,
      credentials: true,
    });

    // Rate limiting
    await fastify.register(require('@fastify/rate-limit'), {
      max: this.config.security.maxRequestsPerMinute,
      timeWindow: '1 minute',
    });

    // Routes
    this.setupRoutes(fastify);

    // Start server
    await fastify.listen({
      port: this.config.server.port,
      host: this.config.server.host,
    });

    this.server = fastify;
  }

  private setupRoutes(server: FastifyInstance): void {
    // Health check
    server.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
      return { status: 'healthy', timestamp: new Date().toISOString() };
    });

    // Server info (MCP standard)
    server.post('/info', async (request: FastifyRequest, reply: FastifyReply) => {
      const info: MCPServerInfo = {
        name: this.config.server.name,
        version: this.config.server.version,
        capabilities: {
          tools: Array.from(this.federatedTools.keys()),
          experimental: {
            federation: true,
            superclaw: true,
          },
        },
      };
      
      return this.createMCPResponse(1, info);
    });

    // List available tools
    server.post('/tools', async (request: FastifyRequest, reply: FastifyReply) => {
      const tools = Array.from(this.federatedTools.values()).map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.parameters,
        category: tool.category,
        riskLevel: tool.riskLevel,
      }));
      
      return this.createMCPResponse(1, { tools });
    });

    // Execute tool
    server.post('/tools/call', async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as any;
      const { name, arguments: args } = body.params || {};
      
      if (!name) {
        return this.createMCPError(1, -32602, 'Missing tool name');
      }

      try {
        const call: FederatedToolCall = {
          toolName: name,
          serverId: 'local', // Will be determined in executeFederatedTool
          parameters: args || {},
          context: {
            requestId: `http-${body.id || Date.now()}`,
            timestamp: new Date(),
          },
        };

        const result = await this.executeFederatedTool(call);
        
        if (result.success) {
          return this.createMCPResponse(body.id || 1, { content: result.data });
        } else {
          return this.createMCPError(body.id || 1, -32603, result.error || 'Tool execution failed');
        }
      } catch (error: unknown) {
        return this.createMCPError(
          body.id || 1,
          -32603,
          error instanceof Error ? (error as Error).message : 'Internal error'
        );
      }
    });

    // Federation endpoints
    server.get('/federation/servers', async (request: FastifyRequest, reply: FastifyReply) => {
      return Array.from(this.serverConnections.values());
    });

    server.get('/federation/metrics', async (request: FastifyRequest, reply: FastifyReply) => {
      return this.registry.getMetrics();
    });

    // WebSocket endpoint
    // @ts-expect-error - Post-Merge Reconciliation
    server.register(async function (fastify) {
      fastify.get('/ws', { websocket: true }, (connection: SocketStream) => {
        connection.socket.on('message', async (message: Buffer) => {
          try {
            const mcpMessage: MCPMessage = JSON.parse(message.toString());
            // @ts-expect-error - Post-Merge Reconciliation
            const response = await this.handleWebSocketMessage(mcpMessage);
            connection.socket.send(JSON.stringify(response));
          } catch (error: unknown) {
            // @ts-expect-error - Post-Merge Reconciliation
            const errorResponse = this.createMCPError(
              0,
              -32700,
              'Parse error'
            );
            connection.socket.send(JSON.stringify(errorResponse));
          }
        });
      });
    }.bind(this));
  }

  private async handleWebSocketMessage(message: MCPMessage): Promise<MCPResponse> {
    switch (message.method) {
      case 'initialize':
        return this.createMCPResponse(message.id, {
          protocolVersion: '1.0.0',
          serverInfo: {
            name: this.config.server.name,
            version: this.config.server.version,
          },
          capabilities: {
            tools: {},
            resources: {},
          },
        });
      
      case 'tools/list':
        const tools = Array.from(this.federatedTools.values());
        return this.createMCPResponse(message.id, { tools });
      
      default:
        return this.createMCPError(message.id, -32601, `Unknown method: ${message.method}`);
    }
  }

  private async executeLocalTool(call: FederatedToolCall): Promise<FederatedToolResult> {
    const startTime = Date.now();
    const localRegistry = getToolRegistry();
    
    try {
      const result = await localRegistry.execute(
        call.toolName,
        call.parameters,
        {
          userId: call.context.agentId,
          sessionId: call.context.sessionId,
          timestamp: call.context.timestamp,
          source: 'mcp-federation',
        }
      );

      return {
        success: result.success,
        data: result.data,
        error: result.error,
        duration: result.duration,
        serverId: 'local',
        requestId: call.context.requestId,
        metadata: {
          ...result.metadata,
          localExecution: true,
        },
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error ? (error as Error).message : String(error),
        duration: Date.now() - startTime,
        serverId: 'local',
        requestId: call.context.requestId,
      };
    }
  }

  private isToolCallAllowed(call: FederatedToolCall, role: AgentRole): boolean {
    // Check blocked tools
    if (this.config.security.blockedTools.includes(call.toolName)) {
      return false;
    }
    
    // Check allowed tools (if specified)
    if (this.config.security.allowedTools.length > 0 &&
        !this.config.security.allowedTools.includes(call.toolName)) {
      return false;
    }
    
    // Role-specific checks can be added here
    return true;
  }

  private createMCPResponse(id: string | number, result: unknown): MCPResponse {
    return {
      jsonrpc: '2.0',
      id,
      result,
    };
  }

  private createMCPError(id: string | number, code: number, message: string): MCPResponse {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
      },
    };
  }

  private async startDiscovery(): Promise<void> {
    if (!this.config.discovery.enabled) return;

    const performDiscovery = async () => {
      for (const endpoint of this.config.discovery.endpoints) {
        try {
          // Try to discover servers at known endpoints
          // This is a placeholder for actual discovery logic
          console.log(`Discovery scan: ${endpoint}`);
        } catch (error: unknown) {
          console.error(`Discovery failed for ${endpoint}:`, error);
        }
      }
    };

    // Initial discovery
    await performDiscovery();

    // Periodic discovery
    this.discoveryInterval = setInterval(performDiscovery, this.config.discovery.pollIntervalMs);
  }

  private async startHealthChecks(): Promise<void> {
    const performHealthChecks = async () => {
      for (const [serverId] of this.serverConnections) {
        try {
          await this.registry.checkServerHealth(serverId);
        } catch (error: unknown) {
          console.error(`Health check failed for ${serverId}:`, error);
        }
      }
    };

    // Initial health check
    await performHealthChecks();

    // Periodic health checks (every 30 seconds)
    this.healthCheckInterval = setInterval(performHealthChecks, 30000);
  }
}

// Factory function for creating configured controller
export function createMCPFederationController(
  config: Partial<MCPFederationConfig> = {}
): MCPFederationController {
  const defaultConfig: MCPFederationConfig = {
    server: {
      port: 8080,
      host: '0.0.0.0',
      name: 'SuperClaw MCP Federation',
      version: '1.0.0',
      maxConnections: 1000,
    },
    discovery: {
      enabled: false,
      endpoints: [],
      pollIntervalMs: 60000,
      timeoutMs: 5000,
      retryCount: 3,
    },
    auth: {
      type: 'jwt',
      secret: process.env.MCP_JWT_SECRET || 'default-secret',
      issuer: 'superclaw',
      audience: 'mcp-federation',
    },
    security: {
      allowedOrigins: ['*'],
      requireAuth: false,
      maxRequestsPerMinute: 1000,
      allowedTools: [],
      blockedTools: [],
    },
    federation: {
      enableToolSharing: true,
      enableResourceSharing: false,
      shareLocalTools: true,
      maxConcurrentCalls: 50,
    },
    logging: {
      level: 'info',
      enableMetrics: true,
      logRequests: false,
    },
  };

  const mergedConfig = { ...defaultConfig, ...config };
  return new MCPFederationController(mergedConfig);
}