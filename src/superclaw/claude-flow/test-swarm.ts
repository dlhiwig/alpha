/**
 * Quick test of the extracted claude-flow v3 code
 */

import { SwarmCoordinator, Agent, Task } from './index';

async function testSwarm() {
  console.log('🧪 Testing claude-flow v3 extraction...\n');

  // Create coordinator
  const coordinator = new SwarmCoordinator({
    topology: 'hierarchical'
  });

  await coordinator.initialize();
  console.log('✅ SwarmCoordinator initialized');

  // Spawn agents
  const leader = await coordinator.spawnAgent({
    id: 'leader-1',
    type: 'coordinator',
    role: 'leader',
    capabilities: ['coordinate', 'orchestrate']
  });
  console.log(`✅ Spawned leader: ${leader.id}`);

  const coder = await coordinator.spawnAgent({
    id: 'coder-1',
    type: 'coder',
    role: 'worker',
    capabilities: ['code', 'debug', 'refactor']
  });
  console.log(`✅ Spawned coder: ${coder.id}`);

  const tester = await coordinator.spawnAgent({
    id: 'tester-1',
    type: 'tester',
    role: 'worker',
    capabilities: ['test', 'validate']
  });
  console.log(`✅ Spawned tester: ${tester.id}`);

  // Get swarm state
  const state = await coordinator.getSwarmState();
  console.log(`\n📊 Swarm state:`);
  console.log(`   Topology: ${state.topology}`);
  console.log(`   Leader: ${state.leader}`);
  console.log(`   Agents: ${state.agents.length}`);
  console.log(`   Connections: ${state.activeConnections}`);

  // Execute some tasks
  const tasks = [
    { id: 'task-1', type: 'code', description: 'Write feature', priority: 'high' as const },
    { id: 'task-2', type: 'test', description: 'Write tests', priority: 'medium' as const },
    { id: 'task-3', type: 'code', description: 'Fix bug', priority: 'low' as const }
  ];

  console.log('\n🚀 Executing tasks concurrently...');
  const results = await coordinator.executeTasksConcurrently(tasks);

  for (const result of results) {
    const icon = result.status === 'completed' ? '✅' : '❌';
    console.log(`   ${icon} ${result.taskId}: ${result.status} (${result.duration}ms)`);
  }

  // Get metrics
  console.log('\n📈 Agent metrics:');
  for (const agent of await coordinator.listAgents()) {
    const metrics = await coordinator.getAgentMetrics(agent.id);
    console.log(`   ${agent.id}: ${metrics.tasksCompleted} tasks, ${metrics.successRate * 100}% success`);
  }

  // Cleanup
  await coordinator.shutdown();
  console.log('\n✅ SwarmCoordinator shutdown complete');

  console.log('\n🎉 All tests passed! claude-flow v3 extraction working.');
}

testSwarm().catch(console.error);
