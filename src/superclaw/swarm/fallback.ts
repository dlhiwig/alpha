// @ts-nocheck
/**
 * Fallback Plan System
 * 
 * Tiered, cost-aware routing with error-specific handling.
 * 
 * Tiers:
 *   1. Local (Ollama) - free, fast for small tasks
 *   2. Cheap Cloud (Sonnet, Gemini Flash) - default workhorse
 *   3. Premium (Opus, Gemini Pro) - complex reasoning only
 * 
 * Features:
 *   - JSON validator + one-shot repair gate
 *   - Per-run telemetry records
 *   - Health caching (60s TTL)
 *   - Error-specific retry/fallback logic
 */

import { ProviderName } from './types';
import { createProvider, Provider, ProviderResult, ProviderError } from './providers';
import {
  TelemetryOptions,
  FallbackRunRecord,
  FallbackAttemptRecord,
  makeRunId,
  hashPrompt,
  writeRunRecord,
  estimateCost,
} from './telemetry';

// ============================================================================
// JSON Validator Types & Functions
// ============================================================================

export type ValidatorResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

export type OutputValidator = (text: string) => ValidatorResult;

/**
 * Default JSON validator - extracts and parses JSON from text
 */
const defaultJsonValidator: OutputValidator = (text) => {
  const trimmed = (text ?? '').trim();
  
  // Find first { or [
  const startObj = trimmed.indexOf('{');
  const startArr = trimmed.indexOf('[');
  const start =
    startObj === -1 ? startArr :
    startArr === -1 ? startObj :
    Math.min(startObj, startArr);
  
  const candidate = start >= 0 ? trimmed.slice(start) : trimmed;
  
  try {
    const value = JSON.parse(candidate);
    return { ok: true, value };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Invalid JSON';
    return { ok: false, error: msg };
  }
};

/**
 * Build a repair prompt for invalid JSON
 */
function buildJsonRepairPrompt(badText: string, schemaHint?: string): string {
  const hint = schemaHint ? `\nSchema / constraints:\n${schemaHint}\n` : '';
  return [
    'You must output ONLY valid JSON. No prose. No markdown. No code fences.',
    hint,
    'Fix the following output so it becomes valid JSON while preserving the intended meaning.',
    'Return ONLY the corrected JSON.',
    '\n---\nBAD OUTPUT:\n',
    (badText ?? '').slice(0, 20_000), // Cap to prevent runaway
  ].join('\n');
}

// Provider with model specification
export type ProviderId = ProviderName;

export interface FallbackStep {
  provider: ProviderId;
  model?: string;           // Optional model override
  timeoutMs: number;
  maxRetries: number;
  retryOn: Array<'timeout' | 'rate_limit' | 'transient'>;
  skipIf?: (ctx: FallbackContext) => boolean;
}

export interface FallbackContext {
  task: string;
  requiresJson: boolean;
  estTokens: number;
  complexity?: 'simple' | 'medium' | 'complex';
}

export interface FallbackPlan {
  name: string;
  steps: FallbackStep[];
}

export interface FallbackAttempt {
  provider: ProviderId;
  model?: string;
  durationMs: number;
  success: boolean;
  error?: ProviderError;
  skipped?: boolean;
  skipReason?: string;
}

export interface FallbackResult {
  success: boolean;
  providerUsed: ProviderId;
  modelUsed?: string;
  response: string;
  attempts: FallbackAttempt[];
  totalDurationMs: number;
  runId?: string;
  parsedJson?: unknown; // If jsonMode was used and valid
}

export interface FallbackOptions {
  json?: boolean;
  schemaHint?: string;
  validator?: OutputValidator;
  telemetry?: TelemetryOptions;
}

// Health cache (provider -> {healthy, checkedAt})
const healthCache = new Map<ProviderId, { healthy: boolean; checkedAt: number }>();
const HEALTH_CACHE_TTL_MS = 60_000; // 60 seconds

/**
 * Check provider health with caching
 */
async function isHealthy(provider: Provider): Promise<boolean> {
  const cached = healthCache.get(provider.name as ProviderId);
  if (cached && Date.now() - cached.checkedAt < HEALTH_CACHE_TTL_MS) {
    return cached.healthy;
  }
  
  try {
    const healthy = await provider.healthCheck();
    healthCache.set(provider.name as ProviderId, { healthy, checkedAt: Date.now() });
    return healthy;
  } catch {
    healthCache.set(provider.name as ProviderId, { healthy: false, checkedAt: Date.now() });
    return false;
  }
}

/**
 * Estimate token count (rough: ~4 chars per token)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Determine task complexity based on heuristics
 */
