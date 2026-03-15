#!/usr/bin/env node
/**
 * Gas Town CLI Integration for SuperClaw
 * 
 * Command-line interface for Gas Town orchestration patterns.
 * Integrates with SuperClaw's existing CLI system.
 */

import { join } from 'path';
import { promises as fs } from 'fs';
import { 
  gastownSwarm, 
  initializeGasTownWorkspace, 
  createMayor,
  // @ts-expect-error - Post-Merge Reconciliation
  type ConvoyResult,
  type Mayor 
} from './gastown-patterns';
import { ProviderName } from '../types';

const DEFAULT_WORKSPACE = join(process.cwd(), '.gastown');

interface GastownCLIOptions {
  workspace?: string;
  strategy?: 'parallel' | 'sequential' | 'hybrid';
  maxPolecats?: number;
  providers?: string;
  mergeStrategy?: 'direct' | 'mr' | 'local';
  context?: string;
  verbose?: boolean;
  help?: boolean;
}

/**
 * Parse CLI arguments into options
 */
function parseArgs(args: string[]): { task: string; options: GastownCLIOptions } {
  const options: GastownCLIOptions = {};
  const taskParts: string[] = [];
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      
      switch (key) {
        case 'workspace':
          options.workspace = value;
          break;
        case 'strategy':
          options.strategy = value as 'parallel' | 'sequential' | 'hybrid';
          break;
        case 'max-polecats':
          options.maxPolecats = parseInt(value, 10);
          break;
        case 'providers':
          options.providers = value;
          break;
        case 'merge-strategy':
          options.mergeStrategy = value as 'direct' | 'mr' | 'local';
          break;
        case 'context':
          options.context = value;
          break;
        case 'verbose':
          options.verbose = true;
          break;
        case 'help':
          options.help = true;
          break;
        default:
          console.warn(`Unknown option: --${key}`);
      }
    } else {
      taskParts.push(arg);
    }
  }
  
  return {
    task: taskParts.join(' '),
    options,
  };
}

/**
 * Display help information
 */
function showHelp() {
  console.log(`
🏘️  Gas Town CLI - Multi-Agent Orchestration for SuperClaw

USAGE:
  superclaw gastown "<task>" [options]

EXAMPLES:
  # Simple task orchestration
  superclaw gastown "Build a REST API for user management"
  
  # Complex project with specific strategy
  superclaw gastown "Create e-commerce platform" --strategy=hybrid --max-polecats=4
  
  # With custom workspace and providers
  superclaw gastown "Implement chat system" \\
    --workspace=./my-project \\
    --providers=claude,gemini \\
    --context="Real-time messaging with WebSockets"

OPTIONS:
  --workspace=<path>          Workspace directory (default: ./.gastown)
  --strategy=<type>           Orchestration strategy (parallel|sequential|hybrid)
  --max-polecats=<num>        Maximum number of worker agents (default: 3)
  --providers=<list>          Comma-separated provider list (claude,gemini,codex)
  --merge-strategy=<type>     Git merge strategy (direct|mr|local)
  --context=<text>           Additional context for the task
  --verbose                   Show detailed progress information
  --help                      Show this help message

COMMANDS:
  superclaw gastown:status    Show workspace and convoy status
  superclaw gastown:list      List all convoys and their progress
  superclaw gastown:setup     Initialize new Gas Town workspace
  superclaw gastown:rigs      Manage project rigs
  superclaw gastown:polecats  Manage worker agents

GASTOWN CONCEPTS:
  🎩 Mayor     - AI coordinator that orchestrates work
  🏗️ Rigs      - Project containers wrapping git repos
  🦨 Polecats  - Specialized worker agents with persistent identity
  🪝 Hooks     - Git worktree-based persistent storage
  🚚 Convoys   - Work tracking units bundling related tasks
  
  MEOW Pattern: Tell the Mayor what to build, it handles the rest!

For more information, see: /home/toba/superclaw/src/swarm/orchestration/README.md
`);
}

/**
 * Display workspace status
 */
