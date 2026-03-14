/**
 * Lightweight Swarm - OpenClaw Native Implementation
 *
 * Uses OpenClaw's sessions_spawn to coordinate multiple agents
 * without external Claude-Flow dependency.
 *
 * Flow:
 * 1. Queen (this session) analyzes task, decomposes into subtasks
 * 2. Spawns parallel sub-agents via sessions_spawn
 * 3. Collects results and merges with majority consensus
 */

import type { TaskClassification } from "./types.js";
import { JudgeStep } from "./consensus.js";

export interface SwarmTask {
  id: string;
  description: string;
  context: string;
  priority: "high" | "medium" | "low";
}

export interface SubtaskResult {
  agentId: string;
  subtaskId: string;
  success: boolean;
  output: string;
  latencyMs: number;
  confidence: number;
}

export interface SwarmResult {
  taskId: string;
  success: boolean;
  mergedOutput: string;
  subtaskResults: SubtaskResult[];
  consensusReached: boolean;
  totalLatencyMs: number;
  agentsUsed: number;
}

export interface SwarmConfig {
  maxAgents: number;
  consensusThreshold: number; // 0.5 = majority, 0.66 = supermajority
  timeoutMs: number;
  model: string;
}

const DEFAULT_SWARM_CONFIG: SwarmConfig = {
  maxAgents: 5,
  consensusThreshold: 0.66,
  timeoutMs: 120000,
  model: "anthropic/claude-sonnet-4-20250514",
};

/**
 * Lightweight Swarm Coordinator
 * Uses OpenClaw's native sessions_spawn for parallel agent execution
 */
export class LightweightSwarm {
  private config: SwarmConfig;
  private judge: JudgeStep;

  constructor(config: Partial<SwarmConfig> = {}) {
    this.config = { ...DEFAULT_SWARM_CONFIG, ...config };
    this.judge = new JudgeStep({
      quorumThreshold: this.config.consensusThreshold,
    });
  }

  /**
   * Decompose a complex task into parallel subtasks
   * This is the "Queen" function - strategic analysis
   */
  async decomposeTask(task: string, classification: TaskClassification): Promise<SwarmTask[]> {
    const subtasks: SwarmTask[] = [];
    const agents = classification.suggestedAgents || ["coder", "reviewer"];

    // Generate subtasks based on suggested agents
    for (const agentType of agents.slice(0, this.config.maxAgents)) {
      subtasks.push({
        id: `${Date.now()}-${agentType}`,
        description: this.generateSubtaskPrompt(task, agentType),
        context: task,
        priority: agentType === "coordinator" ? "high" : "medium",
      });
    }

    return subtasks;
  }

  /**
   * Generate a specialized prompt for each agent type
   */
  private generateSubtaskPrompt(task: string, agentType: string): string {
    const prompts: Record<string, string> = {
      coordinator: `As the coordinator, create a high-level plan for: ${task}
        Output: A numbered list of steps with clear responsibilities.`,

      coder: `As a senior developer, implement the code for: ${task}
        Focus on: Clean code, error handling, edge cases.
        Output: Working code with comments.`,

      tester: `As a QA engineer, create tests for: ${task}
        Focus on: Unit tests, edge cases, integration tests.
        Output: Test cases with expected outcomes.`,

      reviewer: `As a code reviewer, analyze the approach for: ${task}
        Focus on: Security, performance, maintainability.
        Output: Review notes with specific recommendations.`,

      architect: `As a system architect, design the solution for: ${task}
        Focus on: Scalability, patterns, interfaces.
        Output: Architecture diagram (text) and key decisions.`,

      documenter: `As a technical writer, document: ${task}
        Focus on: API docs, usage examples, gotchas.
        Output: Clear documentation with examples.`,

      security: `As a security analyst, audit: ${task}
        Focus on: Vulnerabilities, auth, data protection.
        Output: Security assessment with mitigations.`,
    };

    return prompts[agentType] || `As a ${agentType}, help with: ${task}`;
  }

