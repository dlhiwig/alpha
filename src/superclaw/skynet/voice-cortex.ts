/**
 * 🦊 SKYNET VOICE CORTEX — Voice Memory and Context Management
 * 
 * Voice-specific memory layer that integrates with SKYNET CORTEX for:
 * - Voice command history and patterns
 * - Speaker recognition and profiles
 * - Audio context and conversation threads
 * - Voice authentication and security
 * - Tactical audio routing and emergency protocols
 */

import { memorize, recall, buildContext } from './cortex';
import { VoiceRouter, VoiceConfig, TTSResponse, STTResponse } from '../voice/index';

// ═══════════════════════════════════════════════════════════════
// VOICE MEMORY TYPES
// ═══════════════════════════════════════════════════════════════

export interface VoicePrint {
  speakerId: string;
  name?: string;
  audioFingerprints: Float32Array[];
  confidence: number;
  lastHeard: number;
  voiceCharacteristics: {
    pitch: number;
    tone: string;
    accent?: string;
    speechRate: number;
  };
  permissions: string[];
  trustLevel: 'unknown' | 'guest' | 'user' | 'admin' | 'emergency';
}

export interface VoiceCommand {
  id: string;
  command: string;
  speaker: string;
  timestamp: number;
  confidence: number;
  context: string;
  parameters: Record<string, any>;
  executed: boolean;
  result?: any;
  executionTime?: number;
}

export interface AudioContext {
  sessionId: string;
  conversationThread: string[];
  participants: string[];
  startTime: number;
  lastActivity: number;
  mode: 'interactive' | 'command' | 'emergency' | 'tactical';
  location?: string;
  nodeId?: string;
}

