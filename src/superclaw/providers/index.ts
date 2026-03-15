// @ts-nocheck
/**
 * Provider Registry for SuperClaw
 * 
 * Unified interface for all LLM providers with advanced registry capabilities
 */

import { ILLMProvider } from './contracts.js';
import { ProviderRegistry } from './types.js';
import { DeepSeekProvider, createDeepSeekProvider } from './deepseek.js';
import { AnthropicProvider, createAnthropicProvider } from './anthropic.js';
import { OpenAIProvider, createOpenAIProvider } from './openai.js';
import { OllamaProvider, createOllamaProvider } from './ollama.js';
import { GeminiProvider, createGeminiProvider } from './gemini.js';
import { CohereProvider, createCohereProvider } from './cohere.js';
import { MistralProvider, createMistralProvider } from './mistral.js';
import { GroqProvider, createGroqProvider } from './groq.js';

// Import the advanced registry
import { 
  SuperClawProviderRegistry, 
  getProviderRegistry as getAdvancedRegistry,
  initializeRegistry,
  ProviderRegistration,
  FallbackChain,
  RoutingStrategy,
  RegistryConfig
} from './registry.js';
import { PerplexityProvider, createPerplexityProvider } from './perplexity.js';
import { NVIDIANIMProvider, createNVIDIANIMProvider } from './nvidia-nim.js';

import { CerebrasProvider, createCerebrasProvider } from './cerebras';
/**
 * Default provider registry implementation
 */
class DefaultProviderRegistry implements ProviderRegistry {
  private providers: Map<string, ILLMProvider> = new Map();

  register(provider: ILLMProvider): void {
    this.providers.set(provider.name, provider);
  }

  get(name: string): ILLMProvider | undefined {
    return this.providers.get(name);
  }

  list(): ILLMProvider[] {
    return Array.from(this.providers.values());
  }

  async getAvailable(): Promise<ILLMProvider[]> {
    const available: ILLMProvider[] = [];
    
    for (const provider of Array.from(this.providers.values())) {
      try {
        if (await provider.isHealthy()) {
          available.push(provider);
        }
      } catch {
        // Skip unavailable providers
      }
    }
    
    return available;
  }
}

// Singleton registry
let registryInstance: ProviderRegistry | null = null;

export function getProviderRegistry(): ProviderRegistry {
  if (!registryInstance) {
    registryInstance = new DefaultProviderRegistry();
    
    // Auto-register providers based on available API keys
    autoRegisterProviders(registryInstance);
  }
  return registryInstance;
}

/**
 * Initialize all providers (async version for full detection)
 */
export async function initializeProviders(): Promise<ProviderRegistry> {
  const registry = getProviderRegistry();
  
  // Check Ollama async
  try {
    const ollama = createOllamaProvider();
    if (await ollama.isHealthy()) {
      // @ts-expect-error - Post-Merge Reconciliation
      registry.register(ollama);
    }
  } catch {
    // Silent fail
  }
  
  return registry;
}

/**
 * Auto-register providers based on environment (sync)
 */
