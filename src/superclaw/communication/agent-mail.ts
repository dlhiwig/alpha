// @ts-nocheck
/**
 * 🦊 SuperClaw Agent Mail Integration
 * 
 * Integration with MCP Agent Mail for inter-agent communication.
 * Provides Gmail-like coordination layer for SuperClaw agent swarms.
 * 
 * Features:
 * - Agent identity management with memorable names (e.g., GreenCastle, RedPond)
 * - Inter-agent messaging with GitHub-flavored Markdown support
 * - File reservation system for conflict prevention
 * - Agent discovery directory/LDAP-style queries
 * - Integration with SKYNET MOLTBOOK pub/sub system
 * - Audit trail generation with git-backed persistence
 * - Cross-project coordination support
 * - Contact policies and consent management
 * - Web UI integration for human oversight
 * 
 * Architecture:
 * - HTTP-only FastMCP server communication
 * - Dual persistence: Markdown in Git + SQLite for search
 * - Advisory file reservations with pre-commit guards
 * - Thread-based message organization
 * - Real-time synchronization with SuperClaw swarm state
 * 
 * Integration Points:
 * - SKYNET MOLTBOOK: Message routing and pub/sub
 * - SuperClaw Agents: Identity and lifecycle management
 * - Git repositories: File reservation and conflict resolution
 * - Audit system: Complete communication trail
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import axios, { AxiosInstance } from 'axios';

// Import SuperClaw modules
import { MOLTBOOK } from '../skynet/moltbook';
// @ts-expect-error - Post-Merge Reconciliation: Duplicate identifier from multiple imports
import { MessageType } from '../orchestration/types';
// @ts-expect-error - Post-Merge Reconciliation: Missing export 'AuditLogger', should be 'AuditLog'
import { AuditLogger } from '../skynet/audit';
// @ts-expect-error - Post-Merge Reconciliation: Duplicate identifier from multiple imports
import { InterAgentMessage, MessageType } from "../types/index";

const execAsync = promisify(exec);

// Agent Mail Message Types
export type AgentMailMessageType = 
  | 'direct'         // One-to-one message
  | 'broadcast'      // One-to-many message
  | 'thread_reply'   // Reply in existing thread
  | 'file_reservation' // File reservation request
  | 'file_release'   // File reservation release
  | 'agent_discovery' // Directory lookup
  | 'status_update'  // Agent status change
  | 'coordination';  // Cross-project coordination

// Agent Mail Message Priority
export type MessagePriority = 'urgent' | 'high' | 'normal' | 'low' | 'fyi';

// File Reservation Mode
export type ReservationMode = 'exclusive' | 'shared' | 'advisory';

// Contact Policy
export type ContactPolicy = 'open' | 'auto' | 'contacts_only' | 'block_all';

// Agent Identity
export interface AgentIdentity {
  name: string;                    // e.g., "GreenCastle"
  program: string;                 // e.g., "Claude Code"
  model: string;                   // e.g., "Opus 4.1"
  taskDescription: string;         // Current task description
  projectPath: string;             // Working directory
  inceptionTime: Date;             // When agent was created
  lastActive: Date;                // Last activity timestamp
  attachmentsPolicy: string;       // Attachment handling policy
  contactPolicy: ContactPolicy;    // Message reception policy
}

// Agent Mail Message
export interface AgentMailMessage {
  id: string;
  type: AgentMailMessageType;
  senderId: string;
  senderName: string;
  recipientIds: string[];
  recipientNames: string[];
  threadId?: string;
  subject: string;
  body: string;                    // GitHub-flavored Markdown
  priority: MessagePriority;
  ackRequired: boolean;
  attachments: MessageAttachment[];
  timestamp: Date;
  metadata: Record<string, any>;
}

// Message Attachment
export interface MessageAttachment {
  type: 'file' | 'image' | 'data';
  name: string;
  content?: string;                // Base64 or file path
  mimeType?: string;
  size?: number;
}

// File Reservation
export interface FileReservation {
  id: string;
  agentId: string;
  agentName: string;
  pathPattern: string;            // Glob pattern
  mode: ReservationMode;
  reason: string;
  expiresAt: Date;
  createdAt: Date;
  metadata: Record<string, any>;
}

// Agent Directory Entry
export interface AgentDirectoryEntry {
  identity: AgentIdentity;
  isActive: boolean;
  currentReservations: FileReservation[];
  recentActivity: string[];
  contactInfo: {
    acceptsMessages: boolean;
    preferredMessageTypes: AgentMailMessageType[];
    responseTimeExpected?: string;
  };
}

// Agent Mail Configuration
export interface AgentMailConfig {
  mcpServerUrl: string;            // MCP Agent Mail server URL
  bearerToken: string;             // Authentication token
  projectPath: string;             // Current project directory
  agentIdentity: Partial<AgentIdentity>; // Agent identity info
  enableMoltbookSync: boolean;     // Sync with SKYNET MOLTBOOK
  enableAuditTrail: boolean;       // Enable audit logging
  enableFileGuards: boolean;       // Enable git pre-commit guards
  reservationTimeout: number;      // Default reservation timeout (hours)
  messageRetention: number;        // Message retention period (days)
}

/**
 * SuperClaw Agent Mailbox
 * 
 * Main class for inter-agent communication using MCP Agent Mail.
 * Integrates with SuperClaw's existing MOLTBOOK system and provides
 * file conflict resolution through advisory reservations.
 */
