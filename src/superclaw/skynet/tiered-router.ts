/**
 * 💰 SKYNET 3-Tier Model Routing
 * 
 * Intelligent routing to minimize cost while maintaining quality.
 * Based on Ruflo's 75% cost reduction pattern.
 * 
 * Tiers:
 * - Tier 1: Agent Booster (WASM) — <1ms, $0
 * - Tier 2: Fast models (Haiku/Flash) — ~500ms, $0.0002/call
 * - Tier 3: Smart models (Opus/Pro) — ~3s, $0.015/call
 * 
 * Routing Logic:
 * 1. Check if Agent Booster can handle it (simple transforms)
 * 2. Analyze complexity to choose between Tier 2 and Tier 3
 * 3. Fall back to higher tier on failure
 */

import { EventEmitter } from 'events';
import { AgentBooster, getAgentBooster, TransformIntent } from './agent-booster';

// --- Types ---

export type RoutingTier = 'booster' | 'fast' | 'smart';

export interface RoutingDecision {
  tier: RoutingTier;
  model: string;
  reason: string;
  estimatedCost: number;
  estimatedLatencyMs: number;
  confidence: number;
}

export interface ComplexitySignals {
  lineCount: number;
  hasAsync: boolean;
  hasClasses: boolean;
  hasGenerics: boolean;
  dependencyCount: number;
  cyclomaticComplexity: number;
  tokenEstimate: number;
}

export interface RoutingStats {
  totalRequests: number;
  byTier: Record<RoutingTier, number>;
  totalCost: number;
  savedCost: number;
  avgLatencyMs: number;
}

export interface TieredRouterConfig {
  /** Threshold for Tier 1 (booster) */
  boosterMaxComplexity: number;
  /** Threshold for Tier 2 (fast) */
  fastMaxComplexity: number;
  /** Default model for Tier 2 */
  fastModel: string;
  /** Default model for Tier 3 */
  smartModel: string;
  /** Cost per call (Tier 2) */
  fastCostPerCall: number;
  /** Cost per call (Tier 3) */
  smartCostPerCall: number;
}

// --- Default Config ---

const DEFAULT_CONFIG: TieredRouterConfig = {
  boosterMaxComplexity: 10,
  fastMaxComplexity: 50,
  fastModel: 'claude-3-5-haiku-latest',
  smartModel: 'claude-sonnet-4-20250514',
  fastCostPerCall: 0.0002,
  smartCostPerCall: 0.003,
};

// --- Complexity Keywords ---

const SIMPLE_KEYWORDS = [
  'format', 'rename', 'add comment', 'remove comment',
  'convert var', 'add type', 'fix typo', 'add log',
  'remove log', 'sort import', 'fix indent',
];

const COMPLEX_KEYWORDS = [
  'refactor', 'implement', 'create', 'build', 'design',
  'architect', 'optimize', 'secure', 'debug complex',
  'distributed', 'concurrent', 'async', 'performance',
];

// --- Tiered Router Service ---

export class TieredRouter extends EventEmitter {
  private config: TieredRouterConfig;
  private booster: AgentBooster;
  private stats: RoutingStats = {
    totalRequests: 0,
    byTier: { booster: 0, fast: 0, smart: 0 },
    totalCost: 0,
    savedCost: 0,
    avgLatencyMs: 0,
  };

  constructor(config: Partial<TieredRouterConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.booster = getAgentBooster();
  }

  /**
   * Route a request to the appropriate tier
   */
  route(request: string, code?: string): RoutingDecision {
    this.stats.totalRequests++;

    // Check Tier 1: Agent Booster
    const boostSignal = this.booster.detectBoostSignal(request, code);
    if (boostSignal.available && boostSignal.confidence > 0.8) {
      this.stats.byTier.booster++;
      this.stats.savedCost += this.config.smartCostPerCall;

      return {
        tier: 'booster',
        model: 'wasm-transform',
        reason: `Simple transform detected: ${boostSignal.intent}. Using Agent Booster (352x faster, $0).`,
        estimatedCost: 0,
        estimatedLatencyMs: 1,
        confidence: boostSignal.confidence,
      };
    }

    // Analyze complexity
    const signals = this.analyzeComplexity(request, code);
    const complexityScore = this.calculateComplexityScore(signals);

    // Check Tier 2: Fast models
    if (complexityScore <= this.config.fastMaxComplexity) {
      this.stats.byTier.fast++;
      this.stats.totalCost += this.config.fastCostPerCall;
      this.stats.savedCost += this.config.smartCostPerCall - this.config.fastCostPerCall;

      return {
        tier: 'fast',
        model: this.config.fastModel,
        reason: `Medium complexity (score: ${complexityScore}). Using fast model for cost efficiency.`,
        estimatedCost: this.config.fastCostPerCall,
        estimatedLatencyMs: 500,
        confidence: 0.85,
      };
    }

    // Tier 3: Smart models
    this.stats.byTier.smart++;
    this.stats.totalCost += this.config.smartCostPerCall;

    return {
      tier: 'smart',
      model: this.config.smartModel,
      reason: `High complexity (score: ${complexityScore}). Using smart model for best results.`,
      estimatedCost: this.config.smartCostPerCall,
      estimatedLatencyMs: 3000,
      confidence: 0.95,
    };
  }

