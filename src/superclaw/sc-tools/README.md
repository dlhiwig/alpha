# SuperClaw File Operations Tools

This module provides a comprehensive file operations tool system for SuperClaw, allowing LLMs to safely read, write, edit, and list files within sandboxed paths.

## Architecture

The system consists of three main components:

### 1. Contracts (`contracts.ts`)
Defines the core interfaces and types:
- `ITool` - Interface that all tools must implement
- `ToolResult` - Standard result format for tool execution
- `ToolRegistry` - Manages tool registration and discovery
- `ToolExecutionContext` - Context passed to tools during execution

### 2. File Operations Tools (`file-ops.ts`)
Implements four core file operation tools:

#### `read_file`
Read contents of a file with optional line range.

**Parameters:**
- `path` (required): File path to read
- `start_line` (optional): Starting line number (1-indexed)
- `end_line` (optional): Ending line number (1-indexed)
- `encoding` (optional): File encoding (default: utf8)

**Example:**
```json
{
  "name": "read_file",
  "parameters": {
    "path": "/tmp/example.txt",
    "start_line": 5,
    "end_line": 10
  }
}
```

#### `write_file`
Create or overwrite a file with specified content.

**Parameters:**
- `path` (required): Where to write the file
- `content` (required): Content to write
- `encoding` (optional): File encoding (default: utf8)
- `create_directories` (optional): Create parent directories

**Example:**
```json
{
  "name": "write_file",
  "parameters": {
    "path": "/tmp/new-file.txt",
    "content": "Hello, SuperClaw!",
    "create_directories": true
  }
}
```

#### `edit_file`
Edit a file by replacing exact text with new text.

**Parameters:**
- `path` (required): File to edit
- `old_text` (required): Exact text to find and replace
- `new_text` (required): New text to replace with
- `encoding` (optional): File encoding (default: utf8)

**Example:**
```json
{
  "name": "edit_file",
  "parameters": {
    "path": "/tmp/config.txt",
    "old_text": "debug=false",
    "new_text": "debug=true"
  }
}
```

#### `list_directory`
List files and directories in a specified path.

**Parameters:**
- `path` (required): Directory to list
- `show_hidden` (optional): Include hidden files
- `recursive` (optional): List recursively
- `max_depth` (optional): Maximum recursion depth

**Example:**
```json
{
  "name": "list_directory",
  "parameters": {
    "path": "/tmp",
    "show_hidden": false,
    "recursive": true,
    "max_depth": 2
  }
}
```

### 3. Tool Executor (`executor.ts`)
Handles parsing LLM responses and executing tool calls safely.

#### Key Features:
- **Multi-format parsing**: Supports JSON, markdown code blocks, and XML-style tool calls
- **Parameter validation**: Strict type and constraint checking
- **Timeout protection**: Prevents hanging tool executions
- **Concurrency control**: Limits simultaneous tool executions
- **Error handling**: Comprehensive error reporting

## Security Features

### Path Sandboxing
File operations are restricted to allowed paths:
- `/tmp` - Temporary files
- `/home/toba/superclaw` - Project directory
- `/home/toba/.openclaw/workspace` - Workspace directory

### Validation
- Path traversal protection (prevents `../` attacks)
- File size limits (10MB default)
- Parameter type validation
- Required parameter checking

### Logging
All file operations are logged with:
- Timestamp
- Operation type
- File path
- Session ID
- Execution time

## Usage

### Basic Usage

```typescript
import { createFileOpsExecutor } from './src/tools';

const executor = createFileOpsExecutor();

// Execute a single tool
const result = await executor.executeTool({
  name: 'read_file',
  parameters: { path: '/tmp/example.txt' }
});

console.log(result.result.output.content);
```

### LLM Integration

The executor can parse tool calls from various LLM response formats:

```typescript
// From LLM response with markdown
const llmResponse = `
I'll read that file for you.

\`\`\`json
{
  "name": "read_file",
  "parameters": {
    "path": "/tmp/data.txt"
  }
}
\`\`\`
`;

const results = await executor.parseAndExecute(llmResponse);
console.log(executor.formatResults(results));
```

### Tool Registry

Register custom tools or get function definitions for LLMs:

```typescript
import { ToolRegistry } from './src/tools';

const registry = new ToolRegistry();

// Get OpenAI function calling format
const functions = registry.getFunctionDefinitions();

// Register a custom tool
registry.register(myCustomTool);
```

## Error Handling

The system provides comprehensive error handling:

```typescript
export enum ToolErrorType {
  TOOL_NOT_FOUND = 'TOOL_NOT_FOUND',
  INVALID_PARAMETERS = 'INVALID_PARAMETERS',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  EXECUTION_FAILED = 'EXECUTION_FAILED',
  TIMEOUT = 'TIMEOUT',
  RATE_LIMIT = 'RATE_LIMIT'
}
```

All operations return standardized `ToolResult` objects with success status, output data, and error information.

## Configuration

Customize executor behavior:

```typescript
const executor = new ToolExecutor(registry, {
  timeout: 30000,          // 30 second timeout
  maxConcurrent: 5,        // Max 5 simultaneous executions
  strictValidation: true,   // Strict parameter validation
  defaultContext: {
    securityLevel: 'sandbox',
    workingDir: '/tmp'
  }
});
```

## Testing

Run the test suite to verify tool functionality:

```bash
# Simple test (Node.js ES modules)
node test-tools-simple.mjs

# Full TypeScript test (requires build)
npx ts-node test-tools.ts
```

## Integration with SuperClaw

The file operations tools integrate seamlessly with SuperClaw's LLM pipeline:

1. **Tool Discovery**: LLMs receive tool definitions via function calling
2. **Request Parsing**: Executor parses tool calls from LLM responses
3. **Safe Execution**: Tools execute with security constraints
4. **Result Formatting**: Results are formatted for LLM consumption

This enables natural language file operations like:
- "Read the config file and show me the database settings"
- "Create a new README.md with project information"
- "Replace all instances of 'debug=true' with 'debug=false' in the config"
- "List all Python files in the project directory"

The system provides the foundation for more advanced file-based workflows and agent capabilities.