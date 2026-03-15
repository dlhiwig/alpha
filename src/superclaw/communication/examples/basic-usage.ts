// @ts-nocheck
/**
 * 🦊 SuperClaw Agent Mail - Basic Usage Examples
 * 
 * Demonstrates how to use Agent Mail integration in SuperClaw swarms.
 * Run with: npx ts-node src/communication/examples/basic-usage.ts
 */

import { createAgentMailIntegration, quickAgentMailSetup } from '../index';
import type { IntegrationConfig } from '../types';

/**
 * Example 1: Quick setup and basic messaging
 */
async function example1_QuickSetup() {
  console.log('🦊 Example 1: Quick Setup and Basic Messaging\n');

  try {
    // Quick setup for development/testing
    const integration = await quickAgentMailSetup({
      projectPath: process.cwd(),
      agentName: 'ExampleAgent',
      mcpServerUrl: 'http://localhost:8765',
      bearerToken: 'demo-token'
    });

    const identity = integration.getAgentIdentity();
    console.log(`✅ Registered as: ${identity?.name}`);

    // Send a simple message
    await integration.sendMessage(
      ['TestRecipient'],
      'Hello from SuperClaw!',
      'This is a test message from the SuperClaw Agent Mail integration.',
      { priority: 'normal' }
    );

    console.log('📤 Message sent successfully');

    // Check for messages
    const messages = await integration.checkMessages({ limit: 5 });
    console.log(`📬 Found ${messages.length} message(s)`);

    // Shutdown gracefully
    await integration.shutdown();
    console.log('✅ Example 1 completed\n');

  } catch (error: unknown) {
    console.error('❌ Example 1 failed:', (error as Error).message);
  }
}

/**
 * Example 2: File reservation workflow
 */
