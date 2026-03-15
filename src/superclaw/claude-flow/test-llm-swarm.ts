#!/usr/bin/env npx tsx
/**
 * Test Script: Real LLM Swarm Execution
 * 
 * Tests the swarm with actual LLM calls (Claude or Ollama)
 */

import { SwarmCoordinator } from './SwarmCoordinator';
import { ClaudeProvider, OllamaProvider, type LLMProvider } from '../llm/provider';

// =============================================================================
// Configuration
// =============================================================================

const USE_LOCAL = process.argv.includes('--local'); // Use Ollama instead of Claude
const VERBOSE = process.argv.includes('--verbose');

// =============================================================================
// Main Test
// =============================================================================

async function main() {
  console.log('🚀 SuperClaw LLM Swarm Test');
  console.log('=' .repeat(60));
  
  // Choose provider
  let provider: LLMProvider;
  
  if (USE_LOCAL) {
    // Check for 70b first, fall back to 8b
    const model = process.env.OLLAMA_MODEL || 'dolphin-llama3:70b';
    console.log(`📡 Using Ollama (local) — ${model}`);
    provider = new OllamaProvider({ model });
  } else {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('❌ ANTHROPIC_API_KEY not set. Use --local for Ollama or set the key.');
      process.exit(1);
    }
    console.log('📡 Using Claude — claude-sonnet-4-20250514');
    provider = new ClaudeProvider({ model: 'claude-sonnet-4-20250514' });
  }

  // Initialize SwarmCoordinator with LLM
  const coordinator = new SwarmCoordinator({
    topology: 'hierarchical',
    llmProvider: provider
  });

  await coordinator.initialize();
  console.log('✅ SwarmCoordinator initialized\n');

  // Spawn agents
  console.log('🤖 Spawning agents...');
  
  const leader = await coordinator.spawnAgent({
    id: 'leader-1',
    type: 'coordinator',
    role: 'leader',
    capabilities: ['coordinate', 'manage', 'orchestrate']
  });
  console.log(`   ✅ ${leader.id} (${leader.role})`);

  const coder = await coordinator.spawnAgent({
    id: 'coder-1',
    type: 'coder',
    capabilities: ['code', 'refactor', 'debug']
  });
  console.log(`   ✅ ${coder.id} (${coder.type})`);

  const researcher = await coordinator.spawnAgent({
    id: 'researcher-1',
    type: 'researcher',
    capabilities: ['research', 'analyze']
  });
  console.log(`   ✅ ${researcher.id} (${researcher.type})`);

  // Get swarm state
  const state = await coordinator.getSwarmState();
  console.log(`\n📊 Swarm State: ${state.agents.length} agents, topology: ${state.topology}\n`);

  // =============================================================================
  // Test 1: Single agent task (Coder)
  // =============================================================================
  
  console.log('─'.repeat(60));
  console.log('📝 Test 1: Coder Task');
  console.log('─'.repeat(60));

  const codingTask = {
    id: 'task-code-1',
    type: 'code',
    priority: 'high' as const,
    description: `Write a TypeScript function that:
1. Takes an array of numbers
2. Returns the top 3 largest numbers in descending order
3. Handles edge cases (empty array, less than 3 elements)
4. Include JSDoc comments

Keep it concise.`,
    status: 'pending' as const,
    createdAt: Date.now()
  };

  console.log(`\n📤 Sending to ${coder.id}...`);
  const startCoder = Date.now();
  const coderResult = await coordinator.executeTask(coder.id, codingTask);
  const coderDuration = Date.now() - startCoder;

  console.log(`\n📥 Result (${coderDuration}ms):`);
  if (coderResult.status === 'completed') {
    console.log('✅ Status: Completed');
    if (VERBOSE) {
      console.log('\n--- Response ---');
      console.log(coderResult.result);
      console.log('--- End ---\n');
    } else {
      // Show first 500 chars
      const preview = (coderResult.result as string)?.slice(0, 500) || '';
      console.log(`\n${preview}${preview.length >= 500 ? '...' : ''}\n`);
    }
    if (coderResult.metadata) {
      console.log(`📊 Tokens: ${coderResult.metadata.inputTokens} in / ${coderResult.metadata.outputTokens} out`);
    }
  } else {
    console.log(`❌ Status: Failed — ${coderResult.error}`);
  }

  // =============================================================================
  // Test 2: Research task
  // =============================================================================

  console.log('\n' + '─'.repeat(60));
  console.log('📝 Test 2: Researcher Task');
  console.log('─'.repeat(60));

  const researchTask = {
    id: 'task-research-1',
    type: 'research',
    priority: 'medium' as const,
    description: `Briefly analyze the pros and cons of these state management approaches for React:
1. Redux Toolkit
2. Zustand
3. Jotai

Provide a short recommendation for a medium-sized app. Keep it under 300 words.`,
    status: 'pending' as const,
    createdAt: Date.now()
  };

  console.log(`\n📤 Sending to ${researcher.id}...`);
  const startResearch = Date.now();
  const researchResult = await coordinator.executeTask(researcher.id, researchTask);
  const researchDuration = Date.now() - startResearch;

  console.log(`\n📥 Result (${researchDuration}ms):`);
  if (researchResult.status === 'completed') {
    console.log('✅ Status: Completed');
    if (VERBOSE) {
      console.log('\n--- Response ---');
      console.log(researchResult.result);
      console.log('--- End ---\n');
    } else {
      const preview = (researchResult.result as string)?.slice(0, 500) || '';
      console.log(`\n${preview}${preview.length >= 500 ? '...' : ''}\n`);
    }
    if (researchResult.metadata) {
      console.log(`📊 Tokens: ${researchResult.metadata.inputTokens} in / ${researchResult.metadata.outputTokens} out`);
    }
  } else {
    console.log(`❌ Status: Failed — ${researchResult.error}`);
  }

  // =============================================================================
  // Test 3: Concurrent execution
  // =============================================================================

  console.log('\n' + '─'.repeat(60));
  console.log('📝 Test 3: Concurrent Execution (2 tasks)');
  console.log('─'.repeat(60));

  const concurrentTasks = [
    {
      id: 'task-concurrent-1',
      type: 'code',
      priority: 'high' as const,
      description: 'Write a one-liner TypeScript arrow function that reverses a string.',
      status: 'pending' as const,
      createdAt: Date.now()
    },
    {
      id: 'task-concurrent-2',
      type: 'research',
      priority: 'medium' as const,
      description: 'In one sentence, what is the main advantage of TypeScript over JavaScript?',
      status: 'pending' as const,
      createdAt: Date.now()
    }
  ];

  console.log('\n📤 Executing concurrently...');
  const startConcurrent = Date.now();
  const concurrentResults = await coordinator.executeTasksConcurrently(concurrentTasks);
  const concurrentDuration = Date.now() - startConcurrent;

  console.log(`\n📥 Results (${concurrentDuration}ms total):`);
  for (const result of concurrentResults) {
    const status = result.status === 'completed' ? '✅' : '❌';
    console.log(`   ${status} ${result.taskId}: ${result.status}`);
    if (result.status === 'completed' && result.result) {
      const preview = (result.result as string).slice(0, 200);
      console.log(`      → ${preview.replace(/\n/g, ' ').slice(0, 100)}...`);
    }
  }

  // =============================================================================
  // Summary
  // =============================================================================

  console.log('\n' + '='.repeat(60));
  console.log('📊 Test Summary');
  console.log('='.repeat(60));

  const agents = await coordinator.listAgents();
  for (const agent of agents) {
    const metrics = await coordinator.getAgentMetrics(agent.id);
    console.log(`   ${agent.id}: ${metrics.tasksCompleted} completed, ${metrics.tasksFailed || 0} failed`);
  }

  // Cleanup
  await coordinator.shutdown();
  console.log('\n✅ Swarm shutdown complete');
}

// Run
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
