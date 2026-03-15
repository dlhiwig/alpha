// @ts-nocheck
/**
 * E2E tests for Ollama provider
 * 
 * These tests hit real Ollama - FREE, no API key needed
 * Requires: ollama running locally with a model pulled
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { OllamaProvider, createOllamaProvider } from './ollama';

// Check availability before tests run
const provider = createOllamaProvider();
let ollamaAvailable = false;

beforeAll(async () => {
  ollamaAvailable = await provider.isHealthy();
  console.log(`\n🔍 Ollama available: ${ollamaAvailable}\n`);
});

describe('Ollama Provider E2E', () => {
  it('detects if Ollama is running', async () => {
    expect(typeof ollamaAvailable).toBe('boolean');
  });

  it.skipIf(!ollamaAvailable)('lists available models', async () => {
    const models = await provider.getModels();
    console.log('Available models:', models);
    expect(Array.isArray(models)).toBe(true);
  });

  it.skipIf(!ollamaAvailable)('completes a simple prompt', async () => {
    const result = await provider.generate({
      prompt: 'Say "hello world" and nothing else.',
      maxTokens: 50,
      temperature: 0
    });

    console.log('Response:', result.text);
    console.log('Latency:', result.latency, 'ms');
    console.log('Tokens:', result.tokens);

    expect(result.text.toLowerCase()).toContain('hello');
    expect(result.latency).toBeGreaterThan(0);
    expect(result.cost).toBe(0); // Ollama is free
  }, 30000); // 30s timeout for large models

  it.skipIf(!ollamaAvailable)('handles multi-turn conversation', async () => {
    const result = await provider.generate({
      prompt: 'What is my name?',
      maxTokens: 50,
      context: {
        messages: [
          { role: 'user', content: 'My name is Alice.' },
          { role: 'assistant', content: 'Nice to meet you, Alice!' }
        ]
      }
    });

    console.log('Response:', result.text);
    expect(result.text.toLowerCase()).toContain('alice');
  });

  it.skipIf(!ollamaAvailable)('handles code generation', async () => {
    const result = await provider.generate({
      prompt: 'Write a JavaScript function that adds two numbers. Just the code, no explanation.',
      maxTokens: 100
    });

    console.log('Generated code:', result.text);
    expect(result.text).toMatch(/function|const|=>/);
  });

  it.skipIf(!ollamaAvailable)('respects temperature setting', async () => {
    // Low temperature = more deterministic
    const results = await Promise.all([
      provider.generate({
        prompt: 'Complete: 1, 2, 3, ',
        maxTokens: 10,
        temperature: 0
      }),
      provider.generate({
        prompt: 'Complete: 1, 2, 3, ',
        maxTokens: 10,
        temperature: 0
      })
    ]);

    // With temp=0, responses should be identical
    expect(results[0].text).toBe(results[1].text);
  });

  it.skipIf(!ollamaAvailable)('tracks token usage', async () => {
    const result = await provider.generate({
      prompt: 'Hi',
      maxTokens: 10
    });

    expect(result.tokens.input).toBeGreaterThan(0);
    expect(result.tokens.output).toBeGreaterThan(0);
    expect(result.tokens.input + result.tokens.output).toBeGreaterThan(0);
  }, 30000); // 30s timeout for large models

  it.skipIf(!ollamaAvailable)('checks if model exists', async () => {
    const models = await provider.getModels();
    if (models.length > 0) {
      const modelName = models[0].name;
      const hasModel = await provider.hasModel(modelName);
      expect(hasModel).toBe(true);
    }
  });

  it.skipIf(!ollamaAvailable)('handles model not found gracefully', async () => {
    const hasModel = await provider.hasModel('non-existent-model:999');
    expect(hasModel).toBe(false);
  });

  it.skipIf(!ollamaAvailable)('ensures model availability', async () => {
    const models = await provider.getModels();
    if (models.length > 0) {
      const modelName = models[0].name;
      // This should not throw since the model already exists
      await expect(provider.ensureModel(modelName)).resolves.not.toThrow();
    }
  });
});

describe('Ollama Provider Unit', () => {
  it('creates provider with default config', () => {
    const provider = new OllamaProvider();
    expect(provider.name).toBe('ollama');
  });

  it('creates provider with custom base URL', () => {
    const provider = new OllamaProvider('http://custom:11434');
    expect(provider.name).toBe('ollama');
  });

  it('returns false when Ollama is not running', async () => {
    const provider = new OllamaProvider('http://localhost:99999');
    const available = await provider.isHealthy();
    expect(available).toBe(false);
  });
});
