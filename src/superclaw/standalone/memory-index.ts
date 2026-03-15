// @ts-nocheck
/**
 * SuperClaw Memory System - Phase 2 Implementation
 * 
 * This module provides persistent memory capabilities for SuperClaw agents,
 * similar to OpenClaw's memory system but adapted for standalone operation.
 * 
 * Features:
 * - Long-term memory storage (MEMORY.md)
 * - Daily notes system (memory/YYYY-MM-DD.md)
 * - Memory search with relevance ranking
 * - Context injection for LLM calls
 * - Session-aware security (main vs shared sessions)
 * 
 * @author SuperClaw Phase 2 Implementation Agent
 * @date 2026-02-20
 */

// Core memory management
export { MemoryManager, type MemoryEntry, type MemoryConfig } from './memory';

// Workspace file operations
export { WorkspaceManager, type WorkspaceConfig } from './workspace';

// Memory search capabilities
export { 
  MemorySearchService, 
  type SearchOptions, 
  type SearchMatch, 
  type SearchStats 
} from './memory-search';

// Context injection for LLM calls
export { 
  ContextInjectionService, 
  type ContextConfig, 
  type InjectedContext, 
  type ContextInjectionOptions 
} from './context-injection';

// Import the actual classes for the factory function
import { MemoryManager } from './memory';
import { MemorySearchService } from './memory-search';
import { ContextInjectionService } from './context-injection';

/**
 * Create a complete memory system instance
 */
export function createMemorySystem(workspaceRoot: string) {
  const memory = new MemoryManager({ workspaceRoot });
  const search = new MemorySearchService(memory);
  const context = new ContextInjectionService(memory);
  
  return {
    memory,
    search,
    context,
    
    /**
     * Initialize memory system - ensure directories exist
     */
    async initialize() {
      await memory.ensureMemoryDirectory();
      return this;
    },
    
    /**
     * Get memory statistics
     */
    async getStats() {
      const memoryStats = await memory.getMemoryStats();
      const workspace = (memory as any).workspace;
      const workspaceStats = await workspace.getWorkspaceStats();
      
      return {
        memory: memoryStats,
        workspace: workspaceStats
      };
    },
    
    /**
     * Prepare context for an LLM call
     */
    async prepareContext(userInput: string, sessionType: 'main' | 'shared' | 'subagent' = 'main') {
      const injectedContext = await context.injectContext({
        userInput,
        sessionType
      });
      
      const prompt = context.generateContextPrompt(injectedContext);
      
      return {
        context: injectedContext,
        prompt,
        stats: injectedContext.stats
      };
    },
    
    /**
     * Quick search across all memory
     */
    async searchMemory(query: string, options?: { maxResults?: number; category?: 'longterm' | 'daily' | 'recent' }) {
      if (options?.category) {
        return await search.searchMemoryCategory(query, options.category, { maxResults: options.maxResults });
      }
      return await search.search(query, { maxResults: options?.maxResults });
    },
    
    /**
     * Record an event in today's memory
     */
    async recordEvent(event: string, category?: string) {
      return await memory.recordEvent(event, category);
    },
    
    /**
     * Record a decision with reasoning
     */
    async recordDecision(decision: string, reasoning?: string) {
      return await memory.recordDecision(decision, reasoning);
    },
    
    /**
     * Record a learning or insight
     */
    async recordLearning(learning: string) {
      return await memory.recordLearning(learning);
    }
  };
}

/**
 * Convenience function to create and initialize memory system
 */
export async function initializeMemorySystem(workspaceRoot: string) {
  const system = createMemorySystem(workspaceRoot);
  await system.initialize();
  return system;
}