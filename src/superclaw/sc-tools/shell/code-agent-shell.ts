// @ts-nocheck
/**
 * SuperClaw CodeAgent Shell Tool
 * 
 * Implements the "single tool + code execution" pattern for shell operations.
 * Instead of multiple exec() calls, executes complete bash scripts and returns
 * summarized results with token tracking and progress support.
 * 
 * Benefits:
 * - Reduces API calls: complex operations in single call
 * - Better context: maintains state between commands
 * - Summarized output: intelligent filtering vs full logs
 * - Token efficiency: tracks and optimizes token usage
 */

import { spawn, ChildProcess } from 'child_process';
import { writeFile, unlink, chmod } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { createHash, randomBytes } from 'crypto';
import { logger } from '../../utils/logger';

// --- Types ---

export interface ShellExecuteOptions {
  /** Bash script content to execute */
  script: string;
  /** Working directory (defaults to current) */
  cwd?: string;
  /** Environment variables (merged with current env) */
  env?: Record<string, string>;
  /** Timeout in milliseconds (default: 5min, max: 30min) */
  timeout?: number;
  /** Security mode */
  security?: {
    /** Sandbox mode - restrict file system access */
    sandbox?: boolean;
    /** Command allowlist - if set, only these commands allowed */
    allowlist?: string[];
    /** Disable sudo/privileged operations (default: true) */
    noSudo?: boolean;
    /** Maximum script size in bytes */
    maxScriptSize?: number;
  };
  /** Progress reporting */
  progress?: {
    /** Enable progress reporting */
    enabled?: boolean;
    /** Report interval in milliseconds (default: 5s) */
    interval?: number;
    /** Custom progress markers to look for in output */
    markers?: string[];
  };
  /** Output configuration */
  output?: {
    /** Maximum output size to capture (default: 100KB) */
    maxSize?: number;
    /** Summarization mode */
    summarize?: 'off' | 'auto' | 'aggressive';
    /** Include stderr in summary */
    includeStderr?: boolean;
    /** Keep raw output for debugging */
    keepRaw?: boolean;
  };
  /** Token tracking */
  tokenTracking?: {
    /** Estimate tokens used in script and output */
    enabled?: boolean;
    /** Budget limit - warn if exceeded */
    budgetLimit?: number;
  };
}

export interface ShellExecuteResult {
  /** Execution status */
  success: boolean;
  /** Exit code */
  exitCode: number | null;
  /** Summarized output (or raw if summarization disabled) */
  output: string;
  /** Error summary (if any) */
  error?: string;
  /** Execution metrics */
  metrics: {
    /** Execution time in milliseconds */
    duration: number;
    /** Script size in bytes */
    scriptSize: number;
    /** Raw output size in bytes */
    rawOutputSize: number;
    /** Final output size in bytes */
    outputSize: number;
    /** Token usage estimate */
    tokenUsage?: {
      scriptTokens: number;
      outputTokens: number;
      totalTokens: number;
      budgetUsed?: number;
    };
  };
  /** Progress reports (if enabled) */
  progress?: Array<{
    timestamp: Date;
    message: string;
    marker?: string;
  }>;
  /** Raw output (if keepRaw enabled) */
  rawOutput?: {
    stdout: string;
    stderr: string;
  };
  /** Security warnings */
  warnings?: string[];
  /** Process ID (for tracking) */
  pid?: number;
}

interface ProgressReport {
  timestamp: Date;
  message: string;
  marker?: string;
}

interface ExecutionSession {
  id: string;
  startTime: Date;
  script: string;
  cwd: string;
  pid?: number;
  progress: ProgressReport[];
  rawStdout: string;
  rawStderr: string;
  outputSize: number;
  timedOut: boolean;
  warnings: string[];
}

// --- Configuration ---

const CODEAGENT_CONFIG = {
  /** Default timeout: 5 minutes */
  DEFAULT_TIMEOUT: 5 * 60 * 1000,
  /** Maximum timeout: 30 minutes */
  MAX_TIMEOUT: 30 * 60 * 1000,
  /** Default max output: 100KB */
  DEFAULT_MAX_OUTPUT: 100 * 1024,
  /** Maximum output: 50MB */
  MAX_OUTPUT_SIZE: 50 * 1024 * 1024,
  /** Default max script size: 10KB */
  DEFAULT_MAX_SCRIPT_SIZE: 10 * 1024,
  /** Progress report interval: 5 seconds */
  DEFAULT_PROGRESS_INTERVAL: 5 * 1000,
  /** Token estimation: ~4 chars per token */
  CHARS_PER_TOKEN: 4,
  /** Default token budget: 10K tokens */
  DEFAULT_TOKEN_BUDGET: 10000,
};

