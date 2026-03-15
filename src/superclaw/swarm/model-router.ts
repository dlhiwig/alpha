// @ts-nocheck
/**
 * Cost-Aware Model Router
 * 
 * Inspired by agentic-flow's ModelRouter, this routes tasks to the cheapest
 * capable model while tracking costs and enforcing budget limits.
 * 
 * Route Priority: OpenRouter → Anthropic → OpenAI → Fallbacks
 */

import { ProviderName, AgentRole } from './types';
import { shouldSkipProvider, recordSuccess, recordFailure } from './circuit-breaker';
import { SwarmContract } from './contract';
import { getFallbackProvider } from './providers';

/**
 * Cost tiers for providers (cost per 1K tokens)
 * Based on current market rates (Feb 2026)
 */
// @ts-expect-error - Post-Merge Reconciliation
export const PROVIDER_COSTS: Record<ProviderName, { input: number; output: number; tier: number }> = {
  // Tier 1: Free/Ultra-cheap
  ollama: { input: 0, output: 0, tier: 1 },
  deepseek: { input: 0.14, output: 0.28, tier: 1 },
  
  // Tier 2: Cheap
  minimax: { input: 0.30, output: 1.50, tier: 2 },
  zhipu: { input: 0.50, output: 2.50, tier: 2 },
  kimi: { input: 0.60, output: 3.00, tier: 2 },
  
  // Tier 3: Mid-range
  nvidia: { input: 0.80, output: 4.00, tier: 3 },
  nemotron: { input: 0.80, output: 4.00, tier: 3 },
  glm5: { input: 0.80, output: 4.00, tier: 3 },
  cosmos: { input: 0.80, output: 4.00, tier: 3 },
  qwen: { input: 0.80, output: 4.00, tier: 3 },
  gemini: { input: 1.25, output: 5.00, tier: 3 },
  
  // Tier 4: Premium
  claude: { input: 3.00, output: 15.00, tier: 4 },
  codex: { input: 10.00, output: 30.00, tier: 4 },
  grok: { input: 5.00, output: 15.00, tier: 4 },
  perplexity: { input: 1.00, output: 1.00, tier: 4 }, // Per search, not tokens
};

/**
 * Provider capabilities and quality scores
 * Higher score = better quality/capability for that use case
 */
// @ts-expect-error - Post-Merge Reconciliation
export const PROVIDER_CAPABILITIES: Record<ProviderName, {
  coding: number;
  reasoning: number;
  web: number;
  vision: number;
  context: number; // Long context handling
  agentic: number; // Multi-step tasks
  reliability: number; // Overall reliability score
}> = {
  // Free/Ultra-cheap
  ollama: { coding: 6, reasoning: 5, web: 2, vision: 3, context: 6, agentic: 4, reliability: 8 },
  deepseek: { coding: 8, reasoning: 7, web: 4, vision: 3, context: 7, agentic: 6, reliability: 7 },
  
  // Cheap
  minimax: { coding: 8, reasoning: 7, web: 5, vision: 4, context: 9, agentic: 6, reliability: 7 },
  zhipu: { coding: 7, reasoning: 8, web: 9, vision: 5, context: 7, agentic: 7, reliability: 8 },
  kimi: { coding: 7, reasoning: 8, web: 6, vision: 4, context: 9, agentic: 8, reliability: 8 },
  
  // Mid-range
  nvidia: { coding: 8, reasoning: 8, web: 6, vision: 5, context: 8, agentic: 8, reliability: 8 },
  nemotron: { coding: 8, reasoning: 8, web: 6, vision: 5, context: 10, agentic: 7, reliability: 8 },
  glm5: { coding: 7, reasoning: 9, web: 7, vision: 6, context: 8, agentic: 10, reliability: 8 },
  cosmos: { coding: 6, reasoning: 8, web: 5, vision: 10, context: 7, agentic: 7, reliability: 8 },
  qwen: { coding: 8, reasoning: 9, web: 7, vision: 10, context: 8, agentic: 9, reliability: 8 },
  gemini: { coding: 7, reasoning: 8, web: 8, vision: 7, context: 8, agentic: 7, reliability: 9 },
  
  // Premium
  claude: { coding: 9, reasoning: 10, web: 7, vision: 8, context: 9, agentic: 9, reliability: 9 },
  codex: { coding: 10, reasoning: 8, web: 5, vision: 3, context: 7, agentic: 6, reliability: 7 },
  grok: { coding: 7, reasoning: 8, web: 6, vision: 4, context: 6, agentic: 7, reliability: 6 },
  perplexity: { coding: 4, reasoning: 6, web: 10, vision: 3, context: 5, agentic: 5, reliability: 8 },
};

