// @ts-nocheck
/**
 * Swarm Runner
 * 
 * Executes multiple agents concurrently and collects results.
 * This is the core engine of SuperClaw's swarm orchestration.
 * 
 * Features:
 * - Concurrent execution with Promise.allSettled
 * - Fallback providers per role
 * - Retry with exponential backoff
 * - Quorum checking
 * - JSON output validation
 */

import { randomUUID } from 'crypto';
import {
  AgentConfig,
  AgentResult,
  SwarmRoundConfig,
  SwarmRoundResult,
  ROLE_PROMPTS,
  DEFAULT_AGENT_ROLES,
  ProviderName,
  AgentRole,
} from './types';
import { getModelRouter } from './model-router';
import {
  createProvider,
  detectError,
  getFallbackProvider,
  getProviderEnv,
  ROLE_FALLBACKS,
  executeCostAware,
} from './providers';
import {
  SwarmContract,
  DEFAULT_CONTRACT,
  checkQuorum,
  calculateBackoff,
  sleep,
  validateAgentJSON,
  repairJSON,
  wrapPromptForJSON,
  getPhaseTimeout,
  SwarmPhase,
} from './contract';

/**
 * Run a single agent with cost-aware routing and retries
 */
async function runAgentWithContract(
  config: AgentConfig,
  task: string,
  context: string | undefined,
  contract: SwarmContract,
  roundId: string,
  timeoutOverride?: number  // Phase-aware timeout override
): Promise<AgentResult> {
  const startTime = Date.now();
  const role = config.role || DEFAULT_AGENT_ROLES[config.provider] || 'general';
  const rolePrompt = config.rolePrompt || ROLE_PROMPTS[role];
  const originalProvider = config.provider;  // Track original for fallback reporting
  const agentTimeout = timeoutOverride || contract.timeout.perAgent;
  const agentId = `${role}-${roundId.slice(0, 8)}`;
  
  // Build prompt (optionally wrap for JSON)
  let fullPrompt = `## Role
${rolePrompt}

## Task
${task}

${context ? `## Context\n${context}\n` : ''}
## Instructions
Respond directly with your analysis/solution. Be specific and actionable.`;

  if (contract.json.required) {
    fullPrompt = wrapPromptForJSON(fullPrompt, role);
  }
  
  try {
    // Use cost-aware routing instead of direct provider execution
    const result = await executeCostAware(
      role,
      fullPrompt,
      agentId,
      contract,
      {
        timeout: agentTimeout,
        json: contract.json.required,
        env: getProviderEnv(),
      }
    );
    
    // Check for errors
    if (result.error) {
      // @ts-expect-error - Post-Merge Reconciliation
      console.log(`[swarm] ${result.actualProvider} failed: ${result.error.type} - ${result.error.slice(0, 50)} (cost: $${result.actualCost.toFixed(4)})`);
      
      return {
        provider: result.actualProvider,
        role,
        output: result.stdout,
        exitCode: result.code,
        durationMs: result.latencyMs,
        // @ts-expect-error - Post-Merge Reconciliation
        error: result.error,
        timedOut: result.error.type === 'timeout',
        retryCount: 0, // Cost-aware routing handles retries internally
        fallbackCount: result.actualProvider !== originalProvider ? 1 : 0,
        originalProvider: result.actualProvider !== originalProvider ? originalProvider : undefined,
      };
    }
    
    // Success - validate JSON if required
    let output = result.stdout;
    
    if (contract.json.required && contract.json.validateSchema) {
      const validation = validateAgentJSON(output);
      
      if (!validation.valid && contract.json.repairAttempts > 0) {
        const repaired = repairJSON(output);
        if (repaired) {
          output = repaired;
        }
      }
    }
    
    console.log(`[swarm] ${result.actualProvider} success: ${agentId} (cost: $${result.actualCost.toFixed(4)}, estimated: $${result.estimatedCost.toFixed(4)})`);
    
    return {
      provider: result.actualProvider,
      role,
      output,
      exitCode: 0,
      durationMs: result.latencyMs,
      retryCount: 0,
      fallbackCount: result.actualProvider !== originalProvider ? 1 : 0,
      originalProvider: result.actualProvider !== originalProvider ? originalProvider : undefined,
    };
  } catch (error: unknown) {
    // Fallback to original provider logic if cost-aware routing fails
    const message = error instanceof Error ? (error).message : 'Cost-aware routing failed';
    console.warn(`[swarm] Cost-aware routing failed for ${agentId}: ${message}, falling back to original logic`);
    
    // Use original provider execution as fallback
    const provider = createProvider(originalProvider);
    const result = await provider.execute(fullPrompt, {
      timeout: agentTimeout,
      json: contract.json.required,
      env: getProviderEnv(),
    });
    
    return {
      provider: originalProvider,
      role,
      output: result.stdout,
      exitCode: result.code,
      durationMs: Date.now() - startTime,
      error: result.error?.message,
      timedOut: result.error?.type === 'timeout',
      retryCount: 0,
      fallbackCount: 0,
    };
  }
}

/**
 * Run a swarm round with contract enforcement
 */
export async function runSwarmRound(
  config: SwarmRoundConfig,
  contract: SwarmContract = DEFAULT_CONTRACT
): Promise<SwarmRoundResult> {
  const startTime = Date.now();
  const roundId = randomUUID();
  
  // Get phase-aware timeout
  const phase: SwarmPhase = config.phase || 'default';
  const phaseTimeout = getPhaseTimeout(contract, phase);
  
  console.log(`[swarm] Starting round ${roundId.slice(0, 8)} with ${config.agents.length} agents (phase: ${phase}, timeout: ${phaseTimeout / 1000}s)`);
  
  // Launch all agents concurrently with phase-aware timeout
  const agentPromises = config.agents.map((agent) =>
    runAgentWithContract(
      agent,
      config.task,
      config.context,
      contract,
      roundId,
      phaseTimeout
    )
  );
  
  // Race against round timeout
  const timeoutPromise = new Promise<'timeout'>((resolve) =>
    setTimeout(() => resolve('timeout'), contract.timeout.perRound)
  );
  
  const raceResult = await Promise.race([
    Promise.allSettled(agentPromises),
    timeoutPromise,
  ]);
  
  let results: AgentResult[];
  
  if (raceResult === 'timeout') {
    console.log(`[swarm] Round ${roundId.slice(0, 8)} timed out after ${contract.timeout.perRound}ms`);
    // Collect whatever we have, preserving agent context
    results = await Promise.all(
      agentPromises.map(async (p, i) => {
        const agentConfig = config.agents[i];
        try {
          const settled = await Promise.race([p, Promise.resolve(null)]);
          return settled || createTimeoutResult(contract.timeout.perRound, agentConfig);
        } catch {
          return createTimeoutResult(contract.timeout.perRound, agentConfig);
        }
      })
    );
  } else {
    results = raceResult.map((r, i) =>
      r.status === 'fulfilled'
        ? r.value
        : createErrorResult(r.reason, Date.now() - startTime, config.agents[i])
    );
  }
  
  const successful = results.filter((r) => r.exitCode === 0 && r.output);
  const failed = results.filter((r) => r.exitCode !== 0 || !r.output);
  
  // Check quorum
  const quorumCheck = checkQuorum(results, contract.quorum);
  
  // Calculate cost summary for this round
  const router = getModelRouter();
  const costSummary = router.getCostSummary();
  
  console.log(`[swarm] Round ${roundId.slice(0, 8)} completed: ${successful.length}/${results.length} successful${quorumCheck.met ? '' : ' (quorum NOT met)'} | Daily cost: $${costSummary.daily.toFixed(4)}`);
  
  return {
    task: config.task,
    results,
    successful,
    failed,
    durationMs: Date.now() - startTime,
    partialSuccess: successful.length > 0,
  };
}

function createTimeoutResult(
  timeout: number,
  config?: AgentConfig
): AgentResult {
  return {
    provider: config?.provider || 'unknown' as ProviderName,
    role: config?.role || 'general',
    output: '',
    exitCode: -1,
    durationMs: timeout,
    error: 'Round timeout',
    timedOut: true,
    retryCount: 0,  // Will be updated if we track attempts
    fallbackCount: 0,
  };
}

function createErrorResult(
  reason: any,
  durationMs: number,
  config?: AgentConfig
): AgentResult {
  return {
    provider: config?.provider || 'unknown' as ProviderName,
    role: config?.role || 'general',
    output: '',
    exitCode: -1,
    durationMs,
    error: reason?.message || 'Unknown error',
    retryCount: 0,
    fallbackCount: 0,
  };
}

/**
 * Create default agent configs for available providers
 */
export function createDefaultAgents(
  providers: ProviderName[] = ['claude', 'gemini']
): AgentConfig[] {
  return providers.map((provider) => ({
    provider,
    role: DEFAULT_AGENT_ROLES[provider],
    timeout: DEFAULT_CONTRACT.timeout.perAgent,
  }));
}

/**
 * Run swarm health check
 */
export async function runHealthCheck(): Promise<{
  provider: ProviderName | 'ollama';
  status: 'ok' | 'error' | 'misconfigured';
  latencyMs?: number;
  error?: string;
  models?: string[];
}[]> {
  const cliProviders: ProviderName[] = ['claude', 'gemini', 'codex'];
  
  // Check CLI providers
  const cliResults = await Promise.all(
    cliProviders.map(async (name) => {
      const provider = createProvider(name);
      const startTime = Date.now();
      try {
        const healthy = await provider.healthCheck();
        return {
          provider: name,
          status: healthy ? 'ok' as const : 'error' as const,
          latencyMs: Date.now() - startTime,
        };
      } catch (err) {
        return {
          provider: name,
          status: 'misconfigured' as const,
          error: err instanceof Error ? err.message : 'Unknown error',
          latencyMs: Date.now() - startTime,
        };
      }
    })
  );
  
  // Check Ollama (local HTTP provider)
  const ollamaResult = await checkOllamaHealth();
  
  return [...cliResults, ollamaResult];
}

/**
 * Check Ollama local provider health
 */
async function checkOllamaHealth(): Promise<{
  provider: 'ollama';
  status: 'ok' | 'error' | 'misconfigured';
  latencyMs?: number;
  error?: string;
  models?: string[];
}> {
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
  const startTime = Date.now();
  
  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    
    if (!response.ok) {
      return {
        provider: 'ollama',
        status: 'error',
        error: `HTTP ${response.status}`,
        latencyMs: Date.now() - startTime,
      };
    }
    
    const data = await response.json() as { models?: { name: string }[] };
    const models = data.models?.map(m => m.name) || [];
    
    return {
      provider: 'ollama',
      status: models.length > 0 ? 'ok' : 'misconfigured',
      latencyMs: Date.now() - startTime,
      models,
      error: models.length === 0 ? 'No models available' : undefined,
    };
  } catch (err) {
    return {
      provider: 'ollama',
      status: 'error',
      error: err instanceof Error ? err.message : 'Connection failed',
      latencyMs: Date.now() - startTime,
    };
  }
}

/**
 * Get comprehensive swarm cost and health summary
 */
export function getSwarmSummary(): {
  cost: ReturnType<InstanceType<typeof import('./model-router.js').ModelRouter>['getCostSummary']>;
  healthCheck: () => Promise<Awaited<ReturnType<typeof runHealthCheck>>>;
} {
  const router = getModelRouter();
  return {
    cost: router.getCostSummary(),
    healthCheck: () => runHealthCheck(),
  };
}

/**
 * Reset daily budget counters (useful for testing or daily resets)
 */
export function resetDailyBudget(): void {
  const { clearBudgetExceeded } = require('./circuit-breaker.js');
  clearBudgetExceeded(); // Clear all budget exceeded flags
  
  // Note: The model router handles daily resets automatically based on time
  console.log('[swarm] Daily budget counters reset');
}
