// @ts-nocheck
/**
 * Swarm Synthesizer
 * 
 * Merges outputs from multiple agents into a coherent result.
 * This is NOT averaging - it's structured adjudication.
 */

import {
  AgentResult,
  SwarmRoundResult,
  SynthesisResult,
  Conflict,
  ProviderName,
} from './types';

interface ClaimExtraction {
  claims: string[];
  actions: string[];
  risks: string[];
  code?: string;
}

/**
 * Extract structured claims from agent output
 */
function extractClaims(result: AgentResult): ClaimExtraction {
  const output = result.output;
  const claims: string[] = [];
  const actions: string[] = [];
  const risks: string[] = [];
  let code: string | undefined;
  
  // Extract code blocks
  const codeMatch = output.match(/```[\s\S]*?```/g);
  if (codeMatch) {
    code = codeMatch.map((m) => m.replace(/```\w*\n?/g, '').trim()).join('\n\n');
  }
  
  // Extract bullet points as claims
  const bullets = output.match(/^[-*•]\s+.+$/gm);
  if (bullets) {
    for (const bullet of bullets) {
      const text = bullet.replace(/^[-*•]\s+/, '').trim();
      
      // Categorize based on content
      if (/risk|danger|warning|issue|problem|concern|vulnerability/i.test(text)) {
        risks.push(text);
      } else if (/should|must|need to|recommend|suggest|implement|add|create|fix/i.test(text)) {
        actions.push(text);
      } else {
        claims.push(text);
      }
    }
  }
  
  // Extract numbered items
  const numbered = output.match(/^\d+[.)]\s+.+$/gm);
  if (numbered) {
    for (const item of numbered) {
      const text = item.replace(/^\d+[.)]\s+/, '').trim();
      if (/risk|danger|warning|issue|problem/i.test(text)) {
        risks.push(text);
      } else if (/should|must|need to|recommend|implement/i.test(text)) {
        actions.push(text);
      } else {
        claims.push(text);
      }
    }
  }
  
  return { claims, actions, risks, code };
}

/**
 * Find conflicts between agent outputs
 */
function findConflicts(results: AgentResult[]): Conflict[] {
  const conflicts: Conflict[] = [];
  
  // Group by topics (simple keyword extraction)
  const topicPositions = new Map<string, { provider: ProviderName; position: string }[]>();
  
  for (const result of results) {
    const extraction = extractClaims(result);
    
    // Check for contradictory patterns
    const patterns = [
      { topic: 'approach', match: /approach|method|strategy|solution/i },
      { topic: 'safety', match: /safe|unsafe|secure|insecure|risk/i },
      { topic: 'implementation', match: /implement|code|function|class/i },
      { topic: 'recommendation', match: /recommend|suggest|should|must/i },
    ];
    
    for (const { topic, match } of patterns) {
      const relevantClaims = [...extraction.claims, ...extraction.actions]
        .filter((c) => match.test(c));
      
      if (relevantClaims.length > 0) {
        if (!topicPositions.has(topic)) {
          topicPositions.set(topic, []);
        }
        topicPositions.get(topic)!.push({
          provider: result.provider,
          position: relevantClaims.join('; '),
        });
      }
    }
  }
  
  // Identify actual conflicts (different positions on same topic)
  for (const [topic, positions] of topicPositions) {
    if (positions.length > 1) {
      // Simple conflict detection: if positions differ significantly
      const uniquePositions = new Set(positions.map((p) => p.position.toLowerCase().trim()));
      if (uniquePositions.size > 1) {
        conflicts.push({
          topic,
          positions,
        });
      }
    }
  }
  
  return conflicts;
}

/**
 * Score and rank agent outputs
 */
function scoreOutputs(results: AgentResult[]): Map<ProviderName, number> {
  const scores = new Map<ProviderName, number>();
  
  for (const result of results) {
    let score = 0;
    
    // Base score for successful execution
    if (result.exitCode === 0) {score += 10;}
    
    // Penalize timeouts and errors
    if (result.timedOut) {score -= 20;}
    if (result.error) {score -= 10;}
    
    // Score based on output quality
    const output = result.output;
    
    // Has code blocks
    if (/```/.test(output)) {score += 5;}
    
    // Has structured output (bullets, numbers)
    if (/^[-*•\d.]\s+/m.test(output)) {score += 3;}
    
    // Output length (prefer substantive but not verbose)
    const length = output.length;
    if (length > 100 && length < 5000) {score += 5;}
    if (length > 5000) {score -= 2;}
    
    // Role-specific scoring
    if (result.role === 'critic' && /risk|issue|concern|warning/i.test(output)) {
      score += 5; // Critics should find issues
    }
    if (result.role === 'implementer' && /```/.test(output)) {
      score += 5; // Implementers should produce code
    }
    
    scores.set(result.provider, score);
  }
  
  return scores;
}

/**
 * Synthesize results from a swarm round
 */
export async function synthesize(roundResult: SwarmRoundResult): Promise<SynthesisResult> {
  const { successful, failed } = roundResult;
  
  if (successful.length === 0) {
    return {
      solution: 'No successful agent outputs to synthesize.',
      risks: ['All agents failed or timed out.'],
      conflicts: [],
      confidence: 0,
      sources: [],
    };
  }
  
  // Extract claims from all successful results
  const allExtractions = successful.map((r) => ({
    provider: r.provider,
    ...extractClaims(r),
  }));
  
  // Find conflicts
  const conflicts = findConflicts(successful);
  
  // Score outputs
  const scores = scoreOutputs(successful);
  
  // Find best implementation (highest scored implementer or general)
  const sortedByScore = [...successful].toSorted(
    (a, b) => (scores.get(b.provider) || 0) - (scores.get(a.provider) || 0)
  );
  
  const bestResult = sortedByScore[0];
  const bestExtraction = allExtractions.find((e) => e.provider === bestResult.provider)!;
  
  // Aggregate risks from all agents (especially critics)
  const allRisks = new Set<string>();
  for (const extraction of allExtractions) {
    for (const risk of extraction.risks) {
      allRisks.add(risk);
    }
  }
  
  // Build solution
  let solution = bestResult.output;
  
  // If we have multiple code blocks, prefer the implementer's
  const implementerResult = successful.find((r) => r.role === 'implementer');
  if (implementerResult) {
    const implExtraction = allExtractions.find((e) => e.provider === implementerResult.provider);
    if (implExtraction?.code) {
      solution = implementerResult.output;
    }
  }
  
  // Calculate confidence based on:
  // - Number of successful agents
  // - Agreement (fewer conflicts = higher confidence)
  // - Score distribution
  const successRatio = successful.length / (successful.length + failed.length);
  const conflictPenalty = Math.min(conflicts.length * 0.1, 0.3);
  const confidence = Math.max(0, Math.min(1, successRatio - conflictPenalty));
  
  return {
    solution,
    patch: bestExtraction.code,
    risks: Array.from(allRisks),
    conflicts,
    confidence,
    sources: successful.map((r) => r.provider),
  };
}

/**
 * Format synthesis result for output
 */
export function formatSynthesis(synthesis: SynthesisResult): string {
  const lines: string[] = [];
  
  lines.push('# Synthesis Result');
  lines.push('');
  lines.push(`**Confidence:** ${(synthesis.confidence * 100).toFixed(0)}%`);
  lines.push(`**Sources:** ${synthesis.sources.join(', ')}`);
  lines.push('');
  
  lines.push('## Solution');
  lines.push('');
  lines.push(synthesis.solution);
  lines.push('');
  
  if (synthesis.patch) {
    lines.push('## Patch');
    lines.push('');
    lines.push('```');
    lines.push(synthesis.patch);
    lines.push('```');
    lines.push('');
  }
  
  if (synthesis.risks.length > 0) {
    lines.push('## Risks & Concerns');
    lines.push('');
    for (const risk of synthesis.risks) {
      lines.push(`- ${risk}`);
    }
    lines.push('');
  }
  
  if (synthesis.conflicts.length > 0) {
    lines.push('## Conflicts');
    lines.push('');
    for (const conflict of synthesis.conflicts) {
      lines.push(`### ${conflict.topic}`);
      for (const pos of conflict.positions) {
        lines.push(`- **${pos.provider}:** ${pos.position}`);
      }
      if (conflict.resolution) {
        lines.push(`- **Resolution:** ${conflict.resolution}`);
      }
      lines.push('');
    }
  }
  
  if (synthesis.fallbackPlan) {
    lines.push('## Fallback Plan');
    lines.push('');
    lines.push(synthesis.fallbackPlan);
    lines.push('');
  }
  
  return lines.join('\n');
}