export function assessComplexity(task: string): 'simple' | 'medium' | 'complex' {
  const tokens = estimateTokens(task);
  const hasCode = /```|function|class |import |export |def |async |await /.test(task);
  const hasReasoning = /explain|analyze|compare|evaluate|design|architect/i.test(task);
  const hasMultiStep = /step.by.step|first.*then|multiple|several/i.test(task);
  
  if (tokens > 2000 || (hasCode && hasReasoning) || hasMultiStep) {return 'complex';}
  if (tokens > 500 || hasCode || hasReasoning) {return 'medium';}
  return 'simple';
}

/**
 * Pre-built fallback plans
 */
export const FALLBACK_PLANS: Record<string, FallbackPlan> = {
  // Standard: try local first for simple tasks, then cloud
  standard: {
    name: 'standard',
    steps: [
      {
        provider: 'ollama',
        model: 'dolphin-llama3:8b',
        timeoutMs: 20_000,
        maxRetries: 0,
        retryOn: [],
        skipIf: (ctx) => ctx.estTokens > 1000 || ctx.requiresJson || ctx.complexity === 'complex',
      },
      {
        provider: 'claude',
        timeoutMs: 60_000,
        maxRetries: 2,
        retryOn: ['timeout', 'rate_limit'],
      },
      {
        provider: 'gemini',
        timeoutMs: 60_000,
        maxRetries: 1,
        retryOn: ['timeout', 'rate_limit'],
      },
      {
        provider: 'ollama',
        model: 'dolphin-llama3:70b',
        timeoutMs: 120_000,
        maxRetries: 0,
        retryOn: [],
        skipIf: (ctx) => ctx.requiresJson, // 70B is slow but capable
      },
    ],
  },
  
  // Strict: cloud providers only, with premium fallback
  strict: {
    name: 'strict',
    steps: [
      {
        provider: 'claude',
        timeoutMs: 90_000,
        maxRetries: 2,
        retryOn: ['timeout', 'rate_limit'],
      },
      {
        provider: 'gemini',
        timeoutMs: 90_000,
        maxRetries: 1,
        retryOn: ['timeout', 'rate_limit'],
      },
      {
        provider: 'codex',
        timeoutMs: 60_000,
        maxRetries: 1,
        retryOn: ['timeout'],
      },
    ],
  },
  
  // Fast: prioritize speed over quality
  fast: {
    name: 'fast',
    steps: [
      {
        provider: 'ollama',
        model: 'dolphin-llama3:8b',
        timeoutMs: 15_000,
        maxRetries: 0,
        retryOn: [],
      },
      {
        provider: 'gemini',
        timeoutMs: 30_000,
        maxRetries: 1,
        retryOn: ['timeout'],
      },
      {
        provider: 'claude',
        timeoutMs: 45_000,
        maxRetries: 0,
        retryOn: [],
      },
    ],
  },
  
  // Local only: Ollama models only (free)
  local: {
    name: 'local',
    steps: [
      {
        provider: 'ollama',
        model: 'dolphin-llama3:8b',
        timeoutMs: 30_000,
        maxRetries: 1,
        retryOn: ['timeout'],
      },
      {
        provider: 'ollama',
        model: 'dolphin-llama3:70b',
        timeoutMs: 180_000,
        maxRetries: 0,
        retryOn: [],
      },
    ],
  },
  
  // Coding: optimized for code generation tasks
  coding: {
    name: 'coding',
    steps: [
      {
        provider: 'ollama',
        model: 'qwen3-coder',  // 32B coding specialist
        timeoutMs: 120_000,
        maxRetries: 1,
        retryOn: ['timeout'],
        skipIf: (ctx) => ctx.estTokens > 8000, // 32K context limit
      },
      {
        provider: 'codex',
        timeoutMs: 60_000,
        maxRetries: 2,
        retryOn: ['timeout', 'rate_limit'],
      },
      {
        provider: 'claude',
        timeoutMs: 90_000,
        maxRetries: 1,
        retryOn: ['timeout', 'rate_limit'],
      },
      {
        provider: 'ollama',
        model: 'dolphin-llama3:70b',
        timeoutMs: 180_000,
        maxRetries: 0,
        retryOn: [],
      },
    ],
  },
};

/**
 * Should we retry this error?
 */
function shouldRetry(error: ProviderError | undefined, retryOn: string[]): boolean {
  if (!error) {return false;}
  
  // Map error types to retry categories
  const errorCategory = error.type === 'timeout' ? 'timeout'
    : error.type === 'rate_limit' ? 'rate_limit'
    : error.retryable ? 'transient'
    : null;
  
  return errorCategory !== null && retryOn.includes(errorCategory);
}

/**
 * Should we fallback on this error?
 */
function shouldFallback(error: ProviderError | undefined): boolean {
  if (!error) {return false;}
  
  // Always fallback on these
  if (['auth', 'misconfigured', 'quota'].includes(error.type)) {return true;}
  
  // Fallback if not retryable
  return !error.retryable;
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a request with the fallback plan
 * 
 * Features:
 *   - JSON validator + one-shot repair gate (if jsonMode)
 *   - Per-run telemetry (if telemetry.enabled)
 */
export async function runWithFallback(
  plan: FallbackPlan,
  prompt: string,
  options: FallbackOptions = {}
): Promise<FallbackResult> {
  const startTime = Date.now();
  const runId = makeRunId();
  const attempts: FallbackAttempt[] = [];
  
  // Telemetry record (built incrementally)
  const telemetryRecord: FallbackRunRecord = {
    id: runId,
    plan: plan.name,
    createdAt: Date.now(),
    promptHash: hashPrompt(prompt),
    promptChars: prompt.length,
    jsonMode: !!options.json,
    attempts: [],
    totalMs: 0,
    validatorUsed: !!options.json,
  };
  
  const context: FallbackContext = {
    task: prompt,
    requiresJson: options.json ?? false,
    estTokens: estimateTokens(prompt),
    complexity: assessComplexity(prompt),
  };
  
  const validator = options.validator ?? defaultJsonValidator;
  
  console.log(`[fallback] Plan: ${plan.name}, complexity: ${context.complexity}, tokens: ~${context.estTokens}${options.json ? ', jsonMode: true' : ''}`);
  
  for (const step of plan.steps) {
    // Check skip condition
    if (step.skipIf && step.skipIf(context)) {
      const attemptRec: FallbackAttempt = {
        provider: step.provider,
        model: step.model,
        durationMs: 0,
        success: false,
        skipped: true,
        skipReason: 'skipIf condition met',
      };
      attempts.push(attemptRec);
      telemetryRecord.attempts.push({
        provider: step.provider,
        model: step.model,
        startedAt: Date.now(),
        durationMs: 0,
        outcome: 'skipped',
        errorClass: 'skip_condition',
        errorMessage: 'Skipped by policy',
      });
      console.log(`[fallback] Skipping ${step.provider}${step.model ? `:${step.model}` : ''} (condition)`);
      continue;
    }
    
    // Create provider
    const provider = createProvider(step.provider);
    
    // Health check (cached)
    const healthy = await isHealthy(provider);
    if (!healthy) {
      const attemptRec: FallbackAttempt = {
        provider: step.provider,
        model: step.model,
        durationMs: 0,
        success: false,
        skipped: true,
        skipReason: 'health check failed',
      };
      attempts.push(attemptRec);
      telemetryRecord.attempts.push({
        provider: step.provider,
        model: step.model,
        startedAt: Date.now(),
        durationMs: 0,
        outcome: 'skipped',
        errorClass: 'unhealthy',
        errorMessage: 'Health check failed',
      });
      console.log(`[fallback] Skipping ${step.provider} (unhealthy)`);
      continue;
    }
    
    // Execute with retries
    let retryCount = 0;
    while (true) {
      const attemptStart = Date.now();
      console.log(`[fallback] Trying ${step.provider}${step.model ? `:${step.model}` : ''} (attempt ${retryCount + 1})`);
      
      const result = await provider.execute(prompt, {
        timeout: step.timeoutMs,
        json: options.json,
        env: step.model ? { OLLAMA_MODEL: step.model } : undefined,
      });
      
      const attemptDuration = Date.now() - attemptStart;
      
      if (result.code === 0 && result.stdout.trim()) {
        let responseText = result.stdout.trim();
        let parsedJson: unknown = undefined;
        let repairAttempted = false;
        
        // ============== JSON VALIDATOR + REPAIR GATE ==============
        if (options.json) {
          let vr = validator(responseText);
          
          if (!vr.ok) {
            // One repair attempt on SAME provider
            repairAttempted = true;
            console.log(`[fallback] JSON invalid, attempting repair on ${step.provider}`);
            
            const repairPrompt = buildJsonRepairPrompt(responseText, options.schemaHint);
            const repairResult = await provider.execute(repairPrompt, {
              timeout: step.timeoutMs,
              json: false, // Don't recurse
              env: step.model ? { OLLAMA_MODEL: step.model } : undefined,
            });
            
            if (repairResult.code === 0 && repairResult.stdout.trim()) {
              responseText = repairResult.stdout.trim();
              vr = validator(responseText);
            }
          }
          
          if (!vr.ok) {
            // Validator still failed after repair - treat as failure, fallback
            const validationError = (vr as { ok: false; error: string }).error;
            console.log(`[fallback] JSON validation failed after repair: ${validationError}`);
            
            attempts.push({
              provider: step.provider,
              model: step.model,
              durationMs: attemptDuration,
              success: false,
              error: { type: 'unknown', message: `validator_failed: ${validationError}`, retryable: false },
            });
            telemetryRecord.attempts.push({
              provider: step.provider,
              model: step.model,
              startedAt: attemptStart,
              durationMs: attemptDuration,
              outcome: 'failed',
              errorClass: 'validator_failed',
              errorMessage: validationError.slice(0, 500),
              repairAttempted: true,
            });
            
            // Immediate fallback (no retry for validator failures)
            break;
          }
          
          // vr.ok is true here, safe to access value
          parsedJson = vr.value;
          if (repairAttempted) {
            console.log(`[fallback] JSON repaired successfully`);
          }
        }
        // ============== END VALIDATOR GATE ==============
        
        // Success!
        attempts.push({
          provider: step.provider,
          model: step.model,
          durationMs: attemptDuration,
          success: true,
        });
        
        const estTokensInput = estimateTokens(prompt);
        const estTokensOutput = estimateTokens(responseText);
        const estCostUsd = estimateCost(step.provider, step.model, estTokensInput, estTokensOutput);
        
        telemetryRecord.attempts.push({
          provider: step.provider,
          model: step.model,
          startedAt: attemptStart,
          durationMs: attemptDuration,
          outcome: 'success',  // Clean enum: always 'success' for successful attempts
          estCostUsd,
          validated: !!options.json,
          repairAttempted,
          repaired: repairAttempted,  // If repair was attempted and we're here, it succeeded
        });
        telemetryRecord.winner = { provider: step.provider, model: step.model };
        telemetryRecord.totalMs = Date.now() - startTime;
        telemetryRecord.estCostUsd = telemetryRecord.attempts.reduce((sum, a) => sum + (a.estCostUsd ?? 0), 0);
        telemetryRecord.repairAttempted = repairAttempted;
        
        // Write telemetry (never blocks/throws)
        await writeRunRecord(telemetryRecord, options.telemetry);
        
        return {
          success: true,
          providerUsed: step.provider,
          modelUsed: step.model,
          response: responseText,
          attempts,
          totalDurationMs: Date.now() - startTime,
          runId,
          parsedJson,
        };
      }
      
      // Failed - record attempt
      attempts.push({
        provider: step.provider,
        model: step.model,
        durationMs: attemptDuration,
        success: false,
        error: result.error,
      });
      telemetryRecord.attempts.push({
        provider: step.provider,
        model: step.model,
        startedAt: attemptStart,
        durationMs: attemptDuration,
        outcome: 'failed',
        errorClass: result.error?.type ?? 'unknown',
        errorMessage: result.error?.message?.slice(0, 500),
      });
      
      // Should retry?
      if (shouldRetry(result.error, step.retryOn) && retryCount < step.maxRetries) {
        retryCount++;
        const backoff = Math.min(1000 * Math.pow(2, retryCount - 1), 10000);
        console.log(`[fallback] Retrying ${step.provider} in ${backoff}ms (${result.error?.type})`);
        await sleep(backoff);
        continue;
      }
      
      // Should fallback to next step?
      if (shouldFallback(result.error)) {
        console.log(`[fallback] Moving to next provider (${result.error?.type || 'failed'})`);
        break;
      }
      
      // Non-retryable, non-fallback error - continue to next step anyway
      break;
    }
  }
  
  // All steps exhausted
  telemetryRecord.totalMs = Date.now() - startTime;
  telemetryRecord.estCostUsd = telemetryRecord.attempts.reduce((sum, a) => sum + (a.estCostUsd ?? 0), 0);
  await writeRunRecord(telemetryRecord, options.telemetry);
  
  return {
    success: false,
    providerUsed: attempts[attempts.length - 1]?.provider || plan.steps[0].provider,
    response: '',
    attempts,
    totalDurationMs: Date.now() - startTime,
    runId,
  };
}

/**
 * Get a plan by name
 */
export function getPlan(name: string): FallbackPlan {
  return FALLBACK_PLANS[name] || FALLBACK_PLANS.standard;
}

/**
 * Clear health cache (useful for testing or after config changes)
 */
export function clearHealthCache(): void {
  healthCache.clear();
}
