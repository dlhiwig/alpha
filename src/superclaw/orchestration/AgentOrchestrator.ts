import { EventEmitter } from 'events'
import { spawn, ChildProcess } from 'child_process'
import { promises as fs } from 'fs'
import { join, resolve } from 'path'
import { randomUUID } from 'crypto'
import { homedir } from 'os'

import { WorkspaceManager } from './WorkspaceManager'
import { MessageBroker } from './MessageBroker'
import type {
  AgentIdentity,
  AgentSession,
  SessionStatus,
  OrchestratorConfig,
  AgentMessage,
  AgentCrashEvent
} from './types'

export interface OrchestratorEvents {
  'agent:spawned': (session: AgentSession) => void
  'agent:crashed': (event: AgentCrashEvent) => void
  'agent:killed': (sessionId: string, graceful: boolean) => void
  'agent:heartbeat': (sessionId: string, data: any) => void
  'agent:message': (message: AgentMessage) => void
  'resource:limit': (type: string, current: number, limit: number) => void
  'orchestrator:started': () => void
  'orchestrator:shutdown': () => void
}

export class AgentOrchestrator extends EventEmitter {
  private activeSessions: Map<string, AgentSession> = new Map()
  private processes: Map<string, ChildProcess> = new Map()
  private workspaceManager: WorkspaceManager
  private messageBroker: MessageBroker
  private config: OrchestratorConfig
  private heartbeatInterval?: NodeJS.Timeout
  private isShuttingDown = false
  private logger = console // TODO: Replace with proper logger

  constructor(config?: Partial<OrchestratorConfig>) {
    super()
    this.config = {
      maxConcurrentAgents: 50,
      agentTimeoutMs: 300000, // 5 minutes
      heartbeatIntervalMs: 30000, // 30 seconds
      workspaceBaseDir: '~/.superclaw/workspaces',
      enableGitWorktrees: true,
      enableRecovery: true,
      maxMemoryMB: 8192, // 8GB per agent
      maxCpuPercent: 50,
      logLevel: 'info',
      ...config
    }
    
    // Resolve home directory path
    if (this.config.workspaceBaseDir.startsWith('~')) {
      this.config.workspaceBaseDir = this.config.workspaceBaseDir.replace('~', homedir())
    }
    
    this.workspaceManager = new WorkspaceManager(this.config)
    this.messageBroker = new MessageBroker()
  }

  async initialize(): Promise<void> {
    this.logger.info('🚀 Initializing AgentOrchestrator...')
    
    try {
      // Initialize workspace manager
      await this.workspaceManager.initialize()
      
      // Initialize message broker
      await this.messageBroker.initialize()
      
      // Set up message routing
      this.setupMessageRouting()
      
      // Start heartbeat monitoring
      this.startHeartbeatMonitoring()
      
      // Recover any crashed agents
      if (this.config.enableRecovery) {
        await this.recoverCrashedAgents()
      }
      
      this.logger.info(`✅ AgentOrchestrator initialized (max agents: ${this.config.maxConcurrentAgents})`)
      this.emit('orchestrator:started')
    } catch (error: unknown) {
      this.logger.error('❌ Failed to initialize AgentOrchestrator:', error)
      throw error
    }
  }

  async spawnAgent(identity: AgentIdentity, config?: any): Promise<string> {
    if (this.isShuttingDown) {
      throw new Error('Orchestrator is shutting down, cannot spawn new agents')
    }

    // Check capacity limits
    const currentCount = this.activeSessions.size
    if (currentCount >= this.config.maxConcurrentAgents) {
      this.emit('resource:limit', 'agents', currentCount, this.config.maxConcurrentAgents)
      throw new Error(`Maximum concurrent agents limit reached (${this.config.maxConcurrentAgents})`)
    }

    const sessionId = randomUUID()
    // @ts-expect-error - Post-Merge Reconciliation
    this.logger.info(`🎯 Spawning agent: ${identity.type}/${identity.role} (session: ${sessionId})`)

    try {
      // Create workspace
      const workspacePath = await this.workspaceManager.createWorkspace(sessionId, identity.project)
      
      // Create session record
      const session: AgentSession = {
        id: sessionId,
        identity,
        // @ts-expect-error - Post-Merge Reconciliation
        status: 'starting',
        pid: 0,
        workspacePath,
        createdAt: new Date(),
        lastHeartbeat: new Date(),
        config: config || {},
        project: identity.project,
        // @ts-expect-error - Post-Merge Reconciliation
        parentSessionId: identity.parentSessionId
      }

      // Register session before launching to avoid race conditions
      this.activeSessions.set(sessionId, session)

      // Launch the agent process
      const pid = await this.launchAgentProcess(session, config)
      
      // Update session with process info
      session.pid = pid
      // @ts-expect-error - Post-Merge Reconciliation
      session.status = 'running'
      session.startedAt = new Date()
      this.activeSessions.set(sessionId, session)

      this.logger.info(`✅ Agent spawned successfully: ${sessionId} (PID: ${pid})`)
      this.emit('agent:spawned', session)
      
      return sessionId
    } catch (error: unknown) {
      // Clean up on failure
      this.activeSessions.delete(sessionId)
      await this.workspaceManager.cleanupWorkspace(sessionId).catch(err => {
        this.logger.warn(`Failed to cleanup workspace for failed spawn: ${err.message}`)
      })
      
      this.logger.error(`❌ Failed to spawn agent ${sessionId}:`, error)
      throw error
    }
  }

