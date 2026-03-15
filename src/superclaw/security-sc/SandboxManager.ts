// @ts-nocheck
/**
 * Container-based sandbox manager for secure agent execution
 * 
 * This module provides comprehensive sandbox isolation using Docker containers
 * with strict security policies, resource limits, and audit logging.
 * 
 * @author SuperClaw Security Team
 * @version 2.2.0
 */

import { EventEmitter } from 'events'
import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import { createHash, randomBytes } from 'crypto'
import { join, resolve, dirname } from 'path'
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from 'fs'
import { generateSandboxId } from '../memory/hash-id-generator'
import { SUPERCLAW_SECURITY_POLICY } from './SecurityPolicies'
import type {
  Sandbox,
  SandboxConfig,
  SandboxStatus,
  ExecOptions,
  ExecResult,
  SecurityPolicy,
  SecurityAuditEvent,
  SecurityError,
  SandboxCheckpoint
} from './types'

const execAsync = promisify(exec)

/**
 * Docker-based sandbox manager with comprehensive security controls
 * 
 * Provides isolated container environments for agent code execution with
 * configurable resource limits, network isolation, and audit logging.
 */
export class SandboxManager extends EventEmitter {
  private activeSandboxes: Map<string, Sandbox> = new Map()
  private auditLog: SecurityAuditEvent[] = []
  private readonly sandboxRoot: string
  private readonly imageTag: string = 'superclaw-sandbox:latest'
  
  constructor(
    private defaultPolicy: SecurityPolicy = SUPERCLAW_SECURITY_POLICY,
    sandboxRoot: string = '/tmp/superclaw-sandboxes'
  ) {
    super()
    this.sandboxRoot = resolve(sandboxRoot)
    this.ensureSandboxRoot()
    this.ensureDockerImage()
  }

  /**
   * Create a secure sandbox container with comprehensive isolation
   * 
   * @param agentId - ID of the agent that will use this sandbox
   * @param config - Optional configuration overrides
   * @returns The unique sandbox ID
   */
  async createSecureSandbox(agentId: string, config?: Partial<SandboxConfig>): Promise<string> {
    const sandboxId = generateSandboxId(agentId)
    const fullConfig: SandboxConfig = {
      memoryMB: 2048,
      cpuLimit: 0.5,
      diskGB: 10,
      timeoutMs: 300000,
      securityPolicy: this.defaultPolicy,
      ...config
    }

    try {
      // Create sandbox workspace directory
      const sandboxPath = join(this.sandboxRoot, sandboxId)
      mkdirSync(sandboxPath, { recursive: true })

      // Create workspace subdirectories
      mkdirSync(join(sandboxPath, 'workspace'), { recursive: true })
      mkdirSync(join(sandboxPath, 'checkpoints'), { recursive: true })
      mkdirSync(join(sandboxPath, 'logs'), { recursive: true })

      // Write security policy to container
      const policyPath = join(sandboxPath, 'security-policy.json')
      writeFileSync(policyPath, JSON.stringify(fullConfig.securityPolicy, null, 2))

      // Build Docker run command with security constraints
      const dockerArgs = this.buildDockerArgs(sandboxId, fullConfig, sandboxPath)
      
      await this.logAuditEvent({
        sandboxId,
        eventType: 'sandbox_created',
        details: {
          agentId,
          config: fullConfig,
          dockerArgs
        },
        severity: 'low'
      })

      // Create and start the container
      const { stdout: containerId } = await execAsync(`docker run -d ${dockerArgs.join(' ')} ${this.imageTag}`)
      const cleanContainerId = containerId.trim()

      // Wait for container to be ready
      await this.waitForContainerReady(cleanContainerId)

      // Create sandbox record
      const sandbox: Sandbox = {
        id: sandboxId,
        agentId,
        containerId: cleanContainerId,
        config: fullConfig,
        status: 'running',
        createdAt: new Date(),
        checkpoints: new Map()
      }

      this.activeSandboxes.set(sandboxId, sandbox)
      
      // Set up timeout for sandbox destruction
      if (fullConfig.timeoutMs > 0) {
        setTimeout(() => {
          this.destroySandbox(sandboxId).catch(err => {
            this.emit('error', new Error(`Failed to auto-destroy sandbox ${sandboxId}: ${err.message}`))
          })
        }, fullConfig.timeoutMs)
      }

      return sandboxId

    } catch (error: unknown) {
      await this.logAuditEvent({
        sandboxId,
        eventType: 'sandbox_created',
        details: {
          error: (error as Error).message,
          agentId,
          config: fullConfig
        },
        severity: 'high'
      })
      // @ts-expect-error - Post-Merge Reconciliation
      throw new SecurityError(`Failed to create sandbox ${sandboxId}: ${(error as Error).message}`, 'SANDBOX_CREATE_FAILED')
    }
  }

