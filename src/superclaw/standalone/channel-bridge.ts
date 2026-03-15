// @ts-nocheck
/**
 * Channel-Gateway Bridge
 * SuperClaw Independence Sprint - Channel Integration
 * 
 * Routes messages between channel connectors and the Gateway/LLM backend.
 * Provides session mapping, message normalization, and response routing.
 */

import {
  IChannelConnector,
  IncomingMessage,
  MessageContent,
  MessageResult,
  SupportedPlatform,
  ConnectorStatus,
  NormalizedMessage,
  Contact
} from '../channels/contracts';

import { 
  createTelegramConnector,
  createWhatsAppConnector, 
  createSignalConnector
} from '../channels/index';

// Gateway API interface
export interface GatewayAPI {
  chat(message: string, sessionId: string): Promise<string>;
  createSession(userId: string, platform: string): Promise<string>;
}

// Session mapping for channel+user to gateway sessions
interface SessionMapping {
  channelId: string;
  platform: SupportedPlatform;
  userId: string;
  gatewaySessionId: string;
  createdAt: Date;
  lastActivity: Date;
}

// Channel configuration for initialization
export interface ChannelConfig {
  platform: SupportedPlatform;
  config: any; // Platform-specific config
  enabled: boolean;
}

export interface ChannelBridgeConfig {
  gatewayUrl: string;
  channels: ChannelConfig[];
  sessionTimeout: number; // milliseconds
  debug?: boolean;
}

/**
 * Bridge that connects channel connectors to the Gateway API
 */
export class ChannelBridge {
  private connectors: Map<string, IChannelConnector> = new Map();
  private sessions: Map<string, SessionMapping> = new Map();
  private gatewayApi: GatewayAPI;
  private config: ChannelBridgeConfig;
  private isRunning = false;

  constructor(config: ChannelBridgeConfig, gatewayApi?: GatewayAPI) {
    this.config = config;
    this.gatewayApi = gatewayApi || this.createDefaultGatewayAPI();
  }

  /**
   * Initialize the bridge and all configured connectors
   */
  async initialize(): Promise<void> {
    console.log('🌉 Initializing Channel Bridge...');

    // Initialize connectors for enabled platforms
    for (const channelConfig of this.config.channels) {
      if (!channelConfig.enabled) {
        console.log(`⏭️  Skipping ${channelConfig.platform} (disabled)`);
        continue;
      }

      try {
        const connector = await this.createConnector(channelConfig);
        await connector.initialize(channelConfig.config);
        
        // Setup event handlers
        connector.onMessage(this.handleIncomingMessage.bind(this));
        connector.onStatusChange(this.handleStatusChange.bind(this));
        connector.onError(this.handleConnectorError.bind(this));

        this.connectors.set(connector.id, connector);
        console.log(`✅ Initialized ${channelConfig.platform} connector: ${connector.id}`);

      } catch (error: unknown) {
        console.error(`❌ Failed to initialize ${channelConfig.platform} connector:`, error);
        // Continue with other connectors even if one fails
      }
    }

    console.log(`🌉 Channel Bridge initialized with ${this.connectors.size} connectors`);
  }

