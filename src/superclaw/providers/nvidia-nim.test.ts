// @ts-nocheck
/**
 * Tests for NVIDIA NIM Provider
 */

import { NVIDIANIMProvider, createNVIDIANIMProvider, NVIDIA_NIM_MODELS, NVIDIA_NIM_ROLES } from './nvidia-nim';
import { ModelCapability } from './contracts';

describe('NVIDIANIMProvider', () => {
  let provider: NVIDIANIMProvider;
  
  beforeEach(() => {
    // Use a test API key
    provider = new NVIDIANIMProvider({
      apiKey: 'test-key'
    });
  });

  test('should have correct provider metadata', () => {
    expect(provider.name).toBe('nvidia-nim');
    expect(provider.type).toBe('cloud');
    expect(provider.priority).toBe(2);
    expect(provider.defaultModel).toBe('moonshotai/kimi-k2.5');
  });

  test('should support all NVIDIA NIM models', async () => {
    const models = await provider.getModels();
    
    expect(models).toHaveLength(5);
    expect(models.map(m => m.name)).toContain(NVIDIA_NIM_MODELS.KIMI_K25);
    expect(models.map(m => m.name)).toContain(NVIDIA_NIM_MODELS.NEMOTRON);
    expect(models.map(m => m.name)).toContain(NVIDIA_NIM_MODELS.GLM5);
    expect(models.map(m => m.name)).toContain(NVIDIA_NIM_MODELS.COSMOS);
    expect(models.map(m => m.name)).toContain(NVIDIA_NIM_MODELS.QWEN);
  });

  test('should correctly identify Nemotron as 1M context model', async () => {
    const models = await provider.getModels();
    const nemotron = models.find(m => m.name === NVIDIA_NIM_MODELS.NEMOTRON);
    
    expect(nemotron).toBeDefined();
    expect(nemotron!.contextLength).toBe(1000000);
    expect(nemotron!.capabilities).toContain(ModelCapability.LONG_CONTEXT);
  });

  test('should support long context capability', () => {
    expect(provider.supportsLongContext(NVIDIA_NIM_MODELS.NEMOTRON)).toBe(true);
    expect(provider.supportsLongContext(NVIDIA_NIM_MODELS.KIMI_K25)).toBe(true);
    expect(provider.supportsLongContext(NVIDIA_NIM_MODELS.COSMOS)).toBe(false);
  });

  test('should return best model for capabilities', () => {
    expect(provider.getBestModelForCapability(ModelCapability.LONG_CONTEXT))
      .toBe(NVIDIA_NIM_MODELS.NEMOTRON);
    
    expect(provider.getBestModelForCapability(ModelCapability.VISION))
      .toBe(NVIDIA_NIM_MODELS.QWEN);
    
    expect(provider.getBestModelForCapability(ModelCapability.CODE_GENERATION))
      .toBe(NVIDIA_NIM_MODELS.NEMOTRON);
  });

  test('should handle capability-based routing correctly', () => {
    const context = {
      requestId: 'test',
      priority: 'normal' as const,
      requiredCapabilities: [ModelCapability.LONG_CONTEXT]
    };
    
    const request = {
      model: NVIDIA_NIM_MODELS.NEMOTRON,
      prompt: 'test prompt'
    };
    
    expect(provider.canHandle(request, context)).toBe(true);
  });

  test('should estimate costs correctly', async () => {
    const request = {
      prompt: 'This is a test prompt',
      maxTokens: 1000
    };
    
    const cost = await provider.estimateCost(request);
    expect(cost).toBeGreaterThan(0);
  });

  test('should have correct role mappings', () => {
    expect(NVIDIA_NIM_ROLES.longcontext).toBe(NVIDIA_NIM_MODELS.NEMOTRON);
    expect(NVIDIA_NIM_ROLES.agentic).toBe(NVIDIA_NIM_MODELS.GLM5);
    expect(NVIDIA_NIM_ROLES.physical).toBe(NVIDIA_NIM_MODELS.COSMOS);
    expect(NVIDIA_NIM_ROLES.vision).toBe(NVIDIA_NIM_MODELS.QWEN);
    expect(NVIDIA_NIM_ROLES.default).toBe(NVIDIA_NIM_MODELS.KIMI_K25);
  });
});

describe('createNVIDIANIMProvider factory', () => {
  test('should create provider with API key', () => {
    const provider = createNVIDIANIMProvider('test-key');
    expect(provider).toBeInstanceOf(NVIDIANIMProvider);
  });

  test('should throw error without API key', () => {
    // Clear env vars for test
    const oldKey = process.env.NVIDIA_API_KEY;
    const oldNIMKey = process.env.NVIDIA_NIM_API_KEY;
    delete process.env.NVIDIA_API_KEY;
    delete process.env.NVIDIA_NIM_API_KEY;
    
    expect(() => createNVIDIANIMProvider()).toThrow('NVIDIA NIM API key required');
    
    // Restore env vars
    if (oldKey) {process.env.NVIDIA_API_KEY = oldKey;}
    if (oldNIMKey) {process.env.NVIDIA_NIM_API_KEY = oldNIMKey;}
  });
});