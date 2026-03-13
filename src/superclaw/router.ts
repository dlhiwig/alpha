/**
 * SuperClaw Task Router
 * Classifies incoming tasks and determines routing strategy
 */

import type { TaskComplexity, TaskClassification, SuperClawConfig, PatternMatch } from "./types.js";

/** Keywords that suggest code-related tasks */
const CODE_KEYWORDS = [
  "implement",
  "build",
  "create",
  "write",
  "code",
  "program",
  "develop",
  "fix",
  "debug",
  "refactor",
  "optimize",
  "test",
  "deploy",
  "configure",
  "setup",
  "install",
  "migrate",
];

/** Keywords that suggest complex multi-step tasks */
const COMPLEX_KEYWORDS = [
  "swarm",
  "parallel",
  "multiple",
  "team",
  "coordinate",
  "comprehensive",
  "full",
  "complete",
  "entire",
  "all",
  "architecture",
  "system",
  "platform",
  "infrastructure",
  "redesign",
  "overhaul",
  "rewrite",
];

/** Keywords that suggest simple tasks */
const SIMPLE_KEYWORDS = [
  "what",
  "when",
  "where",
  "who",
  "how much",
  "how many",
  "tell me",
  "explain",
  "describe",
  "list",
  "show",
  "check",
  "status",
  "help",
  "hello",
  "hi",
  "thanks",
];

/** Agent types for different task categories */
const AGENT_MAPPINGS: Record<string, string[]> = {
  code: ["coder", "reviewer"],
  test: ["tester", "coder"],
  debug: ["debugger", "coder", "tester"],
  architecture: ["architect", "coder", "reviewer"],
  security: ["security", "auditor", "coder"],
  docs: ["documenter", "reviewer"],
  deploy: ["deployer", "coder"],
  research: ["researcher", "analyst"],
};

/** Model recommendations by complexity */
const MODEL_BY_COMPLEXITY: Record<TaskComplexity, string> = {
  simple: "openai/dolphin-llama3:8b", // Local, free, fast, uncensored
  medium: "anthropic/claude-sonnet-4-20250514",
  complex: "anthropic/claude-opus-4-5-20251101",
};

/** Alternative models for specific scenarios */
const SPECIALIZED_MODELS = {
  // Use local model for tasks that might trigger Claude safety filters
  uncensored: "openai/dolphin-llama3:8b",
  // Use local model for high-volume, low-stakes tasks
  bulk: "openai/dolphin-llama3:8b",
  // Use local 70B for medium-complexity uncensored tasks (if available)
  uncensoredMedium: "openai/dolphin-llama3:70b",
  // Best quality regardless of cost
  quality: "anthropic/claude-opus-4-5-20251101",
};

/** Keywords that might trigger Claude's safety filters */
const UNCENSORED_KEYWORDS = [
  "uncensored",
  "unfiltered",
  "explicit",
  "nsfw",
  "adult",
  "violence",
  "weapon",
  "drug",
  "illegal",
  "hack",
  "exploit",
  "jailbreak",
  "bypass",
  "circumvent",
  "unrestricted",
];

export class TaskRouter {
  private config: SuperClawConfig;
  private recentClassifications: Map<string, TaskClassification> = new Map();

  constructor(config: SuperClawConfig) {
    this.config = config;
  }

  /**
   * Classify a task to determine routing strategy
   */
  async classify(
    task: string,
    context?: {
      sessionHistory?: string[];
      patterns?: PatternMatch[];
    },
  ): Promise<TaskClassification> {
    const normalized = task.toLowerCase().trim();

    // Quick check for cached classification of identical tasks
    const cached = this.recentClassifications.get(normalized);
    if (cached) {
      return cached;
    }

    // Analyze task characteristics
    const wordCount = task.split(/\s+/).length;
    const hasCodeKeywords = this.hasKeywords(normalized, CODE_KEYWORDS);
    const hasComplexKeywords = this.hasKeywords(normalized, COMPLEX_KEYWORDS);
    const hasSimpleKeywords = this.hasKeywords(normalized, SIMPLE_KEYWORDS);
    const hasCodeBlocks = /```[\s\S]*```/.test(task);
    const hasMultipleSteps = /\b(then|after|next|finally|also|and then)\b/i.test(task);
    const hasNumberedList = /^\s*\d+[.)]/m.test(task);

    // Calculate complexity score (0-1)
    let complexityScore = 0;

    // Word count factor
    if (wordCount > 100) {complexityScore += 0.3;}
    else if (wordCount > 50) {complexityScore += 0.2;}
    else if (wordCount > 20) {complexityScore += 0.1;}

    // Keyword factors
    if (hasComplexKeywords) {complexityScore += 0.3;}
    if (hasCodeKeywords) {complexityScore += 0.15;}
    if (hasSimpleKeywords) {complexityScore -= 0.2;}

    // Explicit swarm request is always complex
    if (normalized.includes("swarm")) {complexityScore += 0.25;}

    // Structure factors
    if (hasCodeBlocks) {complexityScore += 0.1;}
    if (hasMultipleSteps) {complexityScore += 0.15;}
    if (hasNumberedList) {complexityScore += 0.1;}

    // Pattern matching boost
    if (context?.patterns?.length) {
      const avgSimilarity =
        context.patterns.reduce((sum, p) => sum + p.similarity, 0) / context.patterns.length;
      if (avgSimilarity > 0.8) {
        // High similarity to known patterns - might be easier
        complexityScore -= 0.1;
      }
    }

    // Clamp to 0-1
    complexityScore = Math.max(0, Math.min(1, complexityScore));

