/**
 * AgentChattr Convoy Adapter
 * 
 * Bridges SuperClaw's Convoy work tracking with AgentChattr for
 * real-time multi-agent coordination and human visibility.
 * 
 * Replaces MOLTBOOK EventEmitter-based coordination with agentchattr's
 * MCP-native chat channels for:
 * - Human-visible agent communication
 * - @mention-based task assignment
 * - Decision tracking and approval
 * - Real-time coordination UI at localhost:8300
 * 
 * @see https://github.com/bcurts/agentchattr
 * @see /home/toba/agentchattr
 */

import { EventEmitter } from 'events';
import { AgentChattrBridge, SwarmCoordinator, ChatMessage, Decision } from '../mcp/bridges/agentchattr';
import type { Convoy, Bead, ConvoyAgent, ConvoyProgress, ConvoyResult } from './convoy';

// --- Types ---

export interface ConvoyChannelConfig {
  /** Channel name for this convoy (default: convoy-{id}) */
  channel?: string;
  /** Whether to post all events to chat (default: true) */
  postEvents?: boolean;
  /** Whether to propose decisions for major actions (default: true) */
  proposeDecisions?: boolean;
  /** Agents to @mention for each event type */
  mentions?: Record<string, string[]>;
}

export interface AdapterOptions {
  /** AgentChattr MCP server URL */
  serverUrl?: string;
  /** Adapter identity name */
  name?: string;
  /** Channel configuration */
  channelConfig?: ConvoyChannelConfig;
  /** Poll interval for messages (ms) */
  pollIntervalMs?: number;
}

// --- Adapter ---

export class AgentChattrConvoyAdapter extends EventEmitter {
  private bridge: AgentChattrBridge;
  private convoy: Convoy | null = null;
  private channel: string;
  private config: Required<AdapterOptions>;
  private agentBridges: Map<string, AgentChattrBridge> = new Map();
  private isConnected = false;
  
  constructor(options: AdapterOptions = {}) {
    super();
    
    this.config = {
      serverUrl: options.serverUrl ?? 'http://127.0.0.1:8200',
      name: options.name ?? 'convoy-coordinator',
      channelConfig: options.channelConfig ?? {},
      pollIntervalMs: options.pollIntervalMs ?? 2000,
    };
    
    this.channel = this.config.channelConfig.channel ?? 'convoy-swarm';
    
    this.bridge = new AgentChattrBridge({
      httpUrl: this.config.serverUrl,
      agentName: this.config.name,
      defaultChannel: this.channel,
    });
  }
  
  // --- Connection ---
  
  /**
   * Connect to AgentChattr and announce presence
   */
  async connect(): Promise<void> {
    await this.bridge.connect();
    this.isConnected = true;
    
    await this.bridge.send('🚀 Convoy Coordinator online. Ready for swarm orchestration.');
    
    // Start polling for commands
    this.bridge.startPolling(this.config.pollIntervalMs);
    
    // Handle @mentions as commands
    this.bridge.on('mention', (msg: ChatMessage) => {
      this.handleCommand(msg);
    });
    
    this.emit('connected');
  }
  
  /**
   * Disconnect from AgentChattr
   */
  disconnect(): void {
    this.bridge.stopPolling();
    this.agentBridges.forEach(b => b.stopPolling());
    this.agentBridges.clear();
    this.isConnected = false;
    this.emit('disconnected');
  }
  
  // --- Convoy Integration ---
  
  /**
   * Attach to a Convoy instance and bridge events
   */
  attachConvoy(convoy: Convoy): void {
    this.convoy = convoy;
    
    // Set channel based on convoy ID
    this.channel = `convoy-${(convoy as any).config?.id ?? 'unknown'}`;
    
    // Wire up convoy events to chat
    convoy.on('progress', (progress: ConvoyProgress) => {
      this.postProgress(progress);
    });
    
    // Wire up agent events via the internal eventBus
    // @ts-expect-error - accessing internal eventBus
    const eventBus = convoy.eventBus;
    
    eventBus.on('bead:assigned', async (bead: Bead, agent: ConvoyAgent) => {
      await this.postBeadAssigned(bead, agent);
    });
    
    eventBus.on('bead:completed', async (bead: Bead, agent: ConvoyAgent) => {
      await this.postBeadCompleted(bead, agent);
    });
    
    eventBus.on('bead:failed', async (bead: Bead, agent: ConvoyAgent, error: Error) => {
      await this.postBeadFailed(bead, agent, error);
    });
    
    eventBus.on('convoy:completed', async (result: ConvoyResult) => {
      await this.postConvoyCompleted(result);
    });
    
    this.emit('convoy:attached', convoy);
  }
  
  /**
   * Register an agent for coordination
   */
  async registerAgent(agent: ConvoyAgent): Promise<void> {
    const agentBridge = new AgentChattrBridge({
      httpUrl: this.config.serverUrl,
      agentName: agent.id,
      defaultChannel: this.channel,
    });
    
    await agentBridge.connect();
    this.agentBridges.set(agent.id, agentBridge);
    
    await this.bridge.send(`🤖 Agent **${agent.name}** (${agent.provider}) joined the convoy`);
    
    // Start polling for this agent's commands
    agentBridge.startPolling(this.config.pollIntervalMs);
    agentBridge.on('mention', (msg: ChatMessage) => {
      this.emit('agent:command', { agent, message: msg });
    });
  }
  
