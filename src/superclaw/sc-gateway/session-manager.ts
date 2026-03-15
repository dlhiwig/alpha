/**
 * SuperClaw Session Manager
 * Based on OpenClaw session management patterns
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

export interface SessionInfo {
  sessionId: string;
  agentId: string;
  channel: string;
  accountId?: string;
  peer: {
    kind: 'direct' | 'group' | 'channel';
    id: string;
  };
  chatType: 'direct' | 'group' | 'channel';
  from: string;
  to: string;
  threadId?: string | number;
  createdAt: number;
  lastActivity: number;
  metadata: Record<string, unknown>;
  state: 'active' | 'idle' | 'closed';
}

export interface SessionUsage {
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  cost: {
    total: number;
    breakdown?: Record<string, number>;
  };
  messageCount: number;
  toolCalls: number;
}

export interface SessionEvent {
  type: 'created' | 'updated' | 'closed' | 'activity' | 'error';
  sessionId: string;
  timestamp: number;
  data?: unknown;
}

export interface SessionCreateParams {
  agentId: string;
  channel: string;
  accountId?: string;
  target: string;
  chatType?: 'direct' | 'group' | 'channel';
  threadId?: string | number;
  metadata?: Record<string, unknown>;
}

export interface SessionUpdateParams {
  metadata?: Record<string, unknown>;
  state?: 'active' | 'idle' | 'closed';
  lastActivity?: number;
}

export class SessionManager extends EventEmitter {
  private sessions: Map<string, SessionInfo> = new Map();
  private sessionsByAgent: Map<string, Set<string>> = new Map();
  private sessionsByChannel: Map<string, Set<string>> = new Map();
  private persistenceDir?: string;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(options: { persistenceDir?: string; cleanupIntervalMs?: number } = {}) {
    super();
    
    this.persistenceDir = options.persistenceDir;
    
    // Start cleanup interval (default 5 minutes)
    const intervalMs = options.cleanupIntervalMs || 5 * 60 * 1000;
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleSessions();
    }, intervalMs);
  }

  /**
   * Create a new session
   */
  async createSession(params: SessionCreateParams): Promise<SessionInfo> {
    const sessionId = randomUUID();
    const now = Date.now();
    
    // Parse target to extract peer information (simplified OpenClaw-style parsing)
    const peer = this.parseTarget(params.target, params.channel);
    const chatType = params.chatType || this.inferChatType(peer, params.channel);
    
    const session: SessionInfo = {
      sessionId,
      agentId: params.agentId,
      channel: params.channel,
      accountId: params.accountId,
      peer,
      chatType,
      from: this.buildFromAddress(peer, params.channel),
      to: this.buildToAddress(peer, params.target),
      threadId: params.threadId,
      createdAt: now,
      lastActivity: now,
      metadata: params.metadata || {},
      state: 'active'
    };

    // Store session
    this.sessions.set(sessionId, session);
    
    // Index by agent
    if (!this.sessionsByAgent.has(params.agentId)) {
      this.sessionsByAgent.set(params.agentId, new Set());
    }
    this.sessionsByAgent.get(params.agentId)!.add(sessionId);
    
    // Index by channel
    if (!this.sessionsByChannel.has(params.channel)) {
      this.sessionsByChannel.set(params.channel, new Set());
    }
    this.sessionsByChannel.get(params.channel)!.add(sessionId);

    // Persist session
    await this.persistSession(session);
    
    // Emit event
    this.emit('session', {
      type: 'created',
      sessionId,
      timestamp: now,
      data: session
    } as SessionEvent);

    return session;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Update session
   */
  async updateSession(sessionId: string, updates: SessionUpdateParams): Promise<SessionInfo | null> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    const now = Date.now();
    const updated: SessionInfo = {
      ...session,
      ...updates,
      lastActivity: updates.lastActivity || now,
      metadata: updates.metadata ? { ...session.metadata, ...updates.metadata } : session.metadata
    };

    this.sessions.set(sessionId, updated);
    await this.persistSession(updated);

    this.emit('session', {
      type: 'updated',
      sessionId,
      timestamp: now,
      data: { before: session, after: updated }
    } as SessionEvent);

    return updated;
  }

  /**
   * Record activity for session
   */
  async recordActivity(sessionId: string, metadata?: Record<string, unknown>): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    await this.updateSession(sessionId, {
      lastActivity: Date.now(),
      metadata,
      state: 'active'
    });

    this.emit('session', {
      type: 'activity',
      sessionId,
      timestamp: Date.now(),
      data: metadata
    } as SessionEvent);
  }

  /**
   * Close session
   */
  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    await this.updateSession(sessionId, { state: 'closed' });
    
    // Remove from indexes
    this.sessionsByAgent.get(session.agentId)?.delete(sessionId);
    this.sessionsByChannel.get(session.channel)?.delete(sessionId);

    this.emit('session', {
      type: 'closed',
      sessionId,
      timestamp: Date.now()
    } as SessionEvent);
  }

  /**
   * Get sessions by agent
   */
  getSessionsByAgent(agentId: string): SessionInfo[] {
    const sessionIds = this.sessionsByAgent.get(agentId) || new Set();
    return Array.from(sessionIds)
      .map(id => this.sessions.get(id)!)
      .filter(Boolean);
  }

  /**
   * Get sessions by channel
   */
  getSessionsByChannel(channel: string): SessionInfo[] {
    const sessionIds = this.sessionsByChannel.get(channel) || new Set();
    return Array.from(sessionIds)
      .map(id => this.sessions.get(id)!)
      .filter(Boolean);
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).filter(s => s.state === 'active');
  }

  /**
   * Get session statistics
   */
  getStats(): {
    total: number;
    active: number;
    idle: number;
    closed: number;
    byAgent: Record<string, number>;
    byChannel: Record<string, number>;
  } {
    const sessions = Array.from(this.sessions.values());
    const stats = {
      total: sessions.length,
      active: sessions.filter(s => s.state === 'active').length,
      idle: sessions.filter(s => s.state === 'idle').length,
      closed: sessions.filter(s => s.state === 'closed').length,
      byAgent: {} as Record<string, number>,
      byChannel: {} as Record<string, number>
    };

    // Count by agent
    for (const [agentId, sessionIds] of this.sessionsByAgent.entries()) {
      stats.byAgent[agentId] = sessionIds.size;
    }

    // Count by channel
    for (const [channel, sessionIds] of this.sessionsByChannel.entries()) {
      stats.byChannel[channel] = sessionIds.size;
    }

    return stats;
  }

  /**
   * Cleanup idle sessions
   */
  private async cleanupIdleSessions(): Promise<void> {
    const now = Date.now();
    const idleThreshold = 30 * 60 * 1000; // 30 minutes
    const closedThreshold = 24 * 60 * 60 * 1000; // 24 hours

    for (const [sessionId, session] of this.sessions.entries()) {
      const timeSinceActivity = now - session.lastActivity;
      
      // Mark as idle if no activity for 30 minutes
      if (session.state === 'active' && timeSinceActivity > idleThreshold) {
        await this.updateSession(sessionId, { state: 'idle' });
      }
      
      // Remove closed sessions after 24 hours
      if (session.state === 'closed' && timeSinceActivity > closedThreshold) {
        this.sessions.delete(sessionId);
        this.sessionsByAgent.get(session.agentId)?.delete(sessionId);
        this.sessionsByChannel.get(session.channel)?.delete(sessionId);
      }
    }
  }

  /**
   * Parse target string to extract peer info (OpenClaw-style)
   */
  private parseTarget(target: string, channel: string): { kind: 'direct' | 'group' | 'channel'; id: string } {
    const trimmed = target.trim();
    
    // Strip channel prefix if present
    const withoutPrefix = trimmed.toLowerCase().startsWith(`${channel}:`) 
      ? trimmed.slice(channel.length + 1) 
      : trimmed;
    
    // Parse kind indicators
    if (withoutPrefix.startsWith('user:') || withoutPrefix.startsWith('@')) {
      return {
        kind: 'direct',
        id: withoutPrefix.replace(/^(user:|@)/, '')
      };
    }
    
    if (withoutPrefix.startsWith('group:')) {
      return {
        kind: 'group',
        id: withoutPrefix.replace(/^group:/, '')
      };
    }
    
    if (withoutPrefix.startsWith('channel:') || withoutPrefix.startsWith('#')) {
      return {
        kind: 'channel',
        id: withoutPrefix.replace(/^(channel:|#)/, '')
      };
    }
    
    // Default inference based on common patterns
    if (trimmed.includes('@') && (channel === 'whatsapp' || channel === 'telegram')) {
      return { kind: 'direct', id: withoutPrefix };
    }
    
    // Default to direct for most channels
    return { kind: 'direct', id: withoutPrefix };
  }

  /**
   * Infer chat type from peer and channel
   */
  private inferChatType(peer: { kind: string }, channel: string): 'direct' | 'group' | 'channel' {
    if (peer.kind === 'direct') {return 'direct';}
    if (peer.kind === 'group') {return 'group';}
    if (peer.kind === 'channel') {return 'channel';}
    return 'direct';
  }

  /**
   * Build from address
   */
  private buildFromAddress(peer: { kind: string; id: string }, channel: string): string {
    if (peer.kind === 'direct') {
      return `${channel}:${peer.id}`;
    }
    return `${channel}:${peer.kind}:${peer.id}`;
  }

  /**
   * Build to address
   */
  private buildToAddress(peer: { kind: string; id: string }, target: string): string {
    return target.includes(':') ? target : `${peer.kind}:${peer.id}`;
  }

  /**
   * Persist session to disk (if persistence enabled)
   */
  private async persistSession(session: SessionInfo): Promise<void> {
    if (!this.persistenceDir) {
      return;
    }

    try {
      await fs.mkdir(this.persistenceDir, { recursive: true });
      const filePath = path.join(this.persistenceDir, `${session.sessionId}.json`);
      await fs.writeFile(filePath, JSON.stringify(session, null, 2));
    } catch (error: unknown) {
      console.error('Failed to persist session:', error);
    }
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.removeAllListeners();
  }
}

// Singleton instance
let sessionManagerInstance: SessionManager | null = null;

export function getSessionManager(options?: { persistenceDir?: string; cleanupIntervalMs?: number }): SessionManager {
  if (!sessionManagerInstance) {
    sessionManagerInstance = new SessionManager(options);
  }
  return sessionManagerInstance;
}