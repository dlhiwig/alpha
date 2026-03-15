/**
 * Hivemind Task Router
 * 
 * Intelligently routes tasks to the optimal agent(s) based on:
 * - Task complexity
 * - Required capabilities
 * - Cost optimization
 * - Availability
 */

import { CLIType } from './cli-agent';

export type RoutingStrategy = 
  | 'fastest'      // Route to fastest available agent
  | 'cheapest'     // Prefer local/free agents
  | 'best'         // Route to most capable agent for task type
  | 'consensus'    // Send to multiple agents, synthesize
  | 'pipeline';    // Chain agents in sequence

export interface TaskMetadata {
  type: 'code' | 'reason' | 'research' | 'review' | 'creative' | 'simple';
  complexity: 'low' | 'medium' | 'high' | 'extreme';
  requiresCode: boolean;
  requiresReasoning: boolean;
  requiresResearch: boolean;
  sensitive: boolean;
  maxLatencyMs?: number;
  maxCostUsd?: number;
}

export interface RoutingDecision {
  primary: CLIType;
  secondary?: CLIType[];
  strategy: RoutingStrategy;
  reason: string;
}

/**
 * Agent capabilities and characteristics
 */
const AGENT_PROFILES: Record<CLIType, {
  strengths: string[];
  weaknesses: string[];
  costTier: 'free' | 'low' | 'medium' | 'high';
  speedTier: 'fast' | 'medium' | 'slow';
  maxComplexity: 'low' | 'medium' | 'high' | 'extreme';
}> = {
  claude: {
    strengths: ['reasoning', 'planning', 'synthesis', 'long-context', 'nuance'],
    weaknesses: ['speed', 'cost'],
    costTier: 'high',
    speedTier: 'medium',
    maxComplexity: 'extreme'
  },
  codex: {
    strengths: ['code-generation', 'debugging', 'refactoring', 'testing'],
    weaknesses: ['reasoning', 'creativity'],
    costTier: 'medium',
    speedTier: 'medium',
    maxComplexity: 'high'
  },
  gemini: {
    strengths: ['research', 'analysis', 'multimodal', 'breadth'],
    weaknesses: ['depth', 'consistency'],
    costTier: 'medium',
    speedTier: 'fast',
    maxComplexity: 'high'
  },
  ollama: {
    strengths: ['speed', 'privacy', 'availability', 'uncensored'],
    weaknesses: ['complex-reasoning', 'long-context'],
    costTier: 'free',
    speedTier: 'fast',
    maxComplexity: 'medium'
  }
};

/**
 * Task type to preferred agent mapping
 */
const TASK_AGENT_AFFINITY: Record<string, CLIType[]> = {
  code: ['codex', 'claude', 'ollama'],
  reason: ['claude', 'gemini', 'ollama'],
  research: ['gemini', 'claude', 'ollama'],
  review: ['claude', 'codex', 'gemini'],
  creative: ['claude', 'gemini', 'ollama'],
  simple: ['ollama', 'gemini', 'codex']
};

/**
 * Route a task to the optimal agent(s)
 */
export function routeTask(
  metadata: TaskMetadata,
  availableAgents: CLIType[],
  preferredStrategy?: RoutingStrategy
): RoutingDecision {
  // If only one agent available, use it
  if (availableAgents.length === 1) {
    return {
      primary: availableAgents[0],
      strategy: 'fastest',
      reason: 'Only one agent available'
    };
  }

  // Determine strategy based on task characteristics
  let strategy = preferredStrategy || determineStrategy(metadata);

  // Get ranked agents for this task type
  const rankedAgents = rankAgentsForTask(metadata, availableAgents);

  if (rankedAgents.length === 0) {
    throw new Error('No suitable agents available for this task');
  }

  // Build decision based on strategy
  switch (strategy) {
    case 'fastest':
      return {
        primary: getFastestAgent(rankedAgents),
        strategy,
        reason: `Optimizing for speed (latency: ${metadata.maxLatencyMs || 'unlimited'}ms)`
      };

    case 'cheapest':
      return {
        primary: getCheapestAgent(rankedAgents),
        strategy,
        reason: 'Optimizing for cost'
      };

    case 'best':
      return {
        primary: rankedAgents[0],
        strategy,
        reason: `Best agent for ${metadata.type} task: ${rankedAgents[0]}`
      };

    case 'consensus':
      return {
        primary: rankedAgents[0],
        secondary: rankedAgents.slice(1, 3), // Top 3 agents
        strategy,
        reason: `Consensus mode: ${rankedAgents.slice(0, 3).join(', ')}`
      };

    case 'pipeline':
      return buildPipelineDecision(metadata, rankedAgents);

    default:
      return {
        primary: rankedAgents[0],
        strategy: 'best',
        reason: 'Default routing'
      };
  }
}

/**
 * Determine optimal strategy based on task characteristics
 */
function determineStrategy(metadata: TaskMetadata): RoutingStrategy {
  // Critical/sensitive tasks need consensus
  if (metadata.sensitive || metadata.complexity === 'extreme') {
    return 'consensus';
  }

  // Complex tasks with multiple requirements benefit from pipeline
  if (metadata.requiresCode && metadata.requiresReasoning && metadata.requiresResearch) {
    return 'pipeline';
  }

  // Time-constrained tasks need speed
  if (metadata.maxLatencyMs && metadata.maxLatencyMs < 10000) {
    return 'fastest';
  }

  // Cost-constrained tasks
  if (metadata.maxCostUsd && metadata.maxCostUsd < 0.01) {
    return 'cheapest';
  }

  // Simple tasks don't need expensive agents
  if (metadata.complexity === 'low') {
    return 'cheapest';
  }

  // Default to best
  return 'best';
}

