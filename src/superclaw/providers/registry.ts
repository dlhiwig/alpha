// @ts-nocheck
/**
 * SuperClaw Provider Registry - Advanced Multi-Provider Management
 * 
 * Provides:
 * - Central registry for all providers
 * - Dynamic provider loading
 * - Fallback chain configuration
 * - Cost-aware routing
 * - Health checking per provider
 * - Provider capabilities map
 */

import { EventEmitter } from 'events';
import { 
  ILLMProvider, 
  ModelCapability, 
  ProviderHealth, 
  ProviderStatus,
  RoutingContext,
  RoutingDecision,
  GenerateRequest,
  GenerateResponse,
  Model,
  ProviderType,
  CostUsage,
  BudgetStatus
} from './contracts';

// Import all providers
import { createAnthropicProvider } from './anthropic';
import { createOpenAIProvider } from './openai';
import { createGeminiProvider } from './gemini';
import { createDeepSeekProvider } from './deepseek';
import { createOllamaProvider } from './ollama';
import { createCohereProvider } from './cohere';
import { createMistralProvider } from './mistral';
import { createGroqProvider } from './groq';

export interface ProviderRegistration {
  provider: ILLMProvider;
  health: ProviderHealth;
  lastUsed: Date | null;
  totalRequests: number;
  totalErrors: number;
  totalCost: number;
  capabilities: ModelCapability[];
  models: Model[];
  isEnabled: boolean;
}

export interface FallbackChain {
  id: string;
  name: string;
  description: string;
  providers: {
    provider: string;
    priority: number;
    maxCost?: number;
    requiredCapabilities?: ModelCapability[];
    condition?: string; // JavaScript expression
  }[];
  defaultCostLimit: number;
  timeoutMs: number;
}

export interface RoutingStrategy {
  name: string;
  description: string;
  route(
    request: GenerateRequest, 
    context: RoutingContext, 
    availableProviders: ProviderRegistration[]
  ): RoutingDecision;
}

export interface RegistryConfig {
  healthCheckIntervalMs: number;
  defaultTimeoutMs: number;
  maxRetries: number;
  circuitBreakerThreshold: number;
  costTracking: {
    enabled: boolean;
    dailyLimit: number;
    monthlyLimit: number;
  };
  fallbackChains: FallbackChain[];
  defaultStrategy: string;
}

/**
 * Advanced Provider Registry with comprehensive management capabilities
 */
export class SuperClawProviderRegistry extends EventEmitter {
  private providers: Map<string, ProviderRegistration> = new Map();
  private fallbackChains: Map<string, FallbackChain> = new Map();
  private strategies: Map<string, RoutingStrategy> = new Map();
  private costHistory: CostUsage[] = [];
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private config: RegistryConfig;

  constructor(config: Partial<RegistryConfig> = {}) {
    super();
    
    this.config = {
      healthCheckIntervalMs: 30000, // 30 seconds
      defaultTimeoutMs: 30000,
      maxRetries: 3,
      circuitBreakerThreshold: 5,
      costTracking: {
        enabled: true,
        dailyLimit: 100.0,
        monthlyLimit: 1000.0,
      },
      fallbackChains: [],
      defaultStrategy: 'cost-optimized',
      ...config
    };

    this.initializeDefaultStrategies();
    this.initializeDefaultFallbackChains();
    this.startHealthChecking();
  }

  /**
   * Register a provider with the registry
   */
  async registerProvider(provider: ILLMProvider): Promise<void> {
    try {
      await provider.initialize();
      
      const models = await provider.getModels();
      const capabilities = this.extractCapabilities(models);
      const health = await provider.getHealth();

      const registration: ProviderRegistration = {
        provider,
        health,
        lastUsed: null,
        totalRequests: 0,
        totalErrors: 0,
        totalCost: 0,
        capabilities,
        models,
        isEnabled: true
      };

      this.providers.set(provider.name, registration);
      this.emit('providerRegistered', provider.name, registration);
      
      console.log(`✓ Registered provider: ${provider.name} with ${models.length} models`);
    } catch (error: unknown) {
      console.warn(`Failed to register provider ${provider.name}:`, error);
      this.emit('providerRegistrationFailed', provider.name, error);
    }
  }

