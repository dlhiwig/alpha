/**
 * SuperClaw LLM Router Implementation
 * 
 * Intelligent routing system that prioritizes local models (Ollama) and falls back
 * to cloud providers (Claude, Gemini) based on capabilities, cost, and health.
 */

import {
  IRouter,
  ILLMProvider,
  ICircuitBreaker,
  ICostTracker,
  GenerateRequest,
  GenerateResponse,
  StreamChunk,
  RoutingContext,
  RoutingDecision,
  ModelCapability,
  ProviderHealth,
  ProviderError,
  CircuitBreakerOpenError,
  BudgetExceededError
} from './contracts';

interface RouterConfig {
  preferLocal: boolean;
  maxCostPerRequest: number;
  timeoutMs: number;
  retryAttempts: number;
  fallbackOnFailure: boolean;
}

export class SuperClawRouter implements IRouter {
  private providers: Map<string, ILLMProvider> = new Map();
  private circuitBreaker: ICircuitBreaker;
  private costTracker: ICostTracker;
  private config: RouterConfig;
  
  // Capability requirements mapping
  private readonly capabilityProviders: Record<ModelCapability, string[]> = {
    [ModelCapability.TEXT_GENERATION]: ['ollama', 'claude', 'gemini'],
    [ModelCapability.CODE_GENERATION]: ['ollama', 'claude'], // qwen3-coder locally
    [ModelCapability.REASONING]: ['ollama', 'claude', 'gemini'], // claude-opus for complex
    [ModelCapability.FUNCTION_CALLING]: ['claude'], // Only Claude supports this well
    [ModelCapability.VISION]: ['claude', 'gemini'], // Not supported locally yet
    [ModelCapability.LONG_CONTEXT]: ['gemini', 'claude'], // Gemini excels here
    [ModelCapability.UNCENSORED]: ['ollama'], // Only local models
    [ModelCapability.EMBEDDINGS]: ['cohere', 'ollama'], // Cohere excels, Ollama has nomic-embed
    [ModelCapability.RERANK]: ['cohere'], // Cohere's specialty
    [ModelCapability.RAG]: ['cohere', 'claude', 'gemini'] // Cohere built for RAG
  };
  
  constructor(
    circuitBreaker: ICircuitBreaker,
    costTracker: ICostTracker,
    config: RouterConfig = {
      preferLocal: true,
      maxCostPerRequest: 0.10,
      timeoutMs: 30000,
      retryAttempts: 2,
      fallbackOnFailure: true
    }
  ) {
    this.circuitBreaker = circuitBreaker;
    this.costTracker = costTracker;
    this.config = config;
  }
  
  registerProvider(provider: ILLMProvider): void {
    this.providers.set(provider.name, provider);
    console.log(`Registered provider: ${provider.name} (${provider.type}, priority: ${provider.priority})`);
  }
  
  async route(request: GenerateRequest, context?: RoutingContext): Promise<RoutingDecision> {
    const requiredCapabilities = this.inferCapabilities(request, context);
    const candidates = await this.getCandidateProviders(requiredCapabilities, context);
    
    if (candidates.length === 0) {
      throw new ProviderError(
        `No providers available for required capabilities: ${requiredCapabilities.join(', ')}`,
        'router',
        'NO_PROVIDERS_AVAILABLE',
        false
      );
    }
    
    // Try providers in priority order
    for (const candidate of candidates) {
      const provider = this.providers.get(candidate.provider);
      if (!provider) continue;
      
      // Check circuit breaker
      const circuitState = this.circuitBreaker.getState(provider.name);
      if (circuitState === 'open') {
        console.log(`Circuit breaker OPEN for ${provider.name}, skipping`);
        continue;
      }
      
      // Check cost constraints
      const estimatedCost = await provider.estimateCost(request);
      if (!await this.canAffordRequest(estimatedCost, context)) {
        console.log(`Cost constraint violated for ${provider.name}: $${estimatedCost}`);
        continue;
      }
      
      // This is our choice
      return {
        provider: provider.name,
        model: candidate.model,
        reason: candidate.reason,
        estimatedCost,
        alternatives: candidates.slice(1).map(c => ({
          provider: c.provider,
          model: c.model,
          cost: c.estimatedCost
        }))
      };
    }
    
    throw new ProviderError(
      'All providers unavailable or too expensive',
      'router',
      'ALL_PROVIDERS_UNAVAILABLE',
      true
    );
  }
  