async function example2_FileReservations() {
  console.log('🦊 Example 2: File Reservation Workflow\n');

  try {
    const integration = await quickAgentMailSetup({
      projectPath: process.cwd(),
      agentName: 'FileWorkerAgent'
    });

    // Reserve files exclusively for critical work
    const reservations = await integration.reserveFiles(
      ['src/database/**/*.ts', 'package.json'],
      {
        mode: 'exclusive',
        reason: 'Database schema migration',
        expiresIn: 2 // 2 hours
      }
    );

    console.log(`🔒 Reserved ${reservations.length} file patterns`);
    // @ts-expect-error - Post-Merge Reconciliation
    reservations.forEach(res => {
      console.log(`   - ${res.pathPattern} (${res.mode})`);
    });

    // Notify other agents about the work
    await integration.sendMessage(
      ['broadcast'],
      'Database Migration in Progress',
      `**Database Migration Started** 🚧

I've reserved the database files for the next 2 hours to perform schema migration.

**Reserved files:**
- \`src/database/**/*.ts\`
- \`package.json\`

Please coordinate with me before making changes to these files.

**Estimated completion:** 2 hours
**Contact:** ${integration.getAgentIdentity()?.name}`,
      { priority: 'high', type: 'coordination' }
    );

    console.log('📤 Coordination message sent');

    // Simulate some work...
    console.log('⏳ Simulating work for 5 seconds...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Release reservations early (good practice)
    for (const reservation of reservations) {
      await integration.releaseReservation(reservation.id);
      console.log(`🔓 Released: ${reservation.pathPattern}`);
    }

    // Send completion notice
    await integration.sendMessage(
      ['broadcast'],
      'Database Migration Complete',
      '**Migration Complete** ✅\n\nDatabase schema migration finished successfully. All file reservations released.',
      { priority: 'normal', type: 'status_update' }
    );

    await integration.shutdown();
    console.log('✅ Example 2 completed\n');

  } catch (error: unknown) {
    console.error('❌ Example 2 failed:', (error as Error).message);
  }
}

/**
 * Example 3: Agent coordination pattern
 */
async function example3_AgentCoordination() {
  console.log('🦊 Example 3: Multi-Agent Coordination\n');

  try {
    const integration = await quickAgentMailSetup({
      projectPath: process.cwd(),
      agentName: 'CoordinatorAgent',
      // @ts-expect-error - Post-Merge Reconciliation
      taskDescription: 'Task coordination and delegation'
    });

    // Discover active agents
    const agents = await integration.discoverAgents();
    console.log(`👥 Discovered ${agents.length} agent(s):`);
    
    // @ts-expect-error - Post-Merge Reconciliation
    agents.forEach(agent => {
      const status = agent.isActive ? '🟢' : '🔴';
      console.log(`   ${status} ${agent.identity.name} (${agent.identity.program})`);
      console.log(`      Task: ${agent.identity.taskDescription}`);
      console.log(`      Reservations: ${agent.currentReservations.length}`);
    });

    if (agents.length > 1) {
      // Send coordination request to other agents
      const otherAgents = agents
        // @ts-expect-error - Post-Merge Reconciliation
        .filter(a => a.identity.name !== integration.getAgentIdentity()?.name)
        // @ts-expect-error - Post-Merge Reconciliation
        .map(a => a.identity.name);

      if (otherAgents.length > 0) {
        await integration.sendMessage(
          otherAgents,
          'Task Coordination Request',
          `**Coordination Request** 🤝

I'm coordinating work distribution for our current project. 

**Please respond with:**
- [ ] Your current task status
- [ ] Estimated completion time  
- [ ] Any blockers or dependencies
- [ ] Files you plan to modify

This helps avoid conflicts and ensures smooth collaboration.

**Deadline for response:** 1 hour`,
          { 
            priority: 'high', 
            type: 'coordination',
            ackRequired: true 
          }
        );

        console.log(`📤 Coordination request sent to ${otherAgents.length} agent(s)`);
      }
    }

    // Monitor for responses (simplified)
    console.log('👂 Checking for responses...');
    const responses = await integration.checkMessages({ 
      unreadOnly: true, 
      limit: 10 
    });

    if (responses.length > 0) {
      console.log(`📬 Received ${responses.length} response(s)`);
      // @ts-expect-error - Post-Merge Reconciliation
      responses.forEach(msg => {
        console.log(`   📧 ${msg.senderName}: ${msg.subject}`);
      });
    } else {
      console.log('📭 No immediate responses');
    }

    await integration.shutdown();
    console.log('✅ Example 3 completed\n');

  } catch (error: unknown) {
    console.error('❌ Example 3 failed:', (error as Error).message);
  }
}

/**
 * Example 4: Advanced integration with full configuration
 */
async function example4_AdvancedIntegration() {
  console.log('🦊 Example 4: Advanced Integration\n');

  try {
    const config: IntegrationConfig = {
      mcpServerUrl: 'http://localhost:8765',
      bearerToken: 'demo-token',
      projectPath: process.cwd(),
      agentName: 'AdvancedAgent',
      agentProgram: 'SuperClaw',
      agentModel: 'Claude Opus',
      taskDescription: 'Advanced swarm coordination with full monitoring',
      
      // Enable all integration features
      enableMoltbookBridge: true,
      enableAuditIntegration: true,
      enableGitIntegration: true,
      enableCrossProjectCoordination: true,
      
      // Performance settings
      syncInterval: 15000, // 15 seconds
      messageBufferSize: 500,
      reservationCheckInterval: 60000 // 1 minute
    };

    const integration = createAgentMailIntegration(config);

    // Set up event listeners
    integration.on('message_received', (message) => {
      console.log(`📧 New message: ${message.senderName} - ${message.subject}`);
    });

    integration.on('files_reserved', (reservations) => {
      console.log(`🔒 Files reserved: ${reservations.length} patterns`);
    });

    integration.on('agents_discovered', (agents) => {
      console.log(`👥 Agent discovery: ${agents.length} agents found`);
    });

    // Initialize with full monitoring
    await integration.initialize();

    const identity = integration.getAgentIdentity();
    console.log(`✅ Advanced agent initialized: ${identity?.name}`);

    // Demonstrate status monitoring
    const state = integration.getCommunicationState();
    console.log(`📊 Communication state: ${state.health}`);
    console.log(`   Active agents: ${state.activeAgents}`);
    console.log(`   Total messages: ${state.totalMessages}`);

    // Generate comprehensive status report
    const report = integration.generateStatusReport();
    console.log('\n📋 Status Report:');
    console.log(report);

    // Demonstrate template usage
    const { createStandardTemplate } = await import('../index.js');
    const template = createStandardTemplate('COORDINATION_REQUEST', {
      task: 'Advanced Integration Demo',
      priority: 'normal',
      duration: '30 minutes',
      description: 'Demonstrating advanced Agent Mail features',
      files: 'src/communication/**/*.ts',
      sender: identity?.name || 'AdvancedAgent'
    });

    console.log('\n📄 Generated template:');
    console.log(`Subject: ${template.subject}`);
    console.log('Body preview:', template.body.substring(0, 200) + '...');

    // Simulate running for a bit to show monitoring
    console.log('\n⏳ Running for 30 seconds to demonstrate monitoring...');
    await new Promise(resolve => setTimeout(resolve, 30000));

    await integration.shutdown();
    console.log('✅ Example 4 completed\n');

  } catch (error: unknown) {
    console.error('❌ Example 4 failed:', (error as Error).message);
  }
}

/**
 * Example 5: Error handling and recovery
 */
async function example5_ErrorHandling() {
  console.log('🦊 Example 5: Error Handling and Recovery\n');

  try {
    const integration = await quickAgentMailSetup({
      projectPath: process.cwd(),
      agentName: 'ErrorHandlerAgent'
    });

    // Demonstrate error handling patterns
    try {
      // Attempt to send to non-existent agent
      await integration.sendMessage(
        ['NonExistentAgent'],
        'Test Message',
        'This should fail gracefully'
      );
    } catch (error: unknown) {
      console.log(`✅ Handled expected error: ${(error as Error).message}`);
    }

    // Demonstrate reservation conflict detection
    try {
      await integration.reserveFiles(['**/*'], { mode: 'exclusive' });
      console.log('🔒 Reserved all files (dangerous!)');
      
      // Try to reserve again (should conflict)
      await integration.reserveFiles(['src/**/*'], { mode: 'exclusive' });
    } catch (error: unknown) {
      console.log(`✅ Handled reservation conflict: ${(error as Error).message}`);
    }

    // Demonstrate graceful degradation
    console.log('🔧 Testing graceful degradation...');
    
    // Even with potential network issues, we should handle gracefully
    const messages = await integration.checkMessages().catch(() => []);
    console.log(`📬 Retrieved ${messages.length} messages (with fallback)`);

    await integration.shutdown();
    console.log('✅ Example 5 completed\n');

  } catch (error: unknown) {
    console.error('❌ Example 5 failed:', (error as Error).message);
  }
}

/**
 * Run all examples
 */
async function runAllExamples() {
  console.log('🚀 Running SuperClaw Agent Mail Examples\n');
  console.log('Note: These examples require MCP Agent Mail server running on localhost:8765\n');

  await example1_QuickSetup();
  await example2_FileReservations();
  await example3_AgentCoordination();
  await example4_AdvancedIntegration();
  await example5_ErrorHandling();

  console.log('🎉 All examples completed!');
  console.log('\nNext steps:');
  console.log('- Set up MCP Agent Mail server: curl -fsSL https://raw.githubusercontent.com/steveyegge/mcp_agent_mail/main/scripts/install.sh | bash -s -- --yes');
  console.log('- Use SuperClaw CLI: npx ts-node src/cli/index.ts agent-mail --help');
  console.log('- Integrate into your agents using the patterns shown above');
}

// Run examples if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllExamples().catch(console.error);
}

export {
  example1_QuickSetup,
  example2_FileReservations,
  example3_AgentCoordination,
  example4_AdvancedIntegration,
  example5_ErrorHandling,
  runAllExamples
};