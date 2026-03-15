#!/usr/bin/env tsx
/**
 * SuperClaw Smoke Test
 * Quick verification that all SKYNET subsystems can load
 * 
 * Usage:
 *   npx tsx src/superclaw/smoke-test.ts
 *   # or
 *   npm run superclaw:smoke
 */

import { getSuperclaw } from './init.js';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: any;
}

const results: TestResult[] = [];

async function runTest(name: string, fn: () => Promise<any>): Promise<boolean> {
  try {
    console.log(`\n🧪 Test: ${name}`);
    const result = await fn();
    console.log(`✅ PASSED`);
    results.push({ name, passed: true, details: result });
    return true;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`❌ FAILED: ${errorMsg}`);
    results.push({ name, passed: false, error: errorMsg });
    return false;
  }
}

async function smokeTest() {
  console.log('🦊 SuperClaw Smoke Test');
  console.log('========================\n');
  
  const startTime = Date.now();
  let totalPassed = 0;
  let totalTests = 0;

  // ==========================================================================
  // TEST 1: Can we create the bridge?
  // ==========================================================================
  totalTests++;
  if (await runTest('Bridge Creation', async () => {
    const bridge = await getSuperclaw();
    return { 
      initialized: bridge !== null,
      type: bridge?.constructor?.name
    };
  })) {
    totalPassed++;
  }

  // ==========================================================================
  // TEST 2: Are SKYNET modules loadable?
  // ==========================================================================
  totalTests++;
  if (await runTest('SKYNET Module Imports', async () => {
    const skynet = await import('./skynet/index.js');
    const exports = Object.keys(skynet);
    return { 
      exportCount: exports.length,
      hasVersion: skynet.SKYNET_VERSION !== undefined,
      version: skynet.SKYNET_VERSION,
      wave: skynet.SKYNET_WAVE,
      codename: skynet.SKYNET_CODENAME
    };
  })) {
    totalPassed++;
  }

  // ==========================================================================
  // TEST 3: Are providers loadable?
  // ==========================================================================
  totalTests++;
  if (await runTest('Provider Registry', async () => {
    const providers = await import('./providers/index.js');
    const exports = Object.keys(providers);
    return { 
      exportCount: exports.length,
      hasRegistry: exports.includes('getRegistry')
    };
  })) {
    totalPassed++;
  }

  // ==========================================================================
  // TEST 4: Are swarm modules loadable?
  // ==========================================================================
  totalTests++;
  if (await runTest('Swarm Modules', async () => {
    const swarm = await import('./swarm/index.js');
    const exports = Object.keys(swarm);
    return { 
      exportCount: exports.length,
      hasConvoy: exports.includes('Convoy'),
      hasContract: exports.includes('SwarmContract')
    };
  })) {
    totalPassed++;
  }

  // ==========================================================================
  // TEST 5: Can we initialize SKYNET components individually?
  // ==========================================================================
  totalTests++;
  if (await runTest('SKYNET Component Init', async () => {
    const { 
      startPulse, 
      startGuardian,
      startSentinel,
      startOracle,
      startNexus,
      startCortex,
      getThresholdEnforcer,
      startMoltbook,
      initializeAuditSystem
    } = await import('./skynet/index.js');
    
    // Don't actually start them (would conflict with running gateway)
    // Just verify they're callable functions
    return {
      pulseFn: typeof startPulse === 'function',
      guardianFn: typeof startGuardian === 'function',
      sentinelFn: typeof startSentinel === 'function',
      oracleFn: typeof startOracle === 'function',
      nexusFn: typeof startNexus === 'function',
      cortexFn: typeof startCortex === 'function',
      thresholdsFn: typeof getThresholdEnforcer === 'function',
      moltbookFn: typeof startMoltbook === 'function',
      auditFn: typeof initializeAuditSystem === 'function'
    };
  })) {
    totalPassed++;
  }

  // ==========================================================================
  // TEST 6: Can we load init.ts?
  // ==========================================================================
  totalTests++;
  if (await runTest('SuperClaw Init Module', async () => {
    const init = await import('./init.js');
    return {
      hasGetSuperclaw: typeof init.getSuperclaw === 'function',
      hasIsInitialized: typeof init.isInitialized === 'function',
      hasShutdown: typeof init.shutdown === 'function',
      currentlyInitialized: init.isInitialized()
    };
  })) {
    totalPassed++;
  }

  // ==========================================================================
  // TEST 7: Can we load gateway-hook.ts?
  // ==========================================================================
  totalTests++;
  if (await runTest('Gateway Hook Module', async () => {
    const hook = await import('./gateway-hook.js');
    return {
      hasCreateHook: typeof hook.createGatewayHook === 'function',
      hasWrapHandler: typeof hook.wrapAgentHandler === 'function'
    };
  })) {
    totalPassed++;
  }

  // ==========================================================================
  // TEST 8: Can we load types?
  // ==========================================================================
  totalTests++;
  if (await runTest('Type Definitions', async () => {
    const types = await import('./types.js');
    // Types don't have runtime representation, but we can check if the module loads
    return { loaded: true };
  })) {
    totalPassed++;
  }

  // ==========================================================================
  // SUMMARY
  // ==========================================================================
  const elapsedMs = Date.now() - startTime;
  
  console.log('\n');
  console.log('═'.repeat(60));
  console.log('📊 SMOKE TEST RESULTS');
  console.log('═'.repeat(60));
  console.log(`Total Tests:  ${totalTests}`);
  console.log(`Passed:       ${totalPassed} ✅`);
  console.log(`Failed:       ${totalTests - totalPassed} ❌`);
  console.log(`Success Rate: ${((totalPassed / totalTests) * 100).toFixed(1)}%`);
  console.log(`Duration:     ${elapsedMs}ms`);
  console.log('═'.repeat(60));

  if (totalPassed === totalTests) {
    console.log('\n🎉 ALL SMOKE TESTS PASSED!');
    console.log('✅ SuperClaw is ready to boot with Alpha gateway');
    console.log('\n💡 To see it in action:');
    console.log('   alpha gateway start');
    console.log('   # Watch for "🦊 SKYNET PROTOCOL" banner in logs');
    process.exit(0);
  } else {
    console.log('\n❌ SOME TESTS FAILED');
    console.log('\n📋 Failed tests:');
    results
      .filter(r => !r.passed)
      .forEach(r => {
        console.log(`   • ${r.name}: ${r.error}`);
      });
    process.exit(1);
  }
}

// Run smoke test
smokeTest().catch(error => {
  console.error('\n💥 SMOKE TEST CRASHED:', error);
  process.exit(1);
});
