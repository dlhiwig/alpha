import { registry } from '../skills/registry';
import { SkillMatch, SkillDefinition } from '../skills/types';
import { runSwarm } from './lightweight-swarm';

// --- Types ---
export interface ClassifiedTask {
  input: string;
  skill: SkillDefinition;
  confidence: number;
  matchType: string;
  agentRoles: string[];
}

export interface ExecutionResult {
  task: ClassifiedTask;
  output: string;
  logFile: string;
  stats: {
    agents: number;
    time: number;
    successRate: number;
  };
}

// --- Classifier ---
export function classify(input: string): ClassifiedTask | null {
  const match = registry.match(input);
  
  if (!match) {
    console.log('[Classifier] ❌ No skill matched');
    return null;
  }

  const agentRoles = [
    ...match.skill.agents.required.map(a => a.role),
    ...(match.skill.agents.optional?.map(a => a.role) || []),
  ];

  console.log(`[Classifier] ✅ Matched: ${match.skill.id} (${match.matchType}, ${(match.confidence * 100).toFixed(0)}%)`);
  console.log(`[Classifier] Agents: ${agentRoles.join(', ')}`);

  return {
    input,
    skill: match.skill,
    confidence: match.confidence,
    matchType: match.matchType,
    agentRoles,
  };
}

// --- Execute with Skill Context ---
export async function execute(input: string): Promise<ExecutionResult | null> {
  console.log('\n=== 🎯 SuperClaw Classifier ===\n');
  
  const task = classify(input);
  
  if (!task) {
    return null;
  }

  // Build skill-aware prompt
  const skillContext = buildSkillPrompt(task);
  
  // Run swarm with skill context
  const result = await runSwarm(skillContext);

  return {
    task,
    output: result.output,
    logFile: result.logFile,
    stats: result.stats,
  };
}

// --- Build Skill-Aware Prompt ---
function buildSkillPrompt(task: ClassifiedTask): string {
  const skill = task.skill;
  
  let prompt = `## Task: ${task.input}\n\n`;
  prompt += `## Skill: ${skill.name}\n`;
  prompt += `${skill.description || ''}\n\n`;
  
  // Add agent guidance
  prompt += `## Agent Roles Required:\n`;
  for (const agent of skill.agents.required) {
    prompt += `- **${agent.role}**: ${agent.focus}\n`;
  }
  
  if (skill.agents.optional?.length) {
    prompt += `\n## Optional Agents (if needed):\n`;
    for (const agent of skill.agents.optional) {
      prompt += `- **${agent.role}**: ${agent.focus}\n`;
    }
  }

  // Add output guidance
  if (skill.output) {
    prompt += `\n## Expected Output Format: ${skill.output.format}\n`;
    if (skill.output.sections?.length) {
      prompt += `Required sections: ${skill.output.sections.filter(s => s.required).map(s => s.name).join(', ')}\n`;
    }
  }

  return prompt;
}

// --- CLI Entry ---
if (require.main === module) {
  const input = process.argv.slice(2).join(' ') || 'Analyze the current codebase';

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  execute(input)
    .then((result) => {
      if (result) {
        console.log('\n=== 📋 Final Output ===\n');
        console.log(result.output);
        console.log('\n=== 📊 Stats ===');
        console.log(`Skill: ${result.task.skill.id}`);
        console.log(`Confidence: ${(result.task.confidence * 100).toFixed(0)}%`);
        console.log(`Agents: ${result.stats.agents}`);
        console.log(`Time: ${result.stats.time}ms`);
        console.log(`Log: ${result.logFile}`);
      } else {
        console.log('No result - task could not be classified');
      }
    })
    .catch(console.error);
}
