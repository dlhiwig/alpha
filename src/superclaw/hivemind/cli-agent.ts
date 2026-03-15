/**
 * CLI Agent Wrapper
 * 
 * Spawns and communicates with AI CLI tools as autonomous agents.
 * Each CLI becomes a node in the SuperClaw hivemind.
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

export type CLIType = 'claude' | 'codex' | 'gemini' | 'ollama';

export interface CLIAgentConfig {
  type: CLIType;
  id: string;
  workdir?: string;
  timeout?: number;
  env?: Record<string, string>;
}

export interface CLIResponse {
  content: string;
  exitCode: number | null;
  durationMs: number;
  truncated: boolean;
}

/**
 * CLI configurations for each tool
 */
const CLI_CONFIGS: Record<CLIType, { command: string; args: string[]; promptMode: 'stdin' | 'arg' }> = {
  claude: {
    command: 'claude',
    args: ['--print'], // Non-interactive, print mode
    promptMode: 'arg'
  },
  codex: {
    command: 'codex',
    args: ['--quiet', '--approval-mode', 'full-auto'],
    promptMode: 'arg'
  },
  gemini: {
    command: 'gemini',
    args: [],
    promptMode: 'arg'
  },
  ollama: {
    command: 'ollama',
    args: ['run', 'dolphin-llama3:70b'],
    promptMode: 'stdin'
  }
};

/**
 * CLIAgent - Wrapper for AI CLI tools
 */
export class CLIAgent extends EventEmitter {
  readonly id: string;
  readonly type: CLIType;
  private config: CLIAgentConfig;
  private process: ChildProcess | null = null;
  private buffer: string = '';
  private startTime: number = 0;

  constructor(config: CLIAgentConfig) {
    super();
    this.id = config.id;
    this.type = config.type;
    this.config = config;
  }

  /**
   * Execute a prompt and get the response
   */
  async execute(prompt: string): Promise<CLIResponse> {
    const cliConfig = CLI_CONFIGS[this.type];
    this.startTime = Date.now();
    this.buffer = '';

    return new Promise((resolve, reject) => {
      const timeout = this.config.timeout || 120000; // 2 min default
      let timeoutId: NodeJS.Timeout;

      // Build command
      let args = [...cliConfig.args];
      if (cliConfig.promptMode === 'arg') {
        args.push(prompt);
      }

      console.log(`[${this.id}] Spawning: ${cliConfig.command} ${args.slice(0, 2).join(' ')}...`);

      this.process = spawn(cliConfig.command, args, {
        cwd: this.config.workdir || process.cwd(),
        env: { ...process.env, ...this.config.env },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Handle stdout
      this.process.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        this.buffer += chunk;
        this.emit('data', chunk);
      });

      // Handle stderr
      this.process.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        // Some CLIs output progress to stderr
        if (!chunk.includes('Error') && !chunk.includes('error')) {
          this.buffer += chunk;
        }
        this.emit('stderr', chunk);
      });

      // Handle completion
      this.process.on('close', (code) => {
        clearTimeout(timeoutId);
        const durationMs = Date.now() - this.startTime;
        
        resolve({
          content: this.cleanOutput(this.buffer),
          exitCode: code,
          durationMs,
          truncated: false
        });
      });

      // Handle errors
      this.process.on('error', (err) => {
        clearTimeout(timeoutId);
        reject(new Error(`CLI ${this.type} error: ${err.message}`));
      });

      // Send prompt via stdin if needed
      if (cliConfig.promptMode === 'stdin') {
        this.process.stdin?.write(prompt + '\n');
        this.process.stdin?.end();
      }

      // Set timeout
      timeoutId = setTimeout(() => {
        if (this.process) {
          this.process.kill('SIGTERM');
          resolve({
            content: this.cleanOutput(this.buffer),
            exitCode: null,
            durationMs: Date.now() - this.startTime,
            truncated: true
          });
        }
      }, timeout);
    });
  }

  /**
   * Clean up CLI-specific output artifacts
   */
  private cleanOutput(output: string): string {
    // Remove ANSI color codes
    let cleaned = output.replace(/\x1B\[[0-9;]*[mK]/g, '');
    
    // Remove common CLI artifacts
    cleaned = cleaned
      .replace(/^Thinking\.+$/gm, '')
      .replace(/^Loading\.+$/gm, '')
      .replace(/^\s*$/gm, '')
      .trim();

    return cleaned;
  }

  /**
   * Kill the process if running
   */
  kill(): void {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
  }

  /**
   * Check if the CLI is available on the system
   */
  static async isAvailable(type: CLIType): Promise<boolean> {
    const config = CLI_CONFIGS[type];
    
    return new Promise((resolve) => {
      const proc = spawn('which', [config.command]);
      proc.on('close', (code) => {
        resolve(code === 0);
      });
      proc.on('error', () => {
        resolve(false);
      });
    });
  }

  /**
   * Get all available CLIs on the system
   */
  static async getAvailable(): Promise<CLIType[]> {
    const types: CLIType[] = ['claude', 'codex', 'gemini', 'ollama'];
    const available: CLIType[] = [];

    for (const type of types) {
      if (await CLIAgent.isAvailable(type)) {
        available.push(type);
      }
    }

    return available;
  }
}

export default CLIAgent;
