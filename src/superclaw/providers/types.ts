// @ts-nocheck
/**
 * Common types for all LLM providers
 */

import { ILLMProvider } from './contracts';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMRequest {
  messages: LLMMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface LLMResponse {
  provider: string;
  model: string;
  content: string;
  usage: LLMUsage;
  latencyMs: number;
  cost?: number;
}

export interface LLMProvider {
  name: string;
  
  /**
   * Check if provider is available and configured
   */
  isAvailable(): Promise<boolean>;
  
  /**
   * Send a completion request
   */
  complete(request: LLMRequest): Promise<LLMResponse>;
  
  /**
   * Get available models for this provider
   */
  getModels(): string[] | Promise<string[]>;
}

/**
 * Provider registry for dynamic provider management
 */
export interface ProviderRegistry {
  register(provider: ILLMProvider): void;
  get(name: string): ILLMProvider | undefined;
  list(): ILLMProvider[];
  getAvailable(): Promise<ILLMProvider[]>;
}
