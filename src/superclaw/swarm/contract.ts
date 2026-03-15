/**
 * Swarm Contract Layer
 * 
 * Defines explicit policies for timeouts, retries, quorum, and fallbacks.
 * This makes the swarm predictable and production-ready.
 */

import { AgentRole, ProviderName, AgentResult } from './types';

/**
 * Retry policy configuration
 */
export interface RetryPolicy {
  maxRetries: number;
  backoffMs: number;
  backoffMultiplier: number;
  retryableErrors: ('rate_limit' | 'timeout')[];
}

/**
 * Quorum rules for swarm completion
 */
export interface QuorumRules {
  minAgents: number;           // Minimum successful agents to proceed
  requiredRoles?: AgentRole[]; // Must-have roles (e.g., ['implementer', 'critic'])
  maxConfidenceWithoutQuorum: number; // Cap confidence if quorum not met
}

/**
 * Task-specific quorum presets
 */
export const TASK_QUORUM: Record<string, QuorumRules> = {
  coding: {
    minAgents: 2,
    requiredRoles: ['implementer', 'critic'],
    maxConfidenceWithoutQuorum: 0.4,
  },
  research: {
    minAgents: 2,
    requiredRoles: ['researcher', 'critic'],
    maxConfidenceWithoutQuorum: 0.5,
  },
  strategic: {
    minAgents: 3,
    requiredRoles: ['simplifier', 'critic', 'researcher'],
    maxConfidenceWithoutQuorum: 0.3,
  },
  review: {
    minAgents: 2,
    requiredRoles: ['critic'],
    maxConfidenceWithoutQuorum: 0.5,
  },
  general: {
    minAgents: 2,
    requiredRoles: undefined,
    maxConfidenceWithoutQuorum: 0.49,
  },
};

/**
 * Provider health states for circuit breaker
 */
export type ProviderState = 'healthy' | 'degraded' | 'misconfigured' | 'disabled';

/**
 * Circuit breaker configuration
 */
export interface CircuitBreaker {
  enabled: boolean;
  skipMisconfigured: boolean;  // Don't even attempt misconfigured providers
  skipDegraded: boolean;       // Skip providers that are rate-limited
  cooldownMs: number;          // How long to wait before retrying degraded
}

/**
 * Budget gates for cost/time control
 */
export interface BudgetGates {
  enabled: boolean;
  maxCallsPerHour: Record<string, number>;  // Per-provider limits
  maxTotalTimeMs: number;                   // Total time budget
  preferFreeProviders: boolean;             // Prefer local/free providers
}

/**
 * Phase types for phase-aware timeouts
 */
export type SwarmPhase = 'fanout' | 'critique' | 'implement' | 'revise' | 'judge' | 'default';

/**
 * Phase-aware timeout configuration
 */
export interface PhaseTimeouts {
  fanout: number;      // Simple parallel execution
  critique: number;    // Review/critique rounds
  implement: number;   // Code generation rounds
  revise: number;      // Revision/improvement rounds
  judge: number;       // Final arbitration
  default: number;     // Fallback
}

/**
 * Swarm contract configuration
 */
export interface SwarmContract {
  timeout: {
    perAgent: number;     // Per-agent timeout (ms) - default
    perRound: number;     // Total round timeout (ms)
    total: number;        // Total swarm timeout (ms)
    phaseAware?: PhaseTimeouts;  // Phase-specific timeouts
  };
  retry: RetryPolicy;
  quorum: QuorumRules;
  fallback: {
    enabled: boolean;
    maxFallbacks: number; // Max fallback attempts per role
  };
  json: {
    required: boolean;    // Require JSON output from agents
    validateSchema: boolean;
    repairAttempts: number;
  };
  circuitBreaker: CircuitBreaker;
  budget: BudgetGates;
  judge: {
    enabled: boolean;     // Run judge step after synthesis
    provider?: string;    // Preferred judge provider
  };
}

/**
 * Default contract for production use
 */
