/**
 * CLI Provider Executor
 * 
 * Executes prompts through external LLM CLIs (Codex, Gemini, Claude Code)
 * via the unified llm-run adapter.
 */

import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import {
  CLIProviderName,
  CLIExecuteRequest,
  CLIExecuteResult,
  CLIProviderStatus,
  CLI_PROVIDERS,
  DEFAULT_TIMEOUT,
} from './types';

const execAsync = promisify(exec);

/**
 * Check if a CLI provider is available
 */
export async function checkProvider(name: CLIProviderName): Promise<CLIProviderStatus> {
  const config = CLI_PROVIDERS[name];
  
  try {
    const { stdout } = await execAsync(`which ${config.command}`);
    const path = stdout.trim();
    
    // Try to get version
    let version: string | undefined;
    try {
      const { stdout: versionOut } = await execAsync(`${config.command} --version 2>/dev/null || echo "unknown"`);
      version = versionOut.trim().split('\n')[0];
    } catch {
      version = undefined;
    }
    
    return {
      name,
      available: true,
      path,
      version,
    };
  } catch (error: unknown) {
    return {
      name,
      available: false,
      error: `${config.command} not found in PATH`,
    };
  }
}

/**
 * Check all CLI providers
 */
export async function checkAllProviders(): Promise<CLIProviderStatus[]> {
  const providers: CLIProviderName[] = ['codex', 'gemini', 'claude'];
  return Promise.all(providers.map(checkProvider));
}

/**
 * Execute a prompt via llm-run adapter
 */
export async function execute(request: CLIExecuteRequest): Promise<CLIExecuteResult> {
  const { provider, prompt, timeout = DEFAULT_TIMEOUT, json = false } = request;
  const startTime = Date.now();
  
  return new Promise((resolve) => {
    const args = [provider, prompt];
    
    const child = spawn('llm-run', args, {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({
        provider,
        output: stdout,
        exitCode: -1,
        durationMs: Date.now() - startTime,
        error: `Timeout after ${timeout}ms`,
      });
    }, timeout);
    
    child.on('close', (code) => {
      clearTimeout(timer);
      
      let output = stdout.trim();
      
      // Attempt JSON parsing if requested
      if (json && output) {
        try {
          // Try to extract JSON from output
          const jsonMatch = output.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
          if (jsonMatch) {
            JSON.parse(jsonMatch[0]); // Validate
            output = jsonMatch[0];
          }
        } catch {
          // Keep raw output if JSON parsing fails
        }
      }
      
      resolve({
        provider,
        output,
        exitCode: code ?? 0,
        durationMs: Date.now() - startTime,
        error: code !== 0 ? stderr.trim() || `Exit code ${code}` : undefined,
      });
    });
    
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        provider,
        output: '',
        exitCode: -1,
        durationMs: Date.now() - startTime,
        error: err.message,
      });
    });
  });
}

/**
 * Execute with automatic provider selection based on task type
 */
export async function executeAuto(
  prompt: string,
  taskType: 'code' | 'reasoning' | 'general' = 'general'
): Promise<CLIExecuteResult> {
  // Provider selection logic
  let provider: CLIProviderName;
  
  switch (taskType) {
    case 'code':
      // Prefer Codex for code generation, fallback to Claude
      provider = 'codex';
      break;
    case 'reasoning':
      // Prefer Claude for complex reasoning
      provider = 'claude';
      break;
    case 'general':
    default:
      // Gemini for general tasks (good balance)
      provider = 'gemini';
      break;
  }
  
  // Check availability and fallback
  const status = await checkProvider(provider);
  if (!status.available) {
    // Fallback chain: claude -> gemini -> codex
    const fallbacks: CLIProviderName[] = ['claude', 'gemini', 'codex'];
    for (const fallback of fallbacks) {
      const fbStatus = await checkProvider(fallback);
      if (fbStatus.available) {
        provider = fallback;
        break;
      }
    }
  }
  
  return execute({ provider, prompt });
}

/**
 * Execute across multiple providers and aggregate results
 */
export async function executeParallel(
  prompt: string,
  providers: CLIProviderName[] = ['codex', 'gemini', 'claude']
): Promise<CLIExecuteResult[]> {
  const requests = providers.map((provider) => execute({ provider, prompt }));
  return Promise.all(requests);
}

/**
 * Execute with consensus (majority agreement)
 */
export async function executeWithConsensus(
  prompt: string,
  providers: CLIProviderName[] = ['codex', 'gemini', 'claude']
): Promise<{
  consensus: string | null;
  results: CLIExecuteResult[];
  agreement: number;
}> {
  const results = await executeParallel(prompt, providers);
  
  // Simple consensus: find most common output
  const outputCounts = new Map<string, number>();
  for (const result of results) {
    if (result.exitCode === 0 && result.output) {
      const normalized = result.output.toLowerCase().trim();
      outputCounts.set(normalized, (outputCounts.get(normalized) || 0) + 1);
    }
  }
  
  let consensus: string | null = null;
  let maxCount = 0;
  
  for (const [output, count] of outputCounts) {
    if (count > maxCount) {
      maxCount = count;
      consensus = output;
    }
  }
  
  return {
    consensus,
    results,
    agreement: maxCount / providers.length,
  };
}
