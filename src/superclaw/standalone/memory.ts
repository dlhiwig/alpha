import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { WorkspaceManager } from './workspace';

export interface MemoryEntry {
  date: string;
  content: string;
  timestamp?: Date;
}

// MemorySearchResult is now defined in memory-search.ts

export interface MemoryConfig {
  workspaceRoot: string;
  memoryDir?: string; // defaults to 'memory'
}

/**
 * Memory Manager for SuperClaw - handles persistent memory like OpenClaw's MEMORY.md system
 * 
 * Features:
 * - Read/write MEMORY.md for long-term context
 * - Read/write daily notes (memory/YYYY-MM-DD.md)
 * - Search memory files semantically
 * - Context injection for LLM calls
 */
export class MemoryManager {
  private workspace: WorkspaceManager;
  private memoryDir: string;
  private memoryFile: string;

  constructor(config: MemoryConfig) {
    this.workspace = new WorkspaceManager(config.workspaceRoot);
    this.memoryDir = config.memoryDir || 'memory';
    this.memoryFile = 'MEMORY.md';
  }

  /**
   * Read the main MEMORY.md file (long-term curated memory)
   */
  async readLongTermMemory(): Promise<string | null> {
    try {
      return await this.workspace.readFile(this.memoryFile);
    } catch (error: unknown) {
      if ((error as any).code === 'ENOENT') {
        return null; // File doesn't exist yet
      }
      throw error;
    }
  }

  /**
   * Write/update the main MEMORY.md file
   */
  async writeLongTermMemory(content: string): Promise<void> {
    await this.workspace.writeFile(this.memoryFile, content);
  }

  /**
   * Append to the main MEMORY.md file
   */
  async appendToLongTermMemory(content: string): Promise<void> {
    const existing = await this.readLongTermMemory() || '';
    const updated = existing + (existing ? '\n\n' : '') + content;
    await this.writeLongTermMemory(updated);
  }

  /**
   * Read a daily note file (memory/YYYY-MM-DD.md)
   */
  async readDailyNote(date: Date): Promise<string | null> {
    const dateStr = this.formatDate(date);
    const filePath = join(this.memoryDir, `${dateStr}.md`);
    
    try {
      return await this.workspace.readFile(filePath);
    } catch (error: unknown) {
      if ((error as any).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Write/update a daily note file
   */
  async writeDailyNote(date: Date, content: string): Promise<void> {
    const dateStr = this.formatDate(date);
    const filePath = join(this.memoryDir, `${dateStr}.md`);
    
    // Ensure memory directory exists
    const memoryDirPath = this.workspace.resolvePath(this.memoryDir);
    await fs.mkdir(memoryDirPath, { recursive: true });
    
    await this.workspace.writeFile(filePath, content);
  }

  /**
   * Append to today's daily note
   */
  async appendToDailyNote(date: Date, content: string): Promise<void> {
    const existing = await this.readDailyNote(date) || this.createDailyNoteHeader(date);
    const updated = existing + '\n\n' + content;
    await this.writeDailyNote(date, updated);
  }

  /**
   * Append to today's daily note (convenience method)
   */
  async appendToToday(content: string): Promise<void> {
    await this.appendToDailyNote(new Date(), content);
  }

  /**
   * Read recent daily notes (last N days)
   */
  async readRecentDailyNotes(days: number = 3): Promise<MemoryEntry[]> {
    const entries: MemoryEntry[] = [];
    const today = new Date();
    
    for (let i = 0; i < days; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      
      const content = await this.readDailyNote(date);
      if (content) {
        entries.push({
          date: this.formatDate(date),
          content,
          timestamp: date
        });
      }
    }
    
    return entries;
  }

  /**
   * Get all available daily notes
   */
  async getAllDailyNotes(): Promise<MemoryEntry[]> {
    try {
      const memoryDirPath = this.workspace.resolvePath(this.memoryDir);
      const files = await fs.readdir(memoryDirPath);
      
      const dailyNoteFiles = files.filter(file => 
        file.match(/^\d{4}-\d{2}-\d{2}\.md$/)
      );
      
      const entries: MemoryEntry[] = [];
      
      for (const file of dailyNoteFiles) {
        const dateStr = file.replace('.md', '');
        const content = await this.workspace.readFile(join(this.memoryDir, file));
        
        if (content) {
          entries.push({
            date: dateStr,
            content,
            timestamp: new Date(dateStr)
          });
        }
      }
      
      // Sort by date (newest first)
      entries.sort((a, b) => (b.timestamp?.getTime() || 0) - (a.timestamp?.getTime() || 0));
      
      return entries;
    } catch (error: unknown) {
      if ((error as any).code === 'ENOENT') {
        return []; // Memory directory doesn't exist yet
      }
      throw error;
    }
  }

  /**
   * Read core identity files (SOUL.md, USER.md)
   */
  async readIdentityFiles(): Promise<{ soul: string | null; user: string | null }> {
    const [soul, user] = await Promise.all([
      this.workspace.readFile('SOUL.md').catch(() => null),
      this.workspace.readFile('USER.md').catch(() => null)
    ]);
    
    return { soul, user };
  }

  /**
   * Create a properly formatted daily note header
   */
  private createDailyNoteHeader(date: Date): string {
    const dateStr = this.formatDate(date);
    return `# ${dateStr}\n\n## Daily Log\n`;
  }

  /**
   * Format date as YYYY-MM-DD
   */
  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  /**
   * Record an event or thought in the daily log
   */
  async recordEvent(event: string, category?: string): Promise<void> {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false 
    });
    
    const entry = category 
      ? `### ${timeStr} - ${category}\n${event}`
      : `### ${timeStr}\n${event}`;
    
    await this.appendToToday(entry);
  }

  /**
   * Record a decision in the daily log
   */
  async recordDecision(decision: string, reasoning?: string): Promise<void> {
    const entry = reasoning 
      ? `**Decision:** ${decision}\n**Reasoning:** ${reasoning}`
      : `**Decision:** ${decision}`;
    
    await this.recordEvent(entry, 'Decision');
  }

  /**
   * Record a learning or insight
   */
  async recordLearning(learning: string): Promise<void> {
    await this.recordEvent(learning, 'Learning');
  }

  /**
   * Check if memory directory exists, create if not
   */
  async ensureMemoryDirectory(): Promise<void> {
    const memoryDirPath = this.workspace.resolvePath(this.memoryDir);
    await fs.mkdir(memoryDirPath, { recursive: true });
  }

  /**
   * Get memory statistics
   */
  async getMemoryStats(): Promise<{
    longTermMemorySize: number;
    dailyNotesCount: number;
    totalMemorySize: number;
    oldestNote?: string;
    newestNote?: string;
  }> {
    const longTermMemory = await this.readLongTermMemory();
    const dailyNotes = await this.getAllDailyNotes();
    
    const longTermMemorySize = longTermMemory?.length || 0;
    const totalMemorySize = longTermMemorySize + 
      dailyNotes.reduce((total, note) => total + note.content.length, 0);
    
    return {
      longTermMemorySize,
      dailyNotesCount: dailyNotes.length,
      totalMemorySize,
      oldestNote: dailyNotes[dailyNotes.length - 1]?.date,
      newestNote: dailyNotes[0]?.date
    };
  }
}