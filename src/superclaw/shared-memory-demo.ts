#!/usr/bin/env node
/**
 * Shared Memory Demo
 *
 * Demonstrates the shared memory system functionality
 */

import {
  injectRelevantMemories,
  storeLesson,
  storeDecision,
  getRecentLearnings,
} from "./shared-memory-context.js";
import { getSharedMemory } from "./shared-memory.js";

async function demo() {
  console.log("🧠 Alpha Shared Memory System Demo\n");

  try {
    // Initialize shared memory
    console.log("1. Initializing shared memory...");
    const sharedMemory = await getSharedMemory();
    console.log("   ✅ Shared memory initialized\n");

    // Store some sample memories from different agents
    console.log("2. Storing sample memories from different agents...");

    await sharedMemory.store({
      agentId: "agent-coder",
      content: "Always use TypeScript strict mode for better type safety",
      type: "lesson",
      tags: ["coding", "typescript", "best-practice"],
      importance: 0.8,
      source: "coding-session-001",
    });
    console.log("   📝 Stored lesson from agent-coder");

    await sharedMemory.store({
      agentId: "agent-reviewer",
      content: "Code review revealed that error handling is insufficient in the auth module",
      type: "observation",
      tags: ["code-review", "error-handling", "auth"],
      importance: 0.7,
      source: "review-session-002",
    });
    console.log("   👀 Stored observation from agent-reviewer");

    await sharedMemory.store({
      agentId: "swarm-001",
      content:
        "Decided to use SQLite for shared memory instead of in-memory storage for persistence across restarts",
      type: "decision",
      tags: ["architecture", "database", "persistence"],
      importance: 0.9,
      source: "swarm:001:memory-architecture",
    });
    console.log("   🎯 Stored decision from swarm-001");

    await storeLesson(
      "agent-tester",
      "Unit tests should cover edge cases, not just happy paths",
      "Found several bugs that only occurred with invalid input",
      0.75,
    );
    console.log("   💡 Stored lesson via helper function\n");

    // Search for relevant memories
    console.log("3. Searching for relevant memories...");

    const codeRelevantMemories = await sharedMemory.search("typescript coding best practices", {
      limit: 3,
      minImportance: 0.5,
    });
    console.log(`   Found ${codeRelevantMemories.length} memories related to coding:`);

    for (const memory of codeRelevantMemories) {
      console.log(
        `   - [${memory.type}] ${memory.content.slice(0, 50)}... (importance: ${memory.importance})`,
      );
    }
    console.log();

    // Test context injection
    console.log("4. Testing context injection for a new coding task...");

    const context = await injectRelevantMemories(
      "I need to implement a new authentication module with proper error handling",
      {
        maxMemories: 3,
        types: ["lesson", "decision", "observation"],
        format: "markdown",
      },
    );

    console.log(
      `   Generated context with ${context.memoriesIncluded} memories (${context.estimatedTokens} tokens):`,
    );
    if (context.contextText) {
      console.log("   ---");
      console.log(context.contextText);
      console.log("   ---\n");
    }

    // Get recent learnings
    console.log("5. Getting recent learnings...");

    const learnings = await getRecentLearnings("agent-new", {
      maxMemories: 3,
      maxAgeHours: 24,
    });

    console.log(`   Found ${learnings.memoriesIncluded} recent learnings:`);
    if (learnings.contextText) {
      console.log("   ---");
      console.log(learnings.contextText);
      console.log("   ---\n");
    }

    // Get statistics
    console.log("6. Memory statistics...");
    const stats = await sharedMemory.getStats();
    console.log(`   📊 Total entries: ${stats.totalEntries}`);
    console.log(`   📈 Average importance: ${stats.avgImportance.toFixed(2)}`);
    console.log("   📋 Entries by type:", stats.entriesByType);
    console.log("   🤖 Entries by agent:", stats.entriesByAgent);
    console.log();

    console.log("✅ Demo completed successfully!");
    console.log("\n💡 The shared memory system is now ready for use by Alpha agents.");
    console.log("   - Swarm results will be automatically stored");
    console.log("   - API endpoints are available at:");
    console.log("     • GET  /api/v1/memory/shared/search?q=...");
    console.log("     • POST /api/v1/memory/shared/store");
    console.log("     • GET  /api/v1/memory/shared/stats");
  } catch (error) {
    console.error("❌ Demo failed:", error);
    process.exit(1);
  }
}

// Run demo if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  demo();
}
