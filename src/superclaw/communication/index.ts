/**
 * 🦊 SuperClaw Communication Module
 * 
 * Inter-agent communication layer for SuperClaw using MCP Agent Mail.
 * Provides Gmail-like coordination for agent swarms with file conflict
 * resolution, agent discovery, and audit trails.
 * 
 * Main exports:
 * - AgentMailbox: Core communication class
 * - AgentMailIntegration: SuperClaw integration layer
 * - Utility functions and types
 * 
 * Usage:
 * ```typescript
 * import { createAgentMailIntegration } from '../communication';
 * 
 * const integration = createAgentMailIntegration({
 *   mcpServerUrl: 'http://localhost:8765',
 *   bearerToken: 'your-token',
 *   projectPath: '/path/to/project',
 *   enableMoltbookBridge: true
 * });
 * 
 * await integration.initialize();
 * await integration.sendMessage(['RedCastle'], 'Hello', 'coordination message');
 * ```
 */

// Core classes
export { AgentMailbox, createAgentMailbox, DEFAULT_AGENT_MAIL_CONFIG } from './agent-mail';
export { 
  AgentMailIntegration, 
  createAgentMailIntegration, 
  DEFAULT_INTEGRATION_CONFIG
} from './integration';
export type { IntegrationConfig } from './integration';

// Import for internal usage
import type { IntegrationConfig } from './integration';

// Type definitions
export type {
  // Core types
  AgentMailMessageType,
  MessagePriority,
  ReservationMode,
  ContactPolicy,
  AgentIdentity,
  AgentMailMessage,
  MessageAttachment,
  FileReservation,
  AgentDirectoryEntry,
  AgentMailConfig,
  
  // Extended types
  MessageThread,
  AgentStatus,
  CommunicationEvent,
  MessageAcknowledgment,
  CrossProjectMessage,
  FileConflictInfo,
  CoordinationRequest,
  CoordinationResponse,
  MessageSearchQuery,
  MessageSearchResult,
  AgentDiscoveryQuery,
  AuditTrailEntry,
  CommunicationStats,
  SwarmCommunicationState,
  MessageTemplate,
  AgentMailWebhookEvent
} from './types';

// Error types
export {
  AgentMailError,
  ReservationConflictError,
  AgentNotFoundError,
  MessageDeliveryError
} from './types';

// Utility functions
export {
  generateCorrelationId,
  generateMessageId,
  generateReservationId,
  validateAgentName,
  sanitizeAgentName,
  generateMemorableAgentName,
  formatMessage,
  createThreadSummary,
  matchesReservationPattern,
  findMatchingFiles,
  checkReservationConflicts,
  getMessagePriorityScore,
  sortMessagesByPriority,
  filterMessages,
  formatAgentDirectory,
  formatReservationSummary,
  createMessageTemplate,
  applyMessageTemplate,
  validateTemplateVariables,
  parseMarkdownMetadata,
  createAuditTrailEntry,
  calculateUptime,
  formatUptime,
  createAgentSummary
} from './utils';

// Constants and defaults
export const AGENT_MAIL_CONSTANTS = {
  DEFAULT_SERVER_URL: 'http://localhost:8765',
  DEFAULT_PORT: 8765,
  DEFAULT_RESERVATION_TIMEOUT: 24 * 60 * 60 * 1000, // 24 hours in ms
  DEFAULT_MESSAGE_RETENTION: 30 * 24 * 60 * 60 * 1000, // 30 days in ms
  MAX_MESSAGE_SIZE: 1024 * 1024, // 1MB
  MAX_ATTACHMENT_SIZE: 10 * 1024 * 1024, // 10MB
  MAX_RESERVATION_PATTERNS: 100,
  MAX_RECIPIENTS: 50,
  DEFAULT_SYNC_INTERVAL: 30 * 1000, // 30 seconds
  DEFAULT_RESERVATION_CHECK_INTERVAL: 5 * 60 * 1000 // 5 minutes
} as const;

