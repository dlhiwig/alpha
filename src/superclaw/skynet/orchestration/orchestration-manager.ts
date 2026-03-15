// @ts-nocheck
/**
 * 🦊 SKYNET ORCHESTRATION MANAGER — Orchestration Lifecycle Management
 * 
 * Extracted from sub-agent.ts as part of refactoring effort.
 * Manages the global orchestration context and initialization.
 */

import { AgentOrchestrator } from '../../orchestration/AgentOrchestrator';
import { WorkspaceManager } from '../../standalone/workspace';
import { LethalTrifectaSandbox } from '../sandbox';
import type { OrchestratorConfig } from '../../orchestration/types';
import type { OrchestrationContext } from '../types/sub-agent.types';

// Global orchestration context (singleton)
let globalOrchestration: OrchestrationContext | null = null;

/**
 * Initialize the global orchestration context
 */
export async function initializeOrchestration(config?: Partial<OrchestratorConfig>): Promise<OrchestrationContext> {
  if (globalOrchestration?.isInitialized) {
    return globalOrchestration;
  }

  console.log('🚀 Initializing SKYNET Beast Mode Orchestration...');

  // Create orchestrator with enhanced config for beast mode
  const orchestratorConfig: Partial<OrchestratorConfig> = {
    maxConcurrentAgents: 50,     // Beast mode: 50 concurrent agents
    agentTimeoutMs: 300000,      // 5 minutes timeout
    heartbeatIntervalMs: 30000,  // 30 second heartbeats
    workspaceBaseDir: '~/.superclaw/agent-workspaces',
    enableGitWorktrees: true,
    ...config
  };

  const orchestrator = new AgentOrchestrator(orchestratorConfig);
  await orchestrator.initialize();

  // Create workspace manager for isolation
  const workspaceManager = new WorkspaceManager({
    root: orchestratorConfig.workspaceBaseDir || '~/.superclaw/agent-workspaces',
    maxFileSize: 100 * 1024 * 1024, // 100MB per file
    allowedExtensions: ['.ts', '', '.json', '.md', '.txt', '.py', '.sh'] // Code and docs only
  });

  // Create the Lethal Trifecta+ sandbox with formal verification
  const sandbox = new LethalTrifectaSandbox(true); // Enable formal verification

  globalOrchestration = {
    orchestrator,
    workspaceManager,
    sandbox,
    isInitialized: true
  };

  console.log('✅ SKYNET Beast Mode Orchestration initialized');
  console.log(`   Max Agents: ${orchestratorConfig.maxConcurrentAgents}`);
  console.log(`   Workspace: ${orchestratorConfig.workspaceBaseDir}`);
  console.log(`   Sandbox: Lethal Trifecta+ with Formal Verification`);

  return globalOrchestration;
}

/**
 * Get the global orchestration context (initialize if needed)
 */
export async function getOrchestration(): Promise<OrchestrationContext> {
  if (!globalOrchestration?.isInitialized) {
    return await initializeOrchestration();
  }
  return globalOrchestration;
}

/**
 * Shutdown the global orchestration context
 */
export async function shutdownOrchestration(): Promise<void> {
  if (globalOrchestration?.isInitialized) {
    console.log('🛑 Shutting down SKYNET orchestration...');
    await globalOrchestration.orchestrator.shutdown();
    globalOrchestration.isInitialized = false;
    globalOrchestration = null;
    console.log('✅ SKYNET orchestration shutdown complete');
  }
}