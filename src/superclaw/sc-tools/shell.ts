/**
 * SuperClaw Shell Execution Tool
 * 
 * Safe shell command execution with:
 * - Timeout protection
 * - Output truncation
 * - Process management
 * - Command logging
 * - Optional allowlist/blocklist
 */

import { spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { join, resolve } from 'path';
import { existsSync } from 'fs';
import { logger } from '../utils/logger';

// --- Types ---

export interface ShellExecOptions {
  /** Command to execute */
  command: string;
  /** Arguments (optional, can be included in command) */
  args?: string[];
  /** Working directory (defaults to current) */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Timeout in milliseconds (default: 30s, max: 5min) */
  timeout?: number;
  /** Maximum output size in bytes (default: 50KB) */
  maxOutputSize?: number;
  /** Capture stderr separately (default: true) */
  captureStderr?: boolean;
  /** Input to send to stdin */
  input?: string;
}

export interface ShellExecResult {
  /** Exit code */
  exitCode: number | null;
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
  /** Execution time in milliseconds */
  duration: number;
  /** Whether output was truncated */
  truncated: boolean;
  /** Whether process was killed due to timeout */
  timedOut: boolean;
  /** Process ID (for tracking) */
  pid?: number;
}

interface ExecutionLog {
  command: string;
  cwd: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  exitCode?: number | null;
  outputSize: number;
  timedOut: boolean;
  pid?: number;
  user?: string;
}

// --- Configuration ---

const SHELL_CONFIG = {
  /** Default timeout: 30 seconds */
  DEFAULT_TIMEOUT: 30 * 1000,
  /** Maximum timeout: 5 minutes */
  MAX_TIMEOUT: 5 * 60 * 1000,
  /** Default max output: 50KB */
  DEFAULT_MAX_OUTPUT: 50 * 1024,
  /** Maximum output: 10MB */
  MAX_OUTPUT_SIZE: 10 * 1024 * 1024,
  /** Command allowlist (if set, only these commands allowed) */
  ALLOWLIST: process.env.SHELL_ALLOWLIST?.split(',').map(c => c.trim()) || null,
  /** Command blocklist (these commands are forbidden) */
  BLOCKLIST: process.env.SHELL_BLOCKLIST?.split(',').map(c => c.trim()) || [
    'rm -rf /',
    'dd if=/dev/zero',
    'fork bomb',
    ':(){ :|:& };:',
    'sudo rm -rf',
    'mkfs.',
    'format c:',
  ],
  /** Log all executions */
  LOG_EXECUTIONS: process.env.SHELL_LOG_EXECUTIONS !== 'false',
};

// --- Global State ---

const activeProcesses = new Map<number, ChildProcess>();
const executionHistory: ExecutionLog[] = [];
const log = logger.child({ component: 'shell-tool' });

// --- Utility Functions ---

/**
 * Check if a command is allowed based on allowlist/blocklist
 */
function isCommandAllowed(command: string): { allowed: boolean; reason?: string } {
  const fullCommand = command.toLowerCase().trim();
  
  // Check blocklist first
  if (SHELL_CONFIG.BLOCKLIST) {
    for (const blocked of SHELL_CONFIG.BLOCKLIST) {
      if (fullCommand.includes(blocked.toLowerCase())) {
        return { allowed: false, reason: `Command contains blocked pattern: ${blocked}` };
      }
    }
  }
  
  // Check allowlist if configured
  if (SHELL_CONFIG.ALLOWLIST) {
    const commandStart = fullCommand.split(' ')[0];
    if (!SHELL_CONFIG.ALLOWLIST.includes(commandStart)) {
      return { allowed: false, reason: `Command not in allowlist: ${commandStart}` };
    }
  }
  
  return { allowed: true };
}

/**
 * Validate and sanitize execution options
 */
function validateOptions(options: ShellExecOptions): {
  valid: boolean;
  error?: string;
  sanitized?: Required<Omit<ShellExecOptions, 'args' | 'input'>> & { args?: string[]; input?: string };
} {
  // Check command allowlist/blocklist
  const allowCheck = isCommandAllowed(options.command);
  if (!allowCheck.allowed) {
    return { valid: false, error: allowCheck.reason };
  }
  
  // Validate timeout
  const timeout = Math.min(
    options.timeout || SHELL_CONFIG.DEFAULT_TIMEOUT,
    SHELL_CONFIG.MAX_TIMEOUT
  );
  
  // Validate max output size
  const maxOutputSize = Math.min(
    options.maxOutputSize || SHELL_CONFIG.DEFAULT_MAX_OUTPUT,
    SHELL_CONFIG.MAX_OUTPUT_SIZE
  );
  
  // Validate working directory
  const cwd = options.cwd ? resolve(options.cwd) : process.cwd();
  if (!existsSync(cwd)) {
    return { valid: false, error: `Working directory does not exist: ${cwd}` };
  }
  
  return {
    valid: true,
    sanitized: {
      command: options.command,
      args: options.args,
      cwd,
      // @ts-expect-error - Post-Merge Reconciliation
      env: { ...process.env, ...options.env },
      timeout,
      maxOutputSize,
      captureStderr: options.captureStderr ?? true,
      input: options.input,
    }
  };
}

/**
 * Kill a process and its children
 */
function killProcessTree(pid: number, signal: NodeJS.Signals = 'SIGTERM'): void {
  try {
    // On Unix-like systems, kill the process group
    if (process.platform !== 'win32') {
      process.kill(-pid, signal);
    } else {
      // On Windows, use taskkill
      spawn('taskkill', ['/pid', pid.toString(), '/t', '/f'], { stdio: 'ignore' });
    }
  } catch (error: unknown) {
    log.warn({ pid, error }, 'Failed to kill process');
  }
}

/**
 * Record execution in history
 */
function recordExecution(execution: ExecutionLog): void {
  if (!SHELL_CONFIG.LOG_EXECUTIONS) return;
  
  executionHistory.push(execution);
  
  // Keep only last 1000 executions
  if (executionHistory.length > 1000) {
    executionHistory.splice(0, executionHistory.length - 1000);
  }
  
  log.info({
    command: execution.command.slice(0, 100),
    cwd: execution.cwd,
    duration: execution.duration,
    exitCode: execution.exitCode,
    outputSize: execution.outputSize,
    timedOut: execution.timedOut,
    pid: execution.pid,
  }, 'Shell command executed');
}

// --- Main Execution Function ---

/**
 * Execute a shell command safely
 */
export async function exec(options: ShellExecOptions): Promise<ShellExecResult> {
  const startTime = Date.now();
  
  // Validate options
  const validation = validateOptions(options);
  if (!validation.valid || !validation.sanitized) {
    throw new Error(`Invalid shell execution options: ${validation.error}`);
  }
  
  const opts = validation.sanitized;
  
  // Parse command and arguments
  let command: string;
  let args: string[];
  
  if (opts.args) {
    command = opts.command;
    args = opts.args;
  } else {
    // Split command string into command + args
    const parts = opts.command.trim().split(/\s+/);
    command = parts[0];
    args = parts.slice(1);
  }
  
  log.debug({ command, args, cwd: opts.cwd }, 'Executing shell command');
  
  return new Promise<ShellExecResult>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let outputSize = 0;
    let truncated = false;
    let timedOut = false;
    
    // Spawn process
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32', // Enable process group on Unix
    });
    
    const pid = child.pid;
    if (pid) {
      activeProcesses.set(pid, child);
    }
    
    // Set up timeout
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      if (pid) {
        log.warn({ pid, command: opts.command }, 'Killing process due to timeout');
        killProcessTree(pid, 'SIGKILL');
      }
    }, opts.timeout);
    
    // Handle stdout
    child.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      if (outputSize + chunk.length > opts.maxOutputSize) {
        truncated = true;
        const remaining = opts.maxOutputSize - outputSize;
        if (remaining > 0) {
          stdout += chunk.slice(0, remaining);
          outputSize = opts.maxOutputSize;
        }
      } else {
        stdout += chunk;
        outputSize += chunk.length;
      }
    });
    
    // Handle stderr
    child.stderr?.on('data', (data: Buffer) => {
      if (!opts.captureStderr) return;
      
      const chunk = data.toString();
      if (outputSize + chunk.length > opts.maxOutputSize) {
        truncated = true;
        const remaining = opts.maxOutputSize - outputSize;
        if (remaining > 0) {
          stderr += chunk.slice(0, remaining);
          outputSize = opts.maxOutputSize;
        }
      } else {
        stderr += chunk;
        outputSize += chunk.length;
      }
    });
    
    // Handle process completion
    child.on('close', (code, signal) => {
      clearTimeout(timeoutHandle);
      
      if (pid) {
        activeProcesses.delete(pid);
      }
      
      const duration = Date.now() - startTime;
      
      // Record execution
      const execution: ExecutionLog = {
        command: opts.command,
        cwd: opts.cwd,
        startTime: new Date(startTime),
        endTime: new Date(),
        duration,
        exitCode: code,
        outputSize,
        timedOut,
        pid,
        user: process.env.USER || process.env.USERNAME,
      };
      recordExecution(execution);
      
      const result: ShellExecResult = {
        exitCode: code,
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
        duration,
        truncated,
        timedOut,
        pid,
      };
      
      resolve(result);
    });
    
    // Handle process errors
    child.on('error', (error) => {
      clearTimeout(timeoutHandle);
      
      if (pid) {
        activeProcesses.delete(pid);
      }
      
      const duration = Date.now() - startTime;
      
      // Record failed execution
      const execution: ExecutionLog = {
        command: opts.command,
        cwd: opts.cwd,
        startTime: new Date(startTime),
        endTime: new Date(),
        duration,
        exitCode: null,
        outputSize,
        timedOut,
        pid,
        user: process.env.USER || process.env.USERNAME,
      };
      recordExecution(execution);
      
      reject(new Error(`Failed to execute command: ${(error as Error).message}`));
    });
    
    // Send input if provided
    if (opts.input && child.stdin) {
      child.stdin.write(opts.input);
      child.stdin.end();
    }
  });
}

