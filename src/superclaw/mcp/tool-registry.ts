/**
 * Federated MCP Tool Registry
 * 
 * Manages both local SuperClaw tools and federated MCP tools,
 * providing a unified interface for tool discovery and execution.
 */

import {
  ToolCapability,
  FederatedServer,
  FederatedToolCall,
  FederatedToolResult,
  ToolDiscoveryResult,
  MCPEvent,
  MCPEventHandler,
  FederationMetrics,
  MCPEventType,
} from './types';
import { ToolDefinition, getToolRegistry } from '../sc-tools/registry';

export class FederatedToolRegistry {
  private federatedTools = new Map<string, ToolCapability>();
  private serverConnections = new Map<string, FederatedServer>();
  private eventHandlers = new Map<MCPEventType, MCPEventHandler[]>();
  private metrics: FederationMetrics;
  private callHistory: Array<{
    tool: string;
    server: string;
    timestamp: Date;
    success: boolean;
    latencyMs: number;
  }> = [];

  constructor() {
    this.metrics = this.initializeMetrics();
    this.startMetricsCollection();
  }

  // --- Server Management ---

  /**
   * Register a federated MCP server
   */
  async registerServer(server: FederatedServer): Promise<void> {
    this.serverConnections.set(server.id, server);
    
    // Discover tools from the server
    try {
      const discoveryResult = await this.discoverServerTools(server.id);
      this.registerDiscoveredTools(discoveryResult);
      
      this.emit('server_connected', { serverId: server.id });
    } catch (error: unknown) {
      server.health = 'offline';
      this.emit('server_disconnected', { 
        serverId: server.id, 
        error: error instanceof Error ? (error).message : String(error) 
      });
      throw error;
    }
  }

  /**
   * Unregister a federated server and its tools
   */
  unregisterServer(serverId: string): void {
    const server = this.serverConnections.get(serverId);
    if (!server) {return;}

    // Remove all tools from this server
    for (const [toolName, tool] of this.federatedTools.entries()) {
      if (tool.serverId === serverId) {
        this.federatedTools.delete(toolName);
      }
    }

    this.serverConnections.delete(serverId);
    this.emit('server_disconnected', { serverId });
  }

  /**
   * Get server by ID
   */
  getServer(serverId: string): FederatedServer | undefined {
    return this.serverConnections.get(serverId);
  }

  /**
   * List all registered servers
   */
  getServers(): FederatedServer[] {
    return Array.from(this.serverConnections.values());
  }

  /**
   * Check server health
   */
  async checkServerHealth(serverId: string): Promise<boolean> {
    const server = this.serverConnections.get(serverId);
    if (!server) {return false;}

    try {
      const response = await fetch(`${server.endpoint}/health`, {
        method: 'GET',
        headers: this.getAuthHeaders(server),
        signal: AbortSignal.timeout(5000),
      });
      
      const isHealthy = response.ok;
      server.health = isHealthy ? 'healthy' : 'degraded';
      server.lastPing = new Date();
      
      this.emit('health_check', { 
        serverId, 
        healthy: isHealthy, 
        status: response.status 
      });
      
      return isHealthy;
    } catch (error: unknown) {
      server.health = 'offline';
      server.lastPing = new Date();
      
      this.emit('health_check', { 
        serverId, 
        healthy: false, 
        error: error instanceof Error ? (error).message : String(error) 
      });
      
      return false;
    }
  }

  // --- Tool Discovery ---

  /**
   * Discover tools from a federated server
   */
  private async discoverServerTools(serverId: string): Promise<ToolDiscoveryResult> {
    const server = this.serverConnections.get(serverId);
    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }

    try {
      const response = await fetch(`${server.endpoint}/tools`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeaders(server),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const mcpResponse = await response.json();
      // @ts-expect-error - Post-Merge Reconciliation
      if (mcpResponse.error) {
        // @ts-expect-error - Post-Merge Reconciliation
        throw new Error(`MCP Error: ${mcpResponse.error}`);
      }

      // @ts-expect-error - Post-Merge Reconciliation
      const tools: ToolCapability[] = (mcpResponse.result?.tools || []).map((tool: any) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema || { type: 'object', properties: {} },
        serverId,
        category: tool.category || 'federated',
        riskLevel: tool.riskLevel || 'medium',
      }));

