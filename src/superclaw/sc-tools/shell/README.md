# CodeAgent Shell Tool

## Overview

The CodeAgent Shell Tool implements the "single tool + code execution" pattern for shell operations in SuperClaw. Instead of making multiple `exec()` calls, it executes complete bash scripts and returns intelligent, summarized results with comprehensive tracking and security features.

## Pattern Comparison

**Traditional Approach:**
```typescript
const result1 = await exec('ls -la');
const result2 = await exec('grep pattern file.txt');
const result3 = await exec('wc -l output.txt');
// 3 separate API calls, full verbose outputs
```

**CodeAgent Approach:**
```typescript
const result = await shell_execute({
  script: `
    ls -la
    grep pattern file.txt
    wc -l output.txt
  `
});
// 1 API call, summarized intelligent output
```

## Benefits

- **Reduced API Calls**: Complex multi-step operations in single call
- **Better Context**: Maintains state and variables between commands
- **Intelligent Output**: Summarized results instead of verbose logs
- **Token Efficiency**: Tracks and optimizes token usage
- **Enhanced Security**: Command allowlists, sandboxing, sudo restrictions
- **Progress Tracking**: Real-time progress reporting for long operations
- **Resource Management**: Timeout protection and process cleanup

## Basic Usage

### Simple Script Execution

```typescript
import { shell_execute } from './tools/shell/code-agent-shell';

const result = await shell_execute({
  script: `
    echo "Starting backup process..."
    tar -czf backup.tar.gz /home/user/documents
    echo "Backup complete: $(ls -lh backup.tar.gz)"
  `
});

console.log(result.success); // true/false
console.log(result.output);  // Summarized output
console.log(result.metrics); // Execution metrics
```

### With Security Configuration

```typescript
const result = await shell_execute({
  script: `
    echo "System information:"
    uname -a
    df -h
    free -m
  `,
  security: {
    noSudo: true,
    allowlist: ['echo', 'uname', 'df', 'free'],
    maxScriptSize: 1024
  }
});
```

### With Progress Tracking

```typescript
const result = await shell_execute({
  script: `
    echo "PROGRESS:0% Starting download"
    wget https://example.com/large-file.zip
    echo "PROGRESS:50% Download complete, extracting..."
    unzip large-file.zip
    echo "PROGRESS:100% Extraction complete"
  `,
  progress: {
    enabled: true,
    interval: 2000, // Report every 2 seconds
    markers: ['PROGRESS:0%', 'PROGRESS:50%', 'PROGRESS:100%']
  }
});

// Access progress reports
result.progress?.forEach(p => {
  console.log(`${p.timestamp}: ${p.message}`);
});
```

### With Token Tracking

```typescript
const result = await shell_execute({
  script: complexBuildScript,
  tokenTracking: {
    enabled: true,
    budgetLimit: 5000 // Warn if over 5K tokens
  }
});

console.log(`Used ${result.metrics.tokenUsage?.totalTokens} tokens`);
if (result.warnings?.some(w => w.includes('budget'))) {
  console.log('Token budget exceeded!');
}
```

## Configuration Options

### ShellExecuteOptions

| Option | Type | Description | Default |
|--------|------|-------------|---------|
| `script` | `string` | Bash script content to execute | **Required** |
| `cwd` | `string` | Working directory | `process.cwd()` |
| `env` | `Record<string,string>` | Environment variables | `process.env` |
| `timeout` | `number` | Timeout in milliseconds | 5 minutes |

### Security Configuration

```typescript
security: {
  sandbox?: boolean;           // Restrict file system access
  allowlist?: string[];        // Only allow these commands
  noSudo?: boolean;           // Disable sudo (default: true)
  maxScriptSize?: number;     // Max script size in bytes
}
```

**Built-in Security Features:**
- Blocks dangerous commands (`rm -rf /`, fork bombs, etc.)
- Warns about sensitive path access (`/etc/`, `/sys/`, etc.)
- Command allowlist enforcement
- Script size limits
- Automatic sudo detection and warnings

### Progress Configuration

```typescript
progress: {
  enabled?: boolean;          // Enable progress reporting
  interval?: number;          // Report interval in ms (default: 5s)
  markers?: string[];         // Custom progress markers to detect
}
```

### Output Configuration

```typescript
output: {
  maxSize?: number;           // Max output size in bytes (100KB)
  summarize?: 'off' | 'auto' | 'aggressive';  // Summarization mode
  includeStderr?: boolean;    // Include stderr in summary
  keepRaw?: boolean;          // Preserve raw stdout/stderr
}
```

**Summarization Modes:**
- `off`: Return full output
- `auto`: Summarize large outputs (>5KB), preserve small ones
- `aggressive`: Always summarize with first/last lines