async function showStatus(workspacePath: string): Promise<void> {
  console.log('🏘️ Gas Town Workspace Status\n');
  
  try {
    const mayor = createMayor(workspacePath);
    await mayor.loadState();
    
    const convoys = await mayor.listConvoys();
    
    console.log(`📁 Workspace: ${workspacePath}`);
    console.log(`🚚 Active Convoys: ${convoys.filter(c => c.status === 'active').length}`);
    console.log(`✅ Completed Convoys: ${convoys.filter(c => c.status === 'completed').length}`);
    
    if (convoys.length === 0) {
      console.log('\n💡 No convoys found. Create your first convoy with:');
      console.log('   superclaw gastown "Your task description here"');
    } else {
      console.log('\n🚚 Recent Convoys:');
      for (const convoy of convoys.slice(-5)) {
        const status = convoy.status === 'active' ? '🟡' : 
                      convoy.status === 'completed' ? '✅' : 
                      convoy.status === 'paused' ? '⏸️' : '❌';
        console.log(`   ${status} ${convoy.name} (${convoy.beads.length} beads)`);
      }
    }
    
  } catch (error: unknown) {
    if (error instanceof Error && (error as Error).message.includes('ENOENT')) {
      console.log('❌ No Gas Town workspace found.');
      console.log('💡 Initialize with: superclaw gastown:setup');
    } else {
      console.error('❌ Error reading workspace:', error);
    }
  }
}

/**
 * List convoys with detailed status
 */
async function listConvoys(workspacePath: string): Promise<void> {
  console.log('🚚 Gas Town Convoys\n');
  
  try {
    const mayor = createMayor(workspacePath);
    await mayor.loadState();
    
    const convoys = await mayor.listConvoys();
    
    if (convoys.length === 0) {
      console.log('No convoys found.');
      return;
    }
    
    for (const convoy of convoys) {
      const status = await mayor.getConvoyStatus(convoy.id);
      if (!status) continue;
      
      const statusIcon = convoy.status === 'active' ? '🟡' : 
                        convoy.status === 'completed' ? '✅' : 
                        convoy.status === 'paused' ? '⏸️' : '❌';
      
      console.log(`${statusIcon} ${convoy.name}`);
      console.log(`   ID: ${convoy.id}`);
      console.log(`   Created: ${convoy.created.toLocaleDateString()}`);
      // @ts-expect-error - Post-Merge Reconciliation
      console.log(`   Progress: ${status.progress.completed}/${status.progress.total} (${status.progress.percentage.toFixed(1)}%)`);
      console.log(`   Strategy: ${convoy.mergeStrategy}, Owner: ${convoy.owner}`);
      
      // @ts-expect-error - Post-Merge Reconciliation
      if (status.progress.failed > 0) {
        // @ts-expect-error - Post-Merge Reconciliation
        console.log(`   ⚠️ Failed beads: ${status.progress.failed}`);
      }
      
      console.log('');
    }
    
  } catch (error: unknown) {
    console.error('❌ Error listing convoys:', error);
  }
}

/**
 * Setup new Gas Town workspace
 */
async function setupWorkspace(workspacePath: string): Promise<void> {
  console.log(`🏗️ Setting up Gas Town workspace at ${workspacePath}\n`);
  
  try {
    const mayor = await initializeGasTownWorkspace(workspacePath);
    
    console.log('✅ Workspace initialized successfully!');
    console.log(`📁 Location: ${workspacePath}`);
    
    // Create default rig if none exists
    console.log('\n🏗️ Creating default rig...');
    const defaultRig = await mayor.addRig(
      'default',
      'https://github.com/example/default-project.git'
    );
    
    console.log(`✅ Default rig created: ${defaultRig.name}`);
    
    // Save initial state
    await mayor.saveState();
    
    console.log('\n🎩 Mayor is ready! Try:');
    console.log('   superclaw gastown "Build a simple web server"');
    
  } catch (error: unknown) {
    console.error('❌ Error setting up workspace:', error);
  }
}

/**
 * Manage rigs
 */
async function manageRigs(workspacePath: string, action: string, args: string[]): Promise<void> {
  const mayor = createMayor(workspacePath);
  await mayor.loadState();
  
  switch (action) {
    case 'list':
      console.log('🏗️ Project Rigs:\n');
      // TODO: Implement rig listing when method is available
      console.log('Rig management coming soon...');
      break;
      
    case 'add':
      if (args.length < 2) {
        console.error('Usage: superclaw gastown:rigs add <name> <git-url>');
        return;
      }
      const [name, gitUrl] = args;
      const rig = await mayor.addRig(name, gitUrl);
      console.log(`✅ Added rig: ${rig.name} (${rig.gitRepo})`);
      await mayor.saveState();
      break;
      
    default:
      console.error(`Unknown rig action: ${action}`);
      console.log('Available actions: list, add');
  }
}

/**
 * Manage polecats
 */
async function managePolecats(workspacePath: string, action: string, args: string[]): Promise<void> {
  const mayor = createMayor(workspacePath);
  await mayor.loadState();
  
  switch (action) {
    case 'list':
      console.log('🦨 Worker Polecats:\n');
      // TODO: Implement polecat listing when method is available
      console.log('Polecat management coming soon...');
      break;
      
    case 'create':
      if (args.length < 3) {
        console.error('Usage: superclaw gastown:polecats create <name> <provider> <rig-id>');
        return;
      }
      const [name, provider, rigId] = args;
      const polecat = await mayor.createPolecat(name, provider as ProviderName, rigId);
      console.log(`✅ Created polecat: ${polecat.name} (${polecat.provider})`);
      await mayor.saveState();
      break;
      
    default:
      console.error(`Unknown polecat action: ${action}`);
      console.log('Available actions: list, create');
  }
}