  async killAgent(sessionId: string, graceful: boolean = true): Promise<void> {
    const session = this.activeSessions.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    this.logger.info(`🔥 Killing agent ${sessionId} (graceful: ${graceful})`)

    const process = this.processes.get(sessionId)
    if (process && !process.killed) {
      if (graceful) {
        // Send SIGTERM and wait for graceful shutdown
        process.kill('SIGTERM')
        
        // Wait up to 10 seconds for graceful shutdown
        const timeout = setTimeout(() => {
          if (!process.killed) {
            this.logger.warn(`⚠️ Agent ${sessionId} didn't shutdown gracefully, force killing`)
            process.kill('SIGKILL')
          }
        }, 10000)
        
        process.once('exit', () => {
          clearTimeout(timeout)
        })
      } else {
        // Force kill immediately
        process.kill('SIGKILL')
      }
    }

    // Update session status
    // @ts-expect-error - Post-Merge Reconciliation
    session.status = 'stopping'
    session.stoppedAt = new Date()
    
    // Clean up after a brief delay to allow process cleanup
    setTimeout(async () => {
      await this.cleanupSession(sessionId)
      this.emit('agent:killed', sessionId, graceful)
    }, 1000)
  }

  async getSession(sessionId: string): Promise<AgentSession | undefined> {
    return this.activeSessions.get(sessionId)
  }

  async listSessions(filter?: Partial<AgentSession>): Promise<AgentSession[]> {
    const sessions = Array.from(this.activeSessions.values())
    
    if (!filter) {return sessions}
    
    return sessions.filter(session => {
      return Object.entries(filter).every(([key, value]) => {
        const sessionValue = (session as any)[key]
        return sessionValue === value
      })
    })
  }

  async listActiveAgents(filter?: Partial<AgentSession>): Promise<AgentSession[]> {
    return this.listSessions(filter)
  }

  async getSessionsByProject(project: string): Promise<AgentSession[]> {
    return this.listSessions({ project })
  }

  async recoverFailedAgent(identity: AgentIdentity): Promise<string> {
    // @ts-expect-error - Post-Merge Reconciliation
    this.logger.info(`🔧 Attempting to recover failed agent: ${identity.type}/${identity.role}`)
    
    try {
      // Check for persisted state
      // @ts-expect-error - Post-Merge Reconciliation
      const stateFile = join(this.config.workspaceBaseDir, 'recovery', `${identity.project}_${identity.type}_${identity.role}.json`)
      let recoveryState = null
      
      try {
        const stateData = await fs.readFile(stateFile, 'utf8')
        recoveryState = JSON.parse(stateData)
        // @ts-expect-error - Post-Merge Reconciliation
        this.logger.info(`📦 Found recovery state for ${identity.type}/${identity.role}`)
      } catch {
        // @ts-expect-error - Post-Merge Reconciliation
        this.logger.info(`📦 No recovery state found for ${identity.type}/${identity.role}`)
      }
      
      // Spawn new agent with recovery state
      const sessionId = await this.spawnAgent(identity, { 
        recovery: true, 
        recoveryState 
      })
      
      this.logger.info(`✅ Agent recovered successfully: ${sessionId}`)
      return sessionId
    } catch (error: unknown) {
      // @ts-expect-error - Post-Merge Reconciliation
      this.logger.error(`❌ Failed to recover agent ${identity.type}/${identity.role}:`, error)
      throw error
    }
  }

  async sendMessage(from: string, to: string, type: any, payload: any): Promise<void> {
    await this.messageBroker.sendMessage(from, to, type, payload)
    
    const message: AgentMessage = {
      id: randomUUID(),
      from,
      senderId: from, // Add required senderId field
      to,
      type,
      payload,
      timestamp: new Date()
    }
    
    this.emit('agent:message', message)
  }

  async broadcastToProject(project: string, type: any, payload: any): Promise<void> {
    const projectSessions = await this.getSessionsByProject(project)
    
    await Promise.all(
      projectSessions.map(session =>
        this.sendMessage('orchestrator', session.id, type, payload)
      )
    )
  }

