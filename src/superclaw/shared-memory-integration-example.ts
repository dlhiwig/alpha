/**
 * Shared Memory Integration Example
 *
 * Shows how to integrate shared memory into Alpha agent workflows
 */

import {
  injectRelevantMemories,
  storeLesson,
  storeDecision,
  storeObservation,
} from "./shared-memory-context.js";

// ═══════════════════════════════════════════════════════════════════
// EXAMPLE: ENHANCED AGENT PROMPT WITH SHARED MEMORY
// ═══════════════════════════════════════════════════════════════════

export async function enhanceAgentPrompt(
  agentId: string,
  originalPrompt: string,
  taskDescription: string,
): Promise<string> {
  try {
    // Get relevant memories for context
    const context = await injectRelevantMemories(taskDescription, {
      maxMemories: 5,
      minImportance: 0.5,
      excludeAgents: [agentId], // Don't include our own memories
      maxAgeHours: 168, // One week
      format: "markdown",
    });

    if (context.memoriesIncluded > 0) {
      return `${originalPrompt}

## Context from Shared Memory

The following information has been learned by other agents and may be relevant to your task:

${context.contextText}

---

Please consider this shared knowledge when completing your task, but don't be constrained by it if you have better approaches.`;
    }

    return originalPrompt;
  } catch (error) {
    console.warn("Failed to enhance prompt with shared memory:", error);
    return originalPrompt;
  }
}

// ═══════════════════════════════════════════════════════════════════
// EXAMPLE: POST-TASK KNOWLEDGE EXTRACTION
// ═══════════════════════════════════════════════════════════════════

export async function extractAndStoreKnowledge(
  agentId: string,
  taskDescription: string,
  result: {
    success: boolean;
    output: string;
    insights?: string[];
    decisions?: Array<{ decision: string; reasoning: string }>;
    lessons?: string[];
    observations?: string[];
  },
): Promise<void> {
  try {
    // Store decisions made during task execution
    if (result.decisions) {
      for (const { decision, reasoning } of result.decisions) {
        await storeDecision(agentId, decision, reasoning, 0.8);
      }
    }

    // Store lessons learned
    if (result.lessons) {
      for (const lesson of result.lessons) {
        await storeLesson(agentId, lesson, taskDescription, 0.7);
      }
    }

    // Store observations
    if (result.observations) {
      for (const observation of result.observations) {
        await storeObservation(agentId, observation, ["task-execution"], 0.6);
      }
    }

    // Store insights as lessons if they exist
    if (result.insights) {
      for (const insight of result.insights) {
        await storeLesson(agentId, insight, `Insight from: ${taskDescription}`, 0.75);
      }
    }

    // If task failed, store the failure as a lesson
    if (!result.success && result.output) {
      await storeLesson(
        agentId,
        `Task failed: ${result.output}`,
        taskDescription,
        0.8, // High importance for failures
      );
    }
  } catch (error) {
    console.error("Failed to extract and store knowledge:", error);
  }
}

// ═══════════════════════════════════════════════════════════════════
// EXAMPLE: SWARM COORDINATOR WITH SHARED MEMORY
// ═══════════════════════════════════════════════════════════════════

export class SwarmCoordinator {
  private swarmId: string;

  constructor(swarmId: string) {
    this.swarmId = swarmId;
  }

  /**
   * Prepare context for swarm agents using shared memory
   */
  async prepareSwarmContext(task: string): Promise<string> {
    try {
      const context = await injectRelevantMemories(task, {
        maxMemories: 10,
        minImportance: 0.6,
        types: ["decision", "lesson"],
        maxAgeHours: 72, // 3 days
        format: "plain",
      });

      if (context.memoriesIncluded > 0) {
        return `SWARM CONTEXT (${context.memoriesIncluded} relevant memories):

${context.contextText}

---

TASK: ${task}`;
      }

      return `TASK: ${task}`;
    } catch (error) {
      console.warn("Failed to prepare swarm context:", error);
      return `TASK: ${task}`;
    }
  }

