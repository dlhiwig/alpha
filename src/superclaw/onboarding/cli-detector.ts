/**
 * CLI Detector for SuperClaw
 * 
 * Detects installed AI CLIs and their configuration status
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { safeCall, Result } from '../core/errors';

const execAsync = promisify(exec);

export interface CLIInfo {
  name: string;
  installed: boolean;
  version?: string;
  configured: boolean;
  configPath?: string;
  models?: string[];
  error?: string;
}

export interface CLIDetectionResult {
  timestamp: Date;
  clis: CLIInfo[];
  summary: {
    installed: number;
    configured: number;
    total: number;
  };
}

/**
 * Check if a command exists
 */
async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execAsync(`which ${cmd}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get CLI version
 */
async function getVersion(cmd: string, flag: string = '--version'): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync(`${cmd} ${flag} 2>/dev/null`);
    // Extract version number
    const match = stdout.match(/(\d+\.\d+\.\d+(-\w+)?)/);
    return match ? match[1] : stdout.trim().split('\n')[0];
  } catch {
    return undefined;
  }
}

/**
 * Detect Claude CLI
 */
async function detectClaude(): Promise<CLIInfo> {
  const name = 'claude';
  const installed = await commandExists('claude');
  
  if (!installed) {
    return { name, installed: false, configured: false };
  }

  const version = await getVersion('claude', '--version');
  // Claude CLI uses .credentials.json for auth, not settings.json
  const credentialsPath = join(homedir(), '.claude', '.credentials.json');
  const configured = existsSync(credentialsPath);

  return {
    name,
    installed,
    version,
    configured,
    configPath: configured ? credentialsPath : undefined
  };
}

/**
 * Detect Codex CLI
 */
async function detectCodex(): Promise<CLIInfo> {
  const name = 'codex';
  const installed = await commandExists('codex');
  
  if (!installed) {
    return { name, installed: false, configured: false };
  }

  const version = await getVersion('codex', '--version');
  
  // Codex uses OpenAI API key
  const hasApiKey = !!process.env.OPENAI_API_KEY;
  
  return {
    name,
    installed,
    version,
    configured: hasApiKey,
    error: hasApiKey ? undefined : 'OPENAI_API_KEY not set'
  };
}

/**
 * Detect Gemini CLI
 */
async function detectGemini(): Promise<CLIInfo> {
  const name = 'gemini';
  const installed = await commandExists('gemini');
  
  if (!installed) {
    return { name, installed: false, configured: false };
  }

  const version = await getVersion('gemini', '--version');
  
  // Gemini uses GEMINI_API_KEY
  const hasApiKey = !!process.env.GEMINI_API_KEY;
  
  return {
    name,
    installed,
    version,
    configured: hasApiKey,
    error: hasApiKey ? undefined : 'GEMINI_API_KEY not set'
  };
}

/**
 * Detect Ollama
 */
async function detectOllama(): Promise<CLIInfo> {
  const name = 'ollama';
  const installed = await commandExists('ollama');
  
  if (!installed) {
    return { name, installed: false, configured: false };
  }

  const version = await getVersion('ollama', '--version');
  
  // Check if Ollama is running and has models
  let models: string[] = [];
  let configured = false;
  
  try {
    const { stdout } = await execAsync('ollama list 2>/dev/null');
    const lines = stdout.trim().split('\n').slice(1); // Skip header
    models = lines.map(line => line.split(/\s+/)[0]).filter(Boolean);
    configured = models.length > 0;
  } catch {
    // Ollama might not be running
  }

  return {
    name,
    installed,
    version,
    configured,
    models,
    error: configured ? undefined : 'No models installed. Run: ollama pull llama3'
  };
}

/**
 * Check DeepSeek API configuration
 */
async function detectDeepSeek(): Promise<CLIInfo> {
  const name = 'deepseek';
  const hasApiKey = !!process.env.DEEPSEEK_API_KEY;
  
  // DeepSeek is API-only, no CLI
  return {
    name,
    installed: true, // API is always "installed"
    configured: hasApiKey,
    models: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'],
    error: hasApiKey ? undefined : 'DEEPSEEK_API_KEY not set'
  };
}

/**
 * Check Anthropic API configuration
 */
async function detectAnthropic(): Promise<CLIInfo> {
  const name = 'anthropic';
  const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
  
  return {
    name,
    installed: true,
    configured: hasApiKey,
    models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-3-20250514'],
    error: hasApiKey ? undefined : 'ANTHROPIC_API_KEY not set'
  };
}

/**
 * Check OpenAI API configuration
 */
async function detectOpenAI(): Promise<CLIInfo> {
  const name = 'openai';
  const hasApiKey = !!process.env.OPENAI_API_KEY;
  
  return {
    name,
    installed: true,
    configured: hasApiKey,
    models: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o1-mini'],
    error: hasApiKey ? undefined : 'OPENAI_API_KEY not set'
  };
}

/**
 * Detect all available CLIs and APIs
 */
export async function detectAllCLIs(): Promise<CLIDetectionResult> {
  const detectors = [
    detectClaude,
    detectCodex,
    detectGemini,
    detectOllama,
    detectDeepSeek,
    detectAnthropic,
    detectOpenAI
  ];

  const clis = await Promise.all(detectors.map(fn => fn()));
  
  const installed = clis.filter(c => c.installed).length;
  const configured = clis.filter(c => c.configured).length;

  return {
    timestamp: new Date(),
    clis,
    summary: {
      installed,
      configured,
      total: clis.length
    }
  };
}

/**
 * Print detection results to console
 */
export function printDetectionResults(results: CLIDetectionResult): void {
  console.log('\n🔍 SuperClaw CLI Detection Results');
  console.log('=' .repeat(50));
  console.log(`Timestamp: ${results.timestamp.toISOString()}\n`);

  for (const cli of results.clis) {
    const status = cli.configured ? '✅' : cli.installed ? '⚠️' : '❌';
    console.log(`${status} ${cli.name}`);
    
    if (cli.version) {
      console.log(`   Version: ${cli.version}`);
    }
    if (cli.models?.length) {
      console.log(`   Models: ${cli.models.join(', ')}`);
    }
    if (cli.error) {
      console.log(`   ⚠️  ${cli.error}`);
    }
    console.log();
  }

  console.log('=' .repeat(50));
  console.log(`Summary: ${results.summary.configured}/${results.summary.total} configured`);
}