  private async launchAgentProcess(session: AgentSession, config?: any): Promise<number> {
    const { identity } = session
    
    // Determine the command to run based on agent type
    let command: string
    let args: string[]
    
    // @ts-expect-error - Post-Merge Reconciliation
    switch (identity.type) {
      case 'claude':
        command = 'claude'
        args = ['-p', '--no-stream']
        break
      case 'superclaw':
        command = 'npx'
        args = ['ts-node', 'src/cli/index.ts']
        break
      case 'swarm':
        command = 'npx'
        args = ['ts-node', 'src/swarm/runner.ts']
        break
      default:
        // @ts-expect-error - Post-Merge Reconciliation
        throw new Error(`Unknown agent type: ${identity.type}`)
    }
    
    // Set up environment variables
    const env = {
      ...process.env,
      SUPERCLAW_SESSION_ID: session.id,
      SUPERCLAW_WORKSPACE: session.workspacePath,
      SUPERCLAW_PROJECT: identity.project,
      SUPERCLAW_ROLE: identity.role,
      // @ts-expect-error - Post-Merge Reconciliation
      SUPERCLAW_PARENT_SESSION: identity.parentSessionId || '',
      SUPERCLAW_CONFIG: JSON.stringify(config || {})
    }
    
    // Spawn the process
    const childProcess = spawn(command, args, {
      cwd: session.workspacePath,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false
    })
    
    if (!childProcess.pid) {
      throw new Error('Failed to spawn agent process')
    }
    
    // Store process reference
    this.processes.set(session.id, childProcess)
    
    // Set up process event handlers
    this.setupProcessHandlers(session.id, childProcess)
    
    return childProcess.pid
  }

  private setupProcessHandlers(sessionId: string, process: ChildProcess): void {
    process.stdout?.on('data', (data) => {
      this.logger.info(`[${sessionId}] ${data.toString().trim()}`)
    })
    
    process.stderr?.on('data', (data) => {
      this.logger.error(`[${sessionId}] ${data.toString().trim()}`)
    })
    
    process.on('exit', async (code, signal) => {
      this.logger.info(`[${sessionId}] Process exited: code=${code}, signal=${signal}`)
      
      const session = this.activeSessions.get(sessionId)
      if (session) {
        if (code !== 0 && signal !== 'SIGTERM' && signal !== 'SIGKILL') {
          // Unexpected crash
          const crashEvent: AgentCrashEvent = {
            sessionId,
            // @ts-expect-error - Post-Merge Reconciliation
            exitCode: code || undefined,
            signal: signal || undefined,
            timestamp: new Date(),
            session
          }
          this.emit('agent:crashed', crashEvent)
          await this.handleAgentCrash(sessionId)
        } else {
          // Normal shutdown
          await this.cleanupSession(sessionId)
        }
      }
    })
    
    process.on('error', (error) => {
      this.logger.error(`[${sessionId}] Process error:`, error)
    })
  }

  private async monitorHeartbeats(): Promise<void> {
    const now = new Date()
    
    for (const [sessionId, session] of this.activeSessions) {
      // @ts-expect-error - Post-Merge Reconciliation
      const timeSinceHeartbeat = now.getTime() - session.lastHeartbeat.getTime()
      
      if (timeSinceHeartbeat > this.config.agentTimeoutMs) {
        this.logger.warn(`💔 Agent ${sessionId} missed heartbeat, considering it crashed`)
        
        const crashEvent: AgentCrashEvent = {
          sessionId,
          timestamp: now,
          // @ts-expect-error - Post-Merge Reconciliation
          session,
          reason: 'heartbeat_timeout'
        }
        
        this.emit('agent:crashed', crashEvent)
        await this.handleAgentCrash(sessionId)
      }
    }
  }

  private startHeartbeatMonitoring(): void {
    this.heartbeatInterval = setInterval(
      () => this.monitorHeartbeats(),
      this.config.heartbeatIntervalMs
    )
  }

  private async handleAgentCrash(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId)
    if (!session) {return}
    
    this.logger.error(`💥 Handling agent crash: ${sessionId}`)
    
