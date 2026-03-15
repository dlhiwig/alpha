// @ts-nocheck
/**
 * Provider Interface Layer
 * 
 * Unified interface for CLI-backed and HTTP-backed providers.
 * Each provider returns structured output regardless of transport.
 */

import { spawn } from 'child_process';
import { ProviderName, AgentRole } from './types';
import { getModelRouter, estimateCost } from './model-router';
import { recordSuccess, recordFailure } from './circuit-breaker';

export interface ProviderResult {
  stdout: string;
  stderr: string;
  code: number;
  latencyMs: number;
  error?: ProviderError;
}

export interface ProviderError {
  type: 'quota' | 'auth' | 'rate_limit' | 'timeout' | 'misconfigured' | 'unknown';
  message: string;
  retryable: boolean;
}

export interface Provider {
  name: ProviderName;
  type: 'cli' | 'http';
  execute(prompt: string, options?: ExecuteOptions): Promise<ProviderResult>;
  healthCheck(): Promise<boolean>;
}

export interface ExecuteOptions {
  timeout?: number;
  json?: boolean;
  env?: Record<string, string>;
}

// Fallback chain per role
// Ollama (local) is last fallback - free, fast, always available
// New cheap providers: minimax (80% SWE-Bench), zhipu (77% SWE-Bench), nvidia (enterprise Kimi)
export const ROLE_FALLBACKS: Record<AgentRole, ProviderName[]> = {
  implementer: ['codex', 'minimax', 'nemotron', 'claude', 'deepseek', 'nvidia', 'gemini', 'groq', 'ollama'],
  critic: ['claude', 'glm5', 'gemini', 'zhipu', 'deepseek', 'cohere', 'ollama'],
  researcher: ['gemini', 'nemotron', 'zhipu', 'claude', 'perplexity', 'cohere', 'mistral', 'ollama'],
  simplifier: ['deepseek', 'kimi', 'minimax', 'mistral', 'claude', 'ollama'],
  ideator: ['grok', 'qwen', 'gemini', 'claude', 'groq', 'ollama'],
  web: ['perplexity', 'zhipu', 'cohere', 'gemini', 'ollama'],
  general: ['claude', 'nemotron', 'glm5', 'gemini', 'minimax', 'codex', 'mistral', 'cohere', 'groq', 'ollama'],
  // New specialized roles for NVIDIA models
  vision: ['qwen', 'cosmos', 'gemini', 'claude', 'ollama'],  // Image/video understanding
  physical: ['cosmos', 'qwen', 'gemini', 'ollama'],  // Physical world reasoning
  longcontext: ['nemotron', 'minimax', 'cohere', 'mistral', 'claude', 'gemini', 'ollama'],  // 1M+ context
  agentic: ['glm5', 'qwen', 'nemotron', 'cohere', 'claude', 'kimi', 'ollama'],  // Multi-step agentic
};

// Error detection patterns
const ERROR_PATTERNS: { pattern: RegExp; type: ProviderError['type']; retryable: boolean }[] = [
  { pattern: /quota|billing|insufficient|exceeded/i, type: 'quota', retryable: false },
  { pattern: /auth|unauthorized|forbidden|api.?key/i, type: 'auth', retryable: false },
  { pattern: /rate.?limit|too.?many.?requests|429/i, type: 'rate_limit', retryable: true },
  { pattern: /timeout|timed?.?out/i, type: 'timeout', retryable: true },
  { pattern: /not.?found|command.?not|no.?such|misconfigured/i, type: 'misconfigured', retryable: false },
];

/**
 * Detect error type from output
 */
export function detectError(output: string): ProviderError | undefined {
  for (const { pattern, type, retryable } of ERROR_PATTERNS) {
    if (pattern.test(output)) {
      return { type, message: output.slice(0, 200), retryable };
    }
  }
  return undefined;
}

/**
 * Required API keys per provider
 */