  /**
   * Start all connectors and begin message processing
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('⚠️  Channel Bridge is already running');
      return;
    }

    console.log('🚀 Starting Channel Bridge...');

    // Connect all initialized connectors
    const connectPromises = Array.from(this.connectors.values()).map(async (connector) => {
      try {
        await connector.connect();
        console.log(`🔌 Connected ${connector.platform} connector: ${connector.id}`);
      } catch (error: unknown) {
        console.error(`❌ Failed to connect ${connector.platform} connector ${connector.id}:`, error);
      }
    });

    await Promise.allSettled(connectPromises);

    // Start session cleanup
    this.startSessionCleanup();

    this.isRunning = true;
    console.log('✅ Channel Bridge is running');
  }

  /**
   * Stop all connectors and clean up
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log('🛑 Stopping Channel Bridge...');

    // Disconnect all connectors
    const disconnectPromises = Array.from(this.connectors.values()).map(async (connector) => {
      try {
        await connector.disconnect();
        console.log(`🔌 Disconnected ${connector.platform} connector: ${connector.id}`);
      } catch (error: unknown) {
        console.error(`❌ Failed to disconnect ${connector.platform} connector ${connector.id}:`, error);
      }
    });

    await Promise.allSettled(disconnectPromises);

    this.isRunning = false;
    console.log('✅ Channel Bridge stopped');
  }

  /**
   * Handle incoming messages from any channel connector
   */
  private async handleIncomingMessage(message: IncomingMessage): Promise<void> {
    if (this.config.debug) {
      console.log('📨 Incoming message:', {
        platform: message.platform,
        from: message.from,
        text: message.content.text?.substring(0, 100) + '...'
      });
    }

    try {
      // Normalize the message
      const normalized = await this.normalizeMessage(message);
      
      // Get or create gateway session
      const sessionId = await this.getOrCreateSession(
        message.platform,
        message.from,
        normalized.from
      );

      // Send to gateway/LLM
      const response = await this.gatewayApi.chat(
        normalized.content.text || '',
        sessionId
      );

      // Send response back to the originating channel
      await this.sendResponse(message.platform, message.from, response);

      // Update session activity
      this.updateSessionActivity(sessionId);

    } catch (error: unknown) {
      console.error('❌ Error handling message:', error);
      
      // Send error message back to user
      try {
        await this.sendResponse(
          message.platform,
          message.from,
          '🚨 Sorry, I encountered an error processing your message. Please try again.'
        );
      } catch (sendError) {
        console.error('❌ Failed to send error response:', sendError);
      }
    }
  }

  /**
   * Normalize incoming message to consistent format
   */
  private async normalizeMessage(message: IncomingMessage): Promise<NormalizedMessage> {
    // Get connector for additional context
    const connector = Array.from(this.connectors.values())
      .find(c => c.platform === message.platform);

    return {
      id: message.id,
      platform: message.platform,
      from: {
        id: message.from,
        platform: message.platform,
        name: message.from // TODO: Enrich with actual contact info
      } as Contact,
      to: {
        id: message.to,
        platform: message.platform,
        name: 'SuperClaw'
      } as Contact,
      content: message.content,
      media: message.media,
      timestamp: message.timestamp,
      isDirect: !message.isGroup,
      mentionsBot: this.checkMentionsBot(message),
      metadata: {
        isGroup: message.isGroup || false,
        groupName: message.groupId,
        messageType: message.media?.length ? message.media[0].type : 'text'
      }
    } as NormalizedMessage;
  }

  /**
   * Check if message mentions the bot (for group chats)
   */
  private checkMentionsBot(message: IncomingMessage): boolean {
    const text = message.content.text?.toLowerCase() || '';
    const mentions = message.content.mentions || [];
    
    // Check for explicit mentions
    if (mentions.some(m => m.toLowerCase().includes('superclaw') || m.toLowerCase().includes('bot'))) {
      return true;
    }
    
    // Check for bot keywords in text
    const botKeywords = ['superclaw', 'bot', '@bot'];
    return botKeywords.some(keyword => text.includes(keyword));
  }

  /**
   * Get existing session or create new one for user
   */
  private async getOrCreateSession(platform: SupportedPlatform, userId: string, contact: Contact): Promise<string> {
    const sessionKey = `${platform}:${userId}`;
    const existing = this.sessions.get(sessionKey);

    if (existing && this.isSessionValid(existing)) {
      return existing.gatewaySessionId;
    }

    // Create new gateway session
    const gatewaySessionId = await this.gatewayApi.createSession(userId, platform);
    
    const mapping: SessionMapping = {
      channelId: sessionKey,
      platform,
      userId,
      gatewaySessionId,
      createdAt: new Date(),
      lastActivity: new Date()
    };

    this.sessions.set(sessionKey, mapping);
    
    if (this.config.debug) {
      console.log(`🆔 Created new session mapping: ${sessionKey} -> ${gatewaySessionId}`);
    }

    return gatewaySessionId;
  }