// Common message templates
export const MESSAGE_TEMPLATES = {
  COORDINATION_REQUEST: {
    subject: 'Coordination Request: {{task}}',
    body: `**Coordination Request**

**Task:** {{task}}
**Priority:** {{priority}}
**Estimated Duration:** {{duration}}

**Description:**
{{description}}

**Files Involved:**
{{files}}

**Please respond with:**
- [ ] Approve
- [ ] Reject  
- [ ] Need more info

**Contact:** {{sender}}`
  },
  
  STATUS_UPDATE: {
    subject: 'Status Update: {{status}}',
    body: `**Agent Status Update**

**Agent:** {{agent}}
**New Status:** {{status}}
**Timestamp:** {{timestamp}}

**Details:**
{{details}}

**Current Task:** {{task}}
**Progress:** {{progress}}%`
  },
  
  FILE_RESERVATION: {
    subject: 'File Reservation: {{files}}',
    body: `**File Reservation Request**

**Files/Patterns:** {{files}}
**Mode:** {{mode}}
**Duration:** {{duration}}
**Reason:** {{reason}}

**Agent:** {{agent}}
**Task:** {{task}}

This is an {{mode}} reservation. Please coordinate before making changes to these files.`
  },
  
  HANDOFF: {
    subject: 'Task Handoff: {{task}}',
    body: `**Task Handoff**

**From:** {{from_agent}}
**To:** {{to_agent}}
**Task:** {{task}}

**Current State:**
{{current_state}}

**Next Steps:**
{{next_steps}}

**Files:** {{files}}
**Notes:** {{notes}}

Please acknowledge receipt and confirm you can proceed.`
  },
  
  CONFLICT_RESOLUTION: {
    subject: 'File Conflict Resolution Required',
    body: `**File Conflict Detected**

**Conflicting Files:** {{files}}
**Agents Involved:** {{agents}}

**Conflict Type:** {{conflict_type}}
**Suggested Resolution:** {{resolution}}

**Details:**
{{details}}

Please coordinate to resolve this conflict before proceeding.`
  }
} as const;

// Validation schemas
export const VALIDATION_SCHEMAS = {
  AGENT_NAME_PATTERN: /^[A-Z][a-z]+[A-Z][a-z]+$/,
  MESSAGE_ID_PATTERN: /^[a-f0-9]{32}$/,
  RESERVATION_ID_PATTERN: /^res_[a-f0-9]{24}$/,
  THREAD_ID_PATTERN: /^thread_[a-f0-9]+$/,
  PROJECT_PATH_PATTERN: /^[a-zA-Z0-9\/_\-\.]+$/
} as const;

// Helper function to create a quick agent mail setup
export async function quickAgentMailSetup(options: {
  projectPath: string;
  agentName?: string;
  mcpServerUrl?: string;
  bearerToken?: string;
// @ts-expect-error - Post-Merge Reconciliation
}): Promise<AgentMailIntegration> {
  const config: IntegrationConfig = {
    mcpServerUrl: options.mcpServerUrl || AGENT_MAIL_CONSTANTS.DEFAULT_SERVER_URL,
    bearerToken: options.bearerToken || 'default-token',
    projectPath: options.projectPath,
    agentName: options.agentName,
    enableMoltbookBridge: true,
    enableAuditIntegration: true,
    enableGitIntegration: true,
    enableCrossProjectCoordination: true,
    syncInterval: AGENT_MAIL_CONSTANTS.DEFAULT_SYNC_INTERVAL,
    messageBufferSize: 1000,
    reservationCheckInterval: AGENT_MAIL_CONSTANTS.DEFAULT_RESERVATION_CHECK_INTERVAL
  };
  
  // @ts-expect-error - Post-Merge Reconciliation
  const integration = createAgentMailIntegration(config);
  await integration.initialize();
  
  return integration;
}

// Helper function to create standard message templates
export function createStandardTemplate(
  templateName: keyof typeof MESSAGE_TEMPLATES,
  variables: Record<string, string>
): { subject: string; body: string } {
  const template = MESSAGE_TEMPLATES[templateName];
  let subject = template.subject;
  let body = template.body;
  
  // Replace variables
  Object.entries(variables).forEach(([key, value]) => {
    const placeholder = `{{${key}}}`;
    // @ts-expect-error - Post-Merge Reconciliation
    subject = subject.replace(new RegExp(placeholder, 'g'), value);
    // @ts-expect-error - Post-Merge Reconciliation
    body = body.replace(new RegExp(placeholder, 'g'), value);
  });
  
  return { subject, body };
}

// Export version info
export const VERSION = '1.0.0';
export const AUTHOR = 'SuperClaw Team';
export const DESCRIPTION = 'Inter-agent communication layer using MCP Agent Mail';

// Export for compatibility checks
export const MCP_AGENT_MAIL_VERSION = '0.1.0';
export const SUPERCLAW_INTEGRATION_VERSION = '1.0.0';