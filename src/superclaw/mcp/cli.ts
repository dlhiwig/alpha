#!/usr/bin/env node
/**
 * SuperClaw MCP CLI
 * 
 * Command-line interface for managing MCP federation servers
 */

import { Command } from 'commander';
import {
  createBasicMCPFederation,
  createSecureMCPFederation,
  createDevelopmentMCPFederation,
} from './index';
import {
  createToolSpecificMCPServer,
  createFullSuperClawMCPServer,
} from './server-wrapper';
import { getFederatedToolRegistry } from './tool-registry';
import { getToolRegistry } from '../sc-tools/registry';

const program = new Command();

program
  .name('superclaw-mcp')
  .description('SuperClaw MCP Federation CLI')
  .version('1.0.0');

// --- Federation Commands ---

program
  .command('federation')
  .description('Start MCP federation server')
  .option('-p, --port <port>', 'Server port', '8080')
  .option('-h, --host <host>', 'Server host', '127.0.0.1')
  .option('-m, --mode <mode>', 'Server mode (basic|secure|dev)', 'basic')
  .option('--jwt-secret <secret>', 'JWT secret for secure mode')
  .option('--allowed-origins <origins>', 'Allowed origins (comma-separated)')
  .action(async (options) => {
    try {
      let controller;
      
      switch (options.mode) {
        case 'secure':
          if (!options.jwtSecret) {
            console.error('JWT secret is required for secure mode. Use --jwt-secret or set MCP_JWT_SECRET env var.');
            process.exit(1);
          }
          process.env.MCP_JWT_SECRET = options.jwtSecret;
          controller = createSecureMCPFederation({
            // @ts-expect-error - Post-Merge Reconciliation
            server: { port: parseInt(options.port), host: options.host },
          });
          break;
        
        case 'dev':
          controller = createDevelopmentMCPFederation();
          break;
        
        default:
          controller = createBasicMCPFederation({
            // @ts-expect-error - Post-Merge Reconciliation
            server: { port: parseInt(options.port), host: options.host },
          });
      }

      console.log(`Starting MCP federation server in ${options.mode} mode...`);
      await controller.start();
      
      // Keep the process alive
      process.on('SIGINT', async () => {
        console.log('\nShutting down MCP federation server...');
        await controller.stop();
        process.exit(0);
      });
      
      console.log('MCP federation server is running. Press Ctrl+C to stop.');
    } catch (error: unknown) {
      console.error('Failed to start MCP federation server:', error);
      process.exit(1);
    }
  });

// --- Tool Server Commands ---

program
  .command('serve-tools')
  .description('Start MCP server for specific tools')
  .option('-p, --port <port>', 'Server port', '8081')
  .option('-t, --tools <tools>', 'Tool names (comma-separated)')
  .option('-a, --all', 'Serve all available tools')
  .option('-n, --name <name>', 'Server name', 'SuperClaw Tool Server')
  .action(async (options) => {
    try {
      let server;
      
      if (options.all) {
        console.log('Starting MCP server with all SuperClaw tools...');
        server = await createFullSuperClawMCPServer(
          parseInt(options.port),
          options.name
        );
      } else if (options.tools) {
        const toolNames = options.tools.split(',').map((t: string) => t.trim());
        console.log(`Starting MCP server with tools: ${toolNames.join(', ')}`);
        server = await createToolSpecificMCPServer(
          toolNames,
          parseInt(options.port),
          options.name
        );
      } else {
        console.error('Either --tools or --all must be specified');
        process.exit(1);
      }
      
      // Keep the process alive
      process.on('SIGINT', async () => {
        console.log('\nShutting down MCP tool server...');
        await server.stop();
        process.exit(0);
      });
      
      console.log('MCP tool server is running. Press Ctrl+C to stop.');
    } catch (error: unknown) {
      console.error('Failed to start MCP tool server:', error);
      process.exit(1);
    }
  });

// --- Management Commands ---

program
  .command('list-tools')
  .description('List available SuperClaw tools')
  .option('-f, --format <format>', 'Output format (table|json)', 'table')
  .option('--category <category>', 'Filter by category')
  .action((options) => {
    const registry = getToolRegistry();
    let tools = registry.list();
    
    if (options.category) {
      tools = tools.filter(tool => tool.metadata?.category === options.category);
    }
    
    if (options.format === 'json') {
      console.log(JSON.stringify(tools, null, 2));
    } else {
      console.log('\nAvailable SuperClaw Tools:');
      console.log('==========================');
      for (const tool of tools) {
        console.log(`• ${tool.name} (${tool.metadata?.category || 'uncategorized'})`);
        console.log(`  ${tool.description}`);
        console.log(`  Risk: ${tool.metadata?.riskLevel || 'medium'}`);
        console.log();
      }
    }
  });

