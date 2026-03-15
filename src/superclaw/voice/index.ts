/**
 * SKYNET Voice Module
 * Unified voice interface for SuperClaw tactical deployments
 */

// Core interfaces and types
export type {
  VoiceConfig,
  TTSOptions,
  TTSResponse,
  TTSProvider,
  STTOptions,
  STTResponse,
  STTProvider,
  VoiceCommand
} from './voice-config';
export type { VoiceRouterOptions } from './voice-router';

// Configuration
export {
  DEFAULT_VOICE_CONFIG,
  validateVoiceConfig,
  mergeVoiceConfig
} from './voice-config';

// TTS Providers
export {
  ElevenLabsTTSProvider,
  OpenAITTSProvider,
  LocalTTSProvider,
  TTSProviderFactory
} from './tts-provider';

// STT Providers
export {
  OpenAIWhisperProvider,
  DeepgramProvider,
  LocalWhisperProvider,
  STTProviderFactory
} from './stt-provider';

// Main voice router
export { VoiceRouter } from './voice-router';
import { VoiceRouter } from './voice-router';

/**
 * SKYNET Voice System Factory
 * Simplified initialization for common use cases
 */
export class SkynetVoice {
  private static instance?: VoiceRouter;

  /**
   * Initialize SKYNET Voice with OpenClaw configuration
   */
  static async initializeWithOpenClaw(openClawConfig: any): Promise<VoiceRouter> {
    const apiKeys = {
      elevenlabs: openClawConfig.talk?.apiKey || openClawConfig.skills?.entries?.sag?.apiKey,
      openai: openClawConfig.skills?.entries?.['openai-whisper-api']?.apiKey
    };

    const voiceConfig = {
      tts: {
        enabled: !!apiKeys.elevenlabs,
        provider: 'elevenlabs' as const,
        defaultVoice: 'Rachel'
      },
      stt: {
        enabled: !!apiKeys.openai,
        provider: 'openai-whisper' as const,
        model: 'whisper-1'
      },
      routing: {
        voiceCommandPrefix: 'skynet',
        tacticalNodeAudio: true,
        emergencyVoiceProtocol: true
      }
    };

    const router = new VoiceRouter({
      config: voiceConfig,
      apiKeys
    });

    await router.initialize();
    this.instance = router;
    return router;
  }

  /**
   * Initialize SKYNET Voice with custom configuration
   */
  static async initializeCustom(
    config: Partial<import('./voice-config.js').VoiceConfig>,
    apiKeys: Record<string, string>
  ): Promise<VoiceRouter> {
    const router = new VoiceRouter({
      config,
      apiKeys
    });

    await router.initialize();
    this.instance = router;
    return router;
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): VoiceRouter | undefined {
    return this.instance;
  }

  /**
   * Quick TTS - generate speech without full initialization
   */
  static async quickTTS(text: string, apiKey: string, voice?: string): Promise<Buffer> {
    const { ElevenLabsTTSProvider } = await import('./tts-provider.js');
    
    const provider = new ElevenLabsTTSProvider();
    await provider.initialize(apiKey);
    
    const response = await provider.generateSpeech(text, { voice });
    return response.audio;
  }

  /**
   * Quick STT - transcribe audio without full initialization
   */
  static async quickSTT(audio: Buffer, apiKey: string): Promise<string> {
    const { OpenAIWhisperProvider } = await import('./stt-provider.js');
    
    const provider = new OpenAIWhisperProvider();
    await provider.initialize(apiKey);
    
    const response = await provider.transcribeAudio(audio);
    return response.text;
  }

  /**
   * Cleanup singleton instance
   */
  static async cleanup(): Promise<void> {
    if (this.instance) {
      await this.instance.cleanup();
      this.instance = undefined;
    }
  }
}