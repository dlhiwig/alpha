import { MemoryManager } from './memory';
import { MemorySearchService, SearchOptions } from './memory-search';

export interface ContextConfig {
  includeIdentity: boolean; // Include SOUL.md, USER.md
  includeLongTermMemory: boolean; // Include MEMORY.md
  includeRecentDays: number; // Number of recent daily notes to include
  searchRelevantMemory: boolean; // Search for relevant memory based on input
  maxContextLength: number; // Maximum total context length in characters
  searchMaxResults: number; // Maximum search results to include
}

export interface InjectedContext {
  identity?: {
    soul: string | null;
    user: string | null;
  };
  longTermMemory?: string | null;
  recentMemory?: Array<{
    date: string;
    content: string;
  }>;
  relevantMemory?: Array<{
    file: string;
    snippet: string;
    relevance: number;
  }>;
  stats: {
    totalLength: number;
    truncated: boolean;
    sections: string[];
  };
}

export interface ContextInjectionOptions {
  userInput?: string; // The user's input for relevant memory search
  sessionType?: 'main' | 'shared' | 'subagent'; // Type of session
  config?: Partial<ContextConfig>;
}

/**
 * Context Injection Service for SuperClaw - loads relevant memory before LLM calls
 * 
 * Features:
 * - Load identity files (SOUL.md, USER.md)
 * - Include long-term memory (MEMORY.md) for main sessions only
 * - Include recent daily notes
 * - Search for relevant memory based on user input
 * - Respect context length limits
 * - Different context for different session types
 */
export class ContextInjectionService {
  private memory: MemoryManager;
  private search: MemorySearchService;
  private defaultConfig: ContextConfig = {
    includeIdentity: true,
    includeLongTermMemory: true,
    includeRecentDays: 2,
    searchRelevantMemory: true,
    maxContextLength: 8000, // ~2k tokens
    searchMaxResults: 3
  };

  constructor(memory: MemoryManager) {
    this.memory = memory;
    this.search = new MemorySearchService(memory);
  }

  /**
   * Inject relevant context for an LLM call
   */
  async injectContext(options: ContextInjectionOptions = {}): Promise<InjectedContext> {
    const config = this.buildConfig(options.config || {}, options.sessionType);
    const context: InjectedContext = {
      stats: {
        totalLength: 0,
        truncated: false,
        sections: []
      }
    };

    // Load identity files
    if (config.includeIdentity) {
      context.identity = await this.memory.readIdentityFiles();
      this.updateStats(context, 'identity', this.calculateIdentityLength(context.identity));
    }

    // Load long-term memory (only for main sessions for security)
    if (config.includeLongTermMemory && options.sessionType !== 'shared') {
      context.longTermMemory = await this.memory.readLongTermMemory();
      if (context.longTermMemory) {
        this.updateStats(context, 'longTermMemory', context.longTermMemory.length);
      }
    }

    // Load recent daily notes
    if (config.includeRecentDays > 0) {
      const recentNotes = await this.memory.readRecentDailyNotes(config.includeRecentDays);
      if (recentNotes.length > 0) {
        context.recentMemory = recentNotes.map(note => ({
          date: note.date,
          content: note.content
        }));
        
        const recentLength = recentNotes.reduce((total, note) => total + note.content.length, 0);
        this.updateStats(context, 'recentMemory', recentLength);
      }
    }

    // Search for relevant memory based on user input
    if (config.searchRelevantMemory && options.userInput) {
      const searchResults = await this.searchRelevantMemory(
        options.userInput, 
        config.searchMaxResults,
        options.sessionType
      );
      
      if (searchResults.length > 0) {
        context.relevantMemory = searchResults;
        
        const relevantLength = searchResults.reduce((total, result) => total + result.snippet.length, 0);
        this.updateStats(context, 'relevantMemory', relevantLength);
      }
    }

    // Truncate if necessary
    if (context.stats.totalLength > config.maxContextLength) {
      context.stats.truncated = true;
      this.truncateContext(context, config.maxContextLength);
    }

    return context;
  }

  /**
   * Generate context prompt for LLM
   */
  generateContextPrompt(context: InjectedContext): string {
    const sections: string[] = [];

    // Add identity
    if (context.identity) {
      if (context.identity.soul) {
        sections.push(`## Your Identity (SOUL.md)\n${context.identity.soul}`);
      }
      if (context.identity.user) {
        sections.push(`## Your Human (USER.md)\n${context.identity.user}`);
      }
    }

    // Add long-term memory
    if (context.longTermMemory) {
      sections.push(`## Long-Term Memory (MEMORY.md)\n${context.longTermMemory}`);
    }

    // Add recent memory
    if (context.recentMemory && context.recentMemory.length > 0) {
      const recentSection = context.recentMemory.map(note => 
        `### ${note.date}\n${note.content}`
      ).join('\n\n');
      sections.push(`## Recent Daily Notes\n${recentSection}`);
    }

    // Add relevant memory
    if (context.relevantMemory && context.relevantMemory.length > 0) {
      const relevantSection = context.relevantMemory.map(memory => 
        `### From ${memory.file} (relevance: ${memory.relevance.toFixed(2)})\n${memory.snippet}`
      ).join('\n\n');
      sections.push(`## Relevant Memory\n${relevantSection}`);
    }

    if (sections.length === 0) {
      return '';
    }

    return `# Context Injection\n\n${sections.join('\n\n')}\n\n---\n\n`;
  }

