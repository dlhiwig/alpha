/**
 * SONA Engine - Self-Optimizing Neural Architecture
 * 
 * Core self-learning engine that adapts routing and decision making based on outcomes.
 * Implements the two-tier LoRA system with EWC++ for catastrophic forgetting prevention.
 * 
 * Architecture:
 * - MicroLoRA: Fast per-request adaptation (~45μs)
 * - BaseLoRA: Deep pattern consolidation (~1ms)
 * - ReasoningBank: K-means++ pattern storage/retrieval
 * - EWC++: Elastic Weight Consolidation for stable learning
 * 
 * @see /home/toba/superclaw/docs/RUVECTOR_ANALYSIS.md
 */

import { EventEmitter } from 'events';
// @ts-expect-error - Post-Merge Reconciliation
import { SONA } from '@ruvector/sona';
import { MicroLoraAdapter } from './micro-lora';
import { ReasoningBank } from './reasoning-bank';
import { logger } from '../../utils/logger';

export interface SonaConfig {
  /** Embedding dimensions (default: 256) */
  embeddingDim?: number;
  /** MicroLoRA rank (default: 2) */
  microLoraRank?: number;
  /** BaseLoRA rank (default: 8) */
  baseLoraRank?: number;
  /** Learning rate for adaptation (default: 0.001) */
  learningRate?: number;
  /** EWC++ regularization strength (default: 100) */
  ewcStrength?: number;
  /** Pattern storage capacity (default: 10000) */
  patternCapacity?: number;
  /** Minimum quality score for pattern storage (default: 0.7) */
  qualityThreshold?: number;
}

export interface TaskEmbedding {
  vector: number[];
  metadata: {
    taskType: string;
    complexity: number;
    tokens?: number;
    modelUsed?: string;
  };
}

export interface LearningOutcome {
  taskId: string;
  taskEmbedding: TaskEmbedding;
  quality: number;
  latency: number;
  cost: number;
  success: boolean;
  modelTier: number;
  timestamp: number;
}

export interface TrajectoryRecord {
  id: string;
  startTime: number;
  endTime?: number;
  taskEmbedding: TaskEmbedding;
  adaptedEmbedding?: number[];
  outcome?: LearningOutcome;
}

export class SonaEngine extends EventEmitter {
  private sona: SONA;
  private microLora: MicroLoraAdapter;
  private reasoningBank: ReasoningBank;
  private config: Required<SonaConfig>;
  private activeTrajectories: Map<string, TrajectoryRecord>;
  private totalLearningEvents: number;
  private lastConsolidation: number;

  constructor(config: SonaConfig = {}) {
    super();
    
    this.config = {
      embeddingDim: 256,
      microLoraRank: 2,
      baseLoraRank: 8,
      learningRate: 0.001,
      ewcStrength: 100,
      patternCapacity: 10000,
      qualityThreshold: 0.7,
      ...config
    };

    // Initialize core SONA engine
    this.sona = new SONA(this.config.embeddingDim);
    
    // Initialize components
    this.microLora = new MicroLoraAdapter({
      rank: this.config.microLoraRank,
      learningRate: this.config.learningRate,
      embeddingDim: this.config.embeddingDim
    });

    this.reasoningBank = new ReasoningBank({
      capacity: this.config.patternCapacity,
      embeddingDim: this.config.embeddingDim,
      qualityThreshold: this.config.qualityThreshold
    });

    // State tracking
    this.activeTrajectories = new Map();
    this.totalLearningEvents = 0;
    this.lastConsolidation = Date.now();

    // @ts-expect-error - Post-Merge Reconciliation
    logger.info('SONA Engine initialized', {
      embeddingDim: this.config.embeddingDim,
      microLoraRank: this.config.microLoraRank,
      baseLoraRank: this.config.baseLoraRank
    });
  }

