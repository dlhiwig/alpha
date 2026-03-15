// @ts-nocheck
/**
 * SONA Integration for SuperClaw
 * 
 * Self-Optimizing Neural Architecture (SONA) integration provides:
 * - Runtime learning from swarm outcomes
 * - Pattern-based task routing optimization
 * - Two-tier LoRA adaptation system
 * - K-means++ pattern storage and retrieval
 * - EWC++ catastrophic forgetting prevention
 * 
 * @see /home/toba/superclaw/docs/RUVECTOR_ANALYSIS.md
 */

export * from './sona-engine';
export * from './micro-lora';
export * from './reasoning-bank';
export * from './sona-adapter';

export {
  SonaEngine,
  getDefaultSonaEngine,
  resetDefaultSonaEngine
} from './sona-engine';

export {
  MicroLoraAdapter
} from './micro-lora';

export {
  ReasoningBank
} from './reasoning-bank';

export {
  SonaAdapter,
  initSonaAdapter,
  getDefaultSonaAdapter,
  resetDefaultSonaAdapter
} from './sona-adapter';

// Re-export key types for convenience
export type {
  SonaConfig,
  TaskEmbedding,
  LearningOutcome,
  TrajectoryRecord
} from './sona-engine';

export type {
  MicroLoraConfig,
  TaskMetadata,
  AdaptationResult
} from './micro-lora';

export type {
  ReasoningBankConfig,
  StoredPattern,
  SimilarityResult
} from './reasoning-bank';

export type {
  SonaAdapterConfig,
  SwarmTask,
  SwarmOutcome,
  OptimizedRouting,
  SonaStats
} from './sona-adapter';