      return {
        serverId,
        tools,
        timestamp: new Date(),
        version: server.capabilities.experimental?.version as string || '1.0.0',
      };
    } catch (error: unknown) {
      this.emit('auth_failed', { serverId, error: error instanceof Error ? (error).message : String(error) });
      throw error;
    }
  }

  /**
   * Register discovered tools
   */
  private registerDiscoveredTools(discovery: ToolDiscoveryResult): void {
    for (const tool of discovery.tools) {
      const toolKey = `${tool.serverId}:${tool.name}`;
      this.federatedTools.set(toolKey, tool);
      
      this.emit('tool_discovered', { 
        serverId: discovery.serverId, 
        toolName: tool.name,
        category: tool.category 
      });
    }
  }

  // --- Tool Execution ---

  /**
   * Execute a federated tool call
   */
  async executeFederatedTool(call: FederatedToolCall): Promise<FederatedToolResult> {
    const startTime = Date.now();
    const toolKey = `${call.serverId}:${call.toolName}`;
    const tool = this.federatedTools.get(toolKey);
    const server = this.serverConnections.get(call.serverId);

    if (!tool) {
      return this.createErrorResult(call, 'Tool not found', startTime);
    }

    if (!server) {
      return this.createErrorResult(call, 'Server not found', startTime);
    }

    if (server.health === 'offline') {
      return this.createErrorResult(call, 'Server is offline', startTime);
    }

    try {
      this.emit('tool_called', { 
        serverId: call.serverId, 
        toolName: call.toolName,
        requestId: call.context.requestId 
      });

      const response = await fetch(`${server.endpoint}/tools/call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeaders(server),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: call.context.requestId,
          method: 'tools/call',
          params: {
            name: call.toolName,
            arguments: call.parameters,
          },
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const mcpResponse = await response.json();
      const duration = Date.now() - startTime;

      // @ts-expect-error - Post-Merge Reconciliation
      if (mcpResponse.error) {
        // @ts-expect-error - Post-Merge Reconciliation
        return this.createErrorResult(call, mcpResponse.error, startTime);
      }

      const result: FederatedToolResult = {
        success: true,
        // @ts-expect-error - Post-Merge Reconciliation
        data: mcpResponse.result?.content || mcpResponse.result,
        duration,
        serverId: call.serverId,
        networkLatencyMs: duration,
        requestId: call.context.requestId,
        metadata: {
          tool: call.toolName,
          server: call.serverId,
          timestamp: call.context.timestamp,
        },
      };

      this.recordCall(call.toolName, call.serverId, true, duration);
      this.emit('tool_result', { 
        serverId: call.serverId, 
        toolName: call.toolName,
        success: true,
        duration 
      });

      return result;
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      this.recordCall(call.toolName, call.serverId, false, duration);
      
      return this.createErrorResult(call, error instanceof Error ? (error).message : String(error), startTime);
    }
  }

  /**
   * Get all available tools (local + federated)
   */
  getAllTools(): Array<ToolCapability | { name: string; description: string; source: 'local' }> {
    const localRegistry = getToolRegistry();
    const localTools = localRegistry.list().map(tool => ({
      name: tool.name,
      description: tool.description,
      source: 'local' as const,
    }));

    const federatedTools = Array.from(this.federatedTools.values());

    return [...localTools, ...federatedTools];
  }

  /**
   * Get federated tools only
   */
  getFederatedTools(): ToolCapability[] {
    return Array.from(this.federatedTools.values());
  }

  /**
   * Get tools by category
   */
  getToolsByCategory(category: string): ToolCapability[] {
    return Array.from(this.federatedTools.values()).filter(
      tool => tool.category === category
    );
  }

  /**
   * Get tools by server
   */
  getToolsByServer(serverId: string): ToolCapability[] {
    return Array.from(this.federatedTools.values()).filter(
      tool => tool.serverId === serverId
    );
  }

  // --- Event System ---

  /**
   * Subscribe to MCP events
   */
  on(eventType: MCPEventType, handler: MCPEventHandler): void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, []);
    }
    this.eventHandlers.get(eventType)!.push(handler);
  }

  /**
   * Unsubscribe from MCP events
   */
  off(eventType: MCPEventType, handler: MCPEventHandler): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * Emit MCP event
   */
  private emit(type: MCPEventType, data: Record<string, unknown> = {}): void {
    const event: MCPEvent = {
      type,
      timestamp: new Date(),
      data,
    };

    const handlers = this.eventHandlers.get(type) || [];
    for (const handler of handlers) {
      try {
        handler(event);
      } catch (error: unknown) {
        console.error(`Error in MCP event handler for ${type}:`, error);
      }
    }
  }

  // --- Metrics ---

  /**
   * Get federation metrics
   */
  getMetrics(): FederationMetrics {
    return { ...this.metrics };
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = this.initializeMetrics();
    this.callHistory = [];
  }

  // --- Private Methods ---

  private initializeMetrics(): FederationMetrics {
    return {
      totalServers: 0,
      healthyServers: 0,
      totalToolCalls: 0,
      successfulCalls: 0,
      averageLatencyMs: 0,
      errorRate: 0,
      topTools: [],
      serverUtilization: {},
    };
  }

  private startMetricsCollection(): void {
    // Update metrics every 30 seconds
    setInterval(() => {
      this.updateMetrics();
    }, 30000);
  }

  private updateMetrics(): void {
    const servers = Array.from(this.serverConnections.values());
    
    this.metrics.totalServers = servers.length;
    this.metrics.healthyServers = servers.filter(s => s.health === 'healthy').length;
    
    const recentCalls = this.callHistory.slice(-1000); // Last 1000 calls
    this.metrics.totalToolCalls = recentCalls.length;
    this.metrics.successfulCalls = recentCalls.filter(c => c.success).length;
    
    if (recentCalls.length > 0) {
      this.metrics.averageLatencyMs = recentCalls.reduce((sum, call) => sum + call.latencyMs, 0) / recentCalls.length;
      this.metrics.errorRate = (recentCalls.length - this.metrics.successfulCalls) / recentCalls.length;
    }
    
    // Top tools by usage
    const toolCounts = new Map<string, number>();
    for (const call of recentCalls) {
      toolCounts.set(call.tool, (toolCounts.get(call.tool) || 0) + 1);
    }
    
    this.metrics.topTools = Array.from(toolCounts.entries())
      .map(([name, calls]) => ({ name, calls }))
      .toSorted((a, b) => b.calls - a.calls)
      .slice(0, 10);
    
    // Server utilization
    const serverCounts = new Map<string, number>();
    for (const call of recentCalls) {
      serverCounts.set(call.server, (serverCounts.get(call.server) || 0) + 1);
    }
    
    this.metrics.serverUtilization = Object.fromEntries(serverCounts);
  }

  private recordCall(tool: string, server: string, success: boolean, latencyMs: number): void {
    this.callHistory.push({
      tool,
      server,
      timestamp: new Date(),
      success,
      latencyMs,
    });

    // Keep only last 5000 calls
    if (this.callHistory.length > 5000) {
      this.callHistory.splice(0, this.callHistory.length - 5000);
    }
  }

  private createErrorResult(call: FederatedToolCall, error: string, startTime: number): FederatedToolResult {
    const duration = Date.now() - startTime;
    
    this.emit('tool_result', { 
      serverId: call.serverId, 
      toolName: call.toolName,
      success: false,
      error,
      duration 
    });

    return {
      success: false,
      error,
      duration,
      serverId: call.serverId,
      requestId: call.context.requestId,
      metadata: {
        tool: call.toolName,
        server: call.serverId,
        timestamp: call.context.timestamp,
      },
    };
  }

  private getAuthHeaders(server: FederatedServer): Record<string, string> {
    if (!server.auth) {return {};}

    switch (server.auth.type) {
      case 'bearer':
        return server.auth.token ? { Authorization: `Bearer ${server.auth.token}` } : {};
      case 'jwt':
        return server.auth.token ? { Authorization: `Bearer ${server.auth.token}` } : {};
      default:
        return {};
    }
  }
}

// Singleton instance
let federatedRegistry: FederatedToolRegistry | null = null;

export function getFederatedToolRegistry(): FederatedToolRegistry {
  if (!federatedRegistry) {
    federatedRegistry = new FederatedToolRegistry();
  }
  return federatedRegistry;
}