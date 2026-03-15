// @ts-nocheck
/**
 * Judge Step - SKYNET BEAST MODE CONSENSUS INTEGRATION
 * 
 * Final arbiter that reviews synthesis and picks the best plan.
 * Now supports both single-agent and multi-LLM consensus modes.
 * Resolves conflicts explicitly and outputs structured JSON.
 * 
 * "Swarm creates options; judge picks one."
 * "In consensus we trust; in speed we fallback."
 */

import { createProvider, getConfiguredProviders } from './providers';
import { SynthesisResult, Conflict, ProviderName, AgentRole } from './types';
import { DEFAULT_CONTRACT, SwarmContract, AgentJSONOutput } from './contract';
import { buildConsensus, AgentResult, ConsensusResult } from '../hivemind/consensus';
import { ConsensusFactory, ConsensusAlgorithm } from '../skynet/consensus-algorithms';

export interface JudgeConfig {
  provider?: ProviderName;  // Single judge provider (backward compatibility)
  timeout?: number;
  requireJSON?: boolean;
  
  // 🚀 CONSENSUS MODE SETTINGS
  mode?: 'single' | 'consensus' | 'adaptive';  // Judge mode
  consensusThreshold?: number;  // Confidence threshold to trigger consensus (0.0-1.0)
  consensusProviders?: ProviderName[];  // Providers to use for consensus
  consensusAlgorithm?: ConsensusAlgorithm;  // Algorithm for complex consensus scenarios
  
  // 💰 COST MANAGEMENT
  maxCostUSD?: number;  // Maximum cost for consensus judge
  fallbackOnCost?: boolean;  // Fall back to single judge if cost exceeded
  
  // 🎭 AGENT PERSONALITIES
  agentPersonalities?: {
    [provider in ProviderName]?: {
      role: string;
      bias?: string;
      expertise?: string[];
    };
  };
  
  // 📊 QUALITY TRACKING
  trackMetrics?: boolean;  // Track decision quality metrics
  requireQualityScore?: number;  // Minimum quality score to accept
}

export interface JudgeResult {
  decision: string;
  selectedPlan: string;
  resolvedConflicts: { topic: string; resolution: string }[];
  finalConfidence: number;
  reasoning: string;
  provider: ProviderName | string;  // Can be 'consensus' for multi-agent
  durationMs: number;
  
  // 🚀 CONSENSUS EXTENSION
  mode: 'single' | 'consensus';
  consensusDetails?: ConsensusResult;
  costUSD?: number;
  qualityScore?: number;
  participatingAgents?: string[];
  conflictResolution?: {
    method: string;
    details: Record<string, unknown>;
  };
}

const DEFAULT_JUDGE_PROVIDER: ProviderName = 'claude';
const DEFAULT_CONSENSUS_PROVIDERS: ProviderName[] = ['claude', 'gemini', 'nvidia'];

/**
 * ConsensusJudge - Multi-LLM consensus decision maker
 */
class ConsensusJudge {
  private config: JudgeConfig;
  private costTracker: { total: number; breakdown: Record<string, number> } = { total: 0, breakdown: {} };
  
  constructor(config: JudgeConfig) {
    this.config = config;
  }
  