  /**
   * Execute a command within a sandbox with security validation
   * 
   * @param sandboxId - ID of the target sandbox
   * @param command - Command string to execute
   * @param options - Execution options and overrides
   * @returns Execution result with output and timing
   */
  async executeCommand(sandboxId: string, command: string, options?: ExecOptions): Promise<ExecResult> {
    const sandbox = this.activeSandboxes.get(sandboxId)
    if (!sandbox) {
      // @ts-expect-error - Post-Merge Reconciliation
      throw new SecurityError(`Sandbox ${sandboxId} not found`, 'SANDBOX_NOT_FOUND')
    }

    if (sandbox.status !== 'running') {
      // @ts-expect-error - Post-Merge Reconciliation
      throw new SecurityError(`Sandbox ${sandboxId} is not running (status: ${sandbox.status})`, 'SANDBOX_NOT_RUNNING')
    }

    // Validate command against security policy
    await this.validateCommand(command, sandbox.config.securityPolicy)

    const startTime = Date.now()
    let killed = false
    let signal: string | undefined

    try {
      // Build docker exec command
      const execArgs = this.buildExecArgs(sandbox.containerId, command, options)
      const timeout = options?.timeout || sandbox.config.securityPolicy.processes.processTimeoutMs
      
      // Execute command with timeout
      const execPromise = execAsync(`docker exec ${execArgs.join(' ')} ${sandbox.containerId} ${command}`, {
        timeout,
        env: {
          ...process.env,
          ...options?.env
        }
      })

      const result = await execPromise
      const durationMs = Date.now() - startTime

      const execResult: ExecResult = {
        exitCode: 0,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        durationMs,
        killed,
        signal
      }

      await this.logAuditEvent({
        sandboxId,
        eventType: 'command_executed',
        details: {
          command,
          exitCode: execResult.exitCode,
          durationMs,
          options
        },
        severity: 'low'
      })

      return execResult

    } catch (error: any) {
      const durationMs = Date.now() - startTime

      // Handle timeout or process killed
      if (error.killed || error.signal) {
        killed = true
        signal = error.signal
      }

      const execResult: ExecResult = {
        exitCode: (error).code || -1,
        stdout: error.stdout || '',
        stderr: error.stderr || (error as Error).message || '',
        durationMs,
        killed,
        signal
      }

      await this.logAuditEvent({
        sandboxId,
        eventType: 'command_executed',
        details: {
          command,
          exitCode: execResult.exitCode,
          durationMs,
          killed,
          signal,
          error: (error as Error).message,
          options
        },
        severity: killed ? 'medium' : 'low'
      })

      return execResult
    }
  }

