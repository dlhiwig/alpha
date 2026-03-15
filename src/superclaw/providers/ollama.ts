/**
 * Ollama Provider Implementation
 * 
 * Local LLM provider using Ollama for offline, cost-free inference.
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

interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  stream?: boolean;
  options?: {
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    top_k?: number;
  };
}

interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  details: {
    format: string;
    family: string;
    families?: string[];
    parameter_size: string;
    quantization_level: string;
  };
}

interface OllamaPullRequest {
  name: string;
  stream?: boolean;
}

interface OllamaPullResponse {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
}

interface PullProgress {
  model: string;
  status: 'pulling' | 'verifying' | 'success' | 'error';
  progress?: number;
  message?: string;
}

// @ts-expect-error - Post-Merge Reconciliation
export class OllamaProvider implements ILLMProvider {
  public readonly name = 'ollama';
  public readonly type = ProviderType.LOCAL;
  public readonly priority = 1; // Highest priority (local-first)
  public readonly defaultModel = 'dolphin-llama3:8b';
  
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private health: ProviderHealth;
  
  // Model capability mapping
  private readonly modelCapabilities: Record<string, ModelCapability[]> = {
    'dolphin-llama3:8b': [
      ModelCapability.TEXT_GENERATION,
      ModelCapability.UNCENSORED
    ],
    'dolphin-llama3:70b': [
      ModelCapability.TEXT_GENERATION,
      ModelCapability.REASONING,
      ModelCapability.UNCENSORED
    ],
    'qwen3-coder': [
      ModelCapability.TEXT_GENERATION,
      ModelCapability.CODE_GENERATION
    ],
    'codestral': [
      ModelCapability.TEXT_GENERATION,
      ModelCapability.CODE_GENERATION
    ]
  };
  
  // Memory requirements (GB VRAM)
  private readonly modelMemoryRequirements: Record<string, number> = {
    'dolphin-llama3:8b': 6,
    'dolphin-llama3:70b': 16,
    'qwen3-coder': 23 // Requires context reduction for RTX 4090
  };
  
  constructor(endpoint: string = 'http://127.0.0.1:11434', timeoutMs: number = 30000) {
    this.endpoint = endpoint;
    this.timeoutMs = timeoutMs;
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
      await this.checkHealth();
    } catch (error: unknown) {
      throw new ProviderError(
        `Failed to initialize Ollama provider: ${(error as Error).message}`,
        this.name,
        'INIT_FAILED',
        true
      );
    }
  }
  
  async isHealthy(): Promise<boolean> {
    try {
      const response = await this.makeRequest('/api/tags', 'GET');
      this.updateHealthStatus(true, Date.now() - this.health.lastCheck.getTime());
      return response.status === 200;
    } catch (error: unknown) {
      this.updateHealthStatus(false, this.timeoutMs);
      return false;
    }
  }
  
  async getHealth(): Promise<ProviderHealth> {
    await this.isHealthy();
    return { ...this.health };
  }
  
  async getModels(): Promise<Model[]> {
    try {
      const response = await this.makeRequest('/api/tags', 'GET');
      const data = await response.json() as { models: OllamaModel[] };
      
      return data.models.map(model => this.convertToModel(model));
    } catch (error: unknown) {
      throw new ProviderError(
        `Failed to get models: ${(error as Error).message}`,
        this.name,
        'GET_MODELS_FAILED',
        true
      );
    }
  }
  
  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const startTime = Date.now();
    
    try {
      const model = request.model || this.defaultModel;
      
      // Ensure model is available locally
      await this.ensureModel(model);
      
      const ollamaRequest: OllamaGenerateRequest = {
        model,
        prompt: this.buildPrompt(request),
        stream: false,
        options: {
          temperature: request.temperature || 0.7,
          max_tokens: request.maxTokens || 2048
        }
      };
      
      const response = await this.makeRequest('/api/generate', 'POST', ollamaRequest);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json() as OllamaGenerateResponse;
      const latency = Date.now() - startTime;
      
      this.updateHealthStatus(true, latency);
      
      // @ts-expect-error - Post-Merge Reconciliation
      return {
        text: data.response,
        model: data.model,
        tokens: {
          input: data.prompt_eval_count || this.estimateTokens(request.prompt),
          output: data.eval_count || this.estimateTokens(data.response)
        },
        cost: 0, // Local inference is free
        latency,
        provider: this.name
      };
      
    } catch (error: unknown) {
      this.updateHealthStatus(false, Date.now() - startTime);
      throw new ProviderError(
        `Generation failed: ${(error as Error).message}`,
        this.name,
        'GENERATE_FAILED',
        true
      );
    }
  }
  
  async* stream(request: GenerateRequest): AsyncIterable<StreamChunk> {
    try {
      const model = request.model || this.defaultModel;
      
      // Ensure model is available locally
      await this.ensureModel(model);
      
      const ollamaRequest: OllamaGenerateRequest = {
        model,
        prompt: this.buildPrompt(request),
        stream: true,
        options: {
          temperature: request.temperature || 0.7,
          max_tokens: request.maxTokens || 2048
        }
      };
      
      const response = await this.makeRequest('/api/generate', 'POST', ollamaRequest);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
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
            if (line.trim()) {
              const data = JSON.parse(line) as OllamaGenerateResponse;
              
              yield {
                text: data.response,
                isComplete: data.done,
                model: data.model,
                provider: this.name
              };
              
              if (data.done) {
                this.updateHealthStatus(true, 0);
                return;
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
        `Streaming failed: ${(error as Error).message}`,
        this.name,
        'STREAM_FAILED',
        true
      );
    }
  }
  
  canHandle(request: GenerateRequest, context?: RoutingContext): boolean {
    const model = request.model || this.defaultModel;
    
    // Check if model exists
    if (!this.modelCapabilities[model]) {
      return false;
    }
    
    // Check required capabilities
    if (context?.requiredCapabilities) {
      const modelCaps = this.modelCapabilities[model];
      return context.requiredCapabilities.every(cap => modelCaps.includes(cap));
    }
    
    // Check memory requirements (assume RTX 4090 16GB VRAM available)
    const memoryRequired = this.modelMemoryRequirements[model];
    if (memoryRequired && memoryRequired > 16) {
      return false;
    }
    
    return true;
  }
  
  async estimateCost(request: GenerateRequest): Promise<number> {
    // Local inference is always free
    return 0;
  }
  
  /**
   * Pull a model from Ollama registry
   */
  async pullModel(modelName: string, onProgress?: (progress: PullProgress) => void): Promise<void> {
    try {
      const pullRequest: OllamaPullRequest = {
        name: modelName,
        stream: true
      };
      
      const response = await this.makeRequest('/api/pull', 'POST', pullRequest);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body for pull request');
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
            if (line.trim()) {
              try {
                const data = JSON.parse(line) as OllamaPullResponse;
                
                if (onProgress) {
                  let progress: PullProgress = {
                    model: modelName,
                    status: 'pulling',
                    message: data.status
                  };
                  
                  if (data.total && data.completed) {
                    progress.progress = (data.completed / data.total) * 100;
                  }
                  
                  if (data.status === 'success') {
                    progress.status = 'success';
                  } else if (data.status.includes('verifying')) {
                    progress.status = 'verifying';
                  }
                  
                  onProgress(progress);
                }
                
                if (data.status === 'success') {
                  return;
                }
              } catch (parseError) {
                // Skip malformed JSON lines
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error: unknown) {
      if (onProgress) {
        onProgress({
          model: modelName,
          status: 'error',
          message: (error as Error).message
        });
      }
      
      throw new ProviderError(
        `Failed to pull model ${modelName}: ${(error as Error).message}`,
        this.name,
        'PULL_MODEL_FAILED',
        true
      );
    }
  }
  
  /**
   * Check if a specific model is available locally
   */
  async hasModel(modelName: string): Promise<boolean> {
    try {
      const models = await this.getModels();
      return models.some(model => model.name === modelName);
    } catch (error: unknown) {
      return false;
    }
  }
  
  /**
   * Ensure a model is available, pulling it if necessary
   */
  async ensureModel(modelName: string, onProgress?: (progress: PullProgress) => void): Promise<void> {
    const hasModel = await this.hasModel(modelName);
    
    if (!hasModel) {
      if (onProgress) {
        onProgress({
          model: modelName,
          status: 'pulling',
          message: `Model ${modelName} not found locally, pulling...`
        });
      }
      
      await this.pullModel(modelName, onProgress);
    }
  }
  
  async shutdown(): Promise<void> {
    // Ollama runs as a separate service, no cleanup needed
  }
  
  private async makeRequest(
    endpoint: string,
    method: 'GET' | 'POST' = 'GET',
    body?: any
  ): Promise<Response> {
    const url = `${this.endpoint}${endpoint}`;
    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(this.timeoutMs)
    };
    
    if (body) {
      options.body = JSON.stringify(body);
    }
    
    return fetch(url, options);
  }
  
  private buildPrompt(request: GenerateRequest): string {
    if (request.systemPrompt && request.context?.messages) {
      // Build conversation with system prompt
      let prompt = `System: ${request.systemPrompt}\n\n`;
      
      for (const message of request.context.messages) {
        prompt += `${message.role === 'user' ? 'Human' : 'Assistant'}: ${message.content}\n`;
      }
      
      prompt += `Human: ${request.prompt}\nAssistant:`;
      return prompt;
    } else if (request.systemPrompt) {
      return `System: ${request.systemPrompt}\n\nHuman: ${request.prompt}\nAssistant:`;
    } else {
      return request.prompt;
    }
  }
  
  private convertToModel(ollamaModel: OllamaModel): Model {
    const name = ollamaModel.name;
    const capabilities = this.modelCapabilities[name] || [ModelCapability.TEXT_GENERATION];
    const memoryRequirement = this.modelMemoryRequirements[name];
    
    return {
      name,
      displayName: name.replace(':', ' '),
      contextLength: this.getContextLength(name),
      capabilities,
      memoryRequirement
    };
  }
  
  private getContextLength(modelName: string): number {
    // Context lengths for known models
    const contextLengths: Record<string, number> = {
      'dolphin-llama3:8b': 32768,
      'dolphin-llama3:70b': 32768,
      'qwen3-coder': 65536
    };
    
    return contextLengths[modelName] || 8192;
  }
  
  private estimateTokens(text: string): number {
    // Rough estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
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
  
  private async checkHealth(): Promise<void> {
    try {
      const response = await this.makeRequest('/api/tags', 'GET');
      if (!response.ok) {
        throw new Error(`Health check failed: HTTP ${response.status}`);
      }
    } catch (error: unknown) {
      // @ts-expect-error - Post-Merge Reconciliation
      if (error.name === 'TypeError' && (error as Error).message.includes('fetch')) {
        throw new Error('Ollama server is not running. Please start Ollama with: ollama serve', { cause: error });
      // @ts-expect-error - Post-Merge Reconciliation
      } else if (error.name === 'AbortError') {
        throw new Error('Ollama server timeout. Check if the service is responsive.', { cause: error });
      } else {
        throw error;
      }
    }
  }
}

/**
 * Factory function to create an Ollama provider instance
 */
export function createOllamaProvider(
  endpoint?: string, 
  timeoutMs?: number
): OllamaProvider {
  return new OllamaProvider(endpoint, timeoutMs);
}

// Export types for external usage
export type { PullProgress };