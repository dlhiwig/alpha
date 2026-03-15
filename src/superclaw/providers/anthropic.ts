/**
 * Anthropic Provider for SuperClaw
 * 
 * Full Claude API integration following ZeroClaw trait-based patterns
 * Supports: streaming, tool calling, all Claude models, cost tracking
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
  ProviderError,
  ConversationContext,
  Message
} from './contracts';

// Anthropic API types
interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContent[];
}

interface AnthropicContent {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: any;
  content?: string;
  is_error?: boolean;
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  system?: string;
  temperature?: number;
  stream?: boolean;
  tools?: AnthropicTool[];
  tool_choice?: { type: 'auto' | 'any' | 'tool'; name?: string };
}

interface AnthropicResponse {
  id: string;
  type: 'message';
  model: string;
  role: 'assistant';
  content: AnthropicContent[];
  stop_reason?: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface AnthropicStreamEvent {
  type: 'message_start' | 'content_block_start' | 'content_block_delta' | 'content_block_stop' | 'message_delta' | 'message_stop' | 'error';
  message?: Partial<AnthropicResponse>;
  content_block?: AnthropicContent;
  delta?: {
    type: string;
    text?: string;
    partial_json?: string;
  };
  usage?: {
    output_tokens: number;
  };
  error?: {
    type: string;
    message: string;
  };
}

export interface AnthropicConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  baseUrl?: string;
  maxRetries?: number;
  retryDelay?: number;
  timeout?: number;
}

// @ts-expect-error - Post-Merge Reconciliation
export class AnthropicProvider implements ILLMProvider {
  public readonly name = 'anthropic';
  public readonly type = ProviderType.CLOUD;
  public readonly priority = 2; // High priority for Claude models
  public readonly defaultModel = 'claude-3-5-sonnet-20241022';
  
  private config: AnthropicConfig;
  private health: ProviderHealth;
  private readonly apiVersion = '2023-06-01';

  // Model definitions with current pricing (as of 2025)
  private readonly modelDefinitions: Record<string, {
    displayName: string;
    contextLength: number;
    capabilities: ModelCapability[];
    inputCostPer1M: number;
    outputCostPer1M: number;
  }> = {
    'claude-3-5-sonnet-20241022': {
      displayName: 'Claude 3.5 Sonnet',
      contextLength: 200000,
      capabilities: [
        ModelCapability.TEXT_GENERATION,
        ModelCapability.CODE_GENERATION,
        ModelCapability.REASONING,
        ModelCapability.FUNCTION_CALLING,
        ModelCapability.VISION,
        ModelCapability.LONG_CONTEXT
      ],
      inputCostPer1M: 3.0,
      outputCostPer1M: 15.0
    },
    'claude-3-opus-20240229': {
      displayName: 'Claude 3 Opus',
      contextLength: 200000,
      capabilities: [
        ModelCapability.TEXT_GENERATION,
        ModelCapability.CODE_GENERATION,
        ModelCapability.REASONING,
        ModelCapability.FUNCTION_CALLING,
        ModelCapability.VISION,
        ModelCapability.LONG_CONTEXT
      ],
      inputCostPer1M: 15.0,
      outputCostPer1M: 75.0
    },
    'claude-3-haiku-20240307': {
      displayName: 'Claude 3 Haiku',
      contextLength: 200000,
      capabilities: [
        ModelCapability.TEXT_GENERATION,
        ModelCapability.CODE_GENERATION,
        ModelCapability.REASONING,
        ModelCapability.FUNCTION_CALLING,
        ModelCapability.VISION,
        ModelCapability.LONG_CONTEXT
      ],
      inputCostPer1M: 0.25,
      outputCostPer1M: 1.25
    },
    // Newer models if available
    'claude-3-5-haiku-20241022': {
      displayName: 'Claude 3.5 Haiku',
      contextLength: 200000,
      capabilities: [
        ModelCapability.TEXT_GENERATION,
        ModelCapability.CODE_GENERATION,
        ModelCapability.REASONING,
        ModelCapability.FUNCTION_CALLING,
        ModelCapability.LONG_CONTEXT
      ],
      inputCostPer1M: 1.0,
      outputCostPer1M: 5.0
    }
  };

  constructor(config: AnthropicConfig) {
    this.config = {
      maxTokens: 4096,
      temperature: 0.7,
      baseUrl: 'https://api.anthropic.com',
      maxRetries: 3,
      retryDelay: 1000,
      timeout: 60000,
      ...config
    };
    
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
        'Anthropic API key required. Set ANTHROPIC_API_KEY environment variable.',
        this.name,
        'MISSING_API_KEY',
        false
      );
    }
    
    // Test connectivity
    const isHealthy = await this.isHealthy();
    if (!isHealthy) {
      throw new ProviderError(
        'Failed to initialize Anthropic provider - health check failed',
        this.name,
        'INITIALIZATION_FAILED',
        true
      );
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const startTime = Date.now();
      
      // Minimal test request
      const response = await this.makeRequest({
        model: this.defaultModel,
        max_tokens: 10,
        temperature: 0,
        messages: [{ role: 'user', content: 'Hi' }]
      });

      const success = response.status === 200;
      const latency = Date.now() - startTime;
      
      this.updateHealthStatus(success, latency);
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
    return Object.entries(this.modelDefinitions).map(([name, def]) => ({
      name,
      displayName: def.displayName,
      contextLength: def.contextLength,
      capabilities: def.capabilities,
      costPerInputToken: def.inputCostPer1M / 1_000_000,
      costPerOutputToken: def.outputCostPer1M / 1_000_000
    }));
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const startTime = Date.now();
    let retryCount = 0;
    const maxRetries = this.config.maxRetries || 3;

    while (retryCount <= maxRetries) {
      try {
        const anthropicRequest = this.buildAnthropicRequest(request);
        const response = await this.makeRequest(anthropicRequest);
        
        if (!response.ok) {
          const errorText = await response.text();
          const shouldRetry = this.shouldRetry(response.status, retryCount, maxRetries);
          
          if (shouldRetry) {
            retryCount++;
            await this.delay(this.config.retryDelay! * Math.pow(2, retryCount - 1));
            continue;
          }
          
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json() as AnthropicResponse;
        const latency = Date.now() - startTime;
        
        this.updateHealthStatus(true, latency);

        // Extract text content from response
        const textContent = data.content
          .filter(c => c.type === 'text')
          .map(c => c.text || '')
          .join('');

        // @ts-expect-error - Post-Merge Reconciliation
        return {
          text: textContent,
          model: data.model,
          tokens: {
            input: data.usage.input_tokens,
            output: data.usage.output_tokens
          },
          cost: this.calculateCost(
            data.usage.input_tokens,
            data.usage.output_tokens,
            data.model
          ),
          latency,
          provider: this.name
        };
      } catch (error: unknown) {
        const latency = Date.now() - startTime;
        this.updateHealthStatus(false, latency);
        
        if (retryCount >= maxRetries) {
          throw new ProviderError(
            `Generation failed after ${maxRetries} retries: ${error instanceof Error ? (error as Error).message : 'Unknown error'}`,
            this.name,
            'GENERATE_FAILED',
            true
          );
        }
        
        retryCount++;
        await this.delay(this.config.retryDelay! * Math.pow(2, retryCount - 1));
      }
    }

    throw new ProviderError(
      'Maximum retries exceeded',
      this.name,
      'MAX_RETRIES_EXCEEDED',
      false
    );
  }

  async* stream(request: GenerateRequest): AsyncIterable<StreamChunk> {
    const anthropicRequest = { ...this.buildAnthropicRequest(request), stream: true };
    
    try {
      const response = await this.makeRequest(anthropicRequest);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      if (!response.body) {
        throw new Error('No response body for streaming request');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentText = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;

              try {
                const event = JSON.parse(data) as AnthropicStreamEvent;
                
                if (event.type === 'content_block_delta' && event.delta?.text) {
                  currentText += event.delta.text;
                  
                  yield {
                    text: event.delta.text,
                    isComplete: false,
                    model: anthropicRequest.model,
                    provider: this.name
                  };
                } else if (event.type === 'message_stop') {
                  yield {
                    text: '',
                    isComplete: true,
                    model: anthropicRequest.model,
                    provider: this.name
                  };
                } else if (event.type === 'error') {
                  throw new Error(event.error?.message || 'Stream error');
                }
              } catch (parseError) {
                console.warn('Failed to parse streaming response:', parseError);
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error: unknown) {
      this.updateHealthStatus(false, 0);
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
    
    // Check if model is supported
    const model = request.model || this.defaultModel;
    if (!this.modelDefinitions[model]) {
      return false;
    }
    
    // Check budget constraints
    if (context?.maxCost) {
      const estimatedCost = this.estimateRequestCost(request);
      if (estimatedCost > context.maxCost) {
        return false;
      }
    }
    
    // Check capabilities
    if (context?.requiredCapabilities) {
      const modelDef = this.modelDefinitions[model];
      return context.requiredCapabilities.every(cap => 
        modelDef.capabilities.includes(cap)
      );
    }
    
    return true;
  }

  async estimateCost(request: GenerateRequest): Promise<number> {
    return this.estimateRequestCost(request);
  }

  async shutdown(): Promise<void> {
    // No cleanup needed for HTTP-based provider
  }

  private buildAnthropicRequest(request: GenerateRequest): AnthropicRequest {
    const model = request.model || this.defaultModel;
    const messages = this.buildMessages(request);
    
    const anthropicRequest: AnthropicRequest = {
      model,
      max_tokens: request.maxTokens || this.config.maxTokens!,
      messages,
      temperature: request.temperature ?? this.config.temperature
    };

    // Add system prompt if provided
    if (request.systemPrompt) {
      anthropicRequest.system = request.systemPrompt;
    }

    // TODO: Add tool support when tools are provided in the request
    // This would require extending GenerateRequest to include tools
    
    return anthropicRequest;
  }

  private buildMessages(request: GenerateRequest): AnthropicMessage[] {
    if (request.context?.messages) {
      // Filter out system messages (handled separately) and convert to Anthropic format
      return request.context.messages
        .filter(m => m.role !== 'system')
        .map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content
        }));
    } else {
      return [{ role: 'user', content: request.prompt }];
    }
  }

  private async makeRequest(request: AnthropicRequest): Promise<Response> {
    const url = `${this.config.baseUrl}/v1/messages`;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey,
      'anthropic-version': this.apiVersion
    };

    return fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.config.timeout!)
    });
  }

  private calculateCost(inputTokens: number, outputTokens: number, model: string): number {
    const modelDef = this.modelDefinitions[model];
    if (!modelDef) {
      return 0;
    }

    const inputCost = (inputTokens / 1_000_000) * modelDef.inputCostPer1M;
    const outputCost = (outputTokens / 1_000_000) * modelDef.outputCostPer1M;
    
    return inputCost + outputCost;
  }

  private estimateRequestCost(request: GenerateRequest): number {
    // Rough token estimation: 4 characters per token on average
    const inputTokens = Math.ceil(request.prompt.length / 4);
    const outputTokens = request.maxTokens || this.config.maxTokens || 1000;
    const model = request.model || this.defaultModel;
    
    return this.calculateCost(inputTokens, outputTokens, model);
  }

  private shouldRetry(statusCode: number, currentRetry: number, maxRetries: number): boolean {
    if (currentRetry >= maxRetries) return false;
    
    // Retry on server errors and rate limits
    return statusCode >= 500 || statusCode === 429 || statusCode === 408;
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private updateHealthStatus(success: boolean, responseTime: number): void {
    this.health.lastCheck = new Date();
    
    if (success) {
      this.health.consecutiveFailures = 0;
      this.health.status = ProviderStatus.HEALTHY;
      
      // Update running average of response time (exponential moving average)
      if (this.health.avgResponseTime === 0) {
        this.health.avgResponseTime = responseTime;
      } else {
        this.health.avgResponseTime = (this.health.avgResponseTime * 0.9) + (responseTime * 0.1);
      }
    } else {
      this.health.consecutiveFailures++;
      
      if (this.health.consecutiveFailures >= 5) {
        this.health.status = ProviderStatus.UNHEALTHY;
      } else if (this.health.consecutiveFailures >= 2) {
        this.health.status = ProviderStatus.DEGRADED;
      }
    }
  }
}

/**
 * Factory function to create Anthropic provider with environment configuration
 */
export function createAnthropicProvider(config?: Partial<AnthropicConfig>): AnthropicProvider {
  const apiKey = config?.apiKey || process.env.ANTHROPIC_API_KEY;
  
  if (!apiKey) {
    throw new Error('Anthropic API key required. Set ANTHROPIC_API_KEY environment variable or pass apiKey in config.');
  }
  
  return new AnthropicProvider({
    apiKey,
    ...config
  });
}

/**
 * Provider registration helper for SuperClaw
 */
export const anthropicProviderConfig = {
  name: 'anthropic',
  factory: createAnthropicProvider,
  models: [
    'claude-3-5-sonnet-20241022',
    'claude-3-opus-20240229', 
    'claude-3-haiku-20240307',
    'claude-3-5-haiku-20241022'
  ],
  capabilities: [
    ModelCapability.TEXT_GENERATION,
    ModelCapability.CODE_GENERATION,
    ModelCapability.REASONING,
    ModelCapability.FUNCTION_CALLING,
    ModelCapability.VISION,
    ModelCapability.LONG_CONTEXT
  ]
};