/**
 * MCP Server Wrapper
 * 
 * Wraps SuperClaw tools as standalone MCP-compliant servers
 * that can be discovered and used by other MCP clients.
 */

// Import types conditionally for optional dependencies
type FastifyInstance = any;
type SocketStream = any;
import {
  MCPServerInfo,
  MCPMessage,
  MCPResponse,
  MCPCapabilities,
  ToolCapability,
} from './types';
import { ToolDefinition, getToolRegistry } from '../sc-tools/registry';

export interface MCPServerOptions {
  name: string;
  version: string;
  port: number;
  host: string;
  tools?: string[]; // Specific tools to expose, or all if empty
  capabilities?: Partial<MCPCapabilities>;
  auth?: {
    type: 'jwt' | 'bearer';
    secret?: string;
    verify?: (token: string) => Promise<boolean>;
  };
}

export class SuperClawMCPServer {
  private options: MCPServerOptions;
  private server?: FastifyInstance;
  private exposedTools = new Map<string, ToolDefinition>();
  private isRunning = false;

  constructor(options: MCPServerOptions) {
    this.options = options;
    this.initializeTools();
  }

  /**
   * Start the MCP server
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('MCP server is already running');
    }

    const fastify = require('fastify')({ 
      logger: { level: 'info' },
    });

    await fastify.register(require('@fastify/websocket'));
    await fastify.register(require('@fastify/cors'), {
      origin: true,
      credentials: true,
    });

    this.setupRoutes(fastify);
    
    await fastify.listen({
      port: this.options.port,
      host: this.options.host,
    });

    this.server = fastify;
    this.isRunning = true;

    console.log(`SuperClaw MCP Server '${this.options.name}' started on ${this.options.host}:${this.options.port}`);
    console.log(`Exposing ${this.exposedTools.size} tools:`, Array.from(this.exposedTools.keys()).join(', '));
  }

  /**
   * Stop the MCP server
   */
  async stop(): Promise<void> {
    if (!this.isRunning || !this.server) {return;}

    await this.server.close();
    this.server = undefined;
    this.isRunning = false;

    console.log(`SuperClaw MCP Server '${this.options.name}' stopped`);
  }

  /**
   * Get server info
   */
  getServerInfo(): MCPServerInfo {
    return {
      name: this.options.name,
      version: this.options.version,
      capabilities: {
        tools: Array.from(this.exposedTools.keys()),
        ...this.options.capabilities,
      },
    };
  }

