import { MemoryManager } from './memory';
import { WorkspaceManager } from './workspace';

export interface SearchOptions {
  includeFiles?: string[]; // specific files to search
  excludeFiles?: string[]; // files to exclude
  maxResults?: number;
  caseSensitive?: boolean;
  wholeWords?: boolean;
  contextLines?: number; // lines of context around matches
}

export interface SearchMatch {
  file: string;
  line: number;
  column: number;
  content: string;
  context?: {
    before: string[];
    after: string[];
  };
  relevance: number;
}

export interface SearchStats {
  totalFiles: number;
  filesSearched: number;
  totalMatches: number;
  searchTime: number; // milliseconds
}

/**
 * Memory Search Service for SuperClaw - semantic search through memory files
 * 
 * Features:
 * - Keyword search with relevance scoring
 * - Context extraction around matches
 * - File filtering and exclusion
 * - Search statistics
 * - Future: semantic/embedding-based search
 */
export class MemorySearchService {
  private memory: MemoryManager;
  private workspace: WorkspaceManager;

  constructor(memory: MemoryManager) {
    this.memory = memory;
    this.workspace = (memory as any).workspace; // Access the workspace from memory manager
  }

  /**
   * Search memory files for keywords or phrases
   */
  async search(
    query: string, 
    options: SearchOptions = {}
  ): Promise<{
    results: SearchMatch[];
    stats: SearchStats;
  }> {
    const startTime = Date.now();
    const {
      includeFiles,
      excludeFiles = [],
      maxResults = 20,
      caseSensitive = false,
      wholeWords = false,
      contextLines = 1
    } = options;

    // Get all searchable files
    const files = await this.getSearchableFiles(includeFiles, excludeFiles);
    const results: SearchMatch[] = [];

    for (const file of files) {
      try {
        const matches = await this.searchFile(file, query, {
          caseSensitive,
          wholeWords,
          contextLines
        });
        results.push(...matches);
      } catch (error: unknown) {
        console.warn(`Failed to search file ${file}:`, error);
      }
    }

    // Sort by relevance and limit results
    results.sort((a, b) => b.relevance - a.relevance);
    const limitedResults = results.slice(0, maxResults);

    const stats: SearchStats = {
      totalFiles: files.length,
      filesSearched: files.length,
      totalMatches: results.length,
      searchTime: Date.now() - startTime
    };

    return { results: limitedResults, stats };
  }

  /**
   * Search for multiple keywords/phrases with AND logic
   */
  async searchMultiple(
    queries: string[], 
    options: SearchOptions = {}
  ): Promise<{
    results: SearchMatch[];
    stats: SearchStats;
  }> {
    const startTime = Date.now();
    const allResults: SearchMatch[] = [];
    const fileMatches = new Map<string, SearchMatch[]>();

    // Search for each query
    for (const query of queries) {
      const { results } = await this.search(query, { ...options, maxResults: 1000 });
      
      for (const result of results) {
        if (!fileMatches.has(result.file)) {
          fileMatches.set(result.file, []);
        }
        fileMatches.get(result.file)!.push(result);
      }
    }

    // Only include files that match ALL queries
    for (const [file, matches] of fileMatches) {
      const uniqueQueries = new Set(queries.map(q => q.toLowerCase()));
      const matchedQueries = new Set<string>();
      
      for (const match of matches) {
        for (const query of queries) {
          if (this.matchesQuery(match.content, query, options)) {
            matchedQueries.add(query.toLowerCase());
          }
        }
      }
      
      // Only include if all queries matched
      if (matchedQueries.size === uniqueQueries.size) {
        // Combine relevance scores
        const combinedRelevance = matches.reduce((sum, match) => sum + match.relevance, 0) / matches.length;
        
        // Take the best match from this file
        const bestMatch = matches.reduce((best, current) => 
          current.relevance > best.relevance ? current : best
        );
        
        allResults.push({
          ...bestMatch,
          relevance: combinedRelevance
        });
      }
    }

    // Sort and limit
    allResults.sort((a, b) => b.relevance - a.relevance);
    const limitedResults = allResults.slice(0, options.maxResults || 20);

    const stats: SearchStats = {
      totalFiles: fileMatches.size,
      filesSearched: fileMatches.size,
      totalMatches: allResults.length,
      searchTime: Date.now() - startTime
    };

    return { results: limitedResults, stats };
  }

  /**
   * Get contextual search results - find related content to a given snippet
   */
  async findRelatedContent(
    contextSnippet: string, 
    options: SearchOptions = {}
  ): Promise<{
    results: SearchMatch[];
    stats: SearchStats;
  }> {
    // Extract key terms from the context snippet
    const keyTerms = this.extractKeyTerms(contextSnippet);
    
    // Search for combinations of key terms
    return await this.searchMultiple(keyTerms, {
      ...options,
      wholeWords: false,
      maxResults: options.maxResults || 10
    });
  }

  /**
   * Search within specific memory categories
   */
  async searchMemoryCategory(
    query: string, 
    category: 'longterm' | 'daily' | 'recent',
    options: SearchOptions = {}
  ): Promise<{
    results: SearchMatch[];
    stats: SearchStats;
  }> {
    let includeFiles: string[] = [];

    switch (category) {
      case 'longterm':
        includeFiles = ['MEMORY.md'];
        break;
      case 'daily':
        includeFiles = (await this.memory.getAllDailyNotes()).map(note => `memory/${note.date}.md`);
        break;
      case 'recent':
        const recentNotes = await this.memory.readRecentDailyNotes(7);
        includeFiles = recentNotes.map(note => `memory/${note.date}.md`);
        includeFiles.push('MEMORY.md');
        break;
    }

    return await this.search(query, {
      ...options,
      includeFiles
    });
  }

