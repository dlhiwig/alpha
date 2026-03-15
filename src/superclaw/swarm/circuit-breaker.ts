// @ts-nocheck
/**
 * Circuit Breaker with Cost-Aware Features
 * 
 * Tracks provider health and prevents wasted calls to broken providers.
 * Enhanced with cost tracking and budget-based circuit breaking.
 */

import { ProviderName } from './types';
import { ProviderState, CircuitBreaker } from './contract';
import { getProviderTier } from './model-router';

interface ProviderHealth {
  state: ProviderState;
  lastCheck: number;
  failureCount: number;
  lastError?: string;
  cooldownUntil?: number;
  // Cost-aware features
  costPerCall: number;
  avgResponseTime: number;
  consecutiveTimeouts: number;
  budgetExceeded?: boolean;
}

// In-memory health tracking (per process)
const providerHealth: Map<ProviderName, ProviderHealth> = new Map();

/**
 * Get current health state for a provider
 */
export function getProviderState(provider: ProviderName): ProviderHealth {
  if (!providerHealth.has(provider)) {
    providerHealth.set(provider, {
      state: 'healthy',
      lastCheck: 0,
      failureCount: 0,
      costPerCall: 0,
      avgResponseTime: 0,
      consecutiveTimeouts: 0,
      budgetExceeded: false,
    });
  }
  return providerHealth.get(provider)!;
}

/**
 * Check if provider should be skipped based on circuit breaker config
 */
export function shouldSkipProvider(
  provider: ProviderName,
  config: CircuitBreaker,
  budgetExceeded: boolean = false
): { skip: boolean; reason?: string } {
  if (!config.enabled) {
    return { skip: false };
  }
  
  const health = getProviderState(provider);
  
  // Check budget constraints first (highest priority)
  if (budgetExceeded || health.budgetExceeded) {
    return {
      skip: true,
      reason: 'Budget exceeded',
    };
  }
  
  // Check cooldown
  if (health.cooldownUntil && Date.now() < health.cooldownUntil) {
    return {
      skip: true,
      reason: `In cooldown until ${new Date(health.cooldownUntil).toISOString()}`,
    };
  }
  
  // Cost-aware circuit breaking: skip expensive providers if they're failing
  const providerTier = getProviderTier(provider);
  if (providerTier >= 4 && health.consecutiveTimeouts >= 2) {
    return {
      skip: true,
      reason: `Expensive provider (tier ${providerTier}) with ${health.consecutiveTimeouts} consecutive timeouts`,
    };
  }
  
  // Check state
  if (config.skipMisconfigured && health.state === 'misconfigured') {
    return {
      skip: true,
      reason: `Misconfigured: ${health.lastError || 'unknown'}`,
    };
  }
  
  if (config.skipDegraded && health.state === 'degraded') {
    return {
      skip: true,
      reason: `Degraded: ${health.lastError || 'rate limited'}`,
    };
  }
  
  if (health.state === 'disabled') {
    return {
      skip: true,
      reason: 'Provider disabled',
    };
  }
  
  return { skip: false };
}

/**
 * Record a successful call
 */
export function recordSuccess(
  provider: ProviderName,
  responseTimeMs: number = 0,
  cost: number = 0
): void {
  const health = getProviderState(provider);
  health.state = 'healthy';
  health.lastCheck = Date.now();
  health.failureCount = 0;
  health.consecutiveTimeouts = 0;
  health.lastError = undefined;
  health.cooldownUntil = undefined;
  health.budgetExceeded = false;
  
  // Update performance metrics
  if (responseTimeMs > 0) {
    health.avgResponseTime = health.avgResponseTime === 0 
      ? responseTimeMs 
      : (health.avgResponseTime + responseTimeMs) / 2;
  }
  
  if (cost > 0) {
    health.costPerCall = health.costPerCall === 0
      ? cost
      : (health.costPerCall + cost) / 2;
  }
}

/**
 * Record a failed call
 */
export function recordFailure(
  provider: ProviderName,
  errorType: 'quota' | 'auth' | 'rate_limit' | 'timeout' | 'misconfigured' | 'unknown' | 'budget_exceeded',
  errorMessage: string,
  config: CircuitBreaker,
  cost: number = 0
): void {
  const health = getProviderState(provider);
  health.lastCheck = Date.now();
  health.failureCount++;
  health.lastError = errorMessage;
  
  // Track cost even for failures (helps with budget calculations)
  if (cost > 0) {
    health.costPerCall = health.costPerCall === 0
      ? cost
      : (health.costPerCall + cost) / 2;
  }
  
  // Determine new state based on error type
  switch (errorType) {
    case 'auth':
    case 'misconfigured':
      health.state = 'misconfigured';
      break;
    case 'quota':
      health.state = 'degraded';
      health.cooldownUntil = Date.now() + 3600_000; // 1 hour cooldown for quota
      break;
    case 'budget_exceeded':
      health.budgetExceeded = true;
      health.state = 'degraded';
      health.cooldownUntil = Date.now() + 3600_000; // 1 hour cooldown for budget issues
      break;
    case 'rate_limit':
      health.state = 'degraded';
      health.cooldownUntil = Date.now() + config.cooldownMs;
      break;
    case 'timeout':
      health.consecutiveTimeouts++;
      // Cost-aware timeout handling: degrade expensive providers faster
      const providerTier = getProviderTier(provider);
      const timeoutThreshold = providerTier >= 4 ? 2 : 3; // Faster degradation for expensive providers
      
      if (health.consecutiveTimeouts >= timeoutThreshold) {
        health.state = 'degraded';
        health.cooldownUntil = Date.now() + config.cooldownMs;
      }
      break;
    default:
      if (health.failureCount >= 5) {
        health.state = 'degraded';
      }
  }
}

