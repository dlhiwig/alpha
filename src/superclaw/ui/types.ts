/**
 * SuperClaw TUI Types
 */

export interface SuperclawMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinking?: string;
  tools?: ToolResult[];
  timestamp: Date;
}

export interface ToolResult {
  name: string;
  result: string;
  status: 'success' | 'error';
  duration?: number;
}

export interface SuperclawAgent {
  id: string;
  name: string;
  status: 'active' | 'idle' | 'error' | 'completed';
  goal?: string;
  progress?: number;
}

export interface SuperclawLattice {
  nodes: number;
  edges: number;
}

export interface SuperclawStatus {
  online: boolean;
  providers: number;
  uptime: string;
  version?: string;
}

export interface GatewayStatus {
  connected: boolean;
  url: string;
  uptime: number;
  version: string;
}

export interface ProviderStatus {
  name: string;
  status: 'online' | 'offline' | 'rate-limited';
  latency?: number;
}

export interface ThresholdStatus {
  name: string;
  current: number;
  max: number;
  exceeded: boolean;
}
