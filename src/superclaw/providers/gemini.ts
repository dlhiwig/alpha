/**
 * Google Gemini Provider Implementation
 * 
 * Complete integration with Google's Generative AI API for cost-effective cloud inference.
 */

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, GenerateContentRequest, GenerateContentResult } from '@google/generative-ai';
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

export interface GeminiConfig {
  apiKey: string;
  baseUrl?: string;
  models?: string[];
  budget?: {
    daily: number;
    monthly: number;
  };
}

// @ts-expect-error - Post-Merge Reconciliation
export class GeminiProvider implements ILLMProvider {
  public readonly name = 'gemini';
  public readonly type = ProviderType.CLOUD;
  public readonly priority = 3; // Third priority (cheapest fallback)
  public readonly defaultModel = 'gemini-pro';
  
  private readonly config: GeminiConfig;
  private readonly genAI: GoogleGenerativeAI;
  private health: ProviderHealth;
  
  // Gemini model specifications
  private readonly models: Model[] = [
    {
      name: 'gemini-2.0-flash-001',
      displayName: 'Gemini 2.0 Flash',
      contextLength: 1000000, // 1M context
      capabilities: [
        ModelCapability.TEXT_GENERATION,
        ModelCapability.REASONING,
        ModelCapability.VISION,
        ModelCapability.FUNCTION_CALLING,
        ModelCapability.LONG_CONTEXT
      ],
      costPerInputToken: 0.075 / 1000000,  // $0.075 per 1M tokens
      costPerOutputToken: 0.30 / 1000000   // $0.30 per 1M tokens
    },
    {
      name: 'gemini-1.5-pro-002',
      displayName: 'Gemini 1.5 Pro',
      contextLength: 2000000, // 2M context
      capabilities: [
        ModelCapability.TEXT_GENERATION,
        ModelCapability.REASONING,
        ModelCapability.VISION,
        ModelCapability.FUNCTION_CALLING,
        ModelCapability.LONG_CONTEXT
      ],
      costPerInputToken: 0.25 / 1000000,   // $0.25 per 1M tokens
      costPerOutputToken: 1.00 / 1000000   // $1.00 per 1M tokens
    },
    {
      name: 'gemini-1.5-flash-002',
      displayName: 'Gemini 1.5 Flash',
      contextLength: 1000000,
      capabilities: [
        ModelCapability.TEXT_GENERATION,
        ModelCapability.REASONING,
        ModelCapability.VISION,
        ModelCapability.FUNCTION_CALLING,
        ModelCapability.LONG_CONTEXT
      ],
      costPerInputToken: 0.075 / 1000000,  // $0.075 per 1M tokens
      costPerOutputToken: 0.30 / 1000000   // $0.30 per 1M tokens
    },
    {
      name: 'gemini-1.5-pro',
      displayName: 'Gemini 1.5 Pro (Legacy)',
      contextLength: 2000000,
      capabilities: [
        ModelCapability.TEXT_GENERATION,
        ModelCapability.REASONING,
        ModelCapability.VISION,
        ModelCapability.FUNCTION_CALLING,
        ModelCapability.LONG_CONTEXT
      ],
      costPerInputToken: 0.25 / 1000000,
      costPerOutputToken: 1.00 / 1000000
    },
    {
      name: 'gemini-1.5-flash',
      displayName: 'Gemini 1.5 Flash (Legacy)',
      contextLength: 1000000,
      capabilities: [
        ModelCapability.TEXT_GENERATION,
        ModelCapability.REASONING,
        ModelCapability.VISION,
        ModelCapability.FUNCTION_CALLING,
        ModelCapability.LONG_CONTEXT
      ],
      costPerInputToken: 0.075 / 1000000,
      costPerOutputToken: 0.30 / 1000000
    }
  ];
  
