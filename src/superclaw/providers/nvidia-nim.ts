/**
 * NVIDIA NIM Provider for SuperClaw Hivemind
 * 
 * NVIDIA NIM API integration with multiple high-capability models:
 * - moonshotai/kimi-k2.5 (1T MoE) - Default NIM model
 * - nvidia/nemotron-3-nano-30b-a3b (30B MoE) - 1M context, coding, tools
 * - z-ai/glm5 (744B MoE) - Long-horizon agentic
 * - nvidia/cosmos-reason2-8b (8B) - Physical world (video/image)
 * - qwen/qwen3.5-397b-a17b (400B MoE) - Vision + agentic
 * 
 * All models support streaming responses and cost tracking.
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

// NVIDIA NIM API response types (OpenAI-compatible)
interface NIMChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message?: {
      role: string;
      content?: string;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

// Model configuration for NVIDIA NIM
interface NIMModelConfig {
  name: string;
  displayName: string;
  contextLength: number;
  capabilities: ModelCapability[];
  inputCostPer1M: number;
  outputCostPer1M: number;
  maxTokens?: number;
}

export interface NVIDIANIMConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}

// @ts-expect-error - Post-Merge Reconciliation
export class NVIDIANIMProvider implements ILLMProvider {
  public readonly name = 'nvidia-nim';
  public readonly type = ProviderType.CLOUD;
  public readonly priority = 2; // High priority for powerful models
  public readonly defaultModel = 'moonshotai/kimi-k2.5';
  
  private config: NVIDIANIMConfig;
  private baseUrl: string;
  private health: ProviderHealth;
  private modelConfigs: Map<string, NIMModelConfig>;

  constructor(config: NVIDIANIMConfig) {
    this.config = {
      model: 'moonshotai/kimi-k2.5',
      maxTokens: 4096,
      temperature: 0.7,
      ...config
    };
    this.baseUrl = config.baseUrl || 'https://integrate.api.nvidia.com/v1';
    
    this.health = {
      status: ProviderStatus.HEALTHY,
      lastCheck: new Date(),
      consecutiveFailures: 0,
      avgResponseTime: 0,
      errorRate: 0,
      uptime: 100
    };

    // Initialize model configurations
    this.modelConfigs = new Map([
      ['moonshotai/kimi-k2.5', {
        name: 'moonshotai/kimi-k2.5',
        displayName: 'Kimi K2.5',
        contextLength: 200000, // 200K context
        capabilities: [
          ModelCapability.TEXT_GENERATION,
          ModelCapability.REASONING,
          ModelCapability.LONG_CONTEXT,
          ModelCapability.FUNCTION_CALLING
        ],
        inputCostPer1M: 0.60,
        outputCostPer1M: 3.00
      }],
      ['nvidia/nemotron-3-nano-30b-a3b', {
        name: 'nvidia/nemotron-3-nano-30b-a3b',
        displayName: 'Nemotron 3 Nano 30B',
        contextLength: 1000000, // 1M context
        capabilities: [
          ModelCapability.TEXT_GENERATION,
          ModelCapability.CODE_GENERATION,
          ModelCapability.REASONING,
          ModelCapability.LONG_CONTEXT,
          ModelCapability.FUNCTION_CALLING
        ],
        inputCostPer1M: 0.30,
        outputCostPer1M: 0.30,
        maxTokens: 8192
      }],
      ['z-ai/glm5', {
        name: 'z-ai/glm5',
        displayName: 'GLM-5',
        contextLength: 128000, // 128K context
        capabilities: [
          ModelCapability.TEXT_GENERATION,
          ModelCapability.REASONING,
          ModelCapability.LONG_CONTEXT,
          ModelCapability.FUNCTION_CALLING
        ],
        inputCostPer1M: 1.00,
        outputCostPer1M: 3.00
      }],
      ['nvidia/cosmos-reason2-8b', {
        name: 'nvidia/cosmos-reason2-8b',
        displayName: 'Cosmos Reason2 8B',
        contextLength: 64000, // 64K context
        capabilities: [
          ModelCapability.TEXT_GENERATION,
          ModelCapability.VISION,
          ModelCapability.REASONING
        ],
        inputCostPer1M: 0.15,
        outputCostPer1M: 0.60
      }],
      ['qwen/qwen3.5-397b-a17b', {
        name: 'qwen/qwen3.5-397b-a17b',
        displayName: 'Qwen 3.5 397B',
        contextLength: 128000, // 128K context
        capabilities: [
          ModelCapability.TEXT_GENERATION,
          ModelCapability.CODE_GENERATION,
          ModelCapability.VISION,
          ModelCapability.REASONING,
          ModelCapability.LONG_CONTEXT,
          ModelCapability.FUNCTION_CALLING
        ],
        inputCostPer1M: 2.00,
        outputCostPer1M: 6.00
      }]
    ]);
  }

  async initialize(): Promise<void> {
    if (!this.config.apiKey) {
      throw new ProviderError(
        'NVIDIA NIM API key required',
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
      // Test with a minimal request to the default model
      const response = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
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
    return Array.from(this.modelConfigs.values()).map(config => ({
      name: config.name,
      displayName: config.displayName,
      contextLength: config.contextLength,
      capabilities: config.capabilities,
      costPerInputToken: config.inputCostPer1M / 1_000_000,
      costPerOutputToken: config.outputCostPer1M / 1_000_000
    }));
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const startTime = Date.now();
    
    try {
      const model = request.model || this.defaultModel;
      const modelConfig = this.modelConfigs.get(model);
      if (!modelConfig) {
        throw new ProviderError(
          `Model ${model} not supported`,
          this.name,
          'UNSUPPORTED_MODEL',
          false
        );
      }

      const messages = this.buildMessages(request);
      const maxTokens = Math.min(
        request.maxTokens || this.config.maxTokens || 4096,
        modelConfig.maxTokens || 8192
      );
      
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: model,
          messages: messages,
          max_tokens: maxTokens,
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
        throw new Error(`NVIDIA NIM API Error ${response.status}: ${error}`);
      }

      const data = await response.json() as NIMChatResponse;
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
          model,
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
        `Generation failed: ${error instanceof Error ? (error).message : 'Unknown error'}`,
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
      const model = request.model || this.defaultModel;
      const modelConfig = this.modelConfigs.get(model);
      if (!modelConfig) {
        throw new ProviderError(
          `Model ${model} not supported`,
          this.name,
          'UNSUPPORTED_MODEL',
          false
        );
      }

      const messages = this.buildMessages(request);
      const maxTokens = Math.min(
        request.maxTokens || this.config.maxTokens || 4096,
        modelConfig.maxTokens || 8192
      );
      
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: model,
          messages: messages,
          max_tokens: maxTokens,
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
        throw new Error(`NVIDIA NIM Streaming API Error ${response.status}: ${error}`);
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
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta;
              
              if (delta?.content) {
                accumulatedText += delta.content;
                outputTokens++; // Rough estimate
                
                yield {
                  text: delta.content,
                  isComplete: false,
                  model: parsed.model || model,
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
        model: model,
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
    
    // Check if model is supported
    const model = request.model || this.defaultModel;
    if (!this.modelConfigs.has(model)) {
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
      const modelConfig = this.modelConfigs.get(model);
      if (!modelConfig) {return false;}
      
      return context.requiredCapabilities.every(cap => 
        modelConfig.capabilities.includes(cap)
      );
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

  private calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    const modelConfig = this.modelConfigs.get(model);
    if (!modelConfig) {return 0;}
    
    const inputCost = (inputTokens / 1_000_000) * modelConfig.inputCostPer1M;
    const outputCost = (outputTokens / 1_000_000) * modelConfig.outputCostPer1M;
    return inputCost + outputCost;
  }

  private estimateRequestCost(request: GenerateRequest): number {
    const model = request.model || this.defaultModel;
    
    // Rough estimate: prompt length / 4 for input tokens
    const inputTokens = Math.ceil(request.prompt.length / 4);
    const outputTokens = request.maxTokens || this.config.maxTokens || 1000;
    
    return this.calculateCost(model, inputTokens, outputTokens);
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

  /**
   * Get model configuration by name
   */
  public getModelConfig(model: string): NIMModelConfig | undefined {
    return this.modelConfigs.get(model);
  }

  /**
   * Check if a model supports long context (>100K tokens)
   */
  public supportsLongContext(model?: string): boolean {
    const modelName = model || this.defaultModel;
    const config = this.modelConfigs.get(modelName);
    return config?.contextLength ? config.contextLength > 100000 : false;
  }

  /**
   * Get the best model for a specific capability
   */
  public getBestModelForCapability(capability: ModelCapability): string | null {
    const models = Array.from(this.modelConfigs.entries()).filter(([_, config]) => 
      config.capabilities.includes(capability)
    );

    if (models.length === 0) {return null;}

    // Sort by context length for long context, otherwise by parameter count (inferred from name)
    if (capability === ModelCapability.LONG_CONTEXT) {
      models.sort((a, b) => b[1].contextLength - a[1].contextLength);
      return models[0][0]; // Return Nemotron for 1M context
    }

    if (capability === ModelCapability.VISION) {
      // Prefer Qwen or Cosmos for vision tasks
      const visionModel = models.find(([name]) => name.includes('qwen') || name.includes('cosmos'));
      return visionModel ? visionModel[0] : models[0][0];
    }

    if (capability === ModelCapability.CODE_GENERATION) {
      // Prefer Nemotron or Qwen for coding
      const codeModel = models.find(([name]) => name.includes('nemotron') || name.includes('qwen'));
      return codeModel ? codeModel[0] : models[0][0];
    }

    // Default to first available model
    return models[0][0];
  }
}

