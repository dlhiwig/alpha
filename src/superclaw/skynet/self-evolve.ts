/**
 * 🦊 SKYNET SELF-EVOLVE — The Fox Writes Its Own Code
 * 
 * Phase 4: EVOLVE
 * The fox proposes code changes and opens PRs to itself.
 * 
 * Flow:
 * 1. User requests evolution (new feature, fix, improvement)
 * 2. ORACLE analyzes patterns and suggests approach
 * 3. CORTEX provides context from memory
 * 4. LLM generates code diff
 * 5. GitHub PR opened for human review
 * 
 * "The fox proposes. The human approves."
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  REPO_OWNER: 'dlhiwig',
  REPO_NAME: 'superclaw',
  BRANCH_PREFIX: 'self-evolve',
  STATE_FILE: path.join(process.cwd(), 'data', 'self-evolve-state.json'),
  LOG_FILE: path.join(process.cwd(), 'data', 'self-evolve-log.json'),
};

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface EvolutionRequest {
  prompt: string;
  type: 'feature' | 'fix' | 'improvement' | 'refactor';
  priority: 'low' | 'medium' | 'high';
  context?: string;
}

interface CodeChange {
  file: string;
  action: 'create' | 'modify' | 'delete';
  content?: string;
  diff?: string;
}

interface EvolutionPlan {
  id: string;
  timestamp: number;
  request: EvolutionRequest;
  title: string;
  description: string;
  changes: CodeChange[];
  reasoning: string;
  estimatedImpact: 'low' | 'medium' | 'high';
  status: 'planned' | 'pr-opened' | 'merged' | 'rejected';
  prUrl?: string;
  prNumber?: number;
}

interface SelfEvolveState {
  startedAt: number;
  totalProposals: number;
  totalPRsOpened: number;
  totalMerged: number;
  totalRejected: number;
  pendingPlans: EvolutionPlan[];
  history: EvolutionPlan[];
}

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

let state: SelfEvolveState = {
  startedAt: Date.now(),
  totalProposals: 0,
  totalPRsOpened: 0,
  totalMerged: 0,
  totalRejected: 0,
  pendingPlans: [],
  history: [],
};

// ═══════════════════════════════════════════════════════════════
// PERSISTENCE
// ═══════════════════════════════════════════════════════════════

async function loadState(): Promise<void> {
  try {
    const data = await fs.readFile(CONFIG.STATE_FILE, 'utf8');
    state = { ...state, ...JSON.parse(data) };
    console.log(`[🦊 SELF-EVOLVE] Loaded ${state.totalProposals} total proposals`);
  } catch {
    // Fresh start
  }
}

async function saveState(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(CONFIG.STATE_FILE), { recursive: true });
    await fs.writeFile(CONFIG.STATE_FILE, JSON.stringify(state, null, 2));
  } catch (error: unknown) {
    console.error('[🦊 SELF-EVOLVE] Failed to save state:', error);
  }
}

async function logEvolution(plan: EvolutionPlan): Promise<void> {
  try {
    await fs.mkdir(path.dirname(CONFIG.LOG_FILE), { recursive: true });
    
    let logs: EvolutionPlan[] = [];
    try {
      const data = await fs.readFile(CONFIG.LOG_FILE, 'utf8');
      logs = JSON.parse(data);
    } catch {
      // New log
    }
    
    logs.push(plan);
    
    // Keep last 100 plans
    if (logs.length > 100) {
      logs = logs.slice(-100);
    }
    
    await fs.writeFile(CONFIG.LOG_FILE, JSON.stringify(logs, null, 2));
  } catch (error: unknown) {
    console.error('[🦊 SELF-EVOLVE] Failed to log evolution:', error);
  }
}

// ═══════════════════════════════════════════════════════════════
// EVOLUTION ENGINE
// ═══════════════════════════════════════════════════════════════

function generatePlanId(): string {
  return `evolve-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Generate an evolution plan using LLM
 */
