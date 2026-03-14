# Alpha Shared Memory System

A SQLite-backed shared memory system that enables knowledge transfer and learning between all Alpha agents. When Alpha spawns sub-agents (swarm fanout, background tasks, etc.), they can now share experiences, lessons, and decisions through a persistent memory store.

## Architecture

The shared memory system consists of four main components:

1. **Core Storage** (`shared-memory.ts`) - SQLite database with FTS5 search and embeddings
2. **Context Injection** (`shared-memory-context.ts`) - Utilities for injecting memories into agent prompts
3. **API Endpoints** (`api-endpoint.ts`) - HTTP APIs for external access
4. **Swarm Integration** (`swarm-bridge.ts`) - Automatic storage of swarm results

## Features

- ✅ **Persistent Storage**: SQLite database at `~/.alpha/memory/shared.sqlite`
- ✅ **Full-Text Search**: FTS5 virtual table for fast text searches
- ✅ **Embedding Search**: Optional semantic search using existing Alpha embeddings
- ✅ **Type Safety**: TypeScript interfaces for all memory operations
- ✅ **Automatic Cleanup**: Configurable memory size limits and importance-based cleanup
- ✅ **API Access**: RESTful HTTP endpoints for external integrations
- ✅ **Context Injection**: Helper functions to inject relevant memories into agent prompts
- ✅ **Swarm Integration**: Automatic storage of swarm results and decisions

## Database Schema

```sql
CREATE TABLE shared_memories (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  content TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('fact', 'decision', 'lesson', 'task', 'observation')),
  tags TEXT NOT NULL DEFAULT '[]',
  importance REAL NOT NULL DEFAULT 0.5 CHECK (importance >= 0 AND importance <= 1),
  source TEXT,
  embedding TEXT,
  created_at INTEGER NOT NULL,
  accessed_at INTEGER,
  access_count INTEGER NOT NULL DEFAULT 0
);

-- FTS5 virtual table for full-text search
CREATE VIRTUAL TABLE shared_memories_fts USING fts5(
  content, tags, source,
  content='shared_memories',
  content_rowid='rowid'
);
```

## Usage Examples

### Basic Memory Storage

```typescript
import { getSharedMemory } from "./shared-memory.js";

const sharedMemory = await getSharedMemory();

// Store a lesson learned
await sharedMemory.store({
  agentId: "agent-coder",
  content: "Always validate input parameters before processing",
  type: "lesson",
  tags: ["validation", "security", "best-practice"],
  importance: 0.8,
  source: "coding-session-001",
});
```

### Context Injection

```typescript
import { injectRelevantMemories } from "./shared-memory-context.js";

// Inject relevant memories for a task
const context = await injectRelevantMemories("I need to implement user authentication", {
  maxMemories: 5,
  types: ["lesson", "decision"],
  minImportance: 0.6,
  format: "markdown",
});

// Use context.contextText in your agent prompt
```

### Search Memories

```typescript
const memories = await sharedMemory.search("authentication security", {
  limit: 10,
  types: ["lesson", "decision"],
  minImportance: 0.5,
});
```

### Helper Functions

```typescript
import { storeLesson, storeDecision, storeObservation } from "./shared-memory-context.js";

// Store different types of memories with helpers
await storeLesson("agent-id", "Use prepared statements to prevent SQL injection");
await storeDecision(
  "agent-id",
  "Choose PostgreSQL over MySQL for this project",
  "Better JSON support",
);
await storeObservation("agent-id", "API response times increased after recent deployment");
```

## API Endpoints

### Search Memories

```http
GET /api/v1/memory/shared/search?q=authentication&limit=5&types=lesson,decision
```

Response:

```json
{
  "success": true,
  "results": [...],
  "count": 5,
  "query": "authentication"
}
```

### Store Memory

```http
POST /api/v1/memory/shared/store
Content-Type: application/json

{
  "agentId": "agent-001",
  "content": "Use bcrypt for password hashing",
  "type": "lesson",
  "tags": ["security", "passwords"],
  "importance": 0.8,
  "source": "security-review"
}
```

### Get Statistics

