/**
 * Cohere Provider Implementation
 * 
 * Provides access to Cohere's Command R/R+ models optimized for RAG,
 * reasoning, and multilingual tasks.
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

// Enhanced interfaces for RAG/rerank capabilities
export interface CohereEmbeddingRequest {
  texts: string[];
  model?: string;
  input_type?: 'search_document' | 'search_query' | 'classification' | 'clustering';
  embedding_types?: string[];
  truncate?: 'NONE' | 'START' | 'END';
}

export interface CohereEmbeddingResponse {
  id: string;
  embeddings: number[][];
  texts: string[];
  meta?: {
    api_version?: {
      version: string;
    };
    billed_units?: {
      input_tokens: number;
    };
  };
}

export interface CohereRerankRequest {
  model?: string;
  query: string;
  documents: string[] | Array<{
    text: string;
    title?: string;
    metadata?: Record<string, any>;
  }>;
  top_n?: number;
  return_documents?: boolean;
  max_chunks_per_doc?: number;
}

export interface CohereRerankResponse {
  id: string;
  results: Array<{
    index: number;
    relevance_score: number;
    document?: {
      text: string;
      title?: string;
      metadata?: Record<string, any>;
    };
  }>;
  meta?: {
    api_version?: {
      version: string;
    };
    billed_units?: {
      search_units: number;
    };
  };
}

export interface EmbeddingResult {
  embeddings: number[][];
  provider: string;
  model: string;
  inputTokens: number;
  cost: number;
  latency: number;
}

export interface RerankResult {
  results: Array<{
    index: number;
    relevanceScore: number;
    text: string;
    metadata?: Record<string, any>;
  }>;
  provider: string;
  model: string;
  searchUnits: number;
  cost: number;
  latency: number;
}

interface CohereGenerateRequest {
  model: string;
  message: string;
  chat_history?: Array<{
    role: 'USER' | 'CHATBOT';
    message: string;
  }>;
  max_tokens?: number;
  temperature?: number;
  p?: number; // nucleus sampling
  k?: number; // top-k sampling
  frequency_penalty?: number;
  presence_penalty?: number;
  stop_sequences?: string[];
  return_likelihoods?: 'GENERATION' | 'ALL' | 'NONE';
  stream?: boolean;
}

interface CohereGenerateResponse {
  id: string;
  generations?: Array<{
    id: string;
    text: string;
    likelihood?: number;
    token_likelihoods?: Array<{
      token: string;
      likelihood: number;
    }>;
  }>;
  prompt?: string;
  meta?: {
    api_version?: {
      version: string;
    };
    billed_units?: {
      input_tokens: number;
      output_tokens: number;
    };
  };
}

interface CohereChatResponse {
  response_id: string;
  text: string;
  generation_id: string;
  citations?: Array<{
    start: number;
    end: number;
    text: string;
    document_ids: string[];
  }>;
  documents?: Array<{
    id: string;
    title?: string;
    snippet?: string;
    timestamp?: string;
  }>;
  is_search_required?: boolean;
  search_queries?: Array<{
    text: string;
    generation_id: string;
  }>;
  search_results?: Array<{
    search_query: {
      text: string;
      generation_id: string;
    };
    document_ids: string[];
    error_message?: string;
    continue_on_failure?: boolean;
  }>;
  meta?: {
    api_version?: {
      version: string;
    };
    billed_units?: {
      input_tokens: number;
      output_tokens: number;
    };
  };
}

// @ts-expect-error - Post-Merge Reconciliation
export class CohereProvider implements ILLMProvider {
  public readonly name = 'cohere';
  public readonly type = ProviderType.CLOUD;
  public readonly priority = 3; // Mid-tier priority
  public readonly defaultModel = 'command-r-plus';
  
  private readonly apiKey: string;
  private readonly baseUrl: string = 'https://api.cohere.ai/v1';
  private readonly timeoutMs: number;
  private health: ProviderHealth;
  
  // Available models with capabilities
  private readonly availableModels: Model[] = [
    {
      name: 'command-r-plus',
      displayName: 'Command R+',
      contextLength: 128000,
      capabilities: [
        ModelCapability.TEXT_GENERATION,
        ModelCapability.REASONING,
        ModelCapability.FUNCTION_CALLING,
        ModelCapability.LONG_CONTEXT,
        ModelCapability.RAG
      ],
      costPerInputToken: 0.000003, // $3 per 1M input tokens
      costPerOutputToken: 0.000015 // $15 per 1M output tokens
    },
    {
      name: 'command-r',
      displayName: 'Command R',
      contextLength: 128000,
      capabilities: [
        ModelCapability.TEXT_GENERATION,
        ModelCapability.REASONING,
        ModelCapability.LONG_CONTEXT,
        ModelCapability.RAG
      ],
      costPerInputToken: 0.0000005, // $0.50 per 1M input tokens
      costPerOutputToken: 0.0000015 // $1.50 per 1M output tokens
    },
    {
      name: 'command',
      displayName: 'Command',
      contextLength: 4096,
      capabilities: [
        ModelCapability.TEXT_GENERATION,
        ModelCapability.RAG
      ],
      costPerInputToken: 0.000001, // $1 per 1M input tokens  
      costPerOutputToken: 0.000002 // $2 per 1M output tokens
    },
    {
      name: 'command-light',
      displayName: 'Command Light',
      contextLength: 4096,
      capabilities: [
        ModelCapability.TEXT_GENERATION
      ],
      costPerInputToken: 0.0000003, // $0.30 per 1M input tokens
      costPerOutputToken: 0.0000006 // $0.60 per 1M output tokens
    },
    // Embedding models
    {
      name: 'embed-english-v3.0',
      displayName: 'Embed English v3.0',
      contextLength: 512,
      capabilities: [
        ModelCapability.EMBEDDINGS
      ],
      costPerInputToken: 0.0000001 // $0.10 per 1M input tokens
    },
    {
      name: 'embed-multilingual-v3.0',
      displayName: 'Embed Multilingual v3.0',
      contextLength: 512,
      capabilities: [
        ModelCapability.EMBEDDINGS
      ],
      costPerInputToken: 0.0000001 // $0.10 per 1M input tokens
    },
    {
      name: 'embed-english-light-v3.0',
      displayName: 'Embed English Light v3.0',
      contextLength: 512,
      capabilities: [
        ModelCapability.EMBEDDINGS
      ],
      costPerInputToken: 0.0000001 // $0.10 per 1M input tokens
    },
    {
      name: 'embed-multilingual-light-v3.0',
      displayName: 'Embed Multilingual Light v3.0',
      contextLength: 512,
      capabilities: [
        ModelCapability.EMBEDDINGS
      ],
      costPerInputToken: 0.0000001 // $0.10 per 1M input tokens
    },
    // Rerank models
    {
      name: 'rerank-english-v3.0',
      displayName: 'Rerank English v3.0',
      contextLength: 4096,
      capabilities: [
        ModelCapability.RERANK
      ],
      costPerInputToken: 0.000001 // $1 per 1K search queries
    },
    {
      name: 'rerank-multilingual-v3.0',
      displayName: 'Rerank Multilingual v3.0',
      contextLength: 4096,
      capabilities: [
        ModelCapability.RERANK
      ],
      costPerInputToken: 0.000001 // $1 per 1K search queries
    }
  ];
  
  constructor(apiKey?: string, timeoutMs: number = 30000) {
    this.apiKey = apiKey || process.env.COHERE_API_KEY || '';
    this.timeoutMs = timeoutMs;
    
    if (!this.apiKey) {
      throw new ProviderError('COHERE_API_KEY is required', this.name, 'auth', false);
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
    // Test the connection
    try {
      const response = await fetch(`${this.baseUrl}/check-api-key`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'SuperClaw/1.0'
        },
        signal: AbortSignal.timeout(5000)
      });
      
      if (!response.ok) {
        throw new ProviderError(
          `Failed to initialize Cohere: ${response.status} ${response.statusText}`,
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
        `Failed to initialize Cohere: ${error instanceof Error ? (error).message : 'Unknown error'}`,
        this.name,
        'connection',
        true
      );
    }
  }
  
  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/check-api-key`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
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
      // Convert SuperClaw request to Cohere format
      const cohereRequest: CohereGenerateRequest = {
        model,
        message: request.prompt,
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature || 0.3
      };
      
      // Add conversation context if available
      if (request.context?.messages) {
        cohereRequest.chat_history = request.context.messages
          .filter(msg => msg.role !== 'system')
          .map(msg => ({
            role: msg.role === 'user' ? 'USER' : 'CHATBOT',
            message: msg.content
          }));
      }
      
      const response = await fetch(`${this.baseUrl}/chat`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'SuperClaw/1.0'
        },
        body: JSON.stringify(cohereRequest),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new ProviderError(
          `Cohere API error: ${response.status} - ${errorText}`,
          this.name,
          response.status.toString(),
          response.status >= 500 || response.status === 429
        );
      }
      
      const data = await response.json() as CohereChatResponse;
      const latency = Date.now() - startTime;
      
      // Update health metrics
      this.health.avgResponseTime = (this.health.avgResponseTime * 0.9) + (latency * 0.1);
      this.health.consecutiveFailures = 0;
      
      // Calculate cost
      const inputTokens = data.meta?.billed_units?.input_tokens || 0;
      const outputTokens = data.meta?.billed_units?.output_tokens || 0;
      const modelInfo = this.availableModels.find(m => m.name === model);
      const cost = modelInfo ? 
        (inputTokens * modelInfo.costPerInputToken!) + (outputTokens * modelInfo.costPerOutputToken!) : 0;
      
      // @ts-expect-error - Post-Merge Reconciliation
      return {
        text: data.text,
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
        `Cohere generation failed: ${message}`,
        this.name,
        isTimeout ? 'timeout' : 'unknown',
        true
      );
    }
  }
  
  async *stream(request: GenerateRequest): AsyncIterable<StreamChunk> {
    const model = request.model || this.defaultModel;
    
    try {
      const cohereRequest: CohereGenerateRequest = {
        model,
        message: request.prompt,
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature || 0.3,
        stream: true
      };
      
      // Add conversation context if available
      if (request.context?.messages) {
        cohereRequest.chat_history = request.context.messages
          .filter(msg => msg.role !== 'system')
          .map(msg => ({
            role: msg.role === 'user' ? 'USER' : 'CHATBOT',
            message: msg.content
          }));
      }
      
      const response = await fetch(`${this.baseUrl}/chat`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'SuperClaw/1.0'
        },
        body: JSON.stringify(cohereRequest),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new ProviderError(
          `Cohere streaming error: ${response.status} - ${errorText}`,
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
                const chunk = JSON.parse(jsonStr) as { text?: string; is_finished?: boolean };
                if (chunk.text) {
                  yield {
                    text: chunk.text,
                    isComplete: chunk.is_finished || false,
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
        `Cohere streaming failed: ${message}`,
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

  /**
   * Generate embeddings for texts using Cohere's embed models
   */
  async embed(
    texts: string[], 
    model: string = 'embed-english-v3.0',
    inputType: 'search_document' | 'search_query' | 'classification' | 'clustering' = 'search_document'
  ): Promise<EmbeddingResult> {
    const startTime = Date.now();
    
    try {
      const cohereRequest: CohereEmbeddingRequest = {
        texts,
        model,
        input_type: inputType,
        truncate: 'END'
      };
      
      const response = await fetch(`${this.baseUrl}/embed`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'SuperClaw/1.0'
        },
        body: JSON.stringify(cohereRequest),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new ProviderError(
          `Cohere embedding error: ${response.status} - ${errorText}`,
          this.name,
          response.status.toString(),
          response.status >= 500 || response.status === 429
        );
      }
      
      const data = await response.json() as CohereEmbeddingResponse;
      const latency = Date.now() - startTime;
      
      // Calculate cost
      const inputTokens = data.meta?.billed_units?.input_tokens || 0;
      const modelInfo = this.availableModels.find(m => m.name === model);
      const cost = modelInfo && modelInfo.costPerInputToken ? 
        inputTokens * modelInfo.costPerInputToken : 0;
      
      return {
        embeddings: data.embeddings,
        provider: this.name,
        model,
        inputTokens,
        cost,
        latency
      };
      
    } catch (error: unknown) {
      if (error instanceof ProviderError) {
        throw error;
      }
      
      const message = error instanceof Error ? (error).message : 'Unknown error';
      throw new ProviderError(
        `Cohere embedding failed: ${message}`,
        this.name,
        'embedding',
        true
      );
    }
  }

  /**
   * Rerank documents against a query using Cohere's rerank models
   */
  async rerank(
    query: string,
    documents: string[] | Array<{ text: string; title?: string; metadata?: Record<string, any> }>,
    options: {
      model?: string;
      topN?: number;
      returnDocuments?: boolean;
      maxChunksPerDoc?: number;
    } = {}
  ): Promise<RerankResult> {
    const startTime = Date.now();
    const model = options.model || 'rerank-english-v3.0';
    
    try {
      const cohereRequest: CohereRerankRequest = {
        model,
        query,
        documents,
        top_n: options.topN || 10,
        return_documents: options.returnDocuments ?? true,
        max_chunks_per_doc: options.maxChunksPerDoc
      };
      
      const response = await fetch(`${this.baseUrl}/rerank`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'SuperClaw/1.0'
        },
        body: JSON.stringify(cohereRequest),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new ProviderError(
          `Cohere rerank error: ${response.status} - ${errorText}`,
          this.name,
          response.status.toString(),
          response.status >= 500 || response.status === 429
        );
      }
      
      const data = await response.json() as CohereRerankResponse;
      const latency = Date.now() - startTime;
      
      // Calculate cost
      const searchUnits = data.meta?.billed_units?.search_units || 0;
      const modelInfo = this.availableModels.find(m => m.name === model);
      const cost = modelInfo && modelInfo.costPerInputToken ? 
        searchUnits * modelInfo.costPerInputToken : 0;
      
      return {
        results: data.results.map(result => ({
          index: result.index,
          relevanceScore: result.relevance_score,
          text: result.document?.text || '',
          metadata: result.document?.metadata
        })),
        provider: this.name,
        model,
        searchUnits,
        cost,
        latency
      };
      
    } catch (error: unknown) {
      if (error instanceof ProviderError) {
        throw error;
      }
      
      const message = error instanceof Error ? (error).message : 'Unknown error';
      throw new ProviderError(
        `Cohere rerank failed: ${message}`,
        this.name,
        'rerank',
        true
      );
    }
  }

  /**
   * RAG-enabled generation with built-in search and rerank
   */
  async generateWithRAG(
    request: GenerateRequest & {
      documents?: string[] | Array<{ text: string; title?: string; metadata?: Record<string, any> }>;
      connectors?: Array<{
        id: string;
        user_access_token?: string;
        continue_on_failure?: boolean;
        options?: Record<string, any>;
      }>;
      citationQuality?: 'accurate' | 'fast';
      searchQueriesOnly?: boolean;
    }
  ): Promise<GenerateResponse & { 
    citations?: Array<{
      start: number;
      end: number;
      text: string;
      documentIds: string[];
    }>;
    searchQueries?: Array<{
      text: string;
      generationId: string;
    }>;
  }> {
    const startTime = Date.now();
    const model = request.model || this.defaultModel;
    
    try {
      // Enhanced chat request with RAG capabilities
      const cohereRequest: any = {
        model,
        message: request.prompt,
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature || 0.3,
        documents: request.documents,
        connectors: request.connectors,
        citation_quality: request.citationQuality || 'accurate',
        search_queries_only: request.searchQueriesOnly || false
      };
      
      // Add conversation context if available
      if (request.context?.messages) {
        cohereRequest.chat_history = request.context.messages
          .filter(msg => msg.role !== 'system')
          .map(msg => ({
            role: msg.role === 'user' ? 'USER' : 'CHATBOT',
            message: msg.content
          }));
      }
      
      const response = await fetch(`${this.baseUrl}/chat`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'SuperClaw/1.0'
        },
        body: JSON.stringify(cohereRequest),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new ProviderError(
          `Cohere RAG error: ${response.status} - ${errorText}`,
          this.name,
          response.status.toString(),
          response.status >= 500 || response.status === 429
        );
      }
      
      const data = await response.json() as CohereChatResponse;
      const latency = Date.now() - startTime;
      
      // Update health metrics
      this.health.avgResponseTime = (this.health.avgResponseTime * 0.9) + (latency * 0.1);
      this.health.consecutiveFailures = 0;
      
      // Calculate cost
      const inputTokens = data.meta?.billed_units?.input_tokens || 0;
      const outputTokens = data.meta?.billed_units?.output_tokens || 0;
      const modelInfo = this.availableModels.find(m => m.name === model);
      const cost = modelInfo ? 
        (inputTokens * modelInfo.costPerInputToken!) + (outputTokens * modelInfo.costPerOutputToken!) : 0;
      
      // @ts-expect-error - Post-Merge Reconciliation
      return {
        text: data.text,
        model,
        tokens: {
          input: inputTokens,
          output: outputTokens
        },
        cost,
        latency,
        provider: this.name,
        cached: false,
        citations: data.citations?.map(c => ({
          start: c.start,
          end: c.end,
          text: c.text,
          documentIds: c.document_ids
        })),
        searchQueries: data.search_queries?.map(q => ({
          text: q.text,
          generationId: q.generation_id
        }))
      };
      
    } catch (error: unknown) {
      this.health.consecutiveFailures++;
      
      if (error instanceof ProviderError) {
        throw error;
      }
      
      const message = error instanceof Error ? (error).message : 'Unknown error';
      throw new ProviderError(
        `Cohere RAG generation failed: ${message}`,
        this.name,
        'rag',
        true
      );
    }
  }
  
  async shutdown(): Promise<void> {
    // Cohere doesn't require explicit cleanup
  }
}

/**
 * Factory function to create a Cohere provider
 */
export function createCohereProvider(apiKey?: string): CohereProvider {
  return new CohereProvider(apiKey);
}