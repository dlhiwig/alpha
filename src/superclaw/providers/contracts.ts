/**
 * SuperClaw LLM Provider Contracts
 * 
 * Core interfaces and types for the multi-provider LLM routing system.
 */

export enum ModelCapability {
  TEXT_GENERATION = 'text_generation',
  CODE_GENERATION = 'code_generation',
  REASONING = 'reasoning',
  FUNCTION_CALLING = 'function_calling',
  VISION = 'vision',
  LONG_CONTEXT = 'long_context',
  UNCENSORED = 'uncensored',
  EMBEDDINGS = 'embeddings',
  RERANK = 'rerank',
  RAG = 'rag'
}

export enum ProviderType {
  LOCAL = 'local',
  CLOUD = 'cloud'
}

export enum ProviderStatus {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNHEALTHY = 'unhealthy'
}

export interface Model {
  name: string;
  displayName: string;
  contextLength: number;
  capabilities: ModelCapability[];
  memoryRequirement?: number; // GB for local models
  costPerInputToken?: number;
  costPerOutputToken?: number;
}

export interface GenerateRequest {
  model?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  stream?: boolean;
  context?: ConversationContext;
}

export interface ConversationContext {
  messages: Message[];
  metadata?: Record<string, any>;
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: Date;
}

export interface GenerateResponse {
  text: string;
  content: string; // Alias for text (backward compatibility)
  model: string;
  tokens: {
    input: number;
    output: number;
  };
  cost: number;
  latency: number;
  provider: string;
  cached?: boolean;
}

export interface StreamChunk {
  text: string;
  isComplete: boolean;
  model: string;
  provider: string;
}

export interface ProviderHealth {
  status: ProviderStatus;
  lastCheck: Date;
  consecutiveFailures: number;
  avgResponseTime: number;
  errorRate: number; // percentage of failed requests in last 100
  uptime: number; // percentage uptime in last 24h
}

export interface RoutingContext {
  requestId: string;
  priority: 'low' | 'normal' | 'high';
  maxCost?: number;
  preferredProvider?: string;
  requiredCapabilities?: ModelCapability[];
  userBudget?: number;
}

export interface RoutingDecision {
  provider: string;
  model: string;
  reason: string;
  estimatedCost: number;
  alternatives?: Array<{
    provider: string;
    model: string;
    cost: number;
  }>;
}

export interface CostUsage {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  timestamp: Date;
  requestId: string;
}

export interface BudgetStatus {
  dailySpend: number;
  dailyLimit: number;
  monthlySpend: number;
  monthlyLimit: number;
  remainingDaily: number;
  remainingMonthly: number;
  nearLimit: boolean;
  recommendations: string[];
}

/**
 * Core provider interface that all LLM providers must implement
 */
export interface ILLMProvider {
  readonly name: string;
  readonly type: ProviderType;
  readonly priority: number; // Lower number = higher priority
  readonly defaultModel: string;
  
  /**
   * Initialize the provider (authenticate, setup connections, etc.)
   */
  initialize(): Promise<void>;
  
  /**
   * Check if the provider is currently healthy and operational
   */
  isHealthy(): Promise<boolean>;
  
  /**
   * Get detailed health information
   */
  getHealth(): Promise<ProviderHealth>;
  
  /**
   * Get list of available models from this provider
   */
  getModels(): Promise<Model[]>;
  
  /**
   * Generate text using the provider
   */
  generate(request: GenerateRequest): Promise<GenerateResponse>;

  /**
   * Generate response (alias for generate, backward compatibility)
   */
  generateResponse(request: GenerateRequest): Promise<GenerateResponse>;
  
  /**
   * Stream text generation (for real-time responses)
   */
  stream(request: GenerateRequest): AsyncIterable<StreamChunk>;
  
  /**
   * Check if this provider can handle the given request
   */
  canHandle(request: GenerateRequest, context?: RoutingContext): boolean;
  
  /**
   * Estimate the cost of a request before execution
   */
  estimateCost(request: GenerateRequest): Promise<number>;
  
  /**
   * Gracefully shutdown the provider
   */
  shutdown(): Promise<void>;
}

/**
 * Router interface for directing requests to appropriate providers
 */
export interface IRouter {
  /**
   * Route a request to the best available provider
   */
  route(request: GenerateRequest, context?: RoutingContext): Promise<RoutingDecision>;
  
  /**
   * Execute a request using the router's decision logic
   */
  execute(request: GenerateRequest, context?: RoutingContext): Promise<GenerateResponse>;
  
  /**
   * Execute with streaming response
   */
  executeStream(request: GenerateRequest, context?: RoutingContext): AsyncIterable<StreamChunk>;
  
  /**
   * Register a new provider
   */
  registerProvider(provider: ILLMProvider): void;
  
  /**
   * Get status of all registered providers
   */
  getProviderStatus(): Promise<Record<string, ProviderHealth>>;
}

/**
 * Circuit breaker interface for provider resilience
 */
export interface ICircuitBreaker {
  /**
   * Execute an operation through the circuit breaker
   */
  execute<T>(provider: string, operation: () => Promise<T>): Promise<T>;
  
  /**
   * Get the current state of a provider's circuit breaker
   */
  getState(provider: string): 'closed' | 'open' | 'half-open';
  
  /**
   * Reset a provider's circuit breaker (force close)
   */
  reset(provider: string): void;
}

/**
 * Cost tracking interface
 */
export interface ICostTracker {
  /**
   * Record usage for cost tracking
   */
  recordUsage(usage: CostUsage): Promise<void>;
  
  /**
   * Check if a request can be afforded within budget
   */
  canAfford(estimatedCost: number): Promise<boolean>;
  
  /**
   * Get current budget status
   */
  getBudgetStatus(): Promise<BudgetStatus>;
  
  /**
   * Get usage statistics for a time period
   */
  getUsageStats(startDate: Date, endDate: Date): Promise<CostUsage[]>;
  
  /**
   * Set budget limits
   */
  setBudget(dailyLimit: number, monthlyLimit: number): Promise<void>;
}

/**
 * Configuration for the provider system
 */
export interface ProviderConfig {
  providers: {
    ollama?: {
      endpoint: string;
      models: string[];
      priority: number;
    };
    claude?: {
      apiKey: string;
      models: string[];
      priority: number;
      budget?: {
        daily: number;
        monthly: number;
      };
    };
    gemini?: {
      apiKey: string;
      models: string[];
      priority: number;
      budget?: {
        daily: number;
        monthly: number;
      };
    };
  };
  routing: {
    preferLocal: boolean;
    maxCostPerRequest: number;
    timeoutMs: number;
    retryAttempts: number;
  };
  circuitBreaker: {
    failureThreshold: number;
    timeoutMs: number;
    recoveryTimeoutMs: number;
  };
}

/**
 * Provider-specific errors
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    public provider: string,
    public code?: string,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class BudgetExceededError extends Error {
  constructor(
    message: string,
    public currentSpend: number,
    public limit: number
  ) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

export class CircuitBreakerOpenError extends Error {
  constructor(
    message: string,
    public provider: string,
    public nextRetryAt: Date
  ) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}