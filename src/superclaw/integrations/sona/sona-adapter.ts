// @ts-nocheck
/**
 * SONA Adapter for SuperClaw Integration
 * 
 * Integrates SONA (Self-Optimizing Neural Architecture) with SuperClaw's swarm system.
 * Provides learning-enhanced routing, pattern-based optimization, and outcome feedback.
 * 
 * Key Features:
 * - Task embedding generation and optimization
 * - Model routing with learned patterns
 * - Swarm outcome feedback integration
 * - Performance monitoring and statistics
 * - Graceful fallback when SONA is unavailable
 * 
 * Integration Points:
 * - SwarmService: Task routing and outcome feedback
 * - ModelRouter: Pattern-enhanced model selection
 * - QualityAssessor: Learning from quality metrics
 */

import { EventEmitter } from 'events';
import { SonaEngine, type SonaConfig, type TaskEmbedding, type LearningOutcome } from './sona-engine';
import { logger } from '../../utils/logger';

export interface SonaAdapterConfig {
  /** Enable SONA learning (default: true) */
  enabled?: boolean;
  /** SONA engine configuration */
  sonaConfig?: SonaConfig;
  /** Embedding service provider (default: 'simple') */
  embeddingProvider?: 'simple' | 'openai' | 'local';
  /** Minimum task complexity to trigger SONA (default: 0.2) */
  minComplexity?: number;
  /** Learning rate adjustment factor (default: 1.0) */
  learningRateMultiplier?: number;
  /** Maximum trajectories to track simultaneously (default: 100) */
  maxActiveTrajectories?: number;
}

export interface SwarmTask {
  id: string;
  objective: string;
  instructions: string;
  role?: string;
  complexity?: number;
  metadata?: Record<string, any>;
}

export interface SwarmOutcome {
  taskId: string;
  success: boolean;
  quality: number;
  latency: number;
  cost: number;
  modelUsed: string;
  modelTier: number;
  output?: string;
  error?: string;
  timestamp: number;
}

export interface OptimizedRouting {
  originalEmbedding: number[];
  optimizedEmbedding: number[];
  trajectoryId: string;
  recommendedModel: string;
  recommendedTier: number;
  confidence: number;
  similarPatterns: LearningOutcome[];
}

export interface SonaStats {
  enabled: boolean;
  totalTasks: number;
  learningEvents: number;
  activeTrajectories: number;
  avgOptimizationLatency: number;
  patternMatchRate: number;
  qualityImprovement: number;
  engineStats: any;
}

export class SonaAdapter extends EventEmitter {
  private config: Required<SonaAdapterConfig>;
  private sonaEngine: SonaEngine | null;
  private activeTrajectories: Map<string, string>; // taskId -> trajectoryId
  private taskHistory: Map<string, SwarmTask>;
  private stats: {
    totalTasks: number;
    learningEvents: number;
    optimizationLatencies: number[];
    qualityScores: number[];
    patternMatches: number;
  };

  constructor(config: SonaAdapterConfig = {}) {
    super();
    
    // @ts-expect-error - Post-Merge Reconciliation
    this.config = {
      enabled: true,
      embeddingProvider: 'simple',
      minComplexity: 0.2,
      learningRateMultiplier: 1.0,
      maxActiveTrajectories: 100,
      ...config
    };

    // Initialize SONA engine if enabled
    this.sonaEngine = null;
    if (this.config.enabled) {
      try {
        this.sonaEngine = new SonaEngine(this.config.sonaConfig);
        
        // Listen to SONA events
        this.sonaEngine.on('trajectory-completed', (event) => {
          this.emit('learning-event', event);
        });
        
        this.sonaEngine.on('consolidation-completed', (event) => {
          this.emit('consolidation', event);
        });
        
        logger.info('SONA adapter initialized with engine');
        
      } catch (error: unknown) {
        // @ts-expect-error - Post-Merge Reconciliation
        logger.warn('SONA engine initialization failed, running without learning', { 
          error: (error as Error).message 
        });
        this.config.enabled = false;
      }
    }

    this.activeTrajectories = new Map();
    this.taskHistory = new Map();
    
    this.stats = {
      totalTasks: 0,
      learningEvents: 0,
      optimizationLatencies: [],
      qualityScores: [],
      patternMatches: 0
    };

    // @ts-expect-error - Post-Merge Reconciliation
    logger.info('SONA adapter ready', { 
      enabled: this.config.enabled,
      embeddingProvider: this.config.embeddingProvider
    });
  }

