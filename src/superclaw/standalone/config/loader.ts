/**
 * SuperClaw Standalone Configuration Loader
 * Simple YAML-based replacement for OpenClaw's complex config system
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import YAML from 'yaml';

export interface SuperClawConfig {
  server: {
    port: number;
    host: string;
    logLevel: string;
    maxConnections: number;
  };
  
  providers: {
    claude: {
      enabled: boolean;
      apiKey?: string;
      model: string;
      priority: number;
    };
    gemini: {
      enabled: boolean;
      apiKey?: string;
      model: string;
      priority: number;
    };
    openai: {
      enabled: boolean;
      apiKey?: string;
      model: string;
      priority: number;
    };
    ollama: {
      enabled: boolean;
      baseUrl: string;
      model: string;
      priority: number;
    };
  };
  
  security: {
    requireAuth: boolean;
    apiKey?: string;
    jwtSecret: string;
    sessionTimeout: number; // seconds
  };
  
  storage: {
    dataDir: string;
    sessionDb: string;
    workspaceDir: string;
    maxWorkspaceSize: number; // MB
  };
  
  tools: {
    enabled: string[];
    fileOps: {
      allowedExtensions: string[];
      maxFileSize: number; // MB
    };
    shell: {
      enabled: boolean;
      allowedCommands?: string[];
      timeout: number; // seconds
    };
    web: {
      braveApiKey?: string;
      userAgent: string;
      timeout: number; // seconds
    };
  };
  
  swarm: {
    maxAgents: number;
    timeout: number; // seconds
    retries: number;
    circuitBreaker: {
      enabled: boolean;
      failureThreshold: number;
      recoveryTime: number; // seconds
    };
  };
}

export class ConfigLoader {
  private config: SuperClawConfig;
  private configPath: string;
  
  constructor(configPath: string = './config/superclaw.yaml') {
    this.configPath = resolve(configPath);
    this.config = this.getDefaultConfig();
  }
  
  async load(): Promise<SuperClawConfig> {
    try {
      if (!existsSync(this.configPath)) {
        console.log('📝 Config file not found, creating default config...');
        await this.createDefaultConfig();
        return this.config;
      }
      
      const configFile = await readFile(this.configPath, 'utf-8');
      const userConfig = YAML.parse(configFile);
      
      // Merge with defaults
      this.config = this.mergeConfig(this.getDefaultConfig(), userConfig);
      
      // Override with environment variables
      this.applyEnvironmentOverrides();
      
      // Validate configuration
      this.validateConfig();
      
      console.log('✅ Configuration loaded successfully');
      return this.config;
      
    } catch (error: unknown) {
      console.error('❌ Failed to load configuration:', error);
      console.log('📝 Using default configuration');
      return this.config;
    }
  }
  
  async save(): Promise<void> {
    try {
      await mkdir(dirname(this.configPath), { recursive: true });
      const yamlContent = YAML.stringify(this.config);
      await writeFile(this.configPath, yamlContent, 'utf-8');
      console.log('✅ Configuration saved successfully');
    } catch (error: unknown) {
      console.error('❌ Failed to save configuration:', error);
      throw error;
    }
  }
  
  getConfig(): SuperClawConfig {
    return this.config;
  }
  
  updateConfig(updates: Partial<SuperClawConfig>): void {
    this.config = this.mergeConfig(this.config, updates);
  }
  
  private getDefaultConfig(): SuperClawConfig {
    return {
      server: {
        port: 18800,
        host: '127.0.0.1',
        logLevel: 'info',
        maxConnections: 100
      },
      
      providers: {
        claude: {
          enabled: false,
          model: 'claude-3-5-sonnet-20241022',
          priority: 1
        },
        gemini: {
          enabled: false,
          model: 'gemini-2.0-flash-001',
          priority: 2
        },
        openai: {
          enabled: false,
          model: 'gpt-4',
          priority: 3
        },
        ollama: {
          enabled: true,
          baseUrl: 'http://127.0.0.1:11434',
          model: 'dolphin-llama3:8b',
          priority: 4
        }
      },
      
      security: {
        requireAuth: false,
        jwtSecret: this.generateSecret(),
        sessionTimeout: 86400 // 24 hours
      },
      
      storage: {
        dataDir: './data',
        sessionDb: './data/sessions.db',
        workspaceDir: './data/workspaces',
        maxWorkspaceSize: 1024 // 1GB
      },
      
      tools: {
        enabled: ['read_file', 'write_file', 'edit_file', 'list_files', 'web_search', 'web_fetch'],
        fileOps: {
          allowedExtensions: ['.txt', '.md', '.json', '.yaml', '.yml', '.js', '.ts', '.py', '.sh'],
          maxFileSize: 10 // 10MB
        },
        shell: {
          enabled: false,
          timeout: 30
        },
        web: {
          userAgent: 'SuperClaw/1.0',
          timeout: 30
        }
      },
      
      swarm: {
        maxAgents: 5,
        timeout: 300,
        retries: 3,
        circuitBreaker: {
          enabled: true,
          failureThreshold: 5,
          recoveryTime: 300
        }
      }
    };
  }
  
  private async createDefaultConfig(): Promise<void> {
    await mkdir(dirname(this.configPath), { recursive: true });
    const yamlContent = YAML.stringify(this.config);
    await writeFile(this.configPath, yamlContent, 'utf-8');
  }
  
  private applyEnvironmentOverrides(): void {
    // Server overrides
    if (process.env.SUPERCLAW_PORT) {
      this.config.server.port = parseInt(process.env.SUPERCLAW_PORT, 10);
    }
    if (process.env.SUPERCLAW_HOST) {
      this.config.server.host = process.env.SUPERCLAW_HOST;
    }
    if (process.env.SUPERCLAW_LOG_LEVEL) {
      this.config.server.logLevel = process.env.SUPERCLAW_LOG_LEVEL;
    }
    
    // Provider API keys
    if (process.env.ANTHROPIC_API_KEY) {
      this.config.providers.claude.enabled = true;
      this.config.providers.claude.apiKey = process.env.ANTHROPIC_API_KEY;
    }
    if (process.env.GEMINI_API_KEY) {
      this.config.providers.gemini.enabled = true;
      this.config.providers.gemini.apiKey = process.env.GEMINI_API_KEY;
    }
    if (process.env.OPENAI_API_KEY) {
      this.config.providers.openai.enabled = true;
      this.config.providers.openai.apiKey = process.env.OPENAI_API_KEY;
    }
    if (process.env.OLLAMA_URL) {
      this.config.providers.ollama.baseUrl = process.env.OLLAMA_URL;
    }
    
    // Security
    if (process.env.SUPERCLAW_API_KEY) {
      this.config.security.requireAuth = true;
      this.config.security.apiKey = process.env.SUPERCLAW_API_KEY;
    }
    if (process.env.SUPERCLAW_JWT_SECRET) {
      this.config.security.jwtSecret = process.env.SUPERCLAW_JWT_SECRET;
    }
    
    // Web tools
    if (process.env.BRAVE_API_KEY) {
      this.config.tools.web.braveApiKey = process.env.BRAVE_API_KEY;
    }
  }
  
  private mergeConfig(base: any, override: any): any {
    const result = { ...base };
    
    for (const [key, value] of Object.entries(override)) {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = this.mergeConfig(base[key] || {}, value);
      } else {
        result[key] = value;
      }
    }
    
    return result;
  }
  
  private validateConfig(): void {
    // Basic validation
    if (this.config.server.port < 1 || this.config.server.port > 65535) {
      throw new Error('Invalid server port');
    }
    
    if (this.config.security.sessionTimeout < 60) {
      throw new Error('Session timeout too short (minimum 60 seconds)');
    }
    
    if (this.config.storage.maxWorkspaceSize < 1) {
      throw new Error('Max workspace size too small (minimum 1MB)');
    }
    
    // Check if at least one provider is enabled
    const enabledProviders = Object.values(this.config.providers).filter(p => p.enabled);
    if (enabledProviders.length === 0) {
      console.warn('⚠️  No providers enabled - SuperClaw will not be able to process requests');
    }
  }
  
  private generateSecret(): string {
    return Array.from({ length: 32 }, () => 
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
  }
}