  /**
   * Execute a request through the appropriate tier
   */
  async execute(request: string, code?: string): Promise<{
    decision: RoutingDecision;
    result: any;
    actualLatencyMs: number;
  }> {
    const decision = this.route(request, code);
    const start = performance.now();
    let result: any;

    switch (decision.tier) {
      case 'booster':
        // Execute via Agent Booster
        const boostSignal = this.booster.detectBoostSignal(request, code);
        if (boostSignal.intent && code) {
          result = this.booster.transform(boostSignal.intent, code);
        } else {
          result = { success: false, error: 'No boost intent detected' };
        }
        break;

      case 'fast':
      case 'smart':
        // Would call LLM here — for now, return placeholder
        result = {
          model: decision.model,
          message: `[Would call ${decision.model} with request]`,
          request,
        };
        break;
    }

    const actualLatencyMs = performance.now() - start;
    this.updateAvgLatency(actualLatencyMs);

    this.emit('routed', { decision, actualLatencyMs });

    return {
      decision,
      result,
      actualLatencyMs,
    };
  }

  /**
   * Get routing statistics
   */
  getStats(): RoutingStats & { costSavingsPercent: number } {
    const totalPotentialCost = this.stats.totalRequests * this.config.smartCostPerCall;
    const costSavingsPercent = totalPotentialCost > 0
      ? (this.stats.savedCost / totalPotentialCost) * 100
      : 0;

    return {
      ...this.stats,
      costSavingsPercent,
    };
  }

  /**
   * Get model recommendation for a task (hook signal format)
   */
  getModelRecommendation(request: string): string {
    const decision = this.route(request);

    if (decision.tier === 'booster') {
      return `[AGENT_BOOSTER_AVAILABLE] Use Edit tool directly, 352x faster than LLM`;
    }

    return `[TASK_MODEL_RECOMMENDATION] Use model="${decision.model}" for ${decision.tier} tier`;
  }

  // --- Private Methods ---

  private analyzeComplexity(request: string, code?: string): ComplexitySignals {
    const lower = request.toLowerCase();

    return {
      lineCount: code ? code.split('\n').length : 0,
      hasAsync: code ? /async|await|Promise/.test(code) : false,
      hasClasses: code ? /class\s+\w+/.test(code) : false,
      hasGenerics: code ? /<\w+>/.test(code) : false,
      dependencyCount: code ? (code.match(/import|require/g) || []).length : 0,
      cyclomaticComplexity: this.estimateCyclomaticComplexity(code || ''),
      tokenEstimate: this.estimateTokens(request + (code || '')),
    };
  }

  private calculateComplexityScore(signals: ComplexitySignals): number {
    let score = 0;

    // Base score from line count
    score += Math.min(signals.lineCount / 10, 20);

    // Complexity indicators
    if (signals.hasAsync) {score += 10;}
    if (signals.hasClasses) {score += 15;}
    if (signals.hasGenerics) {score += 10;}

    // Dependencies
    score += signals.dependencyCount * 3;

    // Cyclomatic complexity
    score += signals.cyclomaticComplexity * 2;

    // Token estimate
    score += signals.tokenEstimate / 100;

    return Math.round(score);
  }

  private estimateCyclomaticComplexity(code: string): number {
    // Count decision points
    const patterns = [
      /\bif\b/g,
      /\belse\b/g,
      /\bfor\b/g,
      /\bwhile\b/g,
      /\bcase\b/g,
      /\bcatch\b/g,
      /\?\s*:/g,  // Ternary
      /&&/g,
      /\|\|/g,
    ];

    let complexity = 1;  // Base complexity
    for (const pattern of patterns) {
      complexity += (code.match(pattern) || []).length;
    }

    return complexity;
  }

  private estimateTokens(text: string): number {
    // Rough estimate: ~4 chars per token
    return Math.ceil(text.length / 4);
  }

  private updateAvgLatency(latencyMs: number): void {
    const n = this.stats.totalRequests;
    this.stats.avgLatencyMs =
      (this.stats.avgLatencyMs * (n - 1) + latencyMs) / n;
  }
}

// --- Factory ---

let instance: TieredRouter | null = null;

export function getTieredRouter(config?: Partial<TieredRouterConfig>): TieredRouter {
  if (!instance) {
    instance = new TieredRouter(config);
  }
  return instance;
}

export default TieredRouter;
