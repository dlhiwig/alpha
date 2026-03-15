/**
 * Hexagonal Architecture — Ports & Adapters
 * 
 * Stolen from: DreamLab-AI/VisionFlow (Actix actor system + trait-based DI)
 * 
 * Every external dependency is accessed through a Port (interface).
 * Adapters implement the Port for specific technologies.
 * Business logic NEVER imports a concrete implementation.
 * 
 * Swap implementations at runtime via the Registry:
 *   registry.bind('llm', new OllamaAdapter());       // edge
 *   registry.bind('llm', new AnthropicAdapter());     // cloud
 *   registry.bind('memory', new MemoryOSAdapter());   // production
 *   registry.bind('memory', new InMemoryAdapter());   // testing
 * 
 * MUTHUR Architecture Layer: Foundation
 */

// ─────────────────────────────────────────────────────────────────
// Port Definitions (Interfaces Only — Zero Dependencies)
// ─────────────────────────────────────────────────────────────────

/**
 * LLM Port — All model interactions go through this.
 * Replaces direct provider imports throughout the codebase.
 */
export interface LLMPort {
  readonly name: string;

  /** Generate a completion. */
  complete(request: LLMRequest): Promise<LLMResponse>;

  /** Stream a completion (returns async iterator). */
  stream(request: LLMRequest): AsyncIterable<LLMChunk>;

  /** Check if provider is healthy. */
  healthCheck(): Promise<HealthStatus>;

  /** Estimate cost before executing (in USD). */
  estimateCost(request: LLMRequest): number;
}

export interface LLMRequest {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  tools?: ToolDefinition[];
  timeout?: number;
  metadata?: Record<string, unknown>;
}

export interface LLMResponse {
  content: string;
  model: string;
  provider: string;
  usage: TokenUsage;
  latencyMs: number;
  costUsd: number;
  toolCalls?: ToolCall[];
  finishReason: 'stop' | 'length' | 'tool_calls' | 'error';
}

export interface LLMChunk {
  content: string;
  done: boolean;
  usage?: TokenUsage;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Memory Port — All persistent memory operations.
 * Replaces CORTEX's direct file-based storage.
 */
export interface MemoryPort {
  readonly name: string;

  /** Store a memory with metadata. */
  store(entry: MemoryEntry): Promise<string>; // returns ID

  /** Retrieve by ID. */
  get(id: string): Promise<MemoryEntry | null>;

  /** Semantic search. */
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;

  /** Update an existing entry. */
  update(id: string, patch: Partial<MemoryEntry>): Promise<void>;

  /** Delete (soft or hard). */
  delete(id: string, soft?: boolean): Promise<void>;

  /** Get memory stats. */
  stats(): Promise<MemoryStats>;
}

export interface MemoryEntry {
  id?: string;
  content: string;
  type: 'fact' | 'event' | 'lesson' | 'preference' | 'entity' | 'relationship';
  confidence: number; // 0.0 - 1.0
  source: string;
  timestamp: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
  expiresAt?: number; // TTL for short-term
}

export interface SearchOptions {
  limit?: number;
  minScore?: number;
  type?: MemoryEntry['type'];
  tags?: string[];
  after?: number;
  before?: number;
}

export interface SearchResult {
  entry: MemoryEntry;
  score: number;
}

export interface MemoryStats {
  totalEntries: number;
  byType: Record<string, number>;
  storageBytes: number;
  oldestEntry: number;
  newestEntry: number;
}

/**
 * Knowledge Graph Port — Entity and relationship storage.
 * Future: Neo4j adapter (stolen idea #2).
 * Current: In-memory adjacency list.
 */
export interface KnowledgeGraphPort {
  readonly name: string;

  /** Add or update an entity. */
  upsertEntity(entity: GraphEntity): Promise<void>;

  /** Add a relationship between entities. */
  addRelationship(rel: GraphRelationship): Promise<void>;

  /** Query entities by type/properties. */
  queryEntities(filter: EntityFilter): Promise<GraphEntity[]>;

  /** Get relationships for an entity. */
  getRelationships(entityId: string, direction?: 'in' | 'out' | 'both'): Promise<GraphRelationship[]>;

  /** Shortest path between two entities. */
  shortestPath(fromId: string, toId: string): Promise<GraphEntity[]>;

  /** Pattern match (subgraph query). */
  match(pattern: GraphPattern): Promise<GraphMatch[]>;
}

export interface GraphEntity {
  id: string;
  type: string; // 'person' | 'project' | 'concept' | 'tool' | etc.
  properties: Record<string, unknown>;
  embedding?: number[];
}

export interface GraphRelationship {
  id?: string;
  fromId: string;
  toId: string;
  type: string; // 'uses' | 'created_by' | 'depends_on' | 'related_to' | etc.
  weight?: number;
  properties?: Record<string, unknown>;
}

export interface EntityFilter {
  type?: string;
  properties?: Record<string, unknown>;
  limit?: number;
}

export interface GraphPattern {
  nodes: Array<{ alias: string; type?: string }>;
  edges: Array<{ from: string; to: string; type?: string }>;
}

export interface GraphMatch {
  bindings: Record<string, GraphEntity | GraphRelationship>;
}

/**
 * Telemetry Port — All observability goes through this.
 */
export interface TelemetryPort {
  readonly name: string;