// --- Management Functions ---

/**
 * Kill all active shell processes
 */
export function killAllProcesses(): { killed: number; errors: Array<{ pid: number; error: string }> } {
  const killed: number[] = [];
  const errors: Array<{ pid: number; error: string }> = [];
  
  for (const [pid, child] of activeProcesses.entries()) {
    try {
      killProcessTree(pid, 'SIGKILL');
      child.kill('SIGKILL');
      killed.push(pid);
    } catch (error: unknown) {
      errors.push({ 
        pid, 
        error: error instanceof Error ? (error as Error).message : String(error) 
      });
    }
  }
  
  activeProcesses.clear();
  
  log.info({ killed: killed.length, errors: errors.length }, 'Killed active processes');
  
  return { killed: killed.length, errors };
}

/**
 * Get active process information
 */
export function getActiveProcesses(): Array<{ pid: number; command: string; startTime: Date }> {
  const processes: Array<{ pid: number; command: string; startTime: Date }> = [];
  
  for (const execution of executionHistory) {
    if (execution.pid && activeProcesses.has(execution.pid)) {
      processes.push({
        pid: execution.pid,
        command: execution.command,
        startTime: execution.startTime,
      });
    }
  }
  
  return processes;
}

/**
 * Get execution history
 */
export function getExecutionHistory(limit = 50): ExecutionLog[] {
  return executionHistory.slice(-limit);
}

