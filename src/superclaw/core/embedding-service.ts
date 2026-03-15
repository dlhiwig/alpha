/**
 * Embedding Service for SuperClaw
 * 
 * Provides text embeddings for semantic similarity and clustering.
 * Supports multiple backends with fallback.
 */

// --- Types ---

export interface EmbeddingConfig {
  provider?: 'openai' | 'ollama' | 'hash';
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  dimensions?: number;
  cacheEnabled?: boolean;
  cacheTTLMs?: number;
}

export interface EmbeddingResult {
  embedding: number[];
  provider: string;
  model: string;
  cached: boolean;
  latencyMs: number;
}

interface CacheEntry {
  embedding: number[];
  timestamp: number;
}

// --- OpenAI Response Type ---

interface OpenAIEmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

// --- Embedding Service ---

export class EmbeddingService {
  private config: Required<EmbeddingConfig>;
  private cache = new Map<string, CacheEntry>();
  
  constructor(config: EmbeddingConfig = {}) {
    this.config = {
      provider: config.provider || this.detectProvider(),
      model: config.model || 'text-embedding-3-small',
      apiKey: config.apiKey || process.env.OPENAI_API_KEY || '',
      baseUrl: config.baseUrl || 'https://api.openai.com/v1',
      dimensions: config.dimensions || 256,
      cacheEnabled: config.cacheEnabled ?? true,
      cacheTTLMs: config.cacheTTLMs || 3600000, // 1 hour
    };
  }
  
  private detectProvider(): 'openai' | 'ollama' | 'hash' {
    if (process.env.OPENAI_API_KEY) return 'openai';
    if (process.env.OLLAMA_URL) return 'ollama';
    return 'hash';
  }
  
  /**
   * Generate embedding for text
   */
  async embed(text: string): Promise<EmbeddingResult> {
    const startTime = Date.now();
    const cacheKey = this.getCacheKey(text);
    
    // Check cache
    if (this.config.cacheEnabled) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.config.cacheTTLMs) {
        return {
          embedding: cached.embedding,
          provider: this.config.provider,
          model: this.config.model,
          cached: true,
          latencyMs: Date.now() - startTime,
        };
      }
    }
    
    // Generate embedding based on provider
    let embedding: number[];
    
    switch (this.config.provider) {
      case 'openai':
        embedding = await this.embedOpenAI(text);
        break;
      case 'ollama':
        embedding = await this.embedOllama(text);
        break;
      default:
        embedding = this.hashEmbed(text);
    }
    
    // Cache result
    if (this.config.cacheEnabled) {
      this.cache.set(cacheKey, {
        embedding,
        timestamp: Date.now(),
      });
    }
    
    return {
      embedding,
      provider: this.config.provider,
      model: this.config.model,
      cached: false,
      latencyMs: Date.now() - startTime,
    };
  }
  
  /**
   * Batch embed multiple texts
   */
  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    // For now, process sequentially with caching
    // TODO: OpenAI supports batch embedding in a single request
    return Promise.all(texts.map(text => this.embed(text)));
  }
  
  /**
   * Calculate cosine similarity between two embeddings
   */
  similarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Embedding dimensions must match');
    }
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }
  
  /**
   * Find most similar items in a collection
   */
  findSimilar(
    query: number[],
    items: Array<{ id: string; embedding: number[] }>,
    topK: number = 5
  ): Array<{ id: string; score: number }> {
    const scores = items.map(item => ({
      id: item.id,
      score: this.similarity(query, item.embedding),
    }));
    
    return scores
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
  
  // --- Provider Implementations ---
  
  private async embedOpenAI(text: string): Promise<number[]> {
    if (!this.config.apiKey) {
      console.warn('OpenAI API key not set, falling back to hash embedding');
      return this.hashEmbed(text);
    }
    
    try {
      const response = await fetch(`${this.config.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          input: text,
          dimensions: this.config.dimensions,
        }),
      });
      
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI embedding error: ${response.status} - ${error}`);
      }
      
      const data = await response.json() as OpenAIEmbeddingResponse;
      return data.data[0].embedding;
    } catch (error: unknown) {
      console.error('OpenAI embedding failed, falling back to hash:', error);
      return this.hashEmbed(text);
    }
  }
  
  private async embedOllama(text: string): Promise<number[]> {
    const baseUrl = this.config.baseUrl || 'http://127.0.0.1:11434';
    
    try {
      const response = await fetch(`${baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model || 'nomic-embed-text',
          prompt: text,
        }),
      });
      
      if (!response.ok) {
        throw new Error(`Ollama embedding error: ${response.status}`);
      }
      
      const data = await response.json() as { embedding: number[] };
      
      // Ollama embeddings may be different dimensions, truncate/pad to match
      return this.normalizeEmbedding(data.embedding);
    } catch (error: unknown) {
      console.error('Ollama embedding failed, falling back to hash:', error);
      return this.hashEmbed(text);
    }
  }
  
  /**
   * Hash-based pseudo-embedding (fast, no API required)
   * Good enough for basic clustering and similarity
   */
  private hashEmbed(text: string): number[] {
    const dim = this.config.dimensions;
    const embedding = new Array(dim).fill(0);
    
    // Tokenize by words
    const words = text.toLowerCase().split(/\W+/).filter(w => w.length > 0);
    
    for (let w = 0; w < words.length; w++) {
      const word = words[w];
      for (let i = 0; i < word.length; i++) {
        const charCode = word.charCodeAt(i);
        const position = w * 0.1; // Position-aware
        
        // Multiple hash functions for better distribution
        const h1 = (charCode * 31 + i * 17) % dim;
        const h2 = (charCode * 37 + i * 13 + w * 7) % dim;
        const h3 = (charCode * 41 + position * 100) % dim;
        
        embedding[h1] += 1 / (i + 1);
        embedding[h2] += charCode / 1000;
        embedding[Math.floor(h3)] += 0.1;
      }
    }
    
    // Add n-gram features
    for (let i = 0; i < text.length - 2; i++) {
      const trigram = text.slice(i, i + 3).toLowerCase();
      const hash = this.simpleHash(trigram) % dim;
      embedding[hash] += 0.05;
    }
    
    // Normalize to unit vector
    return this.normalize(embedding);
  }
  
  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }
  
  private normalize(vec: number[]): number[] {
    const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    return magnitude === 0 ? vec : vec.map(v => v / magnitude);
  }
  
  private normalizeEmbedding(embedding: number[]): number[] {
    const target = this.config.dimensions;
    
    if (embedding.length === target) {
      return embedding;
    }
    
    if (embedding.length > target) {
      // Truncate
      return embedding.slice(0, target);
    }
    
    // Pad with zeros
    return [...embedding, ...new Array(target - embedding.length).fill(0)];
  }
  
  private getCacheKey(text: string): string {
    // Simple hash for cache key
    return `${this.config.provider}:${this.config.model}:${this.simpleHash(text)}`;
  }
  
  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }
  
  /**
   * Get cache stats
   */
  getCacheStats(): { size: number; hitRate: number } {
    return {
      size: this.cache.size,
      hitRate: 0, // TODO: track hit rate
    };
  }
}

// --- Singleton ---

let defaultService: EmbeddingService | null = null;

export function getEmbeddingService(config?: EmbeddingConfig): EmbeddingService {
  if (!defaultService) {
    defaultService = new EmbeddingService(config);
  }
  return defaultService;
}

export function createEmbeddingService(config?: EmbeddingConfig): EmbeddingService {
  return new EmbeddingService(config);
}