  /**
   * Auto-discover and register all available providers
   */
  async autoDiscoverProviders(): Promise<void> {
    const providerFactories = [
      { name: 'anthropic', factory: createAnthropicProvider, envKey: 'ANTHROPIC_API_KEY' },
      { name: 'openai', factory: createOpenAIProvider, envKey: 'OPENAI_API_KEY' },
      { name: 'gemini', factory: createGeminiProvider, envKey: 'GEMINI_API_KEY' },
      { name: 'deepseek', factory: createDeepSeekProvider, envKey: 'DEEPSEEK_API_KEY' },
      { name: 'ollama', factory: createOllamaProvider, envKey: null }, // Local, no API key
      { name: 'cohere', factory: createCohereProvider, envKey: 'COHERE_API_KEY' },
      { name: 'mistral', factory: createMistralProvider, envKey: 'MISTRAL_API_KEY' },
      { name: 'groq', factory: createGroqProvider, envKey: 'GROQ_API_KEY' },
    ];

    console.log('🔍 Auto-discovering providers...');
    
    const registrationPromises = providerFactories
      .filter(({ envKey }) => !envKey || process.env[envKey])
      .map(async ({ name, factory }) => {
        try {
          const provider = factory();
          // @ts-expect-error - Post-Merge Reconciliation
          await this.registerProvider(provider);
          return { name, success: true };
        } catch (error: unknown) {
          console.warn(`Failed to auto-register ${name}:`, error);
          return { name, success: false, error };
        }
      });

    const results = await Promise.all(registrationPromises);
    const successful = results.filter(r => r.success).length;
    
    console.log(`✓ Auto-discovery complete: ${successful}/${results.length} providers registered`);
    this.emit('autoDiscoveryComplete', results);
  }

  /**
   * Get provider by name
   */
  getProvider(name: string): ILLMProvider | null {
    const registration = this.providers.get(name);
    return registration?.provider || null;
  }

  /**
   * Get all registered providers
   */
  getAllProviders(): ProviderRegistration[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get healthy providers only
   */
  getHealthyProviders(): ProviderRegistration[] {
    return Array.from(this.providers.values())
      .filter(reg => reg.isEnabled && reg.health.status === ProviderStatus.HEALTHY);
  }

  /**
   * Get providers by capability
   */
  getProvidersByCapability(capability: ModelCapability): ProviderRegistration[] {
    return Array.from(this.providers.values())
      .filter(reg => reg.isEnabled && reg.capabilities.includes(capability));
  }

  /**
   * Route a request to the best provider using configured strategy
   */
  async routeRequest(
    request: GenerateRequest, 
    context: RoutingContext = { requestId: 'unknown', priority: 'normal' }
  ): Promise<RoutingDecision> {
    const strategy = this.strategies.get(context.preferredProvider || this.config.defaultStrategy);
    if (!strategy) {
      throw new Error(`Unknown routing strategy: ${context.preferredProvider || this.config.defaultStrategy}`);
    }

    const availableProviders = this.getHealthyProviders();
    if (availableProviders.length === 0) {
      throw new Error('No healthy providers available');
    }

    // Filter by required capabilities
    let eligibleProviders = availableProviders;
    if (context.requiredCapabilities) {
      eligibleProviders = availableProviders.filter(reg =>
        context.requiredCapabilities!.every(cap => reg.capabilities.includes(cap))
      );
    }

    if (eligibleProviders.length === 0) {
      throw new Error(`No providers available with required capabilities: ${context.requiredCapabilities?.join(', ')}`);
    }

    const decision = strategy.route(request, context, eligibleProviders);
    this.emit('requestRouted', decision, context);
    
    return decision;
  }

  /**
   * Execute a request with automatic fallback
   */
  async executeRequest(
    request: GenerateRequest,
    context: RoutingContext = { requestId: 'unknown', priority: 'normal' }
  ): Promise<GenerateResponse> {
    const fallbackChain = this.getFallbackChain(context);
    let lastError: Error | null = null;

    for (const step of fallbackChain.providers) {
      const provider = this.getProvider(step.provider);
      if (!provider) {continue;}

      const registration = this.providers.get(step.provider);
      if (!registration || !registration.isEnabled || registration.health.status !== ProviderStatus.HEALTHY) {
        continue;
      }

      try {
        // Check cost limits
        const estimatedCost = await provider.estimateCost(request);
        if (step.maxCost && estimatedCost > step.maxCost) {
          continue;
        }

        if (context.maxCost && estimatedCost > context.maxCost) {
          continue;
        }

        // Check budget
        if (this.config.costTracking.enabled && !await this.canAffordRequest(estimatedCost)) {
          throw new Error('Request would exceed budget limits');
        }

        // Execute request
        const startTime = Date.now();
        const response = await provider.generate(request);
        const latency = Date.now() - startTime;

        // Update statistics
        registration.totalRequests++;
        registration.totalCost += response.cost;
        registration.lastUsed = new Date();

        // Track cost
        await this.recordUsage({
          provider: provider.name,
          model: response.model,
          inputTokens: response.tokens.input,
          outputTokens: response.tokens.output,
          cost: response.cost,
          timestamp: new Date(),
          requestId: context.requestId
        });

        this.emit('requestCompleted', response, provider.name, latency);
        return response;

      } catch (error: unknown) {
        lastError = error as Error;
        registration.totalErrors++;
        this.emit('requestFailed', error, provider.name, context);
        
        // Update health status on error
        registration.health.consecutiveFailures++;
        if (registration.health.consecutiveFailures >= this.config.circuitBreakerThreshold) {
          registration.health.status = ProviderStatus.UNHEALTHY;
          this.emit('providerUnhealthy', provider.name);
        }
      }
    }

    throw lastError || new Error('All providers in fallback chain failed');
  }

  /**
   * Get fallback chain for routing context
   */
  private getFallbackChain(context: RoutingContext): FallbackChain {
    // Use preferred fallback chain if specified
    if (context.preferredProvider && this.fallbackChains.has(context.preferredProvider)) {
      return this.fallbackChains.get(context.preferredProvider)!;
    }

    // Use default chain based on priority
    const chainId = context.priority === 'high' ? 'high-priority' : 
                   context.priority === 'low' ? 'cost-optimized' : 'balanced';
    
    return this.fallbackChains.get(chainId) || this.fallbackChains.get('balanced')!;
  }

  /**
   * Cost tracking and budget management
   */
  async recordUsage(usage: CostUsage): Promise<void> {
    if (!this.config.costTracking.enabled) {return;}

    this.costHistory.push(usage);
    
    // Keep only last 30 days of history
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);
    this.costHistory = this.costHistory.filter(u => u.timestamp >= cutoffDate);

    this.emit('usageRecorded', usage);
  }

