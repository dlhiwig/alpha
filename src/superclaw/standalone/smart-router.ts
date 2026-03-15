/**
 * SuperClaw Smart Router - Cloud Provider Fallback Implementation
 * 
 * Intelligent routing system that optimizes for cost by prioritizing local models
 * and falling back to cloud providers based on query complexity and availability.
 */

import { Anthropic } from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

interface SmartRouterRequest {
  message: string;
  sessionHistory?: Message[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  priority?: 'low' | 'normal' | 'high';
  maxCost?: number;
}

interface SmartRouterResponse {
  response: string;
  model: string;
  provider: string;
  tokensUsed: {
    input: number;
    output: number;
  };
  cost: number;
  latency: number;
  routingReason: string;
}

interface ProviderHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  consecutiveFailures: number;
  lastCheck: Date;
  avgResponseTime: number;
}

interface QueryComplexity {
  score: number;
  reasons: string[];
  estimatedTokens: number;
  requiresCloudProvider: boolean;
}

enum Provider {
  OLLAMA = 'ollama',
  CLAUDE = 'claude',
  GEMINI = 'gemini'
}

export class SmartRouter {
  private readonly ollamaEndpoint: string;
  private readonly anthropicClient?: Anthropic;
  private readonly geminiClient?: GoogleGenerativeAI;
  private readonly providerHealth: Map<Provider, ProviderHealth> = new Map();
  private readonly costTracking: { daily: number; monthly: number } = { daily: 0, monthly: 0 };
  
  // Cost per 1M tokens (approximate)
  private readonly costs = {
    [Provider.OLLAMA]: { input: 0, output: 0 }, // Free
    [Provider.CLAUDE]: { input: 0.003, output: 0.015 }, // Claude Sonnet
    [Provider.GEMINI]: { input: 0.075, output: 0.15 } // Gemini 2.0 Flash
  };
  
  // Model mappings
  private readonly models = {
    [Provider.OLLAMA]: {
      simple: 'dolphin-llama3:8b',
      code: 'qwen3-coder',
      complex: 'dolphin-llama3:70b'
    },
    [Provider.CLAUDE]: {
      default: 'claude-sonnet-4-20250514',
      complex: 'claude-opus-4-5-20251101'
    },
    [Provider.GEMINI]: {
      default: 'gemini-2.0-flash-001'
    }
  };

  constructor() {
    this.ollamaEndpoint = process.env.OLLAMA_ENDPOINT || 'http://127.0.0.1:11434';
    
    // Initialize cloud providers if API keys are available
    if (process.env.ANTHROPIC_API_KEY) {
      this.anthropicClient = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
    }
    
    if (process.env.GEMINI_API_KEY) {
      this.geminiClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    }
    
    // Initialize health status
    this.initializeProviderHealth();
  }

  /**
   * Main routing method - intelligently route requests to optimal providers
   */
  async route(request: SmartRouterRequest): Promise<SmartRouterResponse> {
    const startTime = Date.now();
    
    // Analyze query complexity
    const complexity = this.analyzeComplexity(request.message, request.sessionHistory);
    
    // Determine optimal provider order
    const providerPriority = await this.getProviderPriority(complexity, request);
    
    // Try providers in priority order with fallback
    for (const provider of providerPriority) {
      try {
        const result = await this.executeWithProvider(provider, request, complexity);
        
        // Update health status on success
        this.updateHealthStatus(provider, true, Date.now() - startTime);
        
        return {
          ...result,
          latency: Date.now() - startTime,
          routingReason: `Selected ${provider} - ${this.getRoutingReason(provider, complexity)}`
        };
        
      } catch (error: unknown) {
        console.warn(`Provider ${provider} failed: ${(error as Error).message}`);
        this.updateHealthStatus(provider, false, 0);
        continue;
      }
    }
    
    throw new Error('All providers failed - no fallback available');
  }

