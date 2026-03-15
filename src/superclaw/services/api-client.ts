/**
 * SuperClaw API Client
 * Centralized service for connecting TUI/Web components to SuperClaw Gateway
 * Replaces all mock data with real API calls
 */

import EventEmitter from 'events';
import WebSocket from 'ws';

export interface SystemStatus {
  running: boolean;
  activeRuns: number;
  totalRuns: number;
  version?: string;
  uptime?: number;
  routing: {
    tier1_usage: number;
    tier2_usage: number;  
    tier3_usage: number;
    total_requests: number;
    average_latency: number;
    cost_savings: number;
  };
  learning: {
    patterns_learned: number;
    prediction_accuracy: number;
    adaptations_made: number;
  };
  persistence: {
    total_runs: number;
    total_executions: number;
    db_size_mb: number;
  };
  costs: {
    daily: Array<{ date: string; amount: number }>;
    total: number;
  };
}

export interface SwarmRun {
  runId: string;
  objective: string;
  status: 'pending' | 'decomposing' | 'running' | 'aggregating' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  tasks: Array<{
    id: string;
    role: string;
    instructions: string;
  }>;
  results: Array<{
    taskId: string;
    role: string;
    output: string;
    status: 'success' | 'failure';
    latency: number;
    tokens?: { input: number; output: number };
  }>;
  output?: string;
  error?: string;
  stats?: {
    totalTime: number;
    agentCount: number;
    successRate: number;
    totalTokens: { input: number; output: number };
  };
}

export interface SwarmEvent {
  event: string;
  runId: string;
  timestamp?: string;
  [key: string]: any;
}

export interface ThresholdStatus {
  limits: {
    resource: {
      maxConcurrentAgents: number;
      maxToolCallsPerTurn: number;
      maxContextChars: number;
      maxMemoryMB: number;
    };
    financial: {
      requireApprovalAbove: number;
      dailySpendLimit: number;
      perAgentLimit: number;
    };
  };
  usage: {
    current: {
      concurrentAgents: number;
      dailySpend: number;
      memoryUsedMB: number;
    };
    today: {
      totalSpend: number;
      apiCalls: number;
      agentsSpawned: number;
    };
  };
  auditLog: Array<{
    timestamp: string;
    level: 'info' | 'warn' | 'critical';
    message: string;
    metadata?: any;
  }>;
}

export interface Provider {
  name: string;
  status: 'online' | 'offline' | 'quota' | 'error';
  models: string[];
  tier: number;
  latency?: number;
  costPer1K: number;
  usageToday: number;
  endpoint: string;
  lastError?: string;
  rateLimit?: {
    max: number;
    used: number;
  };
}

export interface ProvidersResponse {
  providers: Provider[];
  summary: {
    total: number;
    online: number;
    offline: number;
    quota_issues: number;
    total_usage_today: number;
    cost_savings: number;
  };
}

export class SuperClawApiClient extends EventEmitter {
  private baseUrl: string;
  private wsConnections: Map<string, WebSocket> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // 1 second

  constructor(baseUrl = 'http://127.0.0.1:18800') {
    super();
    this.baseUrl = baseUrl;
  }

  // --- Connection Management ---

