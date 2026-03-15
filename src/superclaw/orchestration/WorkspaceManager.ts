import { exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs/promises'
import * as path from 'path'
import type { AgentIdentity, WorkspaceConfig, OrchestratorConfig } from './types'

const execAsync = promisify(exec)

export class WorkspaceManager {
  private config: OrchestratorConfig
  private activeWorkspaces: Map<string, string> = new Map()
  private isInitialized = false
  private startTime: number = 0
  
  constructor(config: OrchestratorConfig) {
    this.config = config
  }
  
  async initialize(): Promise<void> {
    // Ensure base workspace directory exists
    const baseDir = this.config.workspaceBaseDir.replace('~', process.env.HOME || '')
    await fs.mkdir(baseDir, { recursive: true })
    
    // Create recovery directory if needed
    const recoveryDir = path.join(baseDir, 'recovery')
    await fs.mkdir(recoveryDir, { recursive: true })
    
    this.startTime = Date.now()
    this.isInitialized = true
  }
  
  get initialized(): boolean {
    return this.isInitialized
  }
  
  get uptimeMs(): number {
    return this.startTime > 0 ? Date.now() - this.startTime : 0
  }
  
  async createWorkspace(sessionId: string, project: string): Promise<string> {
    const workspaceDir = path.join(
      this.config.workspaceBaseDir.replace('~', process.env.HOME || ''),
      project,
      'sessions',
      sessionId
    )
    
    // Create directory structure
    await fs.mkdir(workspaceDir, { recursive: true })
    await this.initializeAgentDirs(workspaceDir)
    
    this.activeWorkspaces.set(sessionId, workspaceDir)
    return workspaceDir
  }
  
  async cleanupWorkspace(sessionId: string): Promise<void> {
    const workspaceDir = this.activeWorkspaces.get(sessionId)
    
    if (!workspaceDir) {
      return // Already cleaned up or never existed
    }
    
    try {
      // Remove directory if it exists
      await fs.rm(workspaceDir, { recursive: true, force: true })
    } catch (error: unknown) {
      // Directory might not exist or already removed, log but don't throw
      console.warn(`Failed to remove workspace directory ${workspaceDir}:`, error)
    } finally {
      // Always remove from active map
      this.activeWorkspaces.delete(sessionId)
    }
  }
  
  async createAgentWorkspace(identity: AgentIdentity): Promise<string> {
    const workspaceDir = this.getWorkspacePath(identity)
    
    // Check if workspace already exists
    const existing = await this.findExistingWorkspace(identity)
    if (existing) {
      this.activeWorkspaces.set(this.getWorkspaceKey(identity), existing)
      return existing
    }
    
    if (this.config.enableGitWorktrees) {
      // Create isolated git worktree
      await this.createGitWorktree(identity, workspaceDir)
    } else {
      // Simple directory isolation
      await fs.mkdir(workspaceDir, { recursive: true })
    }
    
    // Initialize agent directories
    await this.initializeAgentDirs(workspaceDir)
    
    this.activeWorkspaces.set(this.getWorkspaceKey(identity), workspaceDir)
    return workspaceDir
  }
  
  async destroyWorkspace(identity: AgentIdentity): Promise<void> {
    const workspaceKey = this.getWorkspaceKey(identity)
    const workspaceDir = this.activeWorkspaces.get(workspaceKey)
    
    if (!workspaceDir) {
      return // Already cleaned up or never existed
    }
    
    try {
      if (this.config.enableGitWorktrees) {
        // Remove git worktree
        await this.removeGitWorktree(workspaceDir)
      }
      
      // Remove directory if it exists
      try {
        await fs.rm(workspaceDir, { recursive: true, force: true })
      } catch (error: unknown) {
        // Directory might not exist or already removed, log but don't throw
        console.warn(`Failed to remove workspace directory ${workspaceDir}:`, error)
      }
    } finally {
      // Always remove from active map
      this.activeWorkspaces.delete(workspaceKey)
    }
  }
  
  async findExistingWorkspace(identity: AgentIdentity): Promise<string | null> {
    const workspaceDir = this.getWorkspacePath(identity)
    
    try {
      const stats = await fs.stat(workspaceDir)
      if (stats.isDirectory()) {
        // Check if it has the expected agent directory structure
        const runtimeDir = path.join(workspaceDir, '.runtime')
        const runtimeStats = await fs.stat(runtimeDir)
        if (runtimeStats.isDirectory()) {
          return workspaceDir
        }
      }
    } catch (error: unknown) {
      // Directory doesn't exist or not accessible
      return null
    }
    
    return null
  }
  
  async persistAgentState(workspace: string, state: any): Promise<void> {
    const stateFile = path.join(workspace, '.runtime', 'state.json')
    const tempFile = stateFile + '.tmp'
    
    try {
      // Atomic write using temp file
      await fs.writeFile(tempFile, JSON.stringify(state, null, 2), 'utf8')
      await fs.rename(tempFile, stateFile)
      
      // Commit to git if enabled
      if (this.config.enableGitWorktrees) {
        await this.commitWorkspaceState(workspace, 'Update agent state')
      }
    } catch (error: unknown) {
      // Clean up temp file if it exists
      try {
        await fs.unlink(tempFile)
      } catch {}
      throw error
    }
  }
  
  async loadPersistedState(workspace: string): Promise<any | null> {
    const stateFile = path.join(workspace, '.runtime', 'state.json')
    
    try {
      const content = await fs.readFile(stateFile, 'utf8')
      return JSON.parse(content)
    } catch (error: unknown) {
      // State file doesn't exist or invalid JSON
      return null
    }
  }
  
  async createCheckpoint(workspace: string, name: string): Promise<void> {
    const checkpointDir = path.join(workspace, '.checkpoints', name)
    const runtimeDir = path.join(workspace, '.runtime')
    
    // Create checkpoint directory
    await fs.mkdir(checkpointDir, { recursive: true })
    
    // Copy current runtime state
    try {
      const files = await fs.readdir(runtimeDir)
      for (const file of files) {
        const srcPath = path.join(runtimeDir, file)
        const destPath = path.join(checkpointDir, file)
        await fs.copyFile(srcPath, destPath)
      }
    } catch (error: unknown) {
      // Runtime dir might be empty or not exist yet
      console.warn(`Warning: Could not copy runtime state for checkpoint ${name}:`, error)
    }
    
    // Add checkpoint metadata
    const metadata = {
      name,
      created: new Date().toISOString(),
      workspace: path.basename(workspace)
    }
    await fs.writeFile(
      path.join(checkpointDir, 'metadata.json'),
      JSON.stringify(metadata, null, 2),
      'utf8'
    )
    
    // Commit to git with tag if enabled
    if (this.config.enableGitWorktrees) {
      await this.commitWorkspaceState(workspace, `Create checkpoint: ${name}`)
      await this.createGitTag(workspace, `checkpoint-${name}`)
    }
  }
  
  async restoreCheckpoint(workspace: string, name: string): Promise<void> {
    const checkpointDir = path.join(workspace, '.checkpoints', name)
    const runtimeDir = path.join(workspace, '.runtime')
    
    // Check if checkpoint exists
    try {
      const stats = await fs.stat(checkpointDir)
      if (!stats.isDirectory()) {
        throw new Error(`Checkpoint ${name} is not a directory`)
      }
    } catch (error: unknown) {
      throw new Error(`Checkpoint ${name} not found: ${error}`, { cause: error })
    }
    
    // Clear current runtime state
    try {
      await fs.rm(runtimeDir, { recursive: true, force: true })
    } catch {}
    
    // Recreate runtime directory
    await fs.mkdir(runtimeDir, { recursive: true })
    
    // Restore files from checkpoint (excluding metadata)
    const files = await fs.readdir(checkpointDir)
    for (const file of files) {
      if (file === 'metadata.json') {continue}
      
      const srcPath = path.join(checkpointDir, file)
      const destPath = path.join(runtimeDir, file)
      await fs.copyFile(srcPath, destPath)
    }
    
    // Commit restoration if git enabled
    if (this.config.enableGitWorktrees) {
      await this.commitWorkspaceState(workspace, `Restore checkpoint: ${name}`)
    }
  }
  
  async listCheckpoints(workspace: string): Promise<string[]> {
    const checkpointsDir = path.join(workspace, '.checkpoints')
    
    try {
      const entries = await fs.readdir(checkpointsDir, { withFileTypes: true })
      const checkpoints = entries
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .toSorted()
      
      return checkpoints
    } catch (error: unknown) {
      // Checkpoints directory doesn't exist
      return []
    }
  }
  
  private getWorkspacePath(identity: AgentIdentity): string {
    return path.join(
      this.config.workspaceBaseDir.replace('~', process.env.HOME || ''),
      identity.project,
      'agents',
      identity.name
    )
  }
  
  private getWorkspaceKey(identity: AgentIdentity): string {
    return `${identity.namespace}:${identity.project}:${identity.name}`
  }
  
  private async createGitWorktree(identity: AgentIdentity, targetDir: string): Promise<void> {
    // Ensure parent directory exists
    const parentDir = path.dirname(targetDir)
    await fs.mkdir(parentDir, { recursive: true })
    
    try {
      // Create a new branch for this agent workspace
      const branchName = `agent/${identity.project}/${identity.name}`
      
      // Navigate to the base repository directory
      const baseRepoDir = this.config.workspaceBaseDir.replace('~', process.env.HOME || '')
      
      // Add worktree with new branch
      await execAsync(`git worktree add -b ${branchName} "${targetDir}" HEAD`, {
        cwd: baseRepoDir
      })
      
      // Initialize the worktree with a commit
      await execAsync(`git commit --allow-empty -m "Initialize agent workspace: ${identity.name}"`, {
        cwd: targetDir
      })
      
    } catch (error: unknown) {
      throw new Error(`Failed to create git worktree for ${identity.name}: ${error}`, { cause: error })
    }
  }
  
  private async removeGitWorktree(workspaceDir: string): Promise<void> {
    try {
      // Get the base repository directory
      const baseRepoDir = this.config.workspaceBaseDir.replace('~', process.env.HOME || '')
      
      // Remove the worktree
      await execAsync(`git worktree remove "${workspaceDir}" --force`, {
        cwd: baseRepoDir
      })
      
      // Prune worktrees to clean up references
      await execAsync(`git worktree prune`, {
        cwd: baseRepoDir
      })
      
    } catch (error: unknown) {
      console.warn(`Warning: Failed to remove git worktree ${workspaceDir}:`, error)
    }
  }
  
  private async commitWorkspaceState(workspace: string, message: string): Promise<void> {
    try {
      // Stage all changes
      await execAsync(`git add .`, { cwd: workspace })
      
      // Commit if there are changes
      await execAsync(`git diff --staged --quiet || git commit -m "${message}"`, {
        cwd: workspace
      })
    } catch (error: unknown) {
      console.warn(`Warning: Failed to commit workspace state:`, error)
    }
  }
  
  private async createGitTag(workspace: string, tagName: string): Promise<void> {
    try {
      await execAsync(`git tag "${tagName}"`, { cwd: workspace })
    } catch (error: unknown) {
      console.warn(`Warning: Failed to create git tag ${tagName}:`, error)
    }
  }
  
  private async initializeAgentDirs(workspaceDir: string): Promise<void> {
    await fs.mkdir(path.join(workspaceDir, '.runtime'), { recursive: true })
    await fs.mkdir(path.join(workspaceDir, '.checkpoints'), { recursive: true })
    await fs.mkdir(path.join(workspaceDir, '.logs'), { recursive: true })
  }
}