  async canAffordRequest(estimatedCost: number): Promise<boolean> {
    if (!this.config.costTracking.enabled) {return true;}

    const budget = await this.getBudgetStatus();
    return budget.remainingDaily >= estimatedCost && budget.remainingMonthly >= estimatedCost;
  }

  async getBudgetStatus(): Promise<BudgetStatus> {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const dailySpend = this.costHistory
      .filter(u => u.timestamp >= startOfDay)
      .reduce((sum, u) => sum + u.cost, 0);

    const monthlySpend = this.costHistory
      .filter(u => u.timestamp >= startOfMonth)
      .reduce((sum, u) => sum + u.cost, 0);

    const dailyLimit = this.config.costTracking.dailyLimit;
    const monthlyLimit = this.config.costTracking.monthlyLimit;

    return {
      dailySpend,
      dailyLimit,
      monthlySpend,
      monthlyLimit,
      remainingDaily: Math.max(0, dailyLimit - dailySpend),
      remainingMonthly: Math.max(0, monthlyLimit - monthlySpend),
      nearLimit: dailySpend > dailyLimit * 0.8 || monthlySpend > monthlyLimit * 0.8,
      recommendations: this.generateBudgetRecommendations(dailySpend, monthlySpend, dailyLimit, monthlyLimit)
    };
  }

  private generateBudgetRecommendations(dailySpend: number, monthlySpend: number, dailyLimit: number, monthlyLimit: number): string[] {
    const recommendations: string[] = [];
    
    if (dailySpend > dailyLimit * 0.8) {
      recommendations.push('Consider using cheaper local models for simple queries');
    }
    
    if (monthlySpend > monthlyLimit * 0.5) {
      recommendations.push('Review usage patterns to optimize costs');
    }

    // Suggest cost-effective providers
    const cheapProviders = Array.from(this.providers.values())
      .filter(reg => reg.models.some(m => m.costPerInputToken && m.costPerInputToken < 0.001))
      .map(reg => reg.provider.name);

    if (cheapProviders.length > 0) {
      recommendations.push(`Consider using cost-effective providers: ${cheapProviders.join(', ')}`);
    }

    return recommendations;
  }

  /**
   * Health checking system
   */
  private startHealthChecking(): void {
    this.healthCheckTimer = setInterval(async () => {
      await this.performHealthChecks();
    }, this.config.healthCheckIntervalMs);
  }

