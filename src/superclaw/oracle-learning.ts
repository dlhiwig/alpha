// @ts-nocheck
/**
 * Alpha ORACLE Learning System - Core Learning Engine
 *
 * Port of SuperClaw's ORACLE system adapted for Alpha's architecture.
 * Enables self-learning that makes Alpha smarter with every task.
 */

import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { resolveSecureStatePath } from "./secure-state.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { getSharedMemory } from "./shared-memory.js";

const log = createSubsystemLogger("oracle-learning");

// ═══════════════════════════════════════════════════════════════════
// TYPES & INTERFACES
// ═══════════════════════════════════════════════════════════════════

export interface InteractionRecord {
  id: string;
  timestamp: number;
  provider: string; // claude, gemini, etc
  taskType: string; // code, research, analysis, etc
  prompt: string; // what was asked (hash for privacy)
  success: boolean; // did it work?
  latencyMs: number; // how long
  cost?: number; // estimated cost
  userFeedback?: "positive" | "negative";
  responseLength?: number;
  tags: string[];
}

export interface MistakePattern {
  pattern: string; // what went wrong
  rootCause: string; // why
  correction: string; // how to fix
  severity: "low" | "medium" | "high";
  frequency: number;
  lastSeen: number;
  confidence: number;
  successfulCorrections: number;
  preventionPrompt: string;
  contexts: string[];
  tags: string[];
}

export interface RecommendationResult {
  bestProvider: string;
  confidence: number;
  avoidPatterns: string[]; // known mistakes to watch for
  tips: string[]; // lessons learned
  estimatedCost?: number;
  estimatedLatency?: number;
  reasoning: string;
}

export interface ReflectionResult {
  performanceTrend: "improving" | "stable" | "declining";
  topInsights: string[];
  suggestedOptimizations: string[];
  mistakesPrevented: number;
  totalInteractions: number;
  successRate: number;
  avgLatency: number;
  avgCost: number;
  timestamp: number;
}

export interface OracleStats {
  totalInteractions: number;
  patternsLearned: number;
  mistakePatternsLearned: number;
  successRate: number;
  avgLatency: number;
  avgCost: number;
  reflectionsPerformed: number;
  mistakesPrevented: number;
  optimizationsApplied: number;
  costSaved: number;
  startedAt: number;
  lastReflection?: number;
}

export interface OracleState {
  startedAt: number;
  totalInteractions: number;
  reflectionsPerformed: number;
  recentInteractions: InteractionRecord[];
  mistakePatterns: Map<string, MistakePattern>;
  providerPerformance: Map<
    string,
    {
      totalRequests: number;
      successCount: number;
      failureCount: number;
      avgLatency: number;
      avgCost: number;
      bestFor: string[];
    }
  >;
  taskTypePerformance: Map<
    string,
    {
      totalAttempts: number;
      successCount: number;
      bestProvider: string;
      avgLatency: number;
      avgCost: number;
    }
  >;
  optimizationsApplied: number;
  costSaved: number;
  mistakesPrevented: number;
  lastReflection?: number;
}

// ═══════════════════════════════════════════════════════════════════
// ORACLE LEARNING ENGINE
// ═══════════════════════════════════════════════════════════════════

export class OracleLearning {
  private state: OracleState;
  private stateFile: string;
  private sharedMemory: any;
  private isInitialized: boolean = false;
  private reflectionCounter: number = 0;

  constructor() {
    this.stateFile = resolveSecureStatePath("data", "oracle-state.json");
    this.state = this.getInitialState();
  }

  private getInitialState(): OracleState {
    return {
      startedAt: Date.now(),
      totalInteractions: 0,
      reflectionsPerformed: 0,
      recentInteractions: [],
      mistakePatterns: new Map(),
      providerPerformance: new Map(),
      taskTypePerformance: new Map(),
      optimizationsApplied: 0,
      costSaved: 0,
      mistakesPrevented: 0,
    };
  }