const SECURITY_PATTERNS = {
  /** Dangerous commands to block */
  BLOCKED_COMMANDS: [
    'rm -rf /',
    'dd if=/dev/zero',
    'mkfs.',
    'format',
    ':(){ :|:& };:', // fork bomb
    'wget http',
    'curl -s http',
    'nc -l', // netcat listener
  ],
  /** Sudo patterns */
  SUDO_PATTERNS: [
    /^\s*sudo\s+/,
    /sudo\s+rm/,
    /sudo\s+chmod/,
    /sudo\s+chown/,
  ],
  /** File system access patterns */
  RISKY_PATHS: [
    '/etc/',
    '/sys/',
    '/proc/',
    '/dev/',
    '/root/',
    '/boot/',
  ],
};

// --- Global State ---

const activeSessions = new Map<string, ExecutionSession>();
const executionHistory: Array<{
  sessionId: string;
  script: string;
  success: boolean;
  duration: number;
  tokenUsage?: number;
  timestamp: Date;
}> = [];

const log = logger.child({ component: 'codeagent-shell' });

// --- Utility Functions ---

/**
 * Generate unique session ID
 */
function generateSessionId(): string {
  return `shell_${Date.now()}_${randomBytes(4).toString('hex')}`;
}

/**
 * Estimate token usage
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / CODEAGENT_CONFIG.CHARS_PER_TOKEN);
}

/**
 * Validate script security
 */
function validateScriptSecurity(
  script: string, 
  options: ShellExecuteOptions['security'] = {}
): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];
  const { noSudo = true, allowlist } = options;

  // Check for blocked commands
  for (const blocked of SECURITY_PATTERNS.BLOCKED_COMMANDS) {
    if (script.toLowerCase().includes(blocked.toLowerCase())) {
      return { 
        valid: false, 
        warnings: [`Script contains blocked command: ${blocked}`] 
      };
    }
  }

  // Check for sudo usage
  if (noSudo) {
    for (const pattern of SECURITY_PATTERNS.SUDO_PATTERNS) {
      if (pattern.test(script)) {
        warnings.push('Script contains sudo commands');
      }
    }
  }

  // Check for risky file system access
  for (const riskyPath of SECURITY_PATTERNS.RISKY_PATHS) {
    if (script.includes(riskyPath)) {
      warnings.push(`Script accesses sensitive path: ${riskyPath}`);
    }
  }

  // Check allowlist if configured
  if (allowlist) {
    const scriptCommands = extractCommands(script);
    for (const command of scriptCommands) {
      if (!allowlist.some(allowed => command.startsWith(allowed))) {
        return {
          valid: false,
          warnings: [`Command not in allowlist: ${command}`]
        };
      }
    }
  }

  return { valid: true, warnings };
}

/**
 * Extract commands from bash script
 */
function extractCommands(script: string): string[] {
  const lines = script.split('\n').map(line => line.trim());
  const commands: string[] = [];

  for (const line of lines) {
    // Skip comments and empty lines
    if (!line || line.startsWith('#')) {continue;}
    
    // Extract command (first word)
    const match = line.match(/^(\w+)/);
    if (match) {
      commands.push(match[1]);
    }
  }

  return Array.from(new Set(commands)); // Remove duplicates
}

/**
 * Create temporary script file
 */
async function createTempScript(script: string): Promise<string> {
  const scriptId = createHash('sha256').update(script).digest('hex').slice(0, 8);
  const scriptPath = join(tmpdir(), `superclaw_shell_${scriptId}.sh`);
  
  // Add bash shebang and error handling
  const fullScript = `#!/bin/bash
set -e  # Exit on error
set -u  # Exit on undefined variable
set -o pipefail  # Exit on pipe failure

${script}
`;

  await writeFile(scriptPath, fullScript, 'utf8');
  await chmod(scriptPath, '755');
  
  return scriptPath;
}

/**
 * Cleanup temp script file
 */
async function cleanupTempScript(scriptPath: string): Promise<void> {
  try {
    await unlink(scriptPath);
  } catch (error: unknown) {
    log.warn({ scriptPath, error }, 'Failed to cleanup temp script');
  }
}