/**
 * Route priority strategies
 */
export type RoutePriority = 'cost' | 'quality' | 'balanced' | 'speed';

export interface CostTracker {
  totalSpent: number;
  dailySpent: number;
  agentSpend: Record<string, number>;
  providerSpend: Record<ProviderName, number>;
  callCounts: Record<ProviderName, number>;
  dailyCallCounts: Record<ProviderName, number>;
  lastReset: number; // Daily reset timestamp
}

export interface BudgetAlert {
  type: 'daily_limit' | 'total_limit' | 'agent_limit' | 'provider_limit';
  threshold: number;
  current: number;
  message: string;
}

export interface ModelRouterConfig {
  strategy: RoutePriority;
  budgets: {
    dailyLimit: number;      // Daily spend limit ($)
    totalLimit: number;      // Total spend limit ($)
    agentLimit: number;      // Per-agent spend limit ($)
    providerLimits: Partial<Record<ProviderName, number>>; // Per-provider daily limits
  };
  thresholds: {
    qualityThreshold: number;    // Minimum quality score required
    costEfficiencyRatio: number; // Quality/cost ratio threshold
    fallbackTrigger: number;     // Cost threshold to trigger fallbacks
  };
  alerts: {
    warnAt: number;    // Warn when reaching this % of daily budget
    stopAt: number;    // Stop when reaching this % of daily budget
  };
}

export interface RouteDecision {
  provider: ProviderName;
  reason: string;
  estimatedCost: number;
  qualityScore: number;
  costEfficiency: number;
  fallbacks: ProviderName[];
}

export class ModelRouter {
  private costTracker: CostTracker;
  private config: ModelRouterConfig;
  
  constructor(config: Partial<ModelRouterConfig> = {}) {
    this.config = {
      strategy: 'balanced',
      budgets: {
        dailyLimit: 100,
        totalLimit: 500,
        agentLimit: 25,
        providerLimits: {
          codex: 50,
          claude: 30,
          grok: 20,
        },
      },
      thresholds: {
        qualityThreshold: 6,
        costEfficiencyRatio: 2.0,
        fallbackTrigger: 5.0,
      },
      alerts: {
        warnAt: 0.8,  // 80%
        stopAt: 0.95, // 95%
      },
      ...config,
    };
    
    this.costTracker = this.loadCostTracker();
    this.resetDailyCountersIfNeeded();
  }
  
  /**
   * Route a task to the optimal provider based on role, priority, and budget
   */
  async route(
    role: AgentRole,
    task: string,
    agentId: string,
    contract: SwarmContract
  ): Promise<RouteDecision> {
    // Check budget constraints first
    const budgetCheck = this.checkBudgetConstraints(agentId);
    if (budgetCheck.shouldStop) {
      throw new Error(`Budget exceeded: ${budgetCheck.alert.message}`);
    }
    
    // Get candidate providers for this role
    const candidates = this.getCandidateProviders(role, task);
    
    // Filter out circuit-broken providers
    const healthyCandidates = candidates.filter(provider => {
      const { skip } = shouldSkipProvider(provider, contract.circuitBreaker);
      return !skip;
    });
    
    if (healthyCandidates.length === 0) {
      throw new Error('No healthy providers available for role ' + role);
    }
    
    // Score and rank providers
    const scoredCandidates = this.scoreProviders(healthyCandidates, role, task);
    
    // Select best provider based on strategy
    const selectedProvider = this.selectProviderByStrategy(scoredCandidates);
    
    // Generate fallback chain
    const fallbacks = scoredCandidates
      .slice(1, 4) // Top 3 alternatives
      .map(c => c.provider);
    
    return {
      provider: selectedProvider.provider,
      reason: this.explainRouting(selectedProvider, role),
      estimatedCost: selectedProvider.estimatedCost,
      qualityScore: selectedProvider.qualityScore,
      costEfficiency: selectedProvider.costEfficiency,
      fallbacks,
    };
  }
  
