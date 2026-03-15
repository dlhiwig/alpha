/**
 * SKYNET Voice Configuration Schema
 * Defines voice capabilities for tactical node deployment
 */

// Type definitions for TTS
export interface TTSOptions {
  voice?: string;
  stability?: number;
  similarity?: number;
  speed?: number;
  pitch?: number;
  format?: 'mp3' | 'wav' | 'ogg';
  quality?: 'low' | 'medium' | 'high';
}

export interface TTSResponse {
  audio: Buffer;
  format: string;
  duration?: number;
  provider: string;
  voiceId?: string;
  metadata?: Record<string, any>;
}

export interface TTSProvider {
  readonly name: string;
  readonly supportedVoices: string[];
  readonly supportedFormats: string[];
  
  initialize(apiKey: string, options?: any): Promise<void>;
  generateSpeech(text: string, options?: TTSOptions): Promise<TTSResponse>;
  listVoices(): Promise<string[]>;
  isHealthy(): Promise<boolean>;
  cleanup?(): Promise<void>;
}

// Type definitions for STT
export interface STTOptions {
  model?: string;
  language?: string;
  temperature?: number;
  noSpeechThreshold?: number;
  logProbThreshold?: number;
  continuous?: boolean;
  punctuate?: boolean;
  profanityFilter?: boolean;
  keywords?: string[];
}

export interface STTResponse {
  text: string;
  confidence?: number;
  language?: string;
  duration?: number;
  provider: string;
  model?: string;
  segments?: Array<{
    text: string;
    start: number;
    end: number;
    confidence?: number;
  }>;
  metadata?: Record<string, any>;
}

export interface STTProvider {
  readonly name: string;
  readonly supportedLanguages: string[];
  readonly supportedFormats: string[];
  
  initialize(apiKey: string, options?: any): Promise<void>;
  transcribeAudio(audio: Buffer, options?: STTOptions): Promise<STTResponse>;
  transcribeStream?(stream: NodeJS.ReadableStream, options?: STTOptions): AsyncGenerator<STTResponse>;
  isHealthy(): Promise<boolean>;
  cleanup?(): Promise<void>;
}

// Voice command interface
export interface VoiceCommand {
  command: string;
  parameters?: Record<string, any>;
  priority: 'low' | 'medium' | 'high' | 'emergency';
  source: 'user' | 'agent' | 'system';
  timestamp: number;
}

export interface VoiceConfig {
  tts: {
    enabled: boolean;
    provider: 'elevenlabs' | 'openai' | 'local';
    defaultVoice?: string;
    options?: {
      stability?: number;
      similarity?: number;
      speed?: number;
      pitch?: number;
    };
    fallbackProvider?: 'elevenlabs' | 'openai' | 'local';
  };

  stt: {
    enabled: boolean;
    provider: 'openai-whisper' | 'deepgram' | 'local-whisper';
    model?: string;
    language?: string;
    continuous?: boolean;
    options?: {
      temperature?: number;
      noSpeechThreshold?: number;
      logProbThreshold?: number;
    };
    fallbackProvider?: 'openai-whisper' | 'local-whisper';
  };

  routing: {
    enableVoiceAuth?: boolean;
    voiceCommandPrefix?: string;
    tacticalNodeAudio?: boolean;
    offlineMode?: boolean;
    emergencyVoiceProtocol?: boolean;
  };

  security: {
    voicePrintAuth?: boolean;
    encryptAudio?: boolean;
    maxRecordingLength?: number;
    allowedCommands?: string[];
    restrictedCommands?: string[];
  };

  deployment: {
    edge?: boolean;
    localModels?: {
      whisper?: string;
      tts?: string;
    };
    cloudFallback?: boolean;
    bandwidthLimit?: number;
  };
}

export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  tts: {
    enabled: true,
    provider: 'elevenlabs',
    defaultVoice: 'Rachel',
    options: {
      stability: 0.5,
      similarity: 0.8,
      speed: 1.0,
      pitch: 1.0
    },
    fallbackProvider: 'openai'
  },

  stt: {
    enabled: true,
    provider: 'openai-whisper',
    model: 'whisper-1',
    language: 'auto',
    continuous: false,
    options: {
      temperature: 0.0,
      noSpeechThreshold: 0.6,
      logProbThreshold: -1.0
    },
    fallbackProvider: 'local-whisper'
  },

  routing: {
    enableVoiceAuth: false,
    voiceCommandPrefix: 'skynet',
    tacticalNodeAudio: true,
    offlineMode: false,
    emergencyVoiceProtocol: true
  },

  security: {
    voicePrintAuth: false,
    encryptAudio: false,
    maxRecordingLength: 30000, // 30 seconds
    allowedCommands: ['status', 'report', 'execute', 'terminate'],
    restrictedCommands: ['delete', 'destroy', 'shutdown']
  },

  deployment: {
    edge: false,
    localModels: {
      whisper: 'whisper-base',
      tts: 'coqui-tts'
    },
    cloudFallback: true,
    bandwidthLimit: 1000000 // 1MB/s
  }
};

/**
 * Validate voice configuration
 */
export function validateVoiceConfig(config: Partial<VoiceConfig>): string[] {
  const errors: string[] = [];

  // TTS validation
  if (config.tts?.enabled && !config.tts.provider) {
    errors.push('TTS enabled but no provider specified');
  }

  // STT validation
  if (config.stt?.enabled && !config.stt.provider) {
    errors.push('STT enabled but no provider specified');
  }

  // Security validation
  if (config.security?.maxRecordingLength && config.security.maxRecordingLength > 300000) {
    errors.push('Maximum recording length cannot exceed 5 minutes for security');
  }

  // Deployment validation
  if (config.deployment?.edge && !config.deployment.localModels) {
    errors.push('Edge deployment requires local models configuration');
  }

  return errors;
}

/**
 * Merge configurations with proper precedence
 */
export function mergeVoiceConfig(base: VoiceConfig, override: Partial<VoiceConfig>): VoiceConfig {
  return {
    ...base,
    ...override,
    tts: { ...base.tts, ...override.tts },
    stt: { ...base.stt, ...override.stt },
    routing: { ...base.routing, ...override.routing },
    security: { ...base.security, ...override.security },
    deployment: { ...base.deployment, ...override.deployment }
  };
}