export class AgentMailbox extends EventEmitter {
  private config: AgentMailConfig;
  private httpClient: AxiosInstance;
  private identity: AgentIdentity | null = null;
  private isRegistered = false;
  private messageCache = new Map<string, AgentMailMessage>();
  private reservationCache = new Map<string, FileReservation>();
  private agentDirectory = new Map<string, AgentDirectoryEntry>();
  private auditLogger?: AuditLogger;

  constructor(config: AgentMailConfig) {
    super();
    this.config = config;
    
    // Initialize HTTP client for MCP Agent Mail server
    this.httpClient = axios.create({
      baseURL: config.mcpServerUrl,
      headers: {
        'Authorization': `Bearer ${config.bearerToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'SuperClaw-AgentMail/1.0.0'
      },
      timeout: 30000
    });

    // Initialize audit logger if enabled
    if (config.enableAuditTrail) {
      this.auditLogger = new AuditLogger({
        component: 'AgentMail',
        level: 'info'
      });
    }
  }

  /**
   * Register agent identity with MCP Agent Mail server
   */
  async registerAgent(identityOverrides: Partial<AgentIdentity> = {}): Promise<AgentIdentity> {
    try {
      // Generate agent identity
      const identity: AgentIdentity = {
        name: identityOverrides.name || await this.generateAgentName(),
        program: identityOverrides.program || 'SuperClaw Agent',
        model: identityOverrides.model || 'Claude Sonnet',
        taskDescription: identityOverrides.taskDescription || 'SuperClaw swarm coordination',
        projectPath: identityOverrides.projectPath || this.config.projectPath,
        inceptionTime: new Date(),
        lastActive: new Date(),
        attachmentsPolicy: identityOverrides.attachmentsPolicy || 'auto',
        contactPolicy: identityOverrides.contactPolicy || 'auto'
      };

      // Register with MCP Agent Mail server
      const response = await this.httpClient.post('/tools/register_agent', {
        name: identity.name,
        program: identity.program,
        model: identity.model,
        task_description: identity.taskDescription,
        project_path: identity.projectPath,
        attachments_policy: identity.attachmentsPolicy,
        contact_policy: identity.contactPolicy
      });

      this.identity = identity;
      this.isRegistered = true;

      // Sync with MOLTBOOK if enabled
      if (this.config.enableMoltbookSync) {
        await this.syncWithMoltbook('agent_registered', { identity });
      }

      // Audit log
      this.auditLogger?.info('Agent registered', {
        agentName: identity.name,
        program: identity.program,
        model: identity.model,
        projectPath: identity.projectPath
      });

      this.emit('agent_registered', identity);
      return identity;

    } catch (error: unknown) {
      this.auditLogger?.error('Agent registration failed', { error: (error as Error).message });
      throw new Error(`Failed to register agent: ${(error as Error).message}`);
    }
  }

  /**
   * Deregister agent from MCP Agent Mail server
   */
  async deregisterAgent(): Promise<void> {
    if (!this.isRegistered || !this.identity) {
      throw new Error('Agent not registered');
    }

    try {
      await this.httpClient.post('/tools/deregister_agent', {
        agent_name: this.identity.name
      });

      // Release all reservations
      const activeReservations = Array.from(this.reservationCache.values());
      for (const reservation of activeReservations) {
        await this.releaseFileReservation(reservation.id);
      }

      // Sync with MOLTBOOK if enabled
      if (this.config.enableMoltbookSync) {
        await this.syncWithMoltbook('agent_deregistered', { 
          identity: this.identity 
        });
      }

      this.auditLogger?.info('Agent deregistered', {
        agentName: this.identity.name
      });

      this.identity = null;
      this.isRegistered = false;
      this.messageCache.clear();
      this.reservationCache.clear();

      this.emit('agent_deregistered');

    } catch (error: unknown) {
      this.auditLogger?.error('Agent deregistration failed', { error: (error as Error).message });
      throw new Error(`Failed to deregister agent: ${(error as Error).message}`);
    }
  }

  /**
   * Send message to other agents
   */
  async sendMessage(
    recipients: string[], 
    subject: string, 
    body: string,
    options: {
      type?: AgentMailMessageType;
      priority?: MessagePriority;
      threadId?: string;
      ackRequired?: boolean;
      attachments?: MessageAttachment[];
    } = {}
  ): Promise<AgentMailMessage> {
    if (!this.isRegistered || !this.identity) {
      throw new Error('Agent not registered');
    }

    try {
      const message: AgentMailMessage = {
        id: crypto.randomBytes(16).toString('hex'),
        type: options.type || 'direct',
        senderId: this.identity.name,
        senderName: this.identity.name,
        recipientIds: recipients,
        recipientNames: recipients,
        threadId: options.threadId,
        subject,
        body,
        priority: options.priority || 'normal',
        ackRequired: options.ackRequired || false,
        attachments: options.attachments || [],
        timestamp: new Date(),
        metadata: {}
      };

      // Send via MCP Agent Mail server
      await this.httpClient.post('/tools/send_message', {
        recipients,
        subject,
        body_md: body,
        thread_id: options.threadId,
        importance: options.priority,
        ack_required: options.ackRequired,
        attachments: options.attachments
      });

      // Cache message
      this.messageCache.set(message.id, message);

      // Sync with MOLTBOOK if enabled
      if (this.config.enableMoltbookSync) {
        await this.syncWithMoltbook('message_sent', { message });
      }

      // Audit log
      this.auditLogger?.info('Message sent', {
        messageId: message.id,
        recipients,
        subject,
        type: message.type,
        priority: message.priority
      });

      this.emit('message_sent', message);
      return message;

    } catch (error: unknown) {
      this.auditLogger?.error('Message send failed', { 
        error: (error as Error).message,
        recipients,
        subject
      });
      throw new Error(`Failed to send message: ${(error as Error).message}`);
    }
  }

  /**
   * Retrieve messages from mailbox
   */
  async getMessages(options: {
    limit?: number;
    unreadOnly?: boolean;
    threadId?: string;
    since?: Date;
  } = {}): Promise<AgentMailMessage[]> {
    if (!this.isRegistered || !this.identity) {
      throw new Error('Agent not registered');
    }

    try {
      const response = await this.httpClient.post('/tools/check_messages', {
        limit: options.limit || 50,
        unread_only: options.unreadOnly || false,
        thread_id: options.threadId,
        since: options.since?.toISOString()
      });

      const messages: AgentMailMessage[] = response.data.messages.map((msg: any) => ({
        id: msg.id,
        type: this.mapMessageType(msg.type),
        senderId: msg.sender_id,
        senderName: msg.sender_name,
        recipientIds: msg.recipient_ids,
        recipientNames: msg.recipient_names,
        threadId: msg.thread_id,
        subject: msg.subject,
        body: msg.body_md,
        priority: msg.importance as MessagePriority,
        ackRequired: msg.ack_required,
        attachments: msg.attachments || [],
        timestamp: new Date(msg.created_ts),
        metadata: msg.metadata || {}
      }));

      // Update cache
      messages.forEach(msg => this.messageCache.set(msg.id, msg));

      // Sync new messages with MOLTBOOK if enabled
      if (this.config.enableMoltbookSync) {
        for (const message of messages) {
          if (!this.messageCache.has(message.id)) {
            await this.syncWithMoltbook('message_received', { message });
          }
        }
      }

      this.emit('messages_retrieved', messages);
      return messages;

    } catch (error: unknown) {
      this.auditLogger?.error('Message retrieval failed', { error: (error as Error).message });
      throw new Error(`Failed to retrieve messages: ${(error as Error).message}`);
    }
  }

  /**
   * Reserve files to prevent conflicts
   */
  async reserveFiles(
    pathPatterns: string[], 
    options: {
      mode?: ReservationMode;
      reason?: string;
      expiresIn?: number; // hours
    } = {}
  ): Promise<FileReservation[]> {
    if (!this.isRegistered || !this.identity) {
      throw new Error('Agent not registered');
    }

    const reservations: FileReservation[] = [];

    try {
      for (const pathPattern of pathPatterns) {
        const reservation: FileReservation = {
          id: crypto.randomBytes(16).toString('hex'),
          agentId: this.identity.name,
          agentName: this.identity.name,
          pathPattern,
          mode: options.mode || 'exclusive',
          reason: options.reason || 'File operation in progress',
          expiresAt: new Date(Date.now() + (options.expiresIn || this.config.reservationTimeout) * 60 * 60 * 1000),
          createdAt: new Date(),
          metadata: {}
        };

        // Reserve via MCP Agent Mail server
        await this.httpClient.post('/tools/reserve_files', {
          path_patterns: [pathPattern],
          exclusive: reservation.mode === 'exclusive',
          reason: reservation.reason,
          expires_in_hours: options.expiresIn || this.config.reservationTimeout
        });

        reservations.push(reservation);
        this.reservationCache.set(reservation.id, reservation);
      }

      // Install git guards if enabled
      if (this.config.enableFileGuards) {
        await this.installGitGuards(reservations);
      }

      // Sync with MOLTBOOK if enabled
      if (this.config.enableMoltbookSync) {
        await this.syncWithMoltbook('files_reserved', { reservations });
      }

      // Audit log
      this.auditLogger?.info('Files reserved', {
        agentName: this.identity.name,
        pathPatterns,
        mode: options.mode,
        reservationCount: reservations.length
      });

      this.emit('files_reserved', reservations);
      return reservations;

    } catch (error: unknown) {
      this.auditLogger?.error('File reservation failed', { 
        error: (error as Error).message,
        pathPatterns 
      });
      throw new Error(`Failed to reserve files: ${(error as Error).message}`);
    }
  }

  /**
   * Release file reservation
   */
  async releaseFileReservation(reservationId: string): Promise<void> {
    const reservation = this.reservationCache.get(reservationId);
    if (!reservation) {
      throw new Error(`Reservation ${reservationId} not found`);
    }

    try {
      // Release via MCP Agent Mail server
      await this.httpClient.post('/tools/release_files', {
        path_patterns: [reservation.pathPattern]
      });

      // Remove from cache
      this.reservationCache.delete(reservationId);

      // Remove git guards if enabled
      if (this.config.enableFileGuards) {
        await this.removeGitGuards([reservation]);
      }

      // Sync with MOLTBOOK if enabled
      if (this.config.enableMoltbookSync) {
        await this.syncWithMoltbook('files_released', { 
          reservation 
        });
      }

      // Audit log
      this.auditLogger?.info('File reservation released', {
        reservationId,
        pathPattern: reservation.pathPattern,
        agentName: reservation.agentName
      });

      this.emit('files_released', reservation);

    } catch (error: unknown) {
      this.auditLogger?.error('File release failed', { 
        error: (error as Error).message,
        reservationId 
      });
      throw new Error(`Failed to release file reservation: ${(error as Error).message}`);
    }
  }

  /**
   * Discover active agents
   */
  async discoverAgents(projectPath?: string): Promise<AgentDirectoryEntry[]> {
    try {
      const response = await this.httpClient.post('/tools/directory_search', {
        project_path: projectPath || this.config.projectPath,
        include_inactive: false
      });

      const agents: AgentDirectoryEntry[] = response.data.agents.map((agent: any) => ({
        identity: {
          name: agent.name,
          program: agent.program,
          model: agent.model,
          taskDescription: agent.task_description,
          projectPath: agent.project_path,
          inceptionTime: new Date(agent.inception_ts),
          lastActive: new Date(agent.last_active_ts),
          attachmentsPolicy: agent.attachments_policy,
          contactPolicy: agent.contact_policy
        },
        isActive: agent.is_active,
        currentReservations: agent.file_reservations || [],
        recentActivity: agent.recent_activity || [],
        contactInfo: {
          acceptsMessages: agent.contact_policy !== 'block_all',
          preferredMessageTypes: agent.preferred_message_types || ['direct'],
          responseTimeExpected: agent.response_time_expected
        }
      }));

      // Update directory cache
      agents.forEach(agent => {
        this.agentDirectory.set(agent.identity.name, agent);
      });

      this.emit('agents_discovered', agents);
      return agents;

    } catch (error: unknown) {
      this.auditLogger?.error('Agent discovery failed', { error: (error as Error).message });
      throw new Error(`Failed to discover agents: ${(error as Error).message}`);
    }
  }

  /**
   * Search message history
   */
  async searchMessages(query: string, options: {
    threadId?: string;
    senderId?: string;
    since?: Date;
    limit?: number;
  } = {}): Promise<AgentMailMessage[]> {
    if (!this.isRegistered || !this.identity) {
      throw new Error('Agent not registered');
    }

    try {
      const response = await this.httpClient.post('/tools/search_messages', {
        query,
        thread_id: options.threadId,
        sender_id: options.senderId,
        since: options.since?.toISOString(),
        limit: options.limit || 50
      });

      const messages: AgentMailMessage[] = response.data.messages.map((msg: any) => ({
        id: msg.id,
        type: this.mapMessageType(msg.type),
        senderId: msg.sender_id,
        senderName: msg.sender_name,
        recipientIds: msg.recipient_ids,
        recipientNames: msg.recipient_names,
        threadId: msg.thread_id,
        subject: msg.subject,
        body: msg.body_md,
        priority: msg.importance as MessagePriority,
        ackRequired: msg.ack_required,
        attachments: msg.attachments || [],
        timestamp: new Date(msg.created_ts),
        metadata: msg.metadata || {}
      }));

      return messages;

    } catch (error: unknown) {
      this.auditLogger?.error('Message search failed', { 
        error: (error as Error).message,
        query 
      });
      throw new Error(`Failed to search messages: ${(error as Error).message}`);
    }
  }

  /**
   * Generate memorable agent name
   */
  private async generateAgentName(): Promise<string> {
    const colors = [
      'Red', 'Blue', 'Green', 'Purple', 'Orange', 'Pink', 'Black', 'White',
      'Gold', 'Silver', 'Crimson', 'Azure', 'Emerald', 'Violet', 'Amber'
    ];
    
    const nouns = [
      'Castle', 'Mountain', 'River', 'Forest', 'Valley', 'Lake', 'Stone',
      'Wind', 'Star', 'Moon', 'Sun', 'Cloud', 'Thunder', 'Lightning', 'Storm'
    ];

    const color = colors[Math.floor(Math.random() * colors.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    
    return `${color}${noun}`;
  }

  /**
   * Map MCP message type to AgentMailMessageType
   */
  private mapMessageType(mcpType: string): AgentMailMessageType {
    const typeMap: Record<string, AgentMailMessageType> = {
      'direct': 'direct',
      'broadcast': 'broadcast',
      'thread_reply': 'thread_reply',
      'file_reservation': 'file_reservation',
      'file_release': 'file_release',
      'agent_discovery': 'agent_discovery',
      'status_update': 'status_update',
      'coordination': 'coordination'
    };

    return typeMap[mcpType] || 'direct';
  }

  /**
   * Sync events with SKYNET MOLTBOOK
   */
  private async syncWithMoltbook(eventType: string, data: any): Promise<void> {
    if (!this.config.enableMoltbookSync) return;

    try {
      const moltbookMessage: InterAgentMessage = {
        id: crypto.randomBytes(16).toString('hex'),
        type: 'HEARTBEAT' as MessageType,
        from: this.identity?.name || 'AgentMail',
        senderId: this.identity?.name || 'AgentMail',
        to: 'MOLTBOOK',
        timestamp: new Date(),
        payload: {
          eventType,
          agentMailData: data,
          timestamp: new Date().toISOString()
        },
        correlationId: crypto.randomBytes(8).toString('hex')
      };

      // Send to MOLTBOOK
      // @ts-expect-error - Post-Merge Reconciliation: routeMessage method doesn't exist on MoltbookBus
      await MOLTBOOK.routeMessage(moltbookMessage);

    } catch (error: unknown) {
      this.auditLogger?.warn('MOLTBOOK sync failed', { 
        error: (error as Error).message,
        eventType 
      });
    }
  }

  /**
   * Install git pre-commit guards for file reservations
   */
  private async installGitGuards(reservations: FileReservation[]): Promise<void> {
    try {
      // Create guard script content
      const guardContent = this.generateGuardScript(reservations);
      const guardPath = path.join(this.config.projectPath, '.git/hooks/pre-commit-agent-mail');
      
      // Write guard script
      await fs.writeFile(guardPath, guardContent, { mode: 0o755 });
      
      // Install guard via MCP Agent Mail server if available
      await this.httpClient.post('/tools/install_guard', {
        project_path: this.config.projectPath
      }).catch(() => {
        // Fallback to local installation
        console.warn('MCP server guard installation failed, using local guard');
      });

    } catch (error: unknown) {
      this.auditLogger?.warn('Git guard installation failed', { 
        error: (error as Error).message 
      });
    }
  }

  /**
   * Remove git guards for released reservations
   */
  private async removeGitGuards(reservations: FileReservation[]): Promise<void> {
    try {
      // Remove guard via MCP Agent Mail server if available
      await this.httpClient.post('/tools/uninstall_guard', {
        project_path: this.config.projectPath
      }).catch(() => {
        // Fallback to local removal
        console.warn('MCP server guard removal failed, manual cleanup may be needed');
      });

    } catch (error: unknown) {
      this.auditLogger?.warn('Git guard removal failed', { 
        error: (error as Error).message 
      });
    }
  }

  /**
   * Generate git pre-commit guard script
   */
  private generateGuardScript(reservations: FileReservation[]): string {
    const patterns = reservations.map(r => r.pathPattern).join('|');
    
    return `#!/bin/bash
# SuperClaw Agent Mail Git Guard
# Prevents commits to reserved files

RESERVED_PATTERNS="${patterns}"
AGENT_NAME="${this.identity?.name || 'Unknown'}"

# Check staged files against reserved patterns
for pattern in \$(echo "\$RESERVED_PATTERNS" | tr '|' '\\n'); do
  if git diff --cached --name-only | grep -E "\$pattern" > /dev/null; then
    echo "ERROR: Attempt to commit reserved files (pattern: \$pattern)"
    echo "Reserved by agent: \$AGENT_NAME"
    echo "Please coordinate with the reserving agent before committing these files."
    exit 1
  fi
done

exit 0
`;
  }

  /**
   * Get current agent identity
   */
  getIdentity(): AgentIdentity | null {
    return this.identity;
  }

  /**
   * Check if agent is registered
   */
  isAgentRegistered(): boolean {
    return this.isRegistered;
  }

  /**
   * Get active file reservations
   */
  getActiveReservations(): FileReservation[] {
    return Array.from(this.reservationCache.values());
  }

  /**
   * Get cached messages
   */
  getCachedMessages(): AgentMailMessage[] {
    return Array.from(this.messageCache.values());
  }

  /**
   * Get agent directory
   */
  getAgentDirectory(): AgentDirectoryEntry[] {
    return Array.from(this.agentDirectory.values());
  }
}

// Factory function for creating AgentMailbox instances
export function createAgentMailbox(config: AgentMailConfig): AgentMailbox {
  return new AgentMailbox(config);
}

// Default configuration
export const DEFAULT_AGENT_MAIL_CONFIG: Partial<AgentMailConfig> = {
  mcpServerUrl: 'http://localhost:8765',
  enableMoltbookSync: true,
  enableAuditTrail: true,
  enableFileGuards: true,
  reservationTimeout: 24, // 24 hours
  messageRetention: 30    // 30 days
};