/**
 * Execute Gas Town orchestration
 */
async function executeOrchestration(task: string, options: GastownCLIOptions): Promise<ConvoyResult> {
  const workspacePath = options.workspace || DEFAULT_WORKSPACE;
  
  if (options.verbose) {
    console.log('🎩 Mayor is analyzing your task...\n');
    console.log(`Task: ${task}`);
    console.log(`Workspace: ${workspacePath}`);
    console.log(`Strategy: ${options.strategy || 'auto'}`);
    console.log(`Max Polecats: ${options.maxPolecats || 'auto'}`);
    console.log('');
  }
  
  const providers = options.providers ? 
    options.providers.split(',') as ProviderName[] : 
    undefined;
  
  const result = await gastownSwarm(task, {
    workspace: workspacePath,
    context: options.context,
    strategy: options.strategy,
    maxPolecats: options.maxPolecats,
    providers,
  });
  
  if (options.verbose) {
    console.log('\n📊 Detailed Results:');
    console.log(`• Convoy ID: ${result.convoy.id}`);
    console.log(`• Strategy Used: ${result.strategy}`);
    console.log(`• Total Beads: ${result.beads.length}`);
    // @ts-expect-error - Post-Merge Reconciliation
    console.log(`• Polecats Assigned: ${result.assignments.size}`);
    console.log(`• Execution Time: ${(result.totalDurationMs / 1000).toFixed(1)}s`);
    // @ts-expect-error - Post-Merge Reconciliation
    console.log(`• Success Rate: ${result.synthesis.success ? '100%' : 'Partial'}`);
  }
  
  return result;
}

/**
 * Main CLI handler
 */
export async function gastownCLI(args: string[]): Promise<void> {
  const command = args[0];
  
  // Handle subcommands
  if (command?.includes(':')) {
    const [base, subcommand] = command.split(':');
    const subArgs = args.slice(1);
    const workspacePath = DEFAULT_WORKSPACE;
    
    switch (subcommand) {
      case 'status':
        await showStatus(workspacePath);
        return;
        
      case 'list':
        await listConvoys(workspacePath);
        return;
        
      case 'setup':
        const setupPath = subArgs[0] || workspacePath;
        await setupWorkspace(setupPath);
        return;
        
      case 'rigs':
        const rigAction = subArgs[0];
        const rigArgs = subArgs.slice(1);
        await manageRigs(workspacePath, rigAction, rigArgs);
        return;
        
      case 'polecats':
        const polecatAction = subArgs[0];
        const polecatArgs = subArgs.slice(1);
        await managePolecats(workspacePath, polecatAction, polecatArgs);
        return;
        
      default:
        console.error(`Unknown subcommand: ${subcommand}`);
        process.exit(1);
    }
  }
  
  // Handle main orchestration command
  const { task, options } = parseArgs(args);
  
  if (options.help || !task) {
    showHelp();
    return;
  }
  
  try {
    console.log('🏘️ Starting Gas Town orchestration...\n');
    
    const result = await executeOrchestration(task, options);
    
    console.log('✨ Gas Town orchestration completed!\n');
    console.log('📋 Summary:');
    console.log(`• Task: ${task}`);
    console.log(`• Convoy: ${result.convoy.name}`);
    console.log(`• Beads Created: ${result.beads.length}`);
    console.log(`• Duration: ${(result.totalDurationMs / 1000).toFixed(1)} seconds`);
    console.log(`• Strategy: ${result.strategy}`);
    
    if (result.synthesis.success) {
      console.log('• Status: ✅ Successfully completed');
    } else {
      console.log('• Status: ⚠️ Partially completed');
    }
    
    console.log('\n💡 Next steps:');
    console.log(`• Check results: superclaw gastown:list`);
    console.log(`• View workspace: cd ${options.workspace || DEFAULT_WORKSPACE}`);
    console.log('• Git history: git log --oneline');
    
  } catch (error: unknown) {
    console.error('❌ Gas Town orchestration failed:', error);
    
    if (error instanceof Error && (error as Error).message.includes('ENOENT')) {
      console.log('\n💡 Try initializing workspace first:');
      console.log('   superclaw gastown:setup');
    }
    
    process.exit(1);
  }
}

// Export for integration with SuperClaw CLI
export default gastownCLI;