  /**
   * Run consensus judgment across multiple LLMs
   */
  async runConsensus(synthesis: SynthesisResult): Promise<JudgeResult> {
    const startTime = Date.now();
    const providers = this.config.consensusProviders || DEFAULT_CONSENSUS_PROVIDERS;
    const availableProviders = getConfiguredProviders().filter(p => providers.includes(p));
    
    if (availableProviders.length < 2) {
      console.log('[consensus-judge] Insufficient providers for consensus, falling back to single judge');
      return this.runSingleJudge(synthesis);
    }
    
    console.log(`[consensus-judge] Running consensus with ${availableProviders.length} agents: ${availableProviders.join(', ')}`);
    
    // Generate judge prompts with agent personalities
    const agentResults: AgentResult[] = [];
    const errors: string[] = [];
    
    for (const provider of availableProviders) {
      try {
        const personality = this.config.agentPersonalities?.[provider];
        const prompt = this.buildPersonalizedJudgePrompt(synthesis, provider, personality);
        
        const agentProvider = createProvider(provider);
        const startAgentTime = Date.now();
        
        const result = await agentProvider.execute(prompt, {
          timeout: this.config.timeout || 60000,
          json: true,
        });
        
        const agentDuration = Date.now() - startAgentTime;
        
        // Track costs (estimated)
        const estimatedCost = this.estimateCost(provider, prompt.length, result.stdout.length);
        this.costTracker.breakdown[provider] = estimatedCost;
        this.costTracker.total += estimatedCost;
        
        if (result.error || result.code !== 0) {
          errors.push(`${provider}: ${result.error?.message || 'execution failed'}`);
          continue;
        }
        
        agentResults.push({
          agentId: provider,
          agentType: provider as any,  // Type casting for compatibility
          response: {
            content: result.stdout,
            exitCode: result.code,
            durationMs: agentDuration,
            truncated: false
          }
        });
        
      } catch (error: unknown) {
        errors.push(`${provider}: ${error instanceof Error ? (error).message : 'unknown error'}`);
      }
      
      // Cost check
      if (this.config.maxCostUSD && this.costTracker.total > this.config.maxCostUSD) {
        if (this.config.fallbackOnCost) {
          console.log(`[consensus-judge] Cost limit exceeded ($${this.costTracker.total}), falling back to single judge`);
          return this.runSingleJudge(synthesis);
        }
        break;
      }
    }
    
    if (agentResults.length < 2) {
      console.log('[consensus-judge] Insufficient successful agent results, falling back to single judge');
      return this.runSingleJudge(synthesis);
    }
    
    // Build consensus from agent results
    const consensusResult = await buildConsensus(agentResults, 'decision');
    
    // Parse the final consensus decision
    const finalDecision = this.parseConsensusDecision(consensusResult.finalOutput);
    
    // Calculate quality score
    const qualityScore = this.calculateQualityScore(consensusResult, agentResults);
    
    return {
      decision: finalDecision.decision || 'Consensus decision reached',
      selectedPlan: finalDecision.selectedPlan || consensusResult.finalOutput,
      resolvedConflicts: finalDecision.resolvedConflicts || [],
      finalConfidence: consensusResult.confidence,
      reasoning: finalDecision.reasoning || consensusResult.reasoning,
      provider: 'consensus',
      durationMs: Date.now() - startTime,
      mode: 'consensus',
      consensusDetails: consensusResult,
      costUSD: this.costTracker.total,
      qualityScore,
      participatingAgents: agentResults.map(r => r.agentId),
      conflictResolution: {
        method: consensusResult.method,
        details: {
          conflicts: consensusResult.conflicts || [],
          contributions: consensusResult.contributions
        }
      }
    };
  }
  
  /**
   * Fallback to single judge (backward compatibility)
   */
  async runSingleJudge(synthesis: SynthesisResult): Promise<JudgeResult> {
    console.log('[consensus-judge] Running single judge fallback');
    
    // Use the original single judge logic
    const originalResult = await runJudge(synthesis, {
      provider: this.config.provider,
      timeout: this.config.timeout,
      requireJSON: this.config.requireJSON
    });
    
    return {
      ...originalResult,
      mode: 'single',
      costUSD: this.estimateCost(originalResult.provider as ProviderName, 1000, 500), // Rough estimate
      qualityScore: originalResult.finalConfidence
    };
  }
  
