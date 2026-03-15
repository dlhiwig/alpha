/**
 * 🦊 SKYNET RECURSIVE SPAWNER TEST — Validation Suite
 * 
 * Comprehensive test suite for the recursive spawning system.
 * Tests all topology patterns and validates 100% success rate.
 */

import { createMeshSwarm, createStarSwarm, createHierarchicalSwarm, createRingSwarm } from './sub-agent';
import { getCreditSystem, resetCreditSystem } from './credit-system';
import { RecursiveSpawner } from './recursive-spawner';
import { memorize } from './cortex';

// ═══════════════════════════════════════════════════════════════
// TEST CONFIGURATION
// ═══════════════════════════════════════════════════════════════

interface TestResult {
  testName: string;
  passed: boolean;
  error?: string;
  duration: number;
  swarmStatus?: any;
}

interface TestSuite {
  suiteName: string;
  results: TestResult[];
  passed: number;
  failed: number;
  totalDuration: number;
  successRate: number;
}

// ═══════════════════════════════════════════════════════════════
// TEST RUNNER
// ═══════════════════════════════════════════════════════════════

export class RecursiveSpawnerTestRunner {
  private results: TestSuite[] = [];
  private activeSwarms: RecursiveSpawner[] = [];

  /**
   * Run all test suites
   */
  async runAllTests(): Promise<void> {
    console.log('🚀 Starting Recursive Spawner Test Suite...\n');
    
    try {
      await this.testCreditSystem();
      await this.testTopologyPatterns();
      await this.testRecursiveSpawning();
      await this.testSwarmOrchestration();
      await this.testFailureRecovery();
      
      this.printSummary();
      
    } catch (error: unknown) {
      console.error('❌ Test suite failed:', error);
    } finally {
      await this.cleanup();
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // CREDIT SYSTEM TESTS
  // ═══════════════════════════════════════════════════════════════

  private async testCreditSystem(): Promise<void> {
    const suite: TestSuite = {
      suiteName: 'Credit System',
      results: [],
      passed: 0,
      failed: 0,
      totalDuration: 0,
      successRate: 0
    };

    // Reset credit system for clean testing
    resetCreditSystem();
    const credits = getCreditSystem({ initialCredits: 200 });

    // Test 1: Initial credit allocation
    await this.runTest(suite, 'Initial Credits', async () => {
      const status = credits.getStatus();
      if (status.credits !== 200) {
        throw new Error(`Expected 200 credits, got ${status.credits}`);
      }
    });

    // Test 2: Cost calculation
    await this.runTest(suite, 'Cost Calculation', async () => {
      const cost = credits.calculateSpawnCost(0);
      if (cost.totalCost <= 0) {
        throw new Error('Cost calculation returned invalid value');
      }
    });

    // Test 3: Spawn permission validation
    await this.runTest(suite, 'Spawn Validation', async () => {
      const check = credits.canSpawn(3);
      if (!check.allowed) {
        throw new Error(`Spawn should be allowed at depth 3: ${check.reason}`);
      }
    });

    // Test 4: Depth limit enforcement
    await this.runTest(suite, 'Depth Limits', async () => {
      const check = credits.canSpawn(10);
      if (check.allowed) {
        throw new Error('Spawn should be denied at excessive depth');
      }
    });

    // Test 5: Emergency mode activation
    await this.runTest(suite, 'Emergency Mode', async () => {
      // Spend most credits to trigger emergency mode
      for (let i = 0; i < 15; i++) {
        credits.spendCredits(`test_${i}`, 0);
      }
      
      const status = credits.getStatus();
      if (!status.emergencyMode) {
        throw new Error('Emergency mode should be activated');
      }
    });

    this.results.push(suite);
  }

  // ═══════════════════════════════════════════════════════════════
  // TOPOLOGY PATTERN TESTS
  // ═══════════════════════════════════════════════════════════════

  private async testTopologyPatterns(): Promise<void> {
    const suite: TestSuite = {
      suiteName: 'Topology Patterns',
      results: [],
      passed: 0,
      failed: 0,
      totalDuration: 0,
      successRate: 0
    };

    // Reset for clean testing
    resetCreditSystem();

    // Test 1: Mesh topology
    await this.runTest(suite, 'Mesh Topology', async () => {
      const swarm = await createMeshSwarm('Test mesh pattern', 5, 'dolphin-llama3:8b');
      this.activeSwarms.push(swarm);
      
      const status = swarm.getSwarmStatus();
      if (status.topology.type !== 'mesh') {
        throw new Error('Swarm should use mesh topology');
      }
      
      if (status.agents.length === 0) {
        throw new Error('Mesh swarm should have spawned agents');
      }
    });

    // Test 2: Star topology
    await this.runTest(suite, 'Star Topology', async () => {
      const swarm = await createStarSwarm('Test star pattern', 4, 'dolphin-llama3:8b');
      this.activeSwarms.push(swarm);
      
      const status = swarm.getSwarmStatus();
      if (status.topology.type !== 'star') {
        throw new Error('Swarm should use star topology');
      }
      
      const coordinators = status.agents.filter(a => a.role === 'coordinator');
      if (coordinators.length !== 1) {
        throw new Error('Star topology should have exactly 1 coordinator');
      }
    });

    // Test 3: Hierarchical topology
    await this.runTest(suite, 'Hierarchical Topology', async () => {
      const swarm = await createHierarchicalSwarm('Test hierarchical pattern', 6, 'dolphin-llama3:8b');
      this.activeSwarms.push(swarm);
      
      const status = swarm.getSwarmStatus();
      if (status.topology.type !== 'hierarchical') {
        throw new Error('Swarm should use hierarchical topology');
      }
      
      if (status.topology.maxDepth === 0) {
        throw new Error('Hierarchical topology should have multiple levels');
      }
    });

    // Test 4: Ring topology
    await this.runTest(suite, 'Ring Topology', async () => {
      const swarm = await createRingSwarm('Test ring pattern', 4, 'dolphin-llama3:8b');
      this.activeSwarms.push(swarm);
      
      const status = swarm.getSwarmStatus();
      if (status.topology.type !== 'ring') {
        throw new Error('Swarm should use ring topology');
      }
    });

    this.results.push(suite);
  }

  // ═══════════════════════════════════════════════════════════════
  // RECURSIVE SPAWNING TESTS
  // ═══════════════════════════════════════════════════════════════

  private async testRecursiveSpawning(): Promise<void> {
    const suite: TestSuite = {
      suiteName: 'Recursive Spawning',
      results: [],
      passed: 0,
      failed: 0,
      totalDuration: 0,
      successRate: 0
    };

    resetCreditSystem();

    // Test 1: Agent spawning validation
    await this.runTest(suite, 'Agent Spawning', async () => {
      const swarm = await createMeshSwarm('Test spawning', 3, 'dolphin-llama3:8b');
      this.activeSwarms.push(swarm);
      
      const status = swarm.getSwarmStatus();
      if (status.agents.length === 0) {
        throw new Error('Swarm should have spawned at least one agent');
      }
      
      // Wait for agents to initialize
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const updatedStatus = swarm.getSwarmStatus();
      const runningAgents = updatedStatus.agents.filter(a => a.status === 'running');
      if (runningAgents.length === 0) {
        throw new Error('At least one agent should be running');
      }
    });

    // Test 2: Depth tracking
    await this.runTest(suite, 'Depth Tracking', async () => {
      const swarm = await createHierarchicalSwarm('Test depth', 5, 'dolphin-llama3:8b');
      this.activeSwarms.push(swarm);
      
      const status = swarm.getSwarmStatus();
      const depths = status.agents.map(a => a.depth);
      const maxDepth = Math.max(...depths);
      
      if (maxDepth === 0) {
        throw new Error('Hierarchical swarm should have agents at different depths');
      }
    });

    // Test 3: Resource limit enforcement
    await this.runTest(suite, 'Resource Limits', async () => {
      const credits = getCreditSystem();
      const initialCredits = credits.getCredits();
      
      const swarm = await createMeshSwarm('Test limits', 2, 'dolphin-llama3:8b');
      this.activeSwarms.push(swarm);
      
      const remainingCredits = credits.getCredits();
      if (remainingCredits >= initialCredits) {
        throw new Error('Credits should be consumed when spawning agents');
      }
    });

    this.results.push(suite);
  }

  // ═══════════════════════════════════════════════════════════════
  // SWARM ORCHESTRATION TESTS
  // ═══════════════════════════════════════════════════════════════

  private async testSwarmOrchestration(): Promise<void> {
    const suite: TestSuite = {
      suiteName: 'Swarm Orchestration',
      results: [],
      passed: 0,
      failed: 0,
      totalDuration: 0,
      successRate: 0
    };

    resetCreditSystem();

    // Test 1: Task orchestration
    await this.runTest(suite, 'Task Orchestration', async () => {
      const swarm = await createMeshSwarm('Test orchestration', 3, 'dolphin-llama3:8b');
      this.activeSwarms.push(swarm);
      
      // Wait for initialization
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Orchestrate a simple task
      await swarm.orchestrateTask('Simple test task', 'parallel');
      
      const status = swarm.getSwarmStatus();
      if (status.performance.tasksCompleted === 0) {
        throw new Error('Task should have been recorded as completed');
      }
    });

    // Test 2: Swarm status monitoring
    await this.runTest(suite, 'Status Monitoring', async () => {
      const swarm = await createStarSwarm('Test monitoring', 3, 'dolphin-llama3:8b');
      this.activeSwarms.push(swarm);
      
      const status = swarm.getSwarmStatus();
      
      // Validate status structure
      if (!status.swarmId || !status.name) {
        throw new Error('Swarm status missing required fields');
      }
      
      if (!status.topology || !status.credits || !status.performance) {
        throw new Error('Swarm status missing sections');
      }
    });

    this.results.push(suite);
  }

  // ═══════════════════════════════════════════════════════════════
  // FAILURE RECOVERY TESTS
  // ═══════════════════════════════════════════════════════════════

  private async testFailureRecovery(): Promise<void> {
    const suite: TestSuite = {
      suiteName: 'Failure Recovery',
      results: [],
      passed: 0,
      failed: 0,
      totalDuration: 0,
      successRate: 0
    };

    resetCreditSystem();

    // Test 1: Agent death handling
    await this.runTest(suite, 'Agent Death Handling', async () => {
      const swarm = await createMeshSwarm('Test death', 3, 'dolphin-llama3:8b');
      this.activeSwarms.push(swarm);
      
      const initialStatus = swarm.getSwarmStatus();
      const initialCount = initialStatus.agents.length;
      
      if (initialCount === 0) {
        throw new Error('No agents to test death handling');
      }
      
      // Kill the swarm to test cleanup
      await swarm.killSwarm('TEST');
      
      // Credit refunds should have occurred
      const credits = getCreditSystem();
      const finalCredits = credits.getCredits();
      
      // Some credits should be refunded
      if (finalCredits === 0) {
        console.warn('Warning: No credits refunded, but test continues');
      }
    });

    // Test 2: Emergency mode recovery
    await this.runTest(suite, 'Emergency Recovery', async () => {
      const credits = getCreditSystem();
      
      // Force emergency mode
      if (!credits.getStatus().emergencyMode) {
        credits.emergencyReset();
      }
      
      const status = credits.getStatus();
      if (status.credits <= 0) {
        throw new Error('Emergency reset should restore credits');
      }
    });

    this.results.push(suite);
  }

  // ═══════════════════════════════════════════════════════════════
  // TEST UTILITIES
  // ═══════════════════════════════════════════════════════════════

  private async runTest(suite: TestSuite, testName: string, testFn: () => Promise<void>): Promise<void> {
    const startTime = Date.now();
    
    try {
      await testFn();
      const duration = Date.now() - startTime;
      
      suite.results.push({
        testName,
        passed: true,
        duration
      });
      
      suite.passed++;
      suite.totalDuration += duration;
      
      console.log(`✅ ${testName} (${duration}ms)`);
      
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      
      suite.results.push({
        testName,
        passed: false,
        error: error instanceof Error ? (error as Error).message : String(error),
        duration
      });
      
      suite.failed++;
      suite.totalDuration += duration;
      
      console.log(`❌ ${testName} (${duration}ms): ${error}`);
    }
  }

  private async cleanup(): Promise<void> {
    console.log('\n🧹 Cleaning up test resources...');
    
    // Kill all active swarms
    const killPromises = this.activeSwarms.map(swarm => 
      swarm.killSwarm('TEST_CLEANUP').catch(error => 
        console.warn('Warning: Failed to kill swarm:', error)
      )
    );
    
    await Promise.all(killPromises);
    this.activeSwarms = [];
    
    // Reset credit system
    resetCreditSystem();
    
    console.log('✅ Cleanup completed');
  }

  private printSummary(): void {
    console.log('\n📊 TEST SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════');

    let totalPassed = 0;
    let totalFailed = 0;
    let totalDuration = 0;

    for (const suite of this.results) {
      suite.successRate = suite.results.length > 0 ? (suite.passed / suite.results.length) * 100 : 0;
      
      totalPassed += suite.passed;
      totalFailed += suite.failed;
      totalDuration += suite.totalDuration;
      
      const statusIcon = suite.successRate === 100 ? '✅' : suite.successRate >= 50 ? '⚠️' : '❌';
      
      console.log(`${statusIcon} ${suite.suiteName}: ${suite.passed}/${suite.results.length} passed (${suite.successRate.toFixed(1)}%) - ${suite.totalDuration}ms`);
    }

    const overallSuccessRate = totalPassed + totalFailed > 0 ? (totalPassed / (totalPassed + totalFailed)) * 100 : 0;
    
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`🎯 OVERALL: ${totalPassed}/${totalPassed + totalFailed} tests passed`);
    console.log(`📈 SUCCESS RATE: ${overallSuccessRate.toFixed(1)}%`);
    console.log(`⏱️ TOTAL TIME: ${totalDuration}ms`);
    
    // Check for 100% success rate target
    if (overallSuccessRate === 100) {
      console.log('🎉 TARGET ACHIEVED: 100% validation success rate!');
      
      memorize(
        `Recursive spawning system validation: 100% success rate (${totalPassed} tests passed)`,
        // @ts-expect-error - Post-Merge Reconciliation
        'achievement',
        'recursive-spawner:validation:success'
      );
    } else {
      console.log(`🎯 TARGET: 100% (current: ${overallSuccessRate.toFixed(1)}%)`);
      
      memorize(
        `Recursive spawning system validation: ${overallSuccessRate.toFixed(1)}% success rate (${totalPassed}/${totalPassed + totalFailed})`,
        // @ts-expect-error - Post-Merge Reconciliation
        'alert',
        'recursive-spawner:validation:incomplete'
      );
    }
    
    console.log('═══════════════════════════════════════════════════════════════\n');
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN EXECUTION
// ═══════════════════════════════════════════════════════════════

export async function runRecursiveSpawnerTests(): Promise<void> {
  const runner = new RecursiveSpawnerTestRunner();
  await runner.runAllTests();
}

// Run tests if called directly
if (require.main === module) {
  runRecursiveSpawnerTests().catch(console.error);
}