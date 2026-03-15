// @ts-nocheck
/**
 * Quick test script for persistence layer
 * Run with: npx ts-node src/persistence/test-db.ts
 */

import { SuperClawDB } from './db';
import { unlinkSync, existsSync } from 'fs';
import { join } from 'path';

const TEST_DB = join(__dirname, '../../data/test-persistence.db');

async function runTests() {
  console.log('🧪 Testing SuperClaw Persistence Layer\n');
  
  // Clean up
  if (existsSync(TEST_DB)) {
    unlinkSync(TEST_DB);
  }
  
  const db = new SuperClawDB(TEST_DB);
  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => boolean) {
    try {
      if (fn()) {
        console.log(`✅ ${name}`);
        passed++;
      } else {
        console.log(`❌ ${name}`);
        failed++;
      }
    } catch (e) {
      console.log(`❌ ${name}: ${e}`);
      failed++;
    }
  }

  // Test 1: Create and retrieve run
  test('Create and retrieve swarm run', () => {
    const run = db.createRun('Test task', { priority: 'high' });
    const retrieved = db.getRun(run.id);
    return retrieved?.task === 'Test task' && retrieved?.status === 'pending';
  });

  // Test 2: Update run status
  test('Update run status', () => {
    const run = db.createRun('Status test');
    db.updateRunStatus(run.id, 'running');
    const updated = db.getRun(run.id);
    return updated?.status === 'running' && updated?.startedAt !== undefined;
  });

  // Test 3: Complete run with result
  test('Complete run with result', () => {
    const run = db.createRun('Complete test');
    db.updateRunStatus(run.id, 'running');
    db.updateRunStatus(run.id, 'completed', { result: { success: true } });
    const updated = db.getRun(run.id);
    return updated?.status === 'completed' && updated?.result?.success === true;
  });

  // Test 4: Agent execution tracking
  test('Track agent execution', () => {
    const run = db.createRun('Agent test');
    const exec = db.createExecution(run.id, 'researcher', 'Research AI');
    db.completeExecution(exec.id, {
      model: 'claude-3-haiku',
      tier: 2,
      status: 'completed',
      result: { findings: ['a', 'b'] },
      inputTokens: 100,
      outputTokens: 500,
      costUsd: 0.0002,
    });
    const executions = db.getExecutionsForRun(run.id);
    return executions.length === 1 && executions[0].model === 'claude-3-haiku';
  });

  // Test 5: Cost tracking
  test('Record and aggregate costs', () => {
    db.recordCost(1, 0, 0, 0, 0.003);
    db.recordCost(2, 100, 500, 0.0002, 0);
    db.recordCost(3, 500, 2000, 0.015, 0);
    const summary = db.getCostSummary(1);
    return summary.total.tier1Count >= 1 && summary.total.tier2Count >= 1;
  });

  // Test 6: SONA patterns
  test('Upsert and retrieve patterns', () => {
    db.upsertPattern({
      patternHash: 'test-pattern-1',
      patternType: 'code',
      patternName: 'var-to-const',
      successCount: 5,
      failureCount: 1,
      avgQuality: 0.85,
    });
    const patterns = db.getTopPatterns('code', 10);
    return patterns.some(p => p.patternHash === 'test-pattern-1');
  });

  // Test 7: Trajectories
  test('Save and retrieve trajectories', () => {
    const run = db.createRun('Trajectory test');
    db.saveTrajectory({
      id: 'traj-test-1',
      runId: run.id,
      taskHash: 'hash123',
      outcome: 'success',
      qualityScore: 0.9,
      learned: false,
    });
    const unlearned = db.getUnlearnedTrajectories(10);
    const found = unlearned.some(t => t.id === 'traj-test-1');
    db.markTrajectoriesLearned(['traj-test-1']);
    const afterMark = db.getUnlearnedTrajectories(10);
    return found && !afterMark.some(t => t.id === 'traj-test-1');
  });

  // Test 8: Routing decisions
  test('Record and evaluate routing decisions', () => {
    const decisionId = db.recordRoutingDecision({
      taskPreview: 'Simple task',
      complexityScore: 0.2,
      selectedTier: 2,
      reason: 'keyword match',
    });
    db.evaluateRoutingDecision(decisionId, true);
    const accuracy = db.getRoutingAccuracy();
    return accuracy.correct >= 1;
  });

  // Test 9: Stats
  test('Get database stats', () => {
    const stats = db.getStats();
    return stats.swarm_runs >= 1 && stats.agent_executions >= 1;
  });

  // Summary
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
  
  // Cleanup
  db.close();
  if (existsSync(TEST_DB)) {
    unlinkSync(TEST_DB);
  }

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(console.error);
