/**
 * Groq Provider Implementation
 * 
 * Ultra-fast inference using Groq's Language Processing Units (LPUs)
 * for extremely high-speed text generation with Llama and Mixtral models.
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

interface GroqMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface GroqChatRequest {
  messages: GroqMessage[];
  model: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
  stop?: string | string[];
}

interface GroqChatResponse {
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
    logprobs?: any;
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface GroqStreamChunk {
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
    logprobs?: any;
    finish_reason?: string;
  }>;
}

// @ts-expect-error - Post-Merge Reconciliation
export class GroqProvider implements ILLMProvider {
  public readonly name = 'groq';
  public readonly type = ProviderType.CLOUD;
  public readonly priority = 2; // High priority for speed
  public readonly defaultModel = 'llama3-70b-8192';
  
  private readonly apiKey: string;
  private readonly baseUrl: string = 'https://api.groq.com/openai/v1';
  private readonly timeoutMs: number;
  private health: ProviderHealth;
  
  // Available models with capabilities (Groq specializes in speed)
  private readonly availableModels: Model[] = [
    {
      name: 'llama3-70b-8192',
      displayName: 'Llama 3 70B',
      contextLength: 8192,
      capabilities: [
        ModelCapability.TEXT_GENERATION,
        ModelCapability.REASONING
      ],
      costPerInputToken: 0.00000059, // $0.59 per 1M input tokens
      costPerOutputToken: 0.00000079 // $0.79 per 1M output tokens
    },
    {
      name: 'llama3-8b-8192',
      displayName: 'Llama 3 8B',
      contextLength: 8192,
      capabilities: [
        ModelCapability.TEXT_GENERATION
      ],
      costPerInputToken: 0.00000005, // $0.05 per 1M input tokens
      costPerOutputToken: 0.00000008 // $0.08 per 1M output tokens
    },
    {
      name: 'mixtral-8x7b-32768',
      displayName: 'Mixtral 8x7B',
      contextLength: 32768,
      capabilities: [
        ModelCapability.TEXT_GENERATION,
        ModelCapability.REASONING,
        ModelCapability.LONG_CONTEXT
      ],
      costPerInputToken: 0.00000024, // $0.24 per 1M input tokens
      costPerOutputToken: 0.00000024 // $0.24 per 1M output tokens
    },
    {
      name: 'gemma-7b-it',
      displayName: 'Gemma 7B IT',
      contextLength: 8192,
      capabilities: [
        ModelCapability.TEXT_GENERATION
      ],
      costPerInputToken: 0.00000007, // $0.07 per 1M input tokens
      costPerOutputToken: 0.00000007 // $0.07 per 1M output tokens
    },
    {
      name: 'llama2-70b-4096',
      displayName: 'Llama 2 70B',
      contextLength: 4096,
      capabilities: [
        ModelCapability.TEXT_GENERATION,
        ModelCapability.REASONING
      ],
      costPerInputToken: 0.00000070, // $0.70 per 1M input tokens
      costPerOutputToken: 0.00000080 // $0.80 per 1M output tokens
    }
  ];
  
  constructor(apiKey?: string, timeoutMs: number = 10000) {
    this.apiKey = apiKey || process.env.GROQ_API_KEY || '';
    this.timeoutMs = timeoutMs; // Shorter timeout for Groq due to speed
    
    if (!this.apiKey) {
      throw new ProviderError('GROQ_API_KEY is required', this.name, 'auth', false);
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
    // Test the connection by listing models
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'User-Agent': 'SuperClaw/1.0'
        },
        signal: AbortSignal.timeout(5000)
      });
      
      if (!response.ok) {
        throw new ProviderError(
          `Failed to initialize Groq: ${response.status} ${response.statusText}`,
          this.name,
          'auth',
          false
        );
      }
      
      this.health.status = ProviderStatus.HEALTHY;
    } catch (error: unknown) {
      this.health.status = ProviderStatus.UNHEALTHY;
      this.health.consecutiveFailures++;
      
      if (error instanceof ProviderError) {
        throw error;
      }
      
      throw new ProviderError(
        `Failed to initialize Groq: ${error instanceof Error ? (error).message : 'Unknown error'}`,
        this.name,
        'connection',
        true
      );
    }
  }
  
  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'User-Agent': 'SuperClaw/1.0'
        },
        signal: AbortSignal.timeout(3000)
      });
      
      const healthy = response.ok;
      this.health.status = healthy ? ProviderStatus.HEALTHY : ProviderStatus.UNHEALTHY;
      this.health.lastCheck = new Date();
      
      if (healthy) {
        this.health.consecutiveFailures = 0;
      } else {
        this.health.consecutiveFailures++;
      }
      
      return healthy;
    } catch {
      this.health.status = ProviderStatus.UNHEALTHY;
      this.health.lastCheck = new Date();
      this.health.consecutiveFailures++;
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
    
    try {
      // Convert SuperClaw request to Groq format
      const messages: GroqMessage[] = [];
      
      // Add system prompt if provided
      if (request.systemPrompt) {
        messages.push({
          role: 'system',
          content: request.systemPrompt
        });
      }
      
      // Add context messages if available
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
      
      const groqRequest: GroqChatRequest = {
        model,
        messages,
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature || 1.0,
        stream: false
      };
      
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'SuperClaw/1.0'
        },
        body: JSON.stringify(groqRequest),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new ProviderError(
          `Groq API error: ${response.status} - ${errorText}`,
          this.name,
          response.status.toString(),
          response.status >= 500 || response.status === 429
        );
      }
      
      const data = await response.json() as GroqChatResponse;
      const latency = Date.now() - startTime;
      
      // Update health metrics (Groq is typically very fast)
      this.health.avgResponseTime = (this.health.avgResponseTime * 0.9) + (latency * 0.1);
      this.health.consecutiveFailures = 0;
      
      // Calculate cost
      const inputTokens = data.usage.prompt_tokens;
      const outputTokens = data.usage.completion_tokens;
      const modelInfo = this.availableModels.find(m => m.name === model);
      const cost = modelInfo ? 
        (inputTokens * modelInfo.costPerInputToken!) + (outputTokens * modelInfo.costPerOutputToken!) : 0;
      
      // @ts-expect-error - Post-Merge Reconciliation
      return {
        text: data.choices[0]?.message?.content || '',
        model,
        tokens: {
          input: inputTokens,
          output: outputTokens
        },
        cost,
        latency,
        provider: this.name,
        cached: false
      };
      
    } catch (error: unknown) {
      this.health.consecutiveFailures++;
      this.health.errorRate = Math.min(100, this.health.errorRate + 1);
      
      if (error instanceof ProviderError) {
        throw error;
      }
      
      const message = error instanceof Error ? (error).message : 'Unknown error';
      const isTimeout = message.includes('timeout') || message.includes('AbortError');
      
      throw new ProviderError(
        `Groq generation failed: ${message}`,
        this.name,
        isTimeout ? 'timeout' : 'unknown',
        true
      );
    }
  }
  
  async *stream(request: GenerateRequest): AsyncIterable<StreamChunk> {
    const model = request.model || this.defaultModel;
    
    try {
      // Convert SuperClaw request to Groq format
      const messages: GroqMessage[] = [];
      
      // Add system prompt if provided
      if (request.systemPrompt) {
        messages.push({
          role: 'system',
          content: request.systemPrompt
        });
      }
      
      // Add context messages if available
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
      
      const groqRequest: GroqChatRequest = {
        model,
        messages,
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature || 1.0,
        stream: true
      };
      
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'SuperClaw/1.0'
        },
        body: JSON.stringify(groqRequest),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new ProviderError(
          `Groq streaming error: ${response.status} - ${errorText}`,
          this.name,
          response.status.toString(),
          response.status >= 500 || response.status === 429
        );
      }
      
      const reader = response.body?.getReader();
      if (!reader) {
        throw new ProviderError('No response body available for streaming', this.name);
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
            if (line.trim().startsWith('data: ')) {
              const jsonStr = line.slice(6).trim();
              if (jsonStr === '[DONE]') {
                yield {
                  text: '',
                  isComplete: true,
                  model,
                  provider: this.name
                };
                return;
              }
              
              try {
                const chunk = JSON.parse(jsonStr) as GroqStreamChunk;
                const content = chunk.choices[0]?.delta?.content || '';
                const finishReason = chunk.choices[0]?.finish_reason;
                
                if (content || finishReason) {
                  yield {
                    text: content,
                    isComplete: finishReason === 'stop' || finishReason === 'length',
                    model,
                    provider: this.name
                  };
                }
              } catch {
                // Skip malformed JSON chunks
                continue;
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
      
    } catch (error: unknown) {
      if (error instanceof ProviderError) {
        throw error;
      }
      
      const message = error instanceof Error ? (error).message : 'Unknown error';
      throw new ProviderError(
        `Groq streaming failed: ${message}`,
        this.name,
        'stream',
        true
      );
    }
  }
  
  canHandle(request: GenerateRequest, context?: RoutingContext): boolean {
    // Check if model is available
    const model = request.model || this.defaultModel;
    const modelExists = this.availableModels.some(m => m.name === model);
    
    if (!modelExists) {return false;}
    
    // Groq excels at speed - prioritize for real-time applications
    if (context?.priority === 'high') {
      return true;
    }
    
    // Check required capabilities
    if (context?.requiredCapabilities) {
      const modelInfo = this.availableModels.find(m => m.name === model);
      if (!modelInfo) {return false;}
      
      return context.requiredCapabilities.every(cap => 
        modelInfo.capabilities.includes(cap)
      );
    }
    
    return true;
  }
  
  async estimateCost(request: GenerateRequest): Promise<number> {
    const model = request.model || this.defaultModel;
    const modelInfo = this.availableModels.find(m => m.name === model);
    
    if (!modelInfo || !modelInfo.costPerInputToken || !modelInfo.costPerOutputToken) {
      return 0;
    }
    
    // Rough token estimation (4 chars per token)
    const inputTokens = Math.ceil(request.prompt.length / 4);
    const outputTokens = request.maxTokens || 1000;
    
    return (inputTokens * modelInfo.costPerInputToken) + (outputTokens * modelInfo.costPerOutputToken);
  }
  
  async shutdown(): Promise<void> {
    // Groq doesn't require explicit cleanup
  }
}

/**
 * Factory function to create a Groq provider
 */
export function createGroqProvider(apiKey?: string): GroqProvider {
  return new GroqProvider(apiKey);
}