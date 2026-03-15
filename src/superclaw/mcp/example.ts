/**
 * SuperClaw MCP Federation Example
 * 
 * Demonstrates how to set up and use the MCP federation system
 * with SuperClaw tools and agents.
 */

import {
  createDevelopmentMCPFederation,
  getFederatedToolRegistry,
  createToolSpecificMCPServer,
} from './index';
import { getToolRegistry } from '../sc-tools/registry';

async function runMCPFederationExample() {
  console.log('🚀 Starting SuperClaw MCP Federation Example\n');

  // Step 1: Create a development federation server
  console.log('1. Starting MCP Federation Controller...');
  const federation = createDevelopmentMCPFederation();
  
  try {
    await federation.start();
    console.log('✅ Federation server started on port 8080\n');
  } catch (error: unknown) {
    console.error('❌ Failed to start federation server:', error);
    return;
  }

  // Step 2: Create a standalone tool server
  console.log('2. Starting standalone tool server...');
  try {
    const toolServer = await createToolSpecificMCPServer(
      ['web-search', 'file-ops'],  // Specific tools
      8081,                        // Port
      'Example Tool Server'        // Name
    );
    console.log('✅ Tool server started on port 8081\n');
  } catch (error: unknown) {
    console.error('❌ Failed to start tool server:', error);
    await federation.stop();
    return;
  }

  // Step 3: Show available local tools
  console.log('3. Available SuperClaw Tools:');
  const localRegistry = getToolRegistry();
  const localTools = localRegistry.list();
  console.log(`   Found ${localTools.length} local tools:`);
  for (const tool of localTools) {
    console.log(`   • ${tool.name} (${tool.metadata?.category || 'uncategorized'})`);
  }
  console.log();

  // Step 4: Register an external server (simulation)
  console.log('4. Registering external MCP server...');
  try {
    await federation.registerFederatedServer(
      'example-external',
      'http://localhost:8081',  // Our tool server as "external"
      { type: 'bearer', token: 'example-token' }
    );
    console.log('✅ External server registered\n');
  } catch (error: unknown) {
    console.error('❌ Failed to register external server:', error);
  }

  // Step 5: Get federated tool registry
  const federatedRegistry = getFederatedToolRegistry();

  // Step 6: Demonstrate tool execution
  console.log('5. Testing tool execution...');
  
  // Test local tool execution
  try {
    console.log('   Testing local tool execution...');
    const localResult = await federation.executeToolForAgent(
      'web-search',
      { query: 'SuperClaw MCP integration test' },
      {
        agentId: 'example-agent-001',
        sessionId: 'example-session-123',
        role: 'researcher',
        provider: 'claude',
      }
    );
    
    if (localResult.success) {
      console.log('   ✅ Local tool execution successful');
      console.log(`   Duration: ${localResult.duration}ms`);
    } else {
      console.log('   ❌ Local tool execution failed:', localResult.error);
    }
  } catch (error: unknown) {
    console.log('   ❌ Local tool execution error:', error);
  }

  // Step 7: Show federation metrics
  console.log('\n6. Federation Metrics:');
  const metrics = federatedRegistry.getMetrics();
  console.log(`   Total servers: ${metrics.totalServers}`);
  console.log(`   Healthy servers: ${metrics.healthyServers}`);
  console.log(`   Total tool calls: ${metrics.totalToolCalls}`);
  // @ts-expect-error - Post-Merge Reconciliation
  console.log(`   Success rate: ${(metrics.successRate * 100).toFixed(2)}%`);
  if (metrics.topTools.length > 0) {
    console.log(`   Top tools: ${metrics.topTools.map(t => t.name).join(', ')}`);
  }

  // Step 8: Show server status
  console.log('\n7. Server Status:');
  const status = federation.getStatus();
  console.log(`   Running: ${status.running}`);
  console.log(`   Servers: ${status.servers}`);
  console.log(`   Tools: ${status.tools}`);
  console.log(`   Uptime: ${Math.floor(status.uptime)}s`);

  // Step 9: Test federation API endpoints
  console.log('\n8. Testing Federation API endpoints...');
  
  try {
    console.log('   Testing health endpoint...');
    const healthResponse = await fetch('http://localhost:8080/health');
    if (healthResponse.ok) {
      const healthData = await healthResponse.json();
      // @ts-expect-error - Post-Merge Reconciliation
      console.log('   ✅ Health check passed:', healthData.status);
    }
  } catch (error: unknown) {
    console.log('   ❌ Health check failed:', error);
  }

  try {
    console.log('   Testing tools list endpoint...');
    const toolsResponse = await fetch('http://localhost:8080/tools', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      }),
    });
    
    if (toolsResponse.ok) {
      const toolsData = await toolsResponse.json();
      // @ts-expect-error - Post-Merge Reconciliation
      const toolCount = toolsData.result?.tools?.length || 0;
      console.log(`   ✅ Tools list retrieved: ${toolCount} tools available`);
    }
  } catch (error: unknown) {
    console.log('   ❌ Tools list failed:', error);
  }

  // Step 10: Demonstrate event handling
  console.log('\n9. Setting up event monitoring...');
  
  federatedRegistry.on('tool_called', (event) => {
    console.log(`   📞 Tool called: ${event.data.toolName} on ${event.data.serverId}`);
  });

  federatedRegistry.on('tool_result', (event) => {
    const status = event.data.success ? '✅' : '❌';
    console.log(`   📋 Tool result: ${status} ${event.data.toolName} (${event.data.duration}ms)`);
  });

  federatedRegistry.on('server_connected', (event) => {
    console.log(`   🔗 Server connected: ${event.data.serverId}`);
  });

  federatedRegistry.on('server_disconnected', (event) => {
    console.log(`   🔌 Server disconnected: ${event.data.serverId}`);
  });

  console.log('   Event monitoring active\n');

  // Step 11: Show usage examples
  console.log('10. Usage Examples:');
  console.log(`
   # CLI Commands:
   npx superclaw-mcp federation --port 8080
   npx superclaw-mcp serve-tools --tools "web-search,file-ops" --port 8081
   npx superclaw-mcp list-tools
   npx superclaw-mcp test-connection --endpoint http://localhost:8080

   # API Calls:
   curl http://localhost:8080/health
   curl http://localhost:8080/federation/servers
   curl http://localhost:8080/federation/metrics

   # Tool Execution:
   curl -X POST http://localhost:8080/tools/call \\
     -H "Content-Type: application/json" \\
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"web-search","arguments":{"query":"test"}}}'
  `);

  console.log('🎉 MCP Federation Example completed successfully!');
  console.log('\nServers are running. Press Ctrl+C to stop.\n');

  // Keep the process alive and show periodic status
  const statusInterval = setInterval(() => {
    const currentStatus = federation.getStatus();
    const currentMetrics = federatedRegistry.getMetrics();
    
    // @ts-expect-error - Post-Merge Reconciliation
    console.log(`[${new Date().toISOString()}] Status: ${currentStatus.servers} servers, ${currentMetrics.totalToolCalls} total calls, ${(currentMetrics.successRate * 100).toFixed(1)}% success rate`);
  }, 30000);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down MCP Federation example...');
    
    clearInterval(statusInterval);
    
    try {
      await federation.stop();
      console.log('✅ Federation server stopped');
    } catch (error: unknown) {
      console.error('❌ Error stopping federation server:', error);
    }
    
    console.log('👋 Example terminated');
    process.exit(0);
  });
}

