// @ts-nocheck
/**
 * Swarm Orchestrator
 * 
 * High-level orchestration of multi-agent swarm rounds.
 * This is the main entry point for SuperClaw's swarm functionality.
 */

import {
  SwarmConfig,
  SwarmResult,
  SwarmRoundResult,
  AgentConfig,
  AgentRole,
  SynthesisResult,
  ProviderName,
  DEFAULT_AGENT_ROLES,
  ROLE_PROMPTS,
} from './types';
import { runSwarmRound, createDefaultAgents, runHealthCheck } from './runner';
import { synthesize, formatSynthesis } from './synthesizer';
import {
  SwarmContract,
  DEFAULT_CONTRACT,
  STRICT_CONTRACT,
  FAST_CONTRACT,
  checkQuorum,
  getPhaseTimeout,
  inferPhase,
  SwarmPhase,
  adaptQuorumToProviders,
} from './contract';
import { getConfiguredProviders } from './providers';
import { runJudge, formatJudgeResult, JudgeResult } from './judge';
import { shouldSkipProvider, formatHealthStatus } from './circuit-breaker';
import { persistSwarmRun, listRuns, loadRun, formatRunSummary } from './persistence';

const DEFAULT_MAX_ROUNDS = 2;

// Use configured providers (those with API keys set)
function getAvailableProviders(): ProviderName[] {
  const configured = getConfiguredProviders();
  // Prefer claude and gemini if available
  const preferred: ProviderName[] = ['claude', 'gemini'];
  const available = preferred.filter((p) => configured.includes(p));
  return available.length > 0 ? available : configured.slice(0, 2);
}

/**
 * Run a swarm with the specified mode
 */
