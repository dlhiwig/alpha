#!/usr/bin/env node
// @ts-nocheck

/**
 * SuperClaw Memory System Usage Example
 * 
 * This example demonstrates how to integrate the memory system with SuperClaw's
 * agent conversations and decision-making process.
 */

import { initializeMemorySystem } from './memory-index';

async function demonstrateMemorySystem() {
  console.log('🧠 SuperClaw Memory System Integration Example');
  console.log('==============================================\n');

  // Initialize memory system
  const workspace = '/home/toba/.openclaw/workspace'; // Use OpenClaw workspace as reference
  const memorySystem = await initializeMemorySystem(workspace);
  
  console.log('✓ Memory system initialized');

  // 1. Demonstrate context preparation for LLM calls
  console.log('\n📝 Context Preparation Example');
  console.log('--------------------------------');
  
  const userInput = "What's the status of SuperClaw development?";
  
  // Prepare context for main session (full access)
  const mainContext = await memorySystem.prepareContext(userInput, 'main');
  console.log(`Main session context: ${mainContext.stats.totalLength} chars, sections: ${mainContext.stats.sections.join(', ')}`);
  
  // Prepare context for shared session (limited access)
  const sharedContext = await memorySystem.prepareContext(userInput, 'shared');
  console.log(`Shared session context: ${sharedContext.stats.totalLength} chars, sections: ${sharedContext.stats.sections.join(', ')}`);

  // 2. Demonstrate memory search
  console.log('\n🔍 Memory Search Example');
  console.log('-------------------------');
  
  const searchResult = await memorySystem.searchMemory('SuperClaw', { maxResults: 3 });
  console.log(`Found ${searchResult.results.length} matches for "SuperClaw"`);
  
  if (searchResult.results.length > 0) {
    const bestMatch = searchResult.results[0];
    console.log(`Best match: ${bestMatch.file}:${bestMatch.line} (relevance: ${bestMatch.relevance.toFixed(2)})`);
    console.log(`Content: ${bestMatch.content.substring(0, 100)}...`);
  }

  // 3. Demonstrate event recording
  console.log('\n📓 Event Recording Example');
  console.log('----------------------------');
  
  await memorySystem.recordEvent('Demonstrated memory system integration', 'Testing');
  await memorySystem.recordDecision('Use memory system for agent persistence', 'Provides continuity between sessions');
  await memorySystem.recordLearning('Memory search helps find relevant context efficiently');
  
  console.log('✓ Events recorded to daily notes');

  // 4. Show memory statistics
  console.log('\n📊 Memory Statistics');
  console.log('--------------------');
  
  const stats = await memorySystem.getStats();
  console.log('Memory stats:', {
    longTermSize: stats.memory.longTermMemorySize,
    dailyNotesCount: stats.memory.dailyNotesCount,
    totalMemorySize: stats.memory.totalMemorySize
  });
  
  console.log('Workspace stats:', {
    totalFiles: stats.workspace.totalFiles,
    totalSize: stats.workspace.totalSize,
    topFileTypes: Object.entries(stats.workspace.fileTypes)
      .toSorted(([,a], [,b]) => (b as number) - (a as number))
      .slice(0, 3)
      .map(([ext, count]) => `${ext}:${count}`)
  });

  console.log('\n✅ Memory system demonstration complete!');
}

/**
 * Example: LLM Agent with Memory Integration
 */
async function simulateLLMAgentWithMemory() {
  console.log('\n🤖 LLM Agent with Memory Integration');
  console.log('====================================');

  const workspace = '/home/toba/.openclaw/workspace';
  const memorySystem = await initializeMemorySystem(workspace);

  // Simulate an agent conversation
  const userMessage = "Can you help me understand the current status of the DEFIT project?";
  
  // Step 1: Prepare context
  const { prompt, context, stats } = await memorySystem.prepareContext(userMessage, 'main');
  
  console.log(`Context prepared: ${stats.totalLength} characters from ${stats.sections.join(', ')}`);
  
  // Step 2: In real implementation, this would go to LLM
  console.log('\n--- Context Prompt (truncated) ---');
  console.log(prompt.substring(0, 500) + '...\n');
  
  // Step 3: Simulate LLM response processing and memory update
  const agentResponse = "Based on your memory, DEFIT is your fitness platform project. I can see from your notes that you're working on multiple components...";
  
  // Step 4: Record the interaction
  await memorySystem.recordEvent(`User asked about DEFIT project status. Provided overview based on memory context.`, 'Conversation');
  
  console.log('✓ Conversation recorded to memory');
  
  // Step 5: Show how to search for related context
  const relatedInfo = await memorySystem.searchMemory('DEFIT fitness platform', { maxResults: 2 });
  console.log(`Found ${relatedInfo.results.length} related memory entries`);
  
  return {
    userMessage,
    contextStats: stats,
    agentResponse,
    relatedMemories: relatedInfo.results.length
  };
}

/**
 * Example: Memory-Aware Decision Making
 */
async function demonstrateMemoryAwareDecisions() {
  console.log('\n🧭 Memory-Aware Decision Making');
  console.log('===============================');

  const workspace = '/home/toba/.openclaw/workspace';
  const memorySystem = await initializeMemorySystem(workspace);

  // Scenario: Agent needs to make a decision about task prioritization
  const currentTasks = [
    'Implement SuperClaw Phase 3',
    'Update DEFIT user interface', 
    'Review Black Eagle Project status'
  ];

  console.log('Current tasks:', currentTasks);

  // Check memory for context about each task
  for (const task of currentTasks) {
    const memories = await memorySystem.searchMemory(task, { maxResults: 1 });
    if (memories.results.length > 0) {
      console.log(`- ${task}: Found ${memories.results.length} relevant memory entries`);
    } else {
      console.log(`- ${task}: No specific memory found`);
    }
  }

  // Make and record a decision
  const decision = 'Prioritize SuperClaw Phase 3 implementation';
  const reasoning = 'Memory search shows active development and recent progress. Critical for system architecture.';
  
  await memorySystem.recordDecision(decision, reasoning);
  console.log(`✓ Decision recorded: ${decision}`);
  
  return decision;
}

// Main execution
async function main() {
  try {
    await demonstrateMemorySystem();
    await simulateLLMAgentWithMemory();
    await demonstrateMemoryAwareDecisions();
    
    console.log('\n🎉 All examples completed successfully!');
  } catch (error: unknown) {
    console.error('❌ Example failed:', error);
    process.exit(1);
  }
}

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('❌ Example execution failed:', error);
    process.exit(1);
  });
}

export { 
  demonstrateMemorySystem, 
  simulateLLMAgentWithMemory, 
  demonstrateMemoryAwareDecisions 
};