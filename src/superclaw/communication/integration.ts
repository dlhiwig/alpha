// @ts-nocheck
/**
 * 🦊 SuperClaw Agent Mail Integration Layer
 * 
 * Connects MCP Agent Mail with SuperClaw's existing infrastructure:
 * - SKYNET MOLTBOOK pub/sub system
 * - SuperClaw agent lifecycle management
 * - Audit trail system
 * - Git repository management
 * - Cross-project coordination
 * 
 * This integration layer ensures seamless communication between
 * SuperClaw agents and external agents using MCP Agent Mail protocol.
 */

import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs/promises';

// SuperClaw imports
import { MOLTBOOK } from '../skynet/moltbook';
import { AuditLogger } from '../security/AuditLogger';
// Agent Mail imports
import { AgentMailbox } from './agent-mail';
import type {
  AgentMailConfig,
  AgentIdentity,
  AgentMailMessage,
  FileReservation,
  AgentDirectoryEntry,
  CommunicationEvent,
  SwarmCommunicationState,
  CoordinationRequest
} from './types';
import {
  generateCorrelationId,
  formatMessage,
  createAuditTrailEntry,
  formatAgentDirectory,
  formatReservationSummary
} from './utils';
import { InterAgentMessage } from "../types/index";

/**
 * Integration Configuration
 */
export interface IntegrationConfig {
  // MCP Agent Mail settings
  mcpServerUrl: string;
  bearerToken: string;
  
  // SuperClaw integration settings
  enableMoltbookBridge: boolean;
  enableAuditIntegration: boolean;
  enableGitIntegration: boolean;
  enableCrossProjectCoordination: boolean;
  
  // Performance settings
  syncInterval: number;           // milliseconds
  messageBufferSize: number;
  reservationCheckInterval: number; // milliseconds
  
  // Project settings
  projectPath: string;
  agentName?: string;
  agentProgram?: string;
  agentModel?: string;
  taskDescription?: string;
}

/**
 * SuperClaw Agent Mail Integration Manager
 * 
 * Main integration class that bridges MCP Agent Mail with SuperClaw infrastructure.
 * Handles agent lifecycle, message routing, file coordination, and audit trails.
 */
export class AgentMailIntegration extends EventEmitter {
  private config: IntegrationConfig;
  private mailbox: AgentMailbox | null = null;
  private auditLogger: AuditLogger;
  private isInitialized = false;
  private syncTimer: NodeJS.Timeout | null = null;
  private reservationTimer: NodeJS.Timeout | null = null;
  
  // State tracking
  private communicationState: SwarmCommunicationState = {
    activeAgents: 0,
    totalMessages: 0,
    activeReservations: 0,
    crossProjectLinks: 0,
    coordinationRequests: 0,
    lastSyncTime: new Date(),
    health: 'healthy',
    issues: []
  };
  
  private messageBuffer: AgentMailMessage[] = [];
  private eventHistory: CommunicationEvent[] = [];

  constructor(config: IntegrationConfig) {
    super();
    this.config = config;
    
    // Initialize audit logger
    this.auditLogger = new AuditLogger({
      logPath: path.join(process.cwd(), 'data', 'agent-mail-integration.log')
    });
  }

