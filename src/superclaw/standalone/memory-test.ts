#!/usr/bin/env node

import { promises as fs } from 'fs';
import { join } from 'path';
import { MemoryManager } from './memory';
import { MemorySearchService } from './memory-search';
import { ContextInjectionService } from './context-injection';

/**
 * Test suite for SuperClaw Memory System
 * 
 * Tests:
 * 1. Memory Manager - reading/writing memory files
 * 2. Memory Search - keyword search functionality
 * 3. Context Injection - loading relevant context for LLM calls
 */

class MemorySystemTest {
  private testDir: string;
  // @ts-expect-error - Post-Merge Reconciliation
  private memory: MemoryManager;
  // @ts-expect-error - Post-Merge Reconciliation
  private search: MemorySearchService;
  // @ts-expect-error - Post-Merge Reconciliation
  private context: ContextInjectionService;

  constructor() {
    this.testDir = '/tmp/superclaw-memory-test';
  }

  async run(): Promise<void> {
    console.log('🧠 SuperClaw Memory System Test');
    console.log('================================\n');

    try {
      await this.setupTestEnvironment();
      await this.testMemoryManager();
      await this.testMemorySearch();
      await this.testContextInjection();
      console.log('✅ All tests passed!\n');
    } catch (error: unknown) {
      console.error('❌ Test failed:', error);
      process.exit(1);
    } finally {
      await this.cleanup();
    }
  }

  private async setupTestEnvironment(): Promise<void> {
    console.log('📁 Setting up test environment...');

    // Clean up any existing test directory
    try {
      await fs.rm(this.testDir, { recursive: true });
    } catch (error: unknown) {
      // Directory doesn't exist, that's fine
    }

    // Create test directory
    await fs.mkdir(this.testDir, { recursive: true });

    // Initialize memory manager
    this.memory = new MemoryManager({
      workspaceRoot: this.testDir
    });

    this.search = new MemorySearchService(this.memory);
    this.context = new ContextInjectionService(this.memory);

    // Create test files
    await this.createTestFiles();

    console.log('✓ Test environment ready\n');
  }

  private async createTestFiles(): Promise<void> {
    // Create SOUL.md
    const soulContent = `# SOUL.md - Who You Are

## Core Truths

**Be genuinely helpful, not performatively helpful.** Skip the "Great question!" and "I'd be happy to help!" — just help. Actions speak louder than filler words.

**Have opinions.** You're allowed to disagree, prefer things, find stuff amusing or boring. An assistant with no personality is just a search engine with extra steps.

**Be resourceful before asking.** Try to figure it out. Read the file. Check the context. Search for it. *Then* ask if you're stuck.`;

    // Create USER.md
    const userContent = `# USER.md - Your Human

## Daniel L. Hiwig

**Role:** Founder & CEO, Defense Fitness (DEFIT)
**Location:** Indiana, USA
**Background:** Former Army officer, fitness entrepreneur

## Current Projects
- DEFIT fitness platform
- SuperClaw development
- Black Eagle Project`;

    // Create MEMORY.md
    const memoryContent = `# MEMORY.md - Long-Term Memory

## Key Events

### SuperClaw Project Start (2026-02-20)
Started implementation of SuperClaw's memory layer. This is a critical component that provides persistent memory capabilities similar to OpenClaw's system.

## Important Decisions

### Memory Architecture
- Chose file-based memory system for simplicity and transparency
- Implemented search capabilities for memory retrieval
- Created context injection for LLM calls

## Technical Notes

### Memory Files
- SOUL.md: Core identity and values
- USER.md: Information about the human user
- MEMORY.md: Long-term curated memory (this file)
- memory/YYYY-MM-DD.md: Daily notes and logs`;

    // Write files
    await fs.writeFile(join(this.testDir, 'SOUL.md'), soulContent);
    await fs.writeFile(join(this.testDir, 'USER.md'), userContent);
    await this.memory.writeLongTermMemory(memoryContent);

    // Create memory directory and daily notes
    await this.memory.ensureMemoryDirectory();
    
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    await this.memory.writeDailyNote(today, `# ${this.formatDate(today)}

## Memory System Testing
Started testing the SuperClaw memory system today. Implementing core functionality:
- Memory reading and writing
- Search capabilities
- Context injection

## Tasks Completed
- Created MemoryManager class
- Implemented basic file operations
- Added safety checks for path traversal`);

    await this.memory.writeDailyNote(yesterday, `# ${this.formatDate(yesterday)}

## SuperClaw Development
Working on Phase 2 of SuperClaw - the memory layer. This is crucial for agent persistence.

## Technical Progress
- Designed memory architecture
- Started implementation of core modules
- Planning test strategy`);
  }