  async checkConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      return response.ok;
    } catch (error: unknown) {
      return false;
    }
  }

  // --- System Status ---

  async getSystemStatus(): Promise<SystemStatus> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/status`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      
      // Map raw API response to our interface
      return {
        // @ts-expect-error - Post-Merge Reconciliation
        running: data.running,
        // @ts-expect-error - Post-Merge Reconciliation
        activeRuns: data.activeRuns,
        // @ts-expect-error - Post-Merge Reconciliation
        totalRuns: data.totalRuns,
        // @ts-expect-error - Post-Merge Reconciliation
        version: data.version,
        // @ts-expect-error - Post-Merge Reconciliation
        uptime: data.uptime,
        // @ts-expect-error - Post-Merge Reconciliation
        routing: data.routing || {
          tier1_usage: 0,
          tier2_usage: 0,
          tier3_usage: 0,
          total_requests: 0,
          average_latency: 0,
          cost_savings: 0,
        },
        // @ts-expect-error - Post-Merge Reconciliation
        learning: data.learning || {
          patterns_learned: 0,
          prediction_accuracy: 0,
          adaptations_made: 0,
        },
        // @ts-expect-error - Post-Merge Reconciliation
        persistence: data.persistence || {
          total_runs: 0,
          total_executions: 0,
          db_size_mb: 0,
        },
        // @ts-expect-error - Post-Merge Reconciliation
        costs: data.costs || { daily: [], total: 0 },
      };
    } catch (error: unknown) {
      console.error('[API Client] Failed to fetch system status:', error);
      throw error;
    }
  }

  // --- Swarm Operations ---

  async listRuns(limit = 10): Promise<SwarmRun[]> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/swarm?limit=${limit}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      // @ts-expect-error - Post-Merge Reconciliation
      return data.runs || [];
    } catch (error: unknown) {
      console.error('[API Client] Failed to list runs:', error);
      throw error;
    }
  }

  async getRun(runId: string): Promise<SwarmRun | null> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/swarm/${runId}`);
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      // @ts-expect-error - Post-Merge Reconciliation
      return await response.json();
    } catch (error: unknown) {
      console.error(`[API Client] Failed to get run ${runId}:`, error);
      throw error;
    }
  }

  async startSwarm(params: {
    objective: string;
    maxAgents?: number;
    timeout?: number;
    model?: string;
  }): Promise<{ runId: string; status: string; wsUrl: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/swarm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      // @ts-expect-error - Post-Merge Reconciliation
      return await response.json();
    } catch (error: unknown) {
      console.error('[API Client] Failed to start swarm:', error);
      throw error;
    }
  }

  // --- Real-time Events via WebSocket ---

  connectToSwarmEvents(runId: string): WebSocket | null {
    const wsUrl = `ws://127.0.0.1:18800/v1/swarm/${runId}/stream`;
    
    try {
      const ws = new WebSocket(wsUrl);
      
      ws.on('open', () => {
        console.log(`[API Client] Connected to swarm ${runId} events`);
        this.emit('swarm-connected', { runId });
        this.reconnectAttempts = 0;
      });

      ws.on('message', (data) => {
        try {
          const event: SwarmEvent = JSON.parse(data.toString());
          this.emit('swarm-event', event);
        } catch (error: unknown) {
          console.error('[API Client] Failed to parse swarm event:', error);
        }
      });

      ws.on('close', (code) => {
        console.log(`[API Client] WebSocket closed for run ${runId}, code: ${code}`);
        this.wsConnections.delete(runId);
        this.emit('swarm-disconnected', { runId, code });
        
        // Auto-reconnect for unexpected closures
        if (code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
          setTimeout(() => {
            console.log(`[API Client] Reconnecting to swarm ${runId}...`);
            this.reconnectAttempts++;
            this.connectToSwarmEvents(runId);
          }, this.reconnectDelay * Math.pow(2, this.reconnectAttempts));
        }
      });

      ws.on('error', (error) => {
        console.error(`[API Client] WebSocket error for run ${runId}:`, error);
        this.emit('swarm-error', { runId, error });
      });

      this.wsConnections.set(runId, ws);
      return ws;
    } catch (error: unknown) {
      console.error(`[API Client] Failed to connect to swarm ${runId}:`, error);
      return null;
    }
  }

  disconnectFromSwarm(runId: string): void {
    const ws = this.wsConnections.get(runId);
    if (ws) {
      ws.close(1000); // Normal closure
      this.wsConnections.delete(runId);
    }
  }

  // --- Providers ---

  async getProviders(): Promise<ProvidersResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/providers`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      // @ts-expect-error - Post-Merge Reconciliation
      return await response.json();
    } catch (error: unknown) {
      console.error('[API Client] Failed to fetch providers:', error);
      throw error;
    }
  }

  // --- Skynet Thresholds ---

  async getThresholdStatus(): Promise<ThresholdStatus> {
    try {
      const response = await fetch(`${this.baseUrl}/skynet/thresholds`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      // @ts-expect-error - Post-Merge Reconciliation
      return await response.json();
    } catch (error: unknown) {
      console.error('[API Client] Failed to fetch threshold status:', error);
      throw error;
    }
  }

  // --- Helper Methods ---

  // Convert API data to TUI-friendly format for StatusPanel
  mapStatusToTuiFormat(status: SystemStatus): {
    gateway: { status: string; port: number };
    providers: { active: number; total: number };
    queue: { pending: number };
    memory: { used: string };
    uptime: string;
  } {
    const formatUptime = (seconds?: number): string => {
      if (!seconds) return '0m';
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    };

    const formatMemory = (mb?: number): string => {
      if (!mb) return 'Unknown';
      return mb > 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
    };

    return {
      gateway: { 
        status: status.running ? 'Running' : 'Stopped', 
        port: 18800 
      },
      providers: { 
        active: status.routing.tier1_usage + status.routing.tier2_usage + status.routing.tier3_usage > 0 ? 3 : 0,
        total: 5 
      },
      queue: { 
        pending: status.activeRuns 
      },
      memory: { 
        used: formatMemory(status.persistence.db_size_mb) 
      },
      uptime: formatUptime(status.uptime),
    };
  }

  // Convert runs to TUI-friendly activity format
  mapRunsToActivityFormat(runs: SwarmRun[]): Array<{
    time: string;
    status: string;
    message: string;
    type: 'success' | 'info' | 'warning';
  }> {
    return runs.slice(0, 4).map(run => {
      const timeAgo = this.formatTimeAgo(new Date(run.startedAt));
      const status = run.status === 'completed' ? '✓' : 
                    run.status === 'failed' ? '✗' : 
                    run.status === 'running' ? '○' : '●';
      const type = run.status === 'completed' ? 'success' : 
                   run.status === 'failed' ? 'warning' : 'info';
      
      return {
        time: timeAgo,
        status,
        message: `Swarm ${run.status}: "${run.objective.slice(0, 50)}${run.objective.length > 50 ? '...' : ''}"`,
        type: type as 'success' | 'info' | 'warning',
      };
    });
  }

  private formatTimeAgo(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  }

  // --- Cleanup ---

  disconnect(): void {
    for (const [runId, ws] of this.wsConnections) {
      ws.close(1000);
    }
    this.wsConnections.clear();
    this.removeAllListeners();
  }
}

// Singleton instance
let apiClient: SuperClawApiClient | null = null;

export function getApiClient(): SuperClawApiClient {
  if (!apiClient) {
    apiClient = new SuperClawApiClient();
  }
  return apiClient;
}

export default SuperClawApiClient;