// @ts-nocheck
/**
 * 🦊 SKYNET SUB-AGENT TYPES — Type Definitions for Agent Management
 * 
 * Extracted from sub-agent.ts as part of refactoring effort.
 * Contains all interfaces and types related to sub-agent management.
 */

import { AgentIdentity, AgentSession, SessionStatus, OrchestratorConfig, MessageType } from '../../orchestration/types';
import { AgentOrchestrator } from '../../orchestration/AgentOrchestrator';
import { WorkspaceManager } from '../../standalone/workspace';
import { LethalTrifectaSandbox } from '../sandbox';
import { InterAgentMessage } from "../../types/index";

export interface SubAgentConfig {
  name: string;
  model: string;
  goal: string;
  permissions: string[];
  resourceLimits?: {
    maxTokens?: number;
    maxRequests?: number;
    maxCpuTime?: number;        // milliseconds
    maxMemory?: number;         // bytes
    timeoutMs?: number;         // auto-kill timeout
  };
  env?: Record<string, string>;
  workdir?: string;
  onOutput?: (data: string) => void;
  onError?: (error: string) => void;
  
  // New orchestration options
  project?: string;            // Project namespace (default: 'skynet')
  role?: 'controller' | 'manager' | 'validator' | 'merger' | 'worker' | 'judge';
  namespace?: string;          // Logical namespace (default: 'skynet')
  capabilities?: string[];     // Agent capabilities
  version?: string;           // Agent version (default: '1.0.0')
  useOrchestrator?: boolean;   // Use new orchestration system (default: true)
  enableSandbox?: boolean;     // Enable formal verification sandbox (default: true)
  enableWorkspaceIsolation?: boolean; // Use WorkspaceManager (default: true)
  parentSessionId?: string;    // Parent agent session for hierarchy
  autoRecover?: boolean;       // Auto-recover on crash (default: true)
}

export interface SubAgentV2Config {
  identity: AgentIdentity;
  goal: string;
  model: string;
  permissions: string[];
  resourceLimits?: SubAgentConfig['resourceLimits'];
  enableSandbox?: boolean;
  enableWorkspaceIsolation?: boolean;
  parentSessionId?: string;
  onOutput?: (data: string) => void;
  onError?: (error: string) => void;
}

export interface OrchestrationContext {
  orchestrator: AgentOrchestrator;
  workspaceManager: WorkspaceManager;
  sandbox: LethalTrifectaSandbox;
  isInitialized: boolean;
}

export interface SubAgentStats {
  id: string;
  name: string;
  status: 'running' | 'paused' | 'stopped' | 'error';
  uptime: number;
  memoryUsage: number;
  cpuUsage: number;
  messagesProcessed: number;
  errorsCount: number;
  lastActivity: Date;
  resourceLimits: SubAgentConfig['resourceLimits'];
  project: string;
  role: string;
  capabilities: string[];
  currentTask?: string;
  workspaceId?: string;
  sessionId?: string;
}