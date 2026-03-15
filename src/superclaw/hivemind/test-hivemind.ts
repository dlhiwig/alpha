#!/usr/bin/env npx tsx
// @ts-nocheck
/**
 * Hivemind Test Script
 * 
 * Demonstrates the multi-model orchestration capabilities.
 */

import { HivemindCoordinator } from './coordinator';
import { CLIAgent } from './cli-agent';

async function main() {
  console.log('═'.repeat(60));
  console.log('🧠 SUPERCLAW HIVEMIND TEST');
  console.log('═'.repeat(60));

  // Check available agents
  console.log('\n📡 Detecting available AI agents...');
  const available = await CLIAgent.getAvailable();
  console.log(`   Found: ${available.length > 0 ? available.join(', ') : 'none'}`);

  if (available.length === 0) {
    console.log('\n⚠️  No AI CLI tools found.');
    console.log('   Install one of: claude, codex, gemini, ollama');
    process.exit(1);
  }

  // Initialize hivemind
  const hivemind = new HivemindCoordinator({
    preferredStrategy: 'best',
    timeout: 60000
  });

  await hivemind.initialize();

  // ============================================================================
  // Test 1: Simple task (routed to fastest/cheapest)
  // ============================================================================

  console.log('\n' + '─'.repeat(60));
  console.log('📝 Test 1: Simple Task (auto-routed)');
  console.log('─'.repeat(60));

  const simpleResult = await hivemind.execute({
    id: 'test-simple',
    prompt: 'What is 2 + 2? Answer in one word.'
  });

  console.log('\n📤 Output:');
  console.log(simpleResult.output.slice(0, 200));
  console.log(`\n⏱  Duration: ${simpleResult.totalDurationMs}ms`);
  console.log(`🎯 Routed to: ${simpleResult.routing.primary}`);

  // ============================================================================
  // Test 2: Code task (should route to codex or claude)
  // ============================================================================

  console.log('\n' + '─'.repeat(60));
  console.log('📝 Test 2: Code Task');
  console.log('─'.repeat(60));

  const codeResult = await hivemind.execute({
    id: 'test-code',
    prompt: 'Write a TypeScript function that checks if a string is a palindrome. Keep it short.',
    metadata: { type: 'code', complexity: 'low' }
  });

  console.log('\n📤 Output:');
  console.log(codeResult.output.slice(0, 500));
  console.log(`\n⏱  Duration: ${codeResult.totalDurationMs}ms`);
  console.log(`🎯 Routed to: ${codeResult.routing.primary}`);

  // ============================================================================
  // Test 3: Consensus mode (if multiple agents available)
  // ============================================================================

  if (available.length >= 2) {
    console.log('\n' + '─'.repeat(60));
    console.log('📝 Test 3: Consensus Mode (multiple agents)');
    console.log('─'.repeat(60));

    const consensusResult = await hivemind.execute({
      id: 'test-consensus',
      prompt: 'Should I use Redux or Zustand for a medium-sized React app? Give a one-sentence recommendation.',
      strategy: 'consensus'
    });

    console.log('\n📤 Output:');
    console.log(consensusResult.output.slice(0, 500));
    console.log(`\n⏱  Duration: ${consensusResult.totalDurationMs}ms`);
    
    if (consensusResult.consensus) {
      console.log(`🤝 Consensus method: ${consensusResult.consensus.method}`);
      console.log(`📊 Confidence: ${(consensusResult.consensus.confidence * 100).toFixed(0)}%`);
      console.log('👥 Contributions:');
      for (const c of consensusResult.consensus.contributions) {
        console.log(`   ${c.selected ? '✓' : '○'} ${c.agentId} (weight: ${c.weight.toFixed(2)})`);
      }
      if (consensusResult.consensus.conflicts?.length) {
        console.log('⚠️  Conflicts:');
        consensusResult.consensus.conflicts.forEach(c => console.log(`   - ${c}`));
      }
    }
  }

  // ============================================================================
  // Test 4: Pipeline mode (if multiple agents available)
  // ============================================================================

  if (available.length >= 2) {
    console.log('\n' + '─'.repeat(60));
    console.log('📝 Test 4: Pipeline Mode (sequential)');
    console.log('─'.repeat(60));

    const pipelineResult = await hivemind.execute({
      id: 'test-pipeline',
      prompt: 'First research best practices for error handling in TypeScript, then write a simple error handler class.',
      strategy: 'pipeline',
      metadata: {
        type: 'code',
        complexity: 'medium',
        requiresCode: true,
        requiresResearch: true,
        requiresReasoning: false,
        sensitive: false
      }
    });

    console.log('\n📤 Final Output (last 500 chars):');
    console.log(pipelineResult.output.slice(-500));
    console.log(`\n⏱  Total Duration: ${pipelineResult.totalDurationMs}ms`);
    console.log(`📊 Pipeline steps: ${pipelineResult.agentResults.length}`);
    pipelineResult.agentResults.forEach((r, i) => {
      console.log(`   ${i + 1}. ${r.agentType}: ${r.response.durationMs}ms`);
    });
  }

  // ============================================================================
  // Summary
  // ============================================================================

  console.log('\n' + '═'.repeat(60));
  console.log('📊 SUMMARY');
  console.log('═'.repeat(60));
  console.log(`Available agents: ${available.join(', ')}`);
  console.log(`Tests completed: ${available.length >= 2 ? 4 : 2}`);

  await hivemind.shutdown();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
