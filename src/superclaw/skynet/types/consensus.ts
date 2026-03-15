/**
 * Consensus Types - Shared type definitions
 */

export type ConsensusMode = 'majority' | 'unanimous' | 'weighted' | 'judge';

export interface ConsensusConfig {
  mode: ConsensusMode;
  minAgents: number;
  timeout: number;
  requiredConfidence?: number;
}

export interface ConsensusVote {
  agentId: string;
  choice: string;
  confidence: number;
  reasoning?: string;
  timestamp: Date;
}

export interface ConsensusResult {
  decision: string;
  votes: ConsensusVote[];
  confidence: number;
  mode: ConsensusMode;
  unanimous: boolean;
  dissent: string[];
}

export interface ConsensusSession {
  id: string;
  config: ConsensusConfig;
  votes: ConsensusVote[];
  status: 'pending' | 'complete' | 'timeout' | 'failed';
  startedAt: Date;
  completedAt?: Date;
}

export function createDefaultConsensusConfig(): ConsensusConfig {
  return {
    mode: 'majority',
    minAgents: 2,
    timeout: 30000,
    requiredConfidence: 0.6
  };
}

export function isConsensusReached(session: ConsensusSession): boolean {
  return session.status === 'complete';
}

// Additional types required by skynet/index.ts
export interface PersistentMemoryState {
  entries: Array<{ id: string; content: string }>;
  version: number;
  lastModified: Date;
}

export interface MemoryCommit {
  id: string;
  message: string;
  timestamp: Date;
  parentId?: string;
}

export interface MemoryBranch {
  id: string;
  name: string;
  commits: MemoryCommit[];
}

export interface OrchestratorConfig {
  maxAgents: number;
  timeout: number;
  retries?: number;
}

export interface OrchestrationTask {
  id: string;
  type: string;
  status: 'pending' | 'running' | 'complete' | 'failed';
  agents: string[];
}

export interface SandboxConfig {
  image?: string;
  memory?: string;
  cpu?: number;
  timeout?: number;
}

export interface SandboxResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode: number;
}

export interface ConsensusRequest {
  id: string;
  question: string;
  options: string[];
  config: ConsensusConfig;
}

export interface ValidationCriteria {
  minConfidence: number;
  requiredApprovals: number;
  timeout: number;
}