### Token Tracking

```typescript
tokenTracking: {
  enabled?: boolean;          // Enable token estimation
  budgetLimit?: number;       // Token budget limit (10K default)
}
```

## Return Value (ShellExecuteResult)

```typescript
{
  success: boolean;           // Overall success status
  exitCode: number | null;    // Process exit code
  output: string;             // Summarized output
  error?: string;             // Error description if failed
  
  metrics: {
    duration: number;         // Execution time in ms
    scriptSize: number;       // Script size in bytes
    rawOutputSize: number;    // Raw output size
    outputSize: number;       // Final output size
    tokenUsage?: {            // Token tracking (if enabled)
      scriptTokens: number;
      outputTokens: number;
      totalTokens: number;
      budgetUsed: number;     // Fraction of budget used
    };
  };
  
  progress?: Array<{          // Progress reports (if enabled)
    timestamp: Date;
    message: string;
    marker?: string;
  }>;
  
  rawOutput?: {               // Raw output (if keepRaw enabled)
    stdout: string;
    stderr: string;
  };
  
  warnings?: string[];        // Security and other warnings
  pid?: number;               // Process ID
}
```

## Advanced Examples

### Complex Build Process

```typescript
const buildResult = await shell_execute({
  script: `
    #!/bin/bash
    set -e  # Exit on error
    
    echo "🔨 Starting build process..."
    
    # Install dependencies
    echo "📦 Installing dependencies..."
    npm install
    
    # Run tests
    echo "🧪 Running tests..."
    npm test
    
    # Build application
    echo "🏗️ Building application..."
    npm run build
    
    # Generate documentation
    echo "📚 Generating documentation..."
    npm run docs
    
    # Package for deployment
    echo "📦 Packaging for deployment..."
    tar -czf dist-$(date +%Y%m%d-%H%M%S).tar.gz dist/
    
    echo "✅ Build complete!"
    ls -lh *.tar.gz
  `,
  cwd: '/path/to/project',
  timeout: 10 * 60 * 1000, // 10 minutes
  progress: {
    enabled: true,
    markers: ['Installing dependencies', 'Running tests', 'Building application']
  },
  tokenTracking: {
    enabled: true,
    budgetLimit: 8000
  },
  output: {
    summarize: 'auto',
    keepRaw: false
  }
});

if (buildResult.success) {
  console.log('✅ Build completed successfully');
  console.log(`Duration: ${buildResult.metrics.duration}ms`);
  console.log(`Tokens used: ${buildResult.metrics.tokenUsage?.totalTokens}`);
} else {
  console.error('❌ Build failed:', buildResult.error);
}
```

### System Maintenance Script

```typescript
const maintenanceResult = await shell_execute({
  script: `
    #!/bin/bash
    
    echo "🔧 Starting system maintenance..."
    
    # Update package lists
    echo "📡 Updating package lists..."
    apt update 2>/dev/null || echo "⚠️ Could not update packages (non-sudo)"
    
    # Clean temporary files
    echo "🧹 Cleaning temporary files..."
    find /tmp -type f -atime +7 -exec rm {} \; 2>/dev/null || true
    
    # Check disk usage
    echo "💾 Checking disk usage..."
    df -h | grep -E '^/dev/'
    
    # Check memory usage
    echo "🧠 Checking memory usage..."
    free -h
    
    # Check running processes
    echo "⚙️ Top processes by memory:"
    ps aux --sort=-%mem | head -10
    
    echo "✅ Maintenance complete!"
  `,
  security: {
    noSudo: true,
    allowlist: ['apt', 'find', 'df', 'free', 'ps', 'grep', 'head', 'echo']
  },
  progress: {
    enabled: true,
    interval: 3000
  },
  output: {
    summarize: 'auto'
  }
});
```

### Data Processing Pipeline

