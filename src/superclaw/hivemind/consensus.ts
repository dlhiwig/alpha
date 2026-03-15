// @ts-nocheck
/**
 * Hivemind Consensus Engine
 * 
 * Synthesizes results from multiple AI agents into a unified response.
 * Implements voting, conflict resolution, and quality scoring.
 */

import { CLIType } from './cli-agent';
import { CLIResponse } from './cli-agent';

export interface AgentResult {
  agentId: string;
  agentType: CLIType;
  response: CLIResponse;
  score?: number;
}

export interface ConsensusResult {
  finalOutput: string;
  confidence: number;
  method: 'unanimous' | 'majority' | 'weighted' | 'synthesis' | 'best-of-n';
  contributions: {
    agentId: string;
    weight: number;
    selected: boolean;
  }[];
  conflicts?: string[];
  reasoning: string;
}

/**
 * Quality weights for each agent type
 */
const AGENT_QUALITY_WEIGHTS: Record<CLIType, number> = {
  claude: 1.0,    // Highest quality, best reasoning
  codex: 0.9,     // Great for code
  gemini: 0.85,   // Good breadth
  ollama: 0.7     // Local, fast, but less capable
};

/**
 * Build consensus from multiple agent responses
 */
export async function buildConsensus(
  results: AgentResult[],
  taskType: string
): Promise<ConsensusResult> {
  if (results.length === 0) {
    throw new Error('No results to build consensus from');
  }

  if (results.length === 1) {
    return {
      finalOutput: results[0].response.content,
      confidence: 0.8,
      method: 'best-of-n',
      contributions: [{
        agentId: results[0].agentId,
        weight: 1.0,
        selected: true
      }],
      reasoning: 'Single agent response'
    };
  }

  // Score each result
  const scoredResults = results.map(r => ({
    ...r,
    score: scoreResponse(r, taskType)
  }));

  // Sort by score
  scoredResults.sort((a, b) => (b.score || 0) - (a.score || 0));

  // Check for consensus
  const consensusCheck = checkConsensus(scoredResults);

  if (consensusCheck.unanimous) {
    return {
      finalOutput: scoredResults[0].response.content,
      confidence: 0.95,
      method: 'unanimous',
      contributions: scoredResults.map(r => ({
        agentId: r.agentId,
        weight: r.score || 0,
        selected: true
      })),
      reasoning: 'All agents agree on the approach'
    };
  }

  if (consensusCheck.majorityResult) {
    return {
      finalOutput: consensusCheck.majorityResult.response.content,
      confidence: 0.85,
      method: 'majority',
      contributions: scoredResults.map(r => ({
        agentId: r.agentId,
        weight: r.score || 0,
        selected: r.agentId === consensusCheck.majorityResult?.agentId
      })),
      conflicts: consensusCheck.conflicts,
      reasoning: `Majority consensus (${consensusCheck.majorityCount}/${results.length})`
    };
  }

  // No clear consensus - use weighted synthesis or best-of-n
  if (taskType === 'code') {
    // For code, pick the best one (can't merge code easily)
    return {
      finalOutput: scoredResults[0].response.content,
      confidence: scoredResults[0].score || 0.7,
      method: 'best-of-n',
      contributions: scoredResults.map((r, i) => ({
        agentId: r.agentId,
        weight: r.score || 0,
        selected: i === 0
      })),
      conflicts: consensusCheck.conflicts,
      reasoning: `Best response selected (score: ${scoredResults[0].score?.toFixed(2)})`
    };
  }

  // For text/analysis, synthesize
  const synthesis = await synthesizeResponses(scoredResults);
  
  return {
    finalOutput: synthesis,
    confidence: 0.8,
    method: 'synthesis',
    contributions: scoredResults.map(r => ({
      agentId: r.agentId,
      weight: r.score || 0,
      selected: true
    })),
    conflicts: consensusCheck.conflicts,
    reasoning: 'Synthesized from multiple perspectives'
  };
}

/**
 * Score a response based on quality indicators
 */
function scoreResponse(result: AgentResult, taskType: string): number {
  let score = AGENT_QUALITY_WEIGHTS[result.agentType];
  const content = result.response.content;

  // Penalize empty or error responses
  if (!content || content.length < 10) {
    return 0;
  }
  if (content.toLowerCase().includes('error') || content.toLowerCase().includes('sorry, i')) {
    score *= 0.5;
  }

  // Reward completeness
  if (content.length > 500) {score *= 1.1;}
  if (content.length > 1500) {score *= 1.1;}

  // Task-specific scoring
  if (taskType === 'code') {
    // Reward code blocks
    const codeBlocks = (content.match(/```[\s\S]*?```/g) || []).length;
    if (codeBlocks > 0) {score *= 1.2;}
    
    // Reward comments
    if (content.includes('//') || content.includes('/*')) {score *= 1.1;}
  }

  if (taskType === 'reason' || taskType === 'research') {
    // Reward structure
    if (content.includes('##') || content.includes('**')) {score *= 1.1;}
    
    // Reward reasoning indicators
    if (/\b(because|therefore|however|considering)\b/i.test(content)) {score *= 1.1;}
  }

  // Penalize truncated responses
  if (result.response.truncated) {
    score *= 0.7;
  }

  // Penalize slow responses slightly
  if (result.response.durationMs > 60000) {
    score *= 0.95;
  }

  return Math.min(score, 1.0); // Cap at 1.0
}

/**
 * Check if responses reach consensus
 */