    try {
      // Save crash state for potential recovery
      if (this.config.enableRecovery) {
        await this.saveRecoveryState(session)
      }
      
      // Clean up the session
      await this.cleanupSession(sessionId)
      
      // Attempt automatic recovery if enabled
      // @ts-expect-error - Post-Merge Reconciliation
      if (this.config.enableRecovery && session.identity.autoRecover !== false) {
        this.logger.info(`🔄 Attempting automatic recovery for ${sessionId}`)
        try {
          await this.recoverFailedAgent(session.identity)
        } catch (error: unknown) {
          this.logger.error(`Failed automatic recovery for ${sessionId}:`, error)
        }
      }
    } catch (error: unknown) {
      this.logger.error(`Error handling agent crash ${sessionId}:`, error)
    }
  }

  private async saveRecoveryState(session: AgentSession): Promise<void> {
    try {
      const recoveryDir = join(this.config.workspaceBaseDir, 'recovery')
      await fs.mkdir(recoveryDir, { recursive: true })
      
      // @ts-expect-error - Post-Merge Reconciliation
      const stateFile = join(recoveryDir, `${session.project}_${session.identity.type}_${session.identity.role}.json`)
      const state = {
        session,
        timestamp: new Date(),
        workspaceFiles: await this.captureWorkspaceState(session.workspacePath)
      }
      
      await fs.writeFile(stateFile, JSON.stringify(state, null, 2))
      this.logger.info(`💾 Saved recovery state for ${session.id}`)
    } catch (error: unknown) {
      this.logger.error(`Failed to save recovery state for ${session.id}:`, error)
    }
  }

  private async captureWorkspaceState(workspacePath: string): Promise<string[]> {
    try {
      const files = await fs.readdir(workspacePath, { recursive: true })
      return files.filter(file => typeof file === 'string')
    } catch (error: unknown) {
      this.logger.warn(`Failed to capture workspace state: ${error}`)
      return []
    }
  }

  private async cleanupSession(sessionId: string): Promise<void> {
    try {
      // Remove process reference
      this.processes.delete(sessionId)
      
      // Clean up workspace
      await this.workspaceManager.cleanupWorkspace(sessionId)
      
      // Remove session
      this.activeSessions.delete(sessionId)
      
      this.logger.info(`🧹 Cleaned up session: ${sessionId}`)
    } catch (error: unknown) {
      this.logger.error(`Failed to cleanup session ${sessionId}:`, error)
    }
  }

  private setupMessageRouting(): void {
    this.messageBroker.on('message', async (message: AgentMessage) => {
      // Route messages between agents
      const targetSession = this.activeSessions.get(message.to)
      if (targetSession) {
        const process = this.processes.get(message.to)
        if (process && process.stdin) {
          try {
            const messageData = JSON.stringify(message) + '\n'
            process.stdin.write(messageData)
          } catch (error: unknown) {
            this.logger.error(`Failed to route message to ${message.to}:`, error)
          }
        }
      }
    })
  }

  private async recoverCrashedAgents(): Promise<void> {
    try {
      const recoveryDir = join(this.config.workspaceBaseDir, 'recovery')
      const stateFiles = await fs.readdir(recoveryDir).catch(() => [])
      
      for (const stateFile of stateFiles) {
        if (stateFile.endsWith('.json')) {
          try {
            const statePath = join(recoveryDir, stateFile)
            const stateData = await fs.readFile(statePath, 'utf8')
            const state = JSON.parse(stateData)
            
            // Check if this agent should be recovered
            const timeSinceCrash = new Date().getTime() - new Date(state.timestamp).getTime()
            if (timeSinceCrash < this.config.agentTimeoutMs * 2) {
              this.logger.info(`🔄 Recovering agent from state: ${stateFile}`)
              await this.recoverFailedAgent(state.session.identity)
              
              // Remove the recovery state file after successful recovery
              await fs.unlink(statePath)
            }
          } catch (error: unknown) {
            this.logger.error(`Failed to recover from state file ${stateFile}:`, error)
          }
        }
      }
    } catch (error: unknown) {
      this.logger.warn('Failed to recover crashed agents:', error)
    }
  }

  async shutdown(): Promise<void> {
    this.logger.info('🛑 Shutting down AgentOrchestrator...')
    this.isShuttingDown = true
    
    // Stop heartbeat monitoring
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
    }
    
    // Gracefully shutdown all agents
    const shutdownPromises = Array.from(this.activeSessions.keys()).map(sessionId =>
      this.killAgent(sessionId, true).catch(error => {
        this.logger.error(`Failed to shutdown agent ${sessionId}:`, error)
      })
    )
    
    await Promise.all(shutdownPromises)
    
    // Shutdown message broker
    await this.messageBroker.shutdown()
    
    // Final cleanup
    this.activeSessions.clear()
    this.processes.clear()
    
    this.logger.info('✅ AgentOrchestrator shutdown complete')
    this.emit('orchestrator:shutdown')
  }

  // Public getters for monitoring
  get sessionCount(): number {
    return this.activeSessions.size
  }

  get maxAgents(): number {
    return this.config.maxConcurrentAgents
  }

  get isInitialized(): boolean {
    // @ts-expect-error - Post-Merge Reconciliation
    return this.workspaceManager.isInitialized && this.messageBroker.isInitialized
  }

  get uptimeMs(): number {
    return this.workspaceManager.uptimeMs
  }
}

export default AgentOrchestrator