  /**
   * Initialize the ORACLE learning system
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      // Initialize shared memory
      this.sharedMemory = await getSharedMemory();

      // Load saved state
      await this.loadState();

      this.isInitialized = true;
      log.info(
        `Oracle Learning initialized with ${this.state.totalInteractions} past interactions`,
      );

      // Store initialization in shared memory
      await this.storeInSharedMemory(
        "Oracle Learning system initialized",
        "observation",
        ["oracle", "initialization"],
        0.8,
      );
    } catch (error) {
      log.error("Failed to initialize Oracle Learning:", error);
      throw error;
    }
  }

  /**
   * Record every interaction (agent task, swarm run, user query)
   */
  async recordInteraction(record: {
    provider: string;
    taskType: string;
    prompt: string;
    success: boolean;
    latencyMs: number;
    cost?: number;
    userFeedback?: "positive" | "negative";
    responseLength?: number;
  }): Promise<string> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const id = crypto.randomUUID();
    const interaction: InteractionRecord = {
      id,
      timestamp: Date.now(),
      provider: record.provider,
      taskType: record.taskType,
      prompt: this.hashPrompt(record.prompt), // Hash for privacy
      success: record.success,
      latencyMs: record.latencyMs,
      cost: record.cost,
      userFeedback: record.userFeedback,
      responseLength: record.responseLength,
      tags: this.extractTags(record.prompt, record.taskType),
    };

    // Store recent interactions (keep last 1000)
    this.state.recentInteractions.push(interaction);
    if (this.state.recentInteractions.length > 1000) {
      this.state.recentInteractions = this.state.recentInteractions.slice(-1000);
    }

    this.state.totalInteractions++;

    // Update provider performance
    this.updateProviderPerformance(interaction);

    // Update task type performance
    this.updateTaskTypePerformance(interaction);

    // Check for periodic reflection (every 10 interactions)
    this.reflectionCounter++;
    if (this.reflectionCounter >= 10) {
      this.reflectionCounter = 0;
      await this.performReflection();
    }

    // Auto-save state every 100 interactions
    if (this.state.totalInteractions % 100 === 0) {
      await this.saveState();
    }

