/**
 * AgentChattr MCP Bridge for SuperClaw
 * 
 * Provides TypeScript client for agentchattr's MCP server.
 * Enables SuperClaw swarms to coordinate via shared chat channels.
 * 
 * @see https://github.com/bcurts/agentchattr
 * @see /home/toba/agentchattr
 */

import { EventEmitter } from 'events';

// --- Types ---

export interface ChatMessage {
  id: number;
  sender: string;
  text: string;
  type: 'message' | 'join' | 'leave' | 'system';
  time: string;
  channel: string;
  attachments?: Array<{ name: string; url: string }>;
  reply_to?: number;
}

export interface Decision {
  id: number;
  decision: string;
  proposer: string;
  reason?: string;
  status: 'proposed' | 'approved';
  created_at: string;
}

export interface AgentChattrConfig {
  /** Base URL for HTTP transport (default: http://127.0.0.1:8200) */
  httpUrl?: string;
  /** Base URL for SSE transport (default: http://127.0.0.1:8201) */
  sseUrl?: string;
  /** Agent identity for this client */
  agentName: string;
  /** Default channel (default: 'general') */
  defaultChannel?: string;
  /** Request timeout in ms (default: 10000) */
  timeout?: number;
}

interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: {
    content: Array<{ type: string; text: string }>;
  };
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// --- AgentChattr Bridge ---

export class AgentChattrBridge extends EventEmitter {
  private config: Required<AgentChattrConfig>;
  private requestId = 0;
  private isConnected = false;
  private pollInterval: NodeJS.Timeout | null = null;
  
  constructor(config: AgentChattrConfig) {
    super();
    this.config = {
      httpUrl: config.httpUrl ?? 'http://127.0.0.1:8200',
      sseUrl: config.sseUrl ?? 'http://127.0.0.1:8201',
      agentName: config.agentName,
      defaultChannel: config.defaultChannel ?? 'general',
      timeout: config.timeout ?? 10000,
    };
  }
  
  // --- Connection Management ---
  
  /**
   * Join the chat and announce presence
   */
  async connect(): Promise<string> {
    const result = await this.callTool('chat_join', {
      name: this.config.agentName,
      channel: this.config.defaultChannel,
    });
    this.isConnected = true;
    this.emit('connected', result);
    return result;
  }
  
  /**
   * Start polling for new messages
   */
  startPolling(intervalMs = 2000): void {
    if (this.pollInterval) return;
    
    this.pollInterval = setInterval(async () => {
      try {
        const messages = await this.read();
        if (messages.length > 0) {
          for (const msg of messages) {
            this.emit('message', msg);
            
            // Check if this message mentions us
            if (this.isMentioned(msg.text)) {
              this.emit('mention', msg);
            }
          }
        }
      } catch (error) {
        this.emit('error', error);
      }
    }, intervalMs);
  }
  
  /**
   * Stop polling for messages
   */
  stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
  
  /**
   * Check if a message mentions this agent
   */
  private isMentioned(text: string): boolean {
    const mentionPattern = new RegExp(`@${this.config.agentName}\\b|@all`, 'i');
    return mentionPattern.test(text);
  }
  
  // --- Chat Tools ---
  
  /**
   * Send a message to a channel
   */
  async send(
    message: string,
    options: {
      channel?: string;
      replyTo?: number;
      imagePath?: string;
    } = {}
  ): Promise<string> {
    return this.callTool('chat_send', {
      sender: this.config.agentName,
      message,
      channel: options.channel ?? this.config.defaultChannel,
      reply_to: options.replyTo ?? -1,
      image_path: options.imagePath ?? '',
    });
  }
  
  /**
   * Read recent messages from a channel
   * Uses cursor tracking for incremental reads
   */
  async read(options: {
    channel?: string;
    limit?: number;
    sinceId?: number;
  } = {}): Promise<ChatMessage[]> {
    const result = await this.callTool('chat_read', {
      sender: this.config.agentName,
      channel: options.channel ?? '',
      limit: options.limit ?? 20,
      since_id: options.sinceId ?? 0,
    });
    
    if (result === 'No new messages.') {
      return [];
    }
    
    try {
      return JSON.parse(result) as ChatMessage[];
    } catch {
      return [];
    }
  }
  
  /**
   * Full context refresh - resets cursor
   */
  async resync(options: {
    channel?: string;
    limit?: number;
  } = {}): Promise<ChatMessage[]> {
    const result = await this.callTool('chat_resync', {
      sender: this.config.agentName,
      channel: options.channel ?? '',
      limit: options.limit ?? 50,
    });
    
    try {
      return JSON.parse(result) as ChatMessage[];
    } catch {
      return [];
    }
  }
  
  /**
   * Check who's online
   */
  async who(): Promise<string[]> {
    const result = await this.callTool('chat_who', {});
    // Parse "Online: claude, codex, gemini" format
    const match = result.match(/Online:\s*(.+)/);
    if (!match) return [];
    return match[1].split(',').map(s => s.trim()).filter(Boolean);
  }
  
  /**
   * List available channels
   */
  async channels(): Promise<string[]> {
    const result = await this.callTool('chat_channels', {});
    try {
      return JSON.parse(result) as string[];
    } catch {
      return ['general'];
    }
  }
  
  // --- Decision Tools ---
  
  /**
   * List all decisions (proposed + approved)
   */
  async listDecisions(): Promise<Decision[]> {
    const result = await this.callTool('chat_decision', {
      action: 'list',
      sender: this.config.agentName,
    });
    
    if (result === 'No decisions yet.') {
      return [];
    }
    
    try {
      return JSON.parse(result) as Decision[];
    } catch {
      return [];
    }
  }
  
