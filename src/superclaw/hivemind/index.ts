// @ts-nocheck
/**
 * Hivemind Module
 * 
 * Multi-model AI orchestration layer for SuperClaw.
 */

export { CLIAgent, type CLIType, type CLIAgentConfig, type CLIResponse } from './cli-agent';
export { routeTask, analyzeTask, type TaskMetadata, type RoutingStrategy, type RoutingDecision } from './router';
export { buildConsensus, type AgentResult, type ConsensusResult } from './consensus';
export { HivemindCoordinator, type HivemindConfig, type HivemindTask, type HivemindResult } from './coordinator';