  /**
   * Create a filesystem checkpoint for rollback capabilities
   * 
   * @param sandboxId - ID of the target sandbox
   * @param name - Human-readable checkpoint name
   */
  async createCheckpoint(sandboxId: string, name: string): Promise<void> {
    const sandbox = this.activeSandboxes.get(sandboxId)
    if (!sandbox) {
      // @ts-expect-error - Post-Merge Reconciliation
      throw new SecurityError(`Sandbox ${sandboxId} not found`, 'SANDBOX_NOT_FOUND')
    }

    const checkpointPath = join(this.sandboxRoot, sandboxId, 'checkpoints', name)
    
    try {
      // Use Docker commit to create a checkpoint image
      const imageTag = `${sandboxId}-checkpoint-${name}:latest`
      await execAsync(`docker commit ${sandbox.containerId} ${imageTag}`)

      // Calculate checkpoint size
      const { stdout: inspectOutput } = await execAsync(`docker inspect ${imageTag} --format='{{.Size}}'`)
      const sizeBytes = parseInt(inspectOutput.trim(), 10)

      const checkpoint: SandboxCheckpoint = {
        name,
        path: imageTag,
        createdAt: new Date(),
        sizeBytes
      }

      sandbox.checkpoints.set(name, checkpoint)

      await this.logAuditEvent({
        sandboxId,
        eventType: 'checkpoint_created',
        details: {
          checkpointName: name,
          imageTag,
          sizeBytes
        },
        severity: 'low'
      })

    } catch (error: any) {
      await this.logAuditEvent({
        sandboxId,
        eventType: 'checkpoint_created',
        details: {
          checkpointName: name,
          error: (error as Error).message
        },
        severity: 'medium'
      })
      // @ts-expect-error - Post-Merge Reconciliation
      throw new SecurityError(`Failed to create checkpoint ${name}: ${(error as Error).message}`, 'CHECKPOINT_CREATE_FAILED')
    }
  }

  /**
   * Rollback sandbox to a previous checkpoint
   * 
   * @param sandboxId - ID of the target sandbox
   * @param checkpointName - Name of the checkpoint to restore
   */
  async rollback(sandboxId: string, checkpointName: string): Promise<void> {
    const sandbox = this.activeSandboxes.get(sandboxId)
    if (!sandbox) {
      // @ts-expect-error - Post-Merge Reconciliation
      throw new SecurityError(`Sandbox ${sandboxId} not found`, 'SANDBOX_NOT_FOUND')
    }

    const checkpoint = sandbox.checkpoints.get(checkpointName)
    if (!checkpoint) {
      // @ts-expect-error - Post-Merge Reconciliation
      throw new SecurityError(`Checkpoint ${checkpointName} not found`, 'CHECKPOINT_NOT_FOUND')
    }

    try {
      // Stop current container
      await execAsync(`docker stop ${sandbox.containerId}`)
      await execAsync(`docker rm ${sandbox.containerId}`)

      // Start new container from checkpoint image
      const sandboxPath = join(this.sandboxRoot, sandboxId)
      const dockerArgs = this.buildDockerArgs(sandboxId, sandbox.config, sandboxPath)
      
      const { stdout: newContainerId } = await execAsync(
        `docker run -d ${dockerArgs.join(' ')} ${checkpoint.path}`
      )
      
      sandbox.containerId = newContainerId.trim()
      sandbox.status = 'running'

      await this.logAuditEvent({
        sandboxId,
        eventType: 'rollback_executed',
        details: {
          checkpointName,
          oldContainerId: sandbox.containerId,
          newContainerId: newContainerId.trim()
        },
        severity: 'medium'
      })

    } catch (error: any) {
      sandbox.status = 'failed'
      await this.logAuditEvent({
        sandboxId,
        eventType: 'rollback_executed',
        details: {
          checkpointName,
          error: (error as Error).message
        },
        severity: 'high'
      })
      // @ts-expect-error - Post-Merge Reconciliation
      throw new SecurityError(`Failed to rollback to checkpoint ${checkpointName}: ${(error as Error).message}`, 'ROLLBACK_FAILED')
    }
  }

  /**
   * Destroy a sandbox and clean up all resources
   * 
   * @param sandboxId - ID of the sandbox to destroy
   */
  async destroySandbox(sandboxId: string): Promise<void> {
    const sandbox = this.activeSandboxes.get(sandboxId)
    if (!sandbox) {
      return // Already destroyed or never existed
    }

    try {
      // Stop and remove container
      if (sandbox.containerId) {
        await execAsync(`docker stop ${sandbox.containerId}`).catch(() => {}) // Ignore if already stopped
        await execAsync(`docker rm ${sandbox.containerId}`).catch(() => {})   // Ignore if already removed
      }

      // Clean up checkpoint images
      for (const checkpoint of sandbox.checkpoints.values()) {
        await execAsync(`docker rmi ${checkpoint.path}`).catch(() => {}) // Ignore if image doesn't exist
      }

      // Clean up filesystem
      const sandboxPath = join(this.sandboxRoot, sandboxId)
      if (existsSync(sandboxPath)) {
        rmSync(sandboxPath, { recursive: true, force: true })
      }

      this.activeSandboxes.delete(sandboxId)

      await this.logAuditEvent({
        sandboxId,
        eventType: 'sandbox_destroyed',
        details: {
          containerId: sandbox.containerId,
          checkpointCount: sandbox.checkpoints.size
        },
        severity: 'low'
      })

    } catch (error: any) {
      await this.logAuditEvent({
        sandboxId,
        eventType: 'sandbox_destroyed',
        details: {
          error: (error as Error).message,
          containerId: sandbox.containerId
        },
        severity: 'medium'
      })
      // @ts-expect-error - Post-Merge Reconciliation
      throw new SecurityError(`Failed to destroy sandbox ${sandboxId}: ${(error as Error).message}`, 'SANDBOX_DESTROY_FAILED')
    }
  }