  /**
   * Build personalized prompt for each agent
   */
  private buildPersonalizedJudgePrompt(
    synthesis: SynthesisResult,
    provider: ProviderName,
    personality?: { role: string; bias?: string; expertise?: string[] }
  ): string {
    const basePrompt = buildJudgePrompt(synthesis);
    
    if (!personality) {return basePrompt;}
    
    const personalitySection = `## Your Role as Judge
You are acting as: **${personality.role}**
${personality.bias ? `Your perspective: ${personality.bias}` : ''}
${personality.expertise ? `Your expertise areas: ${personality.expertise.join(', ')}` : ''}

When making your decision, consider your unique perspective and expertise.

`;
    
    return personalitySection + basePrompt;
  }
  
  /**
   * Parse consensus decision from final output
   */
  private parseConsensusDecision(output: string): Partial<{
    decision: string;
    selectedPlan: string;
    resolvedConflicts: { topic: string; resolution: string }[];
    reasoning: string;
  }> {
    try {
      // Try to extract JSON first
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      // Fall back to text parsing
    }
    
    // Simple text parsing fallback
    const lines = output.split('\n');
    const decision = lines.find(l => l.toLowerCase().includes('decision'))?.split(':')[1]?.trim();
    const plan = lines.find(l => l.toLowerCase().includes('plan'))?.split(':')[1]?.trim();
    
    return {
      decision: decision || output.slice(0, 200),
      selectedPlan: plan || output,
      resolvedConflicts: [],
      reasoning: 'Parsed from text output'
    };
  }
  
  /**
   * Calculate quality score for the consensus decision
   */
  private calculateQualityScore(consensusResult: ConsensusResult, agentResults: AgentResult[]): number {
    let score = consensusResult.confidence;
    
    // Bonus for unanimous consensus
    if (consensusResult.method === 'unanimous') {score *= 1.1;}
    
    // Bonus for synthesis (multiple perspectives)
    if (consensusResult.method === 'synthesis') {score *= 1.05;}
    
    // Penalty for conflicts
    if (consensusResult.conflicts && consensusResult.conflicts.length > 0) {
      score *= (1 - consensusResult.conflicts.length * 0.1);
    }
    
    // Bonus for multiple participating agents
    const participationBonus = Math.min(0.1, agentResults.length * 0.02);
    score += participationBonus;
    
    return Math.min(1.0, Math.max(0.0, score));
  }
  
  /**
   * Estimate cost for a provider call
   */
  private estimateCost(provider: ProviderName, inputLength: number, outputLength: number): number {
    // Rough cost estimates per 1K tokens (updated 2026 rates)
    const costPer1K = {
      claude: 0.003,      // Claude Sonnet
      gemini: 0.0008,     // Gemini Flash
      nvidia: 0.002,      // Average NIM cost
      ollama: 0.0         // Local
    };
    
    const inputTokens = Math.ceil(inputLength / 4);   // Rough tokens estimate
    const outputTokens = Math.ceil(outputLength / 4);
    // @ts-expect-error - Post-Merge Reconciliation
    const totalCost = ((inputTokens + outputTokens) / 1000) * (costPer1K[provider] || 0.002);
    
    return Math.round(totalCost * 10000) / 10000;  // Round to 4 decimal places
  }
}

/**
 * Enhanced judge runner with consensus support
 */
export async function runJudge(
  synthesis: SynthesisResult,
  config: JudgeConfig = {}
): Promise<JudgeResult> {
  const mode = config.mode || 'adaptive';
  
  // Adaptive mode: choose based on confidence and importance
  if (mode === 'adaptive') {
    const confidence = synthesis.confidence;
    const threshold = config.consensusThreshold || 0.7;
    
    // Use consensus for low confidence or important decisions
    if (confidence < threshold || synthesis.risks.length > 2) {
      config.mode = 'consensus';
    } else {
      config.mode = 'single';
    }
  }
  
  if (config.mode === 'consensus') {
    const consensusJudge = new ConsensusJudge(config);
    return consensusJudge.runConsensus(synthesis);
  }
  
  // Single judge mode (original implementation)
  return runSingleJudge(synthesis, config);
}

