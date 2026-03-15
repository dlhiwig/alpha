/**
 * 🦊 SKYNET ORACLE — Enhanced Learning System (Facade)
 * 
 * Wave 3: ADAPT++ - Learns from every interaction. Gets smarter over time.
 * 
 * Main facade that re-exports all Oracle functionality from focused sub-modules.
 * 
 * Architecture:
 * - oracle-core.ts: Pattern learning core, state management, main API
 * - oracle-patterns.ts: Pattern storage/retrieval, types, hashing
 * - oracle-mistakes.ts: Mistake tracking/learning, prevention
 * - oracle-recommendations.ts: Recommendation engine, optimization
 */

// Core API functions
export {
  startOracle,
  stopOracle,
  recordInteraction,
  recordFeedback,
  getOracleStats,
  getOracleState,
} from './oracle-core';

// Types and configuration
export { CONFIG } from './oracle-patterns.js';
export type {
  InteractionRecord,
  PromptPattern,
  ModelPerformance,
  MistakePattern,
  TaskTypePerformance,
  SwarmJudgeResult,
  LearningInjection,
  ConfidenceMetrics,
  OracleState,
} from './oracle-patterns.js';

// Pattern detection and analysis
export {
  hashPrompt,
  extractTags,
} from './oracle-patterns.js';

// Mistake learning and prevention
export {
  learnFromMistake,
  getPromptCorrections,
  getMistakePreventionInjections,
  recordMistakeCorrection,
  initializeKnownMistakes,
  analyzeMistakeTrends,
} from './oracle-mistakes';

// Recommendations and optimization
export {
  getRecommendation,
  getCostOptimizationSuggestions,
  getPerformanceOptimizationSuggestions,
  getSuggestions,
  analyzeModelTrends,
  updateModelPerformance,
} from './oracle-recommendations';

/**
 * Get comprehensive Oracle dashboard data
 */
export async function getOracleDashboard() {
  const { getOracleState, getOracleStats } = await import('./oracle-core');
  const { analyzeMistakeTrends } = await import('./oracle-mistakes');
  const { analyzeModelTrends, getCostOptimizationSuggestions, getPerformanceOptimizationSuggestions } = await import('./oracle-recommendations');
  
  const state = getOracleState();
  const stats = getOracleStats();
  const mistakeTrends = analyzeMistakeTrends(state);
  const modelTrends = analyzeModelTrends(state);
  const costSuggestions = getCostOptimizationSuggestions(state);
  const perfSuggestions = getPerformanceOptimizationSuggestions(state);
  
  return {
    stats,
    mistakeTrends,
    modelTrends,
    optimizations: { cost: costSuggestions, performance: perfSuggestions },
    recentInteractions: state.recentInteractions.slice(-10),
    topPatterns: Array.from(state.patterns.entries())
      .toSorted(([,a], [,b]) => b.totalUses - a.totalUses)
      .slice(0, 10)
      .map(([hash, pattern]) => ({
        hash,
        uses: pattern.totalUses,
        successRate: pattern.successCount / pattern.totalUses,
        avgCost: pattern.avgCost,
        avgLatency: pattern.avgLatency,
      })),
  };
}

/**
 * Get intelligent prompt enhancement with mistake prevention
 */
export async function enhancePrompt(originalPrompt: string): Promise<{
  enhancedPrompt: string;
  injections: string[];
  mistakePrevention: Array<{ pattern: string; prevention: string }>;
  recommendation: any;
}> {
  const { getMistakePreventionInjections, getPromptCorrections } = await import('./oracle-mistakes');
  const { getRecommendation } = await import('./oracle-recommendations');
  const { getOracleState } = await import('./oracle-core');
  
  const state = getOracleState();
  
  // Get mistake prevention injections
  const injections = getMistakePreventionInjections(originalPrompt, state);
  
  // Get relevant corrections
  const corrections = getPromptCorrections(state);
  const relevantCorrections = corrections.filter(correction => 
    originalPrompt.toLowerCase().includes(correction.pattern.toLowerCase().split(' ')[0])
  );
  
  // Build enhanced prompt
  let enhancedPrompt = originalPrompt;
  if (injections.length > 0) {
    enhancedPrompt = injections.join('\n') + '\n\n' + originalPrompt;
  }
  
  // Get model recommendation
  const recommendation = getRecommendation(originalPrompt, state);
  
  return {
    enhancedPrompt,
    injections,
    mistakePrevention: relevantCorrections.map(c => ({
      pattern: c.pattern,
      prevention: c.correction,
    })),
    recommendation,
  };
}

/**
 * Quick health check of the Oracle system
 */
export async function oracleHealthCheck(): Promise<{
  status: 'healthy' | 'warning' | 'error';
  issues: string[];
  stats: any;
}> {
  try {
    const { getOracleStats } = await import('./oracle-core');
    const stats = getOracleStats();
    
    const issues = [];
    let status: 'healthy' | 'warning' | 'error' = 'healthy';
    
    if (stats.totalInteractions < 10) {
      issues.push('Low interaction count - Oracle needs more data to be effective');
      status = 'warning';
    }
    
    if (stats.patternsLearned === 0) {
      issues.push('No patterns learned yet');
      status = 'warning';
    }
    
    if (stats.mistakePatternsLearned === 0) {
      issues.push('No mistake patterns learned - consider adding known failure cases');
      status = 'warning';
    }
    
    return { status, issues, stats };
  } catch (error: unknown) {
    return {
      status: 'error',
      issues: [`Oracle system error: ${(error as Error).message}`],
      stats: null,
    };
  }
}