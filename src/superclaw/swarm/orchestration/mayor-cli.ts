/**
 * Mayor CLI - Gas Town Mayor Pattern CLI Interface
 * 
 * Provides command-line interface for the SuperClaw Mayor coordination system.
 */

import { join } from 'path';
// @ts-expect-error - Post-Merge Reconciliation
import { SwarmMayor, gastownSwarm, type ProviderName } from '../mayor';

/**
 * CLI entry point for mayor commands
 */
export async function mayorCLI(args: string[]): Promise<void> {
  const [command, ...commandArgs] = args;

  if (!command) {
    showHelp();
    process.exit(2);
  }

  try {
    switch (command) {
      case 'orchestrate':
      case 'o':
        await handleOrchestrate(commandArgs);
        break;
      
      case 'status':
      case 's':
        await handleStatus(commandArgs);
        break;
      
      case 'convoy':
      case 'c':
        await handleConvoy(commandArgs);
        break;
      
      case 'rig':
      case 'r':
        await handleRig(commandArgs);
        break;
      
      case 'init':
      case 'i':
        await handleInit(commandArgs);
        break;
      
      case 'help':
      case 'h':
      default:
        showHelp();
        break;
    }
  } catch (error: unknown) {
    console.error(`[mayor] Error: ${error}`);
    process.exit(1);
  }
}

async function handleOrchestrate(args: string[]): Promise<void> {
  const task = args.filter(a => !a.startsWith('--')).join(' ');
  
  if (!task) {
    console.error('Usage: superclaw mayor orchestrate "<task>" [options]');
    process.exit(2);
  }

  // Parse options
  const workspaceArg = args.find(a => a.startsWith('--workspace='));
  const workspace = workspaceArg?.split('=')[1] || join(process.cwd(), '.gastown');

  const contextArg = args.find(a => a.startsWith('--context='));
  const context = contextArg?.split('=')[1];

  const strategyArg = args.find(a => a.startsWith('--strategy='));
  const strategy = strategyArg?.split('=')[1] as 'parallel' | 'sequential' | 'hybrid' | undefined;

  const maxPolecatsArg = args.find(a => a.startsWith('--max-polecats='));
  const maxPolecats = maxPolecatsArg ? parseInt(maxPolecatsArg.split('=')[1]) : undefined;

  const mergeStrategyArg = args.find(a => a.startsWith('--merge='));
  const mergeStrategy = mergeStrategyArg?.split('=')[1] as 'direct' | 'mr' | 'pr' | undefined;

  const providersArg = args.find(a => a.startsWith('--providers='));
  const providers = providersArg?.split('=')[1].split(',') as ProviderName[] | undefined;

  console.log(`[mayor] Orchestrating: ${task}`);
  console.log(`[mayor] Workspace: ${workspace}`);
  console.log(`[mayor] Strategy: ${strategy || 'parallel'}`);
  console.log('');

  const result = await gastownSwarm(task, {
    workspace,
    context,
    strategy,
    maxPolecats,
    mergeStrategy,
    providers,
  });

  console.log('');
  console.log('='.repeat(60));
  console.log('MAYOR ORCHESTRATION COMPLETE');
  console.log('='.repeat(60));
  console.log('');
  console.log(`📋 Convoy: ${result.convoy.name}`);
  console.log(`🔗 Beads: ${result.beads.length}`);
  console.log(`👥 Assignments: ${result.assignments.length}`);
  console.log(`⏱️  Duration: ${(result.totalDurationMs / 1000).toFixed(1)}s`);
  console.log(`🎯 Strategy: ${result.strategy.approach}`);
  console.log('');
  console.log('📝 SYNTHESIS:');
  console.log(result.synthesis);
  console.log('');
  
  // Show bead breakdown
  if (result.beads.length > 1) {
    console.log('🧩 BEAD BREAKDOWN:');
    result.beads.forEach((bead, i) => {
      const assignment = result.assignments.find(a => a.beadId === bead.id);
      const duration = assignment?.result ? 
        `(${(assignment.result.totalDurationMs / 1000).toFixed(1)}s)` : '';
      console.log(`  ${i + 1}. ${bead.title} ${duration}`);
      console.log(`     ${bead.description}`);
    });
    console.log('');
  }
}

async function handleStatus(args: string[]): Promise<void> {
  const workspaceArg = args.find(a => a.startsWith('--workspace='));
  const workspace = workspaceArg?.split('=')[1] || join(process.cwd(), '.gastown');

  const mayor = new SwarmMayor(workspace);
  await mayor.loadState();

  const convoys = await mayor.listConvoys();

  console.log(`[mayor] Workspace: ${workspace}`);
  console.log(`[mayor] Active convoys: ${convoys.length}`);
  console.log('');

  if (convoys.length === 0) {
    console.log('No convoys found. Use `mayor init` to set up workspace.');
    return;
  }

  // Show convoy summaries
  for (const convoy of convoys.slice(0, 10)) { // Show max 10
    const status = await mayor.getConvoyStatus(convoy.id);
    if (status) {
      const completion = status.progress.total > 0 ? 
        ((status.progress.completed / status.progress.total) * 100).toFixed(0) : '0';
      
      console.log(`📋 ${convoy.name} (${convoy.status})`);
      console.log(`   Progress: ${status.progress.completed}/${status.progress.total} beads (${completion}%)`);
      console.log(`   Created: ${convoy.created.toLocaleString()}`);
      console.log('');
    }
  }
}