  /**
   * Record actual cost after provider execution
   */
  recordCost(
    provider: ProviderName,
    agentId: string,
    actualCost: number,
    inputTokens: number = 0,
    outputTokens: number = 0
  ): void {
    this.costTracker.totalSpent += actualCost;
    this.costTracker.dailySpent += actualCost;
    
    // Agent-level tracking
    if (!this.costTracker.agentSpend[agentId]) {
      this.costTracker.agentSpend[agentId] = 0;
    }
    this.costTracker.agentSpend[agentId] += actualCost;
    
    // Provider-level tracking
    if (!this.costTracker.providerSpend[provider]) {
      this.costTracker.providerSpend[provider] = 0;
    }
    this.costTracker.providerSpend[provider] += actualCost;
    
    // Call counting
    this.costTracker.callCounts[provider] = (this.costTracker.callCounts[provider] || 0) + 1;
    this.costTracker.dailyCallCounts[provider] = (this.costTracker.dailyCallCounts[provider] || 0) + 1;
    
    this.saveCostTracker();
    
    // Check for budget alerts after spending
    const budgetCheck = this.checkBudgetConstraints(agentId);
    if (budgetCheck.shouldWarn || budgetCheck.shouldStop) {
      console.warn(`💰 Budget Alert: ${budgetCheck.alert.message}`);
    }
  }
  
  /**
   * Get cost summary
   */
  getCostSummary(): {
    daily: number;
    total: number;
    topAgents: Array<{ agentId: string; spent: number }>;
    topProviders: Array<{ provider: ProviderName; spent: number; calls: number }>;
    budgetStatus: {
      dailyUsed: number;
      dailyLimit: number;
      totalUsed: number;
      totalLimit: number;
    };
  } {
    const topAgents = Object.entries(this.costTracker.agentSpend)
      .map(([agentId, spent]) => ({ agentId, spent }))
      .toSorted((a, b) => b.spent - a.spent)
      .slice(0, 5);
    
    const topProviders = Object.entries(this.costTracker.providerSpend)
      .map(([provider, spent]) => ({
        provider: provider as ProviderName,
        spent,
        calls: this.costTracker.callCounts[provider as ProviderName] || 0,
      }))
      .toSorted((a, b) => b.spent - a.spent)
      .slice(0, 5);
    
    return {
      daily: this.costTracker.dailySpent,
      total: this.costTracker.totalSpent,
      topAgents,
      topProviders,
      budgetStatus: {
        dailyUsed: this.costTracker.dailySpent,
        dailyLimit: this.config.budgets.dailyLimit,
        totalUsed: this.costTracker.totalSpent,
        totalLimit: this.config.budgets.totalLimit,
      },
    };
  }
  
  /**
   * Reset daily counters if we've crossed midnight
   */
  private resetDailyCountersIfNeeded(): void {
    const now = Date.now();
    const lastReset = this.costTracker.lastReset;
    const oneDayMs = 24 * 60 * 60 * 1000;
    
    if (now - lastReset > oneDayMs) {
      this.costTracker.dailySpent = 0;
      // @ts-expect-error - Post-Merge Reconciliation
      this.costTracker.dailyCallCounts = {};
      this.costTracker.lastReset = now;
      this.saveCostTracker();
    }
  }
  