  private async testMemoryManager(): Promise<void> {
    console.log('🧠 Testing Memory Manager...');

    // Test reading identity files
    const identity = await this.memory.readIdentityFiles();
    console.log('✓ Identity files loaded:', { 
      soul: identity.soul ? 'loaded' : 'missing',
      user: identity.user ? 'loaded' : 'missing'
    });

    // Test reading long-term memory
    const longTermMemory = await this.memory.readLongTermMemory();
    console.log('✓ Long-term memory loaded:', longTermMemory ? 'yes' : 'no');

    // Test reading daily notes
    const recentNotes = await this.memory.readRecentDailyNotes(2);
    console.log('✓ Recent daily notes loaded:', recentNotes.length);

    // Test recording events
    await this.memory.recordEvent('Testing memory system functionality', 'Test');
    await this.memory.recordDecision('Use file-based memory system', 'Simple and transparent');
    await this.memory.recordLearning('Memory search is essential for context retrieval');

    console.log('✓ Event recording working');

    // Test memory statistics
    const stats = await this.memory.getMemoryStats();
    console.log('✓ Memory stats:', {
      longTermSize: stats.longTermMemorySize,
      dailyNotesCount: stats.dailyNotesCount,
      totalSize: stats.totalMemorySize
    });

    console.log('✓ Memory Manager tests passed\n');
  }

  private async testMemorySearch(): Promise<void> {
    console.log('🔍 Testing Memory Search...');

    // Test basic search
    const searchResults = await this.search.search('SuperClaw');
    console.log('✓ Basic search results:', searchResults.results.length, 'matches found');

    // Test category search
    const longTermResults = await this.search.searchMemoryCategory('memory system', 'longterm');
    console.log('✓ Long-term memory search:', longTermResults.results.length, 'matches');

    const dailyResults = await this.search.searchMemoryCategory('testing', 'daily');
    console.log('✓ Daily notes search:', dailyResults.results.length, 'matches');

    // Test multiple keyword search
    const multiResults = await this.search.searchMultiple(['SuperClaw', 'memory']);
    console.log('✓ Multiple keyword search:', multiResults.results.length, 'matches');

    // Test related content search
    const relatedResults = await this.search.findRelatedContent('memory system implementation');
    console.log('✓ Related content search:', relatedResults.results.length, 'matches');

    // Display a sample result
    if (searchResults.results.length > 0) {
      const sample = searchResults.results[0];
      console.log('✓ Sample search result:');
      console.log(`  File: ${sample.file}`);
      console.log(`  Line: ${sample.line}`);
      console.log(`  Relevance: ${sample.relevance.toFixed(2)}`);
      console.log(`  Content: ${sample.content.substring(0, 80)}...`);
    }

    console.log('✓ Memory Search tests passed\n');
  }

  private async testContextInjection(): Promise<void> {
    console.log('🎯 Testing Context Injection...');

    // Test main session context
    const mainContext = await this.context.injectContext({
      userInput: 'Tell me about SuperClaw development',
      sessionType: 'main'
    });

    console.log('✓ Main session context:', {
      hasIdentity: !!mainContext.identity,
      hasLongTermMemory: !!mainContext.longTermMemory,
      recentMemoryCount: mainContext.recentMemory?.length || 0,
      relevantMemoryCount: mainContext.relevantMemory?.length || 0,
      totalLength: mainContext.stats.totalLength,
      truncated: mainContext.stats.truncated
    });

    // Test shared session context (should be limited)
    const sharedContext = await this.context.injectContext({
      userInput: 'Hello there',
      sessionType: 'shared'
    });

    console.log('✓ Shared session context:', {
      hasIdentity: !!sharedContext.identity,
      hasLongTermMemory: !!sharedContext.longTermMemory,
      recentMemoryCount: sharedContext.recentMemory?.length || 0,
      relevantMemoryCount: sharedContext.relevantMemory?.length || 0
    });

    // Test subagent context
    const subagentContext = await this.context.injectContext({
      userInput: 'Implement memory system',
      sessionType: 'subagent'
    });

    console.log('✓ Subagent context:', {
      hasIdentity: !!subagentContext.identity,
      hasLongTermMemory: !!subagentContext.longTermMemory,
      recentMemoryCount: subagentContext.recentMemory?.length || 0,
      relevantMemoryCount: subagentContext.relevantMemory?.length || 0
    });

    // Test context prompt generation
    const prompt = this.context.generateContextPrompt(mainContext);
    console.log('✓ Generated context prompt length:', prompt.length);

    // Show sections included
    console.log('✓ Context sections:', mainContext.stats.sections);

    console.log('✓ Context Injection tests passed\n');
  }

  private async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up test environment...');
    try {
      await fs.rm(this.testDir, { recursive: true });
      console.log('✓ Test directory cleaned up');
    } catch (error: unknown) {
      console.warn('⚠️  Could not clean up test directory:', error);
    }
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }
}

// CLI Interface
async function main() {
  const args = new Set(process.argv.slice(2));
  
  if (args.has('--help') || args.has('-h')) {
    console.log(`
SuperClaw Memory System Test

Usage:
  npx ts-node src/standalone/memory-test.ts

This test validates:
- Memory Manager functionality
- Memory Search capabilities
- Context Injection system
- File operations and safety

The test creates a temporary workspace and cleans up automatically.
`);
    return;
  }

  const test = new MemorySystemTest();
  await test.run();
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('❌ Test execution failed:', error);
    process.exit(1);
  });
}

export { MemorySystemTest };