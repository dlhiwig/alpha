/**
 * Test file for enhanced Cohere provider with RAG/rerank capabilities
 */

import { CohereProvider, createCohereProvider } from './cohere';
import { ModelCapability } from './contracts';

describe('CohereProvider', () => {
  let provider: CohereProvider;

  beforeEach(() => {
    // Mock the API key for testing
    process.env.COHERE_API_KEY = 'test-key';
    provider = createCohereProvider();
  });

  describe('Model Capabilities', () => {
    it('should include embedding models', async () => {
      const models = await provider.getModels();
      
      const embeddingModels = models.filter(m => 
        m.capabilities.includes(ModelCapability.EMBEDDINGS)
      );
      
      expect(embeddingModels.length).toBeGreaterThan(0);
      expect(embeddingModels.map(m => m.name)).toContain('embed-english-v3.0');
      expect(embeddingModels.map(m => m.name)).toContain('embed-multilingual-v3.0');
    });

    it('should include rerank models', async () => {
      const models = await provider.getModels();
      
      const rerankModels = models.filter(m => 
        m.capabilities.includes(ModelCapability.RERANK)
      );
      
      expect(rerankModels.length).toBeGreaterThan(0);
      expect(rerankModels.map(m => m.name)).toContain('rerank-english-v3.0');
      expect(rerankModels.map(m => m.name)).toContain('rerank-multilingual-v3.0');
    });

    it('should include RAG capability in command models', async () => {
      const models = await provider.getModels();
      
      const ragModels = models.filter(m => 
        m.capabilities.includes(ModelCapability.RAG)
      );
      
      expect(ragModels.length).toBeGreaterThan(0);
      expect(ragModels.map(m => m.name)).toContain('command-r-plus');
      expect(ragModels.map(m => m.name)).toContain('command-r');
    });
  });

  describe('Embedding functionality', () => {
    it('should construct proper embedding requests', () => {
      // Test that the embed method exists and has correct signature
      expect(typeof provider.embed).toBe('function');
      expect(provider.embed.length).toBe(1); // Only texts is required, others have defaults
    });

    it('should handle embedding input types correctly', () => {
      // Verify the input type enum is properly typed
      const inputTypes = ['search_document', 'search_query', 'classification', 'clustering'];
      inputTypes.forEach(type => {
        expect(() => {
          // This should not throw a TypeScript error
          provider.embed(['test'], 'embed-english-v3.0', type as any);
        }).not.toThrow();
      });
    });
  });

  describe('Rerank functionality', () => {
    it('should construct proper rerank requests', () => {
      expect(typeof provider.rerank).toBe('function');
      expect(provider.rerank.length).toBe(2); // query, documents required; options is optional
    });

    it('should handle different document formats', () => {
      const simpleDocuments = ['doc1', 'doc2', 'doc3'];
      const complexDocuments = [
        { text: 'doc1', title: 'Title 1', metadata: { category: 'A' } },
        { text: 'doc2', title: 'Title 2', metadata: { category: 'B' } }
      ];

      // Both should be accepted by the rerank method
      expect(() => {
        provider.rerank('query', simpleDocuments);
        provider.rerank('query', complexDocuments);
      }).not.toThrow();
    });
  });

  describe('RAG functionality', () => {
    it('should construct proper RAG requests', () => {
      expect(typeof provider.generateWithRAG).toBe('function');
    });

    it('should handle RAG request options', () => {
      const ragRequest = {
        prompt: 'Test query',
        documents: ['doc1', 'doc2'],
        connectors: [{
          id: 'web-search',
          continue_on_failure: true
        }],
        citationQuality: 'accurate' as const,
        searchQueriesOnly: false
      };

      // Should not throw type errors
      expect(() => {
        provider.generateWithRAG(ragRequest);
      }).not.toThrow();
    });
  });

  describe('Provider identification', () => {
    it('should have correct provider metadata', () => {
      expect(provider.name).toBe('cohere');
      expect(provider.defaultModel).toBe('command-r-plus');
      expect(provider.priority).toBe(3);
    });
  });

  describe('Cost estimation', () => {
    it('should estimate costs for different model types', async () => {
      const textRequest = { prompt: 'Test prompt for text generation' };
      const textCost = await provider.estimateCost(textRequest);
      expect(textCost).toBeGreaterThan(0);

      // Test that embedding models would have lower cost per token
      const embeddingModel = 'embed-english-v3.0';
      const embeddingRequest = { ...textRequest, model: embeddingModel };
      const embeddingCost = await provider.estimateCost(embeddingRequest);
      
      // Embedding models typically have lower cost per token
      expect(embeddingCost).toBeLessThan(textCost);
    });
  });
});

describe('Cohere factory function', () => {
  it('should create provider with API key', () => {
    const provider = createCohereProvider('test-api-key');
    expect(provider).toBeInstanceOf(CohereProvider);
    expect(provider.name).toBe('cohere');
  });

  it('should create provider without API key (uses env)', () => {
    process.env.COHERE_API_KEY = 'env-test-key';
    const provider = createCohereProvider();
    expect(provider).toBeInstanceOf(CohereProvider);
  });
});