// Additional utility functions for testing

async function testToolExecution(federation: any, toolName: string, parameters: any) {
  console.log(`Testing tool: ${toolName}`);
  
  try {
    const result = await federation.executeToolForAgent(
      toolName,
      parameters,
      {
        agentId: 'test-agent',
        sessionId: 'test-session',
        role: 'general',
        provider: 'claude',
      }
    );
    
    if (result.success) {
      console.log(`✅ ${toolName} executed successfully (${result.duration}ms)`);
      return result;
    } else {
      console.log(`❌ ${toolName} failed: ${result.error}`);
      return null;
    }
  } catch (error: unknown) {
    console.log(`❌ ${toolName} error:`, error);
    return null;
  }
}

async function benchmarkToolExecution(federation: any, toolName: string, parameters: any, iterations = 5) {
  console.log(`Benchmarking tool: ${toolName} (${iterations} iterations)`);
  
  const times: number[] = [];
  let successes = 0;
  
  for (let i = 0; i < iterations; i++) {
    const start = Date.now();
    const result = await testToolExecution(federation, toolName, parameters);
    const duration = Date.now() - start;
    
    times.push(duration);
    if (result?.success) successes++;
  }
  
  const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
  const successRate = (successes / iterations) * 100;
  
  console.log(`📊 Benchmark results for ${toolName}:`);
  console.log(`   Average time: ${avgTime.toFixed(2)}ms`);
  console.log(`   Success rate: ${successRate.toFixed(1)}%`);
  console.log(`   Min time: ${Math.min(...times)}ms`);
  console.log(`   Max time: ${Math.max(...times)}ms`);
  
  return { avgTime, successRate, times };
}

// Run the example if this file is executed directly
if (require.main === module) {
  runMCPFederationExample().catch(error => {
    console.error('💥 Example failed:', error);
    process.exit(1);
  });
}

export {
  runMCPFederationExample,
  testToolExecution,
  benchmarkToolExecution,
};