  /**
   * Get exposed tools as MCP tool capabilities
   */
  getToolCapabilities(): ToolCapability[] {
    return Array.from(this.exposedTools.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      serverId: this.options.name,
      category: tool.metadata?.category || 'superclaw',
      riskLevel: tool.metadata?.riskLevel || 'medium',
    }));
  }

  // --- Private Methods ---

  private initializeTools(): void {
    const registry = getToolRegistry();
    const availableTools = registry.list();

    if (!this.options.tools || this.options.tools.length === 0) {
      // Expose all tools
      for (const tool of availableTools) {
        this.exposedTools.set(tool.name, tool);
      }
    } else {
      // Expose only specified tools
      for (const toolName of this.options.tools) {
        const tool = registry.get(toolName);
        if (tool) {
          this.exposedTools.set(toolName, tool);
        } else {
          console.warn(`Tool '${toolName}' not found in registry`);
        }
      }
    }
  }

  private setupRoutes(server: FastifyInstance): void {
    // Health check
    server.get('/health', async () => {
      return { 
        status: 'healthy', 
        server: this.options.name,
        version: this.options.version,
        tools: this.exposedTools.size,
        timestamp: new Date().toISOString() 
      };
    });

    // MCP Info endpoint
    // @ts-expect-error - Post-Merge Reconciliation
    server.post('/info', async (request, reply) => {
      return this.createMCPResponse(1, this.getServerInfo());
    });

    // List tools (MCP standard)
    // @ts-expect-error - Post-Merge Reconciliation
    server.post('/tools/list', async (request, reply) => {
      const tools = this.getToolCapabilities().map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.parameters,
      }));

      return this.createMCPResponse(1, { tools });
    });

    // Call tool (MCP standard)
    // @ts-expect-error - Post-Merge Reconciliation
    server.post('/tools/call', async (request, reply) => {
      const body = request.body;
      const { name, arguments: args } = body.params || {};

      if (!name) {
        return this.createMCPError(body.id || 1, -32602, 'Missing tool name');
      }

      const tool = this.exposedTools.get(name);
      if (!tool) {
        return this.createMCPError(body.id || 1, -32601, `Tool '${name}' not found`);
      }

      try {
        // Execute the SuperClaw tool
        const registry = getToolRegistry();
        const result = await registry.execute(
          name,
          args || {},
          {
            userId: 'mcp-client',
            sessionId: `mcp-${Date.now()}`,
            timestamp: new Date(),
            source: 'mcp-server',
          }
        );

        if (result.success) {
          return this.createMCPResponse(body.id || 1, {
            content: [{
              type: 'text',
              text: typeof result.data === 'string' ? result.data : JSON.stringify(result.data),
            }],
            isError: false,
          });
        } else {
          return this.createMCPError(body.id || 1, -32603, result.error || 'Tool execution failed');
        }
      } catch (error: unknown) {
        console.error(`Error executing tool '${name}':`, error);
        return this.createMCPError(
          body.id || 1,
          -32603,
          error instanceof Error ? (error).message : 'Internal error'
        );
      }
    });

    // WebSocket endpoint for MCP protocol
    // @ts-expect-error - Post-Merge Reconciliation
    server.register(async function (fastify) {
      fastify.get('/mcp', { websocket: true }, (connection: SocketStream) => {
        console.log('MCP WebSocket connection established');

        connection.socket.on('message', async (message: Buffer) => {
          try {
            const mcpMessage: MCPMessage = JSON.parse(message.toString());
            // @ts-expect-error - Post-Merge Reconciliation
            const response = await this.handleMCPMessage(mcpMessage);
            connection.socket.send(JSON.stringify(response));
          } catch (error: unknown) {
            console.error('WebSocket message error:', error);
            // @ts-expect-error - Post-Merge Reconciliation
            const errorResponse = this.createMCPError(
              0,
              -32700,
              'Parse error'
            );
            connection.socket.send(JSON.stringify(errorResponse));
          }
        });

        connection.socket.on('close', () => {
          console.log('MCP WebSocket connection closed');
        });

        // @ts-expect-error - Post-Merge Reconciliation
        connection.socket.on('error', (error) => {
          console.error('MCP WebSocket error:', error);
        });
      });
    }.bind(this));
  }

  private async handleMCPMessage(message: MCPMessage): Promise<MCPResponse> {
    switch (message.method) {
      case 'initialize':
        return this.createMCPResponse(message.id, {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: this.getServerInfo(),
        });

      case 'ping':
        return this.createMCPResponse(message.id, {});

      case 'tools/list':
        const tools = this.getToolCapabilities().map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.parameters,
        }));
        return this.createMCPResponse(message.id, { tools });

      case 'tools/call':
        const { name, arguments: args } = (message.params as any) || {};
        
        if (!name) {
          return this.createMCPError(message.id, -32602, 'Missing tool name');
        }

        try {
          const tool = this.exposedTools.get(name);
          if (!tool) {
            return this.createMCPError(message.id, -32601, `Tool '${name}' not found`);
          }

          const registry = getToolRegistry();
          const result = await registry.execute(
            name,
            args || {},
            {
              userId: 'mcp-websocket',
              sessionId: `ws-${Date.now()}`,
              timestamp: new Date(),
              source: 'mcp-websocket',
            }
          );

          if (result.success) {
            return this.createMCPResponse(message.id, {
              content: [{
                type: 'text',
                text: typeof result.data === 'string' ? result.data : JSON.stringify(result.data),
              }],
              isError: false,
            });
          } else {
            return this.createMCPError(message.id, -32603, result.error || 'Tool execution failed');
          }
        } catch (error: unknown) {
          return this.createMCPError(
            message.id,
            -32603,
            error instanceof Error ? (error).message : 'Internal error'
          );
        }

      default:
        return this.createMCPError(message.id, -32601, `Unknown method: ${message.method}`);
    }
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
}

/**
 * Wrap SuperClaw tools as a standalone MCP server
 */
export function wrapSuperClawToolsAsMCPServer(options: MCPServerOptions): SuperClawMCPServer {
  return new SuperClawMCPServer(options);
}

/**
 * Create and start a standalone MCP server with SuperClaw tools
 */
export async function createStandaloneMCPServer(options: MCPServerOptions): Promise<SuperClawMCPServer> {
  const server = new SuperClawMCPServer(options);
  await server.start();
  return server;
}

/**
 * Create a lightweight MCP server for specific tools
 */
export async function createToolSpecificMCPServer(
  toolNames: string[],
  port = 8081,
  name = 'SuperClaw Tool Server'
): Promise<SuperClawMCPServer> {
  const options: MCPServerOptions = {
    name,
    version: '1.0.0',
    port,
    host: '127.0.0.1',
    tools: toolNames,
  };

  return createStandaloneMCPServer(options);
}

/**
 * Create an MCP server that exposes all SuperClaw tools
 */
export async function createFullSuperClawMCPServer(
  port = 8082,
  name = 'SuperClaw All Tools'
): Promise<SuperClawMCPServer> {
  const options: MCPServerOptions = {
    name,
    version: '1.0.0',
    port,
    host: '127.0.0.1',
    // tools: undefined means all tools
  };

  return createStandaloneMCPServer(options);
}