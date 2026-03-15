// @ts-nocheck
/**
 * 🪞 SAFLA Reflexion Loop - Self-Critique and Adaptive Learning
 * 
 * Implements SAFLA's reflexion mechanism for continuous self-improvement through
 * introspection and self-critique. The system analyzes its own performance,
 * identifies patterns of success and failure, and adapts its strategies accordingly.
 * 
 * Key Capabilities:
 * - Self-aware performance analysis
 * - Strategy effectiveness evaluation
 * - Adaptive behavior modification
 * - Mistake pattern recognition
 * - Continuous learning loops
 */

import { EventEmitter } from 'events';
import { MemoryTiers } from './memory-tiers';

// ═══════════════════════════════════════════════════════════════
// TYPES & INTERFACES
// ═══════════════════════════════════════════════════════════════

export interface SelfReflectionResult {
  id: string;
  timestamp: number;
  
  // Analysis results
  insights: string;
  strengths: string[];
  weaknesses: string[];
  patterns: string[];
  
  // Performance assessment
  currentPerformance: number; // 0-1
  performanceTrend: 'improving' | 'stable' | 'declining';
  confidenceLevel: number; // 0-1
  
  // Recommendations
  shouldAdapt: boolean;
  suggestedStrategy?: string;
  adaptationReason?: string;
  recommendedActions: string[];
  
  // Learning outcomes
  mistakesIdentified: string[];
  lessonsLearned: string[];
  knowledgeGaps: string[];
}

export interface ReflectionContext {
  recentInteractions: any[];
  currentStrategy: string;
  performanceHistory: number[];
  memoryState: any;
  environmentalFactors: Record<string, any>;
}

export interface PerformancePattern {
  pattern: string;
  frequency: number;
  successRate: number;
  contexts: string[];
  trend: 'improving' | 'stable' | 'declining';
  lastSeen: number;
}

export interface ReflexionConfig {
  reflectionInterval: number;
  memoryTiers: MemoryTiers;
  performanceWindow: number;
  adaptationThreshold: number;
  insightDepth: 'shallow' | 'deep' | 'comprehensive';
}

// ═══════════════════════════════════════════════════════════════
// REFLEXION ENGINE
// ═══════════════════════════════════════════════════════════════

export class ReflexionLoop extends EventEmitter {
  private config: ReflexionConfig;
  private memoryTiers: MemoryTiers;
  
  private isRunning: boolean = false;
  private reflectionInterval: NodeJS.Timeout | null = null;
  private reflectionHistory: SelfReflectionResult[] = [];
  private performancePatterns: Map<string, PerformancePattern> = new Map();
  
  // Performance tracking
  private performanceHistory: number[] = [];
  private currentStrategy: string = 'adaptive';
  private strategyHistory: Array<{ strategy: string; timestamp: number; performance: number }> = [];
  
  constructor(config: ReflexionConfig) {
    super();
    this.config = config;
    this.memoryTiers = config.memoryTiers;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // LIFECYCLE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════
  
  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('[🪞 Reflexion] Already running');
      return;
    }
    
    console.log('[🪞 Reflexion] Starting self-reflection loop...');
    console.log(`   Reflection interval: ${this.config.reflectionInterval}ms`);
    console.log(`   Insight depth: ${this.config.insightDepth}`);
    
    this.isRunning = true;
    
    // Start periodic reflection
    this.reflectionInterval = setInterval(async () => {
      await this.performReflection();
    }, this.config.reflectionInterval);
    