async function handleConvoy(args: string[]): Promise<void> {
  const [subcommand, ...subArgs] = args;
  
  if (!subcommand) {
    console.error('Usage: superclaw mayor convoy <list|status|create> [options]');
    process.exit(2);
  }

  const workspaceArg = args.find(a => a.startsWith('--workspace='));
  const workspace = workspaceArg?.split('=')[1] || join(process.cwd(), '.gastown');
  
  const mayor = new SwarmMayor(workspace);
  await mayor.loadState();

  switch (subcommand) {
    case 'list':
    case 'ls':
      const convoys = await mayor.listConvoys();
      console.log(`Found ${convoys.length} convoys:`);
      convoys.forEach(c => {
        console.log(`  ${c.id}: ${c.name} (${c.status}, ${c.beads.length} beads)`);
      });
      break;
      
    case 'status':
      const convoyId = subArgs[0];
      if (!convoyId) {
        console.error('Usage: superclaw mayor convoy status <convoy-id>');
        process.exit(2);
      }
      
      const status = await mayor.getConvoyStatus(convoyId);
      if (!status) {
        console.error(`Convoy ${convoyId} not found`);
        process.exit(1);
      }
      
      console.log(`Convoy: ${status.convoy.name}`);
      console.log(`Status: ${status.convoy.status}`);
      console.log(`Progress: ${status.progress.completed}/${status.progress.total} beads`);
      if (status.estimatedCompletion) {
        console.log(`Estimated completion: ${status.estimatedCompletion.toLocaleString()}`);
      }
      break;
      
    default:
      console.error(`Unknown convoy subcommand: ${subcommand}`);
      process.exit(1);
  }
}

async function handleRig(args: string[]): Promise<void> {
  const [subcommand, ...subArgs] = args;
  
  if (!subcommand) {
    console.error('Usage: superclaw mayor rig <add|list> [options]');
    process.exit(2);
  }

  const workspaceArg = args.find(a => a.startsWith('--workspace='));
  const workspace = workspaceArg?.split('=')[1] || join(process.cwd(), '.gastown');
  
  const mayor = new SwarmMayor(workspace);
  await mayor.loadState();

  switch (subcommand) {
    case 'add':
      const [name, repo] = subArgs.filter(a => !a.startsWith('--'));
      if (!name || !repo) {
        console.error('Usage: superclaw mayor rig add <name> <git-repo>');
        process.exit(2);
      }
      
      const rig = await mayor.addRig(name, repo);
      console.log(`✅ Added rig: ${rig.name} -> ${rig.workspacePath}`);
      break;
      
    case 'list':
    case 'ls':
      // Note: This requires accessing private state, so we'll use the convoy list as a proxy
      const convoys = await mayor.listConvoys();
      console.log(`Workspace contains ${convoys.length} convoys (rigs are internal to mayor state)`);
      break;
      
    default:
      console.error(`Unknown rig subcommand: ${subcommand}`);
      process.exit(1);
  }
}

async function handleInit(args: string[]): Promise<void> {
  const workspaceArg = args.find(a => a.startsWith('--workspace='));
  const workspace = workspaceArg?.split('=')[1] || join(process.cwd(), '.gastown');

  console.log(`[mayor] Initializing Gas Town workspace: ${workspace}`);
  
  const mayor = new SwarmMayor(workspace);
  await mayor.loadState();
  
  // Create a default rig
  const defaultRig = await mayor.addRig('default', 'memory://workspace');
  
  console.log(`✅ Initialized Gas Town workspace`);
  console.log(`📁 Workspace: ${workspace}`);
  console.log(`🏗️  Default rig: ${defaultRig.name}`);
  console.log('');
  console.log('Next steps:');
  console.log('  superclaw mayor orchestrate "your task here"');
  console.log('  superclaw mayor status');
}

function showHelp(): void {
  console.log('SuperClaw Mayor - Gas Town Orchestration Pattern');
  console.log('');
  console.log('Usage: superclaw mayor <command> [options]');
  console.log('');
  console.log('Commands:');
  console.log('  orchestrate, o  "<task>"     Orchestrate a task using Mayor pattern');
  console.log('  status, s                    Show workspace status');
  console.log('  convoy, c <subcommand>       Manage convoys');
  console.log('  rig, r <subcommand>          Manage rigs');
  console.log('  init, i                      Initialize Gas Town workspace');
  console.log('  help, h                      Show this help');
  console.log('');
  console.log('Orchestrate Options:');
  console.log('  --workspace=<path>           Workspace directory');
  console.log('  --context=<text>             Additional context');
  console.log('  --strategy=parallel|sequential|hybrid');
  console.log('  --max-polecats=<n>           Max concurrent agents');
  console.log('  --merge=direct|mr|pr         Merge strategy');
  console.log('  --providers=claude,gemini    Comma-separated providers');
  console.log('');
  console.log('Examples:');
  console.log('  superclaw mayor o "Build a login system"');
  console.log('  superclaw mayor o "Create REST API" --strategy=sequential');
  console.log('  superclaw mayor status --workspace=./my-project');
  console.log('  superclaw mayor convoy list');
}