  /**
   * Propose a new decision for human approval
   */
  async proposeDecision(decision: string, reason?: string): Promise<string> {
    return this.callTool('chat_decision', {
      action: 'propose',
      sender: this.config.agentName,
      decision,
      reason: reason ?? '',
    });
  }
  
  // --- Hat Tools ---
  
  /**
   * Set avatar hat (SVG, viewBox "0 0 32 16", max 5KB)
   */
  async setHat(svg: string): Promise<string> {
    return this.callTool('chat_set_hat', {
      sender: this.config.agentName,
      svg,
    });
  }
  
  // --- MCP Transport ---
  
  private sessionId: string | null = null;
  
  /**
   * Initialize MCP session (required before tool calls)
   */
  private async initSession(): Promise<void> {
    if (this.sessionId) return;
    
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id: ++this.requestId,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'superclaw', version: '1.0.0' },
      } as any,
    };
    
    const response = await fetch(`${this.config.httpUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify(request),
    });
    
    const text = await response.text();
    const data = this.parseSSEResponse(text);
    
    // Extract session ID from response headers or generate one
    this.sessionId = response.headers.get('mcp-session-id') || `session_${Date.now()}`;
    this.emit('initialized', { sessionId: this.sessionId, serverInfo: data.result });
  }
  
  /**
   * Parse SSE response format from MCP server
   */
  private parseSSEResponse(text: string): MCPResponse {
    // SSE format: "event: message\ndata: {json}\n\n"
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const json = line.slice(6);
        return JSON.parse(json);
      }
    }
    // Fallback: try parsing as plain JSON
    return JSON.parse(text);
  }
  
  /**
   * Call an MCP tool via HTTP transport with SSE response handling
   */
  private async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    // Ensure session is initialized
    await this.initSession();
    
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id: ++this.requestId,
      method: 'tools/call',
      params: {
        name,
        arguments: args,
      },
    };
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout);
    
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      };
      
      if (this.sessionId) {
        headers['mcp-session-id'] = this.sessionId;
      }
      
      const response = await fetch(`${this.config.httpUrl}/mcp`, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const text = await response.text();
      const data = this.parseSSEResponse(text);
      
      if (data.error) {
        throw new Error(`MCP Error ${data.error.code}: ${data.error.message}`);
      }
      
      // Extract text from MCP response content
      const content = data.result?.content;
      if (!content || content.length === 0) {
        return '';
      }
      
      return content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('\n');
      
    } finally {
      clearTimeout(timeout);
    }
  }
}

// --- Factory Functions ---

/**
 * Create a bridge configured for SuperClaw swarm coordination
 */
export function createSwarmBridge(agentName: string, channel = 'superclaw-swarm'): AgentChattrBridge {
  return new AgentChattrBridge({
    agentName,
    defaultChannel: channel,
  });
}

/**
 * Create bridges for all agents in a swarm
 */
export function createSwarmBridges(
  agents: string[],
  channel = 'superclaw-swarm'
): Map<string, AgentChattrBridge> {
  const bridges = new Map<string, AgentChattrBridge>();
  for (const agent of agents) {
    bridges.set(agent, createSwarmBridge(agent, channel));
  }
  return bridges;
}

// --- Swarm Coordinator ---

/**
 * High-level coordinator for SuperClaw swarms using agentchattr
 */
export class SwarmCoordinator {
  private bridges: Map<string, AgentChattrBridge> = new Map();
  private taskChannel: string;
  
  constructor(taskId: string) {
    this.taskChannel = `swarm-${taskId}`;
  }
  
  /**
   * Get first available bridge (for coordinator messages)
   */
  private getFirstBridge(): AgentChattrBridge | undefined {
    const keys = Array.from(this.bridges.keys());
    return keys.length > 0 ? this.bridges.get(keys[0]) : undefined;
  }
  
  /**
   * Register an agent with the swarm
   */
  async registerAgent(agentName: string): Promise<void> {
    const bridge = new AgentChattrBridge({
      agentName,
      defaultChannel: this.taskChannel,
    });
    
    await bridge.connect();
    this.bridges.set(agentName, bridge);
  }
  
  /**
   * Broadcast a message to all agents
   */
  async broadcast(message: string, from = 'coordinator'): Promise<void> {
    const bridge = this.bridges.get(from) ?? this.getFirstBridge();
    if (bridge) {
      await bridge.send(`@all ${message}`);
    }
  }
  
  /**
   * Assign a task to a specific agent
   */
  async assignTask(agentName: string, task: string): Promise<void> {
    const bridge = this.getFirstBridge();
    if (bridge) {
      await bridge.send(`@${agentName} ${task}`);
    }
  }
  
  /**
   * Get all recent messages in the swarm channel
   */
  async getConversation(limit = 50): Promise<ChatMessage[]> {
    const bridge = this.getFirstBridge();
    if (!bridge) return [];
    return bridge.resync({ limit });
  }
  
  /**
   * Propose a decision for the swarm
   */
  async proposeDecision(decision: string, reason?: string): Promise<string> {
    const bridge = this.getFirstBridge();
    if (!bridge) return 'No bridge available';
    return bridge.proposeDecision(decision, reason);
  }
  
  /**
   * Cleanup all bridges
   */
  cleanup(): void {
    this.bridges.forEach(bridge => bridge.stopPolling());
    this.bridges.clear();
  }
}

// --- Exports ---

export default AgentChattrBridge;
