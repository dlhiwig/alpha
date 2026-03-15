/**
 * 3-Tier Model Router for SuperClaw
 * 
 * Intelligent routing that sends tasks to the optimal model tier:
 * - Tier 1: Agent Booster (<1ms, $0) — Skip LLM entirely for simple transforms
 * - Tier 2: Haiku (~500ms, $0.0002) — Simple tasks, bug fixes
 * - Tier 3: Sonnet/Opus (2-5s, $0.003+) — Complex reasoning
 * 
 * Uses SONA for pattern-based routing optimization.
 * 
 * @see docs/RUVECTOR_ANALYSIS.md
 */

import { EventEmitter } from 'events';
import { SonaAdapter, getDefaultSonaAdapter } from './sona-adapter';
import { logger } from '../utils/logger';

export interface ModelRouterConfig {
  /** Enable SONA-based optimization (default: true) */
  enableSona?: boolean;
  /** Tier 1 model name (default: 'none') */
  tier1Model?: string;
  /** Tier 2 model name (default: 'claude-3-haiku-20240307') */
  tier2Model?: string;
  /** Tier 3 model name (default: 'claude-sonnet-4-20250514') */
  tier3Model?: string;
  /** Tier 3 thinking model (default: 'claude-opus-4-5-20251101') */
  tier3ThinkingModel?: string;
  /** Complexity threshold for Tier 2 vs Tier 3 (default: 0.4) */
  tier2Threshold?: number;
  /** Complexity threshold for Tier 3 thinking (default: 0.7) */
  tier3ThinkingThreshold?: number;
  /** Embedding dimension (default: 256) */
  embeddingDim?: number;
}

export interface Task {
  /** Unique task identifier */
  id: string;
  /** Task intent/description */
  intent: string;
  /** Task embedding (if pre-computed) */
  embedding?: number[];
  /** Task complexity hint (0-1, optional) */
  complexityHint?: number;
  /** Force specific tier (bypasses routing) */
  forceTier?: 1 | 2 | 3;
  /** Task context for pattern matching */
  context?: Record<string, unknown>;
}

export interface ModelSelection {
  /** Selected tier (1, 2, or 3) */
  tier: number;
  /** Model identifier */
  model: string;
  /** Handler type */
  handler: 'direct_edit' | 'fast_agent' | 'thinking_agent';
  /** Confidence in routing decision (0-1) */
  confidence: number;
  /** Estimated cost in USD */
  estimatedCost: number;
  /** Estimated latency in ms */
  estimatedLatencyMs: number;
  /** Routing reason */
  reason: string;
}

export interface RoutingStats {
  totalRouted: number;
  tier1Count: number;
  tier2Count: number;
  tier3Count: number;
  tier1Percentage: number;
  tier2Percentage: number;
  tier3Percentage: number;
  estimatedSavings: number;
  avgConfidence: number;
}

/**
 * Boostable patterns that can be handled without LLM
 * These are deterministic transforms that don't need reasoning
 */
const BOOSTABLE_PATTERNS = [
  // Code transforms
  'var-to-const',
  'add-types',
  'remove-console',
  'add-error-handling',
  'async-await',
  'add-logging',
  'format-code',
  'remove-unused',
  'add-imports',
  'fix-indentation',
  
  // Simple queries
  'get-time',
  'get-date',
  'simple-math',
  'unit-convert',
  'format-text',
  'capitalize',
  'lowercase',
  'trim',
  
  // Data transforms
  'json-to-yaml',
  'yaml-to-json',
  'csv-parse',
  'escape-string',
  'unescape-string',
  'base64-encode',
  'base64-decode',
] as const;

/**
 * Keywords indicating complex reasoning needed (Tier 3)
 */
const COMPLEX_KEYWORDS = [
  'architect',
  'design',
  'analyze',
  'optimize',
  'refactor',
  'security',
  'performance',
  'scalab',
  'distributed',
  'algorithm',
  'complex',
  'debug',
  'investigate',
  'root cause',
  'strategy',
  'trade-off',
  'tradeoff',
  'decision',
  'compare',
  'evaluate',
  'review',
  'critique',
  'plan',
];

/**
 * Keywords indicating simple tasks (Tier 2)
 */
const SIMPLE_KEYWORDS = [
  'fix bug',
  'typo',
  'rename',
  'move',
  'copy',
  'delete',
  'add comment',
  'update',
  'change',
  'set',
  'get',
  'list',
  'show',
  'print',
  'log',
  'test',
];

/**
 * 3-Tier Model Router
 */