  /** Record a metric. */
  metric(name: string, value: number, tags?: Record<string, string>): void;

  /** Record a span (timed operation). */
  span<T>(name: string, fn: () => Promise<T>, tags?: Record<string, string>): Promise<T>;

  /** Record an event. */
  event(name: string, data?: Record<string, unknown>): void;

  /** Flush pending data. */
  flush(): Promise<void>;
}

/**
 * Sandbox Port — Code execution isolation.
 */
export interface SandboxPort {
  readonly name: string;

  /** Execute code in isolation. Returns stdout + exit code. */
  execute(code: string, language: string, options?: SandboxOptions): Promise<SandboxResult>;

  /** Check sandbox health. */
  healthCheck(): Promise<HealthStatus>;
}

export interface SandboxOptions {
  timeout?: number;
  memoryMB?: number;
  networkAccess?: boolean;
  env?: Record<string, string>;
  files?: Record<string, string>;
}

export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

/**
 * Communication Port — Inter-agent messaging.
 */
export interface CommunicationPort {
  readonly name: string;

  /** Send a message to a specific agent. */
  send(to: string, message: AgentMessage): Promise<void>;

  /** Broadcast to all agents (or a topic). */
  broadcast(message: AgentMessage, topic?: string): Promise<void>;

  /** Subscribe to messages. */
  subscribe(handler: (msg: AgentMessage) => void, topic?: string): () => void; // returns unsubscribe

  /** Request-response pattern. */
  request(to: string, message: AgentMessage, timeoutMs?: number): Promise<AgentMessage>;
}

export interface AgentMessage {
  id?: string;
  from: string;
  type: string;
  payload: unknown;
  timestamp?: number;
  replyTo?: string;
  ttl?: number;
}

// ─────────────────────────────────────────────────────────────────
// Shared Types
// ─────────────────────────────────────────────────────────────────

export interface HealthStatus {
  healthy: boolean;
  latencyMs?: number;
  message?: string;
  lastChecked: number;
}

// ─────────────────────────────────────────────────────────────────
// Port Registry — Dependency Injection Container
// ─────────────────────────────────────────────────────────────────

export type PortName = 'llm' | 'memory' | 'knowledgeGraph' | 'telemetry' | 'sandbox' | 'communication';

export interface PortMap {
  llm: LLMPort;
  memory: MemoryPort;
  knowledgeGraph: KnowledgeGraphPort;
  telemetry: TelemetryPort;
  sandbox: SandboxPort;
  communication: CommunicationPort;
}

/**
 * The Registry. Singleton. All business logic resolves ports through this.
 * 
 * Usage:
 *   const llm = Registry.get('llm');
 *   const result = await llm.complete({ prompt: 'hello' });
 */
export class Registry {
  private static bindings = new Map<PortName, unknown>();
  private static factories = new Map<PortName, () => unknown>();

  /** Bind a concrete adapter to a port. */
  static bind<K extends PortName>(port: K, adapter: PortMap[K]): void {
    this.bindings.set(port, adapter);
  }

  /** Bind a lazy factory (created on first get). */
  static bindFactory<K extends PortName>(port: K, factory: () => PortMap[K]): void {
    this.factories.set(port, factory);
  }

  /** Get the adapter for a port. Throws if unbound. */
  static get<K extends PortName>(port: K): PortMap[K] {
    let adapter = this.bindings.get(port);
    if (!adapter) {
      const factory = this.factories.get(port);
      if (factory) {
        adapter = factory();
        this.bindings.set(port, adapter);
      }
    }
    if (!adapter) {
      throw new Error(
        `Port '${port}' is not bound. Call Registry.bind('${port}', adapter) during initialization.\n` +
        `Available ports: ${Array.from(this.bindings.keys()).join(', ') || 'none'}`
      );
    }
    return adapter as PortMap[K];
  }

  /** Check if a port is bound. */
  static has(port: PortName): boolean {
    return this.bindings.has(port) || this.factories.has(port);
  }

  /** List all bound ports. */
  static list(): PortName[] {
    return [...new Set([...this.bindings.keys(), ...this.factories.keys()])];
  }

  /** Reset all bindings (for testing). */
  static reset(): void {
    this.bindings.clear();
    this.factories.clear();
  }

  /** Snapshot current bindings (for rollback). */
  static snapshot(): Map<PortName, unknown> {
    return new Map(this.bindings);
  }

  /** Restore from snapshot. */
  static restore(snap: Map<PortName, unknown>): void {
    this.bindings = new Map(snap);
  }
}
