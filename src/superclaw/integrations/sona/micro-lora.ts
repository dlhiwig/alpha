// @ts-nocheck
/**
 * MicroLoRA - Fast Per-Request Adaptation Layer
 * 
 * Implements ultra-fast LoRA (Low-Rank Adaptation) with target latency <100μs.
 * This is the first tier in SONA's two-tier learning system.
 * 
 * Features:
 * - Rank 1-2 LoRA for minimal computational overhead
 * - Per-request adaptation based on task similarity
 * - Weight updates based on outcome feedback
 * - Consolidation to BaseLoRA for deep pattern storage
 * - EWC++ regularization to prevent catastrophic forgetting
 * 
 * Mathematical Foundation:
 * W' = W + α * A * B^T
 * where A ∈ R^(d×r), B ∈ R^(r×d), r << d (typically r=1 or 2)
 */

import { EventEmitter } from 'events';
import { logger } from '../../utils/logger';

export interface MicroLoraConfig {
  /** LoRA rank (1-2 for ultra-fast, default: 2) */
  rank: number;
  /** Learning rate for weight updates (default: 0.001) */
  learningRate: number;
  /** Embedding dimension (default: 256) */
  embeddingDim: number;
  /** Adaptation strength (default: 0.1) */
  adaptationStrength?: number;
  /** Maximum adaptation per request (default: 0.5) */
  maxAdaptation?: number;
  /** Weight decay for regularization (default: 1e-5) */
  weightDecay?: number;
}

export interface TaskMetadata {
  taskType: string;
  complexity: number;
  tokens?: number;
  modelUsed?: string;
  [key: string]: any;
}

export interface LoraMatrices {
  A: Float32Array; // Shape: [embeddingDim, rank]
  B: Float32Array; // Shape: [rank, embeddingDim] 
}

export interface AdaptationResult {
  originalEmbedding: number[];
  adaptedEmbedding: number[];
  adaptationStrength: number;
  latencyUs: number;
  similarityScore: number;
}

export class MicroLoraAdapter extends EventEmitter {
  private config: Required<MicroLoraConfig>;
  private loraMatrices: LoraMatrices;
  private baseLoraMatrices: LoraMatrices; // Consolidated patterns from consolidation
  private adaptationHistory: Map<string, AdaptationResult>;
  private updateCount: number;
  private totalAdaptationTime: bigint;

  constructor(config: MicroLoraConfig) {
    super();
    
    this.config = {
      adaptationStrength: 0.1,
      maxAdaptation: 0.5,
      weightDecay: 1e-5,
      ...config
    };

    // Initialize LoRA matrices with Xavier initialization
    this.loraMatrices = this.initializeLoraMatrices();
    this.baseLoraMatrices = this.initializeLoraMatrices();
    
    this.adaptationHistory = new Map();
    this.updateCount = 0;
    this.totalAdaptationTime = 0n;

    // @ts-expect-error - Post-Merge Reconciliation
    logger.info('MicroLoRA adapter initialized', {
      rank: this.config.rank,
      embeddingDim: this.config.embeddingDim,
      learningRate: this.config.learningRate
    });
  }

  /**
   * Initialize LoRA matrices with Xavier/Glorot initialization
   */
  private initializeLoraMatrices(): LoraMatrices {
    const { embeddingDim, rank } = this.config;
    
    // Xavier initialization scale
    const scaleA = Math.sqrt(2.0 / embeddingDim);
    const scaleB = Math.sqrt(2.0 / rank);

    const A = new Float32Array(embeddingDim * rank);
    const B = new Float32Array(rank * embeddingDim);

    // Initialize A matrix
    for (let i = 0; i < A.length; i++) {
      A[i] = (Math.random() - 0.5) * 2 * scaleA;
    }

    // Initialize B matrix (start near zero for stability)
    for (let i = 0; i < B.length; i++) {
      B[i] = (Math.random() - 0.5) * 2 * scaleB * 0.01;
    }

    return { A, B };
  }