/**
 * Original single judge implementation (for backward compatibility)
 */
async function runSingleJudge(
  synthesis: SynthesisResult,
  config: JudgeConfig = {}
): Promise<JudgeResult> {
  const startTime = Date.now();
  const timeout = config.timeout || 60000;
  
  // Select judge provider
  let provider = config.provider || DEFAULT_JUDGE_PROVIDER;
  const configured = getConfiguredProviders();
  
  if (!configured.includes(provider)) {
    // Fallback to any available provider
    provider = configured.find((p) => p === 'claude' || p === 'gemini') || configured[0];
    if (!provider) {
      return {
        decision: 'No judge available - using synthesis as-is',
        selectedPlan: synthesis.solution,
        resolvedConflicts: [],
        finalConfidence: synthesis.confidence,
        reasoning: 'No configured providers available for judge step',
        provider: 'claude',
        durationMs: 0,
        mode: 'single'
      };
    }
  }
  
  console.log(`[judge] Running single judge with ${provider}`);
  
  const judgeProvider = createProvider(provider);
  const prompt = buildJudgePrompt(synthesis);
  
  const result = await judgeProvider.execute(prompt, {
    timeout,
    json: true,
  });
  
  if (result.error || result.code !== 0) {
    console.log(`[judge] Judge failed: ${result.error?.message || 'unknown error'}`);
    return {
      decision: 'Judge step failed - using synthesis as-is',
      selectedPlan: synthesis.solution,
      resolvedConflicts: [],
      finalConfidence: synthesis.confidence * 0.8, // Penalize confidence
      reasoning: `Judge failed: ${result.error?.message || 'unknown'}`,
      provider,
      durationMs: Date.now() - startTime,
      mode: 'single'
    };
  }
  
  // Parse judge output
  try {
    const jsonMatch = result.stdout.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const judgeOutput = JSON.parse(jsonMatch[0]);
      
      return {
        decision: judgeOutput.decision || 'No decision provided',
        selectedPlan: judgeOutput.selectedPlan || synthesis.solution,
        resolvedConflicts: judgeOutput.resolvedConflicts || [],
        finalConfidence: Math.min(1, Math.max(0, judgeOutput.finalConfidence || synthesis.confidence)),
        reasoning: judgeOutput.reasoning || '',
        provider,
        durationMs: Date.now() - startTime,
        mode: 'single'
      };
    }
  } catch (e) {
    console.log(`[judge] Failed to parse judge output: ${e}`);
  }
  
  // Fallback: use raw output as decision
  return {
    decision: result.stdout.slice(0, 200),
    selectedPlan: synthesis.solution,
    resolvedConflicts: [],
    finalConfidence: synthesis.confidence,
    reasoning: 'Could not parse structured output',
    provider,
    durationMs: Date.now() - startTime,
    mode: 'single'
  };
}

/**
 * Build judge prompt (original implementation)
 */
function buildJudgePrompt(synthesis: SynthesisResult): string {
  const conflictSection = synthesis.conflicts.length > 0
    ? `## Conflicts to Resolve
${synthesis.conflicts.map((c) => `
### ${c.topic}
${c.positions.map((p) => `- **${p.provider}:** ${p.position}`).join('\n')}
`).join('\n')}`
    : '';

  return `You are the final judge in a multi-agent decision process.

## Your Task
Review the synthesis from multiple agents and make a final decision.

## Synthesis to Judge
**Current Confidence:** ${(synthesis.confidence * 100).toFixed(0)}%
**Sources:** ${synthesis.sources.join(', ')}

### Proposed Solution
${synthesis.solution}

${synthesis.patch ? `### Code/Patch
\`\`\`
${synthesis.patch}
\`\`\`
` : ''}

### Risks Identified
${synthesis.risks.map((r) => `- ${r}`).join('\n') || '(none)'}

${conflictSection}