    // Determine complexity level
    let complexity: TaskComplexity;
    if (complexityScore >= 0.5) {
      complexity = "complex";
    } else if (complexityScore >= 0.25) {
      complexity = "medium";
    } else {
      complexity = "simple";
    }

    // Suggest agents based on task content
    const suggestedAgents = this.suggestAgents(normalized, complexity);

    // Build classification
    const classification: TaskClassification = {
      complexity,
      confidence: this.calculateConfidence(complexityScore),
      suggestedModel: this.selectModel(complexity, normalized),
      suggestedAgents,
      reasoning: this.buildReasoning(task, complexity, complexityScore),
    };

    // Cache for repeated queries
    this.recentClassifications.set(normalized, classification);

    // Keep cache size bounded
    if (this.recentClassifications.size > 100) {
      const firstKey = this.recentClassifications.keys().next().value;
      if (firstKey) {this.recentClassifications.delete(firstKey);}
    }

    return classification;
  }

  /**
   * Check if text contains any of the given keywords
   */
  private hasKeywords(text: string, keywords: string[]): boolean {
    return keywords.some((kw) => text.includes(kw));
  }

  /**
   * Calculate confidence based on how clearly the task fits a category
   */
  private calculateConfidence(score: number): number {
    // Highest confidence at extremes (clearly simple or complex)
    // Lower confidence in the middle
    const distanceFromMiddle = Math.abs(score - 0.375); // Middle of medium range
    return 0.5 + distanceFromMiddle;
  }

  /**
   * Select appropriate model based on complexity and config
   */
  private selectModel(complexity: TaskComplexity, task?: string): string {
    // Check for local-first routing (use Ollama when possible)
    if (this.config.routing.preferLocal && complexity === "simple") {
      return SPECIALIZED_MODELS.bulk; // dolphin-llama3:8b
    }

    // Check for uncensored content that might trigger Claude's safety filters
    if (task && this.hasKeywords(task.toLowerCase(), UNCENSORED_KEYWORDS)) {
      return complexity === "simple"
        ? SPECIALIZED_MODELS.uncensored
        : SPECIALIZED_MODELS.uncensoredMedium;
    }

    if (this.config.routing.strategy === "cost") {
      // Always prefer cheaper/local models
      if (complexity === "simple") {return SPECIALIZED_MODELS.bulk;}
      return complexity === "complex"
        ? "anthropic/claude-sonnet-4-20250514"
        : SPECIALIZED_MODELS.bulk;
    }

    if (this.config.routing.strategy === "quality") {
      // Always prefer better models
      return complexity === "simple"
        ? "anthropic/claude-sonnet-4-20250514"
        : SPECIALIZED_MODELS.quality;
    }

    // Balanced strategy - use local for simple, Claude for complex
    return MODEL_BY_COMPLEXITY[complexity];
  }

  /**
   * Suggest agents based on task content
   */
  private suggestAgents(task: string, complexity: TaskComplexity): string[] {
    if (complexity === "simple") {
      return []; // No swarm needed
    }

    const agents: Set<string> = new Set(["coordinator"]);

    for (const [category, agentList] of Object.entries(AGENT_MAPPINGS)) {
      if (task.includes(category)) {
        agentList.forEach((a) => agents.add(a));
      }
    }

    // Default agents if nothing specific matched
    if (agents.size === 1) {
      agents.add("coder");
      agents.add("reviewer");
    }

    // Limit by config
    const agentArray = Array.from(agents);
    return agentArray.slice(0, this.config.swarm.maxAgents);
  }

  /**
   * Build human-readable reasoning for the classification
   */
  private buildReasoning(task: string, complexity: TaskComplexity, score: number): string {
    const factors: string[] = [];
    const wordCount = task.split(/\s+/).length;

    if (wordCount > 50) {factors.push(`long task (${wordCount} words)`);}
    if (this.hasKeywords(task.toLowerCase(), COMPLEX_KEYWORDS))
      {factors.push("complex keywords detected");}
    if (this.hasKeywords(task.toLowerCase(), CODE_KEYWORDS)) {factors.push("code-related task");}
    if (this.hasKeywords(task.toLowerCase(), SIMPLE_KEYWORDS))
      {factors.push("simple query keywords");}
    if (/```[\s\S]*```/.test(task)) {factors.push("contains code blocks");}
    if (/\b(then|after|next|finally)\b/i.test(task)) {factors.push("multi-step task");}

    const factorStr = factors.length > 0 ? factors.join(", ") : "general characteristics";

    return `Classified as ${complexity} (score: ${score.toFixed(2)}) based on: ${factorStr}`;
  }

  /**
   * Force a specific complexity (for testing or manual override)
   */
  forceComplexity(task: string, complexity: TaskComplexity): TaskClassification {
    return {
      complexity,
      confidence: 1.0,
      suggestedModel: this.selectModel(complexity, task),
      suggestedAgents: complexity === "complex" ? ["coordinator", "coder", "reviewer"] : [],
      reasoning: "Manually overridden",
    };
  }

  /**
   * Check if task should use local/uncensored model
   */
  shouldUseLocalModel(task: string): boolean {
    const normalized = task.toLowerCase();
    return this.hasKeywords(normalized, UNCENSORED_KEYWORDS) || this.config.routing.preferLocal;
  }

  /**
   * Check if task should use swarm based on classification
   */
  shouldUseSwarm(classification: TaskClassification): boolean {
    if (!this.config.swarm.enabled) {return false;}
    if (classification.complexity !== "complex") {return false;}
    if (classification.confidence < 0.6) {return false;} // Too uncertain
    return true;
  }

  /**
   * Clear classification cache
   */
  clearCache(): void {
    this.recentClassifications.clear();
  }
}