  /**
   * Analyze query complexity to determine appropriate provider
   */
  private analyzeComplexity(message: string, sessionHistory?: Message[]): QueryComplexity {
    let score = 0;
    const reasons: string[] = [];
    
    // Token count estimation
    const messageTokens = this.estimateTokens(message);
    const historyTokens = sessionHistory ? 
      sessionHistory.reduce((sum, msg) => sum + this.estimateTokens(msg.content), 0) : 0;
    const totalTokens = messageTokens + historyTokens;
    
    // Base complexity from message length
    if (messageTokens > 1000) {
      score += 3;
      reasons.push('Long input message');
    }
    
    // Context complexity
    if (totalTokens > 4000) {
      score += 2;
      reasons.push('Long conversation history');
    }
    
    // Content complexity indicators
    const complexKeywords = [
      'analyze', 'complex', 'detailed', 'comprehensive', 'sophisticated',
      'algorithm', 'implementation', 'architecture', 'optimization',
      'research', 'academic', 'technical', 'scientific', 'mathematical',
      'code review', 'refactor', 'debug', 'troubleshoot'
    ];
    
    const codeKeywords = [
      'function', 'class', 'import', 'export', 'const', 'let', 'var',
      'if', 'else', 'for', 'while', 'try', 'catch', 'async', 'await',
      'typescript', 'javascript', 'python', 'react', 'node.js'
    ];
    
    const messageLower = message.toLowerCase();
    
    const complexMatches = complexKeywords.filter(keyword => 
      messageLower.includes(keyword)
    ).length;
    
    const codeMatches = codeKeywords.filter(keyword => 
      messageLower.includes(keyword)
    ).length;
    
    if (complexMatches > 2) {
      score += 4;
      reasons.push('Complex analysis requested');
    }
    
    if (codeMatches > 3) {
      score += 2;
      reasons.push('Code generation/review task');
    }
    
    // Multi-step reasoning indicators
    if (messageLower.includes('step by step') || 
        messageLower.includes('explain how') ||
        messageLower.includes('walk me through')) {
      score += 2;
      reasons.push('Multi-step reasoning required');
    }
    
    // Cloud provider requirements
    const requiresCloudProvider = score > 6 || 
      messageLower.includes('vision') ||
      messageLower.includes('image') ||
      totalTokens > 8000;
    
    if (requiresCloudProvider) {
      reasons.push('Requires cloud provider capabilities');
    }
    
    return {
      score,
      reasons,
      estimatedTokens: totalTokens,
      requiresCloudProvider
    };
  }

  /**
   * Determine provider priority based on complexity and health
   */
  private async getProviderPriority(
    complexity: QueryComplexity, 
    request: SmartRouterRequest
  ): Promise<Provider[]> {
    const priority: Provider[] = [];
    
    // Check if user specified a preferred provider
    if (request.model?.includes('claude') && this.anthropicClient) {
      priority.push(Provider.CLAUDE);
    } else if (request.model?.includes('gemini') && this.geminiClient) {
      priority.push(Provider.GEMINI);
    }
    
    // If cloud provider is required, skip Ollama
    if (complexity.requiresCloudProvider) {
      if (!priority.includes(Provider.CLAUDE) && this.anthropicClient) {
        priority.push(Provider.CLAUDE);
      }
      if (!priority.includes(Provider.GEMINI) && this.geminiClient) {
        priority.push(Provider.GEMINI);
      }
    } else {
      // Cost optimization: try local first for simple queries
      if (complexity.score <= 3 && await this.isProviderHealthy(Provider.OLLAMA)) {
        priority.unshift(Provider.OLLAMA);
      }
      
      // Add cloud fallbacks
      if (this.anthropicClient && !priority.includes(Provider.CLAUDE)) {
        priority.push(Provider.CLAUDE);
      }
      if (this.geminiClient && !priority.includes(Provider.GEMINI)) {
        priority.push(Provider.GEMINI);
      }
      
      // If Ollama is unhealthy but query is simple, still add it at the end
      if (complexity.score <= 3 && !priority.includes(Provider.OLLAMA)) {
        priority.push(Provider.OLLAMA);
      }
    }
    
    return priority.filter(provider => this.isProviderAvailable(provider));
  }

