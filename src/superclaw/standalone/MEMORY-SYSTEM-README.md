# SuperClaw Memory System - Phase 2 Implementation

## Overview

The Memory System provides persistent memory capabilities for SuperClaw agents, enabling continuity between sessions similar to OpenClaw's MEMORY.md system but adapted for standalone operation.

## Architecture

```
SuperClaw Memory System
├── MemoryManager        # Core memory operations (MEMORY.md, daily notes)
├── WorkspaceManager     # Safe file operations within workspace
├── MemorySearchService  # Search and retrieval across memory files
└── ContextInjectionService # Context preparation for LLM calls
```

## Core Components

### 1. MemoryManager (`memory.ts`)
**Purpose:** Handles reading/writing memory files with proper structure

**Key Features:**
- Read/write MEMORY.md (long-term curated memory)
- Daily notes system (memory/YYYY-MM-DD.md)
- Event recording (decisions, learnings, general events)
- Memory statistics and management

**Usage:**
```typescript
const memory = new MemoryManager({ workspaceRoot: '/path/to/workspace' });

// Read long-term memory
const longTerm = await memory.readLongTermMemory();

// Record events
await memory.recordEvent('Task completed', 'Development');
await memory.recordDecision('Use TypeScript', 'Better type safety');
await memory.recordLearning('Memory systems improve agent consistency');
```

### 2. WorkspaceManager (`workspace.ts`)
**Purpose:** Safe file operations with path traversal protection

**Key Features:**
- Configurable workspace root
- Path traversal prevention
- File size and extension restrictions
- Automatic directory creation

**Usage:**
```typescript
const workspace = new WorkspaceManager('/safe/workspace/root');

// Safe file operations
const content = await workspace.readFile('some/file.md');
await workspace.writeFile('output/result.md', 'content');
```

### 3. MemorySearchService (`memory-search.ts`)
**Purpose:** Search across memory files with relevance ranking

**Key Features:**
- Keyword search with context
- Relevance scoring
- Category-specific search (longterm, daily, recent)
- Multi-keyword AND logic
- Related content discovery

**Usage:**
```typescript
const search = new MemorySearchService(memory);

// Basic search
const results = await search.search('SuperClaw development');

// Category search
const longTermResults = await search.searchMemoryCategory('decisions', 'longterm');

// Multiple keywords (AND logic)
const multiResults = await search.searchMultiple(['SuperClaw', 'memory', 'implementation']);
```

### 4. ContextInjectionService (`context-injection.ts`)
**Purpose:** Prepare relevant context for LLM calls

**Key Features:**
- Session-aware security (main vs shared sessions)
- Identity files injection (SOUL.md, USER.md)
- Recent memory inclusion
- Relevant memory search based on input
- Context length management and truncation

**Usage:**
```typescript
const context = new ContextInjectionService(memory);

// Prepare context for main session
const mainContext = await context.injectContext({
  userInput: 'Tell me about recent developments',
  sessionType: 'main'
});

// Generate prompt
const prompt = context.generateContextPrompt(mainContext);
```

## File Structure

```
workspace/
├── SOUL.md              # Agent identity and core values
├── USER.md              # Information about the human user  
├── MEMORY.md            # Long-term curated memory
└── memory/
    ├── 2026-02-20.md    # Daily notes
    ├── 2026-02-19.md    # Daily notes
    ├── dev-log.md       # Development learnings
    └── other-memory.md  # Other memory files
```

## Session Types & Security

### Main Session
- **Access:** Full memory access including MEMORY.md
- **Use Case:** Direct 1:1 conversations with the human
- **Context:** Complete identity + long-term + recent + relevant memory

### Shared Session  
- **Access:** Limited memory, no MEMORY.md
- **Use Case:** Group chats, public interactions
- **Context:** Identity only + minimal recent memory

### Subagent Session
- **Access:** Focused context for specific tasks
- **Use Case:** Spawned agents for specific work
- **Context:** Identity + task-relevant memory only

