/**
 * DeepSeek Provider for SuperClaw Hivemind
 * 
 * DeepSeek API is OpenAI-compatible, very cheap pricing:
 * - Input: ~$0.14/1M tokens
 * - Output: ~$0.28/1M tokens
 * 
 * Models:
 * - deepseek-chat: General purpose
 * - deepseek-coder: Code generation
 * - deepseek-reasoner: Deep thinking (R1)
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

// DeepSeek API response types (OpenAI-compatible)
interface DeepSeekChatResponse {
  model: string;
  choices: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface DeepSeekConfig {
  apiKey: string;
  model?: 'deepseek-chat' | 'deepseek-coder' | 'deepseek-reasoner';
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}

// @ts-expect-error - Post-Merge Reconciliation
export class DeepSeekProvider implements ILLMProvider {
  public readonly name = 'deepseek';
  public readonly type = ProviderType.CLOUD;
  public readonly priority = 4; // Lower priority than other providers
  public readonly defaultModel = 'deepseek-chat';
  
  private config: DeepSeekConfig;
  private baseUrl: string;
  private health: ProviderHealth;

  constructor(config: DeepSeekConfig) {
    this.config = {
      model: 'deepseek-chat',
      maxTokens: 4096,
      temperature: 0.7,
      ...config
    };
    this.baseUrl = config.baseUrl || 'https://api.deepseek.com/v1';
    
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
        'DeepSeek API key required',
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
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${this.config.apiKey}` }
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
    const models = ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'];
    
    return models.map(name => ({
      name,
      displayName: name.replace('deepseek-', 'DeepSeek ').replace('-', ' '),
      contextLength: 128000,
      capabilities: [
        ModelCapability.TEXT_GENERATION,
        ...(name.includes('coder') ? [ModelCapability.CODE_GENERATION] : []),
        ...(name.includes('reasoner') ? [ModelCapability.REASONING] : []),
        ...(name.includes('chat') ? [ModelCapability.CODE_GENERATION] : []), // Chat model can also do code
        ModelCapability.LONG_CONTEXT
      ],
      costPerInputToken: this.getInputCostPer1M() / 1_000_000,
      costPerOutputToken: this.getOutputCostPer1M() / 1_000_000
    }));
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const startTime = Date.now();
    
    try {
      const messages = this.buildMessages(request);
      
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: request.model || this.defaultModel,
          messages: messages,
          max_tokens: request.maxTokens || this.config.maxTokens,
          temperature: request.temperature ?? this.config.temperature,
          stream: false
        })
      });

      if (!response.ok) {
        let error = '';
        try {
          const errorData = await response.json();
          // @ts-expect-error - Post-Merge Reconciliation
          error = errorData.error?.message || errorData.detail || JSON.stringify(errorData);
        } catch {
          error = await response.text();
        }
        throw new Error(`DeepSeek API Error ${response.status}: ${error}`);
      }

      const data = await response.json() as DeepSeekChatResponse;
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
          data.usage?.prompt_tokens || 0,
          data.usage?.completion_tokens || 0
        ),
        latency,
        provider: this.name
      };
    } catch (error: unknown) {
      const latency = Date.now() - startTime;
      this.updateHealthStatus(false, latency);
      
      throw new ProviderError(
        `Generation failed: ${error instanceof Error ? (error as Error).message : 'Unknown error'}`,
        this.name,
        'GENERATE_FAILED',
        true
      );
    }
  }

  async* stream(request: GenerateRequest): AsyncIterable<StreamChunk> {
    const startTime = Date.now();
    let accumulatedText = '';
    let inputTokens = 0;
    let outputTokens = 0;
    
    try {
      const messages = this.buildMessages(request);
      
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: request.model || this.defaultModel,
          messages: messages,
          max_tokens: request.maxTokens || this.config.maxTokens,
          temperature: request.temperature ?? this.config.temperature,
          stream: true
        })
      });

      if (!response.ok) {
        let error = '';
        try {
          const errorData = await response.json();
          // @ts-expect-error - Post-Merge Reconciliation
          error = errorData.error?.message || errorData.detail || JSON.stringify(errorData);
        } catch {
          error = await response.text();
        }
        throw new Error(`DeepSeek Streaming API Error ${response.status}: ${error}`);
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
          
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;
            
            const data = trimmed.slice(6);
            if (data === '[DONE]') break;
            
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta;
              
              if (delta?.content) {
                accumulatedText += delta.content;
                outputTokens++; // Rough estimate
                
                yield {
                  text: delta.content,
                  isComplete: false,
                  model: parsed.model,
                  provider: this.name
                };
              }
              
              // Track token usage if available
              if (parsed.usage) {
                inputTokens = parsed.usage.prompt_tokens || 0;
                outputTokens = parsed.usage.completion_tokens || outputTokens;
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
      
      // Final chunk with complete response
      yield {
        text: '',
        isComplete: true,
        model: request.model || this.defaultModel,
        provider: this.name
      };
      
    } catch (error: unknown) {
      const latency = Date.now() - startTime;
      this.updateHealthStatus(false, latency);
      
      throw new ProviderError(
        `Streaming failed: ${error instanceof Error ? (error as Error).message : 'Unknown error'}`,
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
    
    // Check capabilities
    if (context?.requiredCapabilities) {
      const capabilities = [
        ModelCapability.TEXT_GENERATION,
        ModelCapability.CODE_GENERATION,
        ModelCapability.REASONING,
        ModelCapability.LONG_CONTEXT
      ];
      
      return context.requiredCapabilities.every(cap => capabilities.includes(cap));
    }
    
    return true;
  }

  async estimateCost(request: GenerateRequest): Promise<number> {
    return this.estimateRequestCost(request);
  }

  async shutdown(): Promise<void> {
    // Nothing to clean up for HTTP client
  }

  private buildMessages(request: GenerateRequest) {
    if (request.context?.messages) {
      let messages = [...request.context.messages];
      
      // Add system prompt if provided and not already in messages
      if (request.systemPrompt && !messages.some(m => m.role === 'system')) {
        messages.unshift({ role: 'system', content: request.systemPrompt });
      }
      
      // Add user prompt
      messages.push({ role: 'user', content: request.prompt });
      
      return messages;
    } else {
      const messages = [];
      
      if (request.systemPrompt) {
        messages.push({ role: 'system', content: request.systemPrompt });
      }
      
      messages.push({ role: 'user', content: request.prompt });
      
      return messages;
    }
  }

  private calculateCost(inputTokens: number, outputTokens: number): number {
    const inputCost = (inputTokens / 1_000_000) * this.getInputCostPer1M();
    const outputCost = (outputTokens / 1_000_000) * this.getOutputCostPer1M();
    return inputCost + outputCost;
  }

  private estimateRequestCost(request: GenerateRequest): number {
    // Rough estimate: prompt length / 4 for input tokens
    const inputTokens = Math.ceil(request.prompt.length / 4);
    const outputTokens = request.maxTokens || this.config.maxTokens || 1000;
    
    return this.calculateCost(inputTokens, outputTokens);
  }

  private getInputCostPer1M(): number {
    // DeepSeek V3 pricing - ultra cheap!
    return 0.14; // $0.14 per 1M input tokens
  }

  private getOutputCostPer1M(): number {
    return 0.28; // $0.28 per 1M output tokens
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
export function createDeepSeekProvider(apiKey?: string): DeepSeekProvider {
  const key = apiKey || process.env.DEEPSEEK_API_KEY;
  if (!key) {
    throw new Error('DeepSeek API key required. Set DEEPSEEK_API_KEY or pass apiKey.');
  }
  return new DeepSeekProvider({ apiKey: key });
}