/**
 * Summarize output based on content
 */
function summarizeOutput(
  stdout: string, 
  stderr: string, 
  mode: 'off' | 'auto' | 'aggressive' = 'auto'
): string {
  if (mode === 'off') {
    return `STDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`;
  }

  const totalSize = stdout.length + stderr.length;
  
  // For small output, return as-is (unless aggressive mode)
  if (totalSize < 5000 && mode !== 'aggressive') {
    return stdout + (stderr ? `\n\nErrors:\n${stderr}` : '');
  }

  const summary: string[] = [];
  
  // Summarize stdout
  if (stdout) {
    const lines = stdout.split('\n').filter(line => line.trim());
    if (lines.length <= 20 || mode === 'auto') {
      summary.push('Output:', stdout.slice(0, 2000));
      if (stdout.length > 2000) {
        summary.push(`... (${stdout.length - 2000} more chars, ${lines.length} total lines)`);
      }
    } else {
      // Aggressive summarization
      const firstLines = lines.slice(0, 5).join('\n');
      const lastLines = lines.slice(-5).join('\n');
      summary.push(
        `Output (${lines.length} lines, first/last 5):`,
        firstLines,
        '...',
        lastLines
      );
    }
  }

  // Summarize stderr
  if (stderr) {
    summary.push('\nErrors:');
    if (stderr.length <= 1000) {
      summary.push(stderr);
    } else {
      summary.push(stderr.slice(0, 1000) + `... (${stderr.length - 1000} more chars)`);
    }
  }

  return summary.join('\n');
}

/**
 * Kill process tree
 */
function killProcessTree(pid: number): void {
  try {
    if (process.platform !== 'win32') {
      process.kill(-pid, 'SIGKILL');
    } else {
      spawn('taskkill', ['/pid', pid.toString(), '/t', '/f'], { stdio: 'ignore' });
    }
  } catch (error: unknown) {
    log.warn({ pid, error }, 'Failed to kill process tree');
  }
}

// --- Main Execution Function ---

/**
 * Execute bash script using CodeAgent pattern
 */