export const REQUIRED_ENV: Record<ProviderName, string> = {
  codex: 'OPENAI_API_KEY',
  claude: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  kimi: 'MOONSHOT_API_KEY',
  grok: 'XAI_API_KEY',
  perplexity: 'PERPLEXITY_API_KEY',
  ollama: '',  // Local provider, no API key needed
  nvidia: 'NVIDIA_API_KEY',  // NVIDIA NIM (Kimi K2.5 via enterprise infra)
  minimax: 'MINIMAX_API_KEY',  // MiniMax M2.5 (80% SWE-Bench, 1M context, cheap)
  zhipu: 'ZHIPU_API_KEY',  // Zhipu GLM-5 (744B MoE, #1 BrowseComp)
  // NVIDIA NIM models (all use same NVIDIA_API_KEY)
  nemotron: 'NVIDIA_API_KEY',  // Nemotron-3-Nano-30B: 1M context, MoE, tool calling
  glm5: 'NVIDIA_API_KEY',  // GLM-5 744B: Long-horizon agentic reasoning
  cosmos: 'NVIDIA_API_KEY',  // Cosmos-Reason2-8B: Physical world (video/image)
  qwen: 'NVIDIA_API_KEY',  // Qwen 3.5-397B: 400B VLM, vision + agentic
  // New providers
  cohere: 'COHERE_API_KEY',  // Cohere Command R/R+ (RAG specialist)
  mistral: 'MISTRAL_API_KEY',  // Mistral Large/Small (European AI)
  groq: 'GROQ_API_KEY',  // Groq LPUs (ultra-fast inference)
};

/**
 * Get required environment variables for all providers
 */
export function getProviderEnv(): Record<string, string> {
  const env: Record<string, string> = { ...process.env as Record<string, string> };
  
  // Explicitly load from common locations
  const bashrcEnv = loadBashrcEnv();
  Object.assign(env, bashrcEnv);
  
  return env;
}

/**
 * Load environment variables from ~/.bashrc
 */
function loadBashrcEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const fs = require('fs');
    const os = require('os');
    const bashrc = fs.readFileSync(`${os.homedir()}/.bashrc`, 'utf-8');
    
    const exportRegex = /^export\s+(\w+)=["']?([^"'\n]+)["']?/gm;
    let match;
    while ((match = exportRegex.exec(bashrc)) !== null) {
      env[match[1]] = match[2];
    }
  } catch {
    // Ignore errors
  }
  return env;
}

/**
 * Check if a provider is configured (has required env var)
 */
export function isProviderConfigured(provider: ProviderName): boolean {
  const envKey = REQUIRED_ENV[provider];
  if (!envKey) {return true;}
  
  const env = getProviderEnv();
  return !!env[envKey];
}

/**
 * Get list of configured providers
 */
export function getConfiguredProviders(): ProviderName[] {
  const all: ProviderName[] = [
    'codex', 'claude', 'gemini', 'deepseek', 'kimi', 'grok', 'perplexity', 'ollama',
    'nvidia', 'minimax', 'zhipu',
    // NVIDIA NIM models
    'nemotron', 'glm5', 'cosmos', 'qwen',
    // New providers
    'cohere', 'mistral', 'groq'
  ];
  return all.filter(isProviderConfigured);
}

/**
 * CLI Provider implementation
 */
export class CLIProvider implements Provider {
  name: ProviderName;
  type = 'cli' as const;
  
  constructor(name: ProviderName) {
    this.name = name;
  }
  
