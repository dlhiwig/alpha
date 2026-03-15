// @ts-nocheck
/**
 * 🦊 SuperClaw Agent Mail Utilities
 * 
 * Utility functions for agent mail operations, message formatting,
 * file pattern matching, and integration helpers.
 */

import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs/promises';
import { glob } from 'glob';

import type {
  AgentIdentity,
  AgentMailMessage,
  FileReservation,
  MessagePriority,
  AgentMailMessageType,
  MessageTemplate
} from './types';

/**
 * Generate a unique correlation ID for request/response tracking
 */
export function generateCorrelationId(): string {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Generate a secure message ID
 */
export function generateMessageId(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Generate a reservation ID
 */
export function generateReservationId(): string {
  return `res_${crypto.randomBytes(12).toString('hex')}`;
}

/**
 * Validate agent name format (must match MCP Agent Mail requirements)
 */
export function validateAgentName(name: string): boolean {
  // Agent names should be CamelCase combinations like "GreenCastle"
  const pattern = /^[A-Z][a-z]+[A-Z][a-z]+$/;
  return pattern.test(name) && name.length >= 4 && name.length <= 32;
}

/**
 * Sanitize agent name to ensure it meets requirements
 */
export function sanitizeAgentName(name: string): string {
  // Remove non-alphanumeric characters and ensure CamelCase
  const clean = name.replace(/[^a-zA-Z]/g, '');
  if (clean.length < 4) {
    return `Agent${clean.padEnd(4, 'X')}`;
  }
  
  // Ensure first letter is uppercase
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

/**
 * Generate memorable agent name combination
 */
export function generateMemorableAgentName(): string {
  const adjectives = [
    'Red', 'Blue', 'Green', 'Purple', 'Orange', 'Pink', 'Black', 'White',
    'Gold', 'Silver', 'Crimson', 'Azure', 'Emerald', 'Violet', 'Amber',
    'Scarlet', 'Indigo', 'Turquoise', 'Magenta', 'Cyan', 'Maroon', 'Navy',
    'Teal', 'Lime', 'Olive', 'Coral', 'Salmon', 'Khaki', 'Plum', 'Bronze'
  ];
  
  const nouns = [
    'Castle', 'Mountain', 'River', 'Forest', 'Valley', 'Lake', 'Stone',
    'Wind', 'Star', 'Moon', 'Sun', 'Cloud', 'Thunder', 'Lightning', 'Storm',
    'Eagle', 'Wolf', 'Bear', 'Lion', 'Tiger', 'Falcon', 'Hawk', 'Phoenix',
    'Dragon', 'Raven', 'Serpent', 'Shark', 'Whale', 'Dolphin', 'Panther'
  ];

  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  
  return `${adjective}${noun}`;
}

/**
 * Format message for display
 */
export function formatMessage(message: AgentMailMessage): string {
  const timestamp = message.timestamp.toLocaleString();
  const priority = message.priority !== 'normal' ? ` [${message.priority.toUpperCase()}]` : '';
  const ackRequired = message.ackRequired ? ' [ACK REQUIRED]' : '';
  const thread = message.threadId ? ` (Thread: ${message.threadId})` : '';
  
  return `
📧 **Message from ${message.senderName}**${priority}${ackRequired}
🕒 ${timestamp}${thread}
📝 **Subject:** ${message.subject}

${message.body}

${message.attachments.length > 0 ? `📎 Attachments: ${message.attachments.length}` : ''}
`.trim();
}

/**
 * Create message thread summary
 */
export function createThreadSummary(messages: AgentMailMessage[]): string {
  if (messages.length === 0) {return 'Empty thread';}
  
  const threadId = messages[0].threadId || 'Unknown';
  const participants = [...new Set(messages.map(m => m.senderName))];
  const messageCount = messages.length;
  const lastMessage = messages[messages.length - 1];
  
  return `Thread ${threadId}: ${messageCount} messages from ${participants.join(', ')}. Last: ${lastMessage.senderName} - "${lastMessage.subject}"`;
}

/**
 * Check if file path matches reservation pattern
 */
export function matchesReservationPattern(filePath: string, pattern: string): boolean {
  // Convert glob pattern to regex for matching
  try {
    // Normalize paths
    const normalizedPath = path.normalize(filePath);
    const normalizedPattern = path.normalize(pattern);
    
    // Use minimatch-style pattern matching
    const regexPattern = normalizedPattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
      .replace(/\[.*?\]/g, '[^/]*');
    
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(normalizedPath);
  } catch (error: unknown) {
    console.warn(`Pattern matching failed for ${filePath} against ${pattern}:`, error);
    return false;
  }
}

/**
 * Find files matching reservation patterns
 */
export async function findMatchingFiles(
  basePath: string, 
  patterns: string[]
): Promise<string[]> {
  const allFiles: string[] = [];
  
  for (const pattern of patterns) {
    try {
      const fullPattern = path.isAbsolute(pattern) 
        ? pattern 
        : path.join(basePath, pattern);
      
      const matches = await glob(fullPattern, { 
        ignore: ['**/node_modules/**', '**/.git/**'],
        absolute: false,
        cwd: basePath
      });
      
      allFiles.push(...matches);
    } catch (error: unknown) {
      console.warn(`Glob pattern failed for ${pattern}:`, error);
    }
  }
  
  // Remove duplicates and return relative paths
  return [...new Set(allFiles)];
}

/**
 * Check for file reservation conflicts
 */
export function checkReservationConflicts(
  newReservations: FileReservation[],
  existingReservations: FileReservation[]
): FileReservation[] {
  const conflicts: FileReservation[] = [];
  
  for (const newRes of newReservations) {
    for (const existingRes of existingReservations) {
      // Skip if same agent
      if (newRes.agentId === existingRes.agentId) {continue;}
      
      // Skip if reservation expired
      if (existingRes.expiresAt < new Date()) {continue;}
      
      // Check for pattern overlap
      if (patternsOverlap(newRes.pathPattern, existingRes.pathPattern)) {
        // Conflict if either is exclusive
        if (newRes.mode === 'exclusive' || existingRes.mode === 'exclusive') {
          conflicts.push(existingRes);
        }
      }
    }
  }
  
  return conflicts;
}

/**
 * Check if two glob patterns overlap
 */
function patternsOverlap(pattern1: string, pattern2: string): boolean {
  const normalize = (p: string) => p.replace(/\\/g, '/').toLowerCase();
  const p1 = normalize(pattern1);
  const p2 = normalize(pattern2);
  
  // Exact match
  if (p1 === p2) {return true;}
  
  // Check if one pattern matches the other using glob-style matching
  if (matchesGlobPattern(p1, p2) || matchesGlobPattern(p2, p1)) {
    return true;
  }
  
  // Check for obvious overlaps: if both patterns share a common base path
  const getBasePath = (p: string) => {
    const parts = p.split('/');
    const baseIdx = parts.findIndex(part => part.includes('*') || part.includes('?'));
    return baseIdx === -1 ? p : parts.slice(0, baseIdx).join('/');
  };
  
  const base1 = getBasePath(p1);
  const base2 = getBasePath(p2);
  
  // If one base path is a prefix of the other, there's potential overlap
  if (base1 && base2 && (base1.startsWith(base2) || base2.startsWith(base1) || base1 === base2)) {
    return true;
  }
  
  return false;
}

/**
 * Simple glob pattern matching for overlap detection
 */
function matchesGlobPattern(pattern: string, filePath: string): boolean {
  try {
    // Convert glob pattern to regex
    let regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '___DOUBLESTAR___')  // Temporarily replace **
      .replace(/\*/g, '[^/]*')               // Single * matches anything except /
      .replace(/___DOUBLESTAR___/g, '.*')    // ** matches anything including /
      .replace(/\?/g, '[^/]');               // ? matches single character except /
    
    regexPattern = `^${regexPattern}$`;
    const regex = new RegExp(regexPattern);
    return regex.test(filePath);
  } catch (error) {
    // Fallback to simple substring check
    return pattern.includes(filePath) || filePath.includes(pattern);
  }
}

/**
 * Calculate message priority score for sorting
 */
export function getMessagePriorityScore(priority: MessagePriority): number {
  const priorityScores = {
    urgent: 5,
    high: 4,
    normal: 3,
    low: 2,
    fyi: 1
  };
  return priorityScores[priority] || 3;
}

/**
 * Sort messages by priority and timestamp
 */
export function sortMessagesByPriority(messages: AgentMailMessage[]): AgentMailMessage[] {
  return [...messages].toSorted((a, b) => {
    const priorityDiff = getMessagePriorityScore(b.priority) - getMessagePriorityScore(a.priority);
    if (priorityDiff !== 0) {return priorityDiff;}
    
    // If same priority, sort by timestamp (newest first)
    return b.timestamp.getTime() - a.timestamp.getTime();
  });
}

/**
 * Filter messages by criteria
 */
export function filterMessages(
  messages: AgentMailMessage[],
  filters: {
    senderId?: string;
    messageType?: AgentMailMessageType;
    priority?: MessagePriority;
    threadId?: string;
    hasAttachments?: boolean;
    ackRequired?: boolean;
    since?: Date;
  }
): AgentMailMessage[] {
  return messages.filter(message => {
    if (filters.senderId && message.senderId !== filters.senderId) {return false;}
    if (filters.messageType && message.type !== filters.messageType) {return false;}
    if (filters.priority && message.priority !== filters.priority) {return false;}
    if (filters.threadId && message.threadId !== filters.threadId) {return false;}
    if (filters.hasAttachments !== undefined && 
        (message.attachments.length > 0) !== filters.hasAttachments) {return false;}
    if (filters.ackRequired !== undefined && 
        message.ackRequired !== filters.ackRequired) {return false;}
    if (filters.since && message.timestamp < filters.since) {return false;}
    
    return true;
  });
}

/**
 * Create markdown-formatted agent directory listing
 */
export function formatAgentDirectory(agents: any[]): string {
  if (agents.length === 0) {
    return '📂 **Agent Directory**\n\n*No active agents found.*';
  }
  
  const lines = ['📂 **Agent Directory**', ''];
  
  agents.forEach(agent => {
    const status = agent.isActive ? '🟢' : '🔴';
    const lastActive = agent.identity.lastActive.toLocaleString();
    const reservations = agent.currentReservations.length;
    
    lines.push(`${status} **${agent.identity.name}**`);
    lines.push(`   Program: ${agent.identity.program}`);
    lines.push(`   Model: ${agent.identity.model}`);
    lines.push(`   Task: ${agent.identity.taskDescription}`);
    lines.push(`   Last Active: ${lastActive}`);
    lines.push(`   File Reservations: ${reservations}`);
    lines.push('');
  });
  
  return lines.join('\n');
}

/**
 * Create file reservation summary
 */
export function formatReservationSummary(reservations: FileReservation[]): string {
  if (reservations.length === 0) {
    return '📋 **File Reservations**\n\n*No active reservations.*';
  }
  
  const lines = ['📋 **File Reservations**', ''];
  
  reservations.forEach(reservation => {
    const expiresIn = Math.round((reservation.expiresAt.getTime() - Date.now()) / (60 * 60 * 1000));
    const modeIcon = reservation.mode === 'exclusive' ? '🔒' : '🔓';
    
    lines.push(`${modeIcon} **${reservation.pathPattern}**`);
    lines.push(`   Agent: ${reservation.agentName}`);
    lines.push(`   Mode: ${reservation.mode}`);
    lines.push(`   Reason: ${reservation.reason}`);
    lines.push(`   Expires: ${expiresIn}h`);
    lines.push('');
  });
  
  return lines.join('\n');
}

/**
 * Create message template
 */
export function createMessageTemplate(
  name: string,
  subject: string,
  bodyTemplate: string,
  options: {
    priority?: MessagePriority;
    requiredFields?: string[];
    optionalFields?: string[];
    category?: string;
  } = {}
): MessageTemplate {
  return {
    id: crypto.randomBytes(8).toString('hex'),
    name,
    description: `Template for ${name}`,
    subject,
    bodyTemplate,
    defaultPriority: options.priority || 'normal',
    requiredFields: options.requiredFields || [],
    optionalFields: options.optionalFields || [],
    category: options.category as any || 'custom'
  };
}

/**
 * Apply template variables to message template
 */
export function applyMessageTemplate(
  template: MessageTemplate,
  variables: Record<string, string>
): { subject: string; body: string } {
  let subject = template.subject;
  let body = template.bodyTemplate;
  
  // Replace variables in both subject and body
  Object.entries(variables).forEach(([key, value]) => {
    const placeholder = `{{${key}}}`;
    subject = subject.replace(new RegExp(placeholder, 'g'), value);
    body = body.replace(new RegExp(placeholder, 'g'), value);
  });
  
  return { subject, body };
}

/**
 * Validate message template variables
 */
export function validateTemplateVariables(
  template: MessageTemplate,
  variables: Record<string, string>
): { valid: boolean; missing: string[]; extra: string[] } {
  const providedKeys = new Set(Object.keys(variables));
  const requiredKeys = new Set(template.requiredFields);
  const allKeys = new Set([...template.requiredFields, ...template.optionalFields]);
  
  const missing = template.requiredFields.filter(key => !providedKeys.has(key));
  const extra = Object.keys(variables).filter(key => !allKeys.has(key));
  
  return {
    valid: missing.length === 0,
    missing,
    extra
  };
}

/**
 * Parse markdown content for structured data
 */
export function parseMarkdownMetadata(content: string): Record<string, any> {
  const metadata: Record<string, any> = {};
  
  // Extract front matter if present
  const frontMatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (frontMatterMatch) {
    try {
      const lines = frontMatterMatch[1].split('\n');
      lines.forEach(line => {
        const [key, ...valueParts] = line.split(':');
        if (key && valueParts.length > 0) {
          metadata[key.trim()] = valueParts.join(':').trim();
        }
      });
    } catch (error: unknown) {
      console.warn('Failed to parse front matter:', error);
    }
  }
  
  // Extract headers as structure
  const headers = content.match(/^#+\s+(.+)$/gm);
  if (headers) {
    metadata.headers = headers.map(h => h.replace(/^#+\s+/, ''));
  }
  
  // Count common elements
  metadata.wordCount = content.split(/\s+/).length;
  metadata.lineCount = content.split('\n').length;
  metadata.codeBlocks = (content.match(/```[\s\S]*?```/g) || []).length;
  metadata.links = (content.match(/\[.*?\]\(.*?\)/g) || []).length;
  metadata.images = (content.match(/!\[.*?\]\(.*?\)/g) || []).length;
  
  return metadata;
}

/**
 * Generate audit trail entry
 */
export function createAuditTrailEntry(
  agentId: string,
  action: string,
  details: Record<string, any>,
  success: boolean = true,
  error?: string
): any {
  return {
    id: generateCorrelationId(),
    timestamp: new Date(),
    agentId,
    agentName: details.agentName || agentId,
    action,
    details,
    success,
    error,
    correlationId: details.correlationId || generateCorrelationId()
  };
}

/**
 * Calculate uptime from inception time
 */
export function calculateUptime(inceptionTime: Date): number {
  return Date.now() - inceptionTime.getTime();
}

/**
 * Format uptime as human-readable string
 */
export function formatUptime(uptimeMs: number): string {
  const seconds = Math.floor(uptimeMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) {return `${days}d ${hours % 24}h`;}
  if (hours > 0) {return `${hours}h ${minutes % 60}m`;}
  if (minutes > 0) {return `${minutes}m ${seconds % 60}s`;}
  return `${seconds}s`;
}

/**
 * Create agent summary for coordination
 */
export function createAgentSummary(identity: AgentIdentity, stats?: any): string {
  const uptime = formatUptime(calculateUptime(identity.inceptionTime));
  
  return `**${identity.name}** (${identity.program} / ${identity.model})
📋 Task: ${identity.taskDescription}
⏱️ Active: ${uptime}
📁 Project: ${path.basename(identity.projectPath)}
📬 Policy: ${identity.contactPolicy}
${stats ? `📊 Messages: ${stats.messagesSent} sent, ${stats.messagesReceived} received` : ''}`;
}