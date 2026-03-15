// @ts-nocheck
/**
 * SuperClaw MCP Tools Skill
 * 
 * Wraps mcporter CLI to provide MCP server access to SuperClaw agents.
 * Enables agents to use filesystem, GitHub, Docker, web fetch, and more.
 * 
 * @see https://mcporter.dev
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

// --- Types ---

export interface MCPServer {
  name: string;
  description: string;
  toolCount: number;
  status: 'ok' | 'error';
  transport?: string;
}

export interface MCPTool {
  server: string;
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export interface MCPCallOptions {
  /** Server.tool selector (e.g., "filesystem.read_file") */
  selector: string;
  /** Tool arguments as key-value pairs */
  args?: Record<string, unknown>;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Return raw JSON instead of parsed */
  raw?: boolean;
}

export interface MCPCallResult {
  success: boolean;
  server: string;
  tool: string;
  result?: unknown;
  error?: string;
  durationMs: number;
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  server: string;
  fullSelector: string;
  parameters: MCPParameter[];
}

export interface MCPParameter {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

// --- MCP Skill Class ---

export class MCPToolsSkill extends EventEmitter {
  private log = logger.child({ component: 'mcp-skill' });
  private serverCache: MCPServer[] | null = null;
  private toolCache: Map<string, MCPTool[]> = new Map();
  private mcporterPath: string;

  constructor(mcporterPath: string = 'mcporter') {
    super();
    this.mcporterPath = mcporterPath;
  }

  /**
   * List all available MCP servers
   */
  async listServers(refresh = false): Promise<MCPServer[]> {
    if (this.serverCache && !refresh) {
      return this.serverCache;
    }

    try {
      const { stdout } = await execAsync(
        `${this.mcporterPath} list --output json`,
        { timeout: 60000 }
      );
      
      const data = JSON.parse(stdout);
      const servers: MCPServer[] = data.servers || [];
      this.serverCache = servers;
      
      this.log.info({ count: servers.length }, 'MCP servers listed');
      return servers;
    } catch (error: unknown) {
      this.log.error({ error }, 'Failed to list MCP servers');
      throw new Error(`Failed to list MCP servers: ${error}`, { cause: error });
    }
  }

  /**
   * List tools for a specific server
   */
  async listTools(serverName: string, refresh = false): Promise<MCPTool[]> {
    if (this.toolCache.has(serverName) && !refresh) {
      return this.toolCache.get(serverName)!;
    }

    try {
      const { stdout } = await execAsync(
        `${this.mcporterPath} list ${serverName} --schema --output json`,
        { timeout: 30000 }
      );
      
      const data = JSON.parse(stdout);
      const tools: MCPTool[] = (data.tools || []).map((t: any) => ({
        server: serverName,
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        outputSchema: t.outputSchema,
      }));
      
      this.toolCache.set(serverName, tools);
      this.log.debug({ server: serverName, count: tools.length }, 'Tools listed');
      return tools;
    } catch (error: unknown) {
      this.log.error({ server: serverName, error }, 'Failed to list tools');
      throw new Error(`Failed to list tools for ${serverName}: ${error}`, { cause: error });
    }
  }

  /**
   * Get all tools across all servers
   */
  async getAllTools(): Promise<MCPToolDefinition[]> {
    const servers = await this.listServers();
    const allTools: MCPToolDefinition[] = [];

    for (const server of servers) {
      if (server.status !== 'ok') {continue;}
      
      try {
        const tools = await this.listTools(server.name);
        for (const tool of tools) {
          allTools.push({
            name: tool.name,
            description: tool.description,
            server: server.name,
            fullSelector: `${server.name}.${tool.name}`,
            parameters: this.extractParameters(tool.inputSchema),
          });
        }
      } catch (error: unknown) {
        this.log.warn({ server: server.name, error }, 'Skipping server');
      }
    }

    return allTools;
  }

  /**
   * Call an MCP tool
   */
  async call(options: MCPCallOptions): Promise<MCPCallResult> {
    const startTime = Date.now();
    const { selector, args = {}, timeout = 30000 } = options;
    
    const [server, tool] = selector.split('.');
    if (!server || !tool) {
      return {
        success: false,
        server: server || 'unknown',
        tool: tool || 'unknown',
        error: 'Invalid selector format. Use "server.tool"',
        durationMs: Date.now() - startTime,
      };
    }

    try {
      // Build argument string
      const argParts: string[] = [];
      for (const [key, value] of Object.entries(args)) {
        if (typeof value === 'string') {
          // Escape quotes in string values
          argParts.push(`${key}="${value.replace(/"/g, '\\"')}"`);
        } else if (typeof value === 'number' || typeof value === 'boolean') {
          argParts.push(`${key}:${value}`);
        } else if (value !== null && value !== undefined) {
          // JSON for complex types
          argParts.push(`${key}:${JSON.stringify(value)}`);
        }
      }
      
      const argString = argParts.join(' ');
      const cmd = `${this.mcporterPath} call ${selector} ${argString} --output json`;
      
      this.log.debug({ selector, args }, 'Calling MCP tool');
      
      const { stdout, stderr } = await execAsync(cmd, { timeout });
      
      let result: unknown;
      try {
        result = JSON.parse(stdout);
      } catch {
        result = stdout.trim();
      }

      const durationMs = Date.now() - startTime;
      this.log.info({ selector, durationMs, success: true }, 'MCP call complete');
      
      this.emit('call', { selector, args, result, durationMs, success: true });

      return {
        success: true,
        server,
        tool,
        result,
        durationMs,
      };
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      const errorMsg = (error as Error).message || String(error);
      
      this.log.error({ selector, error: errorMsg, durationMs }, 'MCP call failed');
      this.emit('call', { selector, args, error: errorMsg, durationMs, success: false });

      return {
        success: false,
        server,
        tool,
        error: errorMsg,
        durationMs,
      };
    }
  }

