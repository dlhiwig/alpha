// @ts-nocheck
/**
 * MCP Federation Types for SuperClaw
 * 
 * Types for integrating SuperClaw's tool registry with federated MCP servers.
 */

import { ToolDefinition, ToolExecutionResult } from '../sc-tools/registry';

// --- Core MCP Types ---

export interface MCPCapabilities {
  tools?: string[];
  resources?: string[];
  prompts?: string[];
  experimental?: Record<string, unknown>;
}

export interface MCPServerInfo {
  name: string;
  version: string;
  capabilities: MCPCapabilities;
}

export interface MCPMessage {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// --- Federation Types ---

export interface FederatedServer {
  id: string;
  name: string;
  endpoint: string;
  capabilities: MCPCapabilities;
  auth?: {
    type: 'jwt' | 'oauth2' | 'bearer';
    token?: string;
    config?: Record<string, unknown>;
  };
  health: 'healthy' | 'degraded' | 'offline';
  lastPing?: Date;
}

export interface ToolCapability {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  serverId: string;
  category?: string;
  riskLevel?: 'low' | 'medium' | 'high';
}

export interface FederatedToolCall {
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

export interface FederatedToolResult extends ToolExecutionResult {
  serverId: string;
  networkLatencyMs?: number;
  requestId: string;
}

// --- Discovery Types ---

export interface ServerDiscoveryConfig {
  enabled: boolean;
  endpoints: string[];
  pollIntervalMs: number;
  timeoutMs: number;
  retryCount: number;
}

export interface ToolDiscoveryResult {
  serverId: string;
  tools: ToolCapability[];
  timestamp: Date;
  version: string;
}

// --- Security Types ---

export interface AuthConfig {
  type: 'jwt' | 'oauth2' | 'bearer';
  secret?: string;
  issuer?: string;
  audience?: string;
  tokenEndpoint?: string;
  clientId?: string;
  clientSecret?: string;
}

export interface SecurityPolicy {
  allowedOrigins: string[];
  requireAuth: boolean;
  maxRequestsPerMinute: number;
  allowedTools: string[];
  blockedTools: string[];
}

// --- Configuration Types ---

export interface MCPFederationConfig {
  server: {
    port: number;
    host: string;
    name: string;
    version: string;
    maxConnections: number;
  };
  discovery: ServerDiscoveryConfig;
  auth: AuthConfig;
  security: SecurityPolicy;
  federation: {
    enableToolSharing: boolean;
    enableResourceSharing: boolean;
    shareLocalTools: boolean;
    maxConcurrentCalls: number;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    enableMetrics: boolean;
    logRequests: boolean;
  };
}

// --- Event Types ---

export type MCPEventType = 
  | 'server_connected'
  | 'server_disconnected'
  | 'tool_discovered'
  | 'tool_called'
  | 'tool_result'
  | 'auth_failed'
  | 'health_check';

export interface MCPEvent {
  type: MCPEventType;
  timestamp: Date;
  serverId?: string;
  data: Record<string, unknown>;
}

export type MCPEventHandler = (event: MCPEvent) => void | Promise<void>;

// --- Metrics Types ---

export interface FederationMetrics {
  totalServers: number;
  healthyServers: number;
  totalToolCalls: number;
  successfulCalls: number;
  averageLatencyMs: number;
  errorRate: number;
  topTools: Array<{ name: string; calls: number }>;
  serverUtilization: Record<string, number>;
}

// --- Bridge Types ---

export interface SuperClawMCPBridge {
  localTools: Map<string, ToolDefinition>;
  federatedTools: Map<string, ToolCapability>;
  serverConnections: Map<string, FederatedServer>;
  
  // Bridge SuperClaw tool to MCP
  wrapTool(tool: ToolDefinition): ToolCapability;
  
  // Execute federated tool call
  executeFederatedTool(call: FederatedToolCall): Promise<FederatedToolResult>;
  
  // Register local tool for sharing
  shareTool(toolName: string): void;
  
  // Discover remote tools
  discoverTools(serverId: string): Promise<ToolDiscoveryResult>;
}