  /**
   * Initialize the Agent Mail integration
   */
  async initialize(): Promise<void> {
    try {
      this.auditLogger.info('Initializing Agent Mail integration', {
        mcpServerUrl: this.config.mcpServerUrl,
        projectPath: this.config.projectPath
      });

      // Create Agent Mailbox configuration
      const mailboxConfig: AgentMailConfig = {
        mcpServerUrl: this.config.mcpServerUrl,
        bearerToken: this.config.bearerToken,
        projectPath: this.config.projectPath,
        agentIdentity: {
          name: this.config.agentName,
          program: this.config.agentProgram || 'SuperClaw',
          model: this.config.agentModel || 'Claude Sonnet',
          taskDescription: this.config.taskDescription || 'SuperClaw swarm coordination',
          projectPath: this.config.projectPath
        },
        enableMoltbookSync: this.config.enableMoltbookBridge,
        enableAuditTrail: this.config.enableAuditIntegration,
        enableFileGuards: this.config.enableGitIntegration,
        reservationTimeout: 24,
        messageRetention: 30
      };

      // Create and initialize mailbox
      this.mailbox = new AgentMailbox(mailboxConfig);
      
      // Set up event listeners
      this.setupEventListeners();
      
      // Register agent
      const identity = await this.mailbox.registerAgent();
      
      // Set up MOLTBOOK bridge if enabled
      if (this.config.enableMoltbookBridge) {
        await this.setupMoltbookBridge();
      }
      
      // Start periodic tasks
      this.startPeriodicTasks();
      
      this.isInitialized = true;
      this.communicationState.health = 'healthy';
      
      this.auditLogger.info('Agent Mail integration initialized successfully', {
        agentName: identity.name,
        agentProgram: identity.program
      });
      
      this.emit('initialized', identity);

    } catch (error: unknown) {
      this.auditLogger.error('Agent Mail integration initialization failed', {
        error: (error as Error).message
      });
      
      this.communicationState.health = 'unhealthy';
      this.communicationState.issues.push(`Initialization failed: ${(error as Error).message}`);
      
      throw new Error(`Failed to initialize Agent Mail integration: ${(error as Error).message}`, { cause: error });
    }
  }

  /**
   * Shutdown the integration gracefully
   */
  async shutdown(): Promise<void> {
    try {
      this.auditLogger.info('Shutting down Agent Mail integration');
      
      // Stop periodic tasks
      if (this.syncTimer) {
        clearInterval(this.syncTimer);
        this.syncTimer = null;
      }
      
      if (this.reservationTimer) {
        clearInterval(this.reservationTimer);
        this.reservationTimer = null;
      }
      
      // Deregister agent
      if (this.mailbox && this.mailbox.isAgentRegistered()) {
        await this.mailbox.deregisterAgent();
      }
      
      this.isInitialized = false;
      this.communicationState.health = 'unhealthy';
      
      this.auditLogger.info('Agent Mail integration shutdown completed');
      this.emit('shutdown');

    } catch (error: unknown) {
      this.auditLogger.error('Agent Mail integration shutdown failed', {
        error: (error as Error).message
      });
      throw error;
    }
  }

  /**
   * Send message to other agents
   */
  async sendMessage(
    recipients: string[],
    subject: string,
    body: string,
    options: any = {}
  ): Promise<AgentMailMessage> {
    if (!this.isInitialized || !this.mailbox) {
      throw new Error('Agent Mail integration not initialized');
    }

    try {
      const message = await this.mailbox.sendMessage(recipients, subject, body, options);
      
      // Update state
      this.communicationState.totalMessages++;
      this.messageBuffer.push(message);
      
      // Trim buffer if needed
      if (this.messageBuffer.length > this.config.messageBufferSize) {
        this.messageBuffer = this.messageBuffer.slice(-this.config.messageBufferSize);
      }
      
      // Create event
      const event: CommunicationEvent = {
        id: generateCorrelationId(),
        type: 'message',
        agentId: message.senderId,
        agentName: message.senderName,
        timestamp: new Date(),
        data: { message, recipients },
        metadata: { correlationId: generateCorrelationId() }
      };
      
      this.addEvent(event);
      this.emit('message_sent', message);
      
      return message;

    } catch (error: unknown) {
      this.auditLogger.error('Failed to send message', {
        error: (error as Error).message,
        recipients,
        subject
      });
      throw error;
    }
  }

