/**
 * SuperClaw MCP Registry - Comprehensive MCP Server Discovery & Management
 * 
 * This registry system provides:
 * - Auto-discovery of installed MCP servers
 * - Registry of popular MCP servers with install instructions
 * - Health checking for connected MCP servers
 * - Token usage tracking per MCP server
 * - Integration with SuperClaw's tool system
 */

import { execSync, spawn } from 'child_process';
import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import chalk from 'chalk';
import {
  FederatedServer,
  MCPCapabilities,
  MCPEventType,
  MCPEvent,
  FederationMetrics,
  ToolCapability
} from './types';
import { FederatedToolRegistry } from './tool-registry';

// --- Types ---

export interface MCPServerDefinition {
  id: string;
  name: string;
  description: string;
  category: 'browser' | 'database' | 'filesystem' | 'git' | 'communication' | 'utility' | 'cloud';
  capabilities: string[];
  installCommand: string;
  configExample?: string;
  requirements?: string[];
  homepage?: string;
  documentation?: string;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface MCPServerStatus {
  id: string;
  name: string;
  status: 'installed' | 'running' | 'stopped' | 'error' | 'unknown';
  version?: string;
  pid?: number;
  port?: number;
  lastSeen?: Date;
  errorMessage?: string;
  tokenUsage?: TokenUsageStats;
  healthScore?: number;
}

export interface TokenUsageStats {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
  requestCount: number;
  lastReset: Date;
  dailyLimit?: number;
}

export interface DiscoveryResult {
  discovered: MCPServerStatus[];
  errors: string[];
  totalScanned: number;
  executionTimeMs: number;
}

// --- Built-in Server Definitions ---

export const BUILTIN_MCP_SERVERS: MCPServerDefinition[] = [
  {
    id: 'openbrowser',
    name: 'OpenBrowser MCP',
    description: 'Browser automation and web interaction capabilities',
    category: 'browser',
    capabilities: ['navigate', 'click', 'type', 'extract', 'screenshot'],
    installCommand: 'npm install -g @openbrowser/mcp-server',
    configExample: JSON.stringify({
      command: 'npx',
      args: ['@openbrowser/mcp-server'],
      port: 3001
    }, null, 2),
    requirements: ['Node.js >= 16', 'Chrome/Chromium browser'],
    homepage: 'https://github.com/openbrowser/mcp-server',
    riskLevel: 'medium'
  },
  {
    id: 'playwright',
    name: 'Playwright MCP',
    description: 'Cross-browser automation with Playwright',
    category: 'browser',
    capabilities: ['automation', 'testing', 'screenshots', 'pdf'],
    installCommand: 'npm install -g @playwright/mcp-server && playwright install',
    configExample: JSON.stringify({
      command: 'npx',
      args: ['@playwright/mcp-server'],
      env: { PLAYWRIGHT_HEADLESS: 'true' }
    }, null, 2),
    requirements: ['Node.js >= 16', 'Playwright browsers'],
    homepage: 'https://playwright.dev',
    riskLevel: 'medium'
  },
  {
    id: 'github',
    name: 'GitHub MCP',
    description: 'GitHub API integration for repositories, issues, and PRs',
    category: 'git',
    capabilities: ['repos', 'issues', 'prs', 'commits', 'releases'],
    installCommand: 'npm install -g @github/mcp-server',
    configExample: JSON.stringify({
      command: 'github-mcp-server',
      env: { GITHUB_TOKEN: 'your-token-here' }
    }, null, 2),
    requirements: ['GitHub API token'],
    homepage: 'https://github.com/github/mcp-server',
    riskLevel: 'low'
  },
  {
    id: 'slack',
    name: 'Slack MCP',
    description: 'Slack workspace integration for messaging and channels',
    category: 'communication',
    capabilities: ['messages', 'channels', 'users', 'files', 'reactions'],
    installCommand: 'npm install -g @slack/mcp-server',
    configExample: JSON.stringify({
      command: 'slack-mcp-server',
      env: { 
        SLACK_BOT_TOKEN: 'xoxb-your-token',
        SLACK_APP_TOKEN: 'xapp-your-token'
      }
    }, null, 2),
    requirements: ['Slack App with Bot Token'],
    homepage: 'https://api.slack.com',
    riskLevel: 'low'
  },
  {
    id: 'postgresql',
    name: 'PostgreSQL MCP',
    description: 'PostgreSQL database operations and queries',
    category: 'database',
    capabilities: ['query', 'schema', 'tables', 'indexes', 'backup'],
    installCommand: 'npm install -g @postgresql/mcp-server',
    configExample: JSON.stringify({
      command: 'postgresql-mcp-server',
      env: { 
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/db'
      }
    }, null, 2),
    requirements: ['PostgreSQL server', 'Database connection'],
    homepage: 'https://www.postgresql.org',
    riskLevel: 'high'
  },
  {
    id: 'sqlite',
    name: 'SQLite MCP',
    description: 'SQLite database operations for local databases',
    category: 'database',
    capabilities: ['query', 'schema', 'tables', 'backup', 'analyze'],
    installCommand: 'npm install -g @sqlite/mcp-server',
    configExample: JSON.stringify({
      command: 'sqlite-mcp-server',
      args: ['--db-path', './data.sqlite']
    }, null, 2),
    requirements: ['SQLite3'],
    homepage: 'https://www.sqlite.org',
    riskLevel: 'medium'
  },
  {
    id: 'filesystem',
    name: 'Filesystem MCP',
    description: 'Safe filesystem operations with sandboxing',
    category: 'filesystem',
    capabilities: ['read', 'write', 'list', 'search', 'watch', 'archive'],
    installCommand: 'npm install -g @filesystem/mcp-server',
    configExample: JSON.stringify({
      command: 'filesystem-mcp-server',
      args: ['--sandbox', '/allowed/path'],
      env: { FS_MAX_FILE_SIZE: '10MB' }
    }, null, 2),
    requirements: ['Filesystem access permissions'],
    homepage: 'https://github.com/filesystem/mcp-server',
    riskLevel: 'high'
  },
  {
    id: 'docker',
    name: 'Docker MCP',
    description: 'Docker container management and operations',
    category: 'utility',
    capabilities: ['containers', 'images', 'networks', 'volumes', 'logs'],
    installCommand: 'npm install -g @docker/mcp-server',
    configExample: JSON.stringify({
      command: 'docker-mcp-server',
      env: { DOCKER_HOST: 'unix:///var/run/docker.sock' }
    }, null, 2),
    requirements: ['Docker daemon', 'Docker API access'],
    homepage: 'https://docs.docker.com/engine/api/',
    riskLevel: 'high'
  }
];

// --- Main Registry Class ---

export class MCPRegistry {
  private servers = new Map<string, MCPServerStatus>();
  private definitions = new Map<string, MCPServerDefinition>();
  private toolRegistry: FederatedToolRegistry;
  private tokenUsage = new Map<string, TokenUsageStats>();
  private healthCheckInterval?: NodeJS.Timeout;
  private configPath: string;

