// @ts-nocheck
/**
 * OpenBrowser MCP Server Integration
 * 
 * Manages the OpenBrowser MCP server lifecycle and integrates it
 * with SuperClaw's federated tool system.
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { getFederatedToolRegistry } from '../tool-registry';
import { FederatedServer, MCPMessage, MCPResponse, ToolCapability } from '../types';
import { openBrowserServerConfig } from '../servers/openbrowser';

export interface OpenBrowserServerOptions {
  headless?: boolean;
  allowedDomains?: string;
  timeout?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  stealth?: boolean;
  autoStart?: boolean;
  maxRetries?: number;
}

export interface OpenBrowserServerStatus {
  running: boolean;
  healthy: boolean;
  lastHeartbeat?: Date;
  processId?: number;
  uptime?: number;
  toolsAvailable: number;
  executionCount: number;
  errorCount: number;
}

/**
 * OpenBrowser MCP Server Manager
 * 
 * Handles the lifecycle of OpenBrowser MCP server process and provides
 * integration with SuperClaw's federated tool registry.
 */
export class OpenBrowserMCPServerManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private messageId = 0;
  private pendingRequests = new Map<number, {
    resolve: (value: any) => void;
    reject: (error: any) => void;
    timeout: NodeJS.Timeout;
  }>();
  private isInitialized = false;
  private isHealthy = false;
  private options: Required<OpenBrowserServerOptions>;
  private registry = getFederatedToolRegistry();
  private serverId = 'openbrowser-mcp';
  private startTime?: Date;
  private executionCount = 0;
  private errorCount = 0;
  private heartbeatInterval?: NodeJS.Timeout;

  constructor(options: OpenBrowserServerOptions = {}) {
    super();
    
    this.options = {
      headless: true,
      allowedDomains: '',
      timeout: 30000,
      viewportWidth: 1920,
      viewportHeight: 1080,
      stealth: false,
      autoStart: false,
      maxRetries: 3,
      ...options,
    };

    if (this.options.autoStart) {
      this.start().catch(err => {
        console.error('Failed to auto-start OpenBrowser MCP server:', err);
      });
    }
  }

  // --- Server Lifecycle ---

  /**
   * Start the OpenBrowser MCP server
   */
  async start(): Promise<void> {
    if (this.isInitialized) {
      throw new Error('OpenBrowser MCP server is already running');
    }

    console.log('Starting OpenBrowser MCP server...');

    return new Promise((resolve, reject) => {
      let retryCount = 0;
      
      const attemptStart = () => {
        try {
          this.process = spawn('uvx', ['openbrowser-ai[mcp]', '--mcp'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
              ...process.env,
              OPENBROWSER_HEADLESS: this.options.headless.toString(),
              OPENBROWSER_ALLOWED_DOMAINS: this.options.allowedDomains,
              OPENBROWSER_VIEWPORT_WIDTH: this.options.viewportWidth.toString(),
              OPENBROWSER_VIEWPORT_HEIGHT: this.options.viewportHeight.toString(),
              OPENBROWSER_STEALTH: this.options.stealth.toString(),
              OPENBROWSER_TIMEOUT: this.options.timeout.toString(),
              OPENBROWSER_LOGGING_LEVEL: 'critical',
              OPENBROWSER_SETUP_LOGGING: 'false',
            }
          });

          if (!this.process.stdout || !this.process.stdin || !this.process.stderr) {
            throw new Error('Failed to create OpenBrowser MCP server process streams');
          }

          this.setupProcessHandlers();
          this.initializeServer()
            .then(() => {
              this.startTime = new Date();
              this.startHeartbeat();
              resolve();
            })
            .catch(error => {
              if (retryCount < this.options.maxRetries) {
                retryCount++;
                console.log(`OpenBrowser MCP server start failed, retrying (${retryCount}/${this.options.maxRetries})...`);
                setTimeout(attemptStart, 1000 * retryCount);
              } else {
                reject(error);
              }
            });

        } catch (error: unknown) {
          if (retryCount < this.options.maxRetries) {
            retryCount++;
            console.log(`OpenBrowser MCP server start failed, retrying (${retryCount}/${this.options.maxRetries})...`);
            setTimeout(attemptStart, 1000 * retryCount);
          } else {
            reject(error);
          }
        }
      };

      attemptStart();
    });
  }

  /**
   * Stop the OpenBrowser MCP server
   */
  async stop(): Promise<void> {
    console.log('Stopping OpenBrowser MCP server...');

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }

    // Clear pending requests
    for (const [id, { reject, timeout }] of this.pendingRequests) {
      clearTimeout(timeout);
      reject(new Error('Server shutting down'));
    }
    this.pendingRequests.clear();

    if (this.process) {
      return new Promise<void>((resolve) => {
        const cleanup = () => {
          this.process = null;
          this.isInitialized = false;
          this.isHealthy = false;
          this.startTime = undefined;
          resolve();
        };

        if (this.process?.killed) {
          cleanup();
          return;
        }

        this.process?.once('exit', cleanup);
        this.process?.kill('SIGTERM');

        // Force kill after 5 seconds
        setTimeout(() => {
          if (this.process && !this.process.killed) {
            console.warn('Force killing OpenBrowser MCP server process');
            this.process.kill('SIGKILL');
          }
        }, 5000);
      });
    }

    this.isInitialized = false;
    this.isHealthy = false;
  }

  /**
   * Restart the OpenBrowser MCP server
   */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /**
   * Get server status
   */
  getStatus(): OpenBrowserServerStatus {
    return {
      running: this.isInitialized,
      healthy: this.isHealthy,
      lastHeartbeat: this.isHealthy ? new Date() : undefined,
      processId: this.process?.pid,
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
      toolsAvailable: 1, // execute_code tool
      executionCount: this.executionCount,
      errorCount: this.errorCount,
    };
  }

  // --- Tool Execution ---

  /**
   * Execute Python code via OpenBrowser MCP
   */
  async executeCode(code: string): Promise<{
    success: boolean;
    output?: string;
    error?: string;
    executionTime: number;
  }> {
    if (!this.isInitialized || !this.isHealthy) {
      throw new Error('OpenBrowser MCP server is not ready');
    }

    const startTime = Date.now();
    this.executionCount++;

    try {
      const response = await this.sendMessage({
        method: 'tools/call',
        params: {
          name: 'execute_code',
          arguments: { code }
        }
      });

      const executionTime = Date.now() - startTime;

      if (response.isError === false) {
        this.emit('execution_success', { code, output: response.content, executionTime });
        
        return {
          success: true,
          output: response.content?.[0]?.text || '',
          executionTime
        };
      } else {
        this.errorCount++;
        this.emit('execution_error', { code, error: response.content, executionTime });
        
        return {
          success: false,
          error: response.content?.[0]?.text || 'Unknown error',
          executionTime
        };
      }
    } catch (error: unknown) {
      const executionTime = Date.now() - startTime;
      this.errorCount++;
      
      const errorMessage = error instanceof Error ? (error).message : String(error);
      this.emit('execution_error', { code, error: errorMessage, executionTime });
      
      return {
        success: false,
        error: errorMessage,
        executionTime
      };
    }
  }

  // --- Federation Integration ---

  /**
   * Register this server with SuperClaw's federated tool registry
   */
  async registerWithFederation(): Promise<void> {
    const server: FederatedServer = {
      id: this.serverId,
      name: 'OpenBrowser MCP',
      endpoint: 'stdio://openbrowser-ai[mcp]',
      capabilities: {
        tools: ['execute_code'],
        experimental: {
          codeExecution: true,
          browserAutomation: true,
          tokenEfficiency: 'extreme'
        }
      },
      health: this.isHealthy ? 'healthy' : 'offline',
      lastPing: new Date(),
    };

    try {
      await this.registry.registerServer(server);
      
      // Register the execute_code tool capability
      const toolCapability: ToolCapability = {
        name: 'browser_execute',
        description: openBrowserServerConfig.tools[0].description,
        parameters: openBrowserServerConfig.tools[0].inputSchema,
        serverId: this.serverId,
        category: 'browser',
        riskLevel: 'medium',
      };

      // @ts-expect-error - Post-Merge Reconciliation
      await this.registry.registerTool(toolCapability);
      
      console.log('OpenBrowser MCP server registered with federation');
      this.emit('federation_registered');
      
    } catch (error: unknown) {
      console.error('Failed to register OpenBrowser MCP server with federation:', error);
      this.emit('federation_error', error);
      throw error;
    }
  }

  /**
   * Unregister from SuperClaw's federated tool registry
   */
  async unregisterFromFederation(): Promise<void> {
    try {
      await this.registry.unregisterServer(this.serverId);
      console.log('OpenBrowser MCP server unregistered from federation');
      this.emit('federation_unregistered');
    } catch (error: unknown) {
      console.error('Failed to unregister OpenBrowser MCP server from federation:', error);
    }
  }

  // --- Private Methods ---

  private setupProcessHandlers(): void {
    if (!this.process || !this.process.stdout || !this.process.stderr) {
      throw new Error('Process streams not available');
    }

    // Handle stdout (JSON-RPC responses)
    let buffer = '';
    this.process.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      
      // Process complete JSON messages
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer
      
      for (const line of lines) {
        if (line.trim()) {
          try {
            const response: MCPResponse = JSON.parse(line);
            this.handleResponse(response);
          } catch (err) {
            console.error('Failed to parse OpenBrowser MCP response:', line, err);
          }
        }
      }
    });

    // Handle stderr (logs, errors)
    this.process.stderr.on('data', (chunk: Buffer) => {
      const message = chunk.toString().trim();
      if (message) {
        console.warn('[OpenBrowser MCP]', message);
        this.emit('server_log', message);
      }
    });

    // Handle process exit
    this.process.on('exit', (code) => {
      console.log(`OpenBrowser MCP process exited with code ${code}`);
      this.isInitialized = false;
      this.isHealthy = false;
      this.process = null;
      this.emit('server_exit', code);
    });

    // Handle process errors
    this.process.on('error', (error) => {
      console.error('OpenBrowser MCP process error:', error);
      this.isHealthy = false;
      this.emit('server_error', error);
    });
  }

  private async initializeServer(): Promise<void> {
    try {
      const initResponse = await this.sendMessage({
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {
            roots: { listChanged: false },
            sampling: {}
          },
          clientInfo: {
            name: 'SuperClaw',
            version: '1.0.0'
          }
        }
      });

      console.log('OpenBrowser MCP server initialized:', initResponse);
      
      this.isInitialized = true;
      this.isHealthy = true;
      this.emit('server_ready');

      // Register with federation
      await this.registerWithFederation();

    } catch (error: unknown) {
      this.isInitialized = false;
      this.isHealthy = false;
      throw error;
    }
  }

  private async sendMessage(message: Omit<MCPMessage, 'jsonrpc' | 'id'>): Promise<any> {
    if (!this.process?.stdin) {
      throw new Error('OpenBrowser MCP server not initialized');
    }

    const id = ++this.messageId;
    const fullMessage: MCPMessage = {
      jsonrpc: '2.0',
      id,
      ...message
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('Request timeout'));
      }, this.options.timeout);

      this.pendingRequests.set(id, { resolve, reject, timeout });
      
      const messageStr = JSON.stringify(fullMessage) + '\n';
      this.process!.stdin!.write(messageStr);
    });
  }

  private handleResponse(response: MCPResponse): void {
    const request = this.pendingRequests.get(response.id as number);
    if (!request) {return;}

    const { resolve, reject, timeout } = request;
    this.pendingRequests.delete(response.id as number);
    clearTimeout(timeout);

    if (response.error) {
      // @ts-expect-error - Post-Merge Reconciliation
      reject(new Error(response.error));
    } else {
      resolve(response.result);
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(async () => {
      try {
        // Simple health check by executing a basic command
        await this.executeCode('print("heartbeat")');
        this.isHealthy = true;
      } catch (error: unknown) {
        this.isHealthy = false;
        console.warn('OpenBrowser MCP server health check failed:', error);
      }
    }, 30000); // Every 30 seconds
  }
}

