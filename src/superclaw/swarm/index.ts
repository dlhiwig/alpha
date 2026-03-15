/**
 * SuperClaw Swarm Module
 * 
 * Multi-agent concurrent orchestration with:
 * - Fallback providers per role
 * - Retry with exponential backoff
 * - Quorum checking
 * - JSON output validation
 * - Contract-based policies (default/strict/fast)
 * 
 * Architecture:
 *   OpenClaw → SuperClaw → Swarm → [claude|gemini|codex|...]
 * 
 * Usage:
 *   // Simple one-shot
 *   const result = await swarm("Build a REST API for users");
 *   
 *   // With options
 *   const result = await swarm("Build a REST API", {
 *     mode: 'fanout-critique',
 *     providers: ['claude', 'gemini'],
 *     contract: 'strict',
 *     json: true,
 *   });
 *   
 *   // Full control
 *   const result = await runSwarm({
 *     mode: 'hierarchical',
 *     task: "Build a REST API",
 *     agents: [
 *       { provider: 'codex', role: 'implementer' },
 *       { provider: 'claude', role: 'critic' },
 *       { provider: 'gemini', role: 'researcher' },
 *     ],
 *     maxRounds: 3,
 *   }, STRICT_CONTRACT);
 */

// Types
export * from './types';

// Contract layer
export * from './contract';

// Provider layer
export * from './providers';

// Circuit breaker
export * from './circuit-breaker';

// Judge
export { runJudge, formatJudgeResult } from './judge';
export type { JudgeConfig, JudgeResult } from './judge';

// Persistence
export { persistSwarmRun, listRuns, loadRun, formatRunSummary, getRunDir } from './persistence';

// Runner
export { runSwarmRound, createDefaultAgents, runHealthCheck } from './runner';

// Synthesizer
export { synthesize, formatSynthesis } from './synthesizer';

// Telemetry
export {
  makeRunId,
  hashPrompt,
  writeRunRecord,
  listRunRecords,
  estimateCost,
} from './telemetry';
export type {
  TelemetryOptions,
  FallbackAttemptRecord,
  FallbackRunRecord,
} from './telemetry';

// Fallback system (tiered, cost-aware, with validator gate + telemetry)
export {
  runWithFallback,
  getPlan,
  assessComplexity,
  estimateTokens,
  clearHealthCache,
  FALLBACK_PLANS,
} from './fallback';
export type {
  FallbackPlan,
  FallbackStep,
  FallbackContext,
  FallbackResult,
  FallbackOptions,
  ValidatorResult,
  OutputValidator,
} from './fallback';

// Orchestrator (main entry points)
export { swarm, runSwarm, swarmCLI } from './orchestrator';
