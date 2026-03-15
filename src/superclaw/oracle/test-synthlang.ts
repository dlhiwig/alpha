#!/usr/bin/env ts-node
/**
 * SynthLang Integration Test Suite
 * 
 * Tests the SynthLang integration and demonstrates functionality
 */

import { SynthLangOptimizer } from './synthlang-optimizer';
import { PromptCompressor, compressPrompt } from './prompt-compressor';

const testPrompts = [
  // Test 1: Basic programming prompt
  `Please write a function that takes an array of numbers and returns the sum of all even numbers. 
   The function should handle edge cases like empty arrays and arrays with no even numbers. 
   Make sure to include proper error handling and documentation.`,
  
  // Test 2: Complex reasoning prompt  
  `Analyze the following code for performance optimizations and security vulnerabilities.
   Consider memory usage, algorithmic complexity, and potential attack vectors.
   Provide specific recommendations for improvements and explain the reasoning behind each suggestion.
   Also evaluate the maintainability and readability of the code.`,
  
  // Test 3: Mathematical/symbolic content
  `Calculate the integral of x^2 + 3x + 2 from 0 to 5. 
   Then find the derivative of the result and explain the relationship between integration and differentiation.
   Use appropriate mathematical notation and show all steps in the calculation process.`,
  
  // Test 4: Simple prompt (should not be compressed)
  `Hello, how are you today?`,
  
  // Test 5: Code-heavy prompt (might be skipped)
  `Here's some JavaScript code:
   \`\`\`javascript
   function processData(data) {
     const result = data.filter(item => item.active)
                       .map(item => ({ ...item, processed: true }))
                       .reduce((acc, item) => acc + item.value, 0);
     return result;
   }
   \`\`\`
   Please optimize this code for better performance.`
];