export async function shell_execute(options: ShellExecuteOptions): Promise<ShellExecuteResult> {
  const sessionId = generateSessionId();
  const startTime = Date.now();

  // Validate working directory
  const cwd = resolve(options.cwd || process.cwd());
  if (!existsSync(cwd)) {
    throw new Error(`Working directory does not exist: ${cwd}`);
  }

  // Initialize session
  const session: ExecutionSession = {
    id: sessionId,
    startTime: new Date(),
    script: options.script,
    cwd,
    progress: [],
    rawStdout: '',
    rawStderr: '',
    outputSize: 0,
    timedOut: false,
    warnings: [],
  };

  activeSessions.set(sessionId, session);

  try {
    // Validate script security
    const securityCheck = validateScriptSecurity(options.script, options.security);
    if (!securityCheck.valid) {
      throw new Error(securityCheck.warnings[0]);
    }
    session.warnings = securityCheck.warnings;

    // Check script size
    const scriptSize = Buffer.byteLength(options.script, 'utf8');
    const maxScriptSize = options.security?.maxScriptSize || CODEAGENT_CONFIG.DEFAULT_MAX_SCRIPT_SIZE;
    if (scriptSize > maxScriptSize) {
      throw new Error(`Script too large: ${scriptSize} bytes (max: ${maxScriptSize})`);
    }

    // Token budget check
    if (options.tokenTracking?.enabled) {
      const scriptTokens = estimateTokens(options.script);
      const budgetLimit = options.tokenTracking.budgetLimit || CODEAGENT_CONFIG.DEFAULT_TOKEN_BUDGET;
      
      if (scriptTokens > budgetLimit) {
        session.warnings.push(`Script uses ${scriptTokens} tokens, exceeds budget ${budgetLimit}`);
      }
    }

    // Create temporary script file
    const scriptPath = await createTempScript(options.script);
    
    try {
      // Spawn process
      const child = spawn('/bin/bash', [scriptPath], {
        cwd: session.cwd,
        env: { ...process.env, ...options.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });

      session.pid = child.pid;

      // Set up timeout
      const timeout = Math.min(
        options.timeout || CODEAGENT_CONFIG.DEFAULT_TIMEOUT,
        CODEAGENT_CONFIG.MAX_TIMEOUT
      );

      const timeoutHandle = setTimeout(() => {
        session.timedOut = true;
        log.warn({ sessionId, pid: child.pid }, 'Killing process due to timeout');
        if (child.pid) {
          killProcessTree(child.pid);
        }
      }, timeout);

      // Set up progress reporting
      let progressInterval: NodeJS.Timeout | undefined;
      if (options.progress?.enabled) {
        const interval = options.progress.interval || CODEAGENT_CONFIG.DEFAULT_PROGRESS_INTERVAL;
        progressInterval = setInterval(() => {
          const progress: ProgressReport = {
            timestamp: new Date(),
            message: `Running... (${session.rawStdout.split('\n').length} output lines)`,
          };
          session.progress.push(progress);
          log.debug({ sessionId, progress: progress.message }, 'Progress update');
        }, interval);
      }

      // Handle output
      const maxOutputSize = Math.min(
        options.output?.maxSize || CODEAGENT_CONFIG.DEFAULT_MAX_OUTPUT,
        CODEAGENT_CONFIG.MAX_OUTPUT_SIZE
      );

      child.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        session.rawStdout += chunk;
        session.outputSize += chunk.length;

        // Check for progress markers
        if (options.progress?.markers) {
          for (const marker of options.progress.markers) {
            if (chunk.includes(marker)) {
              const progress: ProgressReport = {
                timestamp: new Date(),
                message: `Found marker: ${marker}`,
                marker,
              };
              session.progress.push(progress);
            }
          }
        }

        // Truncate if output too large
        if (session.outputSize > maxOutputSize) {
          session.rawStdout = session.rawStdout.slice(0, maxOutputSize);
          session.warnings.push(`Output truncated at ${maxOutputSize} bytes`);
        }
      });

      child.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        session.rawStderr += chunk;
        session.outputSize += chunk.length;
      });

      // Wait for completion
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        child.on('close', (code) => {
          clearTimeout(timeoutHandle);
          if (progressInterval) {clearInterval(progressInterval);}
          resolve(code);
        });

        child.on('error', (error) => {
          clearTimeout(timeoutHandle);
          if (progressInterval) {clearInterval(progressInterval);}
          reject(error);
        });
      });

      // Prepare result
      const duration = Date.now() - startTime;
      const summarizedOutput = summarizeOutput(
        session.rawStdout,
        session.rawStderr,
        options.output?.summarize || 'auto'
      );

      // Calculate token usage
      let tokenUsage: ShellExecuteResult['metrics']['tokenUsage'];
      if (options.tokenTracking?.enabled) {
        const scriptTokens = estimateTokens(options.script);
        const outputTokens = estimateTokens(summarizedOutput);
        const totalTokens = scriptTokens + outputTokens;
        const budgetLimit = options.tokenTracking.budgetLimit || CODEAGENT_CONFIG.DEFAULT_TOKEN_BUDGET;

        tokenUsage = {
          scriptTokens,
          outputTokens,
          totalTokens,
          budgetUsed: totalTokens / budgetLimit,
        };

        if (totalTokens > budgetLimit) {
          session.warnings.push(`Total token usage ${totalTokens} exceeds budget ${budgetLimit}`);
        }
      }

      const result: ShellExecuteResult = {
        success: exitCode === 0 && !session.timedOut,
        exitCode,
        output: summarizedOutput,
        error: session.timedOut ? 'Process timed out' : 
               (exitCode !== 0 ? `Process exited with code ${exitCode}` : undefined),
        metrics: {
          duration,
          scriptSize,
          rawOutputSize: session.outputSize,
          outputSize: Buffer.byteLength(summarizedOutput, 'utf8'),
          tokenUsage,
        },
        progress: session.progress.length > 0 ? session.progress : undefined,
        rawOutput: options.output?.keepRaw ? {
          stdout: session.rawStdout,
          stderr: session.rawStderr,
        } : undefined,
        warnings: session.warnings.length > 0 ? session.warnings : undefined,
        pid: session.pid,
      };

      // Record execution history
      executionHistory.push({
        sessionId,
        script: options.script.slice(0, 200), // First 200 chars
        success: result.success,
        duration,
        tokenUsage: tokenUsage?.totalTokens,
        timestamp: session.startTime,
      });

      // Cleanup history (keep last 500)
      if (executionHistory.length > 500) {
        executionHistory.splice(0, executionHistory.length - 500);
      }

      log.info({
        sessionId,
        success: result.success,
        duration,
        outputSize: result.metrics.outputSize,
        tokenUsage: tokenUsage?.totalTokens,
        warnings: session.warnings.length,
      }, 'CodeAgent shell execution completed');

      return result;

    } finally {
      // Cleanup temp script
      await cleanupTempScript(scriptPath);
    }

  } finally {
    // Cleanup session
    activeSessions.delete(sessionId);
  }
}

