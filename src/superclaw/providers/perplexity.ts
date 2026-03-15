/**
 * Perplexity Provider for SuperClaw
 * 
 * Perplexity API specializes in web-enhanced responses with real-time search
 * and citation handling. Excellent for research and up-to-date information.
 * 
 * Pricing (as of 2024):
 * - pplx-7b-online: ~$0.20/1M input, ~$0.20/1M output + search costs
 * - pplx-70b-online: ~$1.00/1M input, ~$1.00/1M output + search costs
 * - llama-3.1-sonar-small-128k-online: ~$0.20/1M input, ~$0.20/1M output
 * - llama-3.1-sonar-large-128k-online: ~$1.00/1M input, ~$1.00/1M output
 * - llama-3.1-sonar-huge-128k-online: ~$5.00/1M input, ~$5.00/1M output
 */

import {
  ILLMProvider,
  GenerateRequest,
  GenerateResponse,
  StreamChunk,
  Model,
  ModelCapability,
  ProviderType,
  ProviderHealth,
  ProviderStatus,
  RoutingContext,
  ProviderError
} from './contracts';

// Perplexity API response types (OpenAI-compatible with citations)
interface PerplexityMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface PerplexityCitation {
  number: number;
  url: string;
  title?: string;
  snippet?: string;
}

interface PerplexityChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  citations?: PerplexityCitation[];
}

interface PerplexityStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason?: string;
  }>;
  citations?: PerplexityCitation[];
}

export interface PerplexityConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
  searchDomainFilter?: string[]; // Optional domain whitelist for searches
  returnCitations?: boolean;
  searchRecencyFilter?: 'month' | 'week' | 'day' | 'hour'; // Recency filter for searches
}

export interface PerplexityResponse extends GenerateResponse {
  citations?: PerplexityCitation[];
  searchInfo?: {
    queriesPerformed: number;
    sourcesFound: number;
    searchDuration: number;
  };
}

// @ts-expect-error - Post-Merge Reconciliation
export class PerplexityProvider implements ILLMProvider {
  public readonly name = 'perplexity';
  public readonly type = ProviderType.CLOUD;
  public readonly priority = 5; // Good for research, moderate priority
  public readonly defaultModel = 'llama-3.1-sonar-small-128k-online';
  
  private config: PerplexityConfig;
  private baseUrl: string;
  private health: ProviderHealth;

  constructor(config: PerplexityConfig) {
    this.config = {
      model: 'llama-3.1-sonar-small-128k-online',
      maxTokens: 4096,
      temperature: 0.2, // Lower temperature for research accuracy
      returnCitations: true,
      ...config
    };
    this.baseUrl = config.baseUrl || 'https://api.perplexity.ai';
    
    this.health = {
      status: ProviderStatus.HEALTHY,
      lastCheck: new Date(),
      consecutiveFailures: 0,
      avgResponseTime: 0,
      errorRate: 0,
      uptime: 100
    };
  }

  async initialize(): Promise<void> {
    if (!this.config.apiKey) {
      throw new ProviderError(
        'Perplexity API key required',
        this.name,
        'MISSING_API_KEY',
        false
      );
    }
    
    // Test the connection
    await this.isHealthy();
  }