  /**
   * Store swarm results and intermediate findings
   */
  async storeSwarmResults(results: {
    finalDecision?: string;
    reasoning?: string;
    consensusReached: boolean;
    agentFindings: Array<{
      agentId: string;
      finding: string;
      confidence: number;
    }>;
  }): Promise<void> {
    try {
      // Store the final decision if consensus was reached
      if (results.finalDecision && results.consensusReached) {
        await storeDecision(
          this.swarmId,
          results.finalDecision,
          results.reasoning,
          0.9, // High importance for consensus decisions
        );
      }

      // Store individual agent findings as observations
      for (const finding of results.agentFindings) {
        await storeObservation(
          finding.agentId,
          finding.finding,
          ["swarm", "collaborative"],
          finding.confidence * 0.7, // Scale importance by confidence
        );
      }

      // If no consensus, store that as a lesson
      if (!results.consensusReached) {
        await storeLesson(
          this.swarmId,
          "Swarm failed to reach consensus - may need better coordination or clearer task definition",
          `Swarm task with ${results.agentFindings.length} agents`,
          0.6,
        );
      }
    } catch (error) {
      console.error("Failed to store swarm results:", error);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// EXAMPLE: AGENT LEARNING PIPELINE
// ═══════════════════════════════════════════════════════════════════

export class AgentLearningPipeline {
  private agentId: string;

  constructor(agentId: string) {
    this.agentId = agentId;
  }

  /**
   * Pre-task: Get relevant context and recent learnings
   */
  async prepareForTask(
    taskType: string,
    taskDescription: string,
  ): Promise<{
    contextPrompt: string;
    relevantLessons: string[];
  }> {
    try {
      // Get task-specific context
      const taskContext = await injectRelevantMemories(taskDescription, {
        maxMemories: 3,
        types: ["lesson", "decision"],
        minImportance: 0.7,
      });

      // Get recent learnings for this type of task
      const typeContext = await injectRelevantMemories(taskType, {
        maxMemories: 2,
        types: ["lesson"],
        minImportance: 0.6,
        maxAgeHours: 48,
      });

      const contextPrompt = [taskContext.contextText, typeContext.contextText]
        .filter(Boolean)
        .join("\n\n");

      const relevantLessons = [...taskContext.memories, ...typeContext.memories]
        .filter((m) => m.type === "lesson")
        .map((m) => m.content);

      return { contextPrompt, relevantLessons };
    } catch (error) {
      console.error("Failed to prepare for task:", error);
      return { contextPrompt: "", relevantLessons: [] };
    }
  }

  /**
   * Post-task: Extract and store learnings
   */
  async learnFromTask(
    taskType: string,
    taskDescription: string,
    execution: {
      steps: Array<{ action: string; result: string; success: boolean }>;
      finalResult: { success: boolean; output: string };
      duration: number;
      resourcesUsed?: string[];
    },
  ): Promise<void> {
    try {
      const lessons: string[] = [];
      const observations: string[] = [];

      // Analyze execution steps for patterns
      const failedSteps = execution.steps.filter((step) => !step.success);
      if (failedSteps.length > 0) {
        lessons.push(
          `Common failure points in ${taskType}: ${failedSteps.map((s) => s.action).join(", ")}`,
        );
      }

      const successfulSteps = execution.steps.filter((step) => step.success);
      if (successfulSteps.length === execution.steps.length && execution.finalResult.success) {
        observations.push(
          `Successful ${taskType} pattern: ${successfulSteps.map((s) => s.action).join(" → ")}`,
        );
      }

      // Performance observations
      if (execution.duration > 30000) {
        // > 30 seconds
        observations.push(
          `${taskType} tasks may take longer than expected (${execution.duration}ms)`,
        );
      }

      // Resource usage patterns
      if (execution.resourcesUsed && execution.resourcesUsed.length > 0) {
        observations.push(`${taskType} typically uses: ${execution.resourcesUsed.join(", ")}`);
      }

      // Store all learnings
      for (const lesson of lessons) {
        await storeLesson(this.agentId, lesson, taskDescription, 0.75);
      }

      for (const observation of observations) {
        await storeObservation(
          this.agentId,
          observation,
          [taskType, "performance", "pattern"],
          0.6,
        );
      }

      // If task completely failed, store high-importance lesson
      if (!execution.finalResult.success) {
        await storeLesson(
          this.agentId,
          `Failed ${taskType}: ${execution.finalResult.output}`,
          `Context: ${taskDescription}`,
          0.85,
        );
      }
    } catch (error) {
      console.error("Failed to learn from task:", error);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// EXAMPLE USAGE
// ═══════════════════════════════════════════════════════════════════

export async function exampleAgentWithSharedMemory() {
  const agentId = "example-agent";
  const learning = new AgentLearningPipeline(agentId);

  // 1. Prepare for a coding task
  console.log("📚 Preparing for coding task...");
  const { contextPrompt, relevantLessons } = await learning.prepareForTask(
    "api-development",
    "Create a REST API for user authentication",
  );

  console.log("Context prompt:", contextPrompt);
  console.log("Relevant lessons:", relevantLessons);

  // 2. Simulate task execution
  const execution = {
    steps: [
      { action: "design-endpoints", result: "Designed /login and /register", success: true },
      { action: "implement-auth", result: "Added JWT token system", success: true },
      { action: "add-validation", result: "Input validation added", success: true },
      { action: "write-tests", result: "Unit tests completed", success: true },
    ],
    finalResult: { success: true, output: "Authentication API completed successfully" },
    duration: 45000,
    resourcesUsed: ["jwt", "bcrypt", "express-validator"],
  };

  // 3. Learn from the task
  console.log("💡 Learning from task execution...");
  await learning.learnFromTask(
    "api-development",
    "Create a REST API for user authentication",
    execution,
  );

  console.log("✅ Knowledge stored in shared memory for future agents");
}

// Uncomment to run the example
// exampleAgentWithSharedMemory();
