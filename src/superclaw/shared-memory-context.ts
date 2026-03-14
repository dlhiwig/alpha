/**
 * Shared Memory Context Injection
 * 
 * Provides utilities for injecting relevant shared memories into agent contexts
 * to enable knowledge transfer and learning between agents.
 */

import { getSharedMemory } from './shared-memory.js';
import type { SharedMemoryEntry } from './shared-memory.js';
import { createSubsystemLogger } from '../logging/subsystem.js';

const log = createSubsystemLogger('shared-memory-context');

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface ContextInjectionOptions {
  /** Maximum number of memories to inject */
  maxMemories?: number;
  /** Minimum importance threshold for memories */
  minImportance?: number;
  /** Filter by specific memory types */
  types?: Array<'fact' | 'decision' | 'lesson' | 'task' | 'observation'>;
  /** Include memories from specific agents */
  includeAgents?: string[];
  /** Exclude memories from specific agents */
  excludeAgents?: string[];
  /** Include only recent memories (within N days) */
  maxAgeHours?: number;
  /** Format of the injected context */
  format?: 'markdown' | 'plain' | 'structured';
}

export interface InjectedContext {
  /** The formatted context text */
  contextText: string;
  /** Number of memories included */
  memoriesIncluded: number;
  /** The actual memories used */
  memories: SharedMemoryEntry[];
  /** Estimated token count */
  estimatedTokens: number;
}

// ═══════════════════════════════════════════════════════════════════
// CONTEXT INJECTION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Inject relevant shared memories into an agent's context based on task description
 */
export async function injectRelevantMemories(
  taskDescription: string,
  options: ContextInjectionOptions = {}
): Promise<InjectedContext> {
  const {
    maxMemories = 5,
    minImportance = 0.3,
    types,
    includeAgents,
    excludeAgents,
    maxAgeHours,
    format = 'markdown'
  } = options;

  try {
    const sharedMemory = await getSharedMemory();
    
    // Search for relevant memories
    let memories = await sharedMemory.search(taskDescription, {
      limit: maxMemories * 2, // Get more for filtering
      types,
      minImportance
    });

    // Apply additional filters
    memories = applyFilters(memories, {
      includeAgents,
      excludeAgents,
      maxAgeHours
    });

    // Take only the top results
    memories = memories.slice(0, maxMemories);

    if (memories.length === 0) {
      return {
        contextText: '',
        memoriesIncluded: 0,
        memories: [],
        estimatedTokens: 0
      };
    }

    // Format the context
    const contextText = formatMemories(memories, format);
    const estimatedTokens = estimateTokens(contextText);

    log.debug(`Injected ${memories.length} shared memories into context (${estimatedTokens} tokens)`);

    return {
      contextText,
      memoriesIncluded: memories.length,
      memories,
      estimatedTokens
    };
  } catch (error) {
    log.warn('Failed to inject shared memories:', error);
    return {
      contextText: '',
      memoriesIncluded: 0,
      memories: [],
      estimatedTokens: 0
    };
  }
}

/**
 * Get recent learnings from shared memory for background context
 */
export async function getRecentLearnings(
  agentId?: string,
  options: ContextInjectionOptions = {}
): Promise<InjectedContext> {
  const {
    maxMemories = 3,
    minImportance = 0.5,
    maxAgeHours = 24,
    format = 'markdown'
  } = options;

  try {
    const sharedMemory = await getSharedMemory();
    
    let memories = await sharedMemory.recent(maxMemories * 2);
    
    // Filter for lessons and decisions with high importance
    memories = memories.filter(memory => {
      if (memory.type !== 'lesson' && memory.type !== 'decision') {
        return false;
      }
      
      if (memory.importance < minImportance) {
        return false;
      }
      
      if (maxAgeHours && Date.now() - memory.createdAt > maxAgeHours * 60 * 60 * 1000) {
        return false;
      }
      
      // Exclude own memories if agentId provided
      if (agentId && memory.agentId === agentId) {
        return false;
      }
      
      return true;
    });

    memories = memories.slice(0, maxMemories);

    if (memories.length === 0) {
      return {
        contextText: '',
        memoriesIncluded: 0,
        memories: [],
        estimatedTokens: 0
      };
    }

    const contextText = formatMemories(memories, format, 'Recent Learnings');
    const estimatedTokens = estimateTokens(contextText);

    return {
      contextText,
      memoriesIncluded: memories.length,
      memories,
      estimatedTokens
    };
  } catch (error) {
    log.warn('Failed to get recent learnings:', error);
    return {
      contextText: '',
      memoriesIncluded: 0,
      memories: [],
      estimatedTokens: 0
    };
  }
}

/**
 * Store a lesson learned during agent execution
 */
export async function storeLesson(
  agentId: string,
  lesson: string,
  context?: string,
  importance: number = 0.7
): Promise<string | null> {
  try {
    const sharedMemory = await getSharedMemory();
    
    const content = context 
      ? `${lesson}\n\nContext: ${context}`
      : lesson;
    
    const memoryId = await sharedMemory.store({
      agentId,
      content,
      type: 'lesson',
      tags: ['learning', 'experience'],
      importance,
      source: `agent:${agentId}:lesson`
    });

    log.info(`Stored lesson from agent ${agentId}: ${lesson.slice(0, 50)}...`);
    return memoryId;
  } catch (error) {
    log.error('Failed to store lesson:', error);
    return null;
  }
}