  /**
   * Build configuration based on session type and overrides
   */
  private buildConfig(configOverrides: Partial<ContextConfig>, sessionType?: string): ContextConfig {
    const config = { ...this.defaultConfig, ...configOverrides };

    // Adjust config based on session type
    switch (sessionType) {
      case 'shared':
        // Shared sessions (group chats) get limited context for security
        config.includeLongTermMemory = false;
        config.includeRecentDays = Math.min(config.includeRecentDays, 1);
        config.searchRelevantMemory = false;
        break;
      
      case 'subagent':
        // Subagents get focused context
        config.includeRecentDays = Math.min(config.includeRecentDays, 1);
        config.maxContextLength = Math.min(config.maxContextLength, 4000);
        break;
      
      case 'main':
      default:
        // Main sessions get full context
        break;
    }

    return config;
  }

  /**
   * Search for memory relevant to user input
   */
  private async searchRelevantMemory(
    userInput: string, 
    maxResults: number,
    sessionType?: string
  ): Promise<Array<{
    file: string;
    snippet: string;
    relevance: number;
  }>> {
    const searchOptions: SearchOptions = {
      maxResults,
      contextLines: 1,
      wholeWords: false
    };

    // Limit search scope for non-main sessions
    if (sessionType === 'shared') {
      searchOptions.excludeFiles = ['MEMORY.md', 'memory/*.md'];
    }

    const { results } = await this.search.search(userInput, searchOptions);
    
    return results.map(result => ({
      file: result.file,
      snippet: this.extractSnippet(result),
      relevance: result.relevance
    }));
  }

  /**
   * Extract a snippet from a search result
   */
  private extractSnippet(result: { content: string; context?: { before: string[]; after: string[] } }): string {
    const lines: string[] = [];
    
    if (result.context?.before) {
      lines.push(...result.context.before);
    }
    
    lines.push(result.content);
    
    if (result.context?.after) {
      lines.push(...result.context.after);
    }

    return lines.join('\n').trim();
  }

  /**
   * Calculate total length of identity files
   */
  private calculateIdentityLength(identity: { soul: string | null; user: string | null }): number {
    return (identity.soul?.length || 0) + (identity.user?.length || 0);
  }

  /**
   * Update context statistics
   */
  private updateStats(context: InjectedContext, section: string, length: number): void {
    context.stats.sections.push(section);
    context.stats.totalLength += length;
  }

  /**
   * Truncate context to fit within length limit
   */
  private truncateContext(context: InjectedContext, maxLength: number): void {
    // Priority order: identity > recent memory > relevant memory > long-term memory
    let currentLength = context.stats.totalLength;
    
    // First, truncate long-term memory
    if (context.longTermMemory && currentLength > maxLength) {
      const available = maxLength - (currentLength - context.longTermMemory.length);
      if (available > 0) {
        context.longTermMemory = this.truncateText(context.longTermMemory, available);
      } else {
        context.longTermMemory = null;
      }
      currentLength = this.recalculateLength(context);
    }

    // Then truncate relevant memory
    if (context.relevantMemory && currentLength > maxLength) {
      const relevantLength = context.relevantMemory.reduce((total, memory) => total + memory.snippet.length, 0);
      const available = maxLength - (currentLength - relevantLength);
      
      if (available > 0) {
        // Keep the most relevant entries that fit
        let usedLength = 0;
        const keptMemories = [];
        
        for (const memory of context.relevantMemory.sort((a, b) => b.relevance - a.relevance)) {
          if (usedLength + memory.snippet.length <= available) {
            keptMemories.push(memory);
            usedLength += memory.snippet.length;
          }
        }
        
        context.relevantMemory = keptMemories;
      } else {
        context.relevantMemory = [];
      }
      currentLength = this.recalculateLength(context);
    }

    // Finally, truncate recent memory if still too long
    if (context.recentMemory && currentLength > maxLength) {
      const recentLength = context.recentMemory.reduce((total, memory) => total + memory.content.length, 0);
      const available = maxLength - (currentLength - recentLength);
      
      if (available > 0) {
        // Keep the most recent entries that fit
        let usedLength = 0;
        const keptMemories = [];
        
        for (const memory of context.recentMemory) {
          if (usedLength + memory.content.length <= available) {
            keptMemories.push(memory);
            usedLength += memory.content.length;
          } else {
            // Try to fit a truncated version
            const availableForThis = available - usedLength;
            if (availableForThis > 100) {
              keptMemories.push({
                ...memory,
                content: this.truncateText(memory.content, availableForThis)
              });
            }
            break;
          }
        }
        
        context.recentMemory = keptMemories;
      } else {
        context.recentMemory = [];
      }
    }
  }

  /**
   * Truncate text to fit within a character limit
   */
  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    
    // Try to truncate at a sentence boundary
    const truncated = text.substring(0, maxLength - 3);
    const lastSentence = truncated.lastIndexOf('.');
    
    if (lastSentence > maxLength * 0.7) {
      return truncated.substring(0, lastSentence + 1);
    }
    
    // Otherwise, truncate at word boundary
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > maxLength * 0.8) {
      return truncated.substring(0, lastSpace) + '...';
    }
    
    return truncated + '...';
  }

  /**
   * Recalculate total context length
   */
  private recalculateLength(context: InjectedContext): number {
    let total = 0;
    
    if (context.identity) {
      total += this.calculateIdentityLength(context.identity);
    }
    
    if (context.longTermMemory) {
      total += context.longTermMemory.length;
    }
    
    if (context.recentMemory) {
      total += context.recentMemory.reduce((sum, memory) => sum + memory.content.length, 0);
    }
    
    if (context.relevantMemory) {
      total += context.relevantMemory.reduce((sum, memory) => sum + memory.snippet.length, 0);
    }
    
    context.stats.totalLength = total;
    return total;
  }
}