/**
 * Token Usage Tracking for SuperClaw
 * 
 * Tracks token consumption across all tools and models to provide
 * usage analytics and cost optimization insights.
 */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  model: string;
  operation: string;
  timestamp: Date;
  cost?: number;
  error?: boolean;
  metadata?: Record<string, any>;
}

export interface TokenTrackingResult {
  tracked: boolean;
  usage: TokenUsage;
  totalUsage?: {
    dailyTokens: number;
    monthlyCost: number;
    operationCount: number;
  };
}

// In-memory storage for token usage (could be extended to use a database)
const tokenUsageLog: TokenUsage[] = [];
const dailyUsageCache = new Map<string, number>(); // date -> tokens
const modelCostMap = new Map<string, number>(); // model -> cost per 1k tokens

// Initialize model costs (approximate)
modelCostMap.set('claude-sonnet', 0.003); // $3/1M input tokens
modelCostMap.set('claude-opus', 0.015);   // $15/1M input tokens
modelCostMap.set('gpt-4', 0.03);          // $30/1M input tokens
modelCostMap.set('gpt-3.5-turbo', 0.001); // $1/1M input tokens
modelCostMap.set('gemini-pro', 0.00075);  // $0.75/1M input tokens
modelCostMap.set('openbrowser-mcp', 0);   // Free - local execution

/**
 * Track token usage for a tool operation
 */
export async function trackTokenUsage(usage: TokenUsage): Promise<TokenTrackingResult> {
  try {
    // Calculate cost if model pricing is known
    const costPer1k = modelCostMap.get(usage.model);
    if (costPer1k !== undefined) {
      usage.cost = (usage.totalTokens / 1000) * costPer1k;
    }

    // Store usage
    tokenUsageLog.push(usage);

    // Update daily cache
    const dateKey = usage.timestamp.toISOString().split('T')[0];
    const currentDaily = dailyUsageCache.get(dateKey) || 0;
    dailyUsageCache.set(dateKey, currentDaily + usage.totalTokens);

    // Calculate total usage stats
    const totalUsage = calculateTotalUsage();

    // Cleanup old entries (keep last 10,000)
    if (tokenUsageLog.length > 10000) {
      tokenUsageLog.splice(0, tokenUsageLog.length - 10000);
    }

    return {
      tracked: true,
      usage,
      totalUsage,
    };

  } catch (error: unknown) {
    console.error('Failed to track token usage:', error);
    
    return {
      tracked: false,
      usage,
    };
  }
}

/**
 * Get token usage statistics
 */
export function getTokenUsageStats(): {
  totalOperations: number;
  totalTokens: number;
  totalCost: number;
  byModel: Record<string, { tokens: number; operations: number; cost: number }>;
  byOperation: Record<string, { tokens: number; operations: number; cost: number }>;
  dailyUsage: Record<string, number>;
  topOperations: Array<{ operation: string; tokens: number; operations: number }>;
  errorRate: number;
} {
  const stats = {
    totalOperations: tokenUsageLog.length,
    totalTokens: 0,
    totalCost: 0,
    byModel: {} as Record<string, { tokens: number; operations: number; cost: number }>,
    byOperation: {} as Record<string, { tokens: number; operations: number; cost: number }>,
    dailyUsage: {} as Record<string, number>,
    topOperations: [] as Array<{ operation: string; tokens: number; operations: number }>,
    errorRate: 0,
  };

  let errorCount = 0;

  // Process all usage entries
  for (const entry of tokenUsageLog) {
    stats.totalTokens += entry.totalTokens;
    stats.totalCost += entry.cost || 0;

    if (entry.error) {
      errorCount++;
    }

    // By model
    if (!stats.byModel[entry.model]) {
      stats.byModel[entry.model] = { tokens: 0, operations: 0, cost: 0 };
    }
    stats.byModel[entry.model].tokens += entry.totalTokens;
    stats.byModel[entry.model].operations += 1;
    stats.byModel[entry.model].cost += entry.cost || 0;

    // By operation
    if (!stats.byOperation[entry.operation]) {
      stats.byOperation[entry.operation] = { tokens: 0, operations: 0, cost: 0 };
    }
    stats.byOperation[entry.operation].tokens += entry.totalTokens;
    stats.byOperation[entry.operation].operations += 1;
    stats.byOperation[entry.operation].cost += entry.cost || 0;

    // Daily usage
    const dateKey = entry.timestamp.toISOString().split('T')[0];
    stats.dailyUsage[dateKey] = (stats.dailyUsage[dateKey] || 0) + entry.totalTokens;
  }

  // Calculate error rate
  stats.errorRate = stats.totalOperations > 0 ? errorCount / stats.totalOperations : 0;

  // Top operations by token usage
  stats.topOperations = Object.entries(stats.byOperation)
    .map(([operation, data]) => ({
      operation,
      tokens: data.tokens,
      operations: data.operations,
    }))
    .toSorted((a, b) => b.tokens - a.tokens)
    .slice(0, 10);

  return stats;
}