  /**
   * Optimize task routing using SONA patterns
   * This is the main entry point for task optimization
   */
  async optimizeTaskRouting(task: SwarmTask): Promise<OptimizedRouting | null> {
    if (!this.config.enabled || !this.sonaEngine) {
      // @ts-expect-error - Post-Merge Reconciliation
      logger.debug('SONA optimization skipped (disabled or unavailable)', { taskId: task.id });
      return null;
    }

    // Skip optimization for simple tasks
    const complexity = task.complexity || this.estimateTaskComplexity(task);
    if (complexity < this.config.minComplexity) {
      // @ts-expect-error - Post-Merge Reconciliation
      logger.debug('SONA optimization skipped (low complexity)', { 
        taskId: task.id, 
        complexity: complexity.toFixed(3) 
      });
      return null;
    }

    const startTime = process.hrtime.bigint();
    
    try {
      // Generate task embedding
      const taskEmbedding = await this.generateTaskEmbedding(task);
      
      // Start learning trajectory
      const trajectoryId = this.sonaEngine.beginTrajectory(taskEmbedding);
      
      // Track active trajectory
      this.activeTrajectories.set(task.id, trajectoryId);
      this.taskHistory.set(task.id, task);
      
      // Clean up if we exceed max active trajectories
      if (this.activeTrajectories.size > this.config.maxActiveTrajectories) {
        await this.cleanupOldestTrajectory();
      }

      // Apply MicroLoRA optimization
      const optimizedEmbedding = await this.sonaEngine.applyMicroLoraOptimization(trajectoryId);
      
      // Find similar successful patterns
      const similarPatterns = await this.sonaEngine.findSimilarPatterns(optimizedEmbedding, 3);
      
      // Determine recommended routing based on patterns
      const routing = this.determineRecommendedRouting(optimizedEmbedding, similarPatterns);
      
      const endTime = process.hrtime.bigint();
      const latencyMs = Number(endTime - startTime) / 1000000;
      
      // Update statistics
      this.stats.totalTasks++;
      this.stats.optimizationLatencies.push(latencyMs);
      if (similarPatterns.length > 0) {
        this.stats.patternMatches++;
      }

      const result: OptimizedRouting = {
        originalEmbedding: taskEmbedding.vector,
        optimizedEmbedding,
        trajectoryId,
        recommendedModel: routing.model,
        recommendedTier: routing.tier,
        confidence: routing.confidence,
        similarPatterns
      };

      // @ts-expect-error - Post-Merge Reconciliation
      logger.debug('Task routing optimized', {
        taskId: task.id,
        trajectoryId,
        latencyMs: latencyMs.toFixed(2),
        recommendedTier: routing.tier,
        patternsFound: similarPatterns.length,
        confidence: routing.confidence.toFixed(3)
      });

      this.emit('routing-optimized', { 
        taskId: task.id, 
        latencyMs, 
        patternsFound: similarPatterns.length 
      });

      return result;

    } catch (error: unknown) {
      // @ts-expect-error - Post-Merge Reconciliation
      logger.error('Task routing optimization failed', { 
        taskId: task.id, 
        error: (error as Error).message 
      });
      
      // Clean up failed trajectory
      if (this.activeTrajectories.has(task.id)) {
        this.activeTrajectories.delete(task.id);
        this.taskHistory.delete(task.id);
      }
      
      return null;
    }
  }

  /**
   * Record swarm outcome for learning
   */
  async recordSwarmOutcome(outcome: SwarmOutcome): Promise<void> {
    if (!this.config.enabled || !this.sonaEngine) {
      return;
    }

    const trajectoryId = this.activeTrajectories.get(outcome.taskId);
    if (!trajectoryId) {
      // @ts-expect-error - Post-Merge Reconciliation
      logger.debug('No active trajectory for task outcome', { taskId: outcome.taskId });
      return;
    }

    const task = this.taskHistory.get(outcome.taskId);
    if (!task) {
      // @ts-expect-error - Post-Merge Reconciliation
      logger.warn('No task history found for outcome', { taskId: outcome.taskId });
      return;
    }

    try {
      // Create learning outcome
      const learningOutcome: LearningOutcome = {
        taskId: outcome.taskId,
        taskEmbedding: await this.generateTaskEmbedding(task),
        quality: outcome.quality,
        latency: outcome.latency,
        cost: outcome.cost,
        success: outcome.success,
        modelTier: outcome.modelTier,
        timestamp: outcome.timestamp || Date.now()
      };

      // End trajectory with outcome
      await this.sonaEngine.endTrajectory(trajectoryId, learningOutcome);
      
      // Update statistics
      this.stats.learningEvents++;
      this.stats.qualityScores.push(outcome.quality);

      // Clean up
      this.activeTrajectories.delete(outcome.taskId);
      this.taskHistory.delete(outcome.taskId);

      // @ts-expect-error - Post-Merge Reconciliation
      logger.debug('Swarm outcome recorded for learning', {
        taskId: outcome.taskId,
        trajectoryId,
        quality: outcome.quality,
        success: outcome.success
      });

      this.emit('outcome-recorded', { 
        taskId: outcome.taskId, 
        quality: outcome.quality 
      });

    } catch (error: unknown) {
      // @ts-expect-error - Post-Merge Reconciliation
      logger.error('Failed to record swarm outcome', { 
        taskId: outcome.taskId, 
        error: (error as Error).message 
      });
    }
  }