  /**
   * Get candidate providers for a role with cost optimization
   */
  private getCandidateProviders(role: AgentRole, task: string): ProviderName[] {
    const taskLower = task.toLowerCase();
    
    // Role-specific optimization
    if (role === 'web' || taskLower.includes('search') || taskLower.includes('web')) {
      return ['perplexity', 'zhipu', 'gemini', 'claude', 'ollama'];
    }
    
    if (role === 'vision' || taskLower.includes('image') || taskLower.includes('video')) {
      return ['qwen', 'cosmos', 'gemini', 'claude', 'ollama'];
    }
    
    if (role === 'longcontext' || task.length > 10000) {
      return ['nemotron', 'minimax', 'kimi', 'claude', 'gemini', 'ollama'];
    }
    
    if (role === 'agentic' || taskLower.includes('plan') || taskLower.includes('step')) {
      return ['glm5', 'qwen', 'kimi', 'claude', 'gemini', 'ollama'];
    }
    
    // Default cost-optimized order
    return [
      'ollama',      // Free local
      'deepseek',    // Ultra-cheap
      'minimax',     // Cheap + good coding
      'zhipu',       // Cheap + good reasoning
      'kimi',        // Cheap + good context
      'nvidia',      // Mid-range enterprise
      'nemotron',    // Mid-range specialized
      'gemini',      // Mid-range reliable
      'claude',      // Premium quality
      'codex',       // Premium coding
      'grok',        // Premium creative
      'perplexity',  // Specialized search
    ];
  }
  
  /**
   * Score providers based on quality, cost, and suitability
   */
  private scoreProviders(
    providers: ProviderName[],
    role: AgentRole,
    task: string
  ): Array<{
    provider: ProviderName;
    qualityScore: number;
    estimatedCost: number;
    costEfficiency: number;
    totalScore: number;
  }> {
    const taskTokens = this.estimateTokens(task);
    
    return providers.map(provider => {
      const capabilities = PROVIDER_CAPABILITIES[provider];
      const costs = PROVIDER_COSTS[provider];
      
      // Calculate quality score based on role
      let qualityScore: number;
      switch (role) {
        case 'implementer':
          qualityScore = capabilities.coding;
          break;
        case 'critic':
          qualityScore = (capabilities.reasoning + capabilities.reliability) / 2;
          break;
        case 'researcher':
          qualityScore = (capabilities.reasoning + capabilities.web) / 2;
          break;
        case 'simplifier':
          qualityScore = capabilities.reasoning;
          break;
        case 'ideator':
          qualityScore = capabilities.reasoning;
          break;
        case 'web':
          qualityScore = capabilities.web;
          break;
        case 'vision':
          qualityScore = capabilities.vision;
          break;
        case 'physical':
          qualityScore = capabilities.vision;
          break;
        case 'longcontext':
          qualityScore = capabilities.context;
          break;
        case 'agentic':
          qualityScore = capabilities.agentic;
          break;
        default:
          qualityScore = (capabilities.coding + capabilities.reasoning + capabilities.reliability) / 3;
      }
      
      // Estimate cost (input + output tokens)
      const inputCost = (taskTokens / 1000) * costs.input;
      const outputCost = (taskTokens * 0.3 / 1000) * costs.output; // Assume output is 30% of input
      const estimatedCost = inputCost + outputCost;
      
      // Calculate cost efficiency
      const costEfficiency = estimatedCost === 0 ? 100 : qualityScore / estimatedCost;
      
      // Calculate total score based on strategy
      let totalScore: number;
      switch (this.config.strategy) {
        case 'cost':
          totalScore = costEfficiency * 10;
          break;
        case 'quality':
          totalScore = qualityScore;
          break;
        case 'speed':
          totalScore = capabilities.reliability; // Reliability ~ speed
          break;
        case 'balanced':
        default:
          totalScore = (qualityScore * 0.4) + (costEfficiency * 0.6);
          break;
      }
      
      return {
        provider,
        qualityScore,
        estimatedCost,
        costEfficiency,
        totalScore,
      };
    }).toSorted((a, b) => b.totalScore - a.totalScore);
  }
  