async function generatePlan(request: EvolutionRequest): Promise<EvolutionPlan> {
  const systemPrompt = `You are the 🦊 SuperClaw, a self-evolving AI system.
You are proposing a code change to improve yourself.

Your response MUST be valid JSON with this exact structure:
{
  "title": "Brief title for the PR",
  "description": "Detailed description of what this change does",
  "reasoning": "Why this change is needed and how it helps",
  "estimatedImpact": "low" | "medium" | "high",
  "changes": [
    {
      "file": "path/to/file.ts",
      "action": "create" | "modify" | "delete",
      "content": "full file content for create, or new content for modify",
      "diff": "description of what changed (for modify)"
    }
  ]
}

Rules:
- Keep changes minimal and focused
- Only propose changes that are safe and reversible
- Include clear reasoning
- Match the existing code style
- Add appropriate error handling`;

  const userPrompt = `Evolution request:
Type: ${request.type}
Priority: ${request.priority}
Request: ${request.prompt}
${request.context ? `\nAdditional context: ${request.context}` : ''}

Generate the evolution plan as JSON.`;

  try {
    const response = await fetch('http://localhost:3737/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.EVOLUTION_MODEL || 'claude-3-haiku-20240307',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 4096,
      }),
    });

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content || '{}';
    
    // Parse the JSON response
    let parsed;
    try {
      // Try to extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('[🦊 SELF-EVOLVE] Failed to parse LLM response:', parseError);
      parsed = {
        title: `Evolution: ${request.prompt.slice(0, 50)}`,
        description: content,
        reasoning: 'Auto-generated from request',
        estimatedImpact: 'low',
        changes: [],
      };
    }

    const plan: EvolutionPlan = {
      id: generatePlanId(),
      timestamp: Date.now(),
      request,
      title: parsed.title || `Evolution: ${request.prompt.slice(0, 50)}`,
      description: parsed.description || '',
      changes: parsed.changes || [],
      reasoning: parsed.reasoning || '',
      estimatedImpact: parsed.estimatedImpact || 'low',
      status: 'planned',
    };

    return plan;
  } catch (error: unknown) {
    console.error('[🦊 SELF-EVOLVE] Failed to generate plan:', error);
    throw error;
  }
}

/**
 * Create a GitHub PR for the evolution plan
 */