  /**
   * Check for new messages
   */
  async checkMessages(options: any = {}): Promise<AgentMailMessage[]> {
    if (!this.isInitialized || !this.mailbox) {
      throw new Error('Agent Mail integration not initialized');
    }

    try {
      const messages = await this.mailbox.getMessages(options);
      
      // Process new messages
      for (const message of messages) {
        if (!this.messageBuffer.some(m => m.id === message.id)) {
          this.messageBuffer.push(message);
          
          // Create event
          const event: CommunicationEvent = {
            id: generateCorrelationId(),
            type: 'message',
            agentId: message.senderId,
            agentName: message.senderName,
            timestamp: new Date(),
            data: { message },
            metadata: { correlationId: generateCorrelationId() }
          };
          
          this.addEvent(event);
          this.emit('message_received', message);
        }
      }
      
      // Trim buffer if needed
      if (this.messageBuffer.length > this.config.messageBufferSize) {
        this.messageBuffer = this.messageBuffer.slice(-this.config.messageBufferSize);
      }
      
      return messages;

    } catch (error: unknown) {
      this.auditLogger.error('Failed to check messages', {
        error: (error as Error).message
      });
      throw error;
    }
  }

  /**
   * Reserve files for coordination
   */
  async reserveFiles(
    pathPatterns: string[],
    options: any = {}
  ): Promise<FileReservation[]> {
    if (!this.isInitialized || !this.mailbox) {
      throw new Error('Agent Mail integration not initialized');
    }

    try {
      const reservations = await this.mailbox.reserveFiles(pathPatterns, options);
      
      // Update state
      this.communicationState.activeReservations += reservations.length;
      
      // Create event
      const event: CommunicationEvent = {
        id: generateCorrelationId(),
        type: 'reservation',
        agentId: this.mailbox.getIdentity()?.name || 'unknown',
        agentName: this.mailbox.getIdentity()?.name || 'unknown',
        timestamp: new Date(),
        data: { reservations, pathPatterns },
        metadata: { correlationId: generateCorrelationId() }
      };
      
      this.addEvent(event);
      this.emit('files_reserved', reservations);
      
      return reservations;

    } catch (error: unknown) {
      this.auditLogger.error('Failed to reserve files', {
        error: (error as Error).message,
        pathPatterns
      });
      throw error;
    }
  }

  /**
   * Release file reservation
   */
  async releaseReservation(reservationId: string): Promise<void> {
    if (!this.isInitialized || !this.mailbox) {
      throw new Error('Agent Mail integration not initialized');
    }

    try {
      await this.mailbox.releaseFileReservation(reservationId);
      
      // Update state
      this.communicationState.activeReservations = Math.max(0, this.communicationState.activeReservations - 1);
      
      // Create event
      const event: CommunicationEvent = {
        id: generateCorrelationId(),
        type: 'reservation',
        agentId: this.mailbox.getIdentity()?.name || 'unknown',
        agentName: this.mailbox.getIdentity()?.name || 'unknown',
        timestamp: new Date(),
        data: { reservationId, action: 'released' },
        metadata: { correlationId: generateCorrelationId() }
      };
      
      this.addEvent(event);
      this.emit('reservation_released', reservationId);

    } catch (error: unknown) {
      this.auditLogger.error('Failed to release reservation', {
        error: (error as Error).message,
        reservationId
      });
      throw error;
    }
  }

  /**
   * Discover active agents
   */
  async discoverAgents(projectPath?: string): Promise<AgentDirectoryEntry[]> {
    if (!this.isInitialized || !this.mailbox) {
      throw new Error('Agent Mail integration not initialized');
    }

    try {
      const agents = await this.mailbox.discoverAgents(projectPath);
      
      // Update state
      this.communicationState.activeAgents = agents.filter(a => a.isActive).length;
      
      // Create event
      const event: CommunicationEvent = {
        id: generateCorrelationId(),
        type: 'directory_update',
        agentId: this.mailbox.getIdentity()?.name || 'unknown',
        agentName: this.mailbox.getIdentity()?.name || 'unknown',
        timestamp: new Date(),
        data: { agents, agentCount: agents.length },
        metadata: { correlationId: generateCorrelationId() }
      };
      
      this.addEvent(event);
      this.emit('agents_discovered', agents);
      
      return agents;

    } catch (error: unknown) {
      this.auditLogger.error('Failed to discover agents', {
        error: (error as Error).message,
        projectPath
      });
      throw error;
    }
  }