program
  .command('register-server')
  .description('Register a federated MCP server')
  .requiredOption('-i, --id <id>', 'Server ID')
  .requiredOption('-e, --endpoint <endpoint>', 'Server endpoint URL')
  .option('-t, --token <token>', 'Authentication token')
  .action(async (options) => {
    try {
      const registry = getFederatedToolRegistry();
      
      // This would typically be done through the federation controller
      // For now, we'll just log the command
      console.log('To register a server, use the federation API:');
      console.log(`POST /federation/servers`);
      console.log(`Body: ${JSON.stringify({
        id: options.id,
        endpoint: options.endpoint,
        auth: options.token ? { type: 'bearer', token: options.token } : undefined,
      }, null, 2)}`);
    } catch (error: unknown) {
      console.error('Failed to register server:', error);
      process.exit(1);
    }
  });

program
  .command('test-connection')
  .description('Test connection to an MCP server')
  .requiredOption('-e, --endpoint <endpoint>', 'Server endpoint URL')
  .option('-t, --token <token>', 'Authentication token')
  .action(async (options) => {
    try {
      console.log(`Testing connection to ${options.endpoint}...`);
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      
      if (options.token) {
        headers['Authorization'] = `Bearer ${options.token}`;
      }
      
      const response = await fetch(`${options.endpoint}/health`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(5000),
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log('✅ Connection successful!');
        console.log('Server info:', JSON.stringify(data, null, 2));
      } else {
        console.error(`❌ Connection failed: HTTP ${response.status} ${response.statusText}`);
        process.exit(1);
      }
    } catch (error: unknown) {
      console.error('❌ Connection failed:', error instanceof Error ? (error as Error).message : error);
      process.exit(1);
    }
  });

program
  .command('discover')
  .description('Discover tools from an MCP server')
  .requiredOption('-e, --endpoint <endpoint>', 'Server endpoint URL')
  .option('-t, --token <token>', 'Authentication token')
  .action(async (options) => {
    try {
      console.log(`Discovering tools from ${options.endpoint}...`);
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      
      if (options.token) {
        headers['Authorization'] = `Bearer ${options.token}`;
      }
      
      const response = await fetch(`${options.endpoint}/tools`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
        }),
        signal: AbortSignal.timeout(10000),
      });
      
      if (response.ok) {
        const data = await response.json();
        // @ts-expect-error - Post-Merge Reconciliation
        if (data.result?.tools) {
          // @ts-expect-error - Post-Merge Reconciliation
          console.log(`✅ Discovered ${data.result.tools.length} tools:`);
          console.log();
          // @ts-expect-error - Post-Merge Reconciliation
          for (const tool of data.result.tools) {
            console.log(`• ${tool.name}`);
            console.log(`  ${tool.description || 'No description'}`);
            if (tool.inputSchema?.properties) {
              const params = Object.keys(tool.inputSchema.properties);
              console.log(`  Parameters: ${params.join(', ') || 'none'}`);
            }
            console.log();
          }
        } else {
          console.log('No tools found or invalid response format');
        }
      } else {
        console.error(`❌ Discovery failed: HTTP ${response.status} ${response.statusText}`);
        process.exit(1);
      }
    } catch (error: unknown) {
      console.error('❌ Discovery failed:', error instanceof Error ? (error as Error).message : error);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show federation status')
  .action(() => {
    // This would show the status of running federation services
    console.log('SuperClaw MCP Federation Status');
    console.log('===============================');
    console.log('Use the federation API endpoints to get detailed status information.');
    console.log();
    console.log('Common endpoints:');
    console.log('• GET /health - Server health check');
    console.log('• GET /federation/servers - List registered servers');
    console.log('• GET /federation/metrics - Federation metrics');
    console.log('• POST /tools - List available tools');
  });

// --- Examples Command ---

program
  .command('examples')
  .description('Show usage examples')
  .action(() => {
    console.log(`
SuperClaw MCP CLI Examples
=========================

1. Start a basic federation server:
   $ superclaw-mcp federation --port 8080

2. Start a secure federation server:
   $ superclaw-mcp federation --mode secure --jwt-secret mysecret --port 8443

3. Start a development server:
   $ superclaw-mcp federation --mode dev

4. Serve specific tools:
   $ superclaw-mcp serve-tools --tools "web-search,shell,file-ops" --port 8081

5. Serve all tools:
   $ superclaw-mcp serve-tools --all --port 8082

6. List available tools:
   $ superclaw-mcp list-tools

7. Test connection to a server:
   $ superclaw-mcp test-connection --endpoint http://localhost:8080

8. Discover tools from a server:
   $ superclaw-mcp discover --endpoint http://localhost:8080

9. Register an external server (via API):
   $ curl -X POST http://localhost:8080/federation/servers \\
     -H "Content-Type: application/json" \\
     -d '{"id":"external","endpoint":"http://external:8081"}'

Environment Variables:
• MCP_JWT_SECRET - JWT secret for secure mode
• MCP_PORT - Default server port
• MCP_HOST - Default server host
• MCP_ALLOWED_ORIGINS - Allowed CORS origins
• MCP_DISCOVERY_ENDPOINTS - Discovery endpoints (comma-separated)
`);
  });

// Parse command line arguments
program.parse();

// If no command is provided, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
}