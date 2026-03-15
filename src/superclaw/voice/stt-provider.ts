/**
 * SKYNET Speech-to-Text Provider Abstraction
 * Unified interface for multiple STT providers
 */

import { STTOptions, STTResponse, STTProvider } from './voice-config';

// Re-export types for convenience
export type { STTOptions, STTResponse, STTProvider };

/**
 * OpenAI Whisper STT Provider
 */
export class OpenAIWhisperProvider implements STTProvider {
  readonly name = 'openai-whisper';
  readonly supportedLanguages = [
    'auto', 'en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh',
    'ar', 'hi', 'th', 'vi', 'id', 'ms', 'tl', 'tr', 'he', 'pl', 'nl'
  ];
  readonly supportedFormats = ['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm'];

  private apiKey: string = '';
  private baseUrl = 'https://api.openai.com/v1';

  async initialize(apiKey: string, options?: any): Promise<void> {
    this.apiKey = apiKey;
    if (options?.baseUrl) {
      this.baseUrl = options.baseUrl;
    }
  }

  async transcribeAudio(audio: Buffer, options: STTOptions = {}): Promise<STTResponse> {
    const formData = new FormData();
    
    // Create a blob from the audio buffer (convert Buffer to Uint8Array for Web API compatibility)
    const audioBlob = new Blob([new Uint8Array(audio)], { type: 'audio/wav' });
    formData.append('file', audioBlob, 'audio.wav');
    formData.append('model', options.model || 'whisper-1');
    
    if (options.language && options.language !== 'auto') {
      formData.append('language', options.language);
    }
    
    if (options.temperature !== undefined) {
      formData.append('temperature', options.temperature.toString());
    }

    const response = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: formData
    });

    if (!response.ok) {
      throw new Error(`OpenAI Whisper transcription failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json() as {
      text: string;
      language?: string;
      duration?: number;
    };
    
    return {
      text: result.text,
      language: result.language,
      provider: this.name,
      model: options.model || 'whisper-1',
      metadata: {
        temperature: options.temperature || 0.0,
        duration: result.duration
      }
    };
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` }
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * Deepgram STT Provider
 */
export class DeepgramProvider implements STTProvider {
  readonly name = 'deepgram';
  readonly supportedLanguages = [
    'en', 'en-US', 'en-GB', 'en-AU', 'en-IN', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh'
  ];
  readonly supportedFormats = ['wav', 'mp3', 'mp4', 'flac', 'aac', 'ogg', 'webm'];

  private apiKey: string = '';
  private baseUrl = 'https://api.deepgram.com/v1';

  async initialize(apiKey: string, options?: any): Promise<void> {
    this.apiKey = apiKey;
    if (options?.baseUrl) {
      this.baseUrl = options.baseUrl;
    }
  }

  async transcribeAudio(audio: Buffer, options: STTOptions = {}): Promise<STTResponse> {
    const params = new URLSearchParams();
    
    if (options.model) {
      params.append('model', options.model);
    }
    
    if (options.language) {
      params.append('language', options.language);
    }
    
    if (options.punctuate) {
      params.append('punctuate', 'true');
    }
    
    if (options.profanityFilter) {
      params.append('profanity_filter', 'true');
    }

    const response = await fetch(`${this.baseUrl}/listen?${params}`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${this.apiKey}`,
        'Content-Type': 'audio/wav'
      },
      body: new Uint8Array(audio)
    });

    if (!response.ok) {
      throw new Error(`Deepgram transcription failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json() as {
      results: {
        channels: Array<{
          alternatives: Array<{
            transcript: string;
            confidence: number;
            words?: Array<{
              word: string;
              start: number;
              end: number;
              confidence: number;
            }>;
          }>;
        }>;
      };
      metadata?: {
        duration?: number;
      };
    };
    
    const transcript = result.results?.channels?.[0]?.alternatives?.[0];
    
    if (!transcript) {
      throw new Error('No transcript found in Deepgram response');
    }

    return {
      text: transcript.transcript,
      confidence: transcript.confidence,
      provider: this.name,
      model: options.model || 'general',
      segments: transcript.words?.map((word) => ({
        text: word.word,
        start: word.start,
        end: word.end,
        confidence: word.confidence
      })),
      metadata: {
        channels: result.results.channels.length,
        duration: result.metadata?.duration
      }
    };
  }

  async *transcribeStream(stream: NodeJS.ReadableStream, options: STTOptions = {}): AsyncGenerator<STTResponse> {
    // Deepgram streaming implementation would go here
    // This is a placeholder for the streaming interface
    throw new Error('Deepgram streaming not implemented yet');
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/projects`, {
        headers: { 'Authorization': `Token ${this.apiKey}` }
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * Local Whisper STT Provider
 */
export class LocalWhisperProvider implements STTProvider {
  readonly name = 'local-whisper';
  readonly supportedLanguages = [
    'auto', 'en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh'
  ];
  readonly supportedFormats = ['wav', 'mp3', 'flac', 'ogg'];

  private initialized = false;
  private whisperPath: string = '';
  private modelPath: string = '';

  async initialize(apiKey: string, options?: any): Promise<void> {
    this.whisperPath = options?.whisperPath || '/usr/local/bin/whisper';
    this.modelPath = options?.modelPath || './models/whisper';
    this.initialized = true;
  }

  async transcribeAudio(audio: Buffer, options: STTOptions = {}): Promise<STTResponse> {
    if (!this.initialized) {
      throw new Error('Local Whisper provider not initialized');
    }

    // This would integrate with local Whisper installation
    // For now, returning placeholder implementation
    throw new Error('Local Whisper provider requires system integration - not fully implemented');
  }

  async isHealthy(): Promise<boolean> {
    try {
      const fs = await import('fs/promises');
      await fs.access(this.whisperPath);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * STT Provider Factory
 */
export class STTProviderFactory {
  private static providers: Record<string, STTProvider> = {};

  static async createProvider(
    type: 'openai-whisper' | 'deepgram' | 'local-whisper',
    apiKey: string,
    options?: any
  ): Promise<STTProvider> {
    const key = `${type}-${apiKey.slice(-8)}`;
    
    if (!this.providers[key]) {
      let provider: STTProvider;
      
      switch (type) {
        case 'openai-whisper':
          provider = new OpenAIWhisperProvider();
          break;
        case 'deepgram':
          provider = new DeepgramProvider();
          break;
        case 'local-whisper':
          provider = new LocalWhisperProvider();
          break;
        default:
          throw new Error(`Unsupported STT provider: ${type}`);
      }
      
      await provider.initialize(apiKey, options);
      this.providers[key] = provider;
    }
    
    return this.providers[key];
  }

  static async cleanup(): Promise<void> {
    for (const provider of Object.values(this.providers)) {
      if (provider.cleanup) {
        await provider.cleanup();
      }
    }
    this.providers = {};
  }
}