async function createPR(plan: EvolutionPlan): Promise<{ prUrl: string; prNumber: number }> {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN not configured');
  }

  const branchName = `${CONFIG.BRANCH_PREFIX}/${plan.id}`;
  const baseUrl = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}`;
  
  const headers = {
    'Authorization': `token ${token}`,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  };

  try {
    // 1. Get the SHA of main branch
    const refResponse = await fetch(`${baseUrl}/git/ref/heads/main`, { headers });
    if (!refResponse.ok) {
      throw new Error(`Failed to get main ref: ${await refResponse.text()}`);
    }
    const refData: any = await refResponse.json();
    const baseSha = refData.object.sha;

    // 2. Create a new branch
    const createBranchResponse = await fetch(`${baseUrl}/git/refs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: baseSha,
      }),
    });
    
    if (!createBranchResponse.ok) {
      const error = await createBranchResponse.text();
      // Branch might already exist
      if (!error.includes('Reference already exists')) {
        throw new Error(`Failed to create branch: ${error}`);
      }
    }

    // 3. Apply changes
    for (const change of plan.changes) {
      if (change.action === 'create' || change.action === 'modify') {
        if (!change.content) continue;
        
        // Get current file SHA if modifying
        let fileSha: string | undefined;
        if (change.action === 'modify') {
          try {
            const fileResponse = await fetch(`${baseUrl}/contents/${change.file}?ref=${branchName}`, { headers });
            if (fileResponse.ok) {
              const fileData: any = await fileResponse.json();
              fileSha = fileData.sha;
            }
          } catch {
            // File doesn't exist, treat as create
          }
        }

        // Create or update file
        const updateResponse = await fetch(`${baseUrl}/contents/${change.file}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            message: `🦊 ${change.action}: ${change.file}`,
            content: Buffer.from(change.content).toString('base64'),
            branch: branchName,
            sha: fileSha,
          }),
        });

        if (!updateResponse.ok) {
          console.error(`Failed to ${change.action} ${change.file}:`, await updateResponse.text());
        }
      }
    }

    // 4. Create PR
    const prBody = `## 🦊 Self-Evolution PR

**Type:** ${plan.request.type}
**Priority:** ${plan.request.priority}
**Impact:** ${plan.estimatedImpact}

### Description
${plan.description}

### Reasoning
${plan.reasoning}

### Changes
${plan.changes.map(c => `- \`${c.file}\`: ${c.action}${c.diff ? ` (${c.diff})` : ''}`).join('\n')}

---
*This PR was automatically generated by SKYNET SELF-EVOLVE.*
*The fox proposes. The human approves.*

**Plan ID:** \`${plan.id}\`
`;

    const prResponse = await fetch(`${baseUrl}/pulls`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: `🦊 ${plan.title}`,
        head: branchName,
        base: 'main',
        body: prBody,
      }),
    });

    if (!prResponse.ok) {
      throw new Error(`Failed to create PR: ${await prResponse.text()}`);
    }

    const prData: any = await prResponse.json();
    
    return {
      prUrl: prData.html_url,
      prNumber: prData.number,
    };
  } catch (error: unknown) {
    console.error('[🦊 SELF-EVOLVE] GitHub API error:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════

export async function initSelfEvolve(): Promise<void> {
  await loadState();
  console.log('[🦊 SELF-EVOLVE] Self-evolution system initialized');
  console.log(`   Total proposals: ${state.totalProposals}`);
  console.log(`   PRs opened: ${state.totalPRsOpened}`);
}

/**
 * Check if a change is safe to auto-merge (no human review needed)
 */
function canAutoMerge(plan: EvolutionPlan): boolean {
  // Auto-merge: low priority AND low impact
  return plan.request.priority === 'low' && plan.estimatedImpact === 'low';
}

/**
 * Directly commit changes to main branch (for auto-merge)
 */
async function directCommitToMain(plan: EvolutionPlan): Promise<void> {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN not configured');
  }

  const baseUrl = `https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}`;
  const headers = {
    'Authorization': `token ${token}`,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  };

  for (const change of plan.changes) {
    if (change.action === 'create' || change.action === 'modify') {
      if (!change.content) continue;
      
      // Get current file SHA if modifying
      let fileSha: string | undefined;
      try {
        const fileResponse = await fetch(`${baseUrl}/contents/${change.file}`, { headers });
        if (fileResponse.ok) {
          const fileData: any = await fileResponse.json();
          fileSha = fileData.sha;
        }
      } catch {
        // File doesn't exist
      }

      // Commit directly to main
      const updateResponse = await fetch(`${baseUrl}/contents/${change.file}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          message: `🦊 Auto-merge [${plan.request.priority}/${plan.estimatedImpact}]: ${plan.title}`,
          content: Buffer.from(change.content).toString('base64'),
          branch: 'main',
          sha: fileSha,
        }),
      });

      if (!updateResponse.ok) {
        throw new Error(`Failed to auto-commit ${change.file}: ${await updateResponse.text()}`);
      }
      
      console.log(`[🦊 SELF-EVOLVE] ✅ Auto-committed: ${change.file}`);
    }
  }
}

/**
 * Propose an evolution (generates plan, optionally opens PR or auto-merges)
 */
export async function proposeEvolution(
  request: EvolutionRequest,
  autoCreatePR: boolean = false
): Promise<{ plan: EvolutionPlan; prUrl?: string; autoMerged?: boolean }> {
  console.log(`[🦊 SELF-EVOLVE] Processing evolution request: ${request.prompt.slice(0, 50)}...`);
  
  // Generate plan
  const plan = await generatePlan(request);
  state.totalProposals++;
  
  console.log(`[🦊 SELF-EVOLVE] Plan generated: ${plan.title}`);
  console.log(`   Changes: ${plan.changes.length} files`);
  console.log(`   Impact: ${plan.estimatedImpact}`);
  console.log(`   Priority: ${plan.request.priority}`);
  
  let prUrl: string | undefined;
  let autoMerged = false;
  
  if (autoCreatePR && plan.changes.length > 0) {
    // Check if we can auto-merge (low priority + low impact)
    if (canAutoMerge(plan)) {
      try {
        console.log(`[🦊 SELF-EVOLVE] ⚡ Auto-merge eligible (${plan.request.priority}/${plan.estimatedImpact})`);
        await directCommitToMain(plan);
        plan.status = 'merged';
        state.totalMerged++;
        autoMerged = true;
        
        console.log(`[🦊 SELF-EVOLVE] 🎉 Auto-merged directly to main!`);
      } catch (error: unknown) {
        console.error('[🦊 SELF-EVOLVE] Auto-merge failed, falling back to PR:', error);
        // Fall back to PR workflow
        autoMerged = false;
      }
    }
    
    // Create PR if not auto-merged
    if (!autoMerged) {
      try {
        const pr = await createPR(plan);
        plan.prUrl = pr.prUrl;
        plan.prNumber = pr.prNumber;
        plan.status = 'pr-opened';
        state.totalPRsOpened++;
        prUrl = pr.prUrl;
        
        console.log(`[🦊 SELF-EVOLVE] 🎉 PR opened: ${prUrl}`);
      } catch (error: unknown) {
        console.error('[🦊 SELF-EVOLVE] Failed to create PR:', error);
      }
    }
  }
  
  // Track pending or completed
  if (plan.status === 'merged') {
    state.history.push(plan);
  } else {
    state.pendingPlans.push(plan);
  }
  
  // Log and save
  await logEvolution(plan);
  await saveState();
  
  return { plan, prUrl, autoMerged };
}

/**
 * Create PR from existing plan
 */
export async function executePlan(planId: string): Promise<{ prUrl: string; prNumber: number }> {
  const plan = state.pendingPlans.find(p => p.id === planId);
  if (!plan) {
    throw new Error(`Plan not found: ${planId}`);
  }
  
  const pr = await createPR(plan);
  plan.prUrl = pr.prUrl;
  plan.prNumber = pr.prNumber;
  plan.status = 'pr-opened';
  state.totalPRsOpened++;
  
  // Move to history
  state.pendingPlans = state.pendingPlans.filter(p => p.id !== planId);
  state.history.push(plan);
  
  await saveState();
  
  return pr;
}

/**
 * Get pending evolution plans
 */
export function getPendingPlans(): EvolutionPlan[] {
  return state.pendingPlans;
}

/**
 * Get evolution history
 */
export function getEvolutionHistory(): EvolutionPlan[] {
  return state.history;
}

/**
 * Get self-evolve statistics
 */
export function getSelfEvolveStats(): {
  totalProposals: number;
  totalPRsOpened: number;
  totalMerged: number;
  totalAutoMerged: number;
  pendingPlans: number;
} {
  // Count auto-merged from history
  const autoMergedCount = state.history.filter(p => 
    p.status === 'merged' && p.request.priority === 'low' && p.estimatedImpact === 'low'
  ).length;
  
  return {
    totalProposals: state.totalProposals,
    totalPRsOpened: state.totalPRsOpened,
    totalMerged: state.totalMerged,
    totalAutoMerged: autoMergedCount,
    pendingPlans: state.pendingPlans.length,
  };
}
