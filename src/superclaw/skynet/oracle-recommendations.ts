/**
 * 🦊 SKYNET ORACLE RECOMMENDATIONS — Recommendation Engine
 * Model recommendations, optimization suggestions, performance analysis.
 */

import { InteractionRecord, ModelPerformance, CONFIG, OracleState } from './oracle-patterns';
import { hashPrompt, extractTags } from './oracle-patterns';

export function updateModelPerformance(record: InteractionRecord, state: OracleState): void {
  const key = `${record.provider}:${record.model}`;
  let perf = state.modelPerformance.get(key);
  
  if (!perf) {
    perf = {
      model: record.model,
      provider: record.provider,
      totalRequests: 0,
      successRate: 0,
      avgLatency: 0,
      avgCost: 0,
      bestFor: [],
    };
  }
  
  perf.totalRequests++;
  perf.successRate = ((perf.successRate * (perf.totalRequests - 1)) + (record.success ? 1 : 0)) / perf.totalRequests;
  perf.avgLatency = ((perf.avgLatency * (perf.totalRequests - 1)) + record.latencyMs) / perf.totalRequests;
  perf.avgCost = ((perf.avgCost * (perf.totalRequests - 1)) + record.cost) / perf.totalRequests;
  
  // Update bestFor based on tags
  for (const tag of record.tags) {
    if (record.success && !perf.bestFor.includes(tag)) {
      perf.bestFor.push(tag);
    }
  }
  
  state.modelPerformance.set(key, perf);
}

// ═══════════════════════════════════════════════════════════════
// RECOMMENDATION ENGINE
// ═══════════════════════════════════════════════════════════════

/**
 * Get model recommendation for a prompt
 */
export function getRecommendation(prompt: string, state: OracleState): {
  recommendedModel: string;
  recommendedProvider: string;
  confidence: number;
  reason: string;
  alternativeOptions?: Array<{
    model: string;
    provider: string;
    confidence: number;
    reason: string;
  }>;
} | null {
  const hash = hashPrompt(prompt);
  const pattern = state.patterns.get(hash);
  
  // If we've seen this pattern before
  if (pattern && pattern.totalUses >= CONFIG.MIN_SAMPLES) {
    const successRate = pattern.successCount / pattern.totalUses;
    if (successRate >= CONFIG.CONFIDENCE_THRESHOLD) {
      return {
        recommendedModel: pattern.bestModel,
        recommendedProvider: pattern.bestProvider,
        confidence: successRate,
        reason: `Pattern seen ${pattern.totalUses} times with ${(successRate * 100).toFixed(0)}% success`,
        alternativeOptions: getAlternativeRecommendations(prompt, state, pattern.bestModel),
      };
    }
  }
  
  // Fall back to task-based recommendation
  const tags = extractTags(prompt);
  if (tags.length > 0) {
    const modelRecommendations = [];
    
    for (const [key, perf] of Array.from(state.modelPerformance.entries())) {
      if (perf.bestFor.some(t => tags.includes(t)) && perf.successRate >= CONFIG.CONFIDENCE_THRESHOLD) {
        modelRecommendations.push({
          model: perf.model,
          provider: perf.provider,
          confidence: perf.successRate,
          reason: `${perf.model} excels at ${tags.join(', ')} tasks`,
          avgCost: perf.avgCost,
          avgLatency: perf.avgLatency,
        });
      }
    }
    
    if (modelRecommendations.length > 0) {
      // Sort by confidence, then cost efficiency
      modelRecommendations.sort((a, b) => {
        const confidenceDiff = b.confidence - a.confidence;
        if (Math.abs(confidenceDiff) > 0.1) {return confidenceDiff;} // Significant confidence difference
        return a.avgCost - b.avgCost; // Prefer cheaper if confidence is similar
      });
      
      const best = modelRecommendations[0];
      return {
        recommendedModel: best.model,
        recommendedProvider: best.provider,
        confidence: best.confidence,
        reason: best.reason,
        alternativeOptions: modelRecommendations.slice(1, 4), // Show up to 3 alternatives
      };
    }
  }
  
  return null;
}

/**
 * Get alternative model recommendations
 */
function getAlternativeRecommendations(prompt: string, state: OracleState, excludeModel: string): Array<{
  model: string;
  provider: string;
  confidence: number;
  reason: string;
}> {
  const tags = extractTags(prompt);
  const alternatives = [];
  
  for (const [key, perf] of Array.from(state.modelPerformance.entries())) {
    if (perf.model === excludeModel) {continue;}
    if (perf.successRate < CONFIG.CONFIDENCE_THRESHOLD) {continue;}
    
    // Check if suitable for task
    const taskMatch = tags.some(t => perf.bestFor.includes(t));
    if (taskMatch || tags.length === 0) {
      alternatives.push({
        model: perf.model,
        provider: perf.provider,
        confidence: perf.successRate,
        reason: taskMatch 
          ? `Good at ${tags.filter(t => perf.bestFor.includes(t)).join(', ')}`
          : `General reliability: ${(perf.successRate * 100).toFixed(0)}%`,
      });
    }
  }
  
  return alternatives
    .toSorted((a, b) => b.confidence - a.confidence)
    .slice(0, 3);
}

/**
 * Get cost optimization suggestions
 */