  async execute(request: GenerateRequest, context?: RoutingContext): Promise<GenerateResponse> {
    const decision = await this.route(request, context);
    const provider = this.providers.get(decision.provider);
    
    if (!provider) {
      throw new ProviderError(
        `Provider ${decision.provider} not found`,
        'router',
        'PROVIDER_NOT_FOUND',
        false
      );
    }
    
    return await this.executeWithProvider(provider, request, decision, context);
  }
  
  async* executeStream(request: GenerateRequest, context?: RoutingContext): AsyncIterable<StreamChunk> {
    const decision = await this.route(request, context);
    const provider = this.providers.get(decision.provider);
    
    if (!provider) {
      throw new ProviderError(
        `Provider ${decision.provider} not found`,
        'router',
        'PROVIDER_NOT_FOUND',
        false
      );
    }
    
    try {
      // For streaming, we bypass the circuit breaker since it's designed for Promise<T>
      // Instead, we handle errors manually and update the circuit breaker state
      const stream = provider.stream({ ...request, model: decision.model });
      
      for await (const chunk of stream) {
        yield chunk;
      }
      
    } catch (error: unknown) {
      if (this.config.fallbackOnFailure && context?.priority !== 'high') {
        // Try fallback providers
        const fallbackDecision = await this.getFallbackProvider(decision, request, context);
        if (fallbackDecision) {
          const fallbackProvider = this.providers.get(fallbackDecision.provider);
          if (fallbackProvider) {
            console.log(`Falling back to ${fallbackDecision.provider} after ${decision.provider} failed`);
            const fallbackStream = fallbackProvider.stream({ ...request, model: fallbackDecision.model });
            
            for await (const chunk of fallbackStream) {
              yield chunk;
            }
            return;
          }
        }
      }
      
      throw error;
    }
  }
  
  async getProviderStatus(): Promise<Record<string, ProviderHealth>> {
    const status: Record<string, ProviderHealth> = {};
    
    for (const [name, provider] of Array.from(this.providers.entries())) {
      try {
        status[name] = await provider.getHealth();
      } catch (error: unknown) {
        status[name] = {
          status: 'unhealthy',
          lastCheck: new Date(),
          consecutiveFailures: 999,
          avgResponseTime: 0,
          errorRate: 100,
          uptime: 0
        } as ProviderHealth;
      }
    }
    
    return status;
  }
  
  private async executeWithProvider(
    provider: ILLMProvider,
    request: GenerateRequest,
    decision: RoutingDecision,
    context?: RoutingContext
  ): Promise<GenerateResponse> {
    try {
      const response = await this.circuitBreaker.execute(
        provider.name,
        () => provider.generate({ ...request, model: decision.model })
      );
      
      // Record usage for cost tracking
      await this.costTracker.recordUsage({
        provider: provider.name,
        model: response.model,
        inputTokens: response.tokens.input,
        outputTokens: response.tokens.output,
        cost: response.cost,
        timestamp: new Date(),
        requestId: context?.requestId || 'unknown'
      });
      
      return response;
      
    } catch (error: unknown) {
      if (error instanceof CircuitBreakerOpenError) {
        throw error;
      }
      
      if (this.config.fallbackOnFailure && context?.priority !== 'high') {
        // Try fallback
        const fallbackDecision = await this.getFallbackProvider(decision, request, context);
        if (fallbackDecision) {
          const fallbackProvider = this.providers.get(fallbackDecision.provider);
          if (fallbackProvider) {
            console.log(`Falling back to ${fallbackDecision.provider} after ${decision.provider} failed`);
            return await this.executeWithProvider(fallbackProvider, request, fallbackDecision, context);
          }
        }
      }
      
      throw error;
    }
  }
  