  /**
   * Select provider based on strategy and constraints
   */
  private selectProviderByStrategy(
    candidates: Array<{
      provider: ProviderName;
      qualityScore: number;
      estimatedCost: number;
      costEfficiency: number;
      totalScore: number;
    }>
  ) {
    // Apply quality threshold
    const qualifiedCandidates = candidates.filter(
      c => c.qualityScore >= this.config.thresholds.qualityThreshold
    );
    
    if (qualifiedCandidates.length === 0) {
      // Fallback to best available if no qualified candidates
      return candidates[0];
    }
    
    // Apply cost constraints if approaching budget limits
    const budgetUtilization = this.costTracker.dailySpent / this.config.budgets.dailyLimit;
    if (budgetUtilization > this.config.alerts.warnAt) {
      // Prefer cheaper options when budget is tight
      const cheapCandidates = qualifiedCandidates.filter(
        c => c.estimatedCost < this.config.thresholds.fallbackTrigger
      );
      if (cheapCandidates.length > 0) {
        return cheapCandidates[0];
      }
    }
    
    return qualifiedCandidates[0];
  }
  
  /**
   * Check budget constraints and generate alerts
   */
  private checkBudgetConstraints(agentId: string): {
    shouldWarn: boolean;
    shouldStop: boolean;
    alert: BudgetAlert;
  } {
    // Check daily limit
    const dailyUtilization = this.costTracker.dailySpent / this.config.budgets.dailyLimit;
    if (dailyUtilization >= this.config.alerts.stopAt) {
      return {
        shouldWarn: false,
        shouldStop: true,
        alert: {
          type: 'daily_limit',
          threshold: this.config.budgets.dailyLimit,
          current: this.costTracker.dailySpent,
          message: `Daily budget exceeded: $${this.costTracker.dailySpent.toFixed(2)}/$${this.config.budgets.dailyLimit}`,
        },
      };
    }
    
    if (dailyUtilization >= this.config.alerts.warnAt) {
      return {
        shouldWarn: true,
        shouldStop: false,
        alert: {
          type: 'daily_limit',
          threshold: this.config.budgets.dailyLimit,
          current: this.costTracker.dailySpent,
          message: `Daily budget warning: $${this.costTracker.dailySpent.toFixed(2)}/$${this.config.budgets.dailyLimit} (${(dailyUtilization * 100).toFixed(1)}%)`,
        },
      };
    }
    
    // Check total limit
    const totalUtilization = this.costTracker.totalSpent / this.config.budgets.totalLimit;
    if (totalUtilization >= this.config.alerts.stopAt) {
      return {
        shouldWarn: false,
        shouldStop: true,
        alert: {
          type: 'total_limit',
          threshold: this.config.budgets.totalLimit,
          current: this.costTracker.totalSpent,
          message: `Total budget exceeded: $${this.costTracker.totalSpent.toFixed(2)}/$${this.config.budgets.totalLimit}`,
        },
      };
    }
    
    // Check agent limit
    const agentSpent = this.costTracker.agentSpend[agentId] || 0;
    if (agentSpent >= this.config.budgets.agentLimit) {
      return {
        shouldWarn: false,
        shouldStop: true,
        alert: {
          type: 'agent_limit',
          threshold: this.config.budgets.agentLimit,
          current: agentSpent,
          message: `Agent budget exceeded: ${agentId} spent $${agentSpent.toFixed(2)}/$${this.config.budgets.agentLimit}`,
        },
      };
    }
    
    return {
      shouldWarn: false,
      shouldStop: false,
      alert: {
        type: 'daily_limit',
        threshold: this.config.budgets.dailyLimit,
        current: this.costTracker.dailySpent,
        message: 'Budget OK',
      },
    };
  }
  