  /**
   * Check if session is still valid (not expired)
   */
  private isSessionValid(session: SessionMapping): boolean {
    const now = new Date();
    const age = now.getTime() - session.lastActivity.getTime();
    return age < this.config.sessionTimeout;
  }

  /**
   * Update session activity timestamp
   */
  private updateSessionActivity(gatewaySessionId: string): void {
    const entries = Array.from(this.sessions.entries());
    for (const [key, session] of entries) {
      if (session.gatewaySessionId === gatewaySessionId) {
        session.lastActivity = new Date();
        break;
      }
    }
  }

  /**
   * Send response back to the originating channel
   */
  private async sendResponse(platform: SupportedPlatform, targetUserId: string, response: string): Promise<void> {
    const connector = Array.from(this.connectors.values())
      .find(c => c.platform === platform);

    if (!connector) {
      throw new Error(`No connector found for platform: ${platform}`);
    }

    const content: MessageContent = {
      text: response
    };

    await connector.sendMessage(targetUserId, content);

    if (this.config.debug) {
      console.log(`📤 Sent response to ${platform}:${targetUserId}: ${response.substring(0, 100)}...`);
    }
  }

  /**
   * Handle connector status changes
   */
  private async handleStatusChange(status: ConnectorStatus, previous: ConnectorStatus): Promise<void> {
    console.log(`🔄 Connector status changed: ${previous} -> ${status}`);
  }

  /**
   * Handle connector errors
   */
  private async handleConnectorError(error: any): Promise<void> {
    console.error('🚨 Connector error:', error);
  }

  /**
   * Create connector instance based on platform
   */
  private async createConnector(channelConfig: ChannelConfig): Promise<IChannelConnector> {
    switch (channelConfig.platform) {
      case 'telegram':
        return createTelegramConnector(channelConfig.config);
        
      case 'whatsapp':
        return createWhatsAppConnector(channelConfig.config);
        
      case 'signal':
        return createSignalConnector(channelConfig.config);
        
      default:
        throw new Error(`Unsupported platform: ${channelConfig.platform}`);
    }
  }

  /**
   * Create default gateway API that calls the local gateway
   */
  private createDefaultGatewayAPI(): GatewayAPI {
    return {
      async chat(message: string, sessionId: string): Promise<string> {
        // @ts-expect-error - Post-Merge Reconciliation
        const response = await fetch(`${this.config.gatewayUrl}/v1/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message,
            sessionId
          })
        });

        if (!response.ok) {
          throw new Error(`Gateway API error: ${response.status} ${response.statusText}`);
        }

        const data: any = await response.json();
        return data.response;
      },

      async createSession(userId: string, platform: string): Promise<string> {
        // For now, create deterministic session IDs
        // In production, this might call a dedicated endpoint
        return `${platform}-${userId}-${Date.now()}`;
      }
    };
  }

  /**
   * Start periodic cleanup of expired sessions
   */
  private startSessionCleanup(): void {
    const cleanup = () => {
      const now = new Date();
      let cleanedCount = 0;

      const entries = Array.from(this.sessions.entries());
      for (const [key, session] of entries) {
        if (!this.isSessionValid(session)) {
          this.sessions.delete(key);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0 && this.config.debug) {
        console.log(`🧹 Cleaned up ${cleanedCount} expired sessions`);
      }
    };

    // Run cleanup every 5 minutes
    setInterval(cleanup, 5 * 60 * 1000);
  }

  /**
   * Get bridge status and statistics
   */
  getStatus(): {
    isRunning: boolean;
    connectors: Array<{ id: string; platform: SupportedPlatform; status: ConnectorStatus }>;
    activeSessions: number;
  } {
    return {
      isRunning: this.isRunning,
      connectors: Array.from(this.connectors.values()).map(c => ({
        id: c.id,
        platform: c.platform,
        status: c.status
      })),
      activeSessions: this.sessions.size
    };
  }
}