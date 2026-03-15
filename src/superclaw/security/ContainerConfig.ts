import type { SandboxConfig, SecurityPolicy } from './types'

export interface ContainerCreateOptions {
  name: string
  image: string
  memory: number
  cpus: number
  networkMode: string
  env: Record<string, string>
  mounts: Mount[]
  securityOpts: string[]
  capDrop: string[]
  capAdd: string[]
  user: string
  workingDir: string
  readonlyRootfs: boolean
  ulimits: Ulimit[]
}

export interface Mount {
  type: 'bind' | 'volume' | 'tmpfs'
  source?: string
  target: string
  readOnly?: boolean
  options?: string
}

export interface Ulimit {
  name: string
  soft: number
  hard: number
}

export class ContainerConfigBuilder {
  private config: Partial<ContainerCreateOptions> = {}
  
  static fromSandboxConfig(
    sandboxId: string,
    agentId: string,
    config: SandboxConfig
  ): ContainerCreateOptions {
    const builder = new ContainerConfigBuilder()
    
    return builder
      .setName(`superclaw-${sandboxId}`)
      .setImage('superclaw/secure-agent:latest')
      .setMemory(config.memoryMB * 1024 * 1024)
      .setCpus(config.cpuLimit)
      .setNetwork('superclaw-isolated')
      .setUser('agent:agent')
      .setWorkingDir('/workspace')
      .setReadonlyRootfs(true)
      .addMount({
        type: 'tmpfs',
        target: '/tmp',
        options: 'size=1G,exec'
      })
      .addMount({
        type: 'bind',
        source: `~/.superclaw/workspaces/${agentId}`,
        target: '/workspace',
        readOnly: false
      })
      .applySecurityPolicy(config.securityPolicy)
      .addEnv('AGENT_ID', agentId)
      .addEnv('SANDBOX_ID', sandboxId)
      .build()
  }
  
  setName(name: string): this {
    this.config.name = name
    return this
  }
  
  setImage(image: string): this {
    this.config.image = image
    return this
  }
  
  setMemory(bytes: number): this {
    this.config.memory = bytes
    return this
  }
  
  setCpus(cpus: number): this {
    this.config.cpus = cpus
    return this
  }
  
  setNetwork(mode: string): this {
    this.config.networkMode = mode
    return this
  }
  
  setUser(user: string): this {
    this.config.user = user
    return this
  }
  
  setWorkingDir(dir: string): this {
    this.config.workingDir = dir
    return this
  }
  
  setReadonlyRootfs(readonly: boolean): this {
    this.config.readonlyRootfs = readonly
    return this
  }
  
  addMount(mount: Mount): this {
    if (!this.config.mounts) this.config.mounts = []
    this.config.mounts.push(mount)
    return this
  }
  
  addEnv(key: string, value: string): this {
    if (!this.config.env) this.config.env = {}
    this.config.env[key] = value
    return this
  }
  
  applySecurityPolicy(policy: SecurityPolicy): this {
    // Drop all capabilities
    this.config.capDrop = ['ALL']
    
    // Add only minimal required
    this.config.capAdd = ['CHOWN', 'DAC_OVERRIDE', 'SETGID', 'SETUID']
    
    // Security options
    this.config.securityOpts = [
      'no-new-privileges:true',
      'seccomp:unconfined' // TODO: Custom seccomp profile
    ]
    
    // Resource limits
    this.config.ulimits = [
      { name: 'nproc', soft: policy.processes.maxProcesses, hard: policy.processes.maxProcesses },
      { name: 'nofile', soft: 1024, hard: 2048 }
    ]
    
    return this
  }
  
  build(): ContainerCreateOptions {
    return {
      name: this.config.name || `superclaw-${Date.now()}`,
      image: this.config.image || 'superclaw/secure-agent:latest',
      memory: this.config.memory || 2 * 1024 * 1024 * 1024, // 2GB default
      cpus: this.config.cpus || 0.5,
      networkMode: this.config.networkMode || 'bridge',
      env: this.config.env || {},
      mounts: this.config.mounts || [],
      securityOpts: this.config.securityOpts || [],
      capDrop: this.config.capDrop || ['ALL'],
      capAdd: this.config.capAdd || [],
      user: this.config.user || 'agent:agent',
      workingDir: this.config.workingDir || '/workspace',
      readonlyRootfs: this.config.readonlyRootfs ?? true,
      ulimits: this.config.ulimits || []
    }
  }
}

// Convert to Dockerode format
export function toDockerodeConfig(config: ContainerCreateOptions): any {
  return {
    name: config.name,
    Image: config.image,
    Env: Object.entries(config.env).map(([k, v]) => `${k}=${v}`),
    WorkingDir: config.workingDir,
    User: config.user,
    HostConfig: {
      Memory: config.memory,
      CpuPeriod: 100000,
      CpuQuota: Math.floor(config.cpus * 100000),
      NetworkMode: config.networkMode,
      Mounts: config.mounts.map(m => ({
        Type: m.type,
        Source: m.source,
        Target: m.target,
        ReadOnly: m.readOnly
      })),
      SecurityOpt: config.securityOpts,
      CapDrop: config.capDrop,
      CapAdd: config.capAdd,
      ReadonlyRootfs: config.readonlyRootfs,
      Ulimits: config.ulimits.map(u => ({
        Name: u.name,
        Soft: u.soft,
        Hard: u.hard
      }))
    }
  }
}