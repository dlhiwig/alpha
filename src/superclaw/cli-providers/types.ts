/**
 * CLI Provider Types
 * 
 * SuperClaw CLI adapter layer for external LLM CLIs
 * (Codex, Gemini, Claude Code)
 */

export type CLIProviderName = 'codex' | 'gemini' | 'claude';

export interface CLIProviderConfig {
  name: CLIProviderName;
  command: string;
  args?: string[];
  timeout?: number;
  env?: Record<string, string>;
}

export interface CLIExecuteRequest {
  provider: CLIProviderName;
  prompt: string;
  timeout?: number;
  json?: boolean;
}

export interface CLIExecuteResult {
  provider: CLIProviderName;
  output: string;
  exitCode: number;
  durationMs: number;
  error?: string;
}

export interface CLIProviderStatus {
  name: CLIProviderName;
  available: boolean;
  path?: string;
  version?: string;
  error?: string;
}

export const DEFAULT_TIMEOUT = 120_000; // 2 minutes

export const CLI_PROVIDERS: Record<CLIProviderName, CLIProviderConfig> = {
  codex: {
    name: 'codex',
    command: 'codex',
    args: ['exec'],  // Non-interactive mode
    timeout: 60_000,
  },
  gemini: {
    name: 'gemini',
    command: 'gemini',
    args: ['-p'],  // Non-interactive/headless mode
    timeout: 60_000,
  },
  claude: {
    name: 'claude',
    command: 'claude',
    args: ['-p'],  // Print mode (non-interactive)
    timeout: 120_000,
  },
};