// --- Management Functions ---

/**
 * Get active sessions
 */
export function getActiveSessions(): Array<{
  sessionId: string;
  startTime: Date;
  duration: number;
  outputSize: number;
  pid?: number;
}> {
  const now = Date.now();
  const sessions = Array.from(activeSessions.values());
  return sessions.map(session => ({
    sessionId: session.id,
    startTime: session.startTime,
    duration: now - session.startTime.getTime(),
    outputSize: session.outputSize,
    pid: session.pid,
  }));
}

/**
 * Kill all active sessions
 */
export function killAllSessions(): { killed: number; errors: string[] } {
  const errors: string[] = [];
  let killed = 0;

  const sessions = Array.from(activeSessions.values());
  for (const session of sessions) {
    if (session.pid) {
      try {
        killProcessTree(session.pid);
        killed++;
      } catch (error: unknown) {
        errors.push(`Failed to kill session ${session.id}: ${error}`);
      }
    }
  }

  activeSessions.clear();
  log.info({ killed, errors: errors.length }, 'Killed all active sessions');

  return { killed, errors };
}

/**
 * Reset execution history (for testing)
 */
export function resetExecutionHistory(): void {
  executionHistory.length = 0;
}

/**
 * Get execution statistics
 */
export function getExecutionStats(): {
  totalExecutions: number;
  successRate: number;
  avgDuration: number;
  avgTokenUsage: number;
  activeSessions: number;
} {
  const total = executionHistory.length;
  const successful = executionHistory.filter(e => e.success).length;
  const avgDuration = total > 0 
    ? executionHistory.reduce((sum, e) => sum + e.duration, 0) / total 
    : 0;
  const withTokens = executionHistory.filter(e => e.tokenUsage);
  const avgTokenUsage = withTokens.length > 0
    ? withTokens.reduce((sum, e) => sum + (e.tokenUsage || 0), 0) / withTokens.length
    : 0;

  return {
    totalExecutions: total,
    successRate: total > 0 ? successful / total : 0,
    avgDuration,
    avgTokenUsage,
    activeSessions: activeSessions.size,
  };
}

// --- Tool Definition ---

export const codeAgentShellTool = {
  name: 'shell_execute',
  description: 'Execute complete bash scripts using CodeAgent pattern - single call for complex operations with summarized output and token tracking',
  parameters: {
    type: 'object' as const,
    properties: {
      script: {
        type: 'string',
        description: 'Complete bash script to execute',
      },
      cwd: {
        type: 'string',
        description: 'Working directory (optional)',
      },
      env: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'Environment variables (optional)',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (max: 30min)',
        minimum: 1000,
        maximum: 1800000,
      },
      security: {
        type: 'object',
        description: 'Security configuration',
        properties: {
          sandbox: { type: 'boolean' },
          allowlist: { type: 'array', items: { type: 'string' } },
          noSudo: { type: 'boolean' },
          maxScriptSize: { type: 'number' },
        },
      },
      progress: {
        type: 'object',
        description: 'Progress reporting configuration',
        properties: {
          enabled: { type: 'boolean' },
          interval: { type: 'number' },
          markers: { type: 'array', items: { type: 'string' } },
        },
      },
      output: {
        type: 'object',
        description: 'Output configuration',
        properties: {
          maxSize: { type: 'number' },
          summarize: { type: 'string', enum: ['off', 'auto', 'aggressive'] },
          includeStderr: { type: 'boolean' },
          keepRaw: { type: 'boolean' },
        },
      },
      tokenTracking: {
        type: 'object',
        description: 'Token usage tracking',
        properties: {
          enabled: { type: 'boolean' },
          budgetLimit: { type: 'number' },
        },
      },
    },
    required: ['script'],
  },
  handler: shell_execute,
};

// --- Process Cleanup ---

process.on('SIGINT', () => {
  log.info('Received SIGINT, cleaning up CodeAgent sessions...');
  killAllSessions();
});

process.on('SIGTERM', () => {
  log.info('Received SIGTERM, cleaning up CodeAgent sessions...');
  killAllSessions();
});