export class ModelRouter extends EventEmitter {
  private config: Required<ModelRouterConfig>;
  private sona: SonaAdapter | null = null;
  private stats: RoutingStats = {
    totalRouted: 0,
    tier1Count: 0,
    tier2Count: 0,
    tier3Count: 0,
    tier1Percentage: 0,
    tier2Percentage: 0,
    tier3Percentage: 0,
    estimatedSavings: 0,
    avgConfidence: 0,
  };
  private log = logger.child({ component: 'model-router' });

  constructor(config: ModelRouterConfig = {}) {
    super();
    
    this.config = {
      enableSona: config.enableSona ?? true,
      tier1Model: config.tier1Model ?? 'none',
      tier2Model: config.tier2Model ?? 'claude-3-haiku-20240307',
      tier3Model: config.tier3Model ?? 'claude-sonnet-4-20250514',
      tier3ThinkingModel: config.tier3ThinkingModel ?? 'claude-opus-4-5-20251101',
      tier2Threshold: config.tier2Threshold ?? 0.4,
      tier3ThinkingThreshold: config.tier3ThinkingThreshold ?? 0.7,
      embeddingDim: config.embeddingDim ?? 256,
    };

    if (this.config.enableSona) {
      try {
        this.sona = getDefaultSonaAdapter();
        this.log.info('SONA integration enabled for routing');
      } catch (err) {
        this.log.warn({ err }, 'Failed to initialize SONA, using keyword-only routing');
      }
    }

    this.log.info({ config: this.config }, 'Model router initialized');
  }

  /**
   * Route a task to the optimal model tier
   */
  route(task: Task): ModelSelection {
    const startTime = Date.now();

    // Force tier if specified
    if (task.forceTier) {
      const selection = this.selectTier(task.forceTier, 1.0, 'forced');
      this.recordRouting(selection);
      return selection;
    }

    // Tier 1: Check for boostable patterns
    if (this.isBoostable(task)) {
      const selection = this.selectTier(1, 0.95, 'boostable_pattern');
      this.recordRouting(selection);
      this.log.debug({ taskId: task.id, tier: 1 }, 'Task routed to Agent Booster');
      return selection;
    }

    // Get complexity estimate
    const complexity = this.estimateComplexity(task);

    // Use SONA if available and we have an embedding
    if (this.sona && task.embedding) {
      const recommendation = this.sona.getRoutingRecommendation(task.embedding);
      
      // Blend SONA recommendation with keyword analysis
      const blendedTier = this.blendRecommendations(
        recommendation.tier,
        recommendation.confidence,
        complexity
      );

      const selection = this.selectTier(
        blendedTier,
        recommendation.confidence,
        `sona_optimized (complexity: ${complexity.toFixed(2)})`
      );
      
      this.recordRouting(selection);
      this.log.debug({
        taskId: task.id,
        tier: blendedTier,
        complexity,
        sonaConfidence: recommendation.confidence,
      }, 'Task routed with SONA optimization');
      
      return selection;
    }

    // Fallback to keyword-based routing
    const tier = complexity < this.config.tier2Threshold ? 2 :
                 complexity < this.config.tier3ThinkingThreshold ? 3 : 3;
    
    const selection = this.selectTier(
      tier,
      0.7,
      `keyword_analysis (complexity: ${complexity.toFixed(2)})`
    );
    
    this.recordRouting(selection);
    this.log.debug({ taskId: task.id, tier, complexity }, 'Task routed via keyword analysis');
    
    return selection;
  }