```typescript
const processingResult = await shell_execute({
  script: `
    #!/bin/bash
    set -eo pipefail
    
    INPUT_DIR="$1"
    OUTPUT_DIR="$2"
    
    echo "📊 Processing data pipeline..."
    echo "Input: $INPUT_DIR"
    echo "Output: $OUTPUT_DIR"
    
    # Create output directory
    mkdir -p "$OUTPUT_DIR"
    
    # Process CSV files
    echo "📈 Processing CSV files..."
    for csv in "$INPUT_DIR"/*.csv; do
      if [ -f "$csv" ]; then
        basename_file=$(basename "$csv" .csv)
        echo "Processing: $basename_file"
        
        # Data cleaning and transformation
        python3 -c "
import pandas as pd
df = pd.read_csv('$csv')
df_clean = df.dropna().drop_duplicates()
df_clean.to_csv('$OUTPUT_DIR/${basename_file}_clean.csv', index=False)
print(f'Processed {len(df)} -> {len(df_clean)} rows')
        "
      fi
    done
    
    # Generate summary report
    echo "📋 Generating summary report..."
    echo "Processing complete at $(date)" > "$OUTPUT_DIR/summary.txt"
    echo "Files processed: $(ls -1 "$OUTPUT_DIR"/*_clean.csv | wc -l)" >> "$OUTPUT_DIR/summary.txt"
    
    echo "✅ Pipeline complete!"
    cat "$OUTPUT_DIR/summary.txt"
  `,
  env: {
    PYTHONPATH: '/usr/local/lib/python3.9/site-packages'
  },
  progress: {
    enabled: true,
    markers: ['Processing CSV files', 'Generating summary report']
  },
  output: {
    summarize: 'auto',
    keepRaw: true // Keep raw output for debugging
  },
  tokenTracking: {
    enabled: true
  }
});
```

## Management Functions

### Monitor Active Sessions

```typescript
import { getActiveSessions } from './tools/shell/code-agent-shell';

const sessions = getActiveSessions();
sessions.forEach(session => {
  console.log(`Session ${session.sessionId}: ${session.duration}ms`);
});
```

### Kill All Sessions

```typescript
import { killAllSessions } from './tools/shell/code-agent-shell';

const result = killAllSessions();
console.log(`Killed ${result.killed} sessions`);
```

### Execution Statistics

```typescript
import { getExecutionStats } from './tools/shell/code-agent-shell';

const stats = getExecutionStats();
console.log(`Success rate: ${(stats.successRate * 100).toFixed(1)}%`);
console.log(`Average duration: ${stats.avgDuration.toFixed(0)}ms`);
console.log(`Average tokens: ${stats.avgTokenUsage.toFixed(0)}`);
```

## Security Best Practices

1. **Use Command Allowlists**: Restrict to only necessary commands
2. **Enable noSudo**: Prevent privilege escalation
3. **Set Script Size Limits**: Prevent resource exhaustion
4. **Monitor Token Usage**: Track and budget token consumption
5. **Review Warnings**: Always check security warnings in results
6. **Validate Input**: Sanitize any user-provided script content
7. **Use Timeouts**: Prevent runaway processes

## Error Handling

```typescript
try {
  const result = await shell_execute({
    script: complexScript,
    timeout: 30000
  });
  
  if (!result.success) {
    console.error(`Script failed with exit code: ${result.exitCode}`);
    console.error(`Error: ${result.error}`);
  }
  
  // Check warnings
  if (result.warnings?.length) {
    console.warn('Security warnings:', result.warnings);
  }
  
  // Handle timeout
  if (result.error === 'Process timed out') {
    console.error('Script exceeded timeout limit');
  }
  
} catch (error) {
  console.error('Shell execution error:', error.message);
}
```

## Integration with SuperClaw

The CodeAgent shell tool is automatically registered in the SuperClaw tool registry:

```typescript
// Available through registry
import { getToolRegistry } from './tools/registry';

const registry = getToolRegistry();
const tool = registry.get('shell_execute');
await registry.execute('shell_execute', options, context);
```

## Testing

Run the comprehensive test suite:

```bash
npm test src/tools/shell/code-agent-shell.test.ts
```

Tests cover:
- Basic execution scenarios
- Security validation
- Progress reporting
- Token tracking
- Output summarization
- Error handling
- Session management
- Complex multi-step operations

## Performance Considerations

- **Script Size**: Keep scripts under 10KB for optimal performance
- **Output Size**: Large outputs are automatically summarized
- **Token Budget**: Monitor token usage to control API costs
- **Timeout Settings**: Balance between operation needs and resource protection
- **Progress Intervals**: Don't set progress reporting too frequently

## Migration from Traditional Shell

**Before:**
```typescript
const ls = await exec('ls -la');
const grep = await exec('grep pattern file.txt');
const wc = await exec('wc -l output.txt');
// Process 3 separate results
```

**After:**
```typescript
const result = await shell_execute({
  script: `
    ls -la
    grep pattern file.txt
    wc -l output.txt
  `
});
// Process single summarized result
```

## Troubleshooting

**Common Issues:**

1. **Permission Denied**: Enable appropriate commands in allowlist
2. **Timeout**: Increase timeout value or optimize script
3. **Large Output**: Enable summarization or increase maxSize
4. **Token Budget**: Increase budgetLimit or optimize script
5. **Security Warnings**: Review and address flagged operations

**Debug Mode:**

```typescript
const result = await shell_execute({
  script: debugScript,
  output: { 
    keepRaw: true,
    summarize: 'off'
  }
});

console.log('Raw stdout:', result.rawOutput?.stdout);
console.log('Raw stderr:', result.rawOutput?.stderr);
```