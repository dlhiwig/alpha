/**
 * Swarm Persistence
 * 
 * Durable logging of swarm runs for replay and debugging.
 * Stores runs in ~/.superclaw/runs/<timestamp>/
 */

import { mkdir, writeFile, readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { SwarmResult, SwarmRoundResult, AgentResult, SynthesisResult } from './types';
import { JudgeResult } from './judge';

const RUNS_DIR = join(homedir(), '.superclaw', 'runs');

export interface SwarmRun {
  id: string;
  timestamp: string;
  task: string;
  mode: string;
  contract: string;
  agents: string[];
  rounds: SwarmRoundResult[];
  synthesis: SynthesisResult;
  judge?: JudgeResult;
  totalDurationMs: number;
  status: 'completed' | 'failed' | 'partial';
  runtimeSignature: string;  // Tamper-evident run identity
}

/**
 * Generate tamper-evident runtime signature
 */
function generateRuntimeSignature(
  task: string,
  contract: string,
  providers: string[],
  timestamp: string
): string {
  const payload = JSON.stringify({
    task,
    contract,
    providers: providers.sort(),
    timestamp,
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/**
 * Compute stability score for a run
 * Higher = more stable execution
 */
function computeStabilityScore(
  result: SwarmResult,
  judge?: JudgeResult
): { score: number; maxScore: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {};
  let score = 0;
  const maxScore = 100;
  
  // Quorum met? (+25)
  const lastRound = result.rounds[result.rounds.length - 1];
  const successfulAgents = lastRound?.successful?.length || 0;
  const totalAgents = lastRound?.results?.length || 1;
  if (successfulAgents >= 2 || successfulAgents === totalAgents) {
    score += 25;
    breakdown.quorumMet = 25;
  } else {
    breakdown.quorumMet = 0;
  }
  
  // No retries needed? (+20)
  const totalRetries = result.rounds.flatMap((r) => 
    r.results.map((a) => a.retryCount || 0)
  ).reduce((a, b) => a + b, 0);
  if (totalRetries === 0) {
    score += 20;
    breakdown.noRetries = 20;
  } else if (totalRetries <= 2) {
    score += 10;
    breakdown.noRetries = 10;
  } else {
    breakdown.noRetries = 0;
  }
  
  // No fallbacks triggered? (+15)
  // Now properly tracked via fallbackCount on each result
  const totalFallbacks = result.rounds.flatMap((r) =>
    r.results.map((a) => a.fallbackCount || 0)
  ).reduce((a, b) => a + b, 0);
  if (totalFallbacks === 0) {
    score += 15;
    breakdown.noFallbacks = 15;
  } else if (totalFallbacks === 1) {
    score += 7;
    breakdown.noFallbacks = 7;
  } else {
    breakdown.noFallbacks = 0;
  }
  
  // No timeouts? (+15)
  const hadTimeout = result.rounds.some((r) => 
    r.results.some((a) => a.timedOut)
  );
  if (!hadTimeout) {
    score += 15;
    breakdown.noTimeouts = 15;
  } else {
    breakdown.noTimeouts = 0;
  }
  
  // Judge confidence delta small? (+15)
  // (Judge didn't drastically change confidence)
  if (judge) {
    const delta = Math.abs(judge.finalConfidence - result.synthesis.confidence);
    if (delta < 0.2) {
      score += 15;
      breakdown.judgeStable = 15;
    } else if (delta < 0.4) {
      score += 7;
      breakdown.judgeStable = 7;
    } else {
      breakdown.judgeStable = 0;
    }
  } else {
    // No judge = neutral (not penalized)
    score += 10;
    breakdown.judgeStable = 10;
  }
  
  // High confidence? (+10)
  if (result.synthesis.confidence >= 0.7) {
    score += 10;
    breakdown.highConfidence = 10;
  } else if (result.synthesis.confidence >= 0.5) {
    score += 5;
    breakdown.highConfidence = 5;
  } else {
    breakdown.highConfidence = 0;
  }
  
  return { score, maxScore, breakdown };
}

/**
 * Generate run ID
 */
function generateRunId(): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rand}`;
}

/**
 * Persist a swarm run
 */
export async function persistSwarmRun(
  task: string,
  result: SwarmResult,
  judge?: JudgeResult,
  contract: string = 'default'
): Promise<string> {
  const runId = generateRunId();
  const runDir = join(RUNS_DIR, runId);
  
  try {
    await mkdir(runDir, { recursive: true });
    await mkdir(join(runDir, 'agent_outputs'), { recursive: true });
    
    // Write task.json
    await writeFile(
      join(runDir, 'task.json'),
      JSON.stringify({
        task,
        mode: result.mode,
        contract,
        timestamp: new Date().toISOString(),
      }, null, 2)
    );
    
    // Write agent outputs per round
    for (let i = 0; i < result.rounds.length; i++) {
      const round = result.rounds[i];
      for (const agentResult of round.results) {
        const filename = `round${i + 1}_${agentResult.provider}_${agentResult.role}.json`;
        await writeFile(
          join(runDir, 'agent_outputs', filename),
          JSON.stringify(agentResult, null, 2)
        );
      }
    }
    
    // Write synthesis.json
    await writeFile(
      join(runDir, 'synthesis.json'),
      JSON.stringify(result.synthesis, null, 2)
    );
    
    // Write judge.json if present
    if (judge) {
      await writeFile(
        join(runDir, 'judge.json'),
        JSON.stringify(judge, null, 2)
      );
    }
    
    // Write final.json (combined result)
    const timestamp = new Date().toISOString();
    const agents = result.rounds.flatMap((r) => r.results.map((a) => a.provider));
    const runtimeSignature = generateRuntimeSignature(task, contract, agents, timestamp);
    
    const finalResult: SwarmRun = {
      id: runId,
      timestamp,
      task,
      mode: result.mode,
      contract,
      agents,
      rounds: result.rounds,
      synthesis: result.synthesis,
      judge,
      totalDurationMs: result.totalDurationMs,
      status: result.synthesis.confidence > 0.5 ? 'completed' :
              result.synthesis.confidence > 0 ? 'partial' : 'failed',
      runtimeSignature,
    };
    
    await writeFile(
      join(runDir, 'final.json'),
      JSON.stringify(finalResult, null, 2)
    );
    
    // Compute stability score
    const stabilityScore = computeStabilityScore(result, judge);
    
    // Write timings.json
    const timings = {
      totalDurationMs: result.totalDurationMs,
      rounds: result.rounds.map((r) => ({
        durationMs: r.durationMs,
        agents: r.results.map((a) => ({
          provider: a.provider,
          role: a.role,
          durationMs: a.durationMs,
          success: a.exitCode === 0,
          retryCount: a.retryCount || 0,
        })),
      })),
      judgeMs: judge?.durationMs,
      stabilityScore,
    };
    
    await writeFile(
      join(runDir, 'timings.json'),
      JSON.stringify(timings, null, 2)
    );
    
    console.log(`[persist] Saved run to ${runDir}`);
    return runId;
    
  } catch (error: unknown) {
    console.error(`[persist] Failed to save run: ${error}`);
    throw error;
  }
}

/**
 * List recent runs
 */
export async function listRuns(limit: number = 10): Promise<string[]> {
  try {
    const dirs = await readdir(RUNS_DIR);
    return dirs
      .sort()
      .reverse()
      .slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Load a run by ID
 */
export async function loadRun(runId: string): Promise<SwarmRun | null> {
  try {
    const runDir = join(RUNS_DIR, runId);
    const finalPath = join(runDir, 'final.json');
    const content = await readFile(finalPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Get run directory path
 */
export function getRunDir(runId: string): string {
  return join(RUNS_DIR, runId);
}

/**
 * Format run summary for display
 */
export function formatRunSummary(run: SwarmRun): string {
  const lines: string[] = [];
  
  lines.push(`## Run: ${run.id}`);
  lines.push('');
  lines.push(`**Task:** ${run.task.slice(0, 100)}${run.task.length > 100 ? '...' : ''}`);
  lines.push(`**Mode:** ${run.mode}`);
  lines.push(`**Contract:** ${run.contract}`);
  lines.push(`**Status:** ${run.status}`);
  lines.push(`**Confidence:** ${(run.synthesis.confidence * 100).toFixed(0)}%`);
  lines.push(`**Duration:** ${(run.totalDurationMs / 1000).toFixed(1)}s`);
  lines.push(`**Agents:** ${run.agents.join(', ')}`);
  lines.push(`**Rounds:** ${run.rounds.length}`);
  
  if (run.judge) {
    lines.push(`**Judge:** ${run.judge.provider} (${(run.judge.finalConfidence * 100).toFixed(0)}%)`);
  }
  
  return lines.join('\n');
}