  constructor(config: GeminiConfig) {
    this.config = config;
    this.genAI = new GoogleGenerativeAI(config.apiKey);
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
        'Gemini API key required',
        this.name,
        'MISSING_API_KEY',
        false
      );
    }
    
    try {
      await this.isHealthy();
    } catch (error: unknown) {
      throw new ProviderError(
        `Failed to initialize Gemini provider: ${error instanceof Error ? (error).message : 'Unknown error'}`,
        this.name,
        'INIT_FAILED',
        true
      );
    }
  }
  
  async isHealthy(): Promise<boolean> {
    const startTime = Date.now();
    
    try {
      const model = this.genAI.getGenerativeModel({ 
        model: this.defaultModel,
        safetySettings: this.getSafetySettings()
      });
      
      // Make a simple test request
      const result = await model.generateContent({
        contents: [{
          role: 'user',
          parts: [{ text: 'Hello' }]
        }]
      });
      
      const responseTime = Date.now() - startTime;
      
      if (result.response.text()) {
        this.updateHealthStatus(true, responseTime);
        return true;
      } else {
        this.updateHealthStatus(false, responseTime);
        return false;
      }
    } catch (error: unknown) {
      const responseTime = Date.now() - startTime;
      this.updateHealthStatus(false, responseTime);
      console.error('Gemini health check failed:', error);
      return false;
    }
  }
  
  async getHealth(): Promise<ProviderHealth> {
    await this.isHealthy();
    return { ...this.health };
  }
  
  async getModels(): Promise<Model[]> {
    return [...this.models];
  }
  
  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const startTime = Date.now();
    
    try {
      const modelName = request.model || this.defaultModel;
      const model = this.genAI.getGenerativeModel({ 
        model: modelName,
        safetySettings: this.getSafetySettings(),
        systemInstruction: request.systemPrompt,
        generationConfig: {
          maxOutputTokens: request.maxTokens,
          temperature: request.temperature
        }
      });
      
      const contents = this.buildContents(request);
      const result = await model.generateContent({ contents });
      
      const responseText = result.response.text();
      const latency = Date.now() - startTime;
      
      // Extract token usage from response
      const usage = result.response.usageMetadata;
      const inputTokens = usage?.promptTokenCount || this.estimateTokens(request.prompt);
      const outputTokens = usage?.candidatesTokenCount || this.estimateTokens(responseText);
      
      // @ts-expect-error - Post-Merge Reconciliation
      const response: GenerateResponse = {
        text: responseText,
        model: modelName,
        tokens: {
          input: inputTokens,
          output: outputTokens
        },
        cost: this.calculateCost(modelName, inputTokens, outputTokens),
        latency,
        provider: this.name
      };
      
      this.updateHealthStatus(true, latency);
      return response;
      
    } catch (error: unknown) {
      const latency = Date.now() - startTime;
      this.updateHealthStatus(false, latency);
      
      // Handle specific Gemini errors
      let errorCode = 'GENERATE_FAILED';
      let retryable = true;
      
      if (error instanceof Error) {
        if ((error).message.includes('API_KEY_INVALID')) {
          errorCode = 'INVALID_API_KEY';
          retryable = false;
        } else if ((error).message.includes('QUOTA_EXCEEDED')) {
          errorCode = 'QUOTA_EXCEEDED';
          retryable = true;
        } else if ((error).message.includes('SAFETY')) {
          errorCode = 'SAFETY_FILTER';
          retryable = false;
        }
      }
      
      throw new ProviderError(
        `Gemini generation failed: ${error instanceof Error ? (error).message : 'Unknown error'}`,
        this.name,
        errorCode,
        retryable
      );
    }
  }
  
  async* stream(request: GenerateRequest): AsyncIterable<StreamChunk> {
    try {
      const modelName = request.model || this.defaultModel;
      const model = this.genAI.getGenerativeModel({ 
        model: modelName,
        safetySettings: this.getSafetySettings(),
        systemInstruction: request.systemPrompt,
        generationConfig: {
          maxOutputTokens: request.maxTokens,
          temperature: request.temperature
        }
      });
      
      const contents = this.buildContents(request);
      const stream = await model.generateContentStream({ contents });
      
      let fullText = '';
      
      for await (const chunk of stream.stream) {
        const chunkText = chunk.text();
        fullText += chunkText;
        
        if (chunkText) {
          yield {
            text: chunkText,
            isComplete: false,
            model: modelName,
            provider: this.name
          };
        }
      }
      
      // Send final complete chunk
      yield {
        text: '',
        isComplete: true,
        model: modelName,
        provider: this.name
      };
      
      this.updateHealthStatus(true, 1000); // Rough estimate for streaming
      
    } catch (error: unknown) {
      this.updateHealthStatus(false, 0);
      throw new ProviderError(
        `Gemini streaming failed: ${error instanceof Error ? (error).message : 'Unknown error'}`,
        this.name,
        'STREAM_FAILED',
        true
      );
    }
  }
  
  canHandle(request: GenerateRequest, context?: RoutingContext): boolean {
    const model = request.model || this.defaultModel;
    const modelSpec = this.models.find(m => m.name === model);
    
    if (!modelSpec) {
      return false;
    }
    
    // Check required capabilities
    if (context?.requiredCapabilities) {
      return context.requiredCapabilities.every(cap => 
        modelSpec.capabilities.includes(cap)
      );
    }
    
    // Gemini cannot handle uncensored content due to built-in safety filters
    if (context?.requiredCapabilities?.includes(ModelCapability.UNCENSORED)) {
      return false;
    }
    
    // Check budget constraints
    if (context?.maxCost) {
      const estimatedCost = this.calculateCost(
        model,
        this.estimateTokens(request.prompt),
        request.maxTokens || 1000
      );
      if (estimatedCost > context.maxCost) {
        return false;
      }
    }
    
    return true;
  }
  
  async estimateCost(request: GenerateRequest): Promise<number> {
    const model = request.model || this.defaultModel;
    const inputTokens = this.estimateTokens(request.prompt);
    const outputTokens = request.maxTokens || 1000;
    
    return this.calculateCost(model, inputTokens, outputTokens);
  }
  
  async shutdown(): Promise<void> {
    console.log('Shutting down Gemini provider...');
    // Nothing specific to clean up for Google's SDK
  }
  
  private buildContents(request: GenerateRequest) {
    if (request.context?.messages) {
      // Convert conversation context to Gemini format
      return request.context.messages.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : msg.role,
        parts: [{ text: msg.content }]
      })).concat([{
        role: 'user',
        parts: [{ text: request.prompt }]
      }]);
    } else {
      // Simple single-turn request
      return [{
        role: 'user',
        parts: [{ text: request.prompt }]
      }];
    }
  }
  
  private getSafetySettings() {
    // Configure safety settings to be permissive for SuperClaw use cases
    return [
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
      },
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
      },
      {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
      },
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
      },
    ];
  }
  
  private calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    const modelSpec = this.models.find(m => m.name === model);
    if (!modelSpec) {
      return 0;
    }
    
    const inputCost = inputTokens * (modelSpec.costPerInputToken || 0);
    const outputCost = outputTokens * (modelSpec.costPerOutputToken || 0);
    
    return inputCost + outputCost;
  }
  
  private estimateTokens(text: string): number {
    // Gemini uses SentencePiece tokenization
    // More efficient than GPT models: ~3.5 characters per token
    return Math.ceil(text.length / 3.5);
  }
  
  private updateHealthStatus(success: boolean, responseTime: number): void {
    this.health.lastCheck = new Date();
    
    if (success) {
      this.health.consecutiveFailures = 0;
      this.health.status = ProviderStatus.HEALTHY;
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

/**
 * Factory function to create a Gemini provider instance
 */
export function createGeminiProvider(apiKey?: string): GeminiProvider {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error('Gemini API key required. Set GEMINI_API_KEY or pass apiKey.');
  }
  return new GeminiProvider({ apiKey: key });
}