  private async performHealthChecks(): Promise<void> {
    const healthPromises = Array.from(this.providers.entries()).map(async ([name, registration]) => {
      try {
        const health = await registration.provider.getHealth();
        registration.health = health;
        
        if (health.status === ProviderStatus.HEALTHY) {
          registration.health.consecutiveFailures = 0;
        }
        
        this.emit('healthCheckCompleted', name, health);
      } catch (error: unknown) {
        registration.health.consecutiveFailures++;
        registration.health.status = ProviderStatus.UNHEALTHY;
        this.emit('healthCheckFailed', name, error);
      }
    });

    await Promise.allSettled(healthPromises);
  }

  /**
   * Provider capability extraction
   */
  private extractCapabilities(models: Model[]): ModelCapability[] {
    const capabilities = new Set<ModelCapability>();
    
    for (const model of models) {
      model.capabilities.forEach(cap => capabilities.add(cap));
    }
    
    return Array.from(capabilities);
  }

  /**
   * Initialize default routing strategies
   */
  private initializeDefaultStrategies(): void {
    // Cost-optimized strategy
    this.strategies.set('cost-optimized', {
      name: 'Cost Optimized',
      description: 'Routes to the cheapest available provider',
      route: (request, context, providers) => {
        const sorted = providers
          .filter(p => p.models.some(m => m.costPerInputToken))
          .toSorted((a, b) => {
            const aCost = Math.min(...a.models.map(m => m.costPerInputToken || Infinity));
            const bCost = Math.min(...b.models.map(m => m.costPerInputToken || Infinity));
            return aCost - bCost;
          });

        if (sorted.length === 0) {
          sorted.push(...providers); // Fallback to any available
        }

        const selected = sorted[0];
        const cheapestModel = selected.models.reduce((min, model) => 
          (model.costPerInputToken || 0) < (min.costPerInputToken || Infinity) ? model : min
        );

        return {
          provider: selected.provider.name,
          model: cheapestModel.name,
          reason: `Cheapest available option (${cheapestModel.costPerInputToken}/token)`,
          estimatedCost: cheapestModel.costPerInputToken ? 
            (request.prompt.length / 4 * cheapestModel.costPerInputToken) : 0,
          alternatives: sorted.slice(1, 3).map(p => ({
            provider: p.provider.name,
            model: p.models[0].name,
            cost: p.models[0].costPerInputToken || 0
          }))
        };
      }
    });

    // Performance-optimized strategy
    this.strategies.set('performance-optimized', {
      name: 'Performance Optimized',
      description: 'Routes to the fastest available provider',
      route: (request, context, providers) => {
        const sorted = providers
          .toSorted((a, b) => a.health.avgResponseTime - b.health.avgResponseTime);

        const selected = sorted[0];
        const bestModel = selected.models[0]; // Use default model

        return {
          provider: selected.provider.name,
          model: bestModel.name,
          reason: `Fastest response time (${selected.health.avgResponseTime}ms avg)`,
          estimatedCost: bestModel.costPerInputToken ? 
            (request.prompt.length / 4 * bestModel.costPerInputToken) : 0,
          alternatives: sorted.slice(1, 3).map(p => ({
            provider: p.provider.name,
            model: p.models[0].name,
            cost: p.models[0].costPerInputToken || 0
          }))
        };
      }
    });

    // Balanced strategy
    this.strategies.set('balanced', {
      name: 'Balanced',
      description: 'Balances cost and performance',
      route: (request, context, providers) => {
        // Score based on cost and performance
        const scored = providers.map(p => {
          const avgCost = p.models.reduce((sum, m) => sum + (m.costPerInputToken || 0), 0) / p.models.length;
          const responseTime = p.health.avgResponseTime;
          const score = (avgCost * 1000) + (responseTime / 1000); // Normalize and combine
          return { provider: p, score, avgCost, responseTime };
        });

        scored.sort((a, b) => a.score - b.score);
        const selected = scored[0].provider;

        return {
          provider: selected.provider.name,
          model: selected.models[0].name,
          reason: `Best cost/performance balance (score: ${scored[0].score.toFixed(2)})`,
          estimatedCost: scored[0].avgCost * (request.prompt.length / 4),
          alternatives: scored.slice(1, 3).map(s => ({
            provider: s.provider.provider.name,
            model: s.provider.models[0].name,
            cost: s.avgCost
          }))
        };
      }
    });
  }