export const DEFAULT_CONTRACT: SwarmContract = {
  timeout: {
    perAgent: 45_000,    // 45s per agent
    perRound: 90_000,    // 90s per round
    total: 180_000,      // 3 minutes total
  },
  retry: {
    maxRetries: 2,
    backoffMs: 1000,
    backoffMultiplier: 2,
    retryableErrors: ['rate_limit', 'timeout'],
  },
  quorum: {
    minAgents: 2,
    requiredRoles: undefined,
    maxConfidenceWithoutQuorum: 0.49,
  },
  fallback: {
    enabled: true,
    maxFallbacks: 2,
  },
  json: {
    required: false,
    validateSchema: true,
    repairAttempts: 1,
  },
  circuitBreaker: {
    enabled: true,
    skipMisconfigured: true,
    skipDegraded: false,
    cooldownMs: 60_000,
  },
  budget: {
    enabled: false,
    maxCallsPerHour: { codex: 10, claude: 50, gemini: 100 },
    maxTotalTimeMs: 300_000,
    preferFreeProviders: true,
  },
  judge: {
    enabled: false,
    provider: 'claude',
  },
};

/**
 * Strict contract for critical tasks
 * Uses phase-aware timeouts for better reliability
 */
export const STRICT_CONTRACT: SwarmContract = {
  timeout: {
    perAgent: 60_000,      // Default fallback
    perRound: 150_000,     // 2.5 min per round (allows retries)
    total: 420_000,        // 7 min total
    phaseAware: {
      fanout: 60_000,      // 60s for simple parallel
      critique: 90_000,    // 90s for review
      implement: 120_000,  // 120s for code generation
      revise: 120_000,     // 120s for revisions
      judge: 90_000,       // 90s for judge
      default: 60_000,     // Fallback
    },
  },
  retry: {
    maxRetries: 3,
    backoffMs: 2000,
    backoffMultiplier: 2,
    retryableErrors: ['rate_limit', 'timeout'],
  },
  quorum: {
    minAgents: 3,
    requiredRoles: ['implementer', 'critic'],
    maxConfidenceWithoutQuorum: 0.3,
  },
  fallback: {
    enabled: true,
    maxFallbacks: 3,
  },
  json: {
    required: true,
    validateSchema: true,
    repairAttempts: 2,
  },
  circuitBreaker: {
    enabled: true,
    skipMisconfigured: true,
    skipDegraded: true,
    cooldownMs: 120_000,
  },
  budget: {
    enabled: true,
    maxCallsPerHour: { codex: 5, claude: 30, gemini: 50 },
    maxTotalTimeMs: 300_000,
    preferFreeProviders: false,
  },
  judge: {
    enabled: true,  // Always use judge for strict
    provider: 'claude',
  },
};

/**
 * Fast contract for quick iterations
 */
export const FAST_CONTRACT: SwarmContract = {
  timeout: {
    perAgent: 30_000,
    perRound: 45_000,
    total: 60_000,
  },
  retry: {
    maxRetries: 1,
    backoffMs: 500,
    backoffMultiplier: 1.5,
    retryableErrors: ['rate_limit'],
  },
  quorum: {
    minAgents: 1,
    requiredRoles: undefined,
    maxConfidenceWithoutQuorum: 0.6,
  },
  fallback: {
    enabled: false,
    maxFallbacks: 0,
  },
  json: {
    required: false,
    validateSchema: false,
    repairAttempts: 0,
  },
  circuitBreaker: {
    enabled: true,
    skipMisconfigured: true,
    skipDegraded: true,
    cooldownMs: 30_000,
  },
  budget: {
    enabled: true,
    maxCallsPerHour: { codex: 0, claude: 100, gemini: 200 },  // Skip codex in fast mode
    maxTotalTimeMs: 60_000,
    preferFreeProviders: true,
  },
  judge: {
    enabled: false,  // No judge for fast mode
  },
};

/**
 * Adapt quorum requirements to available providers
 * Prevents impossible quorum when providers are unavailable
 */