  constructor(toolRegistry?: FederatedToolRegistry) {
    this.toolRegistry = toolRegistry || new FederatedToolRegistry();
    this.configPath = join(homedir(), '.superclaw', 'mcp-registry.json');
    
    // Register built-in server definitions
    for (const server of BUILTIN_MCP_SERVERS) {
      this.definitions.set(server.id, server);
    }

    this.loadPersistedState();
    this.startHealthChecking();
  }

  // --- Discovery Methods ---

  /**
   * Auto-discover installed MCP servers
   */
  async discoverServers(): Promise<DiscoveryResult> {
    const startTime = Date.now();
    const discovered: MCPServerStatus[] = [];
    const errors: string[] = [];
    let totalScanned = 0;

    console.log(chalk.blue('🔍 Discovering installed MCP servers...'));

    // Scan common installation locations
    const scanPaths = [
      '/usr/local/bin',
      '/usr/bin',
      join(homedir(), '.npm', 'bin'),
      join(homedir(), '.local', 'bin'),
      './node_modules/.bin'
    ];

    for (const path of scanPaths) {
      try {
        totalScanned++;
        const servers = await this.scanDirectory(path);
        discovered.push(...servers);
      } catch (error: unknown) {
        errors.push(`Failed to scan ${path}: ${error}`);
      }
    }

    // Check for npm global packages
    try {
      totalScanned++;
      const npmServers = await this.discoverNpmGlobalServers();
      discovered.push(...npmServers);
    } catch (error: unknown) {
      errors.push(`Failed to check npm globals: ${error}`);
    }

    // Check for running processes
    try {
      totalScanned++;
      const runningServers = await this.discoverRunningServers();
      discovered.push(...runningServers);
    } catch (error: unknown) {
      errors.push(`Failed to check running processes: ${error}`);
    }

    // Update registry
    for (const server of discovered) {
      this.servers.set(server.id, server);
    }

    const executionTimeMs = Date.now() - startTime;
    
    console.log(chalk.green(`✅ Discovery complete: found ${discovered.length} servers in ${executionTimeMs}ms`));
    
    return {
      discovered,
      errors,
      totalScanned,
      executionTimeMs
    };
  }