  async execute(prompt: string, options: ExecuteOptions = {}): Promise<ProviderResult> {
    const { timeout = 60000, json = false, env = {} } = options;
    const startTime = Date.now();
    
    // Merge environment
    const fullEnv = { ...getProviderEnv(), ...env };
    
    return new Promise((resolve) => {
      const args = this.buildArgs(json);
      
      // Ensure PATH includes standard locations
      const pathEnv = [
        '/usr/bin',
        '/bin',
        '/usr/local/bin',
        '/home/linuxbrew/.linuxbrew/bin',
        '/home/toba/.local/bin',
        fullEnv.PATH || '',
      ].join(':');
      
      // Use bash -c with full command including prompt as argument
      // This avoids shell quoting issues
      const escapedPrompt = prompt.replace(/'/g, "'\\''");
      const cmd = `/usr/local/bin/llm-run ${this.name} '${escapedPrompt}'`;
      
      const child = spawn('/bin/bash', ['-c', cmd], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...fullEnv, PATH: pathEnv },
      });
      
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', (data) => { stdout += data.toString(); });
      child.stderr.on('data', (data) => { stderr += data.toString(); });
      
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        resolve({
          stdout,
          stderr,
          code: -1,
          latencyMs: Date.now() - startTime,
          error: { type: 'timeout', message: `Timeout after ${timeout}ms`, retryable: true },
        });
      }, timeout);
      
      child.on('close', (code) => {
        clearTimeout(timer);
        
        const error = code !== 0 ? detectError(stdout + stderr) : undefined;
        
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          code: code ?? 0,
          latencyMs: Date.now() - startTime,
          error,
        });
      });
      
      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          stdout: '',
          stderr: err.message,
          code: -1,
          latencyMs: Date.now() - startTime,
          error: { type: 'misconfigured', message: err.message, retryable: false },
        });
      });
    });
  }
  
  private buildArgs(json: boolean): string[] {
    const args: string[] = [];
    if (json && this.name === 'claude') {
      args.push('--json');
    }
    return args;
  }
  
  async healthCheck(): Promise<boolean> {
    if (!isProviderConfigured(this.name)) {
      return false;
    }
    
    const result = await this.execute('Reply with OK', { timeout: 10000 });
    return result.code === 0 && /ok/i.test(result.stdout);
  }
}

/**
 * Ollama HTTP Provider (local inference)
 */
export class OllamaProvider implements Provider {
  name: ProviderName = 'ollama';
  type = 'http' as const;
  
  private baseUrl: string;
  private model: string;
  
  constructor() {
    this.baseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
    this.model = process.env.OLLAMA_MODEL || 'dolphin-llama3:8b';
  }
  
  async execute(prompt: string, options: ExecuteOptions = {}): Promise<ProviderResult> {
    const { timeout = 60000 } = options;
    const startTime = Date.now();
    
    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
        }),
        signal: AbortSignal.timeout(timeout),
      });
      
      if (!response.ok) {
        return {
          stdout: '',
          stderr: `HTTP ${response.status}: ${response.statusText}`,
          code: 1,
          latencyMs: Date.now() - startTime,
          error: { type: 'unknown', message: `HTTP ${response.status}`, retryable: true },
        };
      }
      
      const data = await response.json() as { response?: string; error?: string };
      
      if (data.error) {
        return {
          stdout: '',
          stderr: data.error,
          code: 1,
          latencyMs: Date.now() - startTime,
          error: detectError(data.error),
        };
      }
      
      return {
        stdout: data.response || '',
        stderr: '',
        code: 0,
        latencyMs: Date.now() - startTime,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return {
        stdout: '',
        stderr: message,
        code: 1,
        latencyMs: Date.now() - startTime,
        error: {
          type: message.includes('timeout') ? 'timeout' : 'unknown',
          message,
          retryable: true,
        },
      };
    }
  }
  
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {return false;}
      const data = await response.json() as { models?: unknown[] };
      return (data.models?.length ?? 0) > 0;
    } catch {
      return false;
    }
  }
}

/**
 * Create provider instance
 */
export function createProvider(name: ProviderName): Provider {
  if (name === 'ollama') {
    return new OllamaProvider();
  }
  // CLI-backed providers
  return new CLIProvider(name);
}

/**
 * Get fallback provider for a role
 */
export function getFallbackProvider(
  role: AgentRole,
  excludeProviders: ProviderName[] = []
): ProviderName | null {
  const fallbacks = ROLE_FALLBACKS[role] || ROLE_FALLBACKS.general;
  const configured = getConfiguredProviders();
  
  for (const provider of fallbacks) {
    if (configured.includes(provider) && !excludeProviders.includes(provider)) {
      return provider;
    }
  }
  
  return null;
}

