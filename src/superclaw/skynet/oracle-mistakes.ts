/**
 * 🦊 SKYNET ORACLE MISTAKES — Mistake Tracking & Learning
 * Mistake pattern learning, prevention, and correction tracking.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { MistakePattern, CONFIG, OracleState } from './oracle-patterns';

/**
 * Learn from a mistake pattern to avoid repeating it
 */
export function learnFromMistake(mistakeData: {
  pattern: string;
  rootCause: string;
  correction: string;
  preventionPrompt?: string;
  severity?: 'low' | 'medium' | 'high';
  tags?: string[];
  contexts?: string[];
  relatedMistakes?: string[];
}, state: OracleState): void {
  const hash = crypto.createHash('md5').update(mistakeData.pattern).digest('hex').slice(0, 12);
  
  let mistake = state.mistakePatterns.get(hash);
  
  if (!mistake) {
    mistake = {
      pattern: mistakeData.pattern,
      frequency: 0,
      rootCause: mistakeData.rootCause,
      correction: mistakeData.correction,
      preventionPrompt: mistakeData.preventionPrompt || generatePreventionPrompt(mistakeData),
      lastSeen: Date.now(),
      severity: mistakeData.severity || 'medium',
      tags: mistakeData.tags || [],
      contexts: mistakeData.contexts || [],
      relatedMistakes: mistakeData.relatedMistakes || [],
      confidence: 0.7, // Initial confidence
      successfulCorrections: 0,
    };
  }
  
  // Update frequency and last seen
  mistake.frequency++;
  mistake.lastSeen = Date.now();
  
  // Update correction if provided (allows learning refinement)
  if (mistakeData.correction) {
    mistake.correction = mistakeData.correction;
  }
  
  // Increase confidence over time as pattern is confirmed
  mistake.confidence = Math.min(0.95, mistake.confidence + 0.05);
  
  state.mistakePatterns.set(hash, mistake);
  
  // Log to separate mistakes file
  logMistakeToFile(mistake);
  
  console.log(`[🦊 ORACLE] Learned mistake pattern: ${mistakeData.pattern} (frequency: ${mistake.frequency})`);
}

/**
 * Generate a prevention prompt for a mistake pattern
 */
function generatePreventionPrompt(mistakeData: {
  pattern: string;
  rootCause: string;
  correction: string;
}): string {
  return `AVOID: ${mistakeData.pattern}. ${mistakeData.correction}`;
}

/**
 * Log mistake to separate JSON file for analysis
 */
async function logMistakeToFile(mistake: MistakePattern): Promise<void> {
  try {
    await fs.mkdir(path.dirname(CONFIG.MISTAKES_FILE), { recursive: true });
    
    const logEntry = {
      timestamp: Date.now(),
      ...mistake,
    };
    
    // Read existing logs
    let logs: any[] = [];
    try {
      const existing = await fs.readFile(CONFIG.MISTAKES_FILE, 'utf8');
      logs = JSON.parse(existing);
    } catch {
      // File doesn't exist yet
    }
    
    // Append new log
    logs.push(logEntry);
    
    // Keep last 500 entries
    if (logs.length > 500) {
      logs = logs.slice(-500);
    }
    
    await fs.writeFile(CONFIG.MISTAKES_FILE, JSON.stringify(logs, null, 2));
  } catch (error: unknown) {
    console.error('[🦊 ORACLE] Failed to log mistake:', error);
  }
}

/**
 * Get prompt corrections based on learned mistake patterns
 */
export function getPromptCorrections(state: OracleState): Array<{
  pattern: string;
  correction: string;
  frequency: number;
  severity: 'low' | 'medium' | 'high';
}> {
  return Array.from(state.mistakePatterns.values())
    .filter(mistake => mistake.frequency >= 2) // Only include patterns seen multiple times
    .sort((a, b) => {
      // Sort by severity (high first) then frequency
      const severityOrder = { high: 3, medium: 2, low: 1 };
      if (severityOrder[a.severity] !== severityOrder[b.severity]) {
        return severityOrder[b.severity] - severityOrder[a.severity];
      }
      return b.frequency - a.frequency;
    })
    .map(mistake => ({
      pattern: mistake.pattern,
      correction: mistake.correction,
      frequency: mistake.frequency,
      severity: mistake.severity,
    }));
}

/**
 * Get mistake prevention injections for a prompt
 */
export function getMistakePreventionInjections(prompt: string, state: OracleState): string[] {
  const injections: string[] = [];
  const promptLower = prompt.toLowerCase();
  
  // Get relevant mistake patterns based on tags and contexts
  for (const [hash, mistake] of Array.from(state.mistakePatterns.entries())) {
    if (mistake.frequency < CONFIG.MISTAKE_PREVENTION_THRESHOLD) continue;
    
    // Check if this mistake is relevant to the current prompt
    let isRelevant = false;
    
    // Check tags
    for (const tag of mistake.tags) {
      if (promptLower.includes(tag.toLowerCase())) {
        isRelevant = true;
        break;
      }
    }
    
    // Check contexts
    if (!isRelevant) {
      for (const context of mistake.contexts) {
        if (promptLower.includes(context.toLowerCase())) {
          isRelevant = true;
          break;
        }
      }
    }
    
    if (isRelevant) {
      injections.push(mistake.preventionPrompt);
    }
  }
  
  // Limit injections and sort by effectiveness
  return injections.slice(0, CONFIG.MAX_PROMPT_INJECTIONS);
}