  /**
   * Explain routing decision
   */
  private explainRouting(
    selected: {
      provider: ProviderName;
      qualityScore: number;
      estimatedCost: number;
      costEfficiency: number;
      totalScore: number;
    },
    role: AgentRole
  ): string {
    const cost = selected.estimatedCost;
    const quality = selected.qualityScore;
    const efficiency = selected.costEfficiency;
    
    const reasons: string[] = [];
    
    if (cost === 0) {
      reasons.push('free local inference');
    } else if (cost < 0.01) {
      reasons.push('ultra-low cost');
    } else if (cost < 0.05) {
      reasons.push('cost-efficient');
    }
    
    if (quality >= 9) {
      reasons.push('excellent quality');
    } else if (quality >= 7) {
      reasons.push('good quality');
    }
    
    if (efficiency > 10) {
      reasons.push('high cost efficiency');
    }
    
    const capabilities = PROVIDER_CAPABILITIES[selected.provider];
    switch (role) {
      case 'implementer':
        if (capabilities.coding >= 8) {reasons.push('strong coding abilities');}
        break;
      case 'critic':
        if (capabilities.reasoning >= 8) {reasons.push('strong reasoning abilities');}
        break;
      case 'web':
        if (capabilities.web >= 8) {reasons.push('web search specialized');}
        break;
      case 'vision':
        if (capabilities.vision >= 8) {reasons.push('vision specialized');}
        break;
      case 'longcontext':
        if (capabilities.context >= 9) {reasons.push('1M+ context support');}
        break;
      case 'agentic':
        if (capabilities.agentic >= 8) {reasons.push('multi-step agentic reasoning');}
        break;
    }
    
    return reasons.join(', ') || 'best available option';
  }
  
  /**
   * Estimate token count for task
   */
  private estimateTokens(task: string): number {
    // Rough estimation: 4 chars per token
    return Math.ceil(task.length / 4);
  }
  
  /**
   * Load cost tracker from persistent storage
   */
  private loadCostTracker(): CostTracker {
    try {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      const trackerPath = path.join(os.homedir(), '.superclaw', 'cost-tracker.json');
      
      if (fs.existsSync(trackerPath)) {
        const data = fs.readFileSync(trackerPath, 'utf-8');
        return JSON.parse(data);
      }
    } catch (error: unknown) {
      console.warn('[model-router] Failed to load cost tracker:', error);
    }
    
    // Default tracker
    return {
      totalSpent: 0,
      dailySpent: 0,
      agentSpend: {},
      // @ts-expect-error - Post-Merge Reconciliation
      providerSpend: {},
      // @ts-expect-error - Post-Merge Reconciliation
      callCounts: {},
      // @ts-expect-error - Post-Merge Reconciliation
      dailyCallCounts: {},
      lastReset: Date.now(),
    };
  }
  
  /**
   * Save cost tracker to persistent storage
   */
  private saveCostTracker(): void {
    try {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');
      
      const supercrawDir = path.join(os.homedir(), '.superclaw');
      if (!fs.existsSync(supercrawDir)) {
        fs.mkdirSync(supercrawDir, { recursive: true });
      }
      
      const trackerPath = path.join(supercrawDir, 'cost-tracker.json');
      fs.writeFileSync(trackerPath, JSON.stringify(this.costTracker, null, 2));
    } catch (error: unknown) {
      console.warn('[model-router] Failed to save cost tracker:', error);
    }
  }
}

/**
 * Global model router instance
 */
let globalRouter: ModelRouter | null = null;

/**
 * Get or create global router instance
 */
export function getModelRouter(config?: Partial<ModelRouterConfig>): ModelRouter {
  if (!globalRouter) {
    globalRouter = new ModelRouter(config);
  }
  return globalRouter;
}

/**
 * Estimate cost for a provider call
 */
export function estimateCost(
  provider: ProviderName,
  inputTokens: number,
  outputTokens: number = 0
): number {
  const costs = PROVIDER_COSTS[provider];
  if (!costs) {return 0;}
  
  const inputCost = (inputTokens / 1000) * costs.input;
  const outputCost = (outputTokens / 1000) * costs.output;
  return inputCost + outputCost;
}

/**
 * Get provider tier for cost analysis
 */
export function getProviderTier(provider: ProviderName): number {
  return PROVIDER_COSTS[provider]?.tier || 4;
}