  /**
   * Initialize default fallback chains
   */
  private initializeDefaultFallbackChains(): void {
    this.fallbackChains.set('cost-optimized', {
      id: 'cost-optimized',
      name: 'Cost Optimized',
      description: 'Prioritizes local models, then cheapest cloud providers',
      providers: [
        { provider: 'ollama', priority: 1, maxCost: 0 },
        { provider: 'deepseek', priority: 2, maxCost: 0.01 },
        { provider: 'groq', priority: 3, maxCost: 0.05 },
        { provider: 'gemini', priority: 4, maxCost: 0.10 },
        { provider: 'anthropic', priority: 5, maxCost: 1.0 }
      ],
      defaultCostLimit: 0.50,
      timeoutMs: 30000
    });

    this.fallbackChains.set('high-priority', {
      id: 'high-priority',
      name: 'High Priority',
      description: 'Prioritizes best models regardless of cost',
      providers: [
        { provider: 'anthropic', priority: 1, requiredCapabilities: [ModelCapability.REASONING] },
        { provider: 'openai', priority: 2, requiredCapabilities: [ModelCapability.REASONING] },
        { provider: 'gemini', priority: 3 },
        { provider: 'cohere', priority: 4 },
        { provider: 'mistral', priority: 5 }
      ],
      defaultCostLimit: 5.0,
      timeoutMs: 60000
    });

    this.fallbackChains.set('balanced', {
      id: 'balanced',
      name: 'Balanced',
      description: 'Balances cost and capability',
      providers: [
        { provider: 'ollama', priority: 1, maxCost: 0 },
        { provider: 'gemini', priority: 2, maxCost: 0.10 },
        { provider: 'groq', priority: 3, maxCost: 0.20 },
        { provider: 'anthropic', priority: 4, maxCost: 1.0 },
        { provider: 'openai', priority: 5, maxCost: 2.0 }
      ],
      defaultCostLimit: 1.0,
      timeoutMs: 45000
    });
  }

  /**
   * Get registry statistics
   */
  getStatistics() {
    const providers = Array.from(this.providers.values());
    const totalRequests = providers.reduce((sum, p) => sum + p.totalRequests, 0);
    const totalCost = providers.reduce((sum, p) => sum + p.totalCost, 0);
    const totalErrors = providers.reduce((sum, p) => sum + p.totalErrors, 0);

    return {
      totalProviders: providers.length,
      healthyProviders: providers.filter(p => p.health.status === ProviderStatus.HEALTHY).length,
      totalRequests,
      totalCost,
      totalErrors,
      errorRate: totalRequests > 0 ? (totalErrors / totalRequests * 100) : 0,
      avgCostPerRequest: totalRequests > 0 ? (totalCost / totalRequests) : 0,
      providers: providers.map(p => ({
        name: p.provider.name,
        type: p.provider.type,
        status: p.health.status,
        requests: p.totalRequests,
        errors: p.totalErrors,
        cost: p.totalCost,
        models: p.models.length,
        capabilities: p.capabilities
      }))
    };
  }

  /**
   * Cleanup resources
   */
  async shutdown(): Promise<void> {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    // Shutdown all providers
    const shutdownPromises = Array.from(this.providers.values()).map(async (registration) => {
      try {
        await registration.provider.shutdown();
      } catch (error: unknown) {
        console.warn(`Error shutting down provider ${registration.provider.name}:`, error);
      }
    });

    await Promise.allSettled(shutdownPromises);
    this.emit('shutdown');
  }
}

/**
 * Singleton registry instance
 */
let registryInstance: SuperClawProviderRegistry | null = null;

/**
 * Get the global provider registry instance
 */
export function getProviderRegistry(config?: Partial<RegistryConfig>): SuperClawProviderRegistry {
  if (!registryInstance) {
    registryInstance = new SuperClawProviderRegistry(config);
  }
  return registryInstance;
}

/**
 * Initialize the provider registry with auto-discovery
 */
export async function initializeRegistry(config?: Partial<RegistryConfig>): Promise<SuperClawProviderRegistry> {
  const registry = getProviderRegistry(config);
  await registry.autoDiscoverProviders();
  return registry;
}

/**
 * Quick access functions
 */
export function getProvider(name: string): ILLMProvider | null {
  return getProviderRegistry().getProvider(name);
}

export function getHealthyProviders(): ProviderRegistration[] {
  return getProviderRegistry().getHealthyProviders();
}

export function getProvidersByCapability(capability: ModelCapability): ProviderRegistration[] {
  return getProviderRegistry().getProvidersByCapability(capability);
}

export async function executeRequest(request: GenerateRequest, context?: RoutingContext): Promise<GenerateResponse> {
  return getProviderRegistry().executeRequest(request, context);
}

export async function routeRequest(request: GenerateRequest, context?: RoutingContext): Promise<RoutingDecision> {
  return getProviderRegistry().routeRequest(request, context);
}

// Types are exported inline where they're defined above