/**
 * Tests for CodeAgent Shell Tool
 * 
 * Tests the shell_execute function with various scenarios:
 * - Basic script execution
 * - Security validation
 * - Progress reporting
 * - Token tracking
 * - Output summarization
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { 
  shell_execute, 
  getActiveSessions, 
  killAllSessions,
  getExecutionStats,
  resetExecutionHistory,
  type ShellExecuteOptions 
} from './code-agent-shell';

describe('CodeAgent Shell Tool', () => {
  beforeEach(() => {
    // Clear any active sessions
    killAllSessions();
  });

  afterEach(() => {
    // Clean up after each test
    killAllSessions();
  });

  describe('Basic Execution', () => {
    it('should execute simple bash script successfully', async () => {
      const options: ShellExecuteOptions = {
        script: `
          echo "Hello World"
          echo "Line 2"
          exit 0
        `,
        timeout: 5000,
      };

      const result = await shell_execute(options);

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('Hello World');
      expect(result.output).toContain('Line 2');
      expect(result.metrics.duration).toBeGreaterThan(0);
      expect(result.metrics.scriptSize).toBeGreaterThan(0);
    });

    it('should handle script execution failure', async () => {
      const options: ShellExecuteOptions = {
        script: `
          echo "This will fail"
          exit 1
        `,
        timeout: 5000,
      };

      const result = await shell_execute(options);

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain('Process exited with code 1');
      expect(result.output).toContain('This will fail');
    });

    it('should respect working directory', async () => {
      const options: ShellExecuteOptions = {
        script: 'pwd',
        cwd: '/tmp',
        timeout: 5000,
      };

      const result = await shell_execute(options);

      expect(result.success).toBe(true);
      expect(result.output.trim()).toBe('/tmp');
    });

    it('should pass environment variables', async () => {
      const options: ShellExecuteOptions = {
        script: 'echo $TEST_VAR',
        env: { TEST_VAR: 'test_value_123' },
        timeout: 5000,
      };

      const result = await shell_execute(options);

      expect(result.success).toBe(true);
      expect(result.output.trim()).toBe('test_value_123');
    });
  });

  describe('Security Validation', () => {
    it('should block dangerous commands', async () => {
      const options: ShellExecuteOptions = {
        script: 'rm -rf /',
        timeout: 5000,
      };

      await expect(shell_execute(options)).rejects.toThrow(
        'Script contains blocked command'
      );
    });

    it('should warn about sudo usage', async () => {
      const options: ShellExecuteOptions = {
        script: 'sudo echo "testing"',
        security: { noSudo: true },
        timeout: 5000,
      };

      const result = await shell_execute(options);

      expect(result.warnings).toBeDefined();
      expect(result.warnings).toContain('Script contains sudo commands');
    });

    it('should enforce command allowlist', async () => {
      const options: ShellExecuteOptions = {
        script: 'cat /etc/passwd',
        security: { allowlist: ['echo', 'ls'] },
        timeout: 5000,
      };

      await expect(shell_execute(options)).rejects.toThrow(
        'Command not in allowlist'
      );
    });

    it('should warn about risky file access', async () => {
      const options: ShellExecuteOptions = {
        script: 'ls /etc/',
        timeout: 5000,
      };

      const result = await shell_execute(options);

      if (result.warnings) {
        expect(result.warnings.some(w => w.includes('/etc/'))).toBe(true);
      }
    });

    it('should enforce script size limits', async () => {
      const largeScript = 'echo "test"\n'.repeat(1000);
      const options: ShellExecuteOptions = {
        script: largeScript,
        security: { maxScriptSize: 100 },
        timeout: 5000,
      };

      await expect(shell_execute(options)).rejects.toThrow(
        'Script too large'
      );
    });
  });

  describe('Progress Reporting', () => {
    it('should report progress when enabled', async () => {
      const options: ShellExecuteOptions = {
        script: `
          echo "Starting task"
          sleep 0.1
          echo "Middle task"
          sleep 0.1
          echo "Finished task"
        `,
        progress: { 
          enabled: true, 
          interval: 50 // 50ms for faster testing
        },
        timeout: 5000,
      };

      const result = await shell_execute(options);

      expect(result.success).toBe(true);
      expect(result.progress).toBeDefined();
      expect(result.progress!.length).toBeGreaterThan(0);
      expect(result.progress![0].timestamp).toBeInstanceOf(Date);
    });

    it('should detect custom progress markers', async () => {
      const options: ShellExecuteOptions = {
        script: `
          echo "Starting"
          echo "PROGRESS:50%"
          echo "PROGRESS:100%"
          echo "Done"
        `,
        progress: { 
          enabled: true,
          markers: ['PROGRESS:50%', 'PROGRESS:100%']
        },
        timeout: 5000,
      };

      const result = await shell_execute(options);

      expect(result.success).toBe(true);
      expect(result.progress).toBeDefined();
      const markerReports = result.progress!.filter(p => p.marker);
      expect(markerReports.length).toBe(2);
      expect(markerReports[0].marker).toBe('PROGRESS:50%');
      expect(markerReports[1].marker).toBe('PROGRESS:100%');
    });
  });

  describe('Output Management', () => {
    it('should summarize large output automatically', async () => {
      const options: ShellExecuteOptions = {
        script: `
          for i in {1..200}; do
            echo "Line $i with some content to make it larger and exceed the 5KB threshold for automatic summarization"
          done
        `,
        output: { summarize: 'auto' },
        timeout: 5000,
      };

      const result = await shell_execute(options);

      expect(result.success).toBe(true);
      // Should be summarized since output > 5KB
      expect(result.output).toContain('200 total lines');
      expect(result.output.length).toBeLessThan(result.metrics.rawOutputSize);
    });

    it('should preserve raw output when requested', async () => {
      const options: ShellExecuteOptions = {
        script: `
          echo "stdout message"
          echo "stderr message" >&2
        `,
        output: { keepRaw: true },
        timeout: 5000,
      };

      const result = await shell_execute(options);

      expect(result.success).toBe(true);
      expect(result.rawOutput).toBeDefined();
      expect(result.rawOutput!.stdout).toContain('stdout message');
      expect(result.rawOutput!.stderr).toContain('stderr message');
    });

    it('should handle output size limits', async () => {
      const options: ShellExecuteOptions = {
        script: `
          for i in {1..1000}; do
            echo "This is a long line with lots of content to fill up space - line $i"
          done
        `,
        output: { maxSize: 1000 }, // 1KB limit
        timeout: 5000,
      };

      const result = await shell_execute(options);

      expect(result.warnings).toBeDefined();
      expect(result.warnings!.some(w => w.includes('Output truncated'))).toBe(true);
    });
  });

  describe('Token Tracking', () => {
    it('should track token usage when enabled', async () => {
      const options: ShellExecuteOptions = {
        script: `
          echo "This is a test script"
          echo "It will generate some output"
          echo "For token counting purposes"
        `,
        tokenTracking: { 
          enabled: true,
          budgetLimit: 1000 
        },
        timeout: 5000,
      };

      const result = await shell_execute(options);

      expect(result.success).toBe(true);
      expect(result.metrics.tokenUsage).toBeDefined();
      expect(result.metrics.tokenUsage!.scriptTokens).toBeGreaterThan(0);
      expect(result.metrics.tokenUsage!.outputTokens).toBeGreaterThan(0);
      expect(result.metrics.tokenUsage!.totalTokens).toBeGreaterThan(0);
      expect(result.metrics.tokenUsage!.budgetUsed).toBeGreaterThan(0);
    });

    it('should warn when token budget is exceeded', async () => {
      const largeScript = `
        echo "This is a very long script that will use many tokens"
        ${Array(100).fill('echo "Additional line to increase token count"').join('\n')}
      `;

      const options: ShellExecuteOptions = {
        script: largeScript,
        tokenTracking: { 
          enabled: true,
          budgetLimit: 10 // Very low budget
        },
        timeout: 5000,
      };

      const result = await shell_execute(options);

      expect(result.warnings).toBeDefined();
      expect(result.warnings!.some(w => w.includes('exceeds budget'))).toBe(true);
    });
  });

  describe('Timeout and Process Management', () => {
    it('should timeout long-running scripts', async () => {
      const options: ShellExecuteOptions = {
        script: 'sleep 2',
        timeout: 500, // 0.5 seconds
      };

      const result = await shell_execute(options);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Process timed out');
    });

    it('should clean up processes on timeout', async () => {
      const options: ShellExecuteOptions = {
        script: 'sleep 10',
        timeout: 100,
      };

      const beforeSessions = getActiveSessions().length;
      await shell_execute(options);
      const afterSessions = getActiveSessions().length;

      expect(afterSessions).toBe(beforeSessions);
    });
  });

  describe('Session Management', () => {
    it('should track active sessions', async () => {
      const longRunningPromise = shell_execute({
        script: 'sleep 1',
        timeout: 2000,
      });

      // Check that session is tracked while running
      await new Promise(resolve => setTimeout(resolve, 50)); // Wait a bit
      const sessions = getActiveSessions();
      expect(sessions.length).toBeGreaterThan(0);

      // Wait for completion
      await longRunningPromise;

      // Session should be cleaned up
      const finalSessions = getActiveSessions();
      expect(finalSessions.length).toBe(0);
    });

    it('should provide execution statistics', async () => {
      // Reset history to ensure clean test
      resetExecutionHistory();

      await shell_execute({
        script: 'echo "test1"',
        timeout: 5000,
      });

      await shell_execute({
        script: 'echo "test2" && exit 1',
        timeout: 5000,
      });

      const stats = getExecutionStats();
      expect(stats.totalExecutions).toBe(2);
      expect(stats.successRate).toBe(0.5); // 50%
      expect(stats.avgDuration).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle nonexistent working directory', async () => {
      const options: ShellExecuteOptions = {
        script: 'echo "test"',
        cwd: '/this/directory/does/not/exist',
        timeout: 5000,
      };

      await expect(shell_execute(options)).rejects.toThrow(
        'Working directory does not exist'
      );
    });

    it('should handle command not found', async () => {
      const options: ShellExecuteOptions = {
        script: 'nonexistentcommand123456',
        timeout: 5000,
      };

      const result = await shell_execute(options);

      expect(result.success).toBe(false);
      expect(result.exitCode).not.toBe(0);
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle multi-step operations', async () => {
      const options: ShellExecuteOptions = {
        script: `
          # Create temp directory
          TEMP_DIR=$(mktemp -d)
          echo "Created temp dir: $TEMP_DIR"
          
          # Create files
          echo "file1 content" > "$TEMP_DIR/file1.txt"
          echo "file2 content" > "$TEMP_DIR/file2.txt"
          
          # List files
          echo "Files created:"
          ls -la "$TEMP_DIR"
          
          # Process files
          for file in "$TEMP_DIR"/*.txt; do
            echo "Processing: $file"
            wc -w "$file"
          done
          
          # Cleanup
          rm -rf "$TEMP_DIR"
          echo "Cleanup complete"
        `,
        progress: { enabled: true },
        tokenTracking: { enabled: true },
        timeout: 10000,
      };

      const result = await shell_execute(options);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Created temp dir');
      expect(result.output).toContain('Files created:');
      expect(result.output).toContain('Processing:');
      expect(result.output).toContain('Cleanup complete');
      expect(result.metrics.tokenUsage).toBeDefined();
    });
  });
});