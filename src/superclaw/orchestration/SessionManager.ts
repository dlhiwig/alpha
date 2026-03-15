import { EventEmitter } from 'events'
import * as fs from 'fs/promises'
import * as path from 'path'
import type { AgentSession, AgentIdentity, SessionStatus } from './types'

export class SessionManager extends EventEmitter {
  private sessions: Map<string, AgentSession> = new Map()
  private persistPath: string
  
  constructor(config?: { persistPath?: string }) {
    super()
    this.persistPath = config?.persistPath || 
      path.join(process.env.HOME || '~', '.superclaw', 'sessions.json')
  }
  
  async initialize(): Promise<void> {
    // Load persisted sessions
    await this.loadSessions()
    // Mark crashed sessions
    await this.detectCrashedSessions()
  }
  
  async createSession(identity: AgentIdentity, workspace: string): Promise<AgentSession> {
    const sessionId = this.generateSessionId(identity);
    const session: AgentSession = {
      id: sessionId,
      identity,
      workspace,
      status: 'spawning',
      spawnedAt: new Date(),
      lastSeen: new Date(),
      metrics: {
        tasksCompleted: 0,
        errorsEncountered: 0,
        memoryUsageMB: 0,
        cpuTimeMs: 0,
        messagesReceived: 0,
        messagesSent: 0
      },
      // Required compatibility properties
      sessionId,
      role: identity.role,
      workspacePath: workspace,
      project: identity.project
    }
    
    this.sessions.set(session.id, session)
    await this.persistSessions()
    this.emit('session-created', session)
    
    return session
  }
  
  async updateSession(sessionId: string, updates: Partial<AgentSession>): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)
    
    Object.assign(session, updates, { lastSeen: new Date() })
    await this.persistSessions()
    this.emit('session-updated', session)
  }
  
  async deleteSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (session) {
      this.sessions.delete(sessionId)
      await this.persistSessions()
      this.emit('session-deleted', session)
    }
  }
  
  getSession(sessionId: string): AgentSession | undefined {
    return this.sessions.get(sessionId)
  }
  
  listSessions(filter?: { project?: string; status?: SessionStatus }): AgentSession[] {
    let sessions = Array.from(this.sessions.values())
    
    if (filter?.project) {
      sessions = sessions.filter(s => s.identity.project === filter.project)
    }
    if (filter?.status) {
      sessions = sessions.filter(s => s.status === filter.status)
    }
    
    return sessions
  }
  
  async markActive(sessionId: string, pid?: number): Promise<void> {
    await this.updateSession(sessionId, { status: 'active', pid })
  }
  
  async markFailed(sessionId: string): Promise<void> {
    await this.updateSession(sessionId, { status: 'failed', pid: undefined })
  }
  
  async markTerminated(sessionId: string): Promise<void> {
    await this.updateSession(sessionId, { status: 'terminated', pid: undefined })
  }
  
  private generateSessionId(identity: AgentIdentity): string {
    return `${identity.namespace}-${identity.project}-${identity.name}-${Date.now()}`
  }
  
  private async loadSessions(): Promise<void> {
    try {
      const data = await fs.readFile(this.persistPath, 'utf-8')
      const sessions = JSON.parse(data) as AgentSession[]
      for (const session of sessions) {
        this.sessions.set(session.id, session)
      }
    } catch {
      // No persisted sessions
    }
  }
  
  private async persistSessions(): Promise<void> {
    const sessions = Array.from(this.sessions.values())
    await fs.mkdir(path.dirname(this.persistPath), { recursive: true })
    await fs.writeFile(this.persistPath, JSON.stringify(sessions, null, 2))
  }
  
  private async detectCrashedSessions(): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.status === 'active' && session.pid) {
        // Check if process is still running
        try {
          process.kill(session.pid, 0)
        } catch {
          // Process not running - mark as failed
          await this.markFailed(session.id)
          this.emit('session-crashed', session)
        }
      }
    }
  }
}