export function adaptQuorumToProviders(
  contract: SwarmContract,
  healthyProviderCount: number,
  availableRoles?: AgentRole[]
): SwarmContract {
  let needsAdaptation = false;
  let adaptedQuorum = { ...contract.quorum };
  
  // If minAgents exceeds available providers, cap it
  if (contract.quorum.minAgents > healthyProviderCount) {
    adaptedQuorum.minAgents = Math.max(1, Math.ceil(healthyProviderCount * 0.6)); // 60% of healthy, min 1
    console.log(`[swarm] Adapted quorum: ${contract.quorum.minAgents} → ${adaptedQuorum.minAgents} (${healthyProviderCount} healthy providers)`);
    needsAdaptation = true;
  }
  
  // If requiredRoles can't be satisfied by available providers, relax them
  if (contract.quorum.requiredRoles && availableRoles) {
    const missingRoles = contract.quorum.requiredRoles.filter(r => !availableRoles.includes(r));
    if (missingRoles.length > 0) {
      // Keep only the roles we actually have
      const satisfiableRoles = contract.quorum.requiredRoles.filter(r => availableRoles.includes(r));
      adaptedQuorum.requiredRoles = satisfiableRoles.length > 0 ? satisfiableRoles : undefined;
      console.log(`[swarm] Relaxed requiredRoles: missing ${missingRoles.join(', ')} → requiring ${satisfiableRoles.join(', ') || 'none'}`);
      needsAdaptation = true;
    }
  } else if (contract.quorum.requiredRoles && healthyProviderCount < contract.quorum.requiredRoles.length) {
    // Not enough providers to cover all required roles - drop requirement
    adaptedQuorum.requiredRoles = undefined;
    console.log(`[swarm] Dropped requiredRoles: ${healthyProviderCount} providers < ${contract.quorum.requiredRoles.length} required roles`);
    needsAdaptation = true;
  }
  
  if (needsAdaptation) {
    return {
      ...contract,
      quorum: adaptedQuorum,
    };
  }
  
  return contract;
}

/**
 * Check if quorum is met
 */
export function checkQuorum(
  results: AgentResult[],
  rules: QuorumRules
): { met: boolean; reason?: string } {
  const successful = results.filter((r) => r.exitCode === 0 && r.output);
  
  // Check minimum agents
  if (successful.length < rules.minAgents) {
    return {
      met: false,
      reason: `Only ${successful.length}/${rules.minAgents} required agents succeeded`,
    };
  }
  
  // Check required roles
  if (rules.requiredRoles) {
    const successfulRoles = new Set(successful.map((r) => r.role));
    for (const role of rules.requiredRoles) {
      if (!successfulRoles.has(role)) {
        return {
          met: false,
          reason: `Required role '${role}' not present in successful results`,
        };
      }
    }
  }
  
  return { met: true };
}

/**
 * Calculate backoff delay for retry
 */
export function calculateBackoff(
  attempt: number,
  policy: RetryPolicy
): number {
  return policy.backoffMs * Math.pow(policy.backoffMultiplier, attempt);
}

/**
 * Sleep helper
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get timeout for a specific phase
 */
export function getPhaseTimeout(
  contract: SwarmContract,
  phase: SwarmPhase
): number {
  if (contract.timeout.phaseAware) {
    return contract.timeout.phaseAware[phase] || contract.timeout.phaseAware.default;
  }
  return contract.timeout.perAgent;
}

/**
 * Infer phase from mode and round number
 */
export function inferPhase(
  mode: 'fanout' | 'fanout-critique' | 'hierarchical',
  roundIndex: number,
  totalRounds: number
): SwarmPhase {
  switch (mode) {
    case 'fanout':
      return 'fanout';
    case 'fanout-critique':
      return roundIndex === 0 ? 'fanout' : 'critique';
    case 'hierarchical':
      if (roundIndex === 0) {return 'implement';}
      if (roundIndex === totalRounds - 1) {return 'revise';}
      return 'critique';
    default:
      return 'default';
  }
}

/**
 * JSON output schema for agents
 */
export interface AgentJSONOutput {
  role: AgentRole;
  summary: string;
  recommendations?: string[];
  risks?: string[];
  code?: string;
  conflicts?: string[];
  confidence?: number;
}

/**
 * Validate agent JSON output
 */
export function validateAgentJSON(output: string): {
  valid: boolean;
  data?: AgentJSONOutput;
  error?: string;
} {
  try {
    // Try to extract JSON from output
    let jsonStr = output;
    
    // Handle markdown code blocks
    const codeBlockMatch = output.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }
    
    // Handle raw JSON
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }
    
    const data = JSON.parse(jsonStr) as AgentJSONOutput;
    
    // Validate required fields
    if (!data.role || !data.summary) {
      return {
        valid: false,
        error: 'Missing required fields: role and summary',
      };
    }
    
    return { valid: true, data };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : 'Invalid JSON',
    };
  }
}

/**
 * Attempt to repair malformed JSON
 */
export function repairJSON(output: string): string | null {
  try {
    // Common repairs:
    // 1. Add missing quotes
    // 2. Fix trailing commas
    // 3. Handle single quotes
    
    let repaired = output
      .replace(/'/g, '"')                           // Single to double quotes
      .replace(/,\s*([}\]])/g, '$1')                // Remove trailing commas
      .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3') // Quote unquoted keys
      .trim();
    
    // Try to parse
    JSON.parse(repaired);
    return repaired;
  } catch {
    return null;
  }
}