  /**
   * Check if a task can be handled by Agent Booster (no LLM)
   */
  private isBoostable(task: Task): boolean {
    // Normalize intent: replace dashes with spaces, collapse whitespace
    const intent = task.intent.toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ');
    
    for (const pattern of BOOSTABLE_PATTERNS) {
      // Normalize pattern the same way
      const normalizedPattern = pattern.replace(/-/g, ' ');
      if (intent.includes(normalizedPattern)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Estimate task complexity from keywords
   */
  private estimateComplexity(task: Task): number {
    // Use hint if provided
    if (task.complexityHint !== undefined) {
      return task.complexityHint;
    }

    const intent = task.intent.toLowerCase();
    let complexity = 0.5; // Start at middle

    // Check for complex keywords (increase complexity)
    for (const keyword of COMPLEX_KEYWORDS) {
      if (intent.includes(keyword)) {
        complexity += 0.1;
      }
    }

    // Check for simple keywords (decrease complexity)
    for (const keyword of SIMPLE_KEYWORDS) {
      if (intent.includes(keyword)) {
        complexity -= 0.1;
      }
    }

    // Factor in intent length (longer = potentially more complex)
    if (intent.length > 200) complexity += 0.1;
    if (intent.length > 500) complexity += 0.1;
    if (intent.length < 50) complexity -= 0.1;

    // Clamp to [0, 1]
    return Math.max(0, Math.min(1, complexity));
  }

  /**
   * Blend SONA recommendation with keyword analysis
   */
  private blendRecommendations(
    sonaTier: number,
    sonaConfidence: number,
    keywordComplexity: number
  ): number {
    // High confidence SONA → trust it more
    if (sonaConfidence > 0.8) {
      return sonaTier;
    }

    // Convert keyword complexity to tier
    const keywordTier = keywordComplexity < 0.4 ? 2 :
                        keywordComplexity < 0.7 ? 3 : 3;

    // Weighted blend
    const blended = (sonaTier * sonaConfidence) + (keywordTier * (1 - sonaConfidence));
    return Math.round(blended);
  }

  /**
   * Create model selection for a tier
   */
  private selectTier(tier: number, confidence: number, reason: string): ModelSelection {
    switch (tier) {
      case 1:
        return {
          tier: 1,
          model: this.config.tier1Model,
          handler: 'direct_edit',
          confidence,
          estimatedCost: 0,
          estimatedLatencyMs: 1,
          reason,
        };
      
      case 2:
        return {
          tier: 2,
          model: this.config.tier2Model,
          handler: 'fast_agent',
          confidence,
          estimatedCost: 0.0002,
          estimatedLatencyMs: 500,
          reason,
        };
      
      case 3:
      default:
        const useThinking = reason.includes('complexity') && 
                           parseFloat(reason.match(/complexity: ([\d.]+)/)?.[1] ?? '0') > this.config.tier3ThinkingThreshold;
        return {
          tier: 3,
          model: useThinking ? this.config.tier3ThinkingModel : this.config.tier3Model,
          handler: 'thinking_agent',
          confidence,
          estimatedCost: useThinking ? 0.015 : 0.003,
          estimatedLatencyMs: useThinking ? 5000 : 2000,
          reason,
        };
    }
  }

  /**
   * Record routing decision and update stats
   */
  private recordRouting(selection: ModelSelection): void {
    this.stats.totalRouted++;
    
    switch (selection.tier) {
      case 1:
        this.stats.tier1Count++;
        // Savings vs using Tier 2
        this.stats.estimatedSavings += 0.0002;
        break;
      case 2:
        this.stats.tier2Count++;
        // Savings vs using Tier 3
        this.stats.estimatedSavings += 0.0028;
        break;
      case 3:
        this.stats.tier3Count++;
        break;
    }

    // Update percentages
    const total = this.stats.totalRouted;
    this.stats.tier1Percentage = (this.stats.tier1Count / total) * 100;
    this.stats.tier2Percentage = (this.stats.tier2Count / total) * 100;
    this.stats.tier3Percentage = (this.stats.tier3Count / total) * 100;

    // Running average of confidence
    this.stats.avgConfidence = (
      (this.stats.avgConfidence * (total - 1) + selection.confidence) / total
    );

    this.emit('routed', selection);
  }

  /**
   * Record outcome for SONA learning
   */
  recordOutcome(taskId: string, quality: number): void {
    if (this.sona) {
      this.sona.endTask(taskId, quality);
    }
  }

  /**
   * Begin tracking a task for SONA learning
   */
  beginTracking(task: Task): void {
    if (this.sona && task.embedding) {
      this.sona.beginTask(task.id, task.embedding);
    }
  }

  /**
   * Get routing statistics
   */
  getStats(): RoutingStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalRouted: 0,
      tier1Count: 0,
      tier2Count: 0,
      tier3Count: 0,
      tier1Percentage: 0,
      tier2Percentage: 0,
      tier3Percentage: 0,
      estimatedSavings: 0,
      avgConfidence: 0,
    };
  }

  /**
   * Get list of boostable patterns
   */
  getBoostablePatterns(): readonly string[] {
    return BOOSTABLE_PATTERNS;
  }
}

// Singleton instance
let defaultRouter: ModelRouter | null = null;

export function getDefaultModelRouter(): ModelRouter {
  if (!defaultRouter) {
    defaultRouter = new ModelRouter();
  }
  return defaultRouter;
}

export function initModelRouter(config?: ModelRouterConfig): ModelRouter {
  defaultRouter = new ModelRouter(config);
  return defaultRouter;
}