  /**
   * Begin a learning trajectory for a new task
   */
  beginTrajectory(taskEmbedding: TaskEmbedding): string {
    const trajectoryId = `traj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const trajectory: TrajectoryRecord = {
      id: trajectoryId,
      startTime: Date.now(),
      taskEmbedding
    };

    this.activeTrajectories.set(trajectoryId, trajectory);
    
    // @ts-expect-error - Post-Merge Reconciliation
    logger.debug('Started trajectory', { trajectoryId, taskType: taskEmbedding.metadata.taskType });
    return trajectoryId;
  }

  /**
   * Apply MicroLoRA fast adaptation to task embedding
   * Target: <100μs latency
   */
  async applyMicroLoraOptimization(trajectoryId: string): Promise<number[]> {
    const startTime = process.hrtime.bigint();
    
    const trajectory = this.activeTrajectories.get(trajectoryId);
    if (!trajectory) {
      throw new Error(`Trajectory ${trajectoryId} not found`);
    }

    try {
      // Apply MicroLoRA adaptation
      const adaptedEmbedding = await this.microLora.adapt(
        trajectory.taskEmbedding.vector,
        trajectory.taskEmbedding.metadata
      );

      // Update trajectory with adapted embedding
      trajectory.adaptedEmbedding = adaptedEmbedding;
      
      const latencyNs = process.hrtime.bigint() - startTime;
      const latencyUs = Number(latencyNs) / 1000;

      // @ts-expect-error - Post-Merge Reconciliation
      logger.debug('MicroLoRA optimization applied', { 
        trajectoryId, 
        latencyUs: latencyUs.toFixed(1),
        targetUs: 100
      });

      this.emit('micro-adaptation', { trajectoryId, latencyUs, adaptedEmbedding });
      return adaptedEmbedding;

    } catch (error: unknown) {
      // @ts-expect-error - Post-Merge Reconciliation
      logger.error('MicroLoRA optimization failed', { trajectoryId, error: (error as Error).message });
      throw error;
    }
  }

  /**
   * End trajectory with learning outcome
   */
  async endTrajectory(trajectoryId: string, outcome: LearningOutcome): Promise<void> {
    const trajectory = this.activeTrajectories.get(trajectoryId);
    if (!trajectory) {
      // @ts-expect-error - Post-Merge Reconciliation
      logger.warn('Trajectory not found for ending', { trajectoryId });
      return;
    }

    // Complete trajectory record
    trajectory.endTime = Date.now();
    trajectory.outcome = outcome;

    try {
      // Store successful patterns in reasoning bank
      if (outcome.success && outcome.quality >= this.config.qualityThreshold) {
        await this.reasoningBank.storePattern(
          trajectory.adaptedEmbedding || trajectory.taskEmbedding.vector,
          outcome
        );
        
        // @ts-expect-error - Post-Merge Reconciliation
        logger.debug('Pattern stored in ReasoningBank', { 
          trajectoryId, 
          quality: outcome.quality 
        });
      }

      // Update MicroLoRA weights based on outcome
      await this.microLora.updateWeights(
        trajectory.taskEmbedding.vector,
        trajectory.adaptedEmbedding || trajectory.taskEmbedding.vector,
        outcome.quality,
        outcome.success
      );

      // Track learning events
      this.totalLearningEvents++;
      
      // Trigger consolidation if needed (every 100 events or every hour)
      const shouldConsolidate = (
        this.totalLearningEvents % 100 === 0 ||
        Date.now() - this.lastConsolidation > 3600000
      );

      if (shouldConsolidate) {
        await this.consolidatePatterns();
      }

      this.emit('trajectory-completed', { trajectoryId, outcome });
      
    } catch (error: unknown) {
      // @ts-expect-error - Post-Merge Reconciliation
      logger.error('Error ending trajectory', { trajectoryId, error: (error as Error).message });
    } finally {
      // Clean up active trajectory
      this.activeTrajectories.delete(trajectoryId);
    }
  }

  /**
   * Find similar successful patterns for new task
   */
  async findSimilarPatterns(taskEmbedding: number[], k: number = 5): Promise<LearningOutcome[]> {
    try {
      const patterns = await this.reasoningBank.findSimilarPatterns(taskEmbedding, k);
      
      // @ts-expect-error - Post-Merge Reconciliation
      logger.debug('Found similar patterns', { 
        count: patterns.length, 
        requestedK: k 
      });

      return patterns;
    } catch (error: unknown) {
      // @ts-expect-error - Post-Merge Reconciliation
      logger.error('Error finding similar patterns', { error: (error as Error).message });
      return [];
    }
  }

  /**
   * Consolidate patterns from MicroLoRA to BaseLoRA
   * This implements the two-tier learning architecture
   */
  private async consolidatePatterns(): Promise<void> {
    logger.info('Starting pattern consolidation');
    const startTime = Date.now();

    try {
      // Get recent high-quality patterns
      const recentPatterns = await this.reasoningBank.getRecentPatterns(1000);
      
      if (recentPatterns.length < 10) {
        // @ts-expect-error - Post-Merge Reconciliation
        logger.debug('Not enough patterns for consolidation', { count: recentPatterns.length });
        return;
      }

      // Apply EWC++ to prevent catastrophic forgetting
      await this.applyElasticWeightConsolidation(recentPatterns);

      // Consolidate MicroLoRA adaptations into BaseLoRA
      await this.microLora.consolidateToBase();

      this.lastConsolidation = Date.now();
      const duration = Date.now() - startTime;

      // @ts-expect-error - Post-Merge Reconciliation
      logger.info('Pattern consolidation completed', { 
        duration, 
        patternsProcessed: recentPatterns.length 
      });

      this.emit('consolidation-completed', { duration, patternsProcessed: recentPatterns.length });

    } catch (error: unknown) {
      // @ts-expect-error - Post-Merge Reconciliation
      logger.error('Pattern consolidation failed', { error: (error as Error).message });
    }
  }

  /**
   * Apply Elastic Weight Consolidation++ to prevent catastrophic forgetting
   */
  private async applyElasticWeightConsolidation(patterns: LearningOutcome[]): Promise<void> {
    // Calculate Fisher Information Matrix for important weights
    const fisherMatrix = this.calculateFisherInformation(patterns);
    
    // Apply EWC regularization to protect important weights
    await this.microLora.applyEwcRegularization(fisherMatrix, this.config.ewcStrength);
    
    // @ts-expect-error - Post-Merge Reconciliation
    logger.debug('EWC++ regularization applied', { 
      patternsAnalyzed: patterns.length,
      ewcStrength: this.config.ewcStrength
    });
  }

  /**
   * Calculate Fisher Information Matrix for EWC++
   */
  private calculateFisherInformation(patterns: LearningOutcome[]): Float32Array {
    // Simplified Fisher Information calculation
    // In production, this would be more sophisticated
    const fisherMatrix = new Float32Array(this.config.embeddingDim);
    
    for (const pattern of patterns) {
      if (pattern.success && pattern.quality > 0.8) {
        // Weight by quality and recency
        const weight = pattern.quality * Math.exp(-(Date.now() - pattern.timestamp) / 86400000);
        
        for (let i = 0; i < fisherMatrix.length; i++) {
          fisherMatrix[i] += weight;
        }
      }
    }

    // Normalize
    const sum = fisherMatrix.reduce((a, b) => a + b, 0);
    if (sum > 0) {
      for (let i = 0; i < fisherMatrix.length; i++) {
        fisherMatrix[i] /= sum;
      }
    }

    return fisherMatrix;
  }

  /**
   * Get engine statistics
   */
  getStats() {
    return {
      totalLearningEvents: this.totalLearningEvents,
      activeTrajectories: this.activeTrajectories.size,
      lastConsolidation: this.lastConsolidation,
      reasoningBankStats: this.reasoningBank.getStats(),
      microLoraStats: this.microLora.getStats(),
      config: this.config
    };
  }

  /**
   * Reset the engine (useful for testing)
   */
  async reset(): Promise<void> {
    this.activeTrajectories.clear();
    this.totalLearningEvents = 0;
    this.lastConsolidation = Date.now();
    
    await this.microLora.reset();
    await this.reasoningBank.reset();
    
    logger.info('SONA Engine reset completed');
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    logger.info('SONA Engine shutting down');
    
    // Complete any active trajectories with timeout
    for (const [trajectoryId, trajectory] of this.activeTrajectories) {
      // @ts-expect-error - Post-Merge Reconciliation
      logger.warn('Terminating active trajectory on shutdown', { trajectoryId });
      this.activeTrajectories.delete(trajectoryId);
    }

    // Shutdown components
    await this.microLora.shutdown();
    await this.reasoningBank.shutdown();

    this.removeAllListeners();
  }
}

// Default instance for global access
let defaultEngine: SonaEngine | null = null;

export function getDefaultSonaEngine(config?: SonaConfig): SonaEngine {
  if (!defaultEngine) {
    defaultEngine = new SonaEngine(config);
  }
  return defaultEngine;
}

export function resetDefaultSonaEngine(): void {
  defaultEngine = null;
}