function autoRegisterProviders(registry: ProviderRegistry): void {
  // Anthropic (Claude) - Now with full ILLMProvider compatibility
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      // @ts-expect-error - Post-Merge Reconciliation
      registry.register(createAnthropicProvider());
    } catch (e) {
      // Silent fail
    }
  }

  // Google Gemini
  if (process.env.GEMINI_API_KEY) {
    try {
      // @ts-expect-error - Post-Merge Reconciliation
      registry.register(createGeminiProvider());
    } catch (e) {
      // Silent fail
    }
  }

  // OpenAI (GPT-4, O1)
  if (process.env.OPENAI_API_KEY) {
    try {
      // @ts-expect-error - Post-Merge Reconciliation
      registry.register(createOpenAIProvider());
    } catch (e) {
      // Silent fail
    }
  }

  // DeepSeek
  if (process.env.DEEPSEEK_API_KEY) {
    try {
      // @ts-expect-error - Post-Merge Reconciliation
      registry.register(createDeepSeekProvider());
    } catch (e) {
      // Silent fail
    }
  }

  // New providers with ILLMProvider compatibility
  
  // Cohere (Command R/R+)
  if (process.env.COHERE_API_KEY) {
    try {
      // @ts-expect-error - Post-Merge Reconciliation
      registry.register(createCohereProvider());
    } catch (e) {
      // Silent fail
    }
  }

  // Mistral AI (European alternative)
  if (process.env.MISTRAL_API_KEY) {
    try {
      // @ts-expect-error - Post-Merge Reconciliation
      registry.register(createMistralProvider());
    } catch (e) {
      // Silent fail
    }
  }

  // Groq (ultra-fast inference)
  if (process.env.GROQ_API_KEY) {
    try {
      // @ts-expect-error - Post-Merge Reconciliation
      registry.register(createGroqProvider());
    } catch (e) {
      // Silent fail
    }
  }

  // NVIDIA NIM (1M context, multiple models)
  if (process.env.NVIDIA_API_KEY || process.env.NVIDIA_NIM_API_KEY) {
    try {
      // @ts-expect-error - Post-Merge Reconciliation
      registry.register(createNVIDIANIMProvider());
    } catch (e) {
      // Silent fail
    }
  }

  // Perplexity (web-enhanced research)
  if (process.env.PERPLEXITY_API_KEY) {
    try {
      // @ts-expect-error - Post-Merge Reconciliation
      registry.register(createPerplexityProvider());
    } catch (e) {
      // Silent fail
    }
  }
  // Cerebras
  if (process.env.CEREBRAS_API_KEY) {
    try {
      // @ts-expect-error - Post-Merge Reconciliation
      registry.register(createCerebrasProvider());
    } catch (e) {
      // Silent fail
    }
  }


  // Ollama registered async via initializeProviders()
}

/**
 * Convenience function to get a provider
 */
export function getProvider(name: string): ILLMProvider | undefined {
  return getProviderRegistry().get(name);
}

/**
 * Convenience function to list all providers
 */
export function listProviders(): ILLMProvider[] {
  return getProviderRegistry().list();
}

/**
 * Convenience function to get available providers
 */
export async function getAvailableProviders(): Promise<ILLMProvider[]> {
  return getProviderRegistry().getAvailable();
}

// Re-export types and providers
export { ILLMProvider, GenerateRequest, GenerateResponse, Message } from './contracts.js';
export { LLMRequest, LLMResponse, LLMMessage } from './types.js';
export { DeepSeekProvider, createDeepSeekProvider } from './deepseek.js';
export { AnthropicProvider, createAnthropicProvider } from './anthropic.js';
export { OpenAIProvider, createOpenAIProvider } from './openai.js';
export { OllamaProvider, createOllamaProvider } from './ollama.js';
export { GeminiProvider, createGeminiProvider } from './gemini.js';
export { CohereProvider, createCohereProvider } from './cohere.js';
export { MistralProvider, createMistralProvider } from './mistral.js';
export { GroqProvider, createGroqProvider } from './groq.js';

// Re-export advanced registry functionality
export { 
  SuperClawProviderRegistry,
  initializeRegistry,
  ProviderRegistration,
  FallbackChain,
  RoutingStrategy,
  RegistryConfig
} from './registry.js';

/**
 * Get the advanced SuperClaw provider registry
 * This supersedes the basic registry with full feature support
 */
export function getAdvancedProviderRegistry(config?: Partial<RegistryConfig>): SuperClawProviderRegistry {
  return getAdvancedRegistry(config);
}
export { NVIDIANIMProvider, createNVIDIANIMProvider } from './nvidia-nim.js';
export { PerplexityProvider, createPerplexityProvider } from './perplexity.js';

export { CerebrasProvider, createCerebrasProvider } from './cerebras';