  private inferCapabilities(request: GenerateRequest, context?: RoutingContext): ModelCapability[] {
    const capabilities: ModelCapability[] = [ModelCapability.TEXT_GENERATION];
    
    // Add explicit capabilities from context
    if (context?.requiredCapabilities) {
      capabilities.push(...context.requiredCapabilities);
    }
    
    // Infer capabilities from request content
    if (this.looksLikeCode(request.prompt)) {
      capabilities.push(ModelCapability.CODE_GENERATION);
    }
    
    if (this.requiresReasoning(request.prompt)) {
      capabilities.push(ModelCapability.REASONING);
    }
    
    if (this.hasLongContext(request)) {
      capabilities.push(ModelCapability.LONG_CONTEXT);
    }
    
    return Array.from(new Set(capabilities)); // Remove duplicates
  }
  
  private async getCandidateProviders(
    requiredCapabilities: ModelCapability[],
    context?: RoutingContext
  ): Promise<Array<{
    provider: string;
    model: string;
    reason: string;
    estimatedCost: number;
  }>> {
    const candidates: Array<{
      provider: string;
      model: string;
      reason: string;
      estimatedCost: number;
      priority: number;
    }> = [];
    
    for (const [name, provider] of Array.from(this.providers.entries())) {
      if (!await provider.isHealthy()) {
        console.log(`Provider ${name} is unhealthy, skipping`);
        continue;
      }
      
      if (!this.canProviderHandleCapabilities(name, requiredCapabilities)) {
        console.log(`Provider ${name} cannot handle required capabilities`);
        continue;
      }
      
      const model = await this.selectBestModel(provider, requiredCapabilities, context);
      if (!model) {
        continue;
      }
      
      const estimatedCost = await provider.estimateCost({ 
        ...context, 
        prompt: 'test', 
        model 
      } as GenerateRequest);
      
      candidates.push({
        provider: name,
        model,
        reason: this.getRoutingReason(name, requiredCapabilities),
        estimatedCost,
        priority: provider.priority
      });
    }
    
    // Sort by priority (lower number = higher priority), then by cost
    candidates.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.estimatedCost - b.estimatedCost;
    });
    
    return candidates;
  }
  
  private canProviderHandleCapabilities(providerName: string, capabilities: ModelCapability[]): boolean {
    return capabilities.every(capability => 
      this.capabilityProviders[capability]?.includes(providerName)
    );
  }
  
  private async selectBestModel(
    provider: ILLMProvider, 
    capabilities: ModelCapability[],
    context?: RoutingContext
  ): Promise<string | null> {
    if (context?.preferredProvider === provider.name && context?.preferredProvider) {
      // Use preferred model if specified
      return provider.defaultModel;
    }
    
    const models = await provider.getModels();
    
    // Find models that support all required capabilities
    const compatibleModels = models.filter(model =>
      capabilities.every(cap => model.capabilities.includes(cap))
    );
    
    if (compatibleModels.length === 0) {
      return null;
    }
    
    // For code generation, prefer specialized models
    if (capabilities.includes(ModelCapability.CODE_GENERATION)) {
      const codeModel = compatibleModels.find(m => m.name.includes('coder') || m.name.includes('code'));
      if (codeModel) return codeModel.name;
    }
    
    // For reasoning, prefer larger models
    if (capabilities.includes(ModelCapability.REASONING)) {
      const reasoningModel = compatibleModels.find(m => 
        m.name.includes('70b') || m.name.includes('opus') || m.name.includes('pro')
      );
      if (reasoningModel) return reasoningModel.name;
    }
    
    // Default to the provider's default model
    return provider.defaultModel;
  }
  
  private getRoutingReason(providerName: string, capabilities: ModelCapability[]): string {
    if (providerName === 'ollama') {
      return 'local_preferred';
    }
    
    if (capabilities.includes(ModelCapability.FUNCTION_CALLING)) {
      return 'function_calling_required';
    }
    
    if (capabilities.includes(ModelCapability.VISION)) {
      return 'vision_required';
    }
    
    if (capabilities.includes(ModelCapability.LONG_CONTEXT)) {
      return 'long_context_required';
    }
    
    return 'cloud_fallback';
  }
  
  private async canAffordRequest(estimatedCost: number, context?: RoutingContext): Promise<boolean> {
    // Check per-request limit
    if (estimatedCost > this.config.maxCostPerRequest) {
      return false;
    }
    
    // Check user budget if specified
    if (context?.maxCost && estimatedCost > context.maxCost) {
      return false;
    }
    
    // Check overall budget
    return await this.costTracker.canAfford(estimatedCost);
  }
  
  private async getFallbackProvider(
    failedDecision: RoutingDecision,
    request: GenerateRequest,
    context?: RoutingContext
  ): Promise<RoutingDecision | null> {
    if (!failedDecision.alternatives || failedDecision.alternatives.length === 0) {
      return null;
    }
    
    for (const alternative of failedDecision.alternatives) {
      const provider = this.providers.get(alternative.provider);
      if (!provider) continue;
      
      // Check if provider is healthy and not circuit-broken
      if (await provider.isHealthy() && this.circuitBreaker.getState(provider.name) !== 'open') {
        if (await this.canAffordRequest(alternative.cost, context)) {
          return {
            provider: alternative.provider,
            model: alternative.model,
            reason: 'fallback_after_failure',
            estimatedCost: alternative.cost
          };
        }
      }
    }
    
    return null;
  }
  
  // Heuristics for capability inference
  private looksLikeCode(prompt: string): boolean {
    const codeIndicators = [
      'function', 'class', 'import', 'export', 'const', 'let', 'var',
      'def ', 'public', 'private', 'return', '{}', '[]', '()', ';',
      'git', 'npm', 'pip', 'docker', 'kubernetes'
    ];
    
    const lowercasePrompt = prompt.toLowerCase();
    return codeIndicators.some(indicator => lowercasePrompt.includes(indicator));
  }
  
  private requiresReasoning(prompt: string): boolean {
    const reasoningIndicators = [
      'analyze', 'explain', 'compare', 'evaluate', 'reason', 'logic',
      'why', 'how', 'complex', 'strategy', 'plan', 'solve', 'problem'
    ];
    
    const lowercasePrompt = prompt.toLowerCase();
    return reasoningIndicators.some(indicator => lowercasePrompt.includes(indicator)) ||
           prompt.length > 1000; // Long prompts often need reasoning
  }
  
  private hasLongContext(request: GenerateRequest): boolean {
    const totalLength = request.prompt.length + 
      (request.systemPrompt?.length || 0) +
      (request.context?.messages?.reduce((acc, msg) => acc + msg.content.length, 0) || 0);
    
    return totalLength > 8000; // More than ~2K tokens
  }
}

// TODO: Implementation enhancements:
//
// 1. Caching layer:
//    - Cache responses for identical requests
//    - Implement cache invalidation strategy
//    - Add cache hit/miss metrics
//
// 2. Load balancing:
//    - Distribute load across multiple instances
//    - Health-based load balancing
//    - Geographic routing for cloud providers
//
// 3. Advanced routing:
//    - Machine learning-based routing decisions
//    - User preference learning
//    - Dynamic capability inference
//
// 4. Performance optimization:
//    - Parallel health checks
//    - Request batching where possible
//    - Preemptive model loading
//
// 5. Monitoring & Analytics:
//    - Request timing analysis
//    - Provider performance comparison
//    - Cost optimization recommendations
//
// 6. Configuration management:
//    - Dynamic config updates
//    - A/B testing for routing strategies
//    - Per-user routing preferences