  /**
   * Get current agent identity
   */
  getAgentIdentity(): AgentIdentity | null {
    return this.mailbox?.getIdentity() || null;
  }

  /**
   * Get current communication state
   */
  getCommunicationState(): SwarmCommunicationState {
    this.communicationState.lastSyncTime = new Date();
    return { ...this.communicationState };
  }

  /**
   * Get recent events
   */
  getRecentEvents(limit: number = 50): CommunicationEvent[] {
    return this.eventHistory.slice(-limit);
  }

  /**
   * Get message buffer
   */
  getMessageBuffer(): AgentMailMessage[] {
    return [...this.messageBuffer];
  }

  /**
   * Get active reservations
   */
  getActiveReservations(): FileReservation[] {
    return this.mailbox?.getActiveReservations() || [];
  }

  /**
   * Generate status report
   */
  generateStatusReport(): string {
    const identity = this.getAgentIdentity();
    const state = this.getCommunicationState();
    const reservations = this.getActiveReservations();
    const agents = this.mailbox?.getAgentDirectory() || [];
    
    const report = [
      '🦊 **SuperClaw Agent Mail Status Report**',
      '',
      '**Agent Identity:**',
      identity ? `Name: ${identity.name}` : 'Not registered',
      identity ? `Program: ${identity.program} / ${identity.model}` : '',
      identity ? `Task: ${identity.taskDescription}` : '',
      '',
      '**Communication State:**',
      `Health: ${state.health}`,
      `Active Agents: ${state.activeAgents}`,
      `Total Messages: ${state.totalMessages}`,
      `Active Reservations: ${state.activeReservations}`,
      `Last Sync: ${state.lastSyncTime.toLocaleString()}`,
      '',
      formatAgentDirectory(agents),
      '',
      formatReservationSummary(reservations)
    ].filter(Boolean).join('\n');
    
    return report;
  }

  /**
   * Set up event listeners for the mailbox
   */
  private setupEventListeners(): void {
    if (!this.mailbox) {return;}

    this.mailbox.on('agent_registered', (identity) => {
      this.auditLogger.info('Agent registered', { identity });
    });

    this.mailbox.on('agent_deregistered', () => {
      this.auditLogger.info('Agent deregistered');
    });

    this.mailbox.on('message_sent', (message) => {
      this.auditLogger.info('Message sent via Agent Mail', {
        messageId: message.id,
        recipients: message.recipientNames
      });
    });

    this.mailbox.on('message_received', (message) => {
      this.auditLogger.info('Message received via Agent Mail', {
        messageId: message.id,
        sender: message.senderName
      });
    });

    this.mailbox.on('files_reserved', (reservations) => {
      this.auditLogger.info('Files reserved', {
        reservationCount: reservations.length
      });
    });

    this.mailbox.on('files_released', (reservation) => {
      this.auditLogger.info('File reservation released', {
        reservationId: reservation.id
      });
    });
  }

  /**
   * Set up bridge with SKYNET MOLTBOOK
   */
  private async setupMoltbookBridge(): Promise<void> {
    try {
      // Register message handler for MOLTBOOK messages
      // @ts-expect-error - Post-Merge Reconciliation
      MOLTBOOK.onMessage('agent_mail_sync', async (message: InterAgentMessage) => {
        try {
          await this.handleMoltbookMessage(message);
        } catch (error: unknown) {
          this.auditLogger.error('Failed to handle MOLTBOOK message', {
            error: (error as Error).message,
            messageId: message.id
          });
        }
      });

      // Register for broadcast messages
      // @ts-expect-error - Post-Merge Reconciliation
      MOLTBOOK.onMessage('broadcast', async (message: InterAgentMessage) => {
        try {
          // Forward relevant broadcasts to Agent Mail
          if (this.shouldForwardBroadcast(message)) {
            await this.forwardBroadcastToAgentMail(message);
          }
        } catch (error: unknown) {
          this.auditLogger.error('Failed to forward broadcast to Agent Mail', {
            error: (error as Error).message,
            messageId: message.id
          });
        }
      });

      this.auditLogger.info('MOLTBOOK bridge established');

    } catch (error: unknown) {
      this.auditLogger.error('Failed to setup MOLTBOOK bridge', {
        error: (error as Error).message
      });
      throw error;
    }
  }