/**
 * Get usage for a specific time period
 */
export function getTokenUsageForPeriod(
  startDate: Date,
  endDate: Date
): {
  totalTokens: number;
  totalCost: number;
  operations: number;
  entries: TokenUsage[];
} {
  const entries = tokenUsageLog.filter(
    entry => entry.timestamp >= startDate && entry.timestamp <= endDate
  );

  const result = {
    totalTokens: 0,
    totalCost: 0,
    operations: entries.length,
    entries,
  };

  for (const entry of entries) {
    result.totalTokens += entry.totalTokens;
    result.totalCost += entry.cost || 0;
  }

  return result;
}

/**
 * Get recent token usage entries
 */
export function getRecentTokenUsage(limit = 100): TokenUsage[] {
  return tokenUsageLog
    .slice(-limit)
    .toSorted((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}

/**
 * Export token usage data as JSON
 */
export function exportTokenUsage(): {
  exportDate: string;
  totalEntries: number;
  usage: TokenUsage[];
  stats: ReturnType<typeof getTokenUsageStats>;
} {
  return {
    exportDate: new Date().toISOString(),
    totalEntries: tokenUsageLog.length,
    usage: [...tokenUsageLog],
    stats: getTokenUsageStats(),
  };
}

/**
 * Import token usage data from JSON
 */
export function importTokenUsage(data: {
  usage: TokenUsage[];
}): {
  imported: number;
  skipped: number;
} {
  let imported = 0;
  let skipped = 0;

  for (const entry of data.usage) {
    try {
      // Convert timestamp string back to Date if needed
      if (typeof entry.timestamp === 'string') {
        entry.timestamp = new Date(entry.timestamp);
      }

      tokenUsageLog.push(entry);
      imported++;
    } catch (error: unknown) {
      console.error('Failed to import token usage entry:', error);
      skipped++;
    }
  }

  return { imported, skipped };
}

/**
 * Clear all token usage data
 */
export function clearTokenUsage(): number {
  const cleared = tokenUsageLog.length;
  tokenUsageLog.splice(0, tokenUsageLog.length);
  dailyUsageCache.clear();
  return cleared;
}

/**
 * Set or update model cost per 1k tokens
 */
export function setModelCost(model: string, costPer1k: number): void {
  modelCostMap.set(model, costPer1k);
}

/**
 * Get estimated cost for a token count and model
 */
export function estimateCost(tokens: number, model: string): number {
  const costPer1k = modelCostMap.get(model);
  if (costPer1k === undefined) {
    return 0;
  }
  return (tokens / 1000) * costPer1k;
}

/**
 * Get token efficiency metrics for browser operations
 */
export function getBrowserTokenEfficiency(): {
  openBrowserAvgTokens: number;
  traditionalBrowserEstimate: number;
  efficiencyRatio: number;
  operationCount: number;
} {
  const browserEntries = tokenUsageLog.filter(
    entry => entry.operation === 'browser_execute'
  );

  if (browserEntries.length === 0) {
    return {
      openBrowserAvgTokens: 0,
      traditionalBrowserEstimate: 0,
      efficiencyRatio: 1,
      operationCount: 0,
    };
  }

  const avgTokens = browserEntries.reduce((sum, entry) => sum + entry.totalTokens, 0) / browserEntries.length;
  
  // Estimate traditional browser tool tokens (based on OpenBrowser documentation)
  // Traditional tools return full DOM data (~100-300KB per call)
  // Estimate: ~25k tokens per traditional browser operation
  const traditionalEstimate = 25000;
  
  const efficiencyRatio = traditionalEstimate / avgTokens;

  return {
    openBrowserAvgTokens: avgTokens,
    traditionalBrowserEstimate: traditionalEstimate,
    efficiencyRatio,
    operationCount: browserEntries.length,
  };
}

/**
 * Calculate total usage statistics
 */
function calculateTotalUsage(): {
  dailyTokens: number;
  monthlyCost: number;
  operationCount: number;
} {
  const today = new Date().toISOString().split('T')[0];
  const dailyTokens = dailyUsageCache.get(today) || 0;

  // Calculate monthly cost (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const monthlyUsage = getTokenUsageForPeriod(thirtyDaysAgo, new Date());

  return {
    dailyTokens,
    monthlyCost: monthlyUsage.totalCost,
    operationCount: tokenUsageLog.length,
  };
}

/**
 * Browser-specific token tracking helpers
 */
export const browserTokens = {
  /**
   * Track a browser operation with efficiency metrics
   */
  async track(
    inputTokens: number,
    outputTokens: number,
    operationType: 'navigation' | 'extraction' | 'interaction' | 'workflow',
    codeComplexity: 'simple' | 'medium' | 'complex'
  ): Promise<TokenTrackingResult> {
    const usage: TokenUsage = {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      model: 'openbrowser-mcp',
      operation: 'browser_execute',
      timestamp: new Date(),
      metadata: {
        operationType,
        codeComplexity,
        efficiency: 'extreme', // OpenBrowser's efficiency rating
      },
    };

    return trackTokenUsage(usage);
  },

  /**
   * Get browser operation efficiency report
   */
  getEfficiencyReport(): {
    totalOperations: number;
    avgTokensPerOperation: number;
    tokensSaved: number;
    costSaved: number;
    efficiencyMultiplier: number;
  } {
    const efficiency = getBrowserTokenEfficiency();
    const stats = getTokenUsageStats();
    const browserStats = stats.byOperation['browser_execute'] || { tokens: 0, operations: 0, cost: 0 };

    const tokensSaved = (efficiency.traditionalBrowserEstimate * browserStats.operations) - browserStats.tokens;
    const traditionalCost = estimateCost(efficiency.traditionalBrowserEstimate * browserStats.operations, 'claude-sonnet');
    const costSaved = traditionalCost - browserStats.cost;

    return {
      totalOperations: browserStats.operations,
      avgTokensPerOperation: browserStats.operations > 0 ? browserStats.tokens / browserStats.operations : 0,
      tokensSaved: Math.max(0, tokensSaved),
      costSaved: Math.max(0, costSaved),
      efficiencyMultiplier: efficiency.efficiencyRatio,
    };
  },
};

export default {
  track: trackTokenUsage,
  getStats: getTokenUsageStats,
  getRecent: getRecentTokenUsage,
  getForPeriod: getTokenUsageForPeriod,
  export: exportTokenUsage,
  import: importTokenUsage,
  clear: clearTokenUsage,
  setModelCost,
  estimateCost,
  getBrowserEfficiency: getBrowserTokenEfficiency,
  browser: browserTokens,
};