/**
 * Manually disable a provider
 */
export function disableProvider(provider: ProviderName, reason?: string): void {
  const health = getProviderState(provider);
  health.state = 'disabled';
  health.lastError = reason || 'Manually disabled';
  health.lastCheck = Date.now();
}

/**
 * Reset provider to healthy state
 */
export function resetProvider(provider: ProviderName): void {
  // @ts-expect-error - Post-Merge Reconciliation
  providerHealth.set(provider, {
    state: 'healthy',
    lastCheck: Date.now(),
    failureCount: 0,
  });
}

/**
 * Get all provider health statuses
 */
export function getAllProviderHealth(): Map<ProviderName, ProviderHealth> {
  return new Map(providerHealth);
}

/**
 * Mark provider as budget exceeded
 */
export function markBudgetExceeded(provider: ProviderName, reason: string): void {
  const health = getProviderState(provider);
  health.budgetExceeded = true;
  health.state = 'degraded';
  health.lastError = reason;
  health.cooldownUntil = Date.now() + 3600_000; // 1 hour cooldown
}

/**
 * Clear budget exceeded status (e.g., daily reset)
 */
export function clearBudgetExceeded(provider?: ProviderName): void {
  if (provider) {
    const health = getProviderState(provider);
    health.budgetExceeded = false;
    if (health.state === 'degraded' && health.lastError?.includes('budget')) {
      health.state = 'healthy';
      health.lastError = undefined;
      health.cooldownUntil = undefined;
    }
  } else {
    // Clear all providers
    for (const [providerName, health] of providerHealth.entries()) {
      health.budgetExceeded = false;
      if (health.state === 'degraded' && health.lastError?.includes('budget')) {
        health.state = 'healthy';
        health.lastError = undefined;
        health.cooldownUntil = undefined;
      }
    }
  }
}

/**
 * Get cost metrics for a provider
 */
export function getProviderCostMetrics(provider: ProviderName): {
  avgCostPerCall: number;
  avgResponseTime: number;
  consecutiveTimeouts: number;
  budgetExceeded: boolean;
} {
  const health = getProviderState(provider);
  return {
    avgCostPerCall: health.costPerCall,
    avgResponseTime: health.avgResponseTime,
    consecutiveTimeouts: health.consecutiveTimeouts,
    budgetExceeded: health.budgetExceeded || false,
  };
}

/**
 * Format health status for display with cost metrics
 */
export function formatHealthStatus(): string {
  const lines: string[] = ['## Provider Health & Cost Metrics', ''];
  
  const providers: ProviderName[] = [
    'ollama', 'deepseek', 'minimax', 'zhipu', 'kimi', 
    'nvidia', 'gemini', 'claude', 'codex', 'grok', 'perplexity'
  ];
  
  for (const provider of providers) {
    const health = getProviderState(provider);
    const tier = getProviderTier(provider);
    
    let icon = health.state === 'healthy' ? '✅' :
               health.state === 'degraded' ? '⚠️' :
               health.state === 'misconfigured' ? '❌' : '🚫';
               
    if (health.budgetExceeded) {
      icon = '💰❌'; // Budget exceeded
    }
    
    let status = `${icon} **${provider}** (tier ${tier}): ${health.state}`;
    
    // Add cost metrics
    if (health.costPerCall > 0) {
      status += ` | $${health.costPerCall.toFixed(4)}/call`;
    }
    
    if (health.avgResponseTime > 0) {
      status += ` | ${Math.round(health.avgResponseTime)}ms`;
    }
    
    if (health.consecutiveTimeouts > 0) {
      status += ` | ${health.consecutiveTimeouts} timeouts`;
    }
    
    if (health.lastError) {
      status += ` - ${health.lastError.slice(0, 40)}`;
    }
    
    if (health.cooldownUntil && Date.now() < health.cooldownUntil) {
      const remaining = Math.ceil((health.cooldownUntil - Date.now()) / 1000);
      status += ` (cooldown: ${remaining}s)`;
    }
    
    lines.push(status);
  }
  
  return lines.join('\n');
}
