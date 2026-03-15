/**
 * OpenAI Provider for SuperClaw
 * 
 * Full-featured OpenAI API integration with GPT models
 * Supports streaming, function calling, and comprehensive cost tracking
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

// OpenAI API types
interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'function' | 'tool';
  content: string | null;
  name?: string;
  function_call?: {
    name: string;
    arguments: string;
  };
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
}

interface OpenAIFunction {
  name: string;
  description?: string;
  parameters?: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

interface OpenAITool {
  type: 'function';
  function: OpenAIFunction;
}

interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stream?: boolean;
  functions?: OpenAIFunction[];
  function_call?: 'none' | 'auto' | { name: string };
  tools?: OpenAITool[];
  tool_choice?: 'none' | 'auto' | { type: 'function'; function: { name: string } };
  response_format?: { type: 'text' | 'json_object' };
}

interface OpenAIChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      function_call?: {
        name: string;
        arguments: string;
      };
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason: 'stop' | 'length' | 'function_call' | 'tool_calls' | 'content_filter';
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
      function_call?: {
        name?: string;
        arguments?: string;
      };
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: 'stop' | 'length' | 'function_call' | 'tool_calls' | 'content_filter';
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenAIConfig {
  apiKey: string;
  baseUrl?: string;
  organization?: string;
  defaultModel?: string;
  maxRetries?: number;
  retryDelay?: number;
  timeout?: number;
}

// @ts-expect-error - Post-Merge Reconciliation
export class OpenAIProvider implements ILLMProvider {
  public readonly name = 'openai';
  public readonly type = ProviderType.CLOUD;
  public readonly priority = 3;
  public readonly defaultModel = 'gpt-4o';
  
  private readonly config: Required<OpenAIConfig>;
  private health: ProviderHealth;

  // Comprehensive model definitions with latest GPT models
  private readonly availableModels: Model[] = [
    {
      name: 'gpt-4o',
      displayName: 'GPT-4o',
      contextLength: 128000,
      capabilities: [
        ModelCapability.TEXT_GENERATION,
        ModelCapability.CODE_GENERATION,
        ModelCapability.REASONING,
        ModelCapability.FUNCTION_CALLING,
        ModelCapability.VISION,
        ModelCapability.LONG_CONTEXT
      ],
      costPerInputToken: 2.50 / 1_000_000,
      costPerOutputToken: 10.00 / 1_000_000
    },
    {
      name: 'gpt-4o-mini',
      displayName: 'GPT-4o Mini',
      contextLength: 128000,
      capabilities: [
        ModelCapability.TEXT_GENERATION,
        ModelCapability.CODE_GENERATION,
        ModelCapability.REASONING,
        ModelCapability.FUNCTION_CALLING,
        ModelCapability.VISION,
        ModelCapability.LONG_CONTEXT
      ],
      costPerInputToken: 0.15 / 1_000_000,
      costPerOutputToken: 0.60 / 1_000_000
    },
    {
      name: 'gpt-4-turbo',
      displayName: 'GPT-4 Turbo',
      contextLength: 128000,
      capabilities: [
        ModelCapability.TEXT_GENERATION,
        ModelCapability.CODE_GENERATION,
        ModelCapability.REASONING,
        ModelCapability.FUNCTION_CALLING,
        ModelCapability.VISION,
        ModelCapability.LONG_CONTEXT
      ],
      costPerInputToken: 10.00 / 1_000_000,
      costPerOutputToken: 30.00 / 1_000_000
    },
    {
      name: 'gpt-4',
      displayName: 'GPT-4',
      contextLength: 8192,
      capabilities: [
        ModelCapability.TEXT_GENERATION,
        ModelCapability.CODE_GENERATION,
        ModelCapability.REASONING,
        ModelCapability.FUNCTION_CALLING
      ],
      costPerInputToken: 30.00 / 1_000_000,
      costPerOutputToken: 60.00 / 1_000_000
    },
    {
      name: 'gpt-3.5-turbo',
      displayName: 'GPT-3.5 Turbo',
      contextLength: 16385,
      capabilities: [
        ModelCapability.TEXT_GENERATION,
        ModelCapability.CODE_GENERATION,
        ModelCapability.FUNCTION_CALLING
      ],
      costPerInputToken: 0.50 / 1_000_000,
      costPerOutputToken: 1.50 / 1_000_000
    },
    {
      name: 'o1',
      displayName: 'o1',
      contextLength: 200000,
      capabilities: [
        ModelCapability.TEXT_GENERATION,
        ModelCapability.CODE_GENERATION,
        ModelCapability.REASONING,
        ModelCapability.LONG_CONTEXT
      ],
      costPerInputToken: 15.00 / 1_000_000,
      costPerOutputToken: 60.00 / 1_000_000
    },
    {
      name: 'o1-mini',
      displayName: 'o1 Mini',
      contextLength: 200000,
      capabilities: [
        ModelCapability.TEXT_GENERATION,
        ModelCapability.CODE_GENERATION,
        ModelCapability.REASONING,
        ModelCapability.LONG_CONTEXT
      ],
      costPerInputToken: 3.00 / 1_000_000,
      costPerOutputToken: 12.00 / 1_000_000
    }
  ];

  constructor(config: OpenAIConfig) {
    this.config = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl || 'https://api.openai.com/v1',
      organization: config.organization || '',
      defaultModel: config.defaultModel || 'gpt-4o',
      maxRetries: config.maxRetries || 3,
      retryDelay: config.retryDelay || 1000,
      timeout: config.timeout || 60000
    };

    if (!this.config.apiKey) {
      throw new ProviderError(
        'OpenAI API key is required',
        this.name,
        'MISSING_API_KEY',
        false
      );
    }

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
    try {
      // Test connection by listing models
      const response = await this.makeRequest('GET', '/models');
      
      if (!response.ok) {
        throw new ProviderError(
          `OpenAI API authentication failed: ${response.status}`,
          this.name,
          'AUTH_FAILED',
          false
        );
      }

      this.updateHealthStatus(true, 0);
    } catch (error: unknown) {
      this.updateHealthStatus(false, 0);
      
      if (error instanceof ProviderError) {
        throw error;
      }
      
      throw new ProviderError(
        `Failed to initialize OpenAI provider: ${error instanceof Error ? (error).message : 'Unknown error'}`,
        this.name,
        'INIT_FAILED',
        true
      );
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const startTime = Date.now();
      const response = await this.makeRequest('GET', '/models');
      const responseTime = Date.now() - startTime;
      
      const healthy = response.ok;
      this.updateHealthStatus(healthy, responseTime);
      return healthy;
    } catch {
      this.updateHealthStatus(false, 0);
      return false;
    }
  }

  async getHealth(): Promise<ProviderHealth> {
    await this.isHealthy();
    return { ...this.health };
  }

  async getModels(): Promise<Model[]> {
    return [...this.availableModels];
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const startTime = Date.now();
    const model = request.model || this.defaultModel;
    
    let lastError: Error | null = null;
    
    // Retry logic with exponential backoff
    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        const openaiRequest = await this.buildOpenAIRequest(request, model, false);
        const response = await this.makeRequest('POST', '/chat/completions', openaiRequest);
        
        if (!response.ok) {
          const errorText = await response.text();
          const isRetryable = response.status >= 500 || response.status === 429;
          
          if (!isRetryable || attempt === this.config.maxRetries) {
            throw new ProviderError(
              `OpenAI API error: ${response.status} - ${errorText}`,
              this.name,
              response.status.toString(),
              isRetryable
            );
          }
          
          lastError = new Error(`HTTP ${response.status}: ${errorText}`);
          await this.delay(this.config.retryDelay * Math.pow(2, attempt - 1));
          continue;
        }

        const data = await response.json() as OpenAIChatResponse;
        const responseTime = Date.now() - startTime;
        
        this.updateHealthStatus(true, responseTime);

        const choice = data.choices[0];
        if (!choice) {
          throw new ProviderError(
            'No response choices returned from OpenAI',
            this.name,
            'NO_CHOICES',
            true
          );
        }

        // Handle function calls
        let responseText = choice.message.content || '';
        if (choice.message.function_call || choice.message.tool_calls) {
          responseText = JSON.stringify({
            function_call: choice.message.function_call,
            tool_calls: choice.message.tool_calls
          });
        }

        // @ts-expect-error - Post-Merge Reconciliation
        return {
          text: responseText,
          model: data.model,
          tokens: {
            input: data.usage.prompt_tokens,
            output: data.usage.completion_tokens
          },
          cost: this.calculateCost(
            data.usage.prompt_tokens,
            data.usage.completion_tokens,
            data.model
          ),
          latency: responseTime,
          provider: this.name
        };
        
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        
        if (error instanceof ProviderError && !error.retryable) {
          throw error;
        }
        
        if (attempt === this.config.maxRetries) {
          break;
        }
        
        await this.delay(this.config.retryDelay * Math.pow(2, attempt - 1));
      }
    }
    
    this.updateHealthStatus(false, Date.now() - startTime);
    
    throw new ProviderError(
      `OpenAI request failed after ${this.config.maxRetries} attempts: ${lastError?.message}`,
      this.name,
      'MAX_RETRIES_EXCEEDED',
      true
    );
  }

  async *stream(request: GenerateRequest): AsyncIterable<StreamChunk> {
    const model = request.model || this.defaultModel;
    
    try {
      const openaiRequest = await this.buildOpenAIRequest(request, model, true);
      const response = await this.makeRequest('POST', '/chat/completions', openaiRequest);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new ProviderError(
          `OpenAI streaming error: ${response.status} - ${errorText}`,
          this.name,
          response.status.toString(),
          response.status >= 500 || response.status === 429
        );
      }
      
      const reader = response.body?.getReader();
      if (!reader) {
        throw new ProviderError(
          'No response body available for streaming',
          this.name,
          'NO_STREAM_BODY',
          true
        );
      }
      
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedContent = '';
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {break;}
          
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          
          for (const line of lines) {
            const trimmedLine = line.trim();
            
            if (!trimmedLine || trimmedLine === 'data: [DONE]') {
              continue;
            }
            
            if (trimmedLine.startsWith('data: ')) {
              try {
                const jsonData = trimmedLine.substring(6);
                const chunk = JSON.parse(jsonData) as OpenAIStreamChunk;
                
                const delta = chunk.choices[0]?.delta;
                if (delta?.content) {
                  accumulatedContent += delta.content;
                  
                  yield {
                    text: delta.content,
                    isComplete: false,
                    model: chunk.model,
                    provider: this.name
                  };
                }
                
                // Handle function calls in streaming
                if (delta?.function_call || delta?.tool_calls) {
                  const functionData = {
                    function_call: delta.function_call,
                    tool_calls: delta.tool_calls
                  };
                  
                  yield {
                    text: JSON.stringify(functionData),
                    isComplete: false,
                    model: chunk.model,
                    provider: this.name
                  };
                }
                
                if (chunk.choices[0]?.finish_reason) {
                  yield {
                    text: '',
                    isComplete: true,
                    model: chunk.model,
                    provider: this.name
                  };
                  break;
                }
              } catch (parseError) {
                // Ignore malformed JSON in stream
                continue;
              }
            }
          }
        }
        
        this.updateHealthStatus(true, 0);
        
      } finally {
        reader.releaseLock();
      }
      
    } catch (error: unknown) {
      this.updateHealthStatus(false, 0);
      
      if (error instanceof ProviderError) {
        throw error;
      }
      
      throw new ProviderError(
        `OpenAI streaming failed: ${error instanceof Error ? (error).message : 'Unknown error'}`,
        this.name,
        'STREAM_FAILED',
        true
      );
    }
  }

  canHandle(request: GenerateRequest, context?: RoutingContext): boolean {
    // Check API key availability
    if (!this.config.apiKey) {
      return false;
    }
    
    // Check if model exists
    const model = request.model || this.defaultModel;
    if (!this.availableModels.some(m => m.name === model)) {
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
      const modelInfo = this.availableModels.find(m => m.name === model);
      if (!modelInfo) {return false;}
      
      return context.requiredCapabilities.every(cap => 
        modelInfo.capabilities.includes(cap)
      );
    }
    
    // Check health status
    if (this.health.status === ProviderStatus.UNHEALTHY) {
      return false;
    }
    
    return true;
  }

  async estimateCost(request: GenerateRequest): Promise<number> {
    return this.estimateRequestCost(request);
  }

  async shutdown(): Promise<void> {
    // No persistent connections to close
  }

  private async buildOpenAIRequest(
    request: GenerateRequest,
    model: string,
    stream: boolean
  ): Promise<OpenAIChatRequest> {
    const messages: OpenAIMessage[] = [];
    
    // Add system prompt
    if (request.systemPrompt) {
      messages.push({
        role: 'system',
        content: request.systemPrompt
      });
    }
    
    // Add conversation context
    if (request.context?.messages) {
      messages.push(...request.context.messages.map(msg => ({
        role: msg.role as 'system' | 'user' | 'assistant',
        content: msg.content
      })));
    }
    
    // Add current prompt
    messages.push({
      role: 'user',
      content: request.prompt
    });
    
    const openaiRequest: OpenAIChatRequest = {
      model,
      messages,
      max_tokens: request.maxTokens || 4096,
      temperature: request.temperature ?? 0.7,
      stream
    };
    
    // Add function calling support if available in context
    if (request.context?.metadata?.functions) {
      openaiRequest.functions = request.context.metadata.functions;
      openaiRequest.function_call = request.context.metadata.function_call || 'auto';
    }
    
    if (request.context?.metadata?.tools) {
      openaiRequest.tools = request.context.metadata.tools;
      openaiRequest.tool_choice = request.context.metadata.tool_choice || 'auto';
    }
    
    return openaiRequest;
  }

  private async makeRequest(
    method: 'GET' | 'POST',
    endpoint: string,
    body?: any
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.config.apiKey}`,
      'User-Agent': 'SuperClaw/1.0'
    };
    
    if (this.config.organization) {
      headers['OpenAI-Organization'] = this.config.organization;
    }
    
    if (method === 'POST') {
      headers['Content-Type'] = 'application/json';
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
    
    try {
      const response = await fetch(`${this.config.baseUrl}${endpoint}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private calculateCost(inputTokens: number, outputTokens: number, model: string): number {
    const modelInfo = this.availableModels.find(m => m.name === model);
    if (!modelInfo) {
      // Fallback to GPT-4o pricing
      return (inputTokens * 2.50 + outputTokens * 10.00) / 1_000_000;
    }
    
    return (
      inputTokens * (modelInfo.costPerInputToken || 0) +
      outputTokens * (modelInfo.costPerOutputToken || 0)
    );
  }

  private estimateRequestCost(request: GenerateRequest): number {
    // Rough token estimation: 1 token ≈ 4 characters
    const inputTokens = Math.ceil((request.prompt.length + (request.systemPrompt?.length || 0)) / 4);
    const outputTokens = request.maxTokens || 1000;
    const model = request.model || this.defaultModel;
    
    return this.calculateCost(inputTokens, outputTokens, model);
  }

  private updateHealthStatus(success: boolean, responseTime: number): void {
    this.health.lastCheck = new Date();
    
    if (success) {
      this.health.consecutiveFailures = 0;
      this.health.status = ProviderStatus.HEALTHY;
      
      if (responseTime > 0) {
        // Update running average of response time (exponential moving average)
        this.health.avgResponseTime = 
          this.health.avgResponseTime === 0 
            ? responseTime 
            : (this.health.avgResponseTime * 0.9) + (responseTime * 0.1);
      }
    } else {
      this.health.consecutiveFailures++;
      
      if (this.health.consecutiveFailures >= 5) {
        this.health.status = ProviderStatus.UNHEALTHY;
      } else if (this.health.consecutiveFailures >= 3) {
        this.health.status = ProviderStatus.DEGRADED;
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Factory function to create OpenAI provider with environment variables
 */
export function createOpenAIProvider(config?: Partial<OpenAIConfig>): OpenAIProvider {
  const apiKey = config?.apiKey || process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    throw new ProviderError(
      'OpenAI API key required. Set OPENAI_API_KEY environment variable or pass apiKey in config.',
      'openai',
      'MISSING_API_KEY',
      false
    );
  }
  
  return new OpenAIProvider({
    apiKey,
    ...config
  });
}