// --- Factory Functions ---

/**
 * Create OpenBrowser MCP server manager with default options
 */
export function createOpenBrowserServer(options?: OpenBrowserServerOptions): OpenBrowserMCPServerManager {
  return new OpenBrowserMCPServerManager(options);
}

/**
 * Create and start OpenBrowser MCP server
 */
export async function startOpenBrowserServer(options?: OpenBrowserServerOptions): Promise<OpenBrowserMCPServerManager> {
  const server = createOpenBrowserServer(options);
  await server.start();
  return server;
}

/**
 * Global server instance for singleton usage
 */
let globalOpenBrowserServer: OpenBrowserMCPServerManager | null = null;

/**
 * Get or create global OpenBrowser MCP server instance
 */
export function getGlobalOpenBrowserServer(options?: OpenBrowserServerOptions): OpenBrowserMCPServerManager {
  if (!globalOpenBrowserServer) {
    globalOpenBrowserServer = createOpenBrowserServer({
      autoStart: true,
      ...options,
    });

    // Auto-restart on exit
    globalOpenBrowserServer.on('server_exit', () => {
      console.log('Global OpenBrowser MCP server exited, restarting...');
      setTimeout(() => {
        globalOpenBrowserServer?.start().catch(err => {
          console.error('Failed to restart global OpenBrowser MCP server:', err);
        });
      }, 5000);
    });
  }

  return globalOpenBrowserServer;
}

/**
 * Shutdown global OpenBrowser MCP server
 */
export async function shutdownGlobalOpenBrowserServer(): Promise<void> {
  if (globalOpenBrowserServer) {
    await globalOpenBrowserServer.stop();
    await globalOpenBrowserServer.unregisterFromFederation();
    globalOpenBrowserServer = null;
  }
}

export default OpenBrowserMCPServerManager;