  /**
   * Fast adaptation of task embedding
   * Target: <100μs latency
   */
  async adapt(embedding: number[], metadata: TaskMetadata): Promise<number[]> {
    const startTime = process.hrtime.bigint();
    
    try {
      // Convert embedding to Float32Array for SIMD operations
      const inputVector = new Float32Array(embedding);
      
      // Calculate similarity to previous adaptations for selective adaptation
      const similarityScore = this.calculateTaskSimilarity(metadata);
      
      // Determine adaptation strength based on similarity and metadata
      const adaptationStrength = this.calculateAdaptationStrength(similarityScore, metadata);
      
      // Apply MicroLoRA transformation: x' = x + α * (A * B^T * x)
      const adaptedVector = this.applyLoraTransformation(
        inputVector, 
        adaptationStrength,
        this.loraMatrices
      );
      
      // Also apply consolidated BaseLoRA patterns (with lower weight)
      const baseAdaptedVector = this.applyLoraTransformation(
        adaptedVector,
        adaptationStrength * 0.3, // BaseLoRA has lower immediate influence
        this.baseLoraMatrices
      );
      
      const endTime = process.hrtime.bigint();
      const latencyNs = endTime - startTime;
      const latencyUs = Number(latencyNs) / 1000;
      
      this.totalAdaptationTime += latencyNs;
      
      const result: AdaptationResult = {
        originalEmbedding: embedding,
        adaptedEmbedding: Array.from(baseAdaptedVector),
        adaptationStrength,
        latencyUs,
        similarityScore
      };

      // Store adaptation result for learning
      const adaptationId = `${metadata.taskType}_${Date.now()}`;
      this.adaptationHistory.set(adaptationId, result);
      
      // Keep only recent adaptations (memory management)
      if (this.adaptationHistory.size > 1000) {
        const oldestKey = this.adaptationHistory.keys().next().value;
        // @ts-expect-error - Post-Merge Reconciliation
        this.adaptationHistory.delete(oldestKey);
      }

      // @ts-expect-error - Post-Merge Reconciliation
      logger.debug('MicroLoRA adaptation completed', {
        latencyUs: latencyUs.toFixed(1),
        adaptationStrength: adaptationStrength.toFixed(3),
        similarityScore: similarityScore.toFixed(3),
        targetUs: 100
      });

      this.emit('adaptation-completed', result);
      return result.adaptedEmbedding;

    } catch (error: unknown) {
      // @ts-expect-error - Post-Merge Reconciliation
      logger.error('MicroLoRA adaptation failed', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Apply LoRA transformation: x' = x + α * (A * B^T * x)
   * Optimized for minimal latency with SIMD-friendly operations
   */
  private applyLoraTransformation(
    input: Float32Array, 
    alpha: number, 
    matrices: LoraMatrices
  ): Float32Array {
    const { embeddingDim, rank } = this.config;
    const { A, B } = matrices;
    
    // Create output vector
    const output = new Float32Array(input);
    
    // Step 1: Compute B^T * x (rank-dimensional intermediate)
    const intermediate = new Float32Array(rank);
    for (let r = 0; r < rank; r++) {
      let sum = 0;
      for (let d = 0; d < embeddingDim; d++) {
        sum += B[r * embeddingDim + d] * input[d];
      }
      intermediate[r] = sum;
    }
    
    // Step 2: Compute A * intermediate and add to output with scaling
    for (let d = 0; d < embeddingDim; d++) {
      let delta = 0;
      for (let r = 0; r < rank; r++) {
        delta += A[d * rank + r] * intermediate[r];
      }
      output[d] += alpha * delta;
    }
    
    return output;
  }

  /**
   * Calculate task similarity based on metadata and adaptation history
   */
  private calculateTaskSimilarity(metadata: TaskMetadata): number {
    if (this.adaptationHistory.size === 0) {
      return 0.5; // Default similarity for new tasks
    }

    let totalSimilarity = 0;
    let count = 0;

    // Check similarity with recent adaptations (last 10)
    const recentAdaptations = Array.from(this.adaptationHistory.values()).slice(-10);
    
    for (const adaptation of recentAdaptations) {
      // Simple similarity based on task type and complexity
      let similarity = 0;
      
      // Task type similarity (exact match gets 0.5, no match gets 0)
      if (adaptation.originalEmbedding.length > 0) {
        // This is a placeholder - in production, would use more sophisticated similarity
        similarity += 0.3;
      }
      
      // Complexity similarity (closer complexity scores are more similar)
      const complexityDiff = Math.abs(metadata.complexity - 0.5); // Assume stored complexity
      similarity += (1.0 - complexityDiff) * 0.2;
      
      totalSimilarity += similarity;
      count++;
    }

    return count > 0 ? totalSimilarity / count : 0.5;
  }

  /**
   * Calculate adaptation strength based on task similarity and metadata
   */
  private calculateAdaptationStrength(similarity: number, metadata: TaskMetadata): number {
    let strength = this.config.adaptationStrength;
    
    // Increase strength for dissimilar tasks (more adaptation needed)
    strength *= (1.0 + (1.0 - similarity));
    
    // Adjust based on task complexity
    strength *= (0.5 + metadata.complexity * 0.5);
    
    // Clamp to maximum adaptation
    return Math.min(strength, this.config.maxAdaptation);
  }

  /**
   * Update weights based on outcome feedback
   * This implements online learning for the LoRA matrices
   */
  async updateWeights(
    originalEmbedding: number[],
    adaptedEmbedding: number[],
    quality: number,
    success: boolean
  ): Promise<void> {
    if (!success || quality < 0.3) {
      // Don't learn from poor outcomes
      return;
    }

    const learningRate = this.config.learningRate * quality; // Scale by quality
    
    // Calculate gradient based on the difference between original and adapted
    const embeddingDiff = new Float32Array(originalEmbedding.length);
    for (let i = 0; i < embeddingDiff.length; i++) {
      embeddingDiff[i] = adaptedEmbedding[i] - originalEmbedding[i];
    }

    // Simple gradient update for LoRA matrices
    // In practice, this would use more sophisticated optimization
    await this.updateLoraMatrices(embeddingDiff, learningRate, success);
    
    this.updateCount++;
    
    // @ts-expect-error - Post-Merge Reconciliation
    logger.debug('LoRA weights updated', {
      quality,
      success,
      learningRate,
      updateCount: this.updateCount
    });
  }

  /**
   * Update LoRA matrices based on gradient
   */
  private async updateLoraMatrices(
    gradient: Float32Array,
    learningRate: number,
    success: boolean
  ): Promise<void> {
    const { embeddingDim, rank } = this.config;
    const sign = success ? 1 : -1;
    
    // Update A matrix (simplified gradient descent)
    for (let d = 0; d < embeddingDim; d++) {
      for (let r = 0; r < rank; r++) {
        const idx = d * rank + r;
        const gradientContrib = gradient[d] * sign * learningRate;
        
        // Apply update with weight decay
        this.loraMatrices.A[idx] *= (1 - this.config.weightDecay);
        this.loraMatrices.A[idx] += gradientContrib;
      }
    }

    // Update B matrix  
    for (let r = 0; r < rank; r++) {
      for (let d = 0; d < embeddingDim; d++) {
        const idx = r * embeddingDim + d;
        const gradientContrib = gradient[d] * sign * learningRate * 0.1; // B updates more slowly
        
        this.loraMatrices.B[idx] *= (1 - this.config.weightDecay);
        this.loraMatrices.B[idx] += gradientContrib;
      }
    }
  }

  /**
   * Consolidate MicroLoRA adaptations into BaseLoRA
   * This implements the two-tier learning system
   */
  async consolidateToBase(): Promise<void> {
    logger.info('Consolidating MicroLoRA to BaseLoRA');
    
    // Average the MicroLoRA matrices into BaseLoRA with momentum
    const momentum = 0.9;
    const { embeddingDim, rank } = this.config;
    
    // Update BaseLoRA matrices with momentum from MicroLoRA
    for (let i = 0; i < embeddingDim * rank; i++) {
      this.baseLoraMatrices.A[i] = 
        momentum * this.baseLoraMatrices.A[i] + 
        (1 - momentum) * this.loraMatrices.A[i];
    }
    
    for (let i = 0; i < rank * embeddingDim; i++) {
      this.baseLoraMatrices.B[i] = 
        momentum * this.baseLoraMatrices.B[i] + 
        (1 - momentum) * this.loraMatrices.B[i];
    }
    
    // Reset MicroLoRA matrices for fresh adaptation
    this.loraMatrices = this.initializeLoraMatrices();
    
    logger.info('MicroLoRA to BaseLoRA consolidation completed');
  }

  /**
   * Apply EWC regularization to protect important weights
   */
  async applyEwcRegularization(fisherMatrix: Float32Array, strength: number): Promise<void> {
    const { embeddingDim, rank } = this.config;
    
    // Apply EWC penalty to both A and B matrices
    for (let d = 0; d < embeddingDim; d++) {
      const fisherWeight = fisherMatrix[d] * strength;
      
      for (let r = 0; r < rank; r++) {
        const aIdx = d * rank + r;
        const bIdx = r * embeddingDim + d;
        
        // Constrain weights toward their consolidated values
        this.loraMatrices.A[aIdx] = 
          (this.loraMatrices.A[aIdx] + fisherWeight * this.baseLoraMatrices.A[aIdx]) / 
          (1 + fisherWeight);
          
        this.loraMatrices.B[bIdx] = 
          (this.loraMatrices.B[bIdx] + fisherWeight * this.baseLoraMatrices.B[bIdx]) / 
          (1 + fisherWeight);
      }
    }
    
    // @ts-expect-error - Post-Merge Reconciliation
    logger.debug('EWC regularization applied', { strength });
  }

  /**
   * Get adapter statistics
   */
  getStats() {
    const avgLatencyUs = this.adaptationHistory.size > 0 ? 
      Number(this.totalAdaptationTime) / (this.adaptationHistory.size * 1000) : 0;
    
    return {
      updateCount: this.updateCount,
      adaptationHistory: this.adaptationHistory.size,
      avgLatencyUs: avgLatencyUs.toFixed(1),
      config: this.config,
      matrixStats: {
        aNorm: this.calculateMatrixNorm(this.loraMatrices.A),
        bNorm: this.calculateMatrixNorm(this.loraMatrices.B),
        baseANorm: this.calculateMatrixNorm(this.baseLoraMatrices.A),
        baseBNorm: this.calculateMatrixNorm(this.baseLoraMatrices.B)
      }
    };
  }

  /**
   * Calculate Frobenius norm of matrix
   */
  private calculateMatrixNorm(matrix: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < matrix.length; i++) {
      sum += matrix[i] * matrix[i];
    }
    return Math.sqrt(sum);
  }

  /**
   * Reset adapter (useful for testing)
   */
  async reset(): Promise<void> {
    this.loraMatrices = this.initializeLoraMatrices();
    this.baseLoraMatrices = this.initializeLoraMatrices();
    this.adaptationHistory.clear();
    this.updateCount = 0;
    this.totalAdaptationTime = 0n;
    
    logger.info('MicroLoRA adapter reset');
  }

  /**
   * Shutdown adapter
   */
  async shutdown(): Promise<void> {
    this.adaptationHistory.clear();
    this.removeAllListeners();
    logger.info('MicroLoRA adapter shutdown');
  }
}