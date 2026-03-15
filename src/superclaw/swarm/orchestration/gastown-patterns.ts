/**
 * Gas Town Orchestration Patterns
 * 
 * Implements Gas Town's Mayor pattern for SuperClaw swarm coordination.
 * Provides the interface expected by the test suite.
 */

// Re-export everything from the mayor module
export {
  SwarmMayor as Mayor,
  createMayor,
  initializeGasTownWorkspace,
  gastownSwarm,
  type Bead,
  type Polecat,
  type Convoy,
  type Rig,
  type PolecatIdentity,
  type TaskAnalysis,
  type OrchestrationStrategy,
  type OrchestrationPhase,
  type ConvoyStatus,
  type OrchestrationResult,
  type MayorState,
} from '../mayor';