// Factory function for easy instantiation
export function createNVIDIANIMProvider(apiKey?: string): NVIDIANIMProvider {
  const key = apiKey || process.env.NVIDIA_API_KEY || process.env.NVIDIA_NIM_API_KEY;
  if (!key) {
    throw new Error('NVIDIA NIM API key required. Set NVIDIA_API_KEY or pass apiKey.');
  }
  return new NVIDIANIMProvider({ apiKey: key });
}

// Model constants for easy reference
export const NVIDIA_NIM_MODELS = {
  KIMI_K25: 'moonshotai/kimi-k2.5',
  NEMOTRON: 'nvidia/nemotron-3-nano-30b-a3b',
  GLM5: 'z-ai/glm5',
  COSMOS: 'nvidia/cosmos-reason2-8b',
  QWEN: 'qwen/qwen3.5-397b-a17b'
} as const;

// Role-based model recommendations
export const NVIDIA_NIM_ROLES = {
  longcontext: NVIDIA_NIM_MODELS.NEMOTRON,    // 1M context
  agentic: NVIDIA_NIM_MODELS.GLM5,           // 744B agentic
  physical: NVIDIA_NIM_MODELS.COSMOS,        // Physical reasoning
  vision: NVIDIA_NIM_MODELS.QWEN,           // Vision + text
  default: NVIDIA_NIM_MODELS.KIMI_K25       // General purpose
} as const;