```http
GET /api/v1/memory/shared/stats
```

Response:

```json
{
  "success": true,
  "totalEntries": 42,
  "entriesByType": {
    "lesson": 15,
    "decision": 10,
    "observation": 17
  },
  "entriesByAgent": {
    "agent-coder": 20,
    "agent-reviewer": 15,
    "swarm-001": 7
  },
  "avgImportance": 0.68
}
```

## Memory Types

| Type          | Description                     | Use Case                              |
| ------------- | ------------------------------- | ------------------------------------- |
| `fact`        | Objective information           | API endpoints, documentation, facts   |
| `decision`    | Decisions made with reasoning   | Architecture choices, tool selections |
| `lesson`      | Lessons learned from experience | Best practices, what to avoid         |
| `task`        | Task descriptions and outcomes  | Completed work, task templates        |
| `observation` | Observations and insights       | Performance issues, patterns noticed  |

## Swarm Integration

The system automatically stores swarm results in shared memory:

- **Successful swarms**: Stored as `decision` (if consensus reached) or `observation`
- **High importance**: Consensus-based decisions get importance 0.8, observations get 0.6
- **Automatic tagging**: Tagged with 'swarm', topology type, and custom tags
- **Source tracking**: Includes swarm ID and truncated task description

## Configuration

Shared memory uses Alpha's existing memory configuration:

```yaml
memory:
  embeddings:
    enabled: true
    provider: "ollama" # or "openai", "gemini", etc.
```

## Performance Considerations

- **Embedding generation**: Optional but recommended for semantic search
- **Memory cleanup**: Automatically removes old, low-importance entries when limit reached
- **Database size**: Typical entry ~1KB, sustainable to 100K+ entries
- **Search performance**: FTS5 provides fast text search, embeddings enable semantic search

## Migration from Individual Memory

The shared memory system is **additive** - it doesn't replace Alpha's existing per-agent memory:

- **Per-agent memory**: Still exists at `~/.alpha/memory/main.sqlite`
- **Shared memory**: New system at `~/.alpha/memory/shared.sqlite`
- **Agent choice**: Agents can use both systems as needed
- **No conflicts**: Different databases, different purposes

## Maintenance

### Manual Operations

```typescript
// Consolidate similar memories (requires embeddings)
const mergedCount = await sharedMemory.consolidate();

// Clean up old entries (keep 10,000 most important)
const deletedCount = await sharedMemory.cleanup(10000);

// Get detailed statistics
const stats = await sharedMemory.getStats();
```

### Database Location

- **Path**: `~/.alpha/memory/shared.sqlite`
- **Backup**: Regular SQLite backup tools work
- **Migration**: Standard SQLite dump/restore

## Security Considerations

- **Access control**: Uses Alpha's existing HTTP authentication
- **Content filtering**: No automatic PII detection (agents should filter)
- **Isolation**: Shared between agents, not between users/instances
- **API rate limiting**: Inherits Alpha's rate limiting configuration

## Troubleshooting

### Common Issues

1. **"Shared memory not initialized"**
   - Ensure `~/.alpha/memory/` directory exists
   - Check file permissions

2. **Embedding search not working**
   - Verify `memory.embeddings.enabled: true` in config
   - Check embedding provider configuration

3. **API endpoints not responding**
   - Confirm Alpha gateway is running
   - Check HTTP authentication configuration

### Debug Mode

Enable debug logging:

```bash
DEBUG=shared-memory,shared-memory-context alpha start
```

## Demo

Run the included demo to test functionality:

```bash
cd /home/toba/alpha
node --import tsx src/superclaw/shared-memory-demo.ts
```

The demo will:

1. Initialize shared memory
2. Store sample memories from different agents
3. Demonstrate search and context injection
4. Show statistics and cleanup features

## Future Enhancements

- **Cross-instance sync**: Share memories between Alpha instances
- **Knowledge graphs**: Relationship tracking between memories
- **Importance decay**: Automatic importance reduction over time
- **Memory consolidation**: Automatic duplicate detection and merging
- **Export/import**: Memory export for backup and migration
- **Analytics dashboard**: Web UI for memory exploration and insights
