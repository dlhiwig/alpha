// @ts-nocheck
/**
 * Mistral AI Provider Implementation
 * 
 * Provides access to Mistral's models including Mistral Large, Small,
 * and Codestral for European-compliant AI inference.
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

interface MistralMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
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

interface MistralFunction {
  name: string;
  description?: string;
  parameters?: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

interface MistralTool {
  type: 'function';
  function: MistralFunction;
}

interface MistralChatRequest {
  model: string;
  messages: MistralMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  random_seed?: number;
  stream?: boolean;
  safe_prompt?: boolean;
  tools?: MistralTool[];
  tool_choice?: 'none' | 'auto' | 'any' | { type: 'function'; function: { name: string } };
  response_format?: { type: 'text' | 'json_object' };
}

interface MistralChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'model_length';
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface MistralStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
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
    finish_reason?: 'stop' | 'length' | 'tool_calls' | 'model_length';
  }>;
}

// @ts-expect-error - Post-Merge Reconciliation
export class MistralProvider implements ILLMProvider {
  public readonly name = 'mistral';
  public readonly type = ProviderType.CLOUD;
  public readonly priority = 4; // Mid-tier priority
  public readonly defaultModel = 'mistral-large-latest';
  
  private readonly apiKey: string;
  private readonly baseUrl: string = 'https://api.mistral.ai/v1';
  private readonly timeoutMs: number;
  private health: ProviderHealth;
  
  // Available models with capabilities
  private readonly availableModels: Model[] = [
    {
      name: 'mistral-large-latest',
      displayName: 'Mistral Large',
      contextLength: 32768,
      capabilities: [
        ModelCapability.TEXT_GENERATION,
        ModelCapability.REASONING,
        ModelCapability.FUNCTION_CALLING,
        ModelCapability.LONG_CONTEXT
      ],
      costPerInputToken: 0.000004, // $4 per 1M input tokens
      costPerOutputToken: 0.000012 // $12 per 1M output tokens
    },
    {
      name: 'mistral-small-latest',
      displayName: 'Mistral Small',
      contextLength: 32768,
      capabilities: [
        ModelCapability.TEXT_GENERATION,
        ModelCapability.REASONING
      ],
      costPerInputToken: 0.000002, // $2 per 1M input tokens
      costPerOutputToken: 0.000006 // $6 per 1M output tokens
    },
    {
      name: 'codestral-latest',
      displayName: 'Codestral',
      contextLength: 32768,
      capabilities: [
        ModelCapability.TEXT_GENERATION,
        ModelCapability.CODE_GENERATION
      ],
      costPerInputToken: 0.000001, // $1 per 1M input tokens
      costPerOutputToken: 0.000003 // $3 per 1M output tokens
    },
    {
      name: 'mistral-medium-latest',
      displayName: 'Mistral Medium',
      contextLength: 32768,
      capabilities: [
        ModelCapability.TEXT_GENERATION,
        ModelCapability.REASONING
      ],
      costPerInputToken: 0.0000027, // $2.70 per 1M input tokens
      costPerOutputToken: 0.0000081 // $8.10 per 1M output tokens
    },
    {
      name: 'open-mistral-7b',
      displayName: 'Open Mistral 7B',
      contextLength: 32768,
      capabilities: [
        ModelCapability.TEXT_GENERATION
      ],
      costPerInputToken: 0.00000025, // $0.25 per 1M input tokens
      costPerOutputToken: 0.00000025 // $0.25 per 1M output tokens
    },
    {
      name: 'open-mixtral-8x7b',
      displayName: 'Open Mixtral 8x7B',
      contextLength: 32768,
      capabilities: [
        ModelCapability.TEXT_GENERATION,
        ModelCapability.REASONING
      ],
      costPerInputToken: 0.0000007, // $0.70 per 1M input tokens
      costPerOutputToken: 0.0000007 // $0.70 per 1M output tokens
    },
    {
      name: 'open-mixtral-8x22b',
      displayName: 'Open Mixtral 8x22B',
      contextLength: 65536,
      capabilities: [
        ModelCapability.TEXT_GENERATION,
        ModelCapability.REASONING,
        ModelCapability.LONG_CONTEXT
      ],
      costPerInputToken: 0.000002, // $2 per 1M input tokens
      costPerOutputToken: 0.000006 // $6 per 1M output tokens
    }
  ];
  
  constructor(apiKey?: string, timeoutMs: number = 30000) {
    this.apiKey = apiKey || process.env.MISTRAL_API_KEY || '';
    this.timeoutMs = timeoutMs;
    
    if (!this.apiKey) {
      throw new ProviderError('MISTRAL_API_KEY is required', this.name, 'auth', false);
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
          `Failed to initialize Mistral: ${response.status} ${response.statusText}`,
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
        `Failed to initialize Mistral: ${error instanceof Error ? (error).message : 'Unknown error'}`,
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
        signal: AbortSignal.timeout(5000)
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
      // Convert SuperClaw request to Mistral format
      const messages: MistralMessage[] = [];
      
      // Add system prompt if provided
      if (request.systemPrompt) {
        messages.push({
          role: 'system',
          content: request.systemPrompt
        });
      }
      
      // Add context messages if available
      if (request.context?.messages) {
        messages.push(...request.context.messages.map(msg => {
          const baseMsg: MistralMessage = {
            role: msg.role as 'system' | 'user' | 'assistant',
            content: msg.content
          };
          
          // Handle tool calls from metadata
          if (msg.role === 'assistant' && request.context?.metadata?.tool_calls) {
            baseMsg.tool_calls = request.context.metadata.tool_calls;
          }
          
          // Handle tool response messages (check if message has tool metadata)
          const msgWithTool = msg;
          if (msgWithTool.tool_call_id && msgWithTool.name) {
            baseMsg.role = 'tool';
            baseMsg.tool_call_id = msgWithTool.tool_call_id;
            baseMsg.name = msgWithTool.name;
          }
          
          return baseMsg;
        }));
      }
      
      // Add current prompt
      messages.push({
        role: 'user',
        content: request.prompt
      });
      
      const mistralRequest: MistralChatRequest = {
        model,
        messages,
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature || 0.7,
        stream: false
      };
      
      // Add function calling support if available in context
      if (request.context?.metadata?.tools) {
        mistralRequest.tools = request.context.metadata.tools;
        mistralRequest.tool_choice = request.context.metadata.tool_choice || 'auto';
      }
      
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'SuperClaw/1.0'
        },
        body: JSON.stringify(mistralRequest),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new ProviderError(
          `Mistral API error: ${response.status} - ${errorText}`,
          this.name,
          response.status.toString(),
          response.status >= 500 || response.status === 429
        );
      }
      
      const data = await response.json() as MistralChatResponse;
      const latency = Date.now() - startTime;
      
      // Update health metrics
      this.health.avgResponseTime = (this.health.avgResponseTime * 0.9) + (latency * 0.1);
      this.health.consecutiveFailures = 0;
      
      // Calculate cost
      const inputTokens = data.usage.prompt_tokens;
      const outputTokens = data.usage.completion_tokens;
      const modelInfo = this.availableModels.find(m => m.name === model);
      const cost = modelInfo ? 
        (inputTokens * modelInfo.costPerInputToken!) + (outputTokens * modelInfo.costPerOutputToken!) : 0;
      
      // Handle function calls and regular responses
      let responseText = data.choices[0]?.message?.content || '';
      if (data.choices[0]?.message?.tool_calls) {
        responseText = JSON.stringify({
          tool_calls: data.choices[0].message.tool_calls
        });
      }
      
      // @ts-expect-error - Post-Merge Reconciliation
      return {
        text: responseText,
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
        `Mistral generation failed: ${message}`,
        this.name,
        isTimeout ? 'timeout' : 'unknown',
        true
      );
    }
  }
  
  async *stream(request: GenerateRequest): AsyncIterable<StreamChunk> {
    const model = request.model || this.defaultModel;
    
    try {
      // Convert SuperClaw request to Mistral format
      const messages: MistralMessage[] = [];
      
      // Add system prompt if provided
      if (request.systemPrompt) {
        messages.push({
          role: 'system',
          content: request.systemPrompt
        });
      }
      
      // Add context messages if available
      if (request.context?.messages) {
        messages.push(...request.context.messages.map(msg => {
          const baseMsg: MistralMessage = {
            role: msg.role as 'system' | 'user' | 'assistant',
            content: msg.content
          };
          
          // Handle tool calls from metadata
          if (msg.role === 'assistant' && request.context?.metadata?.tool_calls) {
            baseMsg.tool_calls = request.context.metadata.tool_calls;
          }
          
          // Handle tool response messages (check if message has tool metadata)
          const msgWithTool = msg;
          if (msgWithTool.tool_call_id && msgWithTool.name) {
            baseMsg.role = 'tool';
            baseMsg.tool_call_id = msgWithTool.tool_call_id;
            baseMsg.name = msgWithTool.name;
          }
          
          return baseMsg;
        }));
      }
      
      // Add current prompt
      messages.push({
        role: 'user',
        content: request.prompt
      });
      
      const mistralRequest: MistralChatRequest = {
        model,
        messages,
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature || 0.7,
        stream: true
      };
      
      // Add function calling support if available in context
      if (request.context?.metadata?.tools) {
        mistralRequest.tools = request.context.metadata.tools;
        mistralRequest.tool_choice = request.context.metadata.tool_choice || 'auto';
      }
      
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'SuperClaw/1.0'
        },
        body: JSON.stringify(mistralRequest),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new ProviderError(
          `Mistral streaming error: ${response.status} - ${errorText}`,
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
                const chunk = JSON.parse(jsonStr) as MistralStreamChunk;
                const content = chunk.choices[0]?.delta?.content || '';
                const finishReason = chunk.choices[0]?.finish_reason;
                const delta = chunk.choices[0]?.delta;
                
                // Handle regular content
                if (content) {
                  yield {
                    text: content,
                    isComplete: false,
                    model,
                    provider: this.name
                  };
                }
                
                // Handle function calls in streaming
                if (delta?.tool_calls) {
                  yield {
                    text: JSON.stringify({ tool_calls: delta.tool_calls }),
                    isComplete: false,
                    model,
                    provider: this.name
                  };
                }
                
                // Handle completion
                if (finishReason) {
                  yield {
                    text: '',
                    isComplete: finishReason === 'stop' || finishReason === 'length' || finishReason === 'tool_calls',
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
        `Mistral streaming failed: ${message}`,
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
    // Mistral doesn't require explicit cleanup
  }
}

/**
 * Factory function to create a Mistral provider
 */
export function createMistralProvider(apiKey?: string): MistralProvider {
  return new MistralProvider(apiKey);
}