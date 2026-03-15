# EFRIT Tool Execution Patterns - SuperClaw Integration

This document explains how to integrate EFRIT's proven tool execution patterns with SuperClaw's multi-agent system.

## Overview

EFRIT (by Steve Yegge) introduces a "Zero Client-Side Intelligence" approach where:
- **Claude makes ALL decisions** about which tools to use
- **The engine executes** those decisions with safety controls
- **Natural language commands** are translated to tool calls
- **Session state persists** across interruptions
- **Checkpointing enables** recovery from failures

## Architecture Integration

```typescript
import { getToolRegistry } from './registry';
import { createEfritEngine, EfritExecutionEngine } from './efrit-patterns';

// Create EFRIT engine with SuperClaw's existing tool registry
const registry = getToolRegistry();
const efritEngine = createEfritEngine(registry, './.efrit-data');

// Now Claude can use EFRIT patterns with SuperClaw tools
```

## Core EFRIT Patterns

### 1. Zero Client-Side Intelligence

```typescript
// ❌ Traditional approach - client decides what to do
if (command.includes('create file')) {
  await createFile(filename, content);
} else if (command.includes('git status')) {
  await runGitStatus();
}

// ✅ EFRIT approach - Claude decides everything
const sessionId = await efritEngine.createSession(
  "Create a new authentication module with tests and documentation"
);

// Claude analyzes the command and chooses appropriate tools
await efritEngine.executeNaturalLanguage(sessionId, command);
```

### 2. Natural Language to Tool Mapping

```typescript
// Claude's natural language command gets mapped to specific tools
const mappings = await efritEngine.mapNaturalLanguageToTools(
  "Refactor the user service to use async/await instead of promises",
  context
);

// Results in tool selections like:
// 1. search_content - find user service files
// 2. read_file - analyze current implementation  
// 3. edit_file - refactor to async/await
// 4. shell_exec - run tests to verify changes
// 5. vcs_diff - show changes for review
```

### 3. Session State Management

```typescript
// Create persistent session
const sessionId = await efritEngine.createSession(
  "Build a complete REST API with authentication",
  {
    workingDirectory: '/project/api',
    projectRoot: '/project',
    safetyLevel: 'safe'
  }
);

// Session persists across interruptions
const status = efritEngine.getSessionStatus(sessionId);
console.log(`Progress: ${status.todos.completed}/${status.todos.total} tasks done`);

// Resume after process restart
await efritEngine.executeNaturalLanguage(
  sessionId,
  "Continue building the API where we left off"
);
```

### 4. Checkpointing for Long Operations

```typescript
// Automatic checkpointing before major operations
const session = efritEngine.getSession(sessionId);
const checkpoint = await efritEngine.createCheckpoint(
  session,
  "Before database schema migration"
);

try {
  // Perform complex operation
  await performDatabaseMigration();
} catch (error) {
  // Restore from checkpoint on failure
  await efritEngine.restoreCheckpoint(sessionId, checkpoint.id);
  console.log("Operation failed, restored to checkpoint");
}
```

### 5. Safety Controls

```typescript
// Circuit breaker prevents infinite loops
const result = await efritEngine.executeNaturalLanguage(
  sessionId,
  "Optimize all database queries in the codebase"
);

if (!result.success && result.error?.includes('Circuit breaker')) {
  console.log("Too many failures, operation halted for safety");
}

// Paranoid mode requires user confirmation
await efritEngine.createSession(command, {
  safetyLevel: 'paranoid' // Will prompt before dangerous operations
});
```

## Integration with SuperClaw CodeAgent Tools

### File Operations

```typescript
// EFRIT enhances SuperClaw's file tools with safety and tracking
await efritEngine.executeTool(sessionId, 'edit_file', {
  filename: 'src/auth/login.ts',
  changes: [
    { line: 42, content: 'const result = await authenticateUser(credentials);' }
  ]
}, "Converting callback to async/await pattern");

// Automatic undo capability
await efritEngine.executeTool(sessionId, 'undo_edit', {
  filename: 'src/auth/login.ts'
}, "Undo last change due to test failure");
```

### Shell Integration

```typescript
// Enhanced shell execution with safety controls
await efritEngine.executeTool(sessionId, 'shell_exec', {
  command: 'npm test -- --coverage',
  workingDirectory: '/project',
  timeout: 60000
}, "Run test suite to verify refactoring");
```

### Version Control

```typescript
// Git operations with context tracking
await efritEngine.executeTool(sessionId, 'vcs_status', {
  repository: '/project'
}, "Check git status before committing changes");

await efritEngine.executeTool(sessionId, 'vcs_diff', {
  repository: '/project',
  files: ['src/auth/']
}, "Show diff of authentication module changes");
```

## SuperClaw Swarm Integration

### Multi-Agent Coordination

```typescript
import { createSwarm } from '../swarm/swarm-engine';
import { createEfritEngine } from './efrit-patterns';

// Each swarm agent gets its own EFRIT session
const swarm = createSwarm({
  agents: [
    {
      name: 'backend-dev',
      role: 'Build API endpoints',
      efritSession: await efritEngine.createSession("Develop backend API")
    },
    {
      name: 'frontend-dev', 
      role: 'Build UI components',
      efritSession: await efritEngine.createSession("Develop frontend UI")
    },
    {
      name: 'test-engineer',
      role: 'Write comprehensive tests',
      efritSession: await efritEngine.createSession("Create test suite")
    }
  ]
});

// Coordinate through EFRIT sessions
await swarm.execute("Build a complete user management system");
```

### Cross-Session Communication