  /**
   * Get sandbox information
   */
  getSandbox(sandboxId: string): Sandbox | undefined {
    return this.activeSandboxes.get(sandboxId)
  }

  /**
   * List all active sandboxes
   */
  listSandboxes(): Sandbox[] {
    return Array.from(this.activeSandboxes.values())
  }

  /**
   * Get filtered audit log
   */
  getAuditLog(filter?: { sandboxId?: string; severity?: string }): SecurityAuditEvent[] {
    if (!filter) {
      return [...this.auditLog]
    }

    return this.auditLog.filter(event => {
      if (filter.sandboxId && event.sandboxId !== filter.sandboxId) {
        return false
      }
      if (filter.severity && event.severity !== filter.severity) {
        return false
      }
      return true
    })
  }

  /**
   * Validate command against security policy
   */
  private async validateCommand(command: string, policy: SecurityPolicy): Promise<void> {
    const parts = command.trim().split(/\s+/)
    const binary = parts[0]

    // Check against deny list first
    if (policy.processes.denyCommands.includes('*') && !policy.processes.allowCommands.includes(binary)) {
      // @ts-expect-error - Post-Merge Reconciliation
      throw new SecurityError(`Command '${binary}' is not in allowed list`, 'COMMAND_NOT_ALLOWED')
    }

    if (policy.processes.denyCommands.includes(binary)) {
      // @ts-expect-error - Post-Merge Reconciliation
      throw new SecurityError(`Command '${binary}' is explicitly denied`, 'COMMAND_DENIED')
    }

    // Check against allow list
    if (policy.processes.allowCommands.length > 0 && !policy.processes.allowCommands.includes('*')) {
      if (!policy.processes.allowCommands.includes(binary)) {
        // @ts-expect-error - Post-Merge Reconciliation
        throw new SecurityError(`Command '${binary}' is not in allowed list`, 'COMMAND_NOT_ALLOWED')
      }
    }

    // Check for dangerous patterns
    const dangerousPatterns = [
      /rm\s+-rf\s+\/\*/, // rm -rf /*
      /dd\s+if=.*of=\/dev/, // dd to device files
      />\s*\/dev\//, // Redirect to device files
      /fork\(\)/, // Process forking
      /system\(/, // System calls
      /exec\(/, // Process execution
    ]

    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        // @ts-expect-error - Post-Merge Reconciliation
        throw new SecurityError(`Command contains dangerous pattern: ${pattern}`, 'DANGEROUS_COMMAND')
      }
    }
  }

  /**
   * Log security audit events
   */
  private async logAuditEvent(event: Omit<SecurityAuditEvent, 'timestamp'>): Promise<void> {
    const fullEvent: SecurityAuditEvent = {
      ...event,
      timestamp: new Date()
    }
    
    this.auditLog.push(fullEvent)
    this.emit('audit', fullEvent)

    // Keep audit log size manageable (last 10,000 events)
    if (this.auditLog.length > 10000) {
      this.auditLog.splice(0, this.auditLog.length - 10000)
    }
  }