  /**
   * Get searchable files based on include/exclude patterns
   */
  private async getSearchableFiles(
    includeFiles?: string[], 
    excludeFiles: string[] = []
  ): Promise<string[]> {
    if (includeFiles && includeFiles.length > 0) {
      // Filter out excluded files
      return includeFiles.filter(file => 
        !excludeFiles.some(exclude => this.matchesPattern(file, exclude))
      );
    }

    // Default: search memory files and key identity files
    const files: string[] = [];
    
    // Add MEMORY.md if it exists
    if (await this.workspace.fileExists('MEMORY.md')) {
      files.push('MEMORY.md');
    }
    
    // Add identity files
    for (const identityFile of ['SOUL.md', 'USER.md', 'AGENTS.md']) {
      if (await this.workspace.fileExists(identityFile)) {
        files.push(identityFile);
      }
    }
    
    // Add all daily notes
    const dailyNotes = await this.memory.getAllDailyNotes();
    for (const note of dailyNotes) {
      files.push(`memory/${note.date}.md`);
    }
    
    // Add other memory files
    try {
      const memoryFiles = await this.workspace.listDirectory('memory');
      for (const file of memoryFiles) {
        if (file.endsWith('.md') && !file.match(/^\d{4}-\d{2}-\d{2}\.md$/)) {
          files.push(`memory/${file}`);
        }
      }
    } catch (error: unknown) {
      // Memory directory might not exist
    }
    
    // Filter out excluded files
    return files.filter(file => 
      !excludeFiles.some(exclude => this.matchesPattern(file, exclude))
    );
  }

  /**
   * Search a single file for matches
   */
  private async searchFile(
    file: string, 
    query: string, 
    options: {
      caseSensitive: boolean;
      wholeWords: boolean;
      contextLines: number;
    }
  ): Promise<SearchMatch[]> {
    const content = await this.workspace.readFile(file);
    const lines = content.split('\n');
    const matches: SearchMatch[] = [];

    const searchQuery = options.caseSensitive ? query : query.toLowerCase();
    const regex = options.wholeWords 
      ? new RegExp(`\\b${this.escapeRegex(searchQuery)}\\b`, options.caseSensitive ? 'g' : 'gi')
      : new RegExp(this.escapeRegex(searchQuery), options.caseSensitive ? 'g' : 'gi');

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      const searchLine = options.caseSensitive ? line : line.toLowerCase();
      
      let match;
      while ((match = regex.exec(line)) !== null) {
        const relevance = this.calculateRelevance(line, query, file);
        
        // Get context lines
        const context = options.contextLines > 0 ? {
          before: lines.slice(
            Math.max(0, lineIndex - options.contextLines), 
            lineIndex
          ),
          after: lines.slice(
            lineIndex + 1, 
            Math.min(lines.length, lineIndex + 1 + options.contextLines)
          )
        } : undefined;

        matches.push({
          file,
          line: lineIndex + 1, // 1-based line numbers
          column: match.index || 0,
          content: line.trim(),
          context,
          relevance
        });

        // Prevent infinite loop
        if (!regex.global) break;
      }
      
      // Reset regex for next line if global
      if (regex.global) {
        regex.lastIndex = 0;
      }
    }

    return matches;
  }

  /**
   * Calculate relevance score for a match
   */
  private calculateRelevance(line: string, query: string, file: string): number {
    let score = 1.0;

    // Boost score for exact matches
    if (line.toLowerCase().includes(query.toLowerCase())) {
      score += 0.5;
    }

    // Boost score for matches in headers
    if (line.trim().startsWith('#')) {
      score += 0.3;
    }

    // Boost score for matches in MEMORY.md (long-term memory)
    if (file === 'MEMORY.md') {
      score += 0.2;
    }

    // Boost score for recent daily notes
    if (file.includes('memory/') && file.includes(new Date().getFullYear().toString())) {
      score += 0.1;
    }

    // Penalize very long lines (might be less relevant)
    if (line.length > 200) {
      score -= 0.1;
    }

    return Math.max(0.1, score);
  }

  /**
   * Check if content matches a query according to options
   */
  private matchesQuery(content: string, query: string, options: SearchOptions): boolean {
    const searchContent = options.caseSensitive ? content : content.toLowerCase();
    const searchQuery = options.caseSensitive ? query : query.toLowerCase();

    if (options.wholeWords) {
      const regex = new RegExp(`\\b${this.escapeRegex(searchQuery)}\\b`, 'i');
      return regex.test(searchContent);
    }

    return searchContent.includes(searchQuery);
  }

  /**
   * Extract key terms from a text snippet
   */
  private extractKeyTerms(text: string, maxTerms: number = 5): string[] {
    // Simple keyword extraction - can be improved with NLP
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3 && !this.isStopWord(word));

    // Count frequency and return most common terms
    const frequency: Record<string, number> = {};
    for (const word of words) {
      frequency[word] = (frequency[word] || 0) + 1;
    }

    return Object.entries(frequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxTerms)
      .map(([word]) => word);
  }

  /**
   * Check if a word is a stop word (common word that should be ignored)
   */
  private isStopWord(word: string): boolean {
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 
      'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 
      'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
      'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they'
    ]);
    return stopWords.has(word.toLowerCase());
  }

  /**
   * Check if a filename matches a pattern
   */
  private matchesPattern(filename: string, pattern: string): boolean {
    const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'), 'i');
    return regex.test(filename);
  }

  /**
   * Escape special regex characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}