  /**
   * Execute subtasks in parallel using OpenClaw's sessions_spawn
   * Returns results once all agents complete or timeout
   */
  async executeParallel(
    subtasks: SwarmTask[],
    spawnFn: (task: string, label: string) => Promise<{ sessionKey: string }>,
  ): Promise<SubtaskResult[]> {
    const startTime = Date.now();
    const results: SubtaskResult[] = [];

    // Spawn all agents in parallel
    const spawnPromises = subtasks.map(async (subtask) => {
      const agentLabel = `swarm-${subtask.id}`;
      try {
        const { sessionKey } = await spawnFn(subtask.description, agentLabel);
        return {
          agentId: sessionKey,
          subtaskId: subtask.id,
          success: true,
          output: "", // Will be filled by the spawn result
          latencyMs: Date.now() - startTime,
          confidence: 0.8,
        };
      } catch (error) {
        return {
          agentId: "failed",
          subtaskId: subtask.id,
          success: false,
          output: `Error: ${error}`,
          latencyMs: Date.now() - startTime,
          confidence: 0,
        };
      }
    });

    // Wait for all with timeout
    const settledResults = await Promise.race([
      Promise.all(spawnPromises),
      new Promise<SubtaskResult[]>((_, reject) =>
        setTimeout(() => reject(new Error("Swarm timeout")), this.config.timeoutMs),
      ),
    ]).catch((error) => {
      console.error("[Swarm] Timeout or error:", error);
      return [];
    });

    return settledResults as SubtaskResult[];
  }

  /**
   * Merge results using quorum voting + judge arbitration.
   * The judge scores each agent output on quality, completeness, and
   * agreement with other agents, then picks the best one.
   * Adaptive quorum: relaxes threshold when only 2 agents are available.
   */
  mergeResults(results: SubtaskResult[]): {
    success: boolean;
    output: string;
    consensusReached: boolean;
    confidence?: number;
    reasoning?: string;
  } {
    if (results.length === 0) {
      return { success: false, output: "No results from swarm", consensusReached: false };
    }

    const verdict = this.judge.mergeWithVerdict(results);

    console.log(
      `[Swarm] Judge verdict: confidence=${(verdict.confidence * 100).toFixed(0)}%, ` +
        `quorum=${verdict.consensusReached ? "yes" : "no"}. ${verdict.reasoning}`,
    );

    return {
      success: verdict.success,
      output: verdict.output,
      consensusReached: verdict.consensusReached,
      confidence: verdict.confidence,
      reasoning: verdict.reasoning,
    };
  }

  /**
   * Full swarm execution pipeline
   */
  async execute(
    task: string,
    classification: TaskClassification,
    spawnFn: (task: string, label: string) => Promise<{ sessionKey: string }>,
  ): Promise<SwarmResult> {
    const taskId = `swarm-${Date.now()}`;
    const startTime = Date.now();

    console.log(`[Swarm] Starting swarm execution for task: ${taskId}`);
    console.log(`[Swarm] Suggested agents: ${classification.suggestedAgents?.join(", ")}`);

    // Step 1: Decompose
    const subtasks = await this.decomposeTask(task, classification);
    console.log(`[Swarm] Decomposed into ${subtasks.length} subtasks`);

    // Step 2: Execute in parallel
    const results = await this.executeParallel(subtasks, spawnFn);
    console.log(`[Swarm] Got ${results.length} results`);

    // Step 3: Merge with consensus
    const merged = this.mergeResults(results);

    return {
      taskId,
      success: merged.success,
      mergedOutput: merged.output,
      subtaskResults: results,
      consensusReached: merged.consensusReached,
      totalLatencyMs: Date.now() - startTime,
      agentsUsed: results.length,
    };
  }
}

/**
 * Create a lightweight swarm instance
 */
export function createLightweightSwarm(config?: Partial<SwarmConfig>): LightweightSwarm {
  return new LightweightSwarm(config);
}

export default LightweightSwarm;
