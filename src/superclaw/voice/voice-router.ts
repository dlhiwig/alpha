/**
 * SKYNET Voice Router
 * Routes voice I/O to appropriate providers with fallback and error handling
 */

import { TTSProvider, TTSProviderFactory } from './tts-provider';
import { STTProvider, STTProviderFactory } from './stt-provider';
import { VoiceConfig, DEFAULT_VOICE_CONFIG, validateVoiceConfig, mergeVoiceConfig, TTSOptions, TTSResponse, STTOptions, STTResponse, VoiceCommand } from './voice-config';

export interface VoiceRouterOptions {
  config?: Partial<VoiceConfig>;
  apiKeys?: {
    elevenlabs?: string;
    openai?: string;
    deepgram?: string;
  };
  fallbackEnabled?: boolean;
  maxRetries?: number;
  timeout?: number;
}

export class VoiceRouter {
  private config: VoiceConfig;
  private ttsProvider?: TTSProvider;
  private sttProvider?: STTProvider;
  private fallbackTTSProvider?: TTSProvider;
  private fallbackSTTProvider?: STTProvider;
  private apiKeys: Record<string, string> = {};
  
  private voiceCommandHandlers: Map<string, (params: any) => Promise<void>> = new Map();
  private emergencyProtocol: boolean = false;
  
  constructor(options: VoiceRouterOptions = {}) {
    this.config = mergeVoiceConfig(DEFAULT_VOICE_CONFIG, options.config || {});
    this.apiKeys = options.apiKeys || {};
    
    // Validate configuration
    const errors = validateVoiceConfig(this.config);
    if (errors.length > 0) {
      throw new Error(`Voice configuration errors: ${errors.join(', ')}`);
    }
  }

  /**
   * Initialize voice providers
   */
  async initialize(): Promise<void> {
    try {
      // Initialize TTS provider
      if (this.config.tts.enabled) {
        await this.initializeTTSProviders();
      }

      // Initialize STT provider
      if (this.config.stt.enabled) {
        await this.initializeSTTProviders();
      }

      // Register default voice commands
      this.registerDefaultCommands();

      console.log('SKYNET Voice Router initialized successfully');
    } catch (error: unknown) {
      console.error('Failed to initialize Voice Router:', error);
      throw error;
    }
  }

  /**
   * Initialize TTS providers (primary + fallback)
   */
  private async initializeTTSProviders(): Promise<void> {
    const { provider, fallbackProvider } = this.config.tts;
    
    // Primary TTS provider
    const primaryApiKey = this.getApiKeyForProvider(provider);
    if (primaryApiKey) {
      this.ttsProvider = await TTSProviderFactory.createProvider(provider, primaryApiKey);
      
      // Test primary provider
      const isHealthy = await this.ttsProvider.isHealthy();
      if (!isHealthy) {
        console.warn(`Primary TTS provider ${provider} is not healthy`);
      }
    }

    // Fallback TTS provider
    if (fallbackProvider && fallbackProvider !== provider) {
      const fallbackApiKey = this.getApiKeyForProvider(fallbackProvider);
      if (fallbackApiKey) {
        this.fallbackTTSProvider = await TTSProviderFactory.createProvider(fallbackProvider, fallbackApiKey);
      }
    }
  }

  /**
   * Initialize STT providers (primary + fallback)
   */
  private async initializeSTTProviders(): Promise<void> {
    const { provider, fallbackProvider } = this.config.stt;
    
    // Primary STT provider
    const primaryApiKey = this.getApiKeyForProvider(provider);
    if (primaryApiKey) {
      this.sttProvider = await STTProviderFactory.createProvider(provider, primaryApiKey);
      
      // Test primary provider
      const isHealthy = await this.sttProvider.isHealthy();
      if (!isHealthy) {
        console.warn(`Primary STT provider ${provider} is not healthy`);
      }
    }

    // Fallback STT provider
    if (fallbackProvider && fallbackProvider !== provider) {
      const fallbackApiKey = this.getApiKeyForProvider(fallbackProvider);
      if (fallbackApiKey) {
        this.fallbackSTTProvider = await STTProviderFactory.createProvider(fallbackProvider, fallbackApiKey);
      }
    }
  }

  /**
   * Generate speech from text
   */
  async generateSpeech(text: string, options: TTSOptions = {}): Promise<TTSResponse> {
    if (!this.config.tts.enabled) {
      throw new Error('TTS is disabled in configuration');
    }

    // Apply default options from config
    const mergedOptions: TTSOptions = {
      voice: this.config.tts.defaultVoice,
      ...this.config.tts.options,
      ...options
    };

    try {
      // Try primary provider
      if (this.ttsProvider) {
        return await this.ttsProvider.generateSpeech(text, mergedOptions);
      }
      
      throw new Error('No TTS provider available');
    } catch (error: unknown) {
      console.warn('Primary TTS provider failed:', error);
      
      // Try fallback provider
      if (this.fallbackTTSProvider) {
        try {
          console.log('Attempting TTS fallback...');
          return await this.fallbackTTSProvider.generateSpeech(text, mergedOptions);
        } catch (fallbackError) {
          console.error('Fallback TTS provider also failed:', fallbackError);
        }
      }
      
      throw new Error(`All TTS providers failed: ${error}`, { cause: error });
    }
  }