  private async scanDirectory(dirPath: string): Promise<MCPServerStatus[]> {
    const servers: MCPServerStatus[] = [];
    
    try {
      const files = await fs.readdir(dirPath);
      const mcpFiles = files.filter(file => 
        file.includes('mcp-server') || 
        file.includes('mcp') ||
        this.definitions.has(file.replace(/\.js$/, ''))
      );

      for (const file of mcpFiles) {
        const fullPath = join(dirPath, file);
        const stats = await fs.stat(fullPath);
        
        if (stats.isFile() && (stats.mode & 0o111)) { // Executable
          const id = file.replace(/\.js$/, '').replace('-mcp-server', '');
          const definition = this.definitions.get(id);
          
          servers.push({
            id,
            name: definition?.name || file,
            status: 'installed',
            version: await this.getServerVersion(fullPath),
          });
        }
      }
    } catch (error: unknown) {
      // Directory doesn't exist or no access - not an error
    }

    return servers;
  }

  private async discoverNpmGlobalServers(): Promise<MCPServerStatus[]> {
    const servers: MCPServerStatus[] = [];

    try {
      const output = execSync('npm list -g --depth=0 --json', { 
        encoding: 'utf8',
        timeout: 5000 
      });
      const packages = JSON.parse(output);
      
      for (const [packageName, info] of Object.entries(packages.dependencies || {})) {
        if (packageName.includes('mcp-server') || packageName.includes('mcp')) {
          const id = packageName.replace('@', '').replace('/', '-').replace('-mcp-server', '');
          const definition = this.definitions.get(id);
          
          servers.push({
            id,
            name: definition?.name || packageName,
            status: 'installed',
            version: (info as any).version,
          });
        }
      }
    } catch (error: unknown) {
      // npm not available or error - not fatal
    }

    return servers;
  }

  private async discoverRunningServers(): Promise<MCPServerStatus[]> {
    const servers: MCPServerStatus[] = [];

    try {
      // Check for processes with 'mcp' in the name
      const output = execSync('ps aux | grep -i mcp | grep -v grep', { 
        encoding: 'utf8',
        timeout: 2000 
      });
      
      const lines = output.trim().split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 11) {
          const pid = parseInt(parts[1]);
          const command = parts.slice(10).join(' ');
          
          // Extract server ID from command
          let id = 'unknown';
          for (const [defId, def] of this.definitions) {
            if (command.includes(defId) || command.includes(def.name.toLowerCase())) {
              id = defId;
              break;
            }
          }
          
          const definition = this.definitions.get(id);
          servers.push({
            id,
            name: definition?.name || `MCP Process ${pid}`,
            status: 'running',
            pid,
          });
        }
      }
    } catch (error: unknown) {
      // ps command failed or no matches - not fatal
    }