```typescript
// Agents can coordinate through shared state
await efritEngine.updateTodoList(backendSessionId, [
  {
    description: "API endpoints completed",
    status: "completed"
  }
]);

// Frontend agent can check backend progress
const backendStatus = efritEngine.getSessionStatus(backendSessionId);
if (backendStatus.todos.completed > 5) {
  await efritEngine.executeNaturalLanguage(
    frontendSessionId,
    "Backend API is ready, start integrating frontend"
  );
}
```

## Advanced Patterns

### User Guidance Injection

```typescript
// User can provide guidance mid-session
await efritEngine.executeNaturalLanguage(
  sessionId,
  "Refactor the authentication system",
  "Focus on security best practices and use bcrypt for password hashing"
);

// Or inject guidance during execution
efritEngine.on('user:input-required', async ({ sessionId, prompt, respond }) => {
  const userInput = await getUserInput(prompt);
  respond(userInput);
});
```

### Tool Composition

```typescript
// EFRIT can compose multiple tools for complex operations
const result = await efritEngine.executeNaturalLanguage(
  sessionId,
  `Analyze the codebase for security vulnerabilities, 
   fix any issues found, and generate a security report`
);

// This might execute:
// 1. search_content - find all auth-related files
// 2. read_file - analyze each file
// 3. edit_file - fix vulnerabilities 
// 4. shell_exec - run security scanner
// 5. create_file - generate security report
```

### Error Recovery

```typescript
// Automatic error recovery with checkpoints
efritEngine.on('execution:failed', async ({ sessionId, error }) => {
  console.log(`Session ${sessionId} failed: ${error}`);
  
  // Find last good checkpoint
  const session = efritEngine.getSession(sessionId);
  const lastCheckpoint = session.checkpoints[session.checkpoints.length - 1];
  
  if (lastCheckpoint) {
    await efritEngine.restoreCheckpoint(sessionId, lastCheckpoint.id);
    console.log("Restored to last checkpoint, ready to retry");
  }
});
```

## Configuration

### Environment Setup

```typescript
// Configure EFRIT for your project
const efritEngine = createEfritEngine(registry, {
  dataDirectory: './.efrit-sessions',
  circuitBreakerThreshold: 5,
  maxSessionDuration: 7200000, // 2 hours
  defaultSafetyLevel: 'safe'
});
```

### Safety Levels

```typescript
// Paranoid: Requires confirmation for all high-risk operations
await efritEngine.createSession(command, { safetyLevel: 'paranoid' });

// Safe: Automatic safety checks, some confirmations
await efritEngine.createSession(command, { safetyLevel: 'safe' });

// Permissive: Minimal safety checks, maximum automation
await efritEngine.createSession(command, { safetyLevel: 'permissive' });
```

## Best Practices

### 1. Session Organization

```typescript
// Use descriptive session names
const refactorSession = await efritEngine.createSession(
  "Refactor authentication module for better security"
);

const testSession = await efritEngine.createSession(
  "Add comprehensive tests for user management"
);
```

### 2. Checkpoint Strategy

```typescript
// Create checkpoints at logical milestones
await efritEngine.createCheckpoint(session, "All tests passing");
await efritEngine.createCheckpoint(session, "Database migration complete");  
await efritEngine.createCheckpoint(session, "API endpoints implemented");
```

### 3. Todo Management

```typescript
// Let Claude break down complex tasks
await efritEngine.updateTodoList(sessionId, [
  {
    description: "Design database schema",
    priority: "high",
    estimatedSteps: 5
  },
  {
    description: "Implement CRUD operations", 
    priority: "medium",
    estimatedSteps: 8,
    dependencies: ["design-schema"]
  },
  {
    description: "Add input validation",
    priority: "medium", 
    estimatedSteps: 3,
    dependencies: ["implement-crud"]
  }
]);
```

### 4. Error Handling

```typescript
// Always handle execution results
const result = await efritEngine.executeNaturalLanguage(sessionId, command);

if (!result.success) {
  console.error(`Execution failed: ${result.error}`);
  
  // Check if it's a recoverable error
  if (result.session.context.circuitBreakerTrips < 3) {
    console.log("Retrying with user guidance...");
    await efritEngine.executeNaturalLanguage(
      sessionId,
      command,
      "Please be more careful and double-check your work"
    );
  }
}
```

## Performance Considerations

- **Session Persistence**: Sessions are saved to disk automatically
- **Memory Usage**: Sessions keep execution traces in memory (configurable limit)
- **Tool Execution**: Tools run with configurable timeouts
- **Circuit Breaker**: Prevents infinite loops and resource exhaustion

## Migration from Traditional Patterns

### Before (Traditional)
```typescript
// Manual tool selection and execution
await fileOps.createFile('config.ts', configContent);
await shell.execute('npm install');
await git.commit('Add configuration');
```

### After (EFRIT)
```typescript
// Claude handles all decisions
const sessionId = await efritEngine.createSession(
  "Set up project configuration with package installation and git commit"
);

await efritEngine.executeNaturalLanguage(sessionId, 
  "Configure the project, install dependencies, and commit changes"
);
```

## Conclusion

EFRIT patterns transform SuperClaw from a tool executor into an intelligent agent coordinator. By adopting these patterns, SuperClaw gains:

- **Higher reliability** through checkpointing and error recovery
- **Better user experience** through natural language interfaces
- **Improved safety** through circuit breakers and confirmation prompts
- **Enhanced coordination** through persistent session state
- **Greater intelligence** by letting Claude make all tool selection decisions

The integration preserves SuperClaw's existing tool ecosystem while adding EFRIT's proven orchestration patterns.