/**
 * LLM Provider Abstraction
 * Supports Claude (Anthropic) and Ollama (local) backends
 */

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  durationMs: number;
}

export interface LLMProviderConfig {
  provider: 'claude' | 'ollama' | 'openai';
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMProvider {
  name: string;
  complete(messages: LLMMessage[], config?: Partial<LLMProviderConfig>): Promise<LLMResponse>;
}

// ============================================================================
// Claude Provider (Anthropic)
// ============================================================================

export class ClaudeProvider implements LLMProvider {
  name = 'claude';
  private apiKey: string;
  private model: string;
  private maxTokens: number;

  constructor(config: { apiKey?: string; model?: string; maxTokens?: number } = {}) {
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY || '';
    this.model = config.model || 'claude-sonnet-4-20250514';
    this.maxTokens = config.maxTokens || 4096;

    if (!this.apiKey) {
      throw new Error('ANTHROPIC_API_KEY required for Claude provider');
    }
  }

  async complete(messages: LLMMessage[], config?: Partial<LLMProviderConfig>): Promise<LLMResponse> {
    const startTime = Date.now();
    const model = config?.model || this.model;
    const maxTokens = config?.maxTokens || this.maxTokens;

    // Separate system message from conversation
    const systemMessage = messages.find(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      messages: conversationMessages.map(m => ({
        role: m.role,
        content: m.content
      }))
    };

    if (systemMessage) {
      body.system = systemMessage.content;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Claude API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      content?: Array<{ text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const durationMs = Date.now() - startTime;

    return {
      content: data.content?.[0]?.text || '',
      model,
      usage: {
        inputTokens: data.usage?.input_tokens || 0,
        outputTokens: data.usage?.output_tokens || 0
      },
      durationMs
    };
  }
}

// ============================================================================
// Ollama Provider (Local)
// ============================================================================

export class OllamaProvider implements LLMProvider {
  name = 'ollama';
  private baseUrl: string;
  private model: string;

  constructor(config: { baseUrl?: string; model?: string } = {}) {
    this.baseUrl = config.baseUrl || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
    this.model = config.model || 'dolphin-llama3:8b';
  }

  async complete(messages: LLMMessage[], config?: Partial<LLMProviderConfig>): Promise<LLMResponse> {
    const startTime = Date.now();
    const model = config?.model || this.model;

    // Ollama uses OpenAI-compatible /v1/chat/completions
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content
        })),
        stream: false
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const durationMs = Date.now() - startTime;

    return {
      content: data.choices?.[0]?.message?.content || '',
      model,
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0
      },
      durationMs
    };
  }
}

// ============================================================================
// OpenAI-Compatible Provider (for other backends)
// ============================================================================

export class OpenAIProvider implements LLMProvider {
  name = 'openai';
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(config: { apiKey?: string; baseUrl?: string; model?: string } = {}) {
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || '';
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
    this.model = config.model || 'gpt-4o';
  }

  async complete(messages: LLMMessage[], config?: Partial<LLMProviderConfig>): Promise<LLMResponse> {
    const startTime = Date.now();
    const model = config?.model || this.model;

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content
        }))
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const durationMs = Date.now() - startTime;

    return {
      content: data.choices?.[0]?.message?.content || '',
      model,
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0
      },
      durationMs
    };
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createProvider(config: LLMProviderConfig): LLMProvider {
  switch (config.provider) {
    case 'claude':
      return new ClaudeProvider({
        apiKey: config.apiKey,
        model: config.model,
        maxTokens: config.maxTokens
      });
    case 'ollama':
      return new OllamaProvider({
        baseUrl: config.baseUrl,
        model: config.model
      });
    case 'openai':
      return new OpenAIProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model
      });
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

// Default provider based on environment
export function getDefaultProvider(): LLMProvider {
  // Prefer Claude if API key is set
  if (process.env.ANTHROPIC_API_KEY) {
    return new ClaudeProvider();
  }
  
  // Fall back to Ollama for local inference
  return new OllamaProvider();
}