    this.emit('started');
  }
  
  async stop(): Promise<void> {
    if (!this.isRunning) {return;}
    
    console.log('[🪞 Reflexion] Stopping self-reflection loop...');
    
    if (this.reflectionInterval) {
      clearInterval(this.reflectionInterval);
    }
    
    this.isRunning = false;
    
    console.log('[🪞 Reflexion] Self-reflection stopped');
    this.emit('stopped');
  }
  
  // ═══════════════════════════════════════════════════════════════
  // CORE REFLECTION PROCESS
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * Main reflection entry point - analyzes a specific interaction or current state
   */
  async reflect(interaction?: any): Promise<SelfReflectionResult> {
    const reflectionId = `reflection-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    console.log('[🪞 Reflexion] Performing self-reflection...');
    
    try {
      // Gather reflection context
      const context = await this.gatherReflectionContext();
      
      // Analyze current performance
      const performanceAnalysis = await this.analyzePerformance(context);
      
      // Identify patterns and trends
      const patternAnalysis = await this.identifyPatterns(context);
      
      // Evaluate current strategy effectiveness
      const strategyAnalysis = await this.evaluateStrategy(context);
      
      // Generate insights and recommendations
      const insights = await this.generateInsights(context, performanceAnalysis, patternAnalysis, strategyAnalysis);
      
      // Determine if adaptation is needed
      const adaptationDecision = await this.shouldAdapt(performanceAnalysis, strategyAnalysis);
      
      const reflection: SelfReflectionResult = {
        id: reflectionId,
        timestamp: Date.now(),
        
        insights: insights.summary,
        strengths: insights.strengths,
        weaknesses: insights.weaknesses,
        patterns: patternAnalysis.patterns,
        
        currentPerformance: performanceAnalysis.currentScore,
        performanceTrend: performanceAnalysis.trend,
        confidenceLevel: performanceAnalysis.confidence,
        
        shouldAdapt: adaptationDecision.shouldAdapt,
        suggestedStrategy: adaptationDecision.suggestedStrategy,
        adaptationReason: adaptationDecision.reason,
        recommendedActions: adaptationDecision.actions,
        
        mistakesIdentified: insights.mistakes,
        lessonsLearned: insights.lessons,
        knowledgeGaps: insights.gaps
      };
      
      // Store reflection in memory
      await this.storeReflection(reflection, context);
      
      // Update internal state
      this.updateInternalState(reflection);
      
      this.emit('reflection', reflection);
      
      console.log('[🪞 Reflexion] Self-reflection completed');
      console.log(`   Performance: ${(reflection.currentPerformance * 100).toFixed(1)}% (${reflection.performanceTrend})`);
      console.log(`   Confidence: ${(reflection.confidenceLevel * 100).toFixed(1)}%`);
      console.log(`   Should adapt: ${reflection.shouldAdapt}`);
      
      return reflection;
      
    } catch (error: unknown) {
      console.error('[🪞 Reflexion] Reflection failed:', error);
      throw error;
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // CONTEXT GATHERING
  // ═══════════════════════════════════════════════════════════════
  
  private async gatherReflectionContext(): Promise<ReflectionContext> {
    // Get recent experiences from episodic memory
    const recentExperiences = await this.memoryTiers.episodic.getRecentExperiences(50);
    
    // Get current working memory state
    const workingMemoryState = await this.memoryTiers.working.getActiveContext();
    
    // Calculate recent performance window
    const windowSize = Math.min(this.config.performanceWindow, recentExperiences.length);
    const recentPerformance = recentExperiences
      .slice(-windowSize)
      .map(exp => exp.outcome === 'success' ? 1 : 0);
    
    return {
      recentInteractions: recentExperiences,
      currentStrategy: this.currentStrategy,
      performanceHistory: recentPerformance,
      memoryState: {
        working: workingMemoryState,
        episodicSize: this.memoryTiers.episodic.getSize(),
        semanticSize: this.memoryTiers.semantic.getSize(),
        vectorSize: this.memoryTiers.vector.getSize()
      },
      environmentalFactors: {
        timestamp: Date.now(),
        memoryPressure: this.calculateMemoryPressure(),
        recentActivity: recentExperiences.length
      }
    };
  }
  
  private calculateMemoryPressure(): number {
    // Simple memory pressure calculation based on tier utilization
    const metrics = this.memoryTiers.getOverallMetrics();
    const utilizationRatio = metrics.total.totalItems / 100000; // Assume max capacity
    return Math.min(1.0, utilizationRatio);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // PERFORMANCE ANALYSIS
  // ═══════════════════════════════════════════════════════════════
  
  private async analyzePerformance(context: ReflectionContext): Promise<{
    currentScore: number;
    trend: 'improving' | 'stable' | 'declining';
    confidence: number;
    factors: string[];
  }> {
    const recentPerformance = context.performanceHistory;
    
    if (recentPerformance.length === 0) {
      return {
        currentScore: 0.5,
        trend: 'stable',
        confidence: 0.1,
        factors: ['Insufficient data']
      };
    }
    
    // Calculate current performance score
    const currentScore = recentPerformance.reduce((sum, score) => sum + score, 0) / recentPerformance.length;
    
    // Calculate trend
    let trend: 'improving' | 'stable' | 'declining' = 'stable';
    if (recentPerformance.length >= 10) {
      const firstHalf = recentPerformance.slice(0, Math.floor(recentPerformance.length / 2));
      const secondHalf = recentPerformance.slice(Math.floor(recentPerformance.length / 2));
      
      const firstHalfAvg = firstHalf.reduce((sum, score) => sum + score, 0) / firstHalf.length;
      const secondHalfAvg = secondHalf.reduce((sum, score) => sum + score, 0) / secondHalf.length;
      
      const difference = secondHalfAvg - firstHalfAvg;
      if (difference > 0.1) {trend = 'improving';}
      else if (difference < -0.1) {trend = 'declining';}
    }
    
    // Calculate confidence based on consistency and sample size
    const variance = this.calculateVariance(recentPerformance);
    const consistency = Math.max(0, 1 - variance);
    const sampleConfidence = Math.min(1, recentPerformance.length / 20);
    const confidence = (consistency * 0.7) + (sampleConfidence * 0.3);
    
    // Identify performance factors
    const factors: string[] = [];
    if (currentScore > 0.8) {factors.push('High success rate');}
    if (currentScore < 0.3) {factors.push('Low success rate');}
    if (variance > 0.3) {factors.push('Inconsistent performance');}
    if (trend === 'improving') {factors.push('Performance improving');}
    if (trend === 'declining') {factors.push('Performance declining');}
    
    return { currentScore, trend, confidence, factors };
  }
  
  private calculateVariance(values: number[]): number {
    if (values.length < 2) {return 0;}
    
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDifferences = values.map(val => Math.pow(val - mean, 2));
    return squaredDifferences.reduce((sum, val) => sum + val, 0) / values.length;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // PATTERN IDENTIFICATION
  // ═══════════════════════════════════════════════════════════════
  
  private async identifyPatterns(context: ReflectionContext): Promise<{
    patterns: string[];
    strongPatterns: PerformancePattern[];
    emergingPatterns: PerformancePattern[];
  }> {
    const patterns: string[] = [];
    const strongPatterns: PerformancePattern[] = [];
    const emergingPatterns: PerformancePattern[] = [];
    
    // Analyze interaction patterns
    const interactions = context.recentInteractions;
    
    // Success/failure patterns by time of day
    const timePatterns = this.analyzeTemporalPatterns(interactions);
    patterns.push(...timePatterns);
    
    // Context patterns
    const contextPatterns = this.analyzeContextPatterns(interactions);
    patterns.push(...contextPatterns);
    
    // Strategy effectiveness patterns
    const strategyPatterns = this.analyzeStrategyPatterns(interactions);
    patterns.push(...strategyPatterns);
    
    // Update pattern database
    for (const pattern of patterns) {
      this.updatePatternDatabase(pattern, interactions);
    }
    
    // Categorize patterns by strength
    for (const [patternKey, patternData] of this.performancePatterns) {
      if (patternData.frequency >= 10 && patternData.successRate > 0.7) {
        strongPatterns.push(patternData);
      } else if (patternData.frequency >= 3 && Date.now() - patternData.lastSeen < 3600000) {
        emergingPatterns.push(patternData);
      }
    }
    
    return { patterns, strongPatterns, emergingPatterns };
  }
  
  private analyzeTemporalPatterns(interactions: any[]): string[] {
    const patterns: string[] = [];
    const hourlyStats = new Map<number, { success: number; total: number }>();
    
    for (const interaction of interactions) {
      const hour = new Date(interaction.timestamp).getHours();
      const stats = hourlyStats.get(hour) || { success: 0, total: 0 };
      
      stats.total++;
      if (interaction.outcome === 'success') {stats.success++;}
      
      hourlyStats.set(hour, stats);
    }
    
    // Find hours with notably high/low performance
    for (const [hour, stats] of hourlyStats) {
      if (stats.total >= 3) {
        const successRate = stats.success / stats.total;
        if (successRate > 0.8) {
          patterns.push(`High performance at hour ${hour} (${(successRate * 100).toFixed(0)}%)`);
        } else if (successRate < 0.3) {
          patterns.push(`Low performance at hour ${hour} (${(successRate * 100).toFixed(0)}%)`);
        }
      }
    }
    
    return patterns;
  }
  
  private analyzeContextPatterns(interactions: any[]): string[] {
    const patterns: string[] = [];
    const contextStats = new Map<string, { success: number; total: number }>();
    
    for (const interaction of interactions) {
      const contextKeys = Object.keys(interaction.context || {});
      
      for (const key of contextKeys) {
        const stats = contextStats.get(key) || { success: 0, total: 0 };
        stats.total++;
        if (interaction.outcome === 'success') {stats.success++;}
        contextStats.set(key, stats);
      }
    }
    
    // Find contexts with strong correlation to success/failure
    for (const [context, stats] of contextStats) {
      if (stats.total >= 5) {
        const successRate = stats.success / stats.total;
        if (successRate > 0.8) {
          patterns.push(`Context '${context}' correlates with success (${(successRate * 100).toFixed(0)}%)`);
        } else if (successRate < 0.2) {
          patterns.push(`Context '${context}' correlates with failure (${(successRate * 100).toFixed(0)}%)`);
        }
      }
    }
    
    return patterns;
  }
  
  private analyzeStrategyPatterns(interactions: any[]): string[] {
    const patterns: string[] = [];
    const strategyStats = new Map<string, { success: number; total: number }>();
    
    for (const interaction of interactions) {
      const strategy = interaction.context?.strategy || 'unknown';
      const stats = strategyStats.get(strategy) || { success: 0, total: 0 };
      
      stats.total++;
      if (interaction.outcome === 'success') {stats.success++;}
      
      strategyStats.set(strategy, stats);
    }
    
    // Find strategy effectiveness patterns
    for (const [strategy, stats] of strategyStats) {
      if (stats.total >= 3) {
        const successRate = stats.success / stats.total;
        if (successRate > 0.8) {
          patterns.push(`Strategy '${strategy}' is highly effective (${(successRate * 100).toFixed(0)}%)`);
        } else if (successRate < 0.3) {
          patterns.push(`Strategy '${strategy}' is ineffective (${(successRate * 100).toFixed(0)}%)`);
        }
      }
    }
    
    return patterns;
  }
  
  private updatePatternDatabase(pattern: string, interactions: any[]): void {
    const existing = this.performancePatterns.get(pattern);
    const now = Date.now();
    
    if (existing) {
      existing.frequency++;
      existing.lastSeen = now;
      // Update trend based on recent performance
    } else {
      this.performancePatterns.set(pattern, {
        pattern,
        frequency: 1,
        successRate: 0.5, // Default until we have more data
        contexts: [],
        trend: 'stable',
        lastSeen: now
      });
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // STRATEGY EVALUATION
  // ═══════════════════════════════════════════════════════════════
  
  private async evaluateStrategy(context: ReflectionContext): Promise<{
    currentEffectiveness: number;
    alternativeStrategies: Array<{ strategy: string; expectedEffectiveness: number }>;
    shouldChange: boolean;
    confidence: number;
  }> {
    const currentStrategy = context.currentStrategy;
    const recentPerformance = context.performanceHistory;
    
    // Calculate current strategy effectiveness
    const currentEffectiveness = recentPerformance.length > 0 ? 
      recentPerformance.reduce((sum, score) => sum + score, 0) / recentPerformance.length : 0.5;
    
    // Analyze historical strategy performance
    const strategyPerformance = this.analyzeStrategyHistory();
    
    // Generate alternative strategies with expected effectiveness
    const alternativeStrategies = this.generateAlternativeStrategies(strategyPerformance, context);
    
    // Determine if strategy change is recommended
    const bestAlternative = alternativeStrategies[0];
    const shouldChange = bestAlternative && 
      bestAlternative.expectedEffectiveness > currentEffectiveness + 0.1 && // 10% improvement threshold
      currentEffectiveness < 0.7; // Only change if current performance is below 70%
    
    // Calculate confidence based on data quality
    const confidence = Math.min(1.0, recentPerformance.length / 20);
    
    return {
      currentEffectiveness,
      alternativeStrategies,
      shouldChange,
      confidence
    };
  }
  
  private analyzeStrategyHistory(): Map<string, number> {
    const strategyPerformance = new Map<string, number>();
    
    for (const entry of this.strategyHistory) {
      const existing = strategyPerformance.get(entry.strategy) || 0;
      strategyPerformance.set(entry.strategy, Math.max(existing, entry.performance));
    }
    
    return strategyPerformance;
  }
  
  private generateAlternativeStrategies(
    historyPerformance: Map<string, number>,
    context: ReflectionContext
  ): Array<{ strategy: string; expectedEffectiveness: number }> {
    const alternatives = [
      { strategy: 'analytical', baseEffectiveness: 0.7 },
      { strategy: 'creative', baseEffectiveness: 0.6 },
      { strategy: 'systematic', baseEffectiveness: 0.75 },
      { strategy: 'intuitive', baseEffectiveness: 0.65 },
      { strategy: 'collaborative', baseEffectiveness: 0.7 },
      { strategy: 'reflexive', baseEffectiveness: 0.8 }
    ].filter(alt => alt.strategy !== context.currentStrategy);
    
    return alternatives.map(alt => ({
      strategy: alt.strategy,
      expectedEffectiveness: Math.min(1.0, 
        alt.baseEffectiveness * 
        (historyPerformance.get(alt.strategy) || 0.5) * 
        1.2 // Optimism bias for untested strategies
      )
    })).toSorted((a, b) => b.expectedEffectiveness - a.expectedEffectiveness);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // INSIGHT GENERATION
  // ═══════════════════════════════════════════════════════════════
  
  private async generateInsights(
    context: ReflectionContext,
    performance: any,
    patterns: any,
    strategy: any
  ): Promise<{
    summary: string;
    strengths: string[];
    weaknesses: string[];
    mistakes: string[];
    lessons: string[];
    gaps: string[];
  }> {
    const insights = {
      summary: '',
      strengths: [] as string[],
      weaknesses: [] as string[],
      mistakes: [] as string[],
      lessons: [] as string[],
      gaps: [] as string[]
    };
    
    // Generate performance summary
    insights.summary = `Current performance: ${(performance.currentScore * 100).toFixed(1)}% (${performance.trend}). ` +
      `Strategy '${context.currentStrategy}' with ${(strategy.confidence * 100).toFixed(0)}% confidence. ` +
      `${patterns.patterns.length} patterns identified.`;
    
    // Identify strengths
    if (performance.currentScore > 0.7) {
      insights.strengths.push('Consistent high performance');
    }
    if (performance.trend === 'improving') {
      insights.strengths.push('Performance is improving over time');
    }
    if (patterns.strongPatterns.length > 0) {
      insights.strengths.push(`Strong performance patterns: ${patterns.strongPatterns.length}`);
    }
    
    // Identify weaknesses
    if (performance.currentScore < 0.5) {
      insights.weaknesses.push('Below-average performance');
    }
    if (performance.trend === 'declining') {
      insights.weaknesses.push('Performance is declining');
    }
    if (performance.confidence < 0.3) {
      insights.weaknesses.push('Low confidence in current assessment');
    }
    
    // Identify mistakes from recent failures
    const recentFailures = context.recentInteractions
      .filter(int => int.outcome === 'failure')
      .slice(-5);
    
    for (const failure of recentFailures) {
      if (failure.context?.error) {
        insights.mistakes.push(`Strategy '${failure.context.strategy}' failed: ${failure.context.error}`);
      }
    }
    
    // Extract lessons learned
    for (const pattern of patterns.strongPatterns) {
      insights.lessons.push(`Pattern '${pattern.pattern}' reliably produces good results`);
    }
    
    if (strategy.shouldChange) {
      insights.lessons.push(`Current strategy may need adjustment - alternatives available`);
    }
    
    // Identify knowledge gaps
    if (context.memoryState.semanticSize < 100) {
      insights.gaps.push('Limited semantic knowledge base');
    }
    
    if (patterns.patterns.length < 3) {
      insights.gaps.push('Insufficient pattern recognition');
    }
    
    if (this.reflectionHistory.length < 5) {
      insights.gaps.push('Limited self-reflection history');
    }
    
    return insights;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // ADAPTATION DECISION
  // ═══════════════════════════════════════════════════════════════
  
  private async shouldAdapt(performance: any, strategy: any): Promise<{
    shouldAdapt: boolean;
    suggestedStrategy?: string;
    reason?: string;
    actions: string[];
  }> {
    const actions: string[] = [];
    let shouldAdapt = false;
    let suggestedStrategy: string | undefined;
    let reason: string | undefined;
    
    // Adapt if performance is consistently poor
    if (performance.currentScore < 0.3 && performance.confidence > 0.5) {
      shouldAdapt = true;
      reason = 'Performance consistently below threshold';
      suggestedStrategy = strategy.alternativeStrategies[0]?.strategy;
      actions.push('Change primary strategy');
    }
    
    // Adapt if performance is declining
    if (performance.trend === 'declining' && performance.currentScore < 0.6) {
      shouldAdapt = true;
      reason = 'Performance declining - intervention needed';
      actions.push('Analyze failure patterns');
      actions.push('Implement corrective measures');
    }
    
    // Adapt if strategy evaluation suggests change
    if (strategy.shouldChange) {
      shouldAdapt = true;
      suggestedStrategy = strategy.alternativeStrategies[0]?.strategy;
      reason = `Alternative strategy '${suggestedStrategy}' shows higher expected effectiveness`;
      actions.push(`Switch to '${suggestedStrategy}' strategy`);
    }
    
    // Always suggest learning actions
    actions.push('Continue pattern analysis');
    actions.push('Update performance baselines');
    
    return { shouldAdapt, suggestedStrategy, reason, actions };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // MEMORY & STATE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════
  
  private async storeReflection(reflection: SelfReflectionResult, context: ReflectionContext): Promise<void> {
    // Store in episodic memory as a meta-experience
    await this.memoryTiers.episodic.storeExperience({
      id: `reflection-${reflection.id}`,
      timestamp: reflection.timestamp,
      input: { type: 'self-reflection', context },
      output: reflection,
      context: {
        type: 'meta-cognitive',
        strategy: context.currentStrategy,
        performance: reflection.currentPerformance
      },
      content: reflection,
      metadata: { type: 'reflection', depth: this.config.insightDepth },
      outcome: reflection.shouldAdapt ? 'partial' : 'success'
    });
    
    // Store key insights in semantic memory
    if (reflection.lessonsLearned.length > 0) {
      await this.memoryTiers.semantic.storeConcept({
        id: `lesson-${reflection.id}`,
        timestamp: reflection.timestamp,
        content: reflection.lessonsLearned,
        type: 'lesson',
        attributes: {
          performance: reflection.currentPerformance,
          confidence: reflection.confidenceLevel,
          strategy: context.currentStrategy
        }
      });
    }
    
    // Keep reflection history
    this.reflectionHistory.push(reflection);
    if (this.reflectionHistory.length > 100) {
      this.reflectionHistory = this.reflectionHistory.slice(-100);
    }
  }
  
  private updateInternalState(reflection: SelfReflectionResult): void {
    // Update performance history
    this.performanceHistory.push(reflection.currentPerformance);
    if (this.performanceHistory.length > 1000) {
      this.performanceHistory = this.performanceHistory.slice(-1000);
    }
    
    // Update strategy if adaptation is recommended
    if (reflection.shouldAdapt && reflection.suggestedStrategy) {
      this.strategyHistory.push({
        strategy: this.currentStrategy,
        timestamp: Date.now(),
        performance: reflection.currentPerformance
      });
      
      this.currentStrategy = reflection.suggestedStrategy;
    }
  }
  
  private async performReflection(): Promise<void> {
    try {
      const reflection = await this.reflect();
      console.log(`[🪞 Reflexion] Periodic reflection completed - Performance: ${(reflection.currentPerformance * 100).toFixed(1)}%`);
    } catch (error: unknown) {
      console.error('[🪞 Reflexion] Periodic reflection failed:', error);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════
  
  getReflectionHistory(): SelfReflectionResult[] {
    return [...this.reflectionHistory];
  }
  
  getPerformancePatterns(): PerformancePattern[] {
    return Array.from(this.performancePatterns.values());
  }
  
  getCurrentStrategy(): string {
    return this.currentStrategy;
  }
  
  getPerformanceHistory(): number[] {
    return [...this.performanceHistory];
  }
  
  /**
   * Manual trigger for immediate reflection
   */
  async triggerReflection(reason?: string): Promise<SelfReflectionResult> {
    console.log(`[🪞 Reflexion] Manual reflection triggered${reason ? `: ${reason}` : ''}`);
    return this.reflect();
  }
  
  /**
   * Get current self-awareness metrics
   */
  getSelfAwarenessMetrics(): {
    reflectionCount: number;
    patternCount: number;
    averagePerformance: number;
    adaptationRate: number;
    insightDepth: string;
  } {
    const totalPerformance = this.performanceHistory.reduce((sum, p) => sum + p, 0);
    const averagePerformance = this.performanceHistory.length > 0 ? 
      totalPerformance / this.performanceHistory.length : 0;
    
    const adaptations = this.reflectionHistory.filter(r => r.shouldAdapt).length;
    const adaptationRate = this.reflectionHistory.length > 0 ? 
      adaptations / this.reflectionHistory.length : 0;
    
    return {
      reflectionCount: this.reflectionHistory.length,
      patternCount: this.performancePatterns.size,
      averagePerformance,
      adaptationRate,
      insightDepth: this.config.insightDepth
    };
  }
}