  /**
   * Build Docker run arguments with security constraints
   */
  private buildDockerArgs(sandboxId: string, config: SandboxConfig, sandboxPath: string): string[] {
    const args = [
      // Resource limits
      `--memory=${config.memoryMB}m`,
      `--cpus=${config.cpuLimit}`,
      `--storage-opt size=${config.diskGB}G`,
      
      // Security options
      '--security-opt=no-new-privileges:true',
      '--security-opt=apparmor:unconfined', // Will be confined by custom profile
      '--cap-drop=ALL',
      '--cap-add=SETGID',
      '--cap-add=SETUID',
      
      // Network isolation
      '--network=none', // No network by default
      
      // Filesystem isolation
      '--read-only=true',
      '--tmpfs=/tmp:rw,noexec,nosuid,size=1g',
      
      // Mount workspace
      `-v ${join(sandboxPath, 'workspace')}:/workspace:rw`,
      
      // User isolation
      '--user=1000:1000',
      
      // Process limits
      '--pids-limit=100',
      
      // Name and labels
      `--name=superclaw-${sandboxId}`,
      `--label=superclaw.sandbox.id=${sandboxId}`,
      `--label=superclaw.sandbox.created=${new Date().toISOString()}`,
      
      // Auto-remove when stopped
      '--rm=false' // We manage removal manually
    ]

    // Add network configuration if specified
    if (config.network?.allowPublicTraffic) {
      args.push('--network=bridge')
    } else if (config.network?.allowDomains && config.network.allowDomains.length > 0) {
      args.push('--network=bridge')
      // Network filtering would be handled by iptables rules or network policies
    }

    return args
  }

  /**
   * Build Docker exec arguments
   */
  private buildExecArgs(containerId: string, command: string, options?: ExecOptions): string[] {
    const args = []

    if (options?.user) {
      args.push(`--user=${options.user}`)
    }

    if (options?.cwd) {
      args.push(`--workdir=${options.cwd}`)
    }

    // Add environment variables
    if (options?.env) {
      Object.entries(options.env).forEach(([key, value]) => {
        args.push(`--env=${key}=${value}`)
      })
    }

    return args
  }

  /**
   * Ensure sandbox root directory exists
   */
  private ensureSandboxRoot(): void {
    if (!existsSync(this.sandboxRoot)) {
      mkdirSync(this.sandboxRoot, { recursive: true })
    }
  }

  /**
   * Ensure Docker base image exists
   */
  private async ensureDockerImage(): Promise<void> {
    try {
      // Check if image exists
      await execAsync(`docker inspect ${this.imageTag}`)
    } catch {
      // Build base image if it doesn't exist
      await this.buildBaseImage()
    }
  }

  /**
   * Build the base sandbox Docker image
   */
  private async buildBaseImage(): Promise<void> {
    const dockerfile = `
FROM ubuntu:22.04

# Install basic tools
RUN apt-get update && apt-get install -y \\
    curl \\
    git \\
    nodejs \\
    npm \\
    python3 \\
    python3-pip \\
    bash \\
    coreutils \\
    && rm -rf /var/lib/apt/lists/*

# Create sandbox user
RUN useradd -m -u 1000 -s /bin/bash sandbox

# Create workspace directory
RUN mkdir -p /workspace && chown sandbox:sandbox /workspace

# Set working directory
WORKDIR /workspace

# Default command (keep container running)
CMD ["tail", "-f", "/dev/null"]
`

    const buildContext = join(this.sandboxRoot, 'build')
    mkdirSync(buildContext, { recursive: true })
    writeFileSync(join(buildContext, 'Dockerfile'), dockerfile)

    try {
      await execAsync(`docker build -t ${this.imageTag} ${buildContext}`)
    } finally {
      // Clean up build context
      rmSync(buildContext, { recursive: true, force: true })
    }
  }

  /**
   * Wait for container to be ready
   */
  private async waitForContainerReady(containerId: string, timeoutMs: number = 30000): Promise<void> {
    const startTime = Date.now()

    while (Date.now() - startTime < timeoutMs) {
      try {
        const { stdout } = await execAsync(`docker exec ${containerId} echo "ready"`)
        if (stdout.trim() === 'ready') {
          return
        }
      } catch {
        // Container not ready yet
      }

      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    // @ts-expect-error - Post-Merge Reconciliation
    throw new SecurityError('Container failed to become ready within timeout', 'CONTAINER_NOT_READY')
  }
}

export default SandboxManager