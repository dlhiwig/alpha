/**
 * 🦊 SKYNET ORACLE CORE — Pattern Learning Engine
 * Core functionality: state management, interaction recording, learning.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { InteractionRecord, OracleState, CONFIG } from './oracle-patterns';
import { updateModelPerformance } from './oracle-recommendations';
import { initializeKnownMistakes } from './oracle-mistakes';

let state: OracleState = {
  startedAt: Date.now(),
  totalInteractions: 0,
  totalLearnings: 0,
  recentInteractions: [],
  patterns: new Map(),
  modelPerformance: new Map(),
  taskTypePerformance: new Map(),
  mistakePatterns: new Map(),
  learningInjections: new Map(),
  judgeResults: new Map(),
  pendingSuggestions: [],
  optimizationsApplied: 0,
  costSaved: 0,
  latencyImproved: 0,
  mistakesPrevented: 0,
};

let isRunning = false;

export async function loadState(): Promise<void> {
  try {
    const data = await fs.readFile(CONFIG.STATE_FILE, 'utf8');
    const saved = JSON.parse(data);
    
    state = {
      ...state,
      ...saved,
      patterns: new Map(Object.entries(saved.patterns || {})),
      modelPerformance: new Map(Object.entries(saved.modelPerformance || {})),
      taskTypePerformance: new Map(Object.entries(saved.taskTypePerformance || {})),
      mistakePatterns: new Map(Object.entries(saved.mistakePatterns || {})),
      learningInjections: new Map(Object.entries(saved.learningInjections || {})),
      judgeResults: new Map(Object.entries(saved.judgeResults || {})),
    };
    
    console.log(`[🦊 ORACLE] Loaded ${state.totalInteractions} interactions, ${state.patterns.size} patterns`);
  } catch {
    // Fresh start
    console.log('[🦊 ORACLE] Starting fresh - no previous state found');
  }
}

export async function saveState(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(CONFIG.STATE_FILE), { recursive: true });
    
    const toSave = {
      ...state,
      patterns: Object.fromEntries(state.patterns),
      modelPerformance: Object.fromEntries(state.modelPerformance),
      taskTypePerformance: Object.fromEntries(state.taskTypePerformance),
      mistakePatterns: Object.fromEntries(state.mistakePatterns),
      learningInjections: Object.fromEntries(state.learningInjections),
      judgeResults: Object.fromEntries(state.judgeResults),
    };
    
    await fs.writeFile(CONFIG.STATE_FILE, JSON.stringify(toSave, null, 2));
  } catch (error: unknown) {
    console.error('[🦊 ORACLE] Failed to save state:', error);
  }
}

/**
 * Record an interaction for learning
 */
export function recordInteraction(
  provider: string,
  model: string,
  prompt: string,
  responseLength: number,
  latencyMs: number,
  cost: number,
  success: boolean
): string {
  const record: InteractionRecord = {
    id: `int-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    provider,
    model,
    promptHash: hashPrompt(prompt),
    promptLength: prompt.length,
    responseLength,
    latencyMs,
    cost,
    success,
    userFeedback: null,
    tags: extractTags(prompt),
  };
  
  // Store recent interactions (keep last 1000)
  state.recentInteractions.push(record);
  if (state.recentInteractions.length > 1000) {
    state.recentInteractions = state.recentInteractions.slice(-1000);
  }
  
  state.totalInteractions++;
  
  // Learn from this interaction
  updatePattern(record);
  updateModelPerformance(record, state);
  
  // Periodically generate suggestions
  if (state.totalInteractions % 10 === 0) {
    generateSuggestions();
    state.totalLearnings++;
  }
  
  // Auto-save every 100 interactions
  if (state.totalInteractions % 100 === 0) {
    saveState();
  }
  
  return record.id;
}

/**
 * Record user feedback on a response
 */
export function recordFeedback(interactionId: string, feedback: 'positive' | 'negative'): boolean {
  const interaction = state.recentInteractions.find(i => i.id === interactionId);
  if (!interaction) {return false;}
  
  interaction.userFeedback = feedback;
  
  // Adjust success based on feedback
  if (feedback === 'negative' && interaction.success) {
    // User says it was bad even though it "succeeded"
    const pattern = state.patterns.get(interaction.promptHash);
    if (pattern) {
      pattern.successCount--;
      pattern.failureCount++;
    }
  }
  
  return true;
}

export async function startOracle(): Promise<void> {
  if (isRunning) {
    console.warn('[🦊 ORACLE] Already running');
    return;
  }
  
  console.log('[🦊 ORACLE] Starting learning system...');
  
  await loadState();
  
  // Initialize known mistake patterns from past reviews
  initializeKnownMistakes(state);
  
  isRunning = true;
  
  console.log(`[🦊 ORACLE] Learning active — ${state.patterns.size} patterns, ${state.modelPerformance.size} models, ${state.mistakePatterns.size} mistakes`);
}

export async function stopOracle(): Promise<void> {
  if (!isRunning) {return;}
  
  await saveState();
  isRunning = false;
  console.log('[🦊 ORACLE] Learning paused — knowledge preserved');
}

/**
 * Get oracle statistics
 */
export function getOracleStats(): {
  totalInteractions: number;
  patternsLearned: number;
  modelsTracked: number;
  mistakePatternsLearned: number;
  suggestions: number;
  costSaved: number;
} {
  return {
    totalInteractions: state.totalInteractions,
    patternsLearned: state.patterns.size,
    modelsTracked: state.modelPerformance.size,
    mistakePatternsLearned: state.mistakePatterns.size,
    suggestions: state.pendingSuggestions.length,
    costSaved: state.costSaved,
  };
}

export function getOracleState(): OracleState {
  return {
    ...state,
    patterns: new Map(state.patterns),
    modelPerformance: new Map(state.modelPerformance),
    mistakePatterns: new Map(state.mistakePatterns),
  };
}

export { state };

// Import required functions from other modules
import { hashPrompt, extractTags } from './oracle-patterns';

function updatePattern(record: InteractionRecord): void {
  let pattern = state.patterns.get(record.promptHash);
  
  if (!pattern) {
    pattern = {
      hash: record.promptHash,
      pattern: '', // Will be set on first use
      totalUses: 0,
      successCount: 0,
      failureCount: 0,
      avgLatency: 0,
      avgCost: 0,
      bestProvider: record.provider,
      bestModel: record.model,
      lastUsed: record.timestamp,
      optimizations: [],
    };
  }
  
  // Update stats
  pattern.totalUses++;
  if (record.success) {
    pattern.successCount++;
  } else {
    pattern.failureCount++;
  }
  
  // Running average for latency and cost
  pattern.avgLatency = ((pattern.avgLatency * (pattern.totalUses - 1)) + record.latencyMs) / pattern.totalUses;
  pattern.avgCost = ((pattern.avgCost * (pattern.totalUses - 1)) + record.cost) / pattern.totalUses;
  pattern.lastUsed = record.timestamp;
  
  // Track best performer
  if (record.success && record.latencyMs < pattern.avgLatency) {
    pattern.bestProvider = record.provider;
    pattern.bestModel = record.model;
  }
  
  state.patterns.set(record.promptHash, pattern);
}

function generateSuggestions(): void {
  // Import here to avoid circular dependency
  const { generateSuggestions: patternGenerateSuggestions } = require('./oracle-patterns');
  patternGenerateSuggestions(state);
}