    return servers;
  }

  private async getServerVersion(execPath: string): Promise<string | undefined> {
    try {
      const output = execSync(`${execPath} --version`, { 
        encoding: 'utf8', 
        timeout: 2000 
      });
      return output.trim().split('\n')[0];
    } catch {
      return undefined;
    }
  }

  // --- Server Management ---

  /**
   * Install an MCP server by ID
   */
  async installServer(serverId: string): Promise<boolean> {
    const definition = this.definitions.get(serverId);
    if (!definition) {
      throw new Error(`Unknown server: ${serverId}`);
    }

    console.log(chalk.blue(`📦 Installing ${definition.name}...`));
    console.log(chalk.gray(`Command: ${definition.installCommand}`));

    try {
      execSync(definition.installCommand, { 
        stdio: 'inherit',
        timeout: 120000 // 2 minutes
      });

      // Update status
      this.servers.set(serverId, {
        id: serverId,
        name: definition.name,
        status: 'installed',
      });

      console.log(chalk.green(`✅ Successfully installed ${definition.name}`));
      
      // Show configuration example if available
      if (definition.configExample) {
        console.log(chalk.yellow('\n💡 Example configuration:'));
        console.log(definition.configExample);
      }

      this.persistState();
      return true;
    } catch (error: unknown) {
      console.error(chalk.red(`❌ Failed to install ${definition.name}: ${error}`));
      
      this.servers.set(serverId, {
        id: serverId,
        name: definition.name,
        status: 'error',
        errorMessage: error instanceof Error ? (error).message : String(error),
      });

      this.persistState();
      return false;
    }
  }

  /**
   * Start an MCP server
   */
  async startServer(serverId: string): Promise<boolean> {
    const server = this.servers.get(serverId);
    const definition = this.definitions.get(serverId);
    
    if (!server || !definition) {
      throw new Error(`Server not found: ${serverId}`);
    }

    if (server.status === 'running') {
      console.log(chalk.yellow(`⚠️  ${server.name} is already running`));
      return true;
    }

    console.log(chalk.blue(`🚀 Starting ${server.name}...`));

    try {
      // Parse the install command to get the actual server command
      // This is simplified - in production you'd want more robust parsing
      const configExample = definition.configExample ? JSON.parse(definition.configExample) : {};
      const command = configExample.command || definition.installCommand.split(' ')[0];
      const args = configExample.args || [];

      const child = spawn(command, args, {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, ...configExample.env }
      });

      child.unref();

      // Update status
      server.status = 'running';
      server.pid = child.pid;
      server.lastSeen = new Date();
      
      this.servers.set(serverId, server);
      this.persistState();

      console.log(chalk.green(`✅ Started ${server.name} (PID: ${child.pid})`));
      return true;
    } catch (error: unknown) {
      console.error(chalk.red(`❌ Failed to start ${server.name}: ${error}`));
      
      server.status = 'error';
      server.errorMessage = error instanceof Error ? (error).message : String(error);
      this.servers.set(serverId, server);
      this.persistState();
      
      return false;
    }
  }

  /**
   * Stop an MCP server
   */
  async stopServer(serverId: string): Promise<boolean> {
    const server = this.servers.get(serverId);
    
    if (!server || !server.pid) {
      throw new Error(`Server not running: ${serverId}`);
    }

    console.log(chalk.blue(`🛑 Stopping ${server.name} (PID: ${server.pid})...`));

    try {
      process.kill(server.pid, 'SIGTERM');
      
      // Wait a bit then check if it's still running
      setTimeout(() => {
        try {
          process.kill(server.pid!, 0); // Check if process exists
          // Still running, force kill
          process.kill(server.pid!, 'SIGKILL');
        } catch {
          // Process already dead, good
        }
      }, 2000);

      server.status = 'stopped';
      server.pid = undefined;
      this.servers.set(serverId, server);
      this.persistState();

      console.log(chalk.green(`✅ Stopped ${server.name}`));
      return true;
    } catch (error: unknown) {
      console.error(chalk.red(`❌ Failed to stop ${server.name}: ${error}`));
      return false;
    }
  }

  // --- Health Checking ---

  private startHealthChecking() {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, 30000); // Check every 30 seconds
  }

  private async performHealthChecks() {
    for (const [serverId, server] of this.servers) {
      if (server.status === 'running' && server.pid) {
        try {
          // Check if process is still alive
          process.kill(server.pid, 0);
          
          // TODO: Implement actual health endpoint checking
          // For now, just update last seen
          server.lastSeen = new Date();
          server.healthScore = 100;
        } catch {
          // Process is dead
          server.status = 'stopped';
          server.pid = undefined;
          server.healthScore = 0;
        }
      }
    }
    
    this.persistState();
  }

  // --- Token Usage Tracking ---

  recordTokenUsage(serverId: string, inputTokens: number, outputTokens: number, costUSD: number) {
    const existing = this.tokenUsage.get(serverId) || {
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUSD: 0,
      requestCount: 0,
      lastReset: new Date()
    };

    existing.inputTokens += inputTokens;
    existing.outputTokens += outputTokens;
    existing.totalTokens += inputTokens + outputTokens;
    existing.costUSD += costUSD;
    existing.requestCount += 1;

    this.tokenUsage.set(serverId, existing);

    // Update server status
    const server = this.servers.get(serverId);
    if (server) {
      server.tokenUsage = existing;
      this.servers.set(serverId, server);
    }

    this.persistState();
  }

  // --- Getters ---

  listServers(): MCPServerStatus[] {
    return Array.from(this.servers.values());
  }

  listDefinitions(): MCPServerDefinition[] {
    return Array.from(this.definitions.values());
  }

  getServer(serverId: string): MCPServerStatus | undefined {
    return this.servers.get(serverId);
  }

  getDefinition(serverId: string): MCPServerDefinition | undefined {
    return this.definitions.get(serverId);
  }

  getTokenUsage(serverId: string): TokenUsageStats | undefined {
    return this.tokenUsage.get(serverId);
  }

  // --- Persistence ---

  private async loadPersistedState() {
    try {
      const data = await fs.readFile(this.configPath, 'utf8');
      const state = JSON.parse(data);
      
      if (state.servers) {
        this.servers = new Map(state.servers);
      }
      if (state.tokenUsage) {
        this.tokenUsage = new Map(state.tokenUsage);
      }
    } catch {
      // No persisted state or invalid JSON - start fresh
    }
  }

  private async persistState() {
    try {
      await fs.mkdir(join(this.configPath, '..'), { recursive: true });
      
      const state = {
        servers: Array.from(this.servers.entries()),
        tokenUsage: Array.from(this.tokenUsage.entries()),
        lastUpdate: new Date().toISOString()
      };
      
      await fs.writeFile(this.configPath, JSON.stringify(state, null, 2));
    } catch (error: unknown) {
      console.warn(chalk.yellow(`⚠️  Failed to persist registry state: ${error}`));
    }
  }

  // --- Cleanup ---

  destroy() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    this.persistState();
  }
}

// --- Singleton Instance ---

let registryInstance: MCPRegistry | undefined;

export function getMCPRegistry(): MCPRegistry {
  if (!registryInstance) {
    registryInstance = new MCPRegistry();
  }
  return registryInstance;
}

export function resetMCPRegistry() {
  if (registryInstance) {
    registryInstance.destroy();
    registryInstance = undefined;
  }
}