/**
 * Rank agents by suitability for a task
 */
function rankAgentsForTask(
  metadata: TaskMetadata,
  availableAgents: CLIType[]
): CLIType[] {
  const affinity = TASK_AGENT_AFFINITY[metadata.type] || ['claude', 'codex', 'gemini', 'ollama'];
  
  // Filter by complexity capability
  const capableAgents = availableAgents.filter(agent => {
    const profile = AGENT_PROFILES[agent];
    const complexityOrder = ['low', 'medium', 'high', 'extreme'];
    return complexityOrder.indexOf(profile.maxComplexity) >= complexityOrder.indexOf(metadata.complexity);
  });

  // Sort by affinity order (best first)
  return capableAgents.sort((a, b) => {
    const aIndex = affinity.indexOf(a);
    const bIndex = affinity.indexOf(b);
    // -1 means not in affinity list, put at end
    const aScore = aIndex === -1 ? 100 : aIndex;
    const bScore = bIndex === -1 ? 100 : bIndex;
    return aScore - bScore;
  });
}

/**
 * Get the fastest agent from a list
 */
function getFastestAgent(agents: CLIType[]): CLIType {
  const speedOrder: CLIType[] = ['ollama', 'gemini', 'codex', 'claude'];
  for (const fast of speedOrder) {
    if (agents.includes(fast)) return fast;
  }
  return agents[0];
}

/**
 * Get the cheapest agent from a list
 */
function getCheapestAgent(agents: CLIType[]): CLIType {
  const costOrder: CLIType[] = ['ollama', 'gemini', 'codex', 'claude'];
  for (const cheap of costOrder) {
    if (agents.includes(cheap)) return cheap;
  }
  return agents[0];
}

/**
 * Build a pipeline decision for complex multi-step tasks
 */
function buildPipelineDecision(
  metadata: TaskMetadata,
  rankedAgents: CLIType[]
): RoutingDecision {
  // Pipeline: Research → Plan → Implement → Review
  const pipeline: CLIType[] = [];

  // Research phase: Gemini or Claude
  if (metadata.requiresResearch) {
    if (rankedAgents.includes('gemini')) pipeline.push('gemini');
    else if (rankedAgents.includes('claude')) pipeline.push('claude');
  }

  // Planning phase: Claude (best at reasoning)
  if (metadata.requiresReasoning && rankedAgents.includes('claude')) {
    if (!pipeline.includes('claude')) pipeline.push('claude');
  }

  // Implementation phase: Codex for code
  if (metadata.requiresCode && rankedAgents.includes('codex')) {
    pipeline.push('codex');
  }

  // If pipeline is empty, just use the top ranked agent
  if (pipeline.length === 0) {
    return {
      primary: rankedAgents[0],
      strategy: 'pipeline',
      reason: 'Fallback to primary agent'
    };
  }

  return {
    primary: pipeline[0],
    secondary: pipeline.slice(1),
    strategy: 'pipeline',
    reason: `Pipeline: ${pipeline.join(' → ')}`
  };
}

/**
 * Analyze a prompt to determine task metadata
 */
export function analyzeTask(prompt: string): TaskMetadata {
  const lower = prompt.toLowerCase();

  // Detect task type
  let type: TaskMetadata['type'] = 'simple';
  if (/\b(code|function|implement|write.*(?:class|function|method)|debug|refactor)\b/.test(lower)) {
    type = 'code';
  } else if (/\b(analyze|think|reason|explain|why|how.*work)\b/.test(lower)) {
    type = 'reason';
  } else if (/\b(research|find|search|compare|alternatives|options)\b/.test(lower)) {
    type = 'research';
  } else if (/\b(review|check|validate|verify|audit)\b/.test(lower)) {
    type = 'review';
  } else if (/\b(create|generate|write.*(?:story|poem|content)|creative)\b/.test(lower)) {
    type = 'creative';
  }

  // Detect complexity
  let complexity: TaskMetadata['complexity'] = 'low';
  const wordCount = prompt.split(/\s+/).length;
  if (wordCount > 500 || /\b(complex|comprehensive|detailed|thorough|extensive)\b/.test(lower)) {
    complexity = 'extreme';
  } else if (wordCount > 200 || /\b(multiple|several|various|different)\b/.test(lower)) {
    complexity = 'high';
  } else if (wordCount > 50) {
    complexity = 'medium';
  }

  // Detect requirements
  const requiresCode = /\b(code|function|class|implement|typescript|javascript|python)\b/.test(lower);
  const requiresReasoning = /\b(think|analyze|reason|explain|consider|evaluate)\b/.test(lower);
  const requiresResearch = /\b(research|find|compare|alternatives|options|best practices)\b/.test(lower);

  // Detect sensitivity
  const sensitive = /\b(sensitive|critical|important|production|security|password|key|secret)\b/.test(lower);

  return {
    type,
    complexity,
    requiresCode,
    requiresReasoning,
    requiresResearch,
    sensitive
  };
}

export default { routeTask, analyzeTask };