  /**
   * Execute request with specific provider
   */
  private async executeWithProvider(
    provider: Provider,
    request: SmartRouterRequest,
    complexity: QueryComplexity
  ): Promise<Omit<SmartRouterResponse, 'latency' | 'routingReason'>> {
    switch (provider) {
      case Provider.OLLAMA:
        return this.executeOllama(request, complexity);
      case Provider.CLAUDE:
        return this.executeClaude(request, complexity);
      case Provider.GEMINI:
        return this.executeGemini(request, complexity);
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  /**
   * Execute with Ollama (local)
   */
  private async executeOllama(
    request: SmartRouterRequest,
    complexity: QueryComplexity
  ): Promise<Omit<SmartRouterResponse, 'latency' | 'routingReason'>> {
    const startTime = Date.now();
    
    // Select appropriate model based on complexity and content
    let model = this.models[Provider.OLLAMA].simple;
    
    if (request.message.toLowerCase().includes('code') || 
        request.message.toLowerCase().includes('function')) {
      model = this.models[Provider.OLLAMA].code;
    } else if (complexity.score > 5) {
      model = this.models[Provider.OLLAMA].complex;
    }
    
    // Build prompt with session history
    const prompt = this.buildPrompt(request.message, request.sessionHistory);
    
    const ollamaRequest = {
      model,
      prompt,
      stream: false,
      options: {
        temperature: request.temperature || 0.7,
        max_tokens: request.maxTokens || 2048,
      }
    };

    const response = await fetch(`${this.ollamaEndpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ollamaRequest),
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const inputTokens = data.prompt_eval_count || this.estimateTokens(prompt);
    const outputTokens = data.eval_count || this.estimateTokens(data.response);

    return {
      response: data.response,
      model: data.model,
      provider: Provider.OLLAMA,
      tokensUsed: { input: inputTokens, output: outputTokens },
      cost: 0 // Free
    };
  }

  /**
   * Execute with Claude (Anthropic)
   */
  private async executeClaude(
    request: SmartRouterRequest,
    complexity: QueryComplexity
  ): Promise<Omit<SmartRouterResponse, 'latency' | 'routingReason'>> {
    if (!this.anthropicClient) {
      throw new Error('Claude client not initialized - missing ANTHROPIC_API_KEY');
    }

    const startTime = Date.now();
    
    // Select model based on complexity
    const model = complexity.score > 8 ? 
      this.models[Provider.CLAUDE].complex : 
      this.models[Provider.CLAUDE].default;
    
    // Build messages array
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    
    if (request.sessionHistory) {
      for (const msg of request.sessionHistory.slice(-10)) {
        if (msg.role !== 'system') {
          messages.push({
            role: msg.role,
            content: msg.content
          });
        }
      }
    }
    
    messages.push({
      role: 'user',
      content: request.message
    });

    const response = await this.anthropicClient.messages.create({
      model,
      max_tokens: request.maxTokens || 2048,
      temperature: request.temperature || 0.7,
      messages
    });

    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const cost = this.calculateCost(Provider.CLAUDE, inputTokens, outputTokens);
    
    // Track costs
    this.costTracking.daily += cost;
    this.costTracking.monthly += cost;

    return {
      response: response.content[0].type === 'text' ? response.content[0].text : '',
      model,
      provider: Provider.CLAUDE,
      tokensUsed: { input: inputTokens, output: outputTokens },
      cost
    };
  }

  /**
   * Execute with Gemini
   */
  private async executeGemini(
    request: SmartRouterRequest,
    complexity: QueryComplexity
  ): Promise<Omit<SmartRouterResponse, 'latency' | 'routingReason'>> {
    if (!this.geminiClient) {
      throw new Error('Gemini client not initialized - missing GEMINI_API_KEY');
    }

    const startTime = Date.now();
    const model = this.geminiClient.getGenerativeModel({ 
      model: this.models[Provider.GEMINI].default 
    });
    
    // Build conversation history
    let prompt = request.message;
    
    if (request.sessionHistory && request.sessionHistory.length > 0) {
      const historyText = request.sessionHistory
        .slice(-5) // Limit context
        .map(msg => `${msg.role}: ${msg.content}`)
        .join('\n');
      prompt = `${historyText}\nuser: ${request.message}`;
    }

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: request.temperature || 0.7,
        maxOutputTokens: request.maxTokens || 2048,
      }
    });

    const response = result.response;
    const text = response.text();
    
    // Estimate tokens (Gemini doesn't always provide usage stats)
    const inputTokens = this.estimateTokens(prompt);
    const outputTokens = this.estimateTokens(text);
    const cost = this.calculateCost(Provider.GEMINI, inputTokens, outputTokens);
    
    // Track costs
    this.costTracking.daily += cost;
    this.costTracking.monthly += cost;

    return {
      response: text,
      model: this.models[Provider.GEMINI].default,
      provider: Provider.GEMINI,
      tokensUsed: { input: inputTokens, output: outputTokens },
      cost
    };
  }

  /**
   * Check if provider is available
   */
  private isProviderAvailable(provider: Provider): boolean {
    switch (provider) {
      case Provider.OLLAMA:
        return true; // Always try Ollama
      case Provider.CLAUDE:
        return !!this.anthropicClient;
      case Provider.GEMINI:
        return !!this.geminiClient;
      default:
        return false;
    }
  }

  /**
   * Check if provider is healthy
   */
  private async isProviderHealthy(provider: Provider): Promise<boolean> {
    const health = this.providerHealth.get(provider);
    if (!health) {return false;}
    
    // Consider unhealthy if more than 3 consecutive failures
    if (health.consecutiveFailures > 3) {return false;}
    
    // Check if we need to test health
    const timeSinceCheck = Date.now() - health.lastCheck.getTime();
    if (timeSinceCheck > 60000) { // 1 minute
      return this.testProviderHealth(provider);
    }
    
    return health.status === 'healthy';
  }

  /**
   * Test provider health
   */
  private async testProviderHealth(provider: Provider): Promise<boolean> {
    try {
      switch (provider) {
        case Provider.OLLAMA:
          const response = await fetch(`${this.ollamaEndpoint}/api/tags`, {
            signal: AbortSignal.timeout(5000)
          });
          return response.ok;
        case Provider.CLAUDE:
          // Simple health check - we assume it's healthy if initialized
          return !!this.anthropicClient;
        case Provider.GEMINI:
          // Simple health check - we assume it's healthy if initialized
          return !!this.geminiClient;
        default:
          return false;
      }
    } catch {
      return false;
    }
  }

  /**
   * Update provider health status
   */
  private updateHealthStatus(provider: Provider, success: boolean, latency: number): void {
    const health = this.providerHealth.get(provider);
    if (!health) {return;}
    
    if (success) {
      health.status = 'healthy';
      health.consecutiveFailures = 0;
      health.avgResponseTime = (health.avgResponseTime + latency) / 2;
    } else {
      health.consecutiveFailures++;
      if (health.consecutiveFailures > 3) {
        health.status = 'unhealthy';
      } else if (health.consecutiveFailures > 1) {
        health.status = 'degraded';
      }
    }
    
    health.lastCheck = new Date();
  }

  /**
   * Initialize provider health tracking
   */
  private initializeProviderHealth(): void {
    const providers = [Provider.OLLAMA, Provider.CLAUDE, Provider.GEMINI];
    
    for (const provider of providers) {
      this.providerHealth.set(provider, {
        status: 'healthy',
        consecutiveFailures: 0,
        lastCheck: new Date(0), // Force initial check
        avgResponseTime: 0
      });
    }
  }

  /**
   * Calculate cost for token usage
   */
  private calculateCost(provider: Provider, inputTokens: number, outputTokens: number): number {
    const costs = this.costs[provider];
    return (inputTokens * costs.input + outputTokens * costs.output) / 1000000;
  }

  /**
   * Get routing reason for logging
   */
  private getRoutingReason(provider: Provider, complexity: QueryComplexity): string {
    const reasons = [`Complexity score: ${complexity.score}`];
    
    if (complexity.requiresCloudProvider) {
      reasons.push('requires cloud capabilities');
    }
    
    if (provider === Provider.OLLAMA) {
      reasons.push('cost optimization (free)');
    } else if (provider === Provider.GEMINI) {
      reasons.push('budget-friendly cloud option');
    } else if (provider === Provider.CLAUDE) {
      reasons.push('high-quality reasoning');
    }
    
    reasons.push(...complexity.reasons);
    
    return reasons.join(', ');
  }

  /**
   * Build conversational prompt
   */
  private buildPrompt(message: string, sessionHistory?: Message[]): string {
    let prompt = '';

    if (sessionHistory && sessionHistory.length > 0) {
      const recentHistory = sessionHistory.slice(-10);
      
      for (const msg of recentHistory) {
        if (msg.role === 'user') {
          prompt += `Human: ${msg.content}\n`;
        } else if (msg.role === 'assistant') {
          prompt += `Assistant: ${msg.content}\n`;
        }
      }
    }

    prompt += `Human: ${message}\n`;
    prompt += `Assistant:`;

    return prompt;
  }

  /**
   * Estimate token count (rough approximation)
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Get provider health status
   */
  public async getHealthStatus(): Promise<Record<string, any>> {
    const status: Record<string, any> = {};
    
    for (const [provider, health] of this.providerHealth.entries()) {
      status[provider] = {
        ...health,
        available: this.isProviderAvailable(provider),
        healthy: await this.isProviderHealthy(provider)
      };
    }
    
    status.costs = this.costTracking;
    
    return status;
  }

  /**
   * Reset daily cost tracking (call this daily)
   */
  public resetDailyCosts(): void {
    this.costTracking.daily = 0;
  }

  /**
   * Reset monthly cost tracking (call this monthly)
   */
  public resetMonthlyCosts(): void {
    this.costTracking.monthly = 0;
  }
}

// Export singleton instance
export const smartRouter = new SmartRouter();