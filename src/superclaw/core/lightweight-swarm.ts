/**
 * SuperClaw Lightweight Swarm
 * Refactored to use YAML configuration
 */

import * as fs from 'fs';
import * as path from 'path';
import { 
  getSwarmConfig, 
  getModelConfig, 
  getPromptTemplates,
  getRolePrompt 
} from '../utils/config-loader';

// --- Load Configuration ---
const swarmConfig = getSwarmConfig();
const modelConfig = getModelConfig();
const prompts = getPromptTemplates();

// Runtime values (from config + env)
const LOG_DIR = path.join(__dirname, '../../', swarmConfig.logging.log_dir);
const OUTPUT_DIR = path.join(__dirname, '../../', swarmConfig.output.output_dir);
const MAX_CONCURRENT_AGENTS = swarmConfig.swarm.max_concurrent_agents;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = modelConfig.default.model;
const MAX_TOKENS = modelConfig.default.max_tokens;

// --- Types ---
interface SubTask {
  id: string;
  role: string;
  instructions: string;
}

interface SwarmResult {
  taskId: string;
  role: string;
  output: string;
  status: 'success' | 'failure';
  latency: number;
  tokens?: { input: number; output: number };
}

interface SwarmRun {
  timestamp: string;
  objective: string;
  totalTime: number;
  agentsUsed: number;
  successRate: number;
  totalTokens: { input: number; output: number };
  results: SwarmResult[];
}

// --- Anthropic API Call ---
async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  options?: { model?: string; max_tokens?: number }
): Promise<{ text: string; tokens: { input: number; output: number } }> {
  const model = options?.model || MODEL;
  const maxTokens = options?.max_tokens || MAX_TOKENS;
  const endpoint = modelConfig.endpoints.anthropic;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Anthropic API error: ${response.status} - ${error}`);
  }

  const data = await response.json() as {
    content: Array<{ text: string }>;
    usage: { input_tokens: number; output_tokens: number };
  };
  return {
    text: data.content[0]?.text || '',
    tokens: {
      input: data.usage?.input_tokens || 0,
      output: data.usage?.output_tokens || 0,
    },
  };
}

// --- Core: Decomposer ---
async function decomposeTask(mainObjective: string): Promise<SubTask[]> {
  console.log(`[Swarm] 🎯 Decomposing: "${mainObjective.slice(0, 50)}..."`);

  // Use prompts from config
  const system = prompts.decomposer.system;
  const prompt = prompts.decomposer.user_template.replace('{objective}', mainObjective);

  try {
    const { text } = await callLLM(system, prompt);
    // Extract JSON from response (handle potential markdown wrapping)
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON array found in response');
    const tasks = JSON.parse(jsonMatch[0]) as SubTask[];
    
    // Validate task count against config
    const { min_tasks, max_tasks } = swarmConfig.decomposition;
    if (tasks.length < min_tasks || tasks.length > max_tasks) {
      console.log(`[Swarm] ⚠️ Task count (${tasks.length}) outside range [${min_tasks}-${max_tasks}]`);
    }
    
    return tasks;
  } catch (error: unknown) {
    console.error('[Swarm] Decomposition failed, using fallback:', error);
    // Fallback: single-agent execution
    return [
      {
        id: '1',
        role: 'architect',
        instructions: mainObjective,
      },
    ];
  }
}

// --- Core: Agent Execution ---
async function executeAgent(task: SubTask): Promise<SwarmResult> {
  const start = Date.now();
  console.log(`[Agent: ${task.role}] 🔧 Starting task ${task.id}...`);

  // Get role prompt from config
  const rolePrompt = getRolePrompt(task.role);

  try {
    const { text, tokens } = await callLLM(rolePrompt, task.instructions);

    if (swarmConfig.logging.log_latency) {
      console.log(`[Agent: ${task.role}] ✅ Completed in ${Date.now() - start}ms`);
    }

    return {
      taskId: task.id,
      role: task.role,
      output: text,
      status: 'success',
      latency: Date.now() - start,
      tokens,
    };
  } catch (error: unknown) {
    console.error(`[Agent: ${task.role}] ❌ Failed:`, error);
    return {
      taskId: task.id,
      role: task.role,
      output: `Error: ${error}`,
      status: 'failure',
      latency: Date.now() - start,
    };
  }
}

// --- Throttled Parallel Execution ---
async function executeWithThrottle(
  tasks: SubTask[],
  maxConcurrent: number
): Promise<SwarmResult[]> {
  const results: SwarmResult[] = [];
  const executing: Promise<void>[] = [];

  for (const task of tasks) {
    const promise = executeAgent(task).then((result) => {
      results.push(result);
    });
    executing.push(promise);

    if (executing.length >= maxConcurrent) {
      await Promise.race(executing);
      // Remove completed promises
      for (let i = executing.length - 1; i >= 0; i--) {
        const status = await Promise.race([
          executing[i].then(() => 'done'),
          Promise.resolve('pending'),
        ]);
        if (status === 'done') executing.splice(i, 1);
      }
    }
  }

  await Promise.all(executing);
  return results;
}

// --- Core: Aggregator ---
async function aggregateResults(
  objective: string,
  results: SwarmResult[]
): Promise<string> {
  console.log(`[Swarm] 🔗 Aggregating ${results.length} results...`);

  const successfulResults = results.filter((r) => r.status === 'success');
  if (successfulResults.length === 0) {
    return 'All agents failed. No output to aggregate.';
  }

  const context = successfulResults
    .map((r) => `=== ${r.role.toUpperCase()} (Task ${r.taskId}) ===\n${r.output}`)
    .join('\n\n---\n\n');

  // Use aggregator prompts from config
  const system = prompts.aggregator.system;
  const prompt = prompts.aggregator.user_template
    .replace('{objective}', objective)
    .replace('{results}', context);

  const { text } = await callLLM(system, prompt);
  return text;
}

// --- SONA Performance Logger ---
function logPerformance(
  objective: string,
  totalTime: number,
  results: SwarmResult[],
  finalOutput: string
): string {
  // Create directories if needed
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const totalTokens = results.reduce(
    (acc, r) => ({
      input: acc.input + (r.tokens?.input || 0),
      output: acc.output + (r.tokens?.output || 0),
    }),
    { input: 0, output: 0 }
  );

  const logEntry: SwarmRun = {
    timestamp: new Date().toISOString(),
    objective,
    totalTime,
    agentsUsed: results.length,
    successRate: results.filter((r) => r.status === 'success').length / results.length,
    totalTokens,
    results: swarmConfig.logging.log_individual_agents
      ? results.map((r) => ({
          ...r,
          output: r.output.slice(0, 500) + (r.output.length > 500 ? '...' : ''),
        }))
      : [],
  };

  // Log to swarm log directory
  const logFilename = path.join(LOG_DIR, `run-${Date.now()}.json`);
  fs.writeFileSync(logFilename, JSON.stringify(logEntry, null, 2));

  // Save full output if configured
  if (swarmConfig.output.save_results) {
    const outputFilename = path.join(OUTPUT_DIR, `output-${Date.now()}.md`);
    fs.writeFileSync(outputFilename, `# Swarm Output\n\n**Objective:** ${objective}\n\n**Generated:** ${new Date().toISOString()}\n\n---\n\n${finalOutput}`);
    console.log(`[SONA] 📄 Output saved: ${outputFilename}`);
  }

  console.log(`[SONA] 📊 Performance logged: ${logFilename}`);
  return logFilename;
}