export async function runSwarm(
  config: SwarmConfig,
  contract: SwarmContract = DEFAULT_CONTRACT
): Promise<SwarmResult> {
  const startTime = Date.now();
  const availableProviders = getAvailableProviders();
  const agents = config.agents || createDefaultAgents(availableProviders);
  const maxRounds = config.maxRounds || DEFAULT_MAX_ROUNDS;
  
  // Adapt quorum to available providers (prevents impossible quorum requirements)
  const availableRoles = agents.map(a => a.role).filter((r): r is AgentRole => !!r);
  contract = adaptQuorumToProviders(contract, availableProviders.length, availableRoles);
  
  console.log(`[swarm] Starting swarm (mode: ${config.mode}, agents: ${agents.length}, providers: ${availableProviders.join(', ')})`);
  
  const rounds: SwarmRoundResult[] = [];
  let synthesis: SynthesisResult;
  
  switch (config.mode) {
    case 'fanout':
      // Single round: fan out to all agents, merge results
      const round1 = await runSwarmRound({
        task: config.task,
        context: config.context,
        agents,
        json: config.json,
        phase: 'fanout',
      }, contract);
      rounds.push(round1);
      synthesis = await synthesize(round1);
      break;
      
    case 'fanout-critique':
      // Round 1: All agents generate solutions (don't filter - need quorum)
      // Round 2: All agents critique (role prompt changes, not agent filtering)
      const genRound = await runSwarmRound({
        task: config.task,
        context: config.context,
        agents: agents,  // All agents generate
        json: config.json,
        phase: 'fanout',
      }, contract);
      rounds.push(genRound);
      
      const genSynthesis = await synthesize(genRound);
      
      // Round 2: All agents review with critic role prompt
      if (genSynthesis.confidence > 0) {
        const critiqueAgents = agents.map(a => ({
          ...a,
          role: 'critic' as const,  // Override role for critique round
          rolePrompt: ROLE_PROMPTS['critic'],
        }));
        const critiqueRound = await runSwarmRound({
          task: `Review and critique this proposed solution:\n\n${genSynthesis.solution}`,
          context: `Original task: ${config.task}`,
          agents: critiqueAgents,
          json: config.json,
          phase: 'critique',
        }, contract);
        rounds.push(critiqueRound);
        
        // Merge critiques into synthesis
        synthesis = await synthesize({
          ...genRound,
          results: [...genRound.results, ...critiqueRound.results],
          successful: [...genRound.successful, ...critiqueRound.successful],
          failed: [...genRound.failed, ...critiqueRound.failed],
        });
      } else {
        synthesis = genSynthesis;
      }
      break;
      
    case 'hierarchical':
      // Round 1: Implementer generates
      // Round 2: Critics review
      // Round 3: Implementer revises based on critiques
      const implementers = agents.filter((a) => a.role === 'implementer' || a.role === 'general');
      const critics = agents.filter((a) => a.role === 'critic' || a.role === 'researcher');
      
      // Round 1: Implementation (longest timeout)
      const implRound = await runSwarmRound({
        task: config.task,
        context: config.context,
        agents: implementers.length > 0 ? implementers : [agents[0]],
        json: config.json,
        phase: 'implement',
      }, contract);
      rounds.push(implRound);
      
      const implSynthesis = await synthesize(implRound);
      
      if (implSynthesis.confidence > 0 && critics.length > 0 && rounds.length < maxRounds) {
        // Round 2: Critique
        const critRound = await runSwarmRound({
          task: `Review this implementation for issues, risks, and improvements:\n\n${implSynthesis.solution}`,
          context: `Original task: ${config.task}`,
          agents: critics,
          json: config.json,
          phase: 'critique',
        }, contract);
        rounds.push(critRound);
        
        const critSynthesis = await synthesize(critRound);
        
        // Round 3: Revision if there were concerns
        if (critSynthesis.risks.length > 0 && implementers.length > 0 && rounds.length < maxRounds) {
          const reviseRound = await runSwarmRound({
            task: `Revise your implementation to address these concerns:\n\n${critSynthesis.risks.join('\n')}\n\nOriginal implementation:\n${implSynthesis.solution}`,
            context: `Original task: ${config.task}`,
            agents: implementers,
            json: config.json,
            phase: 'revise',
          }, contract);
          rounds.push(reviseRound);
          
          synthesis = await synthesize(reviseRound);
        } else {
          synthesis = implSynthesis;
          synthesis.risks = [...synthesis.risks, ...critSynthesis.risks];
        }
      } else {
        synthesis = implSynthesis;
      }
      break;
      
    default:
      throw new Error(`Unknown swarm mode: ${config.mode}`);
  }
  
  // Apply quorum-based confidence cap
  const quorumCheck = checkQuorum(rounds[rounds.length - 1]?.results || [], contract.quorum);
  if (!quorumCheck.met) {
    synthesis.confidence = Math.min(synthesis.confidence, contract.quorum.maxConfidenceWithoutQuorum);
    console.log(`[swarm] Quorum not met: ${quorumCheck.reason}. Confidence capped at ${(synthesis.confidence * 100).toFixed(0)}%`);
  }
  
  // Run judge step if enabled (uses judge phase timeout)
  let judge: JudgeResult | undefined;
  if (contract.judge.enabled && synthesis.confidence > 0) {
    const judgeTimeout = getPhaseTimeout(contract, 'judge');
    judge = await runJudge(synthesis, {
      provider: contract.judge.provider as ProviderName,
      timeout: judgeTimeout,
    });
    console.log(`[swarm] Judge completed: confidence ${(judge.finalConfidence * 100).toFixed(0)}%`);
  }
  
  console.log(`[swarm] Swarm completed: ${rounds.length} rounds, confidence ${(synthesis.confidence * 100).toFixed(0)}%`);
  
  const result: SwarmResult = {
    mode: config.mode,
    rounds,
    synthesis,
    totalDurationMs: Date.now() - startTime,
  };
  
  // Persist run
  try {
    const runId = await persistSwarmRun(config.task, result, judge, 'default');
    console.log(`[swarm] Run persisted: ${runId}`);
  } catch (e) {
    // Don't fail if persistence fails
    console.log(`[swarm] Persistence failed: ${e}`);
  }
  
  return result;
}

/**
 * Simple one-shot swarm for a task
 */
export async function swarm(
  task: string,
  options: {
    mode?: SwarmConfig['mode'];
    providers?: ProviderName[];
    context?: string;
    json?: boolean;
    contract?: 'default' | 'strict' | 'fast';
  } = {}
): Promise<SwarmResult> {
  const providers = options.providers || getAvailableProviders();
  const agents = createDefaultAgents(providers);
  
  // Select contract
  let contract = DEFAULT_CONTRACT;
  if (options.contract === 'strict') {contract = STRICT_CONTRACT;}
  if (options.contract === 'fast') {contract = FAST_CONTRACT;}
  
  return runSwarm({
    mode: options.mode || 'fanout',
    task,
    context: options.context,
    agents,
    json: options.json,
  }, contract);
}

/**
 * CLI entry point for swarm command
 */
