// @ts-nocheck
/**
 * SuperClaw Quality Gates System
 * 
 * Export all quality gate components and utilities.
 * Based on VibeCoder (VC) quality gate patterns.
 */

// Core quality gates system
export {
  SuperClawQualityGates,
  QualityGatePipeline,
  createQualityGateRunner,
  QUALITY_GATE_SEQUENCES
} from './gates';

// Types and interfaces
export type {
  QualityGateType,
  QualityGateResult,
  QualityGateConfig,
  QualityIssue,
  RecoveryStrategy,
  QualityGateRunner
} from './gates';

// Swarm integration
export {
  SwarmQualityAssessor,
  integrateQualityWithJudge
} from './swarm-integration';

// Swarm integration types
export type {
  SwarmQualityConfig,
  SwarmQualityResult,
  AgentQualityMetrics,
  SwarmQualityMetrics,
  SwarmQualityIssue
} from './swarm-integration';