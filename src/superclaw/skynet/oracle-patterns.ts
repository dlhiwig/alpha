/**
 * 🦊 SKYNET ORACLE PATTERNS — Pattern Storage & Retrieval
 * Pattern detection, hashing, tagging, storage, and type definitions.
 */

import * as crypto from 'crypto';
import * as path from 'path';

export const CONFIG = {
  STATE_FILE: path.join(process.cwd(), 'data', 'oracle-state.json'),
  PATTERNS_FILE: path.join(process.cwd(), 'data', 'oracle-patterns.json'),
  MISTAKES_FILE: path.join(process.cwd(), 'data', 'oracle-mistakes.json'),
  LEARNINGS_FILE: path.join(process.cwd(), 'data', 'oracle-learnings.json'),
  JUDGE_RESULTS_FILE: path.join(process.cwd(), 'data', 'oracle-judge-results.json'),
  MIN_SAMPLES: 3,
  CONFIDENCE_THRESHOLD: 0.6,
  HIGH_CONFIDENCE_THRESHOLD: 0.85,
  COST_OPTIMIZATION_THRESHOLD: 0.8,
  MISTAKE_PREVENTION_THRESHOLD: 2,
  MAX_PROMPT_INJECTIONS: 5,
  LEARNING_DECAY_DAYS: 30,
};

export interface InteractionRecord {
  id: string;
  timestamp: number;
  provider: string;
  model: string;
  promptHash: string;
  promptLength: number;
  responseLength: number;
  latencyMs: number;
  cost: number;
  success: boolean;
  userFeedback?: 'positive' | 'negative' | null;
  tags: string[];
}

export interface PromptPattern {
  hash: string;
  pattern: string;        
  totalUses: number;
  successCount: number;
  failureCount: number;
  avgLatency: number;
  avgCost: number;
  bestProvider: string;
  bestModel: string;
  lastUsed: number;
  optimizations: string[];
}

export interface ModelPerformance {
  model: string;
  provider: string;
  totalRequests: number;
  successRate: number;
  avgLatency: number;
  avgCost: number;
  bestFor: string[];
}

export interface MistakePattern {
  pattern: string;
  frequency: number;
  rootCause: string;
  correction: string;
  preventionPrompt: string;
  lastSeen: number;
  severity: 'low' | 'medium' | 'high';
  tags: string[];
  contexts: string[];
  relatedMistakes: string[];
  confidence: number;
  successfulCorrections: number;
}

export interface TaskTypePerformance {
  taskType: string;
  totalAttempts: number;
  successRate: number;
  commonFailures: string[];
  bestPractices: string[];
  avgComplexity: number;
  avgTimeToComplete: number;
}

export interface SwarmJudgeResult {
  quality: number;
  reasoning: string;
  suggestions: string[];
  confidence: number;
  timestamp: number;
}

export interface LearningInjection {
  trigger: string;
  injection: string;
  priority: number;
  effectiveness: number;
  uses: number;
}

export interface ConfidenceMetrics {
  historicalAccuracy: number;
  patternStrength: number;
  dataQuality: number;
  recency: number;
  consensus: number;
}

export interface OracleState {
  startedAt: number;
  totalInteractions: number;
  totalLearnings: number;
  recentInteractions: InteractionRecord[];
  patterns: Map<string, PromptPattern>;
  modelPerformance: Map<string, ModelPerformance>;
  taskTypePerformance: Map<string, TaskTypePerformance>;
  mistakePatterns: Map<string, MistakePattern>;
  learningInjections: Map<string, LearningInjection>;
  judgeResults: Map<string, SwarmJudgeResult>;
  pendingSuggestions: Array<{
    type: 'prompt' | 'model' | 'cost' | 'approach';
    suggestion: string;
    confidence: number;
    timestamp: number;
    evidence?: string[];
  }>;
  optimizationsApplied: number;
  costSaved: number;
  latencyImproved: number;
  mistakesPrevented: number;
}

export function hashPrompt(prompt: string): string {
  // Normalize prompt: lowercase, remove extra whitespace
  const normalized = prompt.toLowerCase().trim().replace(/\s+/g, ' ');
  return crypto.createHash('md5').update(normalized).digest('hex').slice(0, 12);
}

export function extractTags(prompt: string): string[] {
  const tags: string[] = [];
  
  // Detect common task types
  if (/\b(code|function|implement|class|api)\b/i.test(prompt)) tags.push('coding');
  if (/\b(explain|what is|how does|why)\b/i.test(prompt)) tags.push('explanation');
  if (/\b(write|create|generate|draft)\b/i.test(prompt)) tags.push('generation');
  if (/\b(fix|debug|error|bug)\b/i.test(prompt)) tags.push('debugging');
  if (/\b(summarize|summary|tldr)\b/i.test(prompt)) tags.push('summarization');
  if (/\b(translate|convert)\b/i.test(prompt)) tags.push('translation');
  if (/\b(analyze|analysis|review)\b/i.test(prompt)) tags.push('analysis');
  
  return tags;
}

// updatePattern function moved to oracle-core.ts to avoid circular dependencies

export function generateSuggestions(state: OracleState): void {
  // Analyze patterns for optimization opportunities
  for (const [hash, pattern] of Array.from(state.patterns.entries())) {
    if (pattern.totalUses < CONFIG.MIN_SAMPLES) continue;
    
    const successRate = pattern.successCount / pattern.totalUses;
    
    // Cost optimization: if success rate is high, suggest cheaper model
    if (successRate >= CONFIG.COST_OPTIMIZATION_THRESHOLD && pattern.avgCost > 0.001) {
      const cheaperModels = Array.from(state.modelPerformance.values())
        .filter(m => m.avgCost < pattern.avgCost * 0.5 && m.successRate >= 0.7);
      
      if (cheaperModels.length > 0) {
        state.pendingSuggestions.push({
          type: 'cost',
          suggestion: `Pattern ${hash} has ${(successRate * 100).toFixed(0)}% success. Consider ${cheaperModels[0].model} (${(cheaperModels[0].avgCost * 100).toFixed(2)}¢ vs ${(pattern.avgCost * 100).toFixed(2)}¢)`,
          confidence: successRate,
          timestamp: Date.now(),
          evidence: [],
        });
      }
    }
    
    // Latency optimization: suggest faster models
    if (pattern.avgLatency > 5000) {
      const fasterModels = Array.from(state.modelPerformance.values())
        .filter(m => m.avgLatency < pattern.avgLatency * 0.5 && m.successRate >= 0.7);
      
      if (fasterModels.length > 0) {
        state.pendingSuggestions.push({
          type: 'model',
          suggestion: `Pattern ${hash} avg ${(pattern.avgLatency / 1000).toFixed(1)}s. ${fasterModels[0].model} averages ${(fasterModels[0].avgLatency / 1000).toFixed(1)}s`,
          confidence: fasterModels[0].successRate,
          timestamp: Date.now(),
          evidence: [],
        });
      }
    }
  }
  
  // Keep only recent suggestions
  state.pendingSuggestions = state.pendingSuggestions
    .filter(s => Date.now() - s.timestamp < 24 * 60 * 60 * 1000) // Last 24h
    .slice(-20); // Max 20
}