  /**
   * Convenience methods for common operations
   */

  async readFile(path: string, options?: { head?: number; tail?: number }): Promise<string> {
    const result = await this.call({
      selector: 'filesystem.read_text_file',
      args: { path, ...options },
    });
    
    if (!result.success) {throw new Error(result.error);}
    return (result.result as any)?.content || String(result.result);
  }

  async writeFile(path: string, content: string): Promise<void> {
    const result = await this.call({
      selector: 'filesystem.write_file',
      args: { path, content },
    });
    
    if (!result.success) {throw new Error(result.error);}
  }

  async listDirectory(path: string): Promise<string[]> {
    const result = await this.call({
      selector: 'filesystem.list_directory',
      args: { path },
    });
    
    if (!result.success) {throw new Error(result.error);}
    return (result.result as any)?.entries || [];
  }

  async webFetch(url: string): Promise<string> {
    const result = await this.call({
      selector: 'fetch.fetch',
      args: { url },
    });
    
    if (!result.success) {throw new Error(result.error);}
    return (result.result as any)?.content || String(result.result);
  }

  async githubListIssues(options: { owner: string; repo: string; state?: string }): Promise<unknown[]> {
    const result = await this.call({
      selector: 'github.list_issues',
      args: options,
    });
    
    if (!result.success) {throw new Error(result.error);}
    return (result.result as any)?.issues || [];
  }

  async dockerListContainers(): Promise<unknown[]> {
    const result = await this.call({
      selector: 'docker.list_containers',
      args: {},
    });
    
    if (!result.success) {throw new Error(result.error);}
    return (result.result as any)?.containers || [];
  }

  async memoryStore(key: string, value: string): Promise<void> {
    const result = await this.call({
      selector: 'memory.store',
      args: { key, value },
    });
    
    if (!result.success) {throw new Error(result.error);}
  }

  async memoryRetrieve(key: string): Promise<string | null> {
    const result = await this.call({
      selector: 'memory.retrieve',
      args: { key },
    });
    
    if (!result.success) {return null;}
    return (result.result as any)?.value || null;
  }

  /**
   * Generate tool descriptions for LLM prompts
   */
  async generateToolPrompt(): Promise<string> {
    const tools = await this.getAllTools();
    
    let prompt = `# Available MCP Tools\n\n`;
    prompt += `You can use these tools by calling them with their selector and arguments.\n\n`;

    // Group by server
    const byServer = new Map<string, MCPToolDefinition[]>();
    for (const tool of tools) {
      if (!byServer.has(tool.server)) {
        byServer.set(tool.server, []);
      }
      byServer.get(tool.server)!.push(tool);
    }

    for (const [server, serverTools] of byServer) {
      prompt += `## ${server}\n\n`;
      for (const tool of serverTools) {
        prompt += `### ${tool.fullSelector}\n`;
        prompt += `${tool.description}\n`;
        if (tool.parameters.length > 0) {
          prompt += `Parameters:\n`;
          for (const param of tool.parameters) {
            const req = param.required ? '(required)' : '(optional)';
            prompt += `- ${param.name}: ${param.type} ${req}`;
            if (param.description) {prompt += ` — ${param.description}`;}
            prompt += '\n';
          }
        }
        prompt += '\n';
      }
    }

    return prompt;
  }

  /**
   * Extract parameters from JSON schema
   */
  private extractParameters(schema?: Record<string, unknown>): MCPParameter[] {
    if (!schema || typeof schema !== 'object') {return [];}
    
    const properties = (schema as any).properties || {};
    const required = new Set((schema as any).required || []);
    
    return Object.entries(properties).map(([name, prop]: [string, any]) => ({
      name,
      type: prop.type || 'string',
      required: required.has(name),
      description: prop.description,
    }));
  }

  /**
   * Clear caches
   */
  clearCache(): void {
    this.serverCache = null;
    this.toolCache.clear();
    this.log.debug('Cache cleared');
  }
}

// --- Singleton ---

let defaultSkill: MCPToolsSkill | null = null;

export function getMCPToolsSkill(): MCPToolsSkill {
  if (!defaultSkill) {
    defaultSkill = new MCPToolsSkill();
  }
  return defaultSkill;
}

export function initMCPToolsSkill(mcporterPath?: string): MCPToolsSkill {
  defaultSkill = new MCPToolsSkill(mcporterPath);
  return defaultSkill;
}

// --- Agent Tool Definitions (for LLM function calling) ---

export const MCP_AGENT_TOOLS = [
  {
    name: 'mcp_call',
    description: 'Call any MCP tool by selector (e.g., "filesystem.read_file", "github.list_issues")',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'Tool selector in format "server.tool"',
        },
        args: {
          type: 'object',
          description: 'Tool arguments as key-value pairs',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'mcp_list_servers',
    description: 'List all available MCP servers',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'mcp_list_tools',
    description: 'List tools available on a specific MCP server',
    parameters: {
      type: 'object',
      properties: {
        server: {
          type: 'string',
          description: 'Server name (e.g., "filesystem", "github")',
        },
      },
      required: ['server'],
    },
  },
];