/**
 * Get shell tool statistics
 */
export function getStats(): {
  activeProcesses: number;
  totalExecutions: number;
  avgDuration: number;
  successRate: number;
  timeoutRate: number;
} {
  const total = executionHistory.length;
  const successful = executionHistory.filter(e => e.exitCode === 0).length;
  const timedOut = executionHistory.filter(e => e.timedOut).length;
  const avgDuration = total > 0 
    ? executionHistory.reduce((sum, e) => sum + (e.duration || 0), 0) / total 
    : 0;
  
  return {
    activeProcesses: activeProcesses.size,
    totalExecutions: total,
    avgDuration,
    successRate: total > 0 ? successful / total : 0,
    timeoutRate: total > 0 ? timedOut / total : 0,
  };
}

// --- Tool Definition for Registry ---

export const shellTool = {
  name: 'shell',
  description: 'Execute shell commands safely with timeout and output controls',
  parameters: {
    type: 'object' as const,
    properties: {
      command: {
        type: 'string',
        description: 'Shell command to execute',
      },
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'Command arguments (optional, can be included in command string)',
      },
      cwd: {
        type: 'string',
        description: 'Working directory (optional, defaults to current)',
      },
      env: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'Environment variables (optional)',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 30s, max: 5min)',
        minimum: 1000,
        maximum: 300000,
      },
      maxOutputSize: {
        type: 'number',
        description: 'Maximum output size in bytes (default: 50KB)',
        minimum: 1024,
        maximum: 10485760,
      },
      captureStderr: {
        type: 'boolean',
        description: 'Capture stderr separately (default: true)',
      },
      input: {
        type: 'string',
        description: 'Input to send to stdin (optional)',
      },
    },
    required: ['command'],
  },
  handler: exec,
};

// --- Process Cleanup on Exit ---

process.on('SIGINT', () => {
  log.info('Received SIGINT, cleaning up shell processes...');
  killAllProcesses();
  process.exit(0);
});

process.on('SIGTERM', () => {
  log.info('Received SIGTERM, cleaning up shell processes...');
  killAllProcesses();
  process.exit(0);
});

// Cleanup on uncaught exceptions
process.on('uncaughtException', (error) => {
  log.error({ error }, 'Uncaught exception, cleaning up shell processes...');
  killAllProcesses();
  process.exit(1);
});