## Memory Categories

### Long-term Memory (MEMORY.md)
- Curated, important information
- Key decisions and their reasoning  
- Important relationships and context
- Technical knowledge and learnings

### Daily Notes (memory/YYYY-MM-DD.md)
- Raw chronological logs
- Events, conversations, tasks
- Temporary context and working memory
- Auto-generated timestamps

### Identity Files
- **SOUL.md:** Core values, personality, behavior guidelines
- **USER.md:** Information about the human user
- **AGENTS.md:** Instructions and capabilities

## Usage Examples

### Basic Integration

```typescript
import { initializeMemorySystem } from './memory-index.ts';

const memory = await initializeMemorySystem('/workspace/path');

// Prepare context for LLM call
const { prompt, context } = await memory.prepareContext(userInput, 'main');

// Search memory
const results = await memory.search('project status');

// Record events  
await memory.recordEvent('User asked about project X', 'Conversation');
```

### LLM Agent Integration

```typescript
async function processUserMessage(message: string, sessionType: string) {
  // 1. Prepare context
  const { prompt, stats } = await memory.prepareContext(message, sessionType);
  
  // 2. Call LLM with context
  const response = await llm.generate(prompt + '\n\nUser: ' + message);
  
  // 3. Record interaction
  await memory.recordEvent(`User: ${message}\nAgent: ${response}`, 'Conversation');
  
  return response;
}
```

## Testing

Run the test suite to verify functionality:

```bash
cd /home/toba/superclaw
npx tsc src/standalone/memory*.ts --outDir dist --target ES2022 --module ES2022 --moduleResolution bundler --esModuleInterop --allowSyntheticDefaultImports --skipLibCheck
node dist/memory-test.js
```

Expected output shows all tests passing:
- ✓ Memory Manager functionality
- ✓ Memory Search capabilities  
- ✓ Context Injection system
- ✓ File operations and safety

## Performance Considerations

### Memory Usage
- Long-term memory: Typically < 50KB
- Daily notes: ~5-10KB per day
- Search indexes: Built on-demand
- Context injection: Respects token limits

### File I/O
- Lazy loading of memory files
- Caching of frequently accessed files
- Atomic writes for data integrity
- Safe path resolution

### Search Performance
- Simple keyword matching (current implementation)
- Future: Semantic search with embeddings
- Relevance scoring for ranking
- Configurable result limits

## Future Enhancements

### Phase 3 Candidates
1. **Semantic Search:** Vector embeddings for better context matching
2. **Memory Compression:** Automatic summarization of old daily notes
3. **Cross-Agent Memory:** Shared memory between agent instances
4. **Memory Analytics:** Pattern recognition in memory usage
5. **Integration APIs:** REST/GraphQL APIs for external memory access

### Technical Improvements
- SQLite backend for better performance
- Full-text search indexing
- Memory deduplication
- Automatic backup and sync

## Error Handling

The system includes comprehensive error handling:
- Path traversal protection
- File size limits  
- Missing file graceful handling
- Context truncation when limits exceeded
- Transaction safety for writes

## Security Features

- Session-aware memory access
- Path traversal prevention
- File extension restrictions
- Size limits to prevent abuse
- No access to files outside workspace

## Integration Points

### With SuperClaw Core
```typescript
// In agent executor
const memoryContext = await memorySystem.prepareContext(input, sessionType);
const llmInput = memoryContext.prompt + '\n\nUser: ' + input;
```

### With Channel Bridge
```typescript
// Different memory access based on channel
const sessionType = channel === 'direct' ? 'main' : 'shared';
const context = await memorySystem.prepareContext(message, sessionType);
```

### With Tool System
```typescript
// Tools can record their usage
await memorySystem.recordEvent(`Used ${toolName} tool: ${result}`, 'Tool Usage');
```

This memory system provides the foundation for persistent, context-aware agents that can maintain continuity across sessions while respecting security boundaries.