export interface VoiceMemoryEntry {
  id: string;
  type: 'command' | 'conversation' | 'alert' | 'authentication';
  content: {
    audio?: Buffer;
    transcript?: string;
    speaker?: string;
    intent?: string;
  };
  metadata: {
    timestamp: number;
    duration?: number;
    confidence?: number;
    location?: string;
    nodeId?: string;
    priority: 'low' | 'medium' | 'high' | 'emergency';
  };
  classification?: {
    sentiment?: 'positive' | 'negative' | 'neutral';
    urgency?: number;
    securityLevel?: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// VOICE CORTEX CLASS
// ═══════════════════════════════════════════════════════════════

export class VoiceCortex {
  private voiceRouter?: VoiceRouter;
  private memoryNamespace = 'voice';
  private speakerProfiles = new Map<string, VoicePrint>();
  private activeContexts = new Map<string, AudioContext>();
  private commandHistory: VoiceCommand[] = [];
  
  private emergencyMode = false;
  private tacticalNodes = new Set<string>();
  private authenticationRequired = false;

  constructor(voiceRouter?: VoiceRouter) {
    this.voiceRouter = voiceRouter;
  }

  // ═══════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════

  async initialize(config?: Partial<VoiceConfig>): Promise<void> {
    // Load existing voice memories
    await this.loadVoiceMemories();
    
    // Load speaker profiles
    await this.loadSpeakerProfiles();
    
    // Initialize voice router if not provided
    if (!this.voiceRouter && config) {
      const { VoiceRouter } = await import('../voice/index.js');
      this.voiceRouter = new VoiceRouter({ config });
      await this.voiceRouter.initialize();
    }

    // Register voice command handlers
    if (this.voiceRouter) {
      this.registerVoiceCommands();
    }

    console.log('SKYNET Voice Cortex initialized');
  }

  // ═══════════════════════════════════════════════════════════════
  // MEMORY MANAGEMENT
  // ═══════════════════════════════════════════════════════════════

  /**
   * Store voice interaction in memory
   */
  async memorizeVoiceInteraction(entry: Omit<VoiceMemoryEntry, 'id'>): Promise<string> {
    const id = `voice_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const memoryEntry: VoiceMemoryEntry = {
      id,
      ...entry
    };

    // Store in SKYNET CORTEX
    // @ts-expect-error - Post-Merge Reconciliation
    await memorize({
      id,
      type: 'voice_interaction',
      content: memoryEntry,
      namespace: this.memoryNamespace,
      metadata: {
        timestamp: entry.metadata.timestamp,
        priority: entry.metadata.priority,
        speaker: entry.content.speaker,
        location: entry.metadata.location
      }
    });

    // Add to local cache for quick access
    if (entry.type === 'command') {
      this.addToCommandHistory(memoryEntry);
    }

    return id;
  }

  /**
   * Recall voice memories by criteria
   */
  async recallVoiceMemories(criteria: {
    speaker?: string;
    type?: string;
    timeRange?: [number, number];
    location?: string;
    priority?: string;
    limit?: number;
  }): Promise<VoiceMemoryEntry[]> {
    const searchTerms = [];
    
    if (criteria.speaker) searchTerms.push(`speaker:${criteria.speaker}`);
    if (criteria.type) searchTerms.push(`type:${criteria.type}`);
    if (criteria.location) searchTerms.push(`location:${criteria.location}`);
    if (criteria.priority) searchTerms.push(`priority:${criteria.priority}`);

    // @ts-expect-error - Post-Merge Reconciliation
    const results = await recall(searchTerms.join(' AND '), this.memoryNamespace);
    
    // Filter by time range if specified
    let filtered = results;
    if (criteria.timeRange) {
      const [start, end] = criteria.timeRange;
      filtered = results.filter(r => {
        // @ts-expect-error - Post-Merge Reconciliation
        const timestamp = (r.content as VoiceMemoryEntry).metadata.timestamp;
        return timestamp >= start && timestamp <= end;
      });
    }

    // Limit results
    if (criteria.limit) {
      filtered = filtered.slice(0, criteria.limit);
    }

    // @ts-expect-error - Post-Merge Reconciliation
    return filtered.map(r => r.content as VoiceMemoryEntry);
  }

  // ═══════════════════════════════════════════════════════════════
  // SPEAKER RECOGNITION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Analyze audio for speaker identification
   */
  async identifySpeaker(audio: Buffer): Promise<VoicePrint | null> {
    // This would integrate with speaker recognition service
    // For now, returning a placeholder implementation
    
    // Extract basic audio characteristics
    const characteristics = await this.extractAudioCharacteristics(audio);
    
    // Compare against known speaker profiles
    for (const [speakerId, profile] of this.speakerProfiles) {
      const similarity = this.calculateVoiceSimilarity(characteristics, profile);
      
      if (similarity > 0.8) {
        // Update last heard
        profile.lastHeard = Date.now();
        await this.updateSpeakerProfile(profile);
        return profile;
      }
    }

    return null;
  }

  /**
   * Register new speaker profile
   */
  async registerSpeaker(
    speakerId: string,
    audio: Buffer,
    metadata: {
      name?: string;
      trustLevel?: VoicePrint['trustLevel'];
      permissions?: string[];
    }
  ): Promise<VoicePrint> {
    const characteristics = await this.extractAudioCharacteristics(audio);
    
    const profile: VoicePrint = {
      speakerId,
      name: metadata.name,
      audioFingerprints: [characteristics.fingerprint],
      confidence: 1.0,
      lastHeard: Date.now(),
      voiceCharacteristics: characteristics.voice,
      permissions: metadata.permissions || [],
      trustLevel: metadata.trustLevel || 'user'
    };

    this.speakerProfiles.set(speakerId, profile);
    
    // Store in memory
    // @ts-expect-error - Post-Merge Reconciliation
    await memorize({
      id: `speaker_profile_${speakerId}`,
      type: 'speaker_profile',
      content: profile,
      namespace: this.memoryNamespace
    });

    return profile;
  }

  // ═══════════════════════════════════════════════════════════════
  // AUDIO CONTEXT MANAGEMENT
  // ═══════════════════════════════════════════════════════════════

  /**
   * Start new audio context session
   */
  startAudioContext(sessionId: string, mode: AudioContext['mode'], nodeId?: string): AudioContext {
    const context: AudioContext = {
      sessionId,
      conversationThread: [],
      participants: [],
      startTime: Date.now(),
      lastActivity: Date.now(),
      mode,
      nodeId
    };

    this.activeContexts.set(sessionId, context);
    return context;
  }

  /**
   * Add utterance to audio context
   */
  addToAudioContext(sessionId: string, utterance: string, speaker?: string): void {
    const context = this.activeContexts.get(sessionId);
    if (!context) return;

    context.conversationThread.push(utterance);
    if (speaker && !context.participants.includes(speaker)) {
      context.participants.push(speaker);
    }
    context.lastActivity = Date.now();
  }

  /**
   * Build contextual prompt from audio history
   */
  async buildVoiceContext(sessionId: string, lookback: number = 10): Promise<string> {
    const context = this.activeContexts.get(sessionId);
    if (!context) return '';

    const recentUtterances = context.conversationThread.slice(-lookback);
    const voiceMemories = await this.recallVoiceMemories({
      timeRange: [context.startTime, Date.now()],
      limit: 5
    });

    // @ts-expect-error - Post-Merge Reconciliation
    return buildContext({
      currentSession: recentUtterances.join('\n'),
      voiceHistory: voiceMemories.map(m => m.content.transcript).join('\n'),
      participants: context.participants,
      mode: context.mode
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // TACTICAL OPERATIONS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Activate emergency voice protocol
   */
  async activateEmergencyProtocol(): Promise<void> {
    this.emergencyMode = true;
    
    // Broadcast emergency activation to all tactical nodes
    for (const nodeId of this.tacticalNodes) {
      await this.memorizeVoiceInteraction({
        type: 'alert',
        content: {
          transcript: 'Emergency protocol activated',
          intent: 'emergency_activation'
        },
        metadata: {
          timestamp: Date.now(),
          priority: 'emergency',
          nodeId
        }
      });
    }

    console.log('🚨 SKYNET Emergency Voice Protocol ACTIVATED');
  }

  /**
   * Register tactical node for voice routing
   */
  registerTacticalNode(nodeId: string): void {
    this.tacticalNodes.add(nodeId);
    console.log(`Tactical node ${nodeId} registered for voice routing`);
  }

  /**
   * Route voice command to tactical node
   */
  async routeToTacticalNode(nodeId: string, command: VoiceCommand): Promise<void> {
    if (!this.tacticalNodes.has(nodeId)) {
      throw new Error(`Tactical node ${nodeId} not registered`);
    }

    await this.memorizeVoiceInteraction({
      type: 'command',
      content: {
        transcript: command.command,
        speaker: command.speaker,
        intent: 'tactical_routing'
      },
      metadata: {
        timestamp: command.timestamp,
        priority: this.emergencyMode ? 'emergency' : 'high',
        nodeId
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // COMMAND PROCESSING
  // ═══════════════════════════════════════════════════════════════

  private registerVoiceCommands(): void {
    if (!this.voiceRouter) return;

    // Register SKYNET-specific voice commands
    this.voiceRouter.registerCommand('cortex', async (params) => {
      const { parameters } = params;
      
      if (parameters[0] === 'recall') {
        const query = parameters.slice(1).join(' ');
        const memories = await this.recallVoiceMemories({ limit: 5 });
        const summary = `Found ${memories.length} voice memories`;
        await this.voiceRouter!.generateSpeech(summary);
      }
    });

    this.voiceRouter.registerCommand('tactical', async (params) => {
      const { parameters } = params;
      const nodeId = parameters[0];
      
      if (nodeId && this.tacticalNodes.has(nodeId)) {
        await this.voiceRouter!.generateSpeech(`Connecting to tactical node ${nodeId}`);
      } else {
        await this.voiceRouter!.generateSpeech('Tactical node not found or not registered');
      }
    });
  }

  private addToCommandHistory(entry: VoiceMemoryEntry): void {
    if (entry.type === 'command' && entry.content.transcript) {
      const command: VoiceCommand = {
        id: entry.id,
        command: entry.content.transcript,
        speaker: entry.content.speaker || 'unknown',
        timestamp: entry.metadata.timestamp,
        confidence: entry.metadata.confidence || 0.5,
        context: '',
        parameters: {},
        executed: true
      };

      this.commandHistory.push(command);
      
      // Keep only last 100 commands in memory
      if (this.commandHistory.length > 100) {
        this.commandHistory = this.commandHistory.slice(-100);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════

  private async loadVoiceMemories(): Promise<void> {
    try {
      // @ts-expect-error - Post-Merge Reconciliation
      const memories = await recall('type:voice_interaction', this.memoryNamespace);
      console.log(`Loaded ${memories.length} voice memories`);
    } catch (error: unknown) {
      console.warn('Failed to load voice memories:', error);
    }
  }

  private async loadSpeakerProfiles(): Promise<void> {
    try {
      // @ts-expect-error - Post-Merge Reconciliation
      const profiles = await recall('type:speaker_profile', this.memoryNamespace);
      
      for (const result of profiles) {
        // @ts-expect-error - Post-Merge Reconciliation
        const profile = result.content as VoicePrint;
        this.speakerProfiles.set(profile.speakerId, profile);
      }
      
      console.log(`Loaded ${this.speakerProfiles.size} speaker profiles`);
    } catch (error: unknown) {
      console.warn('Failed to load speaker profiles:', error);
    }
  }

  private async updateSpeakerProfile(profile: VoicePrint): Promise<void> {
    // @ts-expect-error - Post-Merge Reconciliation
    await memorize({
      id: `speaker_profile_${profile.speakerId}`,
      type: 'speaker_profile',
      content: profile,
      namespace: this.memoryNamespace
    });
  }

  private async extractAudioCharacteristics(audio: Buffer): Promise<{
    fingerprint: Float32Array;
    voice: VoicePrint['voiceCharacteristics'];
  }> {
    // Placeholder implementation - would integrate with audio processing library
    const mockFingerprint = new Float32Array(128).fill(Math.random());
    
    return {
      fingerprint: mockFingerprint,
      voice: {
        pitch: Math.random() * 500 + 100, // Hz
        tone: 'neutral',
        speechRate: Math.random() * 200 + 100 // words per minute
      }
    };
  }

  private calculateVoiceSimilarity(
    characteristics: { fingerprint: Float32Array },
    profile: VoicePrint
  ): number {
    // Simplified similarity calculation - would use proper audio fingerprinting
    return Math.random() * 0.5 + 0.5; // Mock similarity between 0.5-1.0
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC GETTERS
  // ═══════════════════════════════════════════════════════════════

  getActiveContexts(): Map<string, AudioContext> {
    return new Map(this.activeContexts);
  }

  getCommandHistory(): VoiceCommand[] {
    return [...this.commandHistory];
  }

  getSpeakerProfiles(): Map<string, VoicePrint> {
    return new Map(this.speakerProfiles);
  }

  isEmergencyMode(): boolean {
    return this.emergencyMode;
  }

  getTacticalNodes(): Set<string> {
    return new Set(this.tacticalNodes);
  }
}