## Instructions
1. Review all positions
2. Resolve any conflicts with explicit reasoning
3. Pick the best plan (or merge the best parts)
4. Assign a final confidence score (0.0-1.0)
5. Output ONLY valid JSON in this format:

{
  "decision": "Your final decision in 1-2 sentences",
  "selectedPlan": "The complete plan you're recommending",
  "resolvedConflicts": [
    {"topic": "conflict topic", "resolution": "how you resolved it"}
  ],
  "finalConfidence": 0.85,
  "reasoning": "Why you made this decision"
}

Be decisive. Pick one path. Do not hedge.`;
}

/**
 * Format judge result for display (enhanced for consensus)
 */
export function formatJudgeResult(judge: JudgeResult): string {
  const lines: string[] = [];
  
  lines.push('## Judge Decision');
  lines.push('');
  lines.push(`**Mode:** ${judge.mode.toUpperCase()}`);
  lines.push(`**Provider(s):** ${judge.mode === 'consensus' ? (judge.participatingAgents?.join(', ') || 'consensus') : judge.provider}`);
  lines.push(`**Final Confidence:** ${(judge.finalConfidence * 100).toFixed(0)}%`);
  
  if (judge.qualityScore) {
    lines.push(`**Quality Score:** ${(judge.qualityScore * 100).toFixed(0)}%`);
  }
  
  if (judge.costUSD) {
    lines.push(`**Cost:** $${judge.costUSD.toFixed(4)}`);
  }
  
  lines.push('');
  lines.push(`**Decision:** ${judge.decision}`);
  lines.push('');
  
  if (judge.resolvedConflicts.length > 0) {
    lines.push('### Resolved Conflicts');
    for (const conflict of judge.resolvedConflicts) {
      lines.push(`- **${conflict.topic}:** ${conflict.resolution}`);
    }
    lines.push('');
  }
  
  if (judge.mode === 'consensus' && judge.consensusDetails) {
    lines.push('### Consensus Details');
    lines.push(`- **Method:** ${judge.consensusDetails.method}`);
    lines.push(`- **Contributions:** ${judge.consensusDetails.contributions.length} agents`);
    if (judge.consensusDetails.conflicts) {
      lines.push(`- **Conflicts Found:** ${judge.consensusDetails.conflicts.length}`);
    }
    lines.push('');
  }
  
  lines.push('### Selected Plan');
  lines.push('');
  lines.push(judge.selectedPlan);
  lines.push('');
  
  if (judge.reasoning) {
    lines.push('### Reasoning');
    lines.push('');
    lines.push(judge.reasoning);
    lines.push('');
  }
  
  return lines.join('\n');
}

/**
 * Default configurations for different scenarios
 */
export const JUDGE_CONFIGS = {
  // Fast decisions with cost constraints
  SPEED_MODE: {
    mode: 'single' as const,
    provider: 'gemini' as ProviderName,
    timeout: 30000,
    maxCostUSD: 0.01
  },
  
  // Balanced mode for most decisions
  BALANCED_MODE: {
    mode: 'adaptive' as const,
    consensusThreshold: 0.7,
    consensusProviders: ['claude', 'gemini'] as ProviderName[],
    maxCostUSD: 0.05,
    fallbackOnCost: true
  },
  
  // High-stakes decisions requiring consensus
  CONSENSUS_MODE: {
    mode: 'consensus' as const,
    consensusProviders: ['claude', 'gemini', 'nvidia'] as ProviderName[],
    agentPersonalities: {
      claude: { role: 'Chief Reasoning Officer', bias: 'analytical and careful' },
      gemini: { role: 'Strategic Advisor', bias: 'practical and efficient' },
      nvidia: { role: 'Technical Specialist', bias: 'implementation-focused' }
    },
    trackMetrics: true,
    requireQualityScore: 0.8,
    maxCostUSD: 0.20
  }
} as const;

export { ConsensusJudge };