function checkConsensus(results: AgentResult[]): {
  unanimous: boolean;
  majorityResult: AgentResult | null;
  majorityCount: number;
  conflicts: string[];
} {
  if (results.length < 2) {
    return { unanimous: true, majorityResult: results[0], majorityCount: 1, conflicts: [] };
  }

  // Extract key points from each response
  const keyPoints = results.map(r => extractKeyPoints(r.response.content));

  // Check for contradictions
  const conflicts = findContradictions(keyPoints);

  // Calculate similarity between responses
  const similarities = calculateSimilarities(results);
  const avgSimilarity = similarities.reduce((a, b) => a + b, 0) / similarities.length;

  // Unanimous if all responses are very similar
  if (avgSimilarity > 0.8 && conflicts.length === 0) {
    return { unanimous: true, majorityResult: results[0], majorityCount: results.length, conflicts: [] };
  }

  // Find majority if any
  const clusters = clusterResponses(results);
  if (clusters.length > 0 && clusters[0].members.length > results.length / 2) {
    return {
      unanimous: false,
      majorityResult: clusters[0].members[0],
      majorityCount: clusters[0].members.length,
      conflicts
    };
  }

  return { unanimous: false, majorityResult: null, majorityCount: 0, conflicts };
}

/**
 * Extract key points from a response
 */
function extractKeyPoints(content: string): string[] {
  const points: string[] = [];

  // Extract bullet points
  const bullets = content.match(/^[\s]*[-*•]\s*(.+)$/gm) || [];
  points.push(...bullets.map(b => b.replace(/^[\s]*[-*•]\s*/, '').trim()));

  // Extract numbered points
  const numbered = content.match(/^[\s]*\d+\.\s*(.+)$/gm) || [];
  points.push(...numbered.map(n => n.replace(/^[\s]*\d+\.\s*/, '').trim()));

  // Extract headers
  const headers = content.match(/^#+\s*(.+)$/gm) || [];
  points.push(...headers.map(h => h.replace(/^#+\s*/, '').trim()));

  // Extract code function/class names
  const codeNames = content.match(/(?:function|class|const|let|var)\s+(\w+)/g) || [];
  points.push(...codeNames);

  return points;
}

/**
 * Find contradictions between key points
 */
function findContradictions(keyPointSets: string[][]): string[] {
  const conflicts: string[] = [];
  
  // Simple heuristic: look for negation patterns
  for (let i = 0; i < keyPointSets.length; i++) {
    for (let j = i + 1; j < keyPointSets.length; j++) {
      for (const point of keyPointSets[i]) {
        for (const otherPoint of keyPointSets[j]) {
          // Check for direct contradiction (one says "should", other says "should not")
          if (
            (point.includes('should') && otherPoint.includes('should not')) ||
            (point.includes('recommend') && otherPoint.includes("don't recommend")) ||
            (point.includes('yes') && otherPoint.includes('no'))
          ) {
            conflicts.push(`Agent ${i + 1} vs Agent ${j + 1}: "${point}" contradicts "${otherPoint}"`);
          }
        }
      }
    }
  }

  return conflicts;
}

/**
 * Calculate similarity between responses
 */
function calculateSimilarities(results: AgentResult[]): number[] {
  const similarities: number[] = [];

  for (let i = 0; i < results.length; i++) {
    for (let j = i + 1; j < results.length; j++) {
      const sim = jaccardSimilarity(
        results[i].response.content,
        results[j].response.content
      );
      similarities.push(sim);
    }
  }

  return similarities;
}

/**
 * Jaccard similarity between two texts
 */
function jaccardSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length > 3));

  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

/**
 * Cluster similar responses
 */
function clusterResponses(results: AgentResult[]): { centroid: string; members: AgentResult[] }[] {
  // Simple clustering: group by high similarity
  const clusters: { centroid: string; members: AgentResult[] }[] = [];
  const used = new Set<number>();

  for (let i = 0; i < results.length; i++) {
    if (used.has(i)) {continue;}

    const cluster = { centroid: results[i].response.content, members: [results[i]] };
    used.add(i);

    for (let j = i + 1; j < results.length; j++) {
      if (used.has(j)) {continue;}

      const sim = jaccardSimilarity(results[i].response.content, results[j].response.content);
      if (sim > 0.5) {
        cluster.members.push(results[j]);
        used.add(j);
      }
    }

    clusters.push(cluster);
  }

  // Sort by cluster size
  clusters.sort((a, b) => b.members.length - a.members.length);
  return clusters;
}

/**
 * Synthesize multiple responses into a unified output
 */
async function synthesizeResponses(results: AgentResult[]): Promise<string> {
  // For now, use a simple merge strategy:
  // Take the best response as the base, and append unique insights from others

  const base = results[0].response.content;
  const additionalInsights: string[] = [];

  for (let i = 1; i < results.length; i++) {
    const keyPoints = extractKeyPoints(results[i].response.content);
    const basePoints = extractKeyPoints(base);

    // Find points not in the base
    const unique = keyPoints.filter(p => 
      !basePoints.some(bp => jaccardSimilarity(p, bp) > 0.6)
    );

    if (unique.length > 0) {
      additionalInsights.push(`\n\n### Additional Perspective (${results[i].agentType})\n${unique.join('\n- ')}`);
    }
  }

  if (additionalInsights.length > 0) {
    return base + '\n\n---\n' + additionalInsights.join('');
  }

  return base;
}

export default { buildConsensus };