  /**
   * Handle messages from MOLTBOOK
   */
  private async handleMoltbookMessage(message: InterAgentMessage): Promise<void> {
    // Process MOLTBOOK messages and sync with Agent Mail if relevant
    const eventType = message.payload?.eventType;
    
    if (eventType === 'agent_status_update' && this.mailbox) {
      // Notify other agents about status changes
      await this.sendMessage(
        ['broadcast'],
        'Agent Status Update',
        `Agent ${message.senderId} status update: ${JSON.stringify(message.payload)}`,
        { type: 'status_update', priority: 'fyi' }
      );
    }
  }

  /**
   * Check if broadcast should be forwarded to Agent Mail
   */
  private shouldForwardBroadcast(message: InterAgentMessage): boolean {
    // Only forward certain types of broadcasts
    const relevantTypes = ['coordination', 'file_conflict', 'task_handoff'];
    return relevantTypes.includes(message.payload?.type);
  }

  /**
   * Forward MOLTBOOK broadcast to Agent Mail
   */
  private async forwardBroadcastToAgentMail(message: InterAgentMessage): Promise<void> {
    if (!this.mailbox) {return;}

    await this.sendMessage(
      ['broadcast'],
      `MOLTBOOK: ${message.payload?.type || 'Broadcast'}`,
      `**From:** ${message.senderId}\n\n${JSON.stringify(message.payload, null, 2)}`,
      { type: 'broadcast', priority: 'normal' }
    );
  }

  /**
   * Start periodic tasks
   */
  private startPeriodicTasks(): void {
    // Message sync task
    this.syncTimer = setInterval(async () => {
      try {
        await this.checkMessages();
      } catch (error: unknown) {
        this.auditLogger.warn('Periodic message sync failed', {
          error: (error as Error).message
        });
      }
    }, this.config.syncInterval);

    // Reservation check task
    this.reservationTimer = setInterval(async () => {
      try {
        await this.checkReservationHealth();
      } catch (error: unknown) {
        this.auditLogger.warn('Reservation health check failed', {
          error: (error as Error).message
        });
      }
    }, this.config.reservationCheckInterval);
  }

  /**
   * Check reservation health and clean up expired ones
   */
  private async checkReservationHealth(): Promise<void> {
    const reservations = this.getActiveReservations();
    const now = new Date();
    
    for (const reservation of reservations) {
      if (reservation.expiresAt < now) {
        try {
          await this.releaseReservation(reservation.id);
          this.auditLogger.info('Released expired reservation', {
            reservationId: reservation.id,
            pathPattern: reservation.pathPattern
          });
        } catch (error: unknown) {
          this.auditLogger.warn('Failed to release expired reservation', {
            error: (error as Error).message,
            reservationId: reservation.id
          });
        }
      }
    }
  }

  /**
   * Add event to history
   */
  private addEvent(event: CommunicationEvent): void {
    this.eventHistory.push(event);
    
    // Keep only recent events
    if (this.eventHistory.length > 1000) {
      this.eventHistory = this.eventHistory.slice(-500);
    }
  }
}

/**
 * Factory function for creating Agent Mail integration
 */
export function createAgentMailIntegration(config: IntegrationConfig): AgentMailIntegration {
  return new AgentMailIntegration(config);
}

/**
 * Default integration configuration
 */
export const DEFAULT_INTEGRATION_CONFIG: Partial<IntegrationConfig> = {
  mcpServerUrl: 'http://localhost:8765',
  enableMoltbookBridge: true,
  enableAuditIntegration: true,
  enableGitIntegration: true,
  enableCrossProjectCoordination: true,
  syncInterval: 30000,        // 30 seconds
  messageBufferSize: 1000,
  reservationCheckInterval: 300000  // 5 minutes
};