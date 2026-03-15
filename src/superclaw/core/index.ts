/**
 * SuperClaw Core Components
 */

// State management
export {
  SwarmStateMachine,
  SwarmState,
  SwarmStateType,
  SwarmEvent as StateMachineEvent,
  SwarmEventType,
  SwarmConfig,
  SwarmContext,
  StateHistoryEntry,
  createSwarmStateMachine,
} from './state-machine';

// Agent management
export {
  AgentPool,
  AgentType,
  AgentConfig,
  TrustTier,
  AgentInstance,
  AgentCallResult,
  createDefaultPool,
  createMinimalPool,
} from './agent-pool';

// Service layer
export {
  SwarmService,
  SwarmRun,
  SwarmRunConfig,
  SwarmTask,
  SwarmTaskResult,
  SwarmEvent,
  getSwarmService,
} from './swarm-service';

// Governance
export {
  ContinueGate,
  ContinueGateConfig,
  ContinueDecision,
  ContinueEvaluation,
  StepMetrics,
  createContinueGate,
} from './continue-gate';

export {
  EconomicGovernor,
  BudgetConfig,
  BudgetState,
  BudgetCheckResult,
  BudgetWarning,
  createEconomicGovernor,
  BUDGET_PRESETS,
} from './economic-governor';

// SONA integration
export {
  SonaAdapter,
  SonaAdapterConfig,
  TrajectoryContext,
  RoutingRecommendation,
  LearningStats,
  getDefaultSonaAdapter,
  initSonaAdapter,
} from './sona-adapter';

export {
  ModelRouter,
  ModelRouterConfig,
  Task,
  ModelSelection,
  RoutingStats,
  getDefaultModelRouter,
  initModelRouter,
} from './model-router';

// Utilities
export * from './classifier';
export * from './errors';
export * from './lightweight-swarm';