/**
 * Store a decision made during agent execution
 */
export async function storeDecision(
  agentId: string,
  decision: string,
  reasoning?: string,
  importance: number = 0.8
): Promise<string | null> {
  try {
    const sharedMemory = await getSharedMemory();
    
    const content = reasoning 
      ? `Decision: ${decision}\n\nReasoning: ${reasoning}`
      : decision;
    
    const memoryId = await sharedMemory.store({
      agentId,
      content,
      type: 'decision',
      tags: ['decision-making', 'reasoning'],
      importance,
      source: `agent:${agentId}:decision`
    });

    log.info(`Stored decision from agent ${agentId}: ${decision.slice(0, 50)}...`);
    return memoryId;
  } catch (error) {
    log.error('Failed to store decision:', error);
    return null;
  }
}

/**
 * Store an observation from agent execution
 */
export async function storeObservation(
  agentId: string,
  observation: string,
  tags: string[] = [],
  importance: number = 0.5
): Promise<string | null> {
  try {
    const sharedMemory = await getSharedMemory();
    
    const memoryId = await sharedMemory.store({
      agentId,
      content: observation,
      type: 'observation',
      tags: ['observation', ...tags],
      importance,
      source: `agent:${agentId}:observation`
    });

    log.debug(`Stored observation from agent ${agentId}: ${observation.slice(0, 50)}...`);
    return memoryId;
  } catch (error) {
    log.error('Failed to store observation:', error);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

function applyFilters(
  memories: SharedMemoryEntry[],
  filters: {
    includeAgents?: string[];
    excludeAgents?: string[];
    maxAgeHours?: number;
  }
): SharedMemoryEntry[] {
  return memories.filter(memory => {
    // Agent filters
    if (filters.includeAgents && !filters.includeAgents.includes(memory.agentId)) {
      return false;
    }
    
    if (filters.excludeAgents && filters.excludeAgents.includes(memory.agentId)) {
      return false;
    }
    
    // Age filter
    if (filters.maxAgeHours) {
      const maxAge = filters.maxAgeHours * 60 * 60 * 1000;
      if (Date.now() - memory.createdAt > maxAge) {
        return false;
      }
    }
    
    return true;
  });
}

function formatMemories(
  memories: SharedMemoryEntry[],
  format: 'markdown' | 'plain' | 'structured',
  title?: string
): string {
  if (memories.length === 0) {
    return '';
  }

  switch (format) {
    case 'markdown':
      return formatMarkdown(memories, title);
    case 'structured':
      return formatStructured(memories, title);
    case 'plain':
    default:
      return formatPlain(memories, title);
  }
}

function formatMarkdown(memories: SharedMemoryEntry[], title?: string): string {
  let output = title ? `## ${title}\n\n` : '## Relevant Shared Memories\n\n';
  
  for (const memory of memories) {
    const typeIcon = getTypeIcon(memory.type);
    const timeAgo = formatTimeAgo(memory.createdAt);
    const importance = '★'.repeat(Math.round(memory.importance * 5));
    
    output += `### ${typeIcon} ${capitalizeFirst(memory.type)} from ${memory.agentId}\n`;
    output += `*${timeAgo} ago • Importance: ${importance}*\n\n`;
    output += `${memory.content}\n\n`;
    
    if (memory.tags && memory.tags.length > 0) {
      output += `**Tags:** ${memory.tags.map(tag => `\`${tag}\``).join(', ')}\n\n`;
    }
    
    output += '---\n\n';
  }
  
  return output;
}

function formatStructured(memories: SharedMemoryEntry[], title?: string): string {
  const data = {
    title: title || 'Shared Memories',
    count: memories.length,
    memories: memories.map(memory => ({
      id: memory.id,
      type: memory.type,
      agentId: memory.agentId,
      content: memory.content,
      importance: memory.importance,
      tags: memory.tags,
      createdAt: new Date(memory.createdAt).toISOString(),
      timeAgo: formatTimeAgo(memory.createdAt)
    }))
  };
  
  return JSON.stringify(data, null, 2);
}

function formatPlain(memories: SharedMemoryEntry[], title?: string): string {
  let output = title ? `${title}:\n\n` : 'Relevant Shared Memories:\n\n';
  
  for (let i = 0; i < memories.length; i++) {
    const memory = memories[i];
    const timeAgo = formatTimeAgo(memory.createdAt);
    
    output += `${i + 1}. [${memory.type.toUpperCase()}] From ${memory.agentId} (${timeAgo} ago):\n`;
    output += `   ${memory.content}\n`;
    
    if (memory.tags && memory.tags.length > 0) {
      output += `   Tags: ${memory.tags.join(', ')}\n`;
    }
    
    output += '\n';
  }
  
  return output;
}

function getTypeIcon(type: string): string {
  const icons = {
    fact: '📝',
    decision: '🎯',
    lesson: '💡',
    task: '📋',
    observation: '👀'
  };
  return icons[type as keyof typeof icons] || '📝';
}

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  
  if (days > 0) {
    return `${days} day${days > 1 ? 's' : ''}`;
  } else if (hours > 0) {
    return `${hours} hour${hours > 1 ? 's' : ''}`;
  } else {
    return `${minutes} minute${minutes > 1 ? 's' : ''}`;
  }
}

function estimateTokens(text: string): number {
  // Rough estimation: ~4 characters per token
  return Math.ceil(text.length / 4);
}