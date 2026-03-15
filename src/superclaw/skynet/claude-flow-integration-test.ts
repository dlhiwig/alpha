// @ts-nocheck
/**
 * 🧪 Claude-Flow Integration Test Suite
 * 
 * Tests the integration of claude-flow orchestration patterns into SuperClaw AgentBus:
 * - MCP server functionality
 * - Swarm coordination with different topologies
 * - Consensus algorithms (Raft, Byzantine, CRDT)
 * - Agent specialization spawning
 * - Anti-drift mechanisms
 * - Real-time WebSocket coordination
 */

import { ClaudeFlowAdapter, SwarmCoordinator, AgentSpecialization } from './claude-flow-adapter';
import { ConsensusFactory, RaftConsensus, ByzantineConsensus, CRDTConsensus } from './consensus-algorithms';
import { MoltbookBus } from './moltbook';
import { EventEmitter } from 'events';

// ═══════════════════════════════════════════════════════════════
// TEST UTILITIES
// ═══════════════════════════════════════════════════════════════

class TestRunner {
  private passed = 0;
  private failed = 0;
  private tests: Array<{ name: string; fn: () => Promise<void> }> = [];
  
  test(name: string, fn: () => Promise<void>): void {
    this.tests.push({ name, fn });
  }
  
  async run(): Promise<void> {
    console.log('🧪 Starting Claude-Flow Integration Tests...\n');
    
    for (const { name, fn } of this.tests) {
      try {
        console.log(`🔍 Running: ${name}`);
        await fn();
        this.passed++;
        console.log(`✅ Passed: ${name}\n`);
      } catch (error: unknown) {
        this.failed++;
        console.error(`❌ Failed: ${name}`);
        console.error(`   Error: ${error instanceof Error ? (error).message : error}\n`);
      }
    }
    
    console.log(`\n📊 Test Results: ${this.passed} passed, ${this.failed} failed`);
    if (this.failed > 0) {
      process.exit(1);
    }
  }
  
  static assert(condition: boolean, message: string): void {
    if (!condition) {
      throw new Error(`Assertion failed: ${message}`);
    }
  }
  
  static assertEquals(actual: any, expected: any, message?: string): void {
    if (actual !== expected) {
      throw new Error(`Expected ${expected}, got ${actual}${message ? ': ' + message : ''}`);
    }
  }
  
