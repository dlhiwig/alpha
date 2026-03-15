/**
 * 🦊 SuperClaw Agent Mail Types
 * 
 * TypeScript type definitions for inter-agent communication
 * using MCP Agent Mail integration.
 */

// Re-export main types from agent-mail.ts
export type {
  AgentMailMessageType,
  MessagePriority,
  ReservationMode,
  ContactPolicy,
  AgentIdentity,
  AgentMailMessage,
  MessageAttachment,
  FileReservation,
  AgentDirectoryEntry,
  AgentMailConfig
} from './agent-mail';

// Re-export integration configuration
export type {
  IntegrationConfig
} from './integration';

// Additional communication-specific types

// Message Thread
export interface MessageThread {
  id: string;
  subject: string;
  participantIds: string[];
  participantNames: string[];
  messageCount: number;
  lastActivity: Date;
  isArchived: boolean;
  metadata: Record<string, any>;
}

// Agent Status
export type AgentStatus = 
  | 'active'
  | 'idle' 
  | 'busy'
  | 'offline'
  | 'error'
  | 'deregistered';

// Communication Event
export interface CommunicationEvent {
  id: string;
  type: 'message' | 'reservation' | 'agent_status' | 'directory_update';
  agentId: string;
  agentName: string;
  timestamp: Date;
  data: any;
  metadata: Record<string, any>;
}

// Message Acknowledgment
export interface MessageAcknowledgment {
  messageId: string;
  recipientId: string;
  recipientName: string;
  acknowledgedAt: Date;
  response?: string;
}

// Cross-Project Coordination
export interface CrossProjectMessage {
  sourceProjectId: string;
  targetProjectId: string;
  coordinationType: 'dependency' | 'integration' | 'resource_sharing' | 'sync';
  // @ts-expect-error - Post-Merge Reconciliation
  message: AgentMailMessage;
  approvalRequired: boolean;
  approvedBy?: string[];
}

// File Conflict Resolution
export interface FileConflictInfo {
  filePath: string;
  conflictingAgents: string[];
  // @ts-expect-error - Post-Merge Reconciliation
  reservations: FileReservation[];
  suggestedResolution: 'queue' | 'split' | 'coordinate' | 'escalate';
  resolutionMetadata: Record<string, any>;
}

// Agent Coordination Request
export interface CoordinationRequest {
  id: string;
  requesterId: string;
  requesterName: string;
  targetAgentIds: string[];
  coordinationType: 'file_access' | 'task_handoff' | 'resource_sharing' | 'sync';
  details: string;
  // @ts-expect-error - Post-Merge Reconciliation
  priority: MessagePriority;
  expiresAt: Date;
  responses: CoordinationResponse[];
  status: 'pending' | 'approved' | 'rejected' | 'expired';
}

// Coordination Response
export interface CoordinationResponse {
  agentId: string;
  agentName: string;
  response: 'approve' | 'reject' | 'defer';
  message?: string;
  respondedAt: Date;
}

// Message Search Query
export interface MessageSearchQuery {
  text?: string;
  senderId?: string;
  recipientId?: string;
  threadId?: string;
  // @ts-expect-error - Post-Merge Reconciliation
  messageType?: AgentMailMessageType;
  // @ts-expect-error - Post-Merge Reconciliation
  priority?: MessagePriority;
  dateFrom?: Date;
  dateTo?: Date;
  hasAttachments?: boolean;
  isUnread?: boolean;
  requiresAck?: boolean;
}

// Message Search Result
export interface MessageSearchResult {
  // @ts-expect-error - Post-Merge Reconciliation
  messages: AgentMailMessage[];
  totalCount: number;
  hasMore: boolean;
  searchDuration: number;
  relevanceScores?: number[];
}

// Agent Discovery Query
export interface AgentDiscoveryQuery {
  projectPath?: string;
  program?: string;
  model?: string;
  taskKeywords?: string[];
  // @ts-expect-error - Post-Merge Reconciliation
  contactPolicy?: ContactPolicy;
  isActive?: boolean;
  hasReservations?: boolean;
  lastActiveAfter?: Date;
}

// Audit Trail Entry
export interface AuditTrailEntry {
  id: string;
  timestamp: Date;
  agentId: string;
  agentName: string;
  action: 'register' | 'deregister' | 'send_message' | 'receive_message' | 
          'reserve_files' | 'release_files' | 'search' | 'discover' | 'error';
  details: Record<string, any>;
  success: boolean;
  error?: string;
  correlationId?: string;
}

// Communication Statistics
export interface CommunicationStats {
  agentId: string;
  agentName: string;
  messagesSent: number;
  messagesReceived: number;
  filesReserved: number;
  filesReleased: number;
  averageResponseTime: number; // milliseconds
  collaboratingAgents: string[];
  activeReservations: number;
  lastActivity: Date;
  uptime: number; // milliseconds
}

// Swarm Communication State
export interface SwarmCommunicationState {
  activeAgents: number;
  totalMessages: number;
  activeReservations: number;
  crossProjectLinks: number;
  coordinationRequests: number;
  lastSyncTime: Date;
  health: 'healthy' | 'degraded' | 'unhealthy';
  issues: string[];
}

// Message Template
export interface MessageTemplate {
  id: string;
  name: string;
  description: string;
  subject: string;
  bodyTemplate: string; // Markdown with placeholders
  // @ts-expect-error - Post-Merge Reconciliation
  defaultPriority: MessagePriority;
  requiredFields: string[];
  optionalFields: string[];
  category: 'coordination' | 'status' | 'error' | 'handoff' | 'custom';
}

// Agent Mail Webhook Event
export interface AgentMailWebhookEvent {
  type: 'message_received' | 'message_sent' | 'agent_registered' | 
        'agent_deregistered' | 'files_reserved' | 'files_released' |
        'conflict_detected' | 'resolution_required';
  agentId: string;
  projectId: string;
  data: any;
  timestamp: Date;
  signature?: string; // HMAC signature for verification
}

// Error Types
export class AgentMailError extends Error {
  constructor(
    message: string,
    public code: string,
    public recoverable: boolean = true,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = 'AgentMailError';
  }
}

export class ReservationConflictError extends AgentMailError {
  constructor(
    message: string,
    // @ts-expect-error - Post-Merge Reconciliation
    public conflictingReservations: FileReservation[],
    public suggestedResolution?: string
  ) {
    super(message, 'RESERVATION_CONFLICT', true, {
      conflictingReservations,
      suggestedResolution
    });
  }
}

export class AgentNotFoundError extends AgentMailError {
  constructor(agentId: string) {
    super(`Agent not found: ${agentId}`, 'AGENT_NOT_FOUND', false, { agentId });
  }
}

export class MessageDeliveryError extends AgentMailError {
  constructor(
    message: string,
    public messageId: string,
    public failedRecipients: string[]
  ) {
    super(message, 'MESSAGE_DELIVERY_FAILED', true, {
      messageId,
      failedRecipients
    });
  }
}