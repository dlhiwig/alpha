// @ts-nocheck
/**
 * Lightweight Dependency Injection for SKYNET
 * Enables loose coupling between systems
 */

type Factory<T> = () => T | Promise<T>
type Token<T> = symbol & { __type?: T }

export function createToken<T>(name: string): Token<T> {
  return Symbol(name) as Token<T>
}

export class Container {
  private factories: Map<symbol, Factory<any>> = new Map()
  private instances: Map<symbol, any> = new Map()
  private singletons: Set<symbol> = new Set()
  
  register<T>(token: Token<T>, factory: Factory<T>, singleton = true): this {
    this.factories.set(token, factory)
    if (singleton) {
      this.singletons.add(token)
    }
    return this
  }
  
  async resolve<T>(token: Token<T>): Promise<T> {
    // Return cached singleton if exists
    if (this.singletons.has(token) && this.instances.has(token)) {
      return this.instances.get(token)
    }
    
    const factory = this.factories.get(token)
    if (!factory) {
      throw new Error(`No factory registered for ${token.toString()}`)
    }
    
    const instance = await factory()
    
    // Cache singleton
    if (this.singletons.has(token)) {
      this.instances.set(token, instance)
    }
    
    return instance
  }
  
  has(token: symbol): boolean {
    return this.factories.has(token)
  }
  
  clear(): void {
    this.instances.clear()
  }
}

// SKYNET Service Tokens
export const TOKENS = {
  MemoryService: createToken<import('../memory/MemoryService').MemoryService>('MemoryService'),
  DoltService: createToken<import('../memory/DoltService').DoltService>('DoltService'),
  MemoryCompactor: createToken<import('../memory/compactor').MemoryCompactor>('MemoryCompactor'),
  
  AgentOrchestrator: createToken<import('../orchestration/AgentOrchestrator').AgentOrchestrator>('AgentOrchestrator'),
  WorkspaceManager: createToken<import('../orchestration/WorkspaceManager').WorkspaceManager>('WorkspaceManager'),
  MessageBroker: createToken<import('../orchestration/MessageBroker').MessageBroker>('MessageBroker'),
  
  SandboxManager: createToken<import('../security/SandboxManager').SandboxManager>('SandboxManager'),
  AuditLogger: createToken<import('../security/AuditLogger').AuditLogger>('AuditLogger'),
  
  ConsensusJudge: createToken<import('../consensus/ConsensusJudge').ConsensusJudge>('ConsensusJudge'),
  
  CostController: createToken<import('../skynet/cost-control').CostController>('CostController'),
  
  HealthChecker: createToken<import('../health').HealthChecker>('HealthChecker'),
  MetricsRegistry: createToken<import('../metrics').MetricsRegistry>('MetricsRegistry')
}

// Create configured container
export function createSkynetContainer(): Container {
  const container = new Container()
  
  // Register memory services
  container.register(TOKENS.DoltService, async () => {
    const { DoltService } = await import('../memory/DoltService')
    const service = new DoltService()
    await service.initialize()
    return service
  })
  
  container.register(TOKENS.MemoryService, async () => {
    const { MemoryService } = await import('../memory/MemoryService')
    return new MemoryService()
  })
  
  // Register orchestration services
  container.register(TOKENS.MessageBroker, async () => {
    const { MessageBroker } = await import('../orchestration/MessageBroker')
    return new MessageBroker()
  })
  
  container.register(TOKENS.AgentOrchestrator, async () => {
    const { AgentOrchestrator } = await import('../orchestration/AgentOrchestrator')
    const orchestrator = new AgentOrchestrator()
    await orchestrator.initialize()
    return orchestrator
  })
  
  // Register security services
  container.register(TOKENS.SandboxManager, async () => {
    const { SandboxManager } = await import('../security/SandboxManager')
    return new SandboxManager()
  })
  
  container.register(TOKENS.AuditLogger, async () => {
    const { AuditLogger } = await import('../security/AuditLogger')
    const logger = new AuditLogger()
    await logger.initialize()
    return logger
  })
  
  // Register consensus services
  container.register(TOKENS.ConsensusJudge, async () => {
    const { ConsensusJudge } = await import('../consensus/ConsensusJudge')
    return new ConsensusJudge()
  })
  
  // Register cost control
  container.register(TOKENS.CostController, async () => {
    const { CostController } = await import('../skynet/cost-control')
    return new CostController()
  })
  
  return container
}

// Global container instance
export const skynetContainer = createSkynetContainer()