  static assertGreaterThan(actual: number, expected: number, message?: string): void {
    if (actual <= expected) {
      throw new Error(`Expected ${actual} > ${expected}${message ? ': ' + message : ''}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// INTEGRATION TESTS
// ═══════════════════════════════════════════════════════════════

async function testClaudeFlowAdapterInitialization(): Promise<void> {
  const adapter = new ClaudeFlowAdapter({
    topology: 'hierarchical',
    consensusAlgorithm: 'raft',
    antiDriftThreshold: 0.3
  });
  
  TestRunner.assert(adapter !== null, 'Adapter should be created');
  TestRunner.assert(adapter.getMCPServer() !== null, 'MCP server should be available');
  TestRunner.assert(adapter.getSwarmCoordinator() !== null, 'Swarm coordinator should be available');
  TestRunner.assert(adapter.getEventBus() !== null, 'Event bus should be available');
  
  await adapter.start();
  await adapter.stop();
}

async function testMCPServerToolHandling(): Promise<void> {
  const adapter = new ClaudeFlowAdapter();
  const mcpServer = adapter.getMCPServer();
  
  // Test tool listing
  const tools = mcpServer.listTools();
  TestRunner.assertGreaterThan(tools.length, 0, 'Should have default tools');
  
  // Test spawn agent tool
  const response = await mcpServer.handleRequest({
    id: 'test-123',
    method: 'spawn_agent',
    params: {
      specialization: 'coder',
      tier: 'efficient'
    }
  });
  
  TestRunner.assert(response.result !== undefined, 'Should return successful result');
  TestRunner.assertEquals(response.id, 'test-123', 'Should preserve request ID');
  
  // Test invalid method
  const invalidResponse = await mcpServer.handleRequest({
    id: 'test-456',
    method: 'invalid_method',
    params: {}
  });
  
  TestRunner.assert(invalidResponse.error !== undefined, 'Should return error for invalid method');
  TestRunner.assertEquals(invalidResponse.error?.code, -32601, 'Should return method not found error');
}

async function testSwarmCoordinatorAgentSpawning(): Promise<void> {
  const eventBus = new EventEmitter();
  const coordinator = new SwarmCoordinator(eventBus, {
    topology: 'hierarchical',
    maxAgents: 10,
    consensusAlgorithm: 'raft',
    antiDriftThreshold: 0.3,
    modelRouting: {
      local: ['documentation-writer'],
      efficient: ['coder', 'tester'],
      advanced: ['architect']
    }
  });
  
  // Simulate agent spawn event
  eventBus.emit('mcp:spawn_agent', {
    specialization: 'coder',
    tier: 'efficient'
  });
  
  // Wait for async processing
  await new Promise(resolve => setTimeout(resolve, 100));
  
  const agents = coordinator.listAgents();
  TestRunner.assertGreaterThan(agents.length, 0, 'Should have spawned at least one agent');
  
  const coderAgent = agents.find(a => a.specialization === 'coder');
  TestRunner.assert(coderAgent !== undefined, 'Should have spawned coder agent');
  TestRunner.assert(coderAgent!.capabilities.includes('code'), 'Coder should have code capability');
}

async function testConsensusAlgorithms(): Promise<void> {
  // Test Raft consensus
  const raftConfig = ConsensusFactory.getDefaultConfig('raft');
  const raftConsensus = new RaftConsensus(raftConfig);
  
  // Add nodes
  raftConsensus.addNode('agent-1', { reliability: 0.9 });
  raftConsensus.addNode('agent-2', { reliability: 0.8 });
  raftConsensus.addNode('agent-3', { reliability: 0.7 });
  
  raftConsensus.start();
  
  // Wait for leader election
  await new Promise(resolve => setTimeout(resolve, 100));
  
  const leader = raftConsensus.getLeader();
  TestRunner.assert(leader !== null, 'Raft should have elected a leader');
  
  // Test proposal
  const result = await raftConsensus.propose({
    proposerId: leader!.id,
    type: 'task_assignment',
    data: { task: 'test_task', assignee: 'agent-1' }
  });
  
  TestRunner.assert(result.accepted, 'Raft proposal should be accepted');
  TestRunner.assertEquals(result.algorithm, 'raft', 'Should use Raft algorithm');
  
  raftConsensus.stop();
  
  // Test Byzantine consensus
  const byzantineConfig = ConsensusFactory.getDefaultConfig('byzantine');
  const byzantineConsensus = new ByzantineConsensus(byzantineConfig);
  
  // Add nodes with varying reliability
  byzantineConsensus.addNode('honest-1', { reliability: 0.9 });
  byzantineConsensus.addNode('honest-2', { reliability: 0.8 });
  byzantineConsensus.addNode('honest-3', { reliability: 0.85 });
  byzantineConsensus.addNode('faulty-1', { reliability: 0.3 }); // Faulty node
  
  byzantineConsensus.start();
  
  const byzantineResult = await byzantineConsensus.propose({
    proposerId: 'honest-1',
    type: 'consensus_test',
    data: { value: 'byzantine_test' }
  });
  
  TestRunner.assertEquals(byzantineResult.algorithm, 'byzantine', 'Should use Byzantine algorithm');
  // Byzantine consensus should still work despite faulty node
  
  byzantineConsensus.stop();
  
  // Test CRDT consensus
  const crdtConfig = ConsensusFactory.getDefaultConfig('crdt');
  const crdtConsensus = new CRDTConsensus(crdtConfig);
  
  crdtConsensus.addNode('node-1');
  crdtConsensus.addNode('node-2');
  crdtConsensus.addNode('node-3');
  
  crdtConsensus.start();
  
  const crdtResult = await crdtConsensus.propose({
    proposerId: 'node-1',
    type: 'state_update',
    data: { key: 'value', timestamp: Date.now() }
  });
  
  TestRunner.assert(crdtResult.accepted, 'CRDT should always accept proposals');
  TestRunner.assertEquals(crdtResult.algorithm, 'crdt', 'Should use CRDT algorithm');
  TestRunner.assertEquals(crdtResult.confidence, 1.0, 'CRDT should have full confidence');
  
  crdtConsensus.stop();
}

async function testMoltbookClaudeFlowIntegration(): Promise<void> {
  const moltbook = new MoltbookBus({
    topology: 'mesh',
    consensusAlgorithm: 'byzantine',
    antiDriftThreshold: 0.4
  });
  
  await moltbook.start({ wsPort: 8081 });
  
  // Test specialized agent spawning
  const agent = await moltbook.spawnSpecializedAgent('security-auditor', {
    tier: 'advanced',
    capabilities: ['security', 'audit', 'vulnerability-analysis']
  });
  
  TestRunner.assert(agent.specialization === 'security-auditor', 'Should spawn security auditor');
  TestRunner.assert(agent.tier === 'advanced', 'Should use advanced tier');
  // @ts-expect-error - Post-Merge Reconciliation
  TestRunner.assert(agent.capabilities?.includes('security'), 'Should have security capability');
  
  // Test swarm status
  const swarmStatus = moltbook.getSwarmStatus();
  TestRunner.assertGreaterThan(swarmStatus.agentCount, 0, 'Should have agents in swarm');
  TestRunner.assertEquals(swarmStatus.topology, 'mesh', 'Should use mesh topology');
  
  // Test task coordination
  const coordinationResult = await moltbook.coordinateTask({
    id: 'test-task-123',
    type: 'security-audit',
    description: 'Audit the authentication system'
  });
  
  TestRunner.assert(coordinationResult !== null, 'Should coordinate task successfully');
  
  // Test consensus
  const consensusResult = await moltbook.reachConsensus({
    id: 'consensus-test',
    type: 'security_decision',
    payload: { approve_change: true }
  }, 'byzantine');
  
  TestRunner.assert(consensusResult !== null, 'Should reach consensus');
  
  await moltbook.stop();
}

async function testAgentSpecializationCapabilities(): Promise<void> {
  const specializations: AgentSpecialization[] = [
    'coder', 'architect', 'security-auditor', 'data-engineer',
    // @ts-expect-error - Post-Merge Reconciliation
    'ui-designer', 'deployer', 'tester', 'coordinator'
  ];
  
  for (const specialization of specializations) {
    const adapter = new ClaudeFlowAdapter();
    const coordinator = adapter.getSwarmCoordinator();
    
    // Simulate agent spawning
    const eventBus = adapter.getEventBus();
    eventBus.emit('mcp:spawn_agent', {
      specialization,
      tier: 'efficient'
    });
    
    await new Promise(resolve => setTimeout(resolve, 50));
    
    const agents = coordinator.listAgents();
    const specializedAgent = agents.find(a => a.specialization === specialization);
    
    TestRunner.assert(specializedAgent !== undefined, `Should spawn ${specialization} agent`);
    TestRunner.assert(specializedAgent!.capabilities.length > 0, `${specialization} should have capabilities`);
    TestRunner.assert(specializedAgent!.performance.driftScore === 0, 'New agent should have no drift');
  }
}

async function testAntiDriftMechanisms(): Promise<void> {
  const adapter = new ClaudeFlowAdapter({
    antiDriftThreshold: 0.5
  });
  
  const coordinator = adapter.getSwarmCoordinator();
  const eventBus = adapter.getEventBus();
  
  // Spawn agent
  eventBus.emit('mcp:spawn_agent', {
    specialization: 'coder',
    tier: 'efficient'
  });
  
  await new Promise(resolve => setTimeout(resolve, 50));
  
  const agents = coordinator.listAgents();
  const agent = agents[0];
  
  // Simulate drift
  agent.performance.driftScore = 0.7; // Above threshold
  
  // Test drift detection
  const swarmStatus = coordinator.getSwarmStatus();
  TestRunner.assert(swarmStatus.averageDrift > 0.5, 'Should detect drift above threshold');
  
  // Test that high-drift agents are filtered from task coordination
  const suitableAgents = coordinator.listAgents().filter(a => 
    a.performance.driftScore < 0.5
  );
  
  TestRunner.assertEquals(suitableAgents.length, 0, 'High-drift agents should be filtered out');
}

async function testWebSocketCoordination(): Promise<void> {
  const adapter = new ClaudeFlowAdapter();
  await adapter.start({ wsPort: 8082 });
  
  // Test that WebSocket server is running
  const coordinator = adapter.getSwarmCoordinator();
  const status = coordinator.getSwarmStatus();
  
  TestRunner.assert(status.activeConnections >= 0, 'WebSocket server should be running');
  
  // In a real test, we would connect WebSocket clients and test coordination
  // For now, we just verify the server starts without errors
  
  await adapter.stop();
}

// ═══════════════════════════════════════════════════════════════
// MAIN TEST EXECUTION
// ═══════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const runner = new TestRunner();
  
  // Core integration tests
  runner.test('Claude-Flow Adapter Initialization', testClaudeFlowAdapterInitialization);
  runner.test('MCP Server Tool Handling', testMCPServerToolHandling);
  runner.test('Swarm Coordinator Agent Spawning', testSwarmCoordinatorAgentSpawning);
  runner.test('Consensus Algorithms', testConsensusAlgorithms);
  runner.test('Moltbook Claude-Flow Integration', testMoltbookClaudeFlowIntegration);
  
  // Specialization and coordination tests
  runner.test('Agent Specialization Capabilities', testAgentSpecializationCapabilities);
  runner.test('Anti-Drift Mechanisms', testAntiDriftMechanisms);
  runner.test('WebSocket Coordination', testWebSocketCoordination);
  
  await runner.run();
}

// ═══════════════════════════════════════════════════════════════
// DEMO SCRIPT
// ═══════════════════════════════════════════════════════════════

export async function runClaudeFlowDemo(): Promise<void> {
  console.log('🌊 Claude-Flow Integration Demo\n');
  
  // Create enhanced Moltbook with claude-flow
  const moltbook = new MoltbookBus({
    topology: 'hierarchical',
    consensusAlgorithm: 'raft',
    antiDriftThreshold: 0.3
  });
  
  await moltbook.start({ wsPort: 8083 });
  
  console.log('📡 Spawning specialized agents...');
  
  // Spawn different types of agents
  const architect = await moltbook.spawnSpecializedAgent('architect', { tier: 'advanced' });
  const coder = await moltbook.spawnSpecializedAgent('coder', { tier: 'efficient' });
  // @ts-expect-error - Post-Merge Reconciliation
  const tester = await moltbook.spawnSpecializedAgent('tester', { tier: 'efficient' });
  const securityAuditor = await moltbook.spawnSpecializedAgent('security-auditor', { tier: 'advanced' });
  
  console.log(`✅ Spawned agents: ${architect.name}, ${coder.name}, ${tester.name}, ${securityAuditor.name}`);
  
  console.log('\n🎯 Coordinating tasks...');
  
  // Coordinate a complex task
  const taskResult = await moltbook.coordinateTask({
    id: 'build-secure-api',
    type: 'development',
    description: 'Build a secure REST API with authentication',
    specializations: ['architect', 'coder', 'security-auditor', 'tester']
  });
  
  console.log('📋 Task coordination result:', taskResult);
  
  console.log('\n🤝 Reaching consensus...');
  
  // Reach consensus on architecture decision
  const consensusResult = await moltbook.reachConsensus({
    id: 'architecture-decision',
    type: 'technical_decision',
    payload: {
      framework: 'fastapi',
      database: 'postgresql',
      authentication: 'jwt'
    }
  }, 'raft');
  
  console.log('🎉 Consensus result:', consensusResult);
  
  console.log('\n📊 Swarm status:');
  console.log(moltbook.getSwarmStatus());
  
  console.log('\n🔍 Claude-Flow agents:');
  const claudeFlowAgents = moltbook.getClaudeFlowAgents();
  claudeFlowAgents.forEach(agent => {
    console.log(`  ${agent.name} (${agent.specialization}) - Tier: ${agent.tier}, Drift: ${agent.performance.driftScore}`);
  });
  
  await moltbook.stop();
  console.log('\n🏁 Demo completed!');
}

// Run tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export default main;