  // --- Event Posting ---
  
  private async postProgress(progress: ConvoyProgress): Promise<void> {
    if (!this.config.channelConfig.postEvents) return;
    
    const bar = this.progressBar(progress.percentage);
    await this.bridge.send(
      `📊 Progress: ${bar} ${progress.percentage.toFixed(1)}%\n` +
      `✅ ${progress.completed}/${progress.total} complete | 🔄 ${progress.inProgress} in progress | ⏳ ${progress.ready} ready`
    );
  }
  
  private async postBeadAssigned(bead: Bead, agent: ConvoyAgent): Promise<void> {
    await this.bridge.send(
      `📋 @${agent.id} assigned: **${bead.title}**\n` +
      `> ${bead.description.slice(0, 100)}${bead.description.length > 100 ? '...' : ''}`
    );
  }
  
  private async postBeadCompleted(bead: Bead, agent: ConvoyAgent): Promise<void> {
    const duration = bead.completed && bead.started 
      ? Math.round((bead.completed.getTime() - bead.started.getTime()) / 1000 / 60)
      : '?';
    
    await this.bridge.send(
      `✅ @${agent.id} completed: **${bead.title}** (${duration} min)`
    );
  }
  
  private async postBeadFailed(bead: Bead, agent: ConvoyAgent, error: Error): Promise<void> {
    await this.bridge.send(
      `❌ @${agent.id} failed: **${bead.title}**\n` +
      `> Error: ${error.message}`
    );
    
    // Propose decision for retry
    if (this.config.channelConfig.proposeDecisions) {
      await this.bridge.proposeDecision(
        `Retry failed bead: ${bead.title}`,
        `Agent ${agent.name} failed with: ${error.message}`
      );
    }
  }
  
  private async postConvoyCompleted(result: ConvoyResult): Promise<void> {
    const status = result.success ? '🎉 SUCCESS' : '⚠️ PARTIAL';
    
    await this.bridge.send(
      `${status} Convoy **${result.convoy.name}** completed!\n\n` +
      `📊 **Results:**\n` +
      `• Completed: ${result.completedBeads}/${result.completedBeads + result.failedBeads}\n` +
      `• Failed: ${result.failedBeads}\n` +
      `• Artifacts: ${result.artifacts.length}\n\n` +
      `📝 **Summary:** ${result.summary.overview}`
    );
  }
  
  // --- Commands ---
  
  private async handleCommand(msg: ChatMessage): Promise<void> {
    const text = msg.text.toLowerCase();
    
    if (text.includes('status')) {
      await this.postStatus();
    } else if (text.includes('help')) {
      await this.postHelp();
    } else if (text.includes('pause')) {
      this.emit('command:pause', msg);
    } else if (text.includes('resume')) {
      this.emit('command:resume', msg);
    } else if (text.includes('cancel')) {
      this.emit('command:cancel', msg);
    }
  }
  
  private async postStatus(): Promise<void> {
    if (!this.convoy) {
      await this.bridge.send('📊 No convoy attached. Use `attachConvoy()` first.');
      return;
    }
    
    // @ts-expect-error - accessing getProgress method
    const progress = this.convoy.getProgress?.() ?? { percentage: 0, completed: 0, total: 0 };
    
    await this.bridge.send(
      `📊 **Convoy Status**\n` +
      `• Progress: ${progress.percentage.toFixed(1)}%\n` +
      `• Agents: ${this.agentBridges.size} online\n` +
      `• Completed: ${progress.completed}/${progress.total}`
    );
  }
  
  private async postHelp(): Promise<void> {
    await this.bridge.send(
      `🤖 **Convoy Coordinator Commands:**\n` +
      `• @convoy-coordinator status — Show progress\n` +
      `• @convoy-coordinator pause — Pause execution\n` +
      `• @convoy-coordinator resume — Resume execution\n` +
      `• @convoy-coordinator cancel — Cancel convoy`
    );
  }
  
  // --- Utilities ---
  
  private progressBar(percentage: number): string {
    const filled = Math.round(percentage / 10);
    const empty = 10 - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  }
  
  /**
   * Get the underlying bridge for direct access
   */
  getBridge(): AgentChattrBridge {
    return this.bridge;
  }
  
  /**
   * Get agent bridges
   */
  getAgentBridges(): Map<string, AgentChattrBridge> {
    return this.agentBridges;
  }
}

// --- Factory ---

/**
 * Create adapter and wire to convoy
 */
export async function createConvoyAdapter(
  convoy: Convoy,
  options?: AdapterOptions
): Promise<AgentChattrConvoyAdapter> {
  const adapter = new AgentChattrConvoyAdapter(options);
  await adapter.connect();
  adapter.attachConvoy(convoy);
  return adapter;
}

export default AgentChattrConvoyAdapter;
