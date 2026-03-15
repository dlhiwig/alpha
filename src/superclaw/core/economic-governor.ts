/**
 * SuperClaw Economic Governor
 * 
 * Inspired by @claude-flow/guidance EconomicGovernor
 * Enforces hard budget caps that cannot be bypassed
 * 
 * Tracks:
 * - Token usage (input + output)
 * - Tool calls
 * - Wall clock time
 * - Dollar cost
 * - Storage usage
 */

// --- Types ---

export interface BudgetConfig {
  /** Maximum total tokens (input + output) */
  maxTokens: number;
  
  /** Maximum tool invocations */
  maxToolCalls: number;
  
  /** Maximum wall clock time (ms) */
  maxTimeMs: number;
  
  /** Maximum dollar cost */
  maxCostUsd: number;
  
  /** Maximum storage/memory (bytes) */
  maxStorageBytes: number;
  
  /** Warning thresholds (0-1, e.g., 0.8 = warn at 80%) */
  warningThresholds: {
    tokens: number;
    toolCalls: number;
    time: number;
    cost: number;
    storage: number;
  };
}

export interface BudgetState {
  tokensUsed: number;
  toolCallsUsed: number;
  elapsedMs: number;
  costUsd: number;
  storageBytes: number;
  startedAt: Date;
}

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  budgetType?: 'tokens' | 'toolCalls' | 'time' | 'cost' | 'storage';
  warnings: BudgetWarning[];
  remaining: {
    tokens: number;
    toolCalls: number;
    timeMs: number;
    costUsd: number;
    storageBytes: number;
  };
  percentUsed: {
    tokens: number;
    toolCalls: number;
    time: number;
    cost: number;
    storage: number;
  };
}

export interface BudgetWarning {
  budgetType: 'tokens' | 'toolCalls' | 'time' | 'cost' | 'storage';
  message: string;
  percentUsed: number;
}

// --- Default Config ---

const DEFAULT_CONFIG: BudgetConfig = {
  maxTokens: 1_000_000,        // 1M tokens
  maxToolCalls: 500,           // 500 tool calls
  maxTimeMs: 30 * 60 * 1000,   // 30 minutes
  maxCostUsd: 10.00,           // $10
  maxStorageBytes: 100 * 1024 * 1024, // 100 MB
  warningThresholds: {
    tokens: 0.8,
    toolCalls: 0.8,
    time: 0.8,
    cost: 0.8,
    storage: 0.8,
  },
};

// --- EconomicGovernor Class ---

export class EconomicGovernor {
  private config: BudgetConfig;
  private state: BudgetState;
  private history: BudgetCheckResult[] = [];

  constructor(config?: Partial<BudgetConfig>) {
    this.config = { 
      ...DEFAULT_CONFIG, 
      ...config,
      warningThresholds: {
        ...DEFAULT_CONFIG.warningThresholds,
        ...config?.warningThresholds,
      },
    };
    this.state = {
      tokensUsed: 0,
      toolCallsUsed: 0,
      elapsedMs: 0,
      costUsd: 0,
      storageBytes: 0,
      startedAt: new Date(),
    };
  }

  // --- Usage Recording ---

  recordTokens(count: number): void {
    this.state.tokensUsed += count;
  }

  recordToolCall(): void {
    this.state.toolCallsUsed++;
  }

  recordCost(amount: number): void {
    this.state.costUsd += amount;
  }

  recordStorage(bytes: number): void {
    this.state.storageBytes += bytes;
  }

  updateElapsed(): void {
    this.state.elapsedMs = Date.now() - this.state.startedAt.getTime();
  }

  // --- Budget Checking ---

  check(): BudgetCheckResult {
    this.updateElapsed();

    const remaining = {
      tokens: this.config.maxTokens - this.state.tokensUsed,
      toolCalls: this.config.maxToolCalls - this.state.toolCallsUsed,
      timeMs: this.config.maxTimeMs - this.state.elapsedMs,
      costUsd: this.config.maxCostUsd - this.state.costUsd,
      storageBytes: this.config.maxStorageBytes - this.state.storageBytes,
    };

    const percentUsed = {
      tokens: this.state.tokensUsed / this.config.maxTokens,
      toolCalls: this.state.toolCallsUsed / this.config.maxToolCalls,
      time: this.state.elapsedMs / this.config.maxTimeMs,
      cost: this.state.costUsd / this.config.maxCostUsd,
      storage: this.state.storageBytes / this.config.maxStorageBytes,
    };

    // Check for exceeded budgets
    if (remaining.tokens <= 0) {
      return this.buildResult(false, 'Token budget exhausted', 'tokens', remaining, percentUsed);
    }
    if (remaining.toolCalls <= 0) {
      return this.buildResult(false, 'Tool call budget exhausted', 'toolCalls', remaining, percentUsed);
    }
    if (remaining.timeMs <= 0) {
      return this.buildResult(false, 'Time budget exhausted', 'time', remaining, percentUsed);
    }
    if (remaining.costUsd <= 0) {
      return this.buildResult(false, 'Cost budget exhausted', 'cost', remaining, percentUsed);
    }
    if (remaining.storageBytes <= 0) {
      return this.buildResult(false, 'Storage budget exhausted', 'storage', remaining, percentUsed);
    }

    // Collect warnings
    const warnings: BudgetWarning[] = [];
    
    if (percentUsed.tokens >= this.config.warningThresholds.tokens) {
      warnings.push({
        budgetType: 'tokens',
        message: `Token usage at ${(percentUsed.tokens * 100).toFixed(1)}%`,
        percentUsed: percentUsed.tokens,
      });
    }
    if (percentUsed.toolCalls >= this.config.warningThresholds.toolCalls) {
      warnings.push({
        budgetType: 'toolCalls',
        message: `Tool calls at ${(percentUsed.toolCalls * 100).toFixed(1)}%`,
        percentUsed: percentUsed.toolCalls,
      });
    }
    if (percentUsed.time >= this.config.warningThresholds.time) {
      warnings.push({
        budgetType: 'time',
        message: `Time at ${(percentUsed.time * 100).toFixed(1)}%`,
        percentUsed: percentUsed.time,
      });
    }
    if (percentUsed.cost >= this.config.warningThresholds.cost) {
      warnings.push({
        budgetType: 'cost',
        message: `Cost at ${(percentUsed.cost * 100).toFixed(1)}% ($${this.state.costUsd.toFixed(2)})`,
        percentUsed: percentUsed.cost,
      });
    }
    if (percentUsed.storage >= this.config.warningThresholds.storage) {
      warnings.push({
        budgetType: 'storage',
        message: `Storage at ${(percentUsed.storage * 100).toFixed(1)}%`,
        percentUsed: percentUsed.storage,
      });
    }

    return this.buildResult(true, undefined, undefined, remaining, percentUsed, warnings);
  }

