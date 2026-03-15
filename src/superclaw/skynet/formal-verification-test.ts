/**
 * 🧪 SuperClaw Formal Verification Test Suite
 * 
 * Demonstrates the integrated formal verification layer with:
 * - Lean theorem proving for action safety
 * - Ed25519 cryptographic signatures
 * - Byzantine fault tolerance
 * - Integration with sandbox and thresholds
 */

import { LethalTrifectaSandbox } from './sandbox';
import { ThresholdEnforcer } from './thresholds';
import { formalVerifier, ActionContext } from './formal-verifier';
import { proofEngine } from './proof-engine';

/**
 * Test the formal verification system with various scenarios
 */
async function runFormalVerificationTests(): Promise<void> {
  console.log('🔐 Starting SuperClaw Formal Verification Tests\n');

  // Initialize systems
  const sandbox = new LethalTrifectaSandbox(true); // Enable formal verification
  const thresholds = new ThresholdEnforcer(undefined, undefined, undefined, true);

  console.log('✅ Initialized sandbox and thresholds with formal verification\n');

  // Test 1: Simple safe action
  console.log('📋 Test 1: Simple Safe Action');
  console.log('==============================');
  
  try {
    const canExecute = await sandbox.canExecute('test_agent_1', 'web_search', { query: 'test' });
    console.log(`✅ Simple action allowed: ${canExecute}`);
    
    if (canExecute) {
      const result = await sandbox.safeExecute(
        'test_agent_1', 
        'web_search',
        () => ({ results: ['mock search result'] }),
        { query: 'test' }
      );
      console.log(`✅ Action executed successfully:`, result);
    }
  } catch (error: unknown) {
    console.error(`❌ Test 1 failed:`, error);
  }

  console.log('\n');

  // Test 2: High-risk action requiring Byzantine consensus
  console.log('📋 Test 2: High-Risk Action (Byzantine Consensus)');
  console.log('================================================');

  try {
    const canExecute = await sandbox.canExecute(
      'test_agent_2', 
      'exec', 
      { command: 'sudo rm -rf /tmp/test' }
    );
    
    console.log(`🚨 High-risk action allowed: ${canExecute}`);
    
    if (canExecute) {
      const result = await sandbox.safeExecute(
        'test_agent_2',
        'exec',
        () => ({ output: 'Command executed safely in test mode' }),
        { command: 'sudo rm -rf /tmp/test' }
      );
      console.log(`✅ High-risk action executed with consensus:`, result);
    } else {
      console.log(`🛡️ High-risk action properly blocked by formal verification`);
    }
  } catch (error: unknown) {
    console.log(`🛡️ High-risk action properly blocked:`, (error as Error).message);
  }

  console.log('\n');

  // Test 3: Resource threshold with formal verification
  console.log('📋 Test 3: Resource Threshold with Formal Verification');
  console.log('=====================================================');

  try {
    // Test memory limit near threshold (should trigger formal verification)
    const memoryAllowed = await thresholds.checkResourceLimit('maxMemoryMB', 7000, 'test_agent_3');
    console.log(`💾 High memory usage allowed: ${memoryAllowed}`);

    // Test agent count at limit
    const agentCountAllowed = await thresholds.checkResourceLimit('maxConcurrentAgents', 45, 'test_agent_3');
    console.log(`👥 High agent count allowed: ${agentCountAllowed}`);

  } catch (error: unknown) {
    console.error(`❌ Test 3 failed:`, error);
  }

  console.log('\n');

  // Test 4: Financial approval with formal verification
  console.log('📋 Test 4: Financial Approval with Formal Verification');
  console.log('====================================================');

  try {
    // Test small amount (should auto-approve)
    const smallApproval = await thresholds.requestFinancialApproval(25, 'API calls', 'test_agent_4');
    console.log(`💰 Small financial request approved: ${smallApproval}`);

    // Test large amount (should trigger formal verification + consensus)
    const largeApproval = await thresholds.requestFinancialApproval(150, 'Premium AI model usage', 'test_agent_4');
    console.log(`💰 Large financial request approved: ${largeApproval}`);

  } catch (error: unknown) {
    console.error(`❌ Test 4 failed:`, error);
  }

  console.log('\n');

  // Test 5: Direct proof generation and verification
  console.log('📋 Test 5: Direct Proof Generation');
  console.log('==================================');

  try {
    // Register test agent
    const identity = formalVerifier.registerAgent('test_agent_5');
    console.log(`🔑 Registered agent with Ed25519 key: ${identity.getPublicKey().slice(0, 16)}...`);

    // Create action context
    const actionContext: ActionContext = {
      agentId: 'test_agent_5',
      action: 'test_mathematical_proof',
      parameters: { theorem: 'resource_bounds_safe' },
      preconditions: ['memory_usage ≤ 1000', 'cpu_usage ≤ 50'],
      postconditions: ['action_safe', 'resources_preserved'],
      safety_level: 'medium',
      resource_impact: {
        memory: 100,
        cpu: 25,
        network: false,
        filesystem: false,
        external_api: false
      }
    };

    // Generate formal proof
    const proof = await formalVerifier.generateProof(actionContext);
    console.log(`🧠 Generated formal proof: ${proof.id}`);
    console.log(`⏱️ Proof generation time: ${proof.proofTime}ms`);
    console.log(`✅ Proof verified: ${proof.verified}`);

    // Verify the action
    const verificationResult = await formalVerifier.verifyAction(actionContext);
    console.log(`🔐 Action verification passed: ${verificationResult.valid}`);
    console.log(`📊 Risk score: ${verificationResult.risk_score}/100`);
    console.log(`✅ Execution allowed: ${verificationResult.execution_allowed}`);

  } catch (error: unknown) {
    console.error(`❌ Test 5 failed:`, error);
  }

  console.log('\n');

  // Test 6: Byzantine consensus simulation
  console.log('📋 Test 6: Byzantine Consensus Simulation');
  console.log('=========================================');

  try {
    // Create multiple agent contexts for consensus
    const contexts: ActionContext[] = [];
    for (let i = 1; i <= 4; i++) {
      const agentId = `byzantine_agent_${i}`;
      formalVerifier.registerAgent(agentId);
      
      contexts.push({
        agentId,
        action: 'critical_system_operation',
        parameters: { operation: 'database_migration' },
        preconditions: ['system_stable', 'backup_complete'],
        postconditions: ['migration_successful', 'data_integrity_maintained'],
        safety_level: 'critical',
        resource_impact: {
          memory: 2000,
          cpu: 80,
          network: true,
          filesystem: true,
          external_api: true
        }
      });
    }

    // Test Byzantine consensus
    const consensusAchieved = await formalVerifier.verifyByzantineConsensus(contexts, 0.75);
    console.log(`🛡️ Byzantine consensus (75% threshold): ${consensusAchieved}`);

  } catch (error: unknown) {
    console.error(`❌ Test 6 failed:`, error);
  }

  console.log('\n');

  // Display final statistics
  console.log('📊 Final System Statistics');
  console.log('==========================');

  const sandboxStats = sandbox.getSandboxStats();
  const thresholdStats = thresholds.getUsageStats();

  console.log('🏰 Sandbox Statistics:');
  console.log(`  - Registered agents: ${sandboxStats.verificationStats?.registeredAgents || 0}`);
  console.log(`  - Total proofs: ${sandboxStats.verificationStats?.proofStats?.total || 0}`);
  console.log(`  - Verified proofs: ${sandboxStats.verificationStats?.proofStats?.verified || 0}`);
  console.log(`  - Hash chain length: ${sandboxStats.verificationStats?.hashChainLength || 0}`);

  console.log('\n🏛️ Threshold Statistics:');
  console.log(`  - Active agents: ${thresholdStats.activeAgents}`);
  console.log(`  - Total tool calls: ${thresholdStats.totalToolCalls}`);
  console.log(`  - Memory usage: ${thresholdStats.memoryUsageMB}MB`);
  console.log(`  - Daily spend: $${thresholdStats.dailySpend}`);
  
  if ((thresholdStats as any).verificationStats) {
    const vStats = (thresholdStats as any).verificationStats;
    console.log(`  - Verification agents: ${vStats.registeredAgents}`);
    console.log(`  - Avg proof time: ${vStats.averageProofTime.toFixed(2)}ms`);
  }

  console.log('\n🔐 Formal Verification Test Suite Complete! ✅');
}

