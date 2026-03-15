/**
 * SuperClaw Configuration Loader
 * Loads YAML config files and provides typed access
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import YAML from 'yaml';

// --- Types ---

export interface ModelProfile {
  provider: 'anthropic' | 'openai' | 'ollama';
  model: string;
  endpoint?: string;
  max_tokens: number;
  temperature: number;
}

export interface ModelConfig {
  default: ModelProfile;
  profiles: Record<string, ModelProfile>;
  endpoints: Record<string, string>;
  rate_limits: Record<string, { requests_per_minute: number; tokens_per_minute: number }>;
}

export interface SwarmConfig {
  swarm: {
    max_concurrent_agents: number;
    task_timeout_ms: number;
    total_timeout_ms: number;
    retry_on_failure: boolean;
    max_retries: number;
  };
  roles: string[];
  decomposition: {
    min_tasks: number;
    max_tasks: number;
    prefer_parallel: boolean;
  };
  aggregation: {
    strategy: 'llm' | 'simple_concat' | 'structured';
    include_metadata: boolean;
    format: 'markdown' | 'json';
  };
  logging: {
    level: string;
    log_dir: string;
    log_individual_agents: boolean;
    log_tokens: boolean;
    log_latency: boolean;
  };
  output: {
    save_results: boolean;
    output_dir: string;
    format: 'json' | 'markdown' | 'both';
  };
}

export interface PromptTemplates {
  role_prompts: Record<string, string>;
  decomposer: {
    system: string;
    user_template: string;
  };
  aggregator: {
    system: string;
    user_template: string;
  };
  sona: Record<string, string>;
}

export interface LoggingConfig {
  logging: {
    level: string;
    format: string;
    timestamp_format: string;
  };
  outputs: {
    console: { enabled: boolean; level: string; color: boolean };
    file: { enabled: boolean; level: string; path: string; max_size_mb: number; max_files: number; compress: boolean };
  };
  components: Record<string, { level: string; path?: string; [key: string]: unknown }>;
  metrics: {
    enabled: boolean;
    path: string;
    track: string[];
  };
}

// --- Singleton Config Manager ---

class ConfigManager {
  private static instance: ConfigManager;
  private configDir: string;
  private cache: Map<string, unknown> = new Map();

  private constructor() {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    this.configDir = path.join(__dirname, '../../config');
  }

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  private loadYaml<T>(filename: string): T {
    const cacheKey = filename;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey) as T;
    }

    const filePath = path.join(this.configDir, filename);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Config file not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = YAML.parse(content) as T;
    this.cache.set(cacheKey, parsed);
    return parsed;
  }

  getModelConfig(): ModelConfig {
    return this.loadYaml<ModelConfig>('model_config.yaml');
  }

  getSwarmConfig(): SwarmConfig {
    return this.loadYaml<SwarmConfig>('swarm_config.yaml');
  }

  getPromptTemplates(): PromptTemplates {
    return this.loadYaml<PromptTemplates>('prompt_templates.yaml');
  }

  getLoggingConfig(): LoggingConfig {
    return this.loadYaml<LoggingConfig>('logging_config.yaml');
  }

  // Get a specific model profile
  getModelProfile(profileName: string = 'default'): ModelProfile {
    const config = this.getModelConfig();
    if (profileName === 'default') {
      return config.default;
    }
    return config.profiles[profileName] || config.default;
  }

  // Get role prompt
  getRolePrompt(role: string): string {
    const templates = this.getPromptTemplates();
    return templates.role_prompts[role] || templates.role_prompts['architect'];
  }

  // Clear cache (useful for hot-reloading)
  clearCache(): void {
    this.cache.clear();
  }

  // Reload specific config
  reload(filename?: string): void {
    if (filename) {
      this.cache.delete(filename);
    } else {
      this.clearCache();
    }
  }
}

// --- Exports ---

export const config = ConfigManager.getInstance();

// Convenience exports
export const getModelConfig = () => config.getModelConfig();
export const getSwarmConfig = () => config.getSwarmConfig();
export const getPromptTemplates = () => config.getPromptTemplates();
export const getLoggingConfig = () => config.getLoggingConfig();
export const getModelProfile = (name?: string) => config.getModelProfile(name);
export const getRolePrompt = (role: string) => config.getRolePrompt(role);