/**
 * Cost-aware provider execution with automatic routing and cost tracking
 */
export async function executeCostAware(
  role: AgentRole,
  task: string,
  agentId: string,
  contract: any, // SwarmContract type
  options: ExecuteOptions = {}
): Promise<ProviderResult & { actualProvider: ProviderName; estimatedCost: number; actualCost: number }> {
  const router = getModelRouter();
  const startTime = Date.now();
  
  try {
    // Route to optimal provider
    const routing = await router.route(role, task, agentId, contract);
    
    console.log(`[cost-router] ${agentId}: ${routing.provider} (${routing.reason}) - estimated $${routing.estimatedCost.toFixed(4)}`);
    
    // Execute with selected provider
    const provider = createProvider(routing.provider);
    const result = await provider.execute(task, options);
    
    const executionTime = Date.now() - startTime;
    
    // Estimate actual cost based on response length
    const inputTokens = Math.ceil(task.length / 4);
    const outputTokens = Math.ceil((result.stdout.length || 0) / 4);
    const actualCost = estimateCost(routing.provider, inputTokens, outputTokens);
    
    if (result.code === 0 && result.stdout) {
      // Success - record metrics
      recordSuccess(routing.provider, executionTime, actualCost);
      router.recordCost(routing.provider, agentId, actualCost, inputTokens, outputTokens);
      
      return {
        ...result,
        actualProvider: routing.provider,
        estimatedCost: routing.estimatedCost,
        actualCost,
      };
    } else {
      // Failure - record and possibly retry with fallback
      const errorType = result.error?.type || 'unknown';
      recordFailure(routing.provider, errorType as any, result.stderr, contract.circuitBreaker, actualCost);
      
      // Try fallback if available and retryable
      if (result.error?.retryable && routing.fallbacks.length > 0) {
        console.log(`[cost-router] ${routing.provider} failed, trying fallback: ${routing.fallbacks[0]}`);
        
        const fallbackProvider = createProvider(routing.fallbacks[0]);
        const fallbackResult = await fallbackProvider.execute(task, options);
        const fallbackCost = estimateCost(routing.fallbacks[0], inputTokens, Math.ceil((fallbackResult.stdout.length || 0) / 4));
        
        if (fallbackResult.code === 0) {
          recordSuccess(routing.fallbacks[0], Date.now() - startTime, fallbackCost);
          router.recordCost(routing.fallbacks[0], agentId, fallbackCost, inputTokens, Math.ceil((fallbackResult.stdout.length || 0) / 4));
          
          return {
            ...fallbackResult,
            actualProvider: routing.fallbacks[0],
            estimatedCost: routing.estimatedCost,
            actualCost: fallbackCost,
          };
        } else {
          recordFailure(routing.fallbacks[0], fallbackResult.error?.type as any || 'unknown', fallbackResult.stderr, contract.circuitBreaker);
        }
      }
      
      return {
        ...result,
        actualProvider: routing.provider,
        estimatedCost: routing.estimatedCost,
        actualCost,
      };
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? (error).message : 'Routing failed';
    
    return {
      stdout: '',
      stderr: message,
      code: 1,
      latencyMs: Date.now() - startTime,
      error: { type: 'unknown', message, retryable: false },
      actualProvider: 'ollama', // Fallback
      estimatedCost: 0,
      actualCost: 0,
    };
  }
}

/**
 * Get cost summary for all providers
 */
export function getProviderCostSummary(): {
  summary: ReturnType<InstanceType<typeof import('./model-router.js').ModelRouter>['getCostSummary']>;
  healthStatus: string;
} {
  const router = getModelRouter();
  const { formatHealthStatus } = require('./circuit-breaker.js');
  
  return {
    summary: router.getCostSummary(),
    healthStatus: formatHealthStatus(),
  };
}