  // --- Predictive Checking ---

  /**
   * Check if a proposed action would exceed budget
   */
  checkAction(proposed: {
    tokens?: number;
    toolCalls?: number;
    cost?: number;
    storage?: number;
  }): BudgetCheckResult {
    const check = this.check();
    
    if (!check.allowed) return check;

    // Check if proposed action would exceed
    if (proposed.tokens && proposed.tokens > check.remaining.tokens) {
      return {
        ...check,
        allowed: false,
        reason: `Proposed tokens (${proposed.tokens}) would exceed remaining (${check.remaining.tokens})`,
        budgetType: 'tokens',
      };
    }
    if (proposed.toolCalls && proposed.toolCalls > check.remaining.toolCalls) {
      return {
        ...check,
        allowed: false,
        reason: `Proposed tool calls would exceed remaining (${check.remaining.toolCalls})`,
        budgetType: 'toolCalls',
      };
    }
    if (proposed.cost && proposed.cost > check.remaining.costUsd) {
      return {
        ...check,
        allowed: false,
        reason: `Proposed cost ($${proposed.cost.toFixed(2)}) would exceed remaining ($${check.remaining.costUsd.toFixed(2)})`,
        budgetType: 'cost',
      };
    }
    if (proposed.storage && proposed.storage > check.remaining.storageBytes) {
      return {
        ...check,
        allowed: false,
        reason: `Proposed storage would exceed remaining (${check.remaining.storageBytes} bytes)`,
        budgetType: 'storage',
      };
    }

    return check;
  }

  // --- State Access ---

  getState(): Readonly<BudgetState> {
    this.updateElapsed();
    return { ...this.state };
  }

  getConfig(): Readonly<BudgetConfig> {
    return { ...this.config };
  }

  getHistory(): readonly BudgetCheckResult[] {
    return [...this.history];
  }

  // --- Reset ---

  reset(): void {
    this.state = {
      tokensUsed: 0,
      toolCallsUsed: 0,
      elapsedMs: 0,
      costUsd: 0,
      storageBytes: 0,
      startedAt: new Date(),
    };
    this.history = [];
  }

  // --- Snapshot/Restore ---

  snapshot(): string {
    return JSON.stringify({
      config: this.config,
      state: this.state,
    });
  }

  restore(snapshot: string): void {
    const data = JSON.parse(snapshot);
    this.config = data.config;
    this.state = {
      ...data.state,
      startedAt: new Date(data.state.startedAt),
    };
  }

  // --- Private ---

  private buildResult(
    allowed: boolean,
    reason: string | undefined,
    budgetType: BudgetCheckResult['budgetType'],
    remaining: BudgetCheckResult['remaining'],
    percentUsed: BudgetCheckResult['percentUsed'],
    warnings: BudgetWarning[] = []
  ): BudgetCheckResult {
    const result: BudgetCheckResult = {
      allowed,
      reason,
      budgetType,
      warnings,
      remaining,
      percentUsed,
    };
    
    this.history.push(result);
    return result;
  }
}

// --- Factory ---

export function createEconomicGovernor(config?: Partial<BudgetConfig>): EconomicGovernor {
  return new EconomicGovernor(config);
}

// --- Presets ---

export const BUDGET_PRESETS = {
  /** Conservative: Low limits, frequent warnings */
  conservative: {
    maxTokens: 100_000,
    maxToolCalls: 50,
    maxTimeMs: 5 * 60 * 1000, // 5 minutes
    maxCostUsd: 1.00,
    warningThresholds: { tokens: 0.5, toolCalls: 0.5, time: 0.5, cost: 0.5, storage: 0.5 },
  },
  
  /** Standard: Balanced limits */
  standard: DEFAULT_CONFIG,
  
  /** Generous: High limits for complex tasks */
  generous: {
    maxTokens: 5_000_000,
    maxToolCalls: 2000,
    maxTimeMs: 2 * 60 * 60 * 1000, // 2 hours
    maxCostUsd: 50.00,
    warningThresholds: { tokens: 0.9, toolCalls: 0.9, time: 0.9, cost: 0.9, storage: 0.9 },
  },
  
  /** Development: Very high limits for testing */
  development: {
    maxTokens: 10_000_000,
    maxToolCalls: 10000,
    maxTimeMs: 24 * 60 * 60 * 1000, // 24 hours
    maxCostUsd: 100.00,
    warningThresholds: { tokens: 0.95, toolCalls: 0.95, time: 0.95, cost: 0.95, storage: 0.95 },
  },
} as const;