/**
 * Record successful mistake correction
 */
export function recordMistakeCorrection(mistakeHash: string, state: OracleState): void {
  const mistake = state.mistakePatterns.get(mistakeHash);
  if (mistake) {
    mistake.successfulCorrections++;
    mistake.confidence = Math.min(0.95, mistake.confidence + 0.02);
    state.mistakePatterns.set(mistakeHash, mistake);
  }
}

/**
 * Initialize known mistake patterns from codex reviews
 */
export function initializeKnownMistakes(state: OracleState): void {
  // Add patterns identified from codex-reviews.md
  const knownMistakes = [
    {
      pattern: "Express vs Fastify confusion",
      rootCause: "Generated Express router code when project uses Fastify framework",
      correction: "Always check the project's package.json and existing server code to determine the correct framework. Use Fastify syntax for SuperClaw projects.",
      preventionPrompt: "IMPORTANT: This project uses Fastify, not Express. Use Fastify router syntax (fastify.get, fastify.post, etc.) and Fastify plugin patterns.",
      severity: 'high' as const,
      tags: ['coding', 'framework', 'fastify', 'express'],
      contexts: ['server', 'router', 'api', 'superclaw'],
    },
    {
      pattern: "Stub function generation",
      rootCause: "Created function signatures without real implementations",
      correction: "Always provide complete, working implementations. If unsure about implementation details, ask for clarification rather than creating empty stubs.",
      preventionPrompt: "AVOID creating stub functions. Always provide complete implementations with actual logic. If you need clarification, ask before implementing.",
      severity: 'high' as const,
      tags: ['coding', 'implementation', 'functions'],
      contexts: ['function', 'method', 'implementation'],
    },
    {
      pattern: "Template placeholder content",
      rootCause: "Used generic template placeholders instead of project-specific content",
      correction: "Read existing project files to understand the specific context and style. Replace all template content with project-appropriate text.",
      preventionPrompt: "Replace ALL placeholder content with real, project-specific text. Read existing files to understand the context and style before writing.",
      severity: 'medium' as const,
      tags: ['documentation', 'content', 'templates'],
      contexts: ['readme', 'documentation', 'comments'],
    },
    {
      pattern: "Version synchronization issues",
      rootCause: "Created version files without updating corresponding code constants",
      correction: "When updating version information, check for and update all related version constants in code files, not just documentation.",
      preventionPrompt: "When updating versions, ensure ALL version constants in code files are updated consistently, not just documentation files.",
      severity: 'medium' as const,
      tags: ['versioning', 'maintenance', 'constants'],
      contexts: ['version', 'package.json', 'constants'],
    },
  ];
  
  // Only add if not already present
  for (const mistake of knownMistakes) {
    const hash = crypto.createHash('md5').update(mistake.pattern).digest('hex').slice(0, 12);
    if (!state.mistakePatterns.has(hash)) {
      learnFromMistake(mistake, state);
    }
  }
}

/**
 * Analyze mistake trends and patterns
 */
export function analyzeMistakeTrends(state: OracleState): {
  topMistakeCategories: Array<{ category: string; count: number; severity: string }>;
  mostFrequentMistakes: Array<{ pattern: string; frequency: number; lastSeen: number }>;
  preventionEffectiveness: Array<{ pattern: string; effectiveness: number }>;
} {
  const mistakes = Array.from(state.mistakePatterns.values());
  
  // Group by tags to find categories
  const categoryCount = new Map<string, { count: number; severity: string }>();
  for (const mistake of mistakes) {
    for (const tag of mistake.tags) {
      const existing = categoryCount.get(tag) || { count: 0, severity: 'low' };
      existing.count += mistake.frequency;
      if (mistake.severity === 'high') existing.severity = 'high';
      else if (mistake.severity === 'medium' && existing.severity !== 'high') existing.severity = 'medium';
      categoryCount.set(tag, existing);
    }
  }
  
  const topMistakeCategories = Array.from(categoryCount.entries())
    .map(([category, data]) => ({ category, count: data.count, severity: data.severity }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  
  const mostFrequentMistakes = mistakes
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 10)
    .map(m => ({ pattern: m.pattern, frequency: m.frequency, lastSeen: m.lastSeen }));
  
  const preventionEffectiveness = mistakes
    .filter(m => m.successfulCorrections > 0)
    .map(m => ({
      pattern: m.pattern,
      effectiveness: m.successfulCorrections / m.frequency,
    }))
    .sort((a, b) => b.effectiveness - a.effectiveness)
    .slice(0, 10);
  
  return {
    topMistakeCategories,
    mostFrequentMistakes,
    preventionEffectiveness,
  };
}