    log.debug(
      `Recorded interaction: ${record.provider} ${record.taskType} ${record.success ? "✓" : "✗"}`,
    );
    return id;
  }

  /**
   * Learn from mistakes
   */
  async learnFromMistake(mistake: {
    pattern: string;
    rootCause: string;
    correction: string;
    severity: "low" | "medium" | "high";
    contexts?: string[];
    tags?: string[];
  }): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const hash = crypto.createHash("md5").update(mistake.pattern).digest("hex").slice(0, 12);

    let mistakePattern = this.state.mistakePatterns.get(hash);

    if (!mistakePattern) {
      mistakePattern = {
        pattern: mistake.pattern,
        rootCause: mistake.rootCause,
        correction: mistake.correction,
        severity: mistake.severity,
        frequency: 0,
        lastSeen: Date.now(),
        confidence: 0.7,
        successfulCorrections: 0,
        preventionPrompt: this.generatePreventionPrompt(mistake),
        contexts: mistake.contexts || [],
        tags: mistake.tags || [],
      };
    }

    mistakePattern.frequency++;
    mistakePattern.lastSeen = Date.now();
    mistakePattern.confidence = Math.min(0.95, mistakePattern.confidence + 0.05);

    this.state.mistakePatterns.set(hash, mistakePattern);

    // Store significant mistake in shared memory
    if (mistake.severity === "high" || mistakePattern.frequency >= 3) {
      await this.storeInSharedMemory(
        `Mistake pattern learned: ${mistake.pattern}. Prevention: ${mistake.correction}`,
        "lesson",
        ["oracle", "mistake", mistake.severity, ...mistakePattern.tags],
        mistake.severity === "high" ? 0.9 : 0.7,
      );
    }

    await this.saveState();
    log.info(
      `Learned mistake pattern: ${mistake.pattern} (frequency: ${mistakePattern.frequency})`,
    );
  }

  /**
   * Get recommendations for a new task
   */
  async getRecommendation(taskType: string): Promise<RecommendationResult> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    // Get performance data for this task type
    const taskPerf = this.state.taskTypePerformance.get(taskType);
    const allProviders = Array.from(this.state.providerPerformance.entries());

    if (!taskPerf && allProviders.length === 0) {
      // No historical data, return default recommendation
      return {
        bestProvider: "claude", // Default fallback
        confidence: 0.3,
        avoidPatterns: [],
        tips: ["No historical data available for this task type"],
        reasoning: "Default recommendation due to lack of historical data",
      };
    }

    // Find best provider based on success rate and performance
    let bestProvider = "claude";
    let bestScore = 0;
    let estimatedCost = 0;
    let estimatedLatency = 0;

    for (const [provider, performance] of allProviders) {
      const successRate = performance.successCount / performance.totalRequests;
      const costFactor = 1 / (performance.avgCost + 0.001); // Favor lower cost
      const latencyFactor = 1 / (performance.avgLatency + 1); // Favor lower latency

      const score = successRate * 0.6 + costFactor * 0.2 + latencyFactor * 0.2;

      if (score > bestScore) {
        bestScore = score;
        bestProvider = provider;
        estimatedCost = performance.avgCost;
        estimatedLatency = performance.avgLatency;
      }
    }

    // Get relevant mistake patterns to avoid
    const avoidPatterns = this.getRelevantMistakePatterns(taskType);

    // Get tips from successful patterns
    const tips = this.generateTips(taskType);

    const confidence = Math.min(0.9, bestScore * (this.state.totalInteractions / 100));

    return {
      bestProvider,
      confidence,
      avoidPatterns,
      tips,
      estimatedCost,
      estimatedLatency,
      reasoning: `Based on ${this.state.totalInteractions} interactions. ${bestProvider} has best performance for ${taskType} tasks.`,
    };
  }

  /**
   * Self-reflection: analyze recent performance
   */
  async reflect(): Promise<ReflectionResult> {
    return await this.performReflection();
  }

  /**
   * Get statistics
   */
  getStats(): OracleStats {
    const recentInteractions = this.state.recentInteractions.slice(-100);
    const successCount = recentInteractions.filter((i) => i.success).length;
    const successRate =
      recentInteractions.length > 0 ? successCount / recentInteractions.length : 0;

    const avgLatency =
      recentInteractions.length > 0
        ? recentInteractions.reduce((sum, i) => sum + i.latencyMs, 0) / recentInteractions.length
        : 0;

    const avgCost =
      recentInteractions.length > 0
        ? recentInteractions.reduce((sum, i) => sum + (i.cost || 0), 0) / recentInteractions.length
        : 0;

    return {
      totalInteractions: this.state.totalInteractions,
      patternsLearned: this.state.providerPerformance.size + this.state.taskTypePerformance.size,
      mistakePatternsLearned: this.state.mistakePatterns.size,
      successRate,
      avgLatency,
      avgCost,
      reflectionsPerformed: this.state.reflectionsPerformed,
      mistakesPrevented: this.state.mistakesPrevented,
      optimizationsApplied: this.state.optimizationsApplied,
      costSaved: this.state.costSaved,
      startedAt: this.state.startedAt,
      lastReflection: this.state.lastReflection,
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // PRIVATE HELPER METHODS
  // ═══════════════════════════════════════════════════════════════════

  private async performReflection(): Promise<ReflectionResult> {
    const now = Date.now();
    const recentInteractions = this.state.recentInteractions.slice(-50);

    if (recentInteractions.length < 5) {
      // Not enough data for meaningful reflection
      return {
        performanceTrend: "stable",
        topInsights: ["Insufficient data for reflection"],
        suggestedOptimizations: [],
        mistakesPrevented: this.state.mistakesPrevented,
        totalInteractions: this.state.totalInteractions,
        successRate: 0,
        avgLatency: 0,
        avgCost: 0,
        timestamp: now,
      };
    }

    // Analyze performance trend
    const halfwayPoint = Math.floor(recentInteractions.length / 2);
    const firstHalf = recentInteractions.slice(0, halfwayPoint);
    const secondHalf = recentInteractions.slice(halfwayPoint);

    const firstHalfSuccess = firstHalf.filter((i) => i.success).length / firstHalf.length;
    const secondHalfSuccess = secondHalf.filter((i) => i.success).length / secondHalf.length;

    let performanceTrend: "improving" | "stable" | "declining" = "stable";
    if (secondHalfSuccess > firstHalfSuccess + 0.1) {
      performanceTrend = "improving";
    } else if (secondHalfSuccess < firstHalfSuccess - 0.1) {
      performanceTrend = "declining";
    }

    // Generate insights
    const insights = this.generateInsights(recentInteractions, performanceTrend);

    // Generate optimization suggestions
    const optimizations = this.generateOptimizations(recentInteractions);

    const successRate =
      recentInteractions.filter((i) => i.success).length / recentInteractions.length;
    const avgLatency =
      recentInteractions.reduce((sum, i) => sum + i.latencyMs, 0) / recentInteractions.length;
    const avgCost =
      recentInteractions.reduce((sum, i) => sum + (i.cost || 0), 0) / recentInteractions.length;

    const result: ReflectionResult = {
      performanceTrend,
      topInsights: insights,
      suggestedOptimizations: optimizations,
      mistakesPrevented: this.state.mistakesPrevented,
      totalInteractions: this.state.totalInteractions,
      successRate,
      avgLatency,
      avgCost,
      timestamp: now,
    };

    this.state.reflectionsPerformed++;
    this.state.lastReflection = now;

    // Store reflection in shared memory
    await this.storeInSharedMemory(
      `Oracle reflection: ${performanceTrend} performance trend. Success rate: ${(successRate * 100).toFixed(1)}%. ${insights[0] || "No specific insights"}`,
      "observation",
      ["oracle", "reflection", performanceTrend],
      0.8,
    );

    await this.saveState();
    log.info(
      `Oracle reflection completed: ${performanceTrend} trend, ${(successRate * 100).toFixed(1)}% success rate`,
    );

    return result;
  }

  private generateInsights(interactions: InteractionRecord[], trend: string): string[] {
    const insights: string[] = [];

    // Provider performance insights
    const providerStats = new Map<string, { success: number; total: number }>();
    for (const interaction of interactions) {
      const stats = providerStats.get(interaction.provider) || { success: 0, total: 0 };
      stats.total++;
      if (interaction.success) {
        stats.success++;
      }
      providerStats.set(interaction.provider, stats);
    }

    let bestProvider = "";
    let bestRate = 0;
    for (const [provider, stats] of providerStats) {
      const rate = stats.success / stats.total;
      if (rate > bestRate) {
        bestRate = rate;
        bestProvider = provider;
      }
    }

    if (bestProvider) {
      insights.push(
        `${bestProvider} provider has best recent success rate: ${(bestRate * 100).toFixed(1)}%`,
      );
    }

    // Task type insights
    const taskStats = new Map<string, { success: number; total: number }>();
    for (const interaction of interactions) {
      const stats = taskStats.get(interaction.taskType) || { success: 0, total: 0 };
      stats.total++;
      if (interaction.success) {
        stats.success++;
      }
      taskStats.set(interaction.taskType, stats);
    }

    const worstTask = Array.from(taskStats.entries()).toSorted(
      (a, b) => a[1].success / a[1].total - b[1].success / b[1].total,
    )[0];

    if (worstTask && worstTask[1].success / worstTask[1].total < 0.7) {
      insights.push(
        `${worstTask[0]} tasks need improvement: ${((worstTask[1].success / worstTask[1].total) * 100).toFixed(1)}% success rate`,
      );
    }

    // Trend insights
    if (trend === "improving") {
      insights.push("Performance is improving - current strategies are effective");
    } else if (trend === "declining") {
      insights.push("Performance is declining - may need strategy adjustment");
    }

    return insights.slice(0, 3); // Top 3 insights
  }

  private generateOptimizations(interactions: InteractionRecord[]): string[] {
    const optimizations: string[] = [];

    // High latency optimization
    const highLatencyInteractions = interactions.filter((i) => i.latencyMs > 10000);
    if (highLatencyInteractions.length > interactions.length * 0.3) {
      optimizations.push(
        "Consider using faster providers or smaller models for time-sensitive tasks",
      );
    }

    // Cost optimization
    const avgCost = interactions.reduce((sum, i) => sum + (i.cost || 0), 0) / interactions.length;
    if (avgCost > 0.01) {
      // More than 1 cent per interaction
      optimizations.push("Consider using more cost-effective providers for routine tasks");
    }

    // Failure pattern optimization
    const failures = interactions.filter((i) => !i.success);
    if (failures.length > interactions.length * 0.2) {
      const commonFailureType = this.getMostCommonTaskType(failures);
      if (commonFailureType) {
        optimizations.push(`Focus on improving ${commonFailureType} task handling`);
      }
    }

    return optimizations.slice(0, 3); // Top 3 optimizations
  }

  private getMostCommonTaskType(interactions: InteractionRecord[]): string | null {
    const counts = new Map<string, number>();
    for (const interaction of interactions) {
      counts.set(interaction.taskType, (counts.get(interaction.taskType) || 0) + 1);
    }

    let maxCount = 0;
    let mostCommon = null;
    for (const [taskType, count] of counts) {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = taskType;
      }
    }

    return mostCommon;
  }

  private updateProviderPerformance(interaction: InteractionRecord): void {
    let performance = this.state.providerPerformance.get(interaction.provider);

    if (!performance) {
      performance = {
        totalRequests: 0,
        successCount: 0,
        failureCount: 0,
        avgLatency: 0,
        avgCost: 0,
        bestFor: [],
      };
    }

    performance.totalRequests++;
    if (interaction.success) {
      performance.successCount++;
    } else {
      performance.failureCount++;
    }

    // Update running averages
    performance.avgLatency =
      (performance.avgLatency * (performance.totalRequests - 1) + interaction.latencyMs) /
      performance.totalRequests;
    performance.avgCost =
      (performance.avgCost * (performance.totalRequests - 1) + (interaction.cost || 0)) /
      performance.totalRequests;

    // Update best-for list
    if (interaction.success && !performance.bestFor.includes(interaction.taskType)) {
      performance.bestFor.push(interaction.taskType);
    }

    this.state.providerPerformance.set(interaction.provider, performance);
  }

  private updateTaskTypePerformance(interaction: InteractionRecord): void {
    let performance = this.state.taskTypePerformance.get(interaction.taskType);

    if (!performance) {
      performance = {
        totalAttempts: 0,
        successCount: 0,
        bestProvider: interaction.provider,
        avgLatency: 0,
        avgCost: 0,
      };
    }

    performance.totalAttempts++;
    if (interaction.success) {
      performance.successCount++;

      // Update best provider if this one is performing better
      const currentSuccessRate = performance.successCount / performance.totalAttempts;
      const thisProviderPerf = this.state.providerPerformance.get(interaction.provider);
      if (thisProviderPerf) {
        const providerSuccessRate = thisProviderPerf.successCount / thisProviderPerf.totalRequests;
        if (providerSuccessRate > currentSuccessRate) {
          performance.bestProvider = interaction.provider;
        }
      }
    }

    // Update running averages
    performance.avgLatency =
      (performance.avgLatency * (performance.totalAttempts - 1) + interaction.latencyMs) /
      performance.totalAttempts;
    performance.avgCost =
      (performance.avgCost * (performance.totalAttempts - 1) + (interaction.cost || 0)) /
      performance.totalAttempts;

    this.state.taskTypePerformance.set(interaction.taskType, performance);
  }

  private getRelevantMistakePatterns(taskType: string): string[] {
    const patterns: string[] = [];

    for (const [_, mistake] of this.state.mistakePatterns) {
      if (
        mistake.confidence > 0.7 &&
        (mistake.tags.includes(taskType) || mistake.contexts.includes(taskType))
      ) {
        patterns.push(mistake.preventionPrompt);
      }
    }

    return patterns.slice(0, 5); // Top 5 most relevant patterns
  }

  private generateTips(taskType: string): string[] {
    const tips: string[] = [];
    const taskPerf = this.state.taskTypePerformance.get(taskType);

    if (taskPerf) {
      tips.push(`Best provider for ${taskType}: ${taskPerf.bestProvider}`);
      tips.push(`Average latency: ${Math.round(taskPerf.avgLatency)}ms`);
      tips.push(
        `Success rate: ${((taskPerf.successCount / taskPerf.totalAttempts) * 100).toFixed(1)}%`,
      );
    }

    return tips;
  }

  private generatePreventionPrompt(mistake: { pattern: string; correction: string }): string {
    return `AVOID: ${mistake.pattern}. Instead: ${mistake.correction}`;
  }

  private hashPrompt(prompt: string): string {
    const normalized = prompt.toLowerCase().trim().replace(/\s+/g, " ");
    return crypto.createHash("md5").update(normalized).digest("hex").slice(0, 12);
  }

  private extractTags(prompt: string, taskType: string): string[] {
    const tags = [taskType];

    // Detect common patterns
    if (/\b(code|function|implement|class|api)\b/i.test(prompt)) {
      tags.push("coding");
    }
    if (/\b(explain|what is|how does|why)\b/i.test(prompt)) {
      tags.push("explanation");
    }
    if (/\b(write|create|generate|draft)\b/i.test(prompt)) {
      tags.push("generation");
    }
    if (/\b(fix|debug|error|bug)\b/i.test(prompt)) {
      tags.push("debugging");
    }
    if (/\b(summarize|summary|tldr)\b/i.test(prompt)) {
      tags.push("summarization");
    }

    return [...new Set(tags)]; // Remove duplicates
  }

  private async storeInSharedMemory(
    content: string,
    type: "fact" | "decision" | "lesson" | "task" | "observation",
    tags: string[],
    importance: number,
  ): Promise<void> {
    if (!this.sharedMemory) {
      return;
    }

    try {
      await this.sharedMemory.store({
        agentId: "oracle-learning",
        content,
        type,
        tags,
        importance,
        source: "oracle-learning",
      });
    } catch (error) {
      log.warn("Failed to store in shared memory:", error);
    }
  }

  private async loadState(): Promise<void> {
    try {
      const data = await fs.readFile(this.stateFile, "utf8");
      const saved = JSON.parse(data);

      this.state = {
        ...this.state,
        ...saved,
        mistakePatterns: new Map(Object.entries(saved.mistakePatterns || {})),
        providerPerformance: new Map(Object.entries(saved.providerPerformance || {})),
        taskTypePerformance: new Map(Object.entries(saved.taskTypePerformance || {})),
      };

      log.info(
        `Loaded Oracle state: ${this.state.totalInteractions} interactions, ${this.state.mistakePatterns.size} mistake patterns`,
      );
    } catch {
      // Fresh start - no previous state
      log.info("Starting Oracle with fresh state");
    }
  }

  private async saveState(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.stateFile), { recursive: true });

      const toSave = {
        ...this.state,
        mistakePatterns: Object.fromEntries(this.state.mistakePatterns),
        providerPerformance: Object.fromEntries(this.state.providerPerformance),
        taskTypePerformance: Object.fromEntries(this.state.taskTypePerformance),
      };

      await fs.writeFile(this.stateFile, JSON.stringify(toSave, null, 2));
    } catch (error) {
      log.error("Failed to save Oracle state:", error);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════════

let oracleLearningInstance: OracleLearning | null = null;

export async function getOracleLearning(): Promise<OracleLearning> {
  if (!oracleLearningInstance) {
    oracleLearningInstance = new OracleLearning();
    await oracleLearningInstance.initialize();
  }
  return oracleLearningInstance;
}

export { OracleLearning };