/**
 * Build JSON-requesting prompt wrapper
 */
export function wrapPromptForJSON(prompt: string, role: AgentRole): string {
  return `${prompt}

IMPORTANT: Respond ONLY with valid JSON in this exact format:
{
  "role": "${role}",
  "summary": "Your main conclusion in 1-2 sentences",
  "recommendations": ["Action item 1", "Action item 2"],
  "risks": ["Risk or concern 1", "Risk or concern 2"],
  "code": "// Optional: code snippet if relevant",
  "confidence": 0.8
}

Do not include any text before or after the JSON.`;
}

/**
 * Complexity keywords that indicate harder tasks
 */
const COMPLEXITY_KEYWORDS = [
  'implement', 'build', 'create', 'design', 'architect',
  'tests', 'test', 'testing', 'unit tests', 'integration tests',
  'auth', 'authentication', 'authorization', 'oauth', 'jwt',
  'middleware', 'api', 'rest', 'graphql', 'endpoint',
  'database', 'schema', 'migration', 'orm',
  'rbac', 'permissions', 'roles', 'access control',
  'multi-tenant', 'multitenancy', 'saas',
  'pipeline', 'ci/cd', 'deployment', 'docker', 'kubernetes',
  'iac', 'terraform', 'cloudformation', 'infrastructure',
  'microservice', 'distributed', 'event-driven',
  'security', 'encryption', 'hashing', 'secrets',
  'readme', 'documentation', 'docs',
];

/**
 * Artifact indicators (things being requested)
 */
const ARTIFACT_PATTERNS = [
  /\+\s*(tests?|readme|docs?|diagrams?|examples?)/gi,
  /with\s+(tests?|readme|documentation)/gi,
  /including?\s+(tests?|readme|documentation)/gi,
];

/**
 * Compute complexity score for a task
 * Returns 0-100 where higher = more complex
 */
export function computeComplexityScore(
  task: string,
  mode: 'fanout' | 'fanout-critique' | 'hierarchical' = 'fanout'
): { score: number; factors: string[] } {
  const factors: string[] = [];
  let score = 0;
  
  const taskLower = task.toLowerCase();
  
  // 1. Prompt length (0-20 points)
  const charScore = Math.min(20, Math.floor(task.length / 100));
  if (charScore > 10) {
    score += charScore;
    factors.push(`length: ${task.length} chars (+${charScore})`);
  }
  
  // 2. Complexity keywords (0-40 points, 5 per keyword, max 8)
  let keywordCount = 0;
  for (const keyword of COMPLEXITY_KEYWORDS) {
    if (taskLower.includes(keyword)) {
      keywordCount++;
      if (keywordCount <= 8) {
        score += 5;
      }
    }
  }
  if (keywordCount > 0) {
    factors.push(`keywords: ${keywordCount} found (+${Math.min(40, keywordCount * 5)})`);
  }
  
  // 3. Artifact requests (0-20 points)
  let artifactCount = 0;
  for (const pattern of ARTIFACT_PATTERNS) {
    const matches = task.match(pattern);
    if (matches) {
      artifactCount += matches.length;
    }
  }
  if (artifactCount > 0) {
    const artifactScore = Math.min(20, artifactCount * 7);
    score += artifactScore;
    factors.push(`artifacts: ${artifactCount} requested (+${artifactScore})`);
  }
  
  // 4. Mode modifier (0-20 points)
  if (mode === 'hierarchical') {
    score += 20;
    factors.push('mode: hierarchical (+20)');
  } else if (mode === 'fanout-critique') {
    score += 10;
    factors.push('mode: fanout-critique (+10)');
  }
  
  return { score: Math.min(100, score), factors };
}

/**
 * Auto-select contract based on task complexity
 */
export function selectContractByComplexity(
  task: string,
  mode: 'fanout' | 'fanout-critique' | 'hierarchical' = 'fanout'
): { contract: SwarmContract; contractName: string; complexity: { score: number; factors: string[] } } {
  const complexity = computeComplexityScore(task, mode);
  
  if (complexity.score < 30) {
    return { contract: FAST_CONTRACT, contractName: 'fast', complexity };
  } else if (complexity.score > 70) {
    return { contract: STRICT_CONTRACT, contractName: 'strict', complexity };
  } else {
    return { contract: DEFAULT_CONTRACT, contractName: 'default', complexity };
  }
}