  /**
   * Transcribe audio to text
   */
  async transcribeAudio(audio: Buffer, options: STTOptions = {}): Promise<STTResponse> {
    if (!this.config.stt.enabled) {
      throw new Error('STT is disabled in configuration');
    }

    // Apply default options from config
    const mergedOptions: STTOptions = {
      model: this.config.stt.model,
      language: this.config.stt.language,
      ...this.config.stt.options,
      ...options
    };

    try {
      // Try primary provider
      if (this.sttProvider) {
        const response = await this.sttProvider.transcribeAudio(audio, mergedOptions);
        
        // Process voice commands if enabled
        if (this.config.routing.voiceCommandPrefix) {
          await this.processVoiceCommands(response.text);
        }
        
        return response;
      }
      
      throw new Error('No STT provider available');
    } catch (error: unknown) {
      console.warn('Primary STT provider failed:', error);
      
      // Try fallback provider
      if (this.fallbackSTTProvider) {
        try {
          console.log('Attempting STT fallback...');
          const response = await this.fallbackSTTProvider.transcribeAudio(audio, mergedOptions);
          
          // Process voice commands if enabled
          if (this.config.routing.voiceCommandPrefix) {
            await this.processVoiceCommands(response.text);
          }
          
          return response;
        } catch (fallbackError) {
          console.error('Fallback STT provider also failed:', fallbackError);
        }
      }
      
      throw new Error(`All STT providers failed: ${error}`, { cause: error });
    }
  }

  /**
   * Process voice commands from transcribed text
   */
  private async processVoiceCommands(text: string): Promise<void> {
    const prefix = this.config.routing.voiceCommandPrefix!.toLowerCase();
    const lowerText = text.toLowerCase().trim();
    
    if (!lowerText.startsWith(prefix)) {
      return;
    }

    // Extract command after prefix
    const commandText = lowerText.slice(prefix.length).trim();
    const parts = commandText.split(' ');
    const command = parts[0];
    const parameters = parts.slice(1);

    // Security check
    if (this.config.security.restrictedCommands?.includes(command)) {
      console.warn(`Blocked restricted voice command: ${command}`);
      return;
    }

    if (this.config.security.allowedCommands && 
        !this.config.security.allowedCommands.includes(command)) {
      console.warn(`Voice command not in allowlist: ${command}`);
      return;
    }

    // Execute command
    const handler = this.voiceCommandHandlers.get(command);
    if (handler) {
      try {
        await handler({ parameters, text: commandText });
        console.log(`Executed voice command: ${command}`);
      } catch (error: unknown) {
        console.error(`Voice command ${command} failed:`, error);
      }
    } else {
      console.log(`Unknown voice command: ${command}`);
    }
  }

  /**
   * Register voice command handler
   */
  registerCommand(command: string, handler: (params: any) => Promise<void>): void {
    this.voiceCommandHandlers.set(command, handler);
  }

  /**
   * Register default SKYNET voice commands
   */
  private registerDefaultCommands(): void {
    // System status command
    this.registerCommand('status', async (params) => {
      const status = await this.getSystemStatus();
      await this.generateSpeech(`System status: ${status}`);
    });

    // Emergency protocol toggle
    this.registerCommand('emergency', async (params) => {
      this.emergencyProtocol = !this.emergencyProtocol;
      const status = this.emergencyProtocol ? 'activated' : 'deactivated';
      await this.generateSpeech(`Emergency protocol ${status}`);
    });

    // Voice provider health check
    this.registerCommand('health', async (params) => {
      const ttsHealth = this.ttsProvider ? await this.ttsProvider.isHealthy() : false;
      const sttHealth = this.sttProvider ? await this.sttProvider.isHealthy() : false;
      
      const report = `Voice system health: TTS ${ttsHealth ? 'online' : 'offline'}, STT ${sttHealth ? 'online' : 'offline'}`;
      await this.generateSpeech(report);
    });

    // Tactical node audio routing
    this.registerCommand('route', async (params) => {
      if (this.config.routing.tacticalNodeAudio) {
        await this.generateSpeech('Routing audio to tactical nodes');
      } else {
        await this.generateSpeech('Tactical node audio routing is disabled');
      }
    });
  }

  /**
   * Get API key for provider type
   */
  private getApiKeyForProvider(provider: string): string | undefined {
    switch (provider) {
      case 'elevenlabs':
        return this.apiKeys.elevenlabs;
      case 'openai':
        return this.apiKeys.openai;
      case 'deepgram':
        return this.apiKeys.deepgram;
      default:
        return undefined;
    }
  }

  /**
   * Get system status for voice feedback
   */
  private async getSystemStatus(): Promise<string> {
    const ttsStatus = this.ttsProvider ? 'online' : 'offline';
    const sttStatus = this.sttProvider ? 'online' : 'offline';
    const emergencyStatus = this.emergencyProtocol ? 'active' : 'standby';
    
    return `Voice TTS ${ttsStatus}, STT ${sttStatus}, emergency protocol ${emergencyStatus}`;
  }

  /**
   * Get available voices from TTS provider
   */
  async getAvailableVoices(): Promise<string[]> {
    if (!this.ttsProvider) {
      return [];
    }
    
    return await this.ttsProvider.listVoices();
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<VoiceConfig>): void {
    this.config = mergeVoiceConfig(this.config, newConfig);
    
    const errors = validateVoiceConfig(this.config);
    if (errors.length > 0) {
      throw new Error(`Configuration update failed: ${errors.join(', ')}`);
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    await TTSProviderFactory.cleanup();
    await STTProviderFactory.cleanup();
    this.voiceCommandHandlers.clear();
    console.log('Voice Router cleaned up');
  }

  /**
   * Get current configuration
   */
  getConfig(): VoiceConfig {
    return { ...this.config };
  }

  /**
   * Check if emergency protocol is active
   */
  isEmergencyActive(): boolean {
    return this.emergencyProtocol;
  }
}