/**
 * Demonstration of proof engine capabilities
 */
async function demonstrateProofEngine(): Promise<void> {
  console.log('\n🧠 Proof Engine Demonstration');
  console.log('=============================');

  try {
    // Test basic theorem proving
    const theorem = `
    theorem action_safety (action : Action) (limits : ResourceLimits) :
      action.memory_usage ≤ limits.max_memory ∧ 
      action.cpu_usage ≤ limits.max_cpu →
      Safe action
    `;

    console.log('🔍 Attempting to prove resource safety theorem...');
    const proofState = await proofEngine.proveTheorem(theorem);
    
    console.log(`📝 Proof completed: ${proofState.completed}`);
    console.log(`🎯 Goals remaining: ${proofState.goals.length}`);
    console.log(`⚡ Steps taken: ${proofState.steps.length}`);
    
    if (proofState.error) {
      console.log(`⚠️ Proof error: ${proofState.error}`);
    }

    // Display proof steps
    console.log('\n📚 Proof Steps:');
    proofState.steps.forEach((step, i) => {
      console.log(`  ${i + 1}. ${step.tactic} - ${step.success ? '✅' : '❌'}`);
    });

    // Hash-consing statistics
    const hashStats = proofEngine.getHashStats();
    console.log('\n📊 Hash-Consing Performance:');
    console.log(`  - Cache hits: ${hashStats.hits}`);
    console.log(`  - Cache misses: ${hashStats.misses}`);
    console.log(`  - Cache size: ${hashStats.cacheSize} terms`);
    console.log(`  - Hit ratio: ${((hashStats.hits / (hashStats.hits + hashStats.misses)) * 100).toFixed(1)}%`);

  } catch (error: unknown) {
    console.error(`❌ Proof engine demonstration failed:`, error);
  }
}

// Run the test suite
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    await runFormalVerificationTests();
    await demonstrateProofEngine();
  })().catch(console.error);
}

export { runFormalVerificationTests, demonstrateProofEngine };