export async function swarmCLI(args: string[]): Promise<void> {
  // Health check mode (before task check)
  if (args.includes('--health')) {
    console.log('[swarm] Running health check...\n');
    const results = await runHealthCheck();
    for (const r of results) {
      const icon = r.status === 'ok' ? '✅' : r.status === 'misconfigured' ? '⚠️' : '❌';
      console.log(`${icon} ${r.provider}: ${r.status}${r.error ? ` - ${r.error}` : ''}`);
    }
    return;
  }
  
  const task = args.filter((a) => !a.startsWith('--')).join(' ');
  
  if (!task) {
    console.error('Usage: superclaw swarm "<task>" [options]');
    console.error('');
    console.error('Options:');
    console.error('  --mode=fanout|fanout-critique|hierarchical');
    console.error('  --agents=claude,gemini,codex');
    console.error('  --contract=default|strict|fast');
    console.error('  --json       Request JSON output');
    console.error('  --health     Run provider health check');
    process.exit(2);
  }
  
  // Parse flags
  const modeArg = args.find((a) => a.startsWith('--mode='));
  const mode = (modeArg?.split('=')[1] || 'fanout') as SwarmConfig['mode'];
  
  const agentsArg = args.find((a) => a.startsWith('--agents='));
  const providers = agentsArg?.split('=')[1].split(',') as ProviderName[] | undefined;
  
  const contractArg = args.find((a) => a.startsWith('--contract='));
  const contractType = (contractArg?.split('=')[1] || 'default') as 'default' | 'strict' | 'fast';
  
  const json = args.includes('--json');
  const explain = args.includes('--explain');
  
  // Select contract
  let contract = DEFAULT_CONTRACT;
  if (contractType === 'strict') {contract = STRICT_CONTRACT;}
  if (contractType === 'fast') {contract = FAST_CONTRACT;}
  
  console.log(`[swarm] Task: ${task}`);
  console.log(`[swarm] Mode: ${mode}`);
  console.log(`[swarm] Contract: ${contractType}`);
  
  // Explain mode: show contract decisions
  if (explain) {
    console.log('');
    console.log('=== Contract Explanation ===');
    console.log(`Timeout: ${contract.timeout.perAgent / 1000}s per agent, ${contract.timeout.perRound / 1000}s per round`);
    console.log(`Retries: ${contract.retry.maxRetries}x with ${contract.retry.backoffMs}ms backoff`);
    console.log(`Quorum: min ${contract.quorum.minAgents} agents${contract.quorum.requiredRoles ? `, roles: ${contract.quorum.requiredRoles.join(', ')}` : ''}`);
    console.log(`Confidence cap (no quorum): ${(contract.quorum.maxConfidenceWithoutQuorum * 100).toFixed(0)}%`);
    console.log(`Fallbacks: ${contract.fallback.enabled ? `enabled (max ${contract.fallback.maxFallbacks})` : 'disabled'}`);
    console.log(`Circuit breaker: ${contract.circuitBreaker.enabled ? 'enabled' : 'disabled'}${contract.circuitBreaker.skipMisconfigured ? ', skip misconfigured' : ''}${contract.circuitBreaker.skipDegraded ? ', skip degraded' : ''}`);
    console.log(`Judge: ${contract.judge.enabled ? `enabled (${contract.judge.provider})` : 'disabled'}`);
    console.log(`JSON required: ${contract.json.required ? 'yes' : 'no'}`);
    
    // Show provider eligibility
    const configured = getConfiguredProviders();
    console.log('');
    console.log('=== Provider Eligibility ===');
    for (const p of ['claude', 'gemini', 'codex', 'deepseek'] as ProviderName[]) {
      const isConfigured = configured.includes(p);
      const breakerCheck = shouldSkipProvider(p, contract.circuitBreaker);
      const status = !isConfigured ? '❌ not configured' :
                     breakerCheck.skip ? `⚠️ ${breakerCheck.reason}` : '✅ eligible';
      console.log(`  ${p}: ${status}`);
    }
    console.log('');
  }
  
  console.log('');
  
  try {
    const result = await swarm(task, { mode, providers, json, contract: contractType });
    
    console.log('');
    console.log('='.repeat(60));
    console.log(formatSynthesis(result.synthesis));
    console.log('='.repeat(60));
    console.log('');
    console.log(`⏱️  Total time: ${(result.totalDurationMs / 1000).toFixed(1)}s`);
    console.log(`🔄 Rounds: ${result.rounds.length}`);
    console.log(`📊 Confidence: ${(result.synthesis.confidence * 100).toFixed(0)}%`);
    
  } catch (error: unknown) {
    console.error('Swarm failed:', error);
    process.exit(1);
  }
}