async function runTests() {
  console.log('🧪 SynthLang Integration Test Suite');
  console.log('===================================\n');
  
  // Test 1: Basic SynthLang Optimizer
  console.log('📦 Testing SynthLang Optimizer...');
  const optimizer = new SynthLangOptimizer();
  
  try {
    const { optimized, metrics } = await optimizer.optimize(testPrompts[0], {
      useSymbolicNotation: true,
      preserveSemantics: true,
      targetReduction: 0.7
    });
    
    console.log('✅ Basic optimization successful');
    console.log(`   Original tokens: ${metrics.originalTokens}`);
    console.log(`   Optimized tokens: ${metrics.optimizedTokens}`);
    console.log(`   Reduction: ${metrics.reductionPercent.toFixed(1)}%`);
    console.log(`   Semantic accuracy: ${(metrics.semanticAccuracy * 100).toFixed(1)}%`);
    console.log(`   Speed improvement: ${metrics.speedImprovement.toFixed(1)}x`);
    console.log(`   Compression time: ${metrics.compressionTime}ms\n`);
    
    console.log('Original prompt (first 100 chars):');
    console.log(`   "${testPrompts[0].substring(0, 100)}..."\n`);
    console.log('Optimized prompt (first 100 chars):');
    console.log(`   "${optimized.substring(0, 100)}..."\n`);
    
  } catch (error: unknown) {
    console.log('❌ Basic optimization failed:', (error as Error).message);
  }
  
  // Test 2: Prompt Compressor with various settings
  console.log('🔧 Testing Prompt Compressor...');
  const compressor = new PromptCompressor({
    enabled: true,
    autoOptimize: true,
    minPromptLength: 50,
    targetReduction: 0.7,
    aggressiveness: 'moderate',
    enableSymbolicNotation: true
  });
  
  for (let i = 0; i < testPrompts.length; i++) {
    try {
      const result = await compressor.compress(testPrompts[i]);
      
      console.log(`Test ${i + 1}:`);
      console.log(`   Used: ${result.used ? '✅' : '❌'}`);
      console.log(`   Reason: ${result.reason}`);
      if (result.used) {
        console.log(`   Reduction: ${result.metrics.reductionPercent.toFixed(1)}%`);
        console.log(`   Semantic accuracy: ${(result.metrics.semanticAccuracy * 100).toFixed(1)}%`);
      }
      console.log('');
      
    } catch (error: unknown) {
      console.log(`Test ${i + 1}: ❌ Failed - ${(error as Error).message}\n`);
    }
  }
  
  // Test 3: Batch Processing
  console.log('📦 Testing batch compression...');
  try {
    const batchInputs = testPrompts.map(prompt => ({ prompt, context: { test: true } }));
    const batchResults = await compressor.compressBatch(batchInputs, { parallel: true, maxConcurrent: 3 });
    
    const successCount = batchResults.filter(r => r.used).length;
    console.log(`✅ Batch processing complete: ${successCount}/${batchResults.length} prompts compressed\n`);
    
  } catch (error: unknown) {
    console.log('❌ Batch processing failed:', (error as Error).message, '\n');
  }
  
  // Test 4: Performance Report
  console.log('📊 Performance Report:');
  const report = compressor.getPerformanceReport();
  console.log(`   Total compressions: ${report.stats.totalCompressions}`);
  console.log(`   Total token savings: ${report.stats.totalSavings}`);
  console.log(`   Average accuracy: ${(report.stats.averageAccuracy * 100).toFixed(1)}%`);
  console.log(`   Efficiency: ${(report.efficiency * 100).toFixed(1)}%`);
  console.log(`   Failures: ${report.stats.failureCount}`);
  console.log(`   Rollbacks: ${report.stats.rollbackCount}`);
  
  if (report.recommendations.length > 0) {
    console.log('   Recommendations:');
    report.recommendations.forEach(rec => console.log(`     - ${rec}`));
  }
  console.log('');
  
  // Test 5: A/B Testing
  console.log('🧪 Testing A/B compression strategies...');
  try {
    const strategies = [
      { name: 'Conservative', config: { aggressiveness: 'conservative' as const, targetReduction: 0.5 } },
      { name: 'Moderate', config: { aggressiveness: 'moderate' as const, targetReduction: 0.7 } },
      { name: 'Aggressive', config: { aggressiveness: 'aggressive' as const, targetReduction: 0.8 } }
    ];
    
    const abResults = await compressor.abTestCompression(testPrompts[1], strategies);
    
    console.log('A/B Test Results:');
    abResults.forEach(({ name, result }) => {
      console.log(`   ${name}: ${result.used ? '✅' : '❌'} - ${result.reason}`);
      if (result.used) {
        console.log(`     Reduction: ${result.metrics.reductionPercent.toFixed(1)}%, Accuracy: ${(result.metrics.semanticAccuracy * 100).toFixed(1)}%`);
      }
    });
    console.log('');
    
  } catch (error: unknown) {
    console.log('❌ A/B testing failed:', (error as Error).message, '\n');
  }
  
  // Test 6: Convenience function
  console.log('🚀 Testing convenience function...');
  try {
    const convenienceResult = await compressPrompt(testPrompts[0], {
      aggressiveness: 'aggressive',
      targetReduction: 0.8
    });
    
    console.log(`✅ Convenience function: ${convenienceResult.used ? 'Success' : 'Skipped'}`);
    console.log(`   ${convenienceResult.reason}\n`);
    
  } catch (error: unknown) {
    console.log('❌ Convenience function failed:', (error as Error).message, '\n');
  }
  
  // Test 7: Symbolic Notation Demo
  console.log('⚡ Symbolic notation examples:');
  const symbolTestText = `
    The function should return true if and only if the condition is met.
    For all elements in the array, if the element is greater than or equal to zero,
    then add it to the sum. The result approximately equals the expected value.
    Navigate to the next tab and press enter to continue.
  `;
  
  try {
    const { optimized: symbolOptimized } = await optimizer.optimize(symbolTestText, {
      useSymbolicNotation: true,
      preserveSemantics: false // Focus on compression
    });
    
    console.log('Original:');
    console.log(`   "${symbolTestText.trim()}"`);
    console.log('With symbolic notation:');  
    console.log(`   "${symbolOptimized}"`);
    
    const originalLength = symbolTestText.length;
    const optimizedLength = symbolOptimized.length;
    const symbolReduction = ((originalLength - optimizedLength) / originalLength * 100);
    console.log(`   Symbol compression: ${symbolReduction.toFixed(1)}%\n`);
    
  } catch (error: unknown) {
    console.log('❌ Symbolic notation test failed:', (error as Error).message, '\n');
  }
  
  console.log('🎉 Test suite complete!');
  console.log('\nNext steps:');
  console.log('1. Wire this into SuperClaw\'s prompt processing pipeline');
  console.log('2. Add to SuperClaw CLI commands: `superclaw optimize-prompt "text"`');
  console.log('3. Integrate with swarm agents for automatic optimization');
  console.log('4. Monitor performance in production and tune parameters');
}

// Run tests if this file is executed directly  
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch(console.error);
}

export { runTests };