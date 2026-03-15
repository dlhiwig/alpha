#!/usr/bin/env node
// @ts-nocheck
/**
 * Quick demonstration of the CodeAgent Shell Tool
 */

import { shell_execute } from './code-agent-shell';

async function main() {
  console.log('🦅 CodeAgent Shell Tool Demo\n');

  // Simple demonstration
  const result = await shell_execute({
    script: `
      echo "Hello from CodeAgent Shell!"
      echo "Current directory: $(pwd)"
      echo "Current time: $(date)"
      echo "Available memory:"
      free -h | grep Mem
    `,
    tokenTracking: { enabled: true },
    output: { summarize: 'auto' }
  });

  if (result.success) {
    console.log('✅ Success!');
    console.log(`Duration: ${result.metrics.duration}ms`);
    console.log(`Tokens used: ${result.metrics.tokenUsage?.totalTokens || 'N/A'}`);
    console.log('\nOutput:');
    console.log(result.output);
  } else {
    console.error('❌ Failed:', result.error);
  }
}

if (require.main === module) {
  main().catch(console.error);
}