export function getCostOptimizationSuggestions(state: OracleState): Array<{
  currentModel: string;
  suggestedModel: string;
  potentialSavings: number;
  confidenceRatio: number;
  reason: string;
}> {
  const suggestions = [];
  
  // Analyze patterns for cost optimization opportunities
  for (const [hash, pattern] of Array.from(state.patterns.entries())) {
    if (pattern.totalUses < CONFIG.MIN_SAMPLES) {continue;}
    
    const successRate = pattern.successCount / pattern.totalUses;
    if (successRate < CONFIG.COST_OPTIMIZATION_THRESHOLD) {continue;}
    
    // Find cheaper alternatives
    const currentKey = `${pattern.bestProvider}:${pattern.bestModel}`;
    const currentPerf = state.modelPerformance.get(currentKey);
    if (!currentPerf) {continue;}
    
    for (const [key, perf] of Array.from(state.modelPerformance.entries())) {
      if (key === currentKey) {continue;}
      if (perf.avgCost >= currentPerf.avgCost) {continue;} // Not cheaper
      if (perf.successRate < successRate * 0.9) {continue;} // Too much quality loss
      
      const potentialSavings = currentPerf.avgCost - perf.avgCost;
      const confidenceRatio = perf.successRate / currentPerf.successRate;
      
      suggestions.push({
        currentModel: currentPerf.model,
        suggestedModel: perf.model,
        potentialSavings,
        confidenceRatio,
        reason: `${(potentialSavings * 100).toFixed(2)}¢ savings per request with ${(confidenceRatio * 100).toFixed(0)}% relative quality`,
      });
    }
  }
  
  return suggestions
    .toSorted((a, b) => (b.potentialSavings * b.confidenceRatio) - (a.potentialSavings * a.confidenceRatio))
    .slice(0, 10);
}

/**
 * Get performance optimization suggestions
 */
export function getPerformanceOptimizationSuggestions(state: OracleState): Array<{
  slowPattern: string;
  currentLatency: number;
  suggestedModel: string;
  expectedLatency: number;
  qualityImpact: number;
}> {
  const suggestions = [];
  
  for (const [hash, pattern] of Array.from(state.patterns.entries())) {
    if (pattern.totalUses < CONFIG.MIN_SAMPLES) {continue;}
    if (pattern.avgLatency < 3000) {continue;} // Only suggest for slow patterns (>3s)
    
    const successRate = pattern.successCount / pattern.totalUses;
    const currentKey = `${pattern.bestProvider}:${pattern.bestModel}`;
    const currentPerf = state.modelPerformance.get(currentKey);
    if (!currentPerf) {continue;}
    
    // Find faster alternatives
    for (const [key, perf] of Array.from(state.modelPerformance.entries())) {
      if (key === currentKey) {continue;}
      if (perf.avgLatency >= pattern.avgLatency) {continue;} // Not faster
      if (perf.successRate < successRate * 0.8) {continue;} // Too much quality loss
      
      suggestions.push({
        slowPattern: hash,
        currentLatency: pattern.avgLatency,
        suggestedModel: perf.model,
        expectedLatency: perf.avgLatency,
        qualityImpact: (perf.successRate - currentPerf.successRate) / currentPerf.successRate,
      });
    }
  }
  
  return suggestions
    .toSorted((a, b) => (b.currentLatency - b.expectedLatency) - (a.currentLatency - a.expectedLatency))
    .slice(0, 10);
}

/**
 * Get optimization suggestions
 */
export function getSuggestions(state: OracleState): OracleState['pendingSuggestions'] {
  return state.pendingSuggestions.filter(s => s.confidence >= CONFIG.CONFIDENCE_THRESHOLD);
}

/**
 * Analyze model performance trends
 */
export function analyzeModelTrends(state: OracleState): {
  topPerformers: Array<{ model: string; successRate: number; avgCost: number; requests: number }>;
  costEfficient: Array<{ model: string; costEfficiency: number; successRate: number }>;
  fastestModels: Array<{ model: string; avgLatency: number; successRate: number }>;
  specialists: Array<{ model: string; specialty: string; successRate: number }>;
} {
  const models = Array.from(state.modelPerformance.values());
  
  const topPerformers = models
    .filter(m => m.totalRequests >= CONFIG.MIN_SAMPLES)
    .toSorted((a, b) => b.successRate - a.successRate)
    .slice(0, 10)
    .map(m => ({
      model: m.model,
      successRate: m.successRate,
      avgCost: m.avgCost,
      requests: m.totalRequests,
    }));
  
  const costEfficient = models
    .filter(m => m.totalRequests >= CONFIG.MIN_SAMPLES && m.avgCost > 0)
    .map(m => ({
      model: m.model,
      costEfficiency: m.successRate / m.avgCost,
      successRate: m.successRate,
    }))
    .toSorted((a, b) => b.costEfficiency - a.costEfficiency)
    .slice(0, 10);
  
  const fastestModels = models
    .filter(m => m.totalRequests >= CONFIG.MIN_SAMPLES)
    .toSorted((a, b) => a.avgLatency - b.avgLatency)
    .slice(0, 10)
    .map(m => ({
      model: m.model,
      avgLatency: m.avgLatency,
      successRate: m.successRate,
    }));
  
  const specialists = models
    .filter(m => m.totalRequests >= CONFIG.MIN_SAMPLES && m.bestFor.length > 0)
    .map(m => ({
      model: m.model,
      specialty: m.bestFor.join(', '),
      successRate: m.successRate,
    }))
    .toSorted((a, b) => b.successRate - a.successRate)
    .slice(0, 10);
  
  return {
    topPerformers,
    costEfficient,
    fastestModels,
    specialists,
  };
}