  async isHealthy(): Promise<boolean> {
    if (!this.config.apiKey) {
      this.updateHealthStatus(false, 0);
      return false;
    }
    
    try {
      // Test with a simple request
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: this.defaultModel,
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 1
        })
      });
      
      const success = response.ok;
      this.updateHealthStatus(success, 0);
      return success;
    } catch (error: unknown) {
      this.updateHealthStatus(false, 0);
      return false;
    }
  }

  async getHealth(): Promise<ProviderHealth> {
    await this.isHealthy();
    return { ...this.health };
  }

  async getModels(): Promise<Model[]> {
    const models = [
      {
        name: 'llama-3.1-sonar-small-128k-online',
        displayName: 'Llama 3.1 Sonar Small (128K) Online',
        contextLength: 127072,
        capabilities: [
          ModelCapability.TEXT_GENERATION,
          ModelCapability.RAG,
          ModelCapability.LONG_CONTEXT
        ],
        costPerInputToken: 0.20 / 1_000_000,
        costPerOutputToken: 0.20 / 1_000_000
      },
      {
        name: 'llama-3.1-sonar-large-128k-online',
        displayName: 'Llama 3.1 Sonar Large (128K) Online',
        contextLength: 127072,
        capabilities: [
          ModelCapability.TEXT_GENERATION,
          ModelCapability.REASONING,
          ModelCapability.RAG,
          ModelCapability.LONG_CONTEXT
        ],
        costPerInputToken: 1.00 / 1_000_000,
        costPerOutputToken: 1.00 / 1_000_000
      },
      {
        name: 'llama-3.1-sonar-huge-128k-online',
        displayName: 'Llama 3.1 Sonar Huge (128K) Online',
        contextLength: 127072,
        capabilities: [
          ModelCapability.TEXT_GENERATION,
          ModelCapability.REASONING,
          ModelCapability.RAG,
          ModelCapability.LONG_CONTEXT
        ],
        costPerInputToken: 5.00 / 1_000_000,
        costPerOutputToken: 5.00 / 1_000_000
      },
      // Legacy models for backward compatibility
      {
        name: 'pplx-7b-online',
        displayName: 'Perplexity 7B Online',
        contextLength: 4096,
        capabilities: [
          ModelCapability.TEXT_GENERATION,
          ModelCapability.RAG
        ],
        costPerInputToken: 0.20 / 1_000_000,
        costPerOutputToken: 0.20 / 1_000_000
      },
      {
        name: 'pplx-70b-online',
        displayName: 'Perplexity 70B Online',
        contextLength: 4096,
        capabilities: [
          ModelCapability.TEXT_GENERATION,
          ModelCapability.REASONING,
          ModelCapability.RAG
        ],
        costPerInputToken: 1.00 / 1_000_000,
        costPerOutputToken: 1.00 / 1_000_000
      }
    ];
    
    return models;
  }

  async generate(request: GenerateRequest): Promise<PerplexityResponse> {
    const startTime = Date.now();
    
    try {
      const messages = this.buildMessages(request);
      const payload = this.buildRequestPayload(request, messages, false);
      
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        let error = '';
        try {
          const errorData = await response.json();
          error = errorData.error?.message || errorData.detail || JSON.stringify(errorData);
        } catch {
          error = await response.text();
        }
        throw new Error(`Perplexity API Error ${response.status}: ${error}`);
      }

      const data = await response.json() as PerplexityChatResponse;
      const latency = Date.now() - startTime;
      
      this.updateHealthStatus(true, latency);

      // @ts-expect-error - Post-Merge Reconciliation
      return {
        text: data.choices[0]?.message?.content || '',
        model: data.model,
        tokens: {
          input: data.usage?.prompt_tokens || 0,
          output: data.usage?.completion_tokens || 0
        },
        cost: this.calculateCost(
          data.model,
          data.usage?.prompt_tokens || 0,
          data.usage?.completion_tokens || 0
        ),
        latency,
        provider: this.name,
        citations: data.citations || [],
        searchInfo: data.citations ? {
          queriesPerformed: 1, // Estimated
          sourcesFound: data.citations.length,
          searchDuration: Math.max(0, latency - 1000) // Estimate search overhead
        } : undefined
      };
    } catch (error: unknown) {
      const latency = Date.now() - startTime;
      this.updateHealthStatus(false, latency);
      
      throw new ProviderError(
        `Generation failed: ${error instanceof Error ? (error).message : 'Unknown error'}`,
        this.name,
        'GENERATE_FAILED',
        true
      );
    }
  }

  async* stream(request: GenerateRequest): AsyncIterable<StreamChunk> {
    const startTime = Date.now();
    let accumulatedCitations: PerplexityCitation[] = [];
    
    try {
      const messages = this.buildMessages(request);
      const payload = this.buildRequestPayload(request, messages, true);
      
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        let error = '';
        try {
          const errorData = await response.json();
          error = errorData.error?.message || errorData.detail || JSON.stringify(errorData);
        } catch {
          error = await response.text();
        }
        throw new Error(`Perplexity Streaming API Error ${response.status}: ${error}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body reader available');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {break;}
          
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) {continue;}
            
            const data = trimmed.slice(6);
            if (data === '[DONE]') {break;}
            
            try {
              const parsed = JSON.parse(data) as PerplexityStreamChunk;
              const delta = parsed.choices?.[0]?.delta;
              
              if (delta?.content) {
                yield {
                  text: delta.content,
                  isComplete: false,
                  model: parsed.model,
                  provider: this.name
                };
              }
              
              // Collect citations as they come in
              if (parsed.citations) {
                accumulatedCitations = parsed.citations;
              }
              
            } catch (e) {
              // Skip malformed JSON
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
      
      const latency = Date.now() - startTime;
      this.updateHealthStatus(true, latency);
      
      // Final chunk with citations if available
      yield {
        text: accumulatedCitations.length > 0 
          ? `\n\nSources:\n${accumulatedCitations.map(c => `[${c.number}] ${c.title || c.url}`).join('\n')}`
          : '',
        isComplete: true,
        model: request.model || this.defaultModel,
        provider: this.name
      };
      
    } catch (error: unknown) {
      const latency = Date.now() - startTime;
      this.updateHealthStatus(false, latency);
      
      throw new ProviderError(
        `Streaming failed: ${error instanceof Error ? (error).message : 'Unknown error'}`,
        this.name,
        'STREAM_FAILED',
        true
      );
    }
  }

  canHandle(request: GenerateRequest, context?: RoutingContext): boolean {
    // Check if we have API key
    if (!this.config.apiKey) {
      return false;
    }
    
    // Check budget if provided
    if (context?.maxCost) {
      const estimatedCost = this.estimateRequestCost(request);
      if (estimatedCost > context.maxCost) {
        return false;
      }
    }
    
    // Check capabilities - we're best for web research and RAG
    if (context?.requiredCapabilities) {
      const ourCapabilities = new Set([
        ModelCapability.TEXT_GENERATION,
        ModelCapability.RAG,
        ModelCapability.LONG_CONTEXT,
        ModelCapability.REASONING
      ]);
      
      return context.requiredCapabilities.every(cap => ourCapabilities.has(cap));
    }
    
    // We're particularly good for web research queries
    const isWebResearchQuery = /\b(latest|recent|current|today|news|update|what.?s new|when did|search|find)\b/i.test(request.prompt);
    
    return true;
  }

  async estimateCost(request: GenerateRequest): Promise<number> {
    return this.estimateRequestCost(request);
  }

  async shutdown(): Promise<void> {
    // Nothing to clean up for HTTP client
  }

  private buildMessages(request: GenerateRequest): PerplexityMessage[] {
    if (request.context?.messages) {
      let messages = [...request.context.messages] as PerplexityMessage[];
      
      // Add system prompt if provided and not already in messages
      if (request.systemPrompt && !messages.some(m => m.role === 'system')) {
        messages.unshift({ role: 'system', content: request.systemPrompt });
      }
      
      // Add user prompt
      messages.push({ role: 'user', content: request.prompt });
      
      return messages;
    } else {
      const messages: PerplexityMessage[] = [];
      
      if (request.systemPrompt) {
        messages.push({ role: 'system', content: request.systemPrompt });
      }
      
      messages.push({ role: 'user', content: request.prompt });
      
      return messages;
    }
  }

  private buildRequestPayload(request: GenerateRequest, messages: PerplexityMessage[], stream: boolean) {
    const payload: any = {
      model: request.model || this.defaultModel,
      messages: messages,
      max_tokens: request.maxTokens || this.config.maxTokens,
      temperature: request.temperature ?? this.config.temperature,
      stream
    };

    // Add Perplexity-specific parameters
    if (this.config.returnCitations) {
      payload.return_citations = true;
    }

    if (this.config.searchDomainFilter && this.config.searchDomainFilter.length > 0) {
      payload.search_domain_filter = this.config.searchDomainFilter;
    }

    if (this.config.searchRecencyFilter) {
      payload.search_recency_filter = this.config.searchRecencyFilter;
    }

    return payload;
  }

  private calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    const costPer1M = this.getCostPer1M(model);
    const inputCost = (inputTokens / 1_000_000) * costPer1M.input;
    const outputCost = (outputTokens / 1_000_000) * costPer1M.output;
    return inputCost + outputCost;
  }

  private estimateRequestCost(request: GenerateRequest): number {
    // Rough estimate: prompt length / 4 for input tokens
    const inputTokens = Math.ceil(request.prompt.length / 4);
    const outputTokens = request.maxTokens || this.config.maxTokens || 1000;
    
    return this.calculateCost(
      request.model || this.defaultModel,
      inputTokens,
      outputTokens
    );
  }

  private getCostPer1M(model: string): { input: number; output: number } {
    // Perplexity pricing (USD per 1M tokens)
    const costs: Record<string, { input: number; output: number }> = {
      'llama-3.1-sonar-small-128k-online': { input: 0.20, output: 0.20 },
      'llama-3.1-sonar-large-128k-online': { input: 1.00, output: 1.00 },
      'llama-3.1-sonar-huge-128k-online': { input: 5.00, output: 5.00 },
      'pplx-7b-online': { input: 0.20, output: 0.20 },
      'pplx-70b-online': { input: 1.00, output: 1.00 }
    };
    
    return costs[model] || costs['llama-3.1-sonar-small-128k-online'];
  }

  private updateHealthStatus(success: boolean, responseTime: number): void {
    this.health.lastCheck = new Date();
    
    if (success) {
      this.health.consecutiveFailures = 0;
      this.health.status = ProviderStatus.HEALTHY;
      
      // Update running average of response time
      this.health.avgResponseTime = 
        (this.health.avgResponseTime * 0.9) + (responseTime * 0.1);
    } else {
      this.health.consecutiveFailures++;
      
      if (this.health.consecutiveFailures >= 3) {
        this.health.status = ProviderStatus.UNHEALTHY;
      } else if (this.health.consecutiveFailures >= 1) {
        this.health.status = ProviderStatus.DEGRADED;
      }
    }
  }
}

// Factory function for easy instantiation
export function createPerplexityProvider(apiKey?: string): PerplexityProvider {
  const key = apiKey || process.env.PERPLEXITY_API_KEY;
  if (!key) {
    throw new Error('Perplexity API key required. Set PERPLEXITY_API_KEY or pass apiKey.');
  }
  return new PerplexityProvider({ apiKey: key });
}