// --- Main Entry Point ---
export async function runSwarm(objective: string): Promise<{
  output: string;
  logFile: string;
  stats: { agents: number; time: number; successRate: number };
}> {
  const start = Date.now();
  console.log('\n=== 🚀 SuperClaw Lightweight Swarm ===\n');

  // 1. Decompose
  const plan = await decomposeTask(objective);
  console.log(`[Plan] 📋 Generated ${plan.length} sub-tasks\n`);

  // 2. Execute (Throttled parallel)
  const results = await executeWithThrottle(plan, MAX_CONCURRENT_AGENTS);

  // 3. Aggregate
  const finalOutput = await aggregateResults(objective, results);

  // 4. Log for SONA
  const totalTime = Date.now() - start;
  const logFile = logPerformance(objective, totalTime, results, finalOutput);

  const stats = {
    agents: results.length,
    time: totalTime,
    successRate: results.filter((r) => r.status === 'success').length / results.length,
  };

  console.log('\n=== ✅ Swarm Complete ===');
  console.log(`Time: ${totalTime}ms | Agents: ${stats.agents} | Success: ${(stats.successRate * 100).toFixed(0)}%\n`);

  return { output: finalOutput, logFile, stats };
}

// --- CLI Entry ---
if (require.main === module) {
  const objective = process.argv[2] || 'Analyze this codebase and suggest improvements.';

  if (!ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  runSwarm(objective)
    .then(({ output, stats }) => {
      console.log('--- Final Output ---');
      console.log(output);
      console.log('\n--- Stats ---');
      console.log(stats);
    })
    .catch(console.error);
}