  /**
   * Generate task embedding using configured provider
   */
  private async generateTaskEmbedding(task: SwarmTask): Promise<TaskEmbedding> {
    const complexity = task.complexity || this.estimateTaskComplexity(task);
    
    let vector: number[];
    
    switch (this.config.embeddingProvider) {
      case 'simple':
        vector = await this.generateSimpleEmbedding(task);
        break;
      
      case 'openai':
        vector = await this.generateOpenAIEmbedding(task);
        break;
        
      case 'local':
        vector = await this.generateLocalEmbedding(task);
        break;
        
      default:
        throw new Error(`Unknown embedding provider: ${this.config.embeddingProvider}`);
    }

    return {
      vector,
      metadata: {
        taskType: task.role || 'general',
        complexity,
        tokens: this.estimateTokenCount(task.objective + ' ' + task.instructions),
        modelUsed: 'none' // Will be set later
      }
    };
  }

  /**
   * Generate simple embedding based on text features
   * Fast fallback when advanced embedding services are unavailable
   */
  private async generateSimpleEmbedding(task: SwarmTask): Promise<number[]> {
    const text = `${task.objective} ${task.instructions}`.toLowerCase();
    const embeddingDim = this.config.sonaConfig?.embeddingDim || 256;
    const embedding = new Array(embeddingDim).fill(0);
    
    // Simple hash-based features
    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i);
      const index = (charCode * 31 + i) % embeddingDim;
      embedding[index] += 1;
    }
    
    // Add task-specific features
    const complexity = task.complexity || this.estimateTaskComplexity(task);
    embedding[0] = complexity;
    
    if (task.role) {
      const roleHash = this.hashString(task.role) % (embeddingDim - 10);
      embedding[roleHash + 10] += 1;
    }
    
    // Normalize
    const norm = Math.sqrt(embedding.reduce((sum, x) => sum + x * x, 0));
    if (norm > 0) {
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] /= norm;
      }
    }
    
    return embedding;
  }

  /**
   * Generate embedding using OpenAI API (placeholder - would integrate with actual API)
   */
  private async generateOpenAIEmbedding(task: SwarmTask): Promise<number[]> {
    // Placeholder - in production this would call OpenAI embeddings API
    logger.debug('OpenAI embedding generation not implemented, falling back to simple');
    return this.generateSimpleEmbedding(task);
  }

  /**
   * Generate embedding using local model (placeholder)
   */
  private async generateLocalEmbedding(task: SwarmTask): Promise<number[]> {
    // Placeholder - in production this would use local embedding model
    logger.debug('Local embedding generation not implemented, falling back to simple');
    return this.generateSimpleEmbedding(task);
  }

  /**
   * Estimate task complexity based on content
   */
  private estimateTaskComplexity(task: SwarmTask): number {
    if (task.complexity !== undefined) {return task.complexity;}
    
    const text = task.objective + ' ' + task.instructions;
    const tokenCount = this.estimateTokenCount(text);
    
    let complexity = 0;
    
    // Base complexity from token count
    complexity += Math.min(tokenCount / 1000, 0.5);
    
    // Complexity keywords
    const complexKeywords = [
      'analyze', 'research', 'implement', 'design', 'architecture',
      'complex', 'advanced', 'integration', 'system', 'algorithm'
    ];
    
    for (const keyword of complexKeywords) {
      if (text.toLowerCase().includes(keyword)) {
        complexity += 0.1;
      }
    }
    
    // Role-based complexity
    if (task.role) {
      const complexRoles = ['architect', 'researcher', 'analyst', 'designer'];
      if (complexRoles.some(role => task.role!.toLowerCase().includes(role))) {
        complexity += 0.2;
      }
    }
    
    return Math.min(complexity, 1.0);
  }

  /**
   * Estimate token count for text
   */
  private estimateTokenCount(text: string): number {
    // Rough estimate: ~4 characters per token for English
    return Math.ceil(text.length / 4);
  }

  /**
   * Simple string hash function
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Determine recommended routing based on optimized embedding and patterns
   */
  private determineRecommendedRouting(
    embedding: number[], 
    patterns: LearningOutcome[]
  ): { model: string; tier: number; confidence: number } {
    
    if (patterns.length === 0) {
      // No patterns, use default routing
      return { 
        model: 'claude-sonnet-4-20250514', 
        tier: 3, 
        confidence: 0.3 
      };
    }

    // Analyze patterns to determine best routing
    let avgQuality = 0;
    let tierCounts = [0, 0, 0, 0]; // Index 0 unused, tiers 1-3
    let bestModel = 'claude-sonnet-4-20250514';
    
    for (const pattern of patterns) {
      avgQuality += pattern.quality;
      if (pattern.modelTier >= 1 && pattern.modelTier <= 3) {
        tierCounts[pattern.modelTier]++;
      }
    }
    
    avgQuality /= patterns.length;
    
    // Find most successful tier
    let bestTier = 3;
    let maxCount = 0;
    for (let i = 1; i <= 3; i++) {
      if (tierCounts[i] > maxCount) {
        maxCount = tierCounts[i];
        bestTier = i;
      }
    }
    
    // Map tier to model
    switch (bestTier) {
      case 1:
        bestModel = 'none'; // Agent Booster
        break;
      case 2:
        bestModel = 'claude-3-haiku-20240307';
        break;
      case 3:
      default:
        bestModel = avgQuality > 0.8 ? 'claude-opus-4-5-20251101' : 'claude-sonnet-4-20250514';
        break;
    }
    
    // Confidence based on pattern quality and count
    const confidence = Math.min(avgQuality * (patterns.length / 5.0), 1.0);
    
    return { model: bestModel, tier: bestTier, confidence };
  }

  /**
   * Clean up oldest active trajectory when limit is exceeded
   */
  private async cleanupOldestTrajectory(): Promise<void> {
    // Find oldest task by creation order (simple heuristic)
    const oldestTaskId = this.activeTrajectories.keys().next().value;
    
    if (oldestTaskId) {
      const trajectoryId = this.activeTrajectories.get(oldestTaskId);
      
      // @ts-expect-error - Post-Merge Reconciliation
      logger.debug('Cleaning up oldest trajectory', { taskId: oldestTaskId, trajectoryId });
      
      this.activeTrajectories.delete(oldestTaskId);
      this.taskHistory.delete(oldestTaskId);
    }
  }

  /**
   * Get SONA adapter statistics
   */
  getStats(): SonaStats {
    const avgOptimizationLatency = this.stats.optimizationLatencies.length > 0 ?
      this.stats.optimizationLatencies.reduce((a, b) => a + b, 0) / this.stats.optimizationLatencies.length : 0;
      
    const avgQuality = this.stats.qualityScores.length > 0 ?
      this.stats.qualityScores.reduce((a, b) => a + b, 0) / this.stats.qualityScores.length : 0;
      
    const patternMatchRate = this.stats.totalTasks > 0 ?
      this.stats.patternMatches / this.stats.totalTasks : 0;

    return {
      enabled: this.config.enabled,
      totalTasks: this.stats.totalTasks,
      learningEvents: this.stats.learningEvents,
      activeTrajectories: this.activeTrajectories.size,
      avgOptimizationLatency: Number(avgOptimizationLatency.toFixed(2)),
      patternMatchRate: Number((patternMatchRate * 100).toFixed(1)),
      qualityImprovement: Number(avgQuality.toFixed(3)),
      engineStats: this.sonaEngine ? this.sonaEngine.getStats() : null
    };
  }

  /**
   * Reset adapter state (useful for testing)
   */
  async reset(): Promise<void> {
    this.activeTrajectories.clear();
    this.taskHistory.clear();
    
    this.stats = {
      totalTasks: 0,
      learningEvents: 0,
      optimizationLatencies: [],
      qualityScores: [],
      patternMatches: 0
    };

    if (this.sonaEngine) {
      await this.sonaEngine.reset();
    }

    logger.info('SONA adapter reset completed');
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    logger.info('SONA adapter shutting down');
    
    // Complete any active trajectories
    for (const [taskId, trajectoryId] of this.activeTrajectories) {
      // @ts-expect-error - Post-Merge Reconciliation
      logger.debug('Terminating active trajectory on shutdown', { taskId, trajectoryId });
    }
    
    this.activeTrajectories.clear();
    this.taskHistory.clear();

    if (this.sonaEngine) {
      await this.sonaEngine.shutdown();
    }

    this.removeAllListeners();
  }
}

// Default instance for global access
let defaultAdapter: SonaAdapter | null = null;

export function initSonaAdapter(config?: SonaAdapterConfig): SonaAdapter {
  if (defaultAdapter) {
    logger.warn('SONA adapter already initialized, returning existing instance');
    return defaultAdapter;
  }
  
  defaultAdapter = new SonaAdapter(config);
  return defaultAdapter;
}

export function getDefaultSonaAdapter(): SonaAdapter {
  if (!defaultAdapter) {
    logger.info('No SONA adapter initialized, creating default instance');
    defaultAdapter = new SonaAdapter();
  }
  
  return defaultAdapter;
}

export function resetDefaultSonaAdapter(): void {
  defaultAdapter = null;
}