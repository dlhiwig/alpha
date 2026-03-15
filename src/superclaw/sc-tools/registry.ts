/**
 * SuperClaw Tool Registry
 * 
 * Central registry for all available tools with their definitions,
 * handlers, and metadata.
 */

import { shellTool } from './shell';
import { codeAgentShellTool } from './shell/code-agent-shell';
import { browserTools } from './browser';

// --- Tool Interface ---

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  handler: (...args: any[]) => any;
  metadata?: {
    category?: string;
    riskLevel?: 'low' | 'medium' | 'high';
    requiresAuth?: boolean;
    version?: string;
  };
}

export interface ToolExecutionContext {
  userId?: string;
  sessionId?: string;
  timestamp: Date;
  source: string; // e.g., 'swarm', 'cli', 'gateway'
}

export interface ToolExecutionResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  duration: number;
  metadata?: Record<string, any>;
}

// --- Registry Class ---

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private executionLog: Array<{
    toolName: string;
    context: ToolExecutionContext;
    result: ToolExecutionResult;
  }> = [];

  constructor() {
    this.registerBuiltinTools();
  }

  /**
   * Register built-in tools
   */
  private registerBuiltinTools(): void {
    // Register shell tool
    this.register({
      ...shellTool,
      metadata: {
        category: 'system',
        riskLevel: 'high',
        requiresAuth: false,
        version: '1.0.0',
      },
    });

    // Register CodeAgent shell tool
    this.register({
      ...codeAgentShellTool,
      metadata: {
        category: 'system',
        riskLevel: 'high',
        requiresAuth: false,
        version: '1.0.0',
      },
    });

    // Register browser tools
    for (const browserTool of browserTools) {
      this.register(browserTool);
    }
  }

  /**
   * Register a new tool
   */
  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool '${tool.name}' is already registered`);
    }
    
    this.validateToolDefinition(tool);
    this.tools.set(tool.name, tool);
  }

  /**
   * Unregister a tool
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Get a tool by name
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * List all available tools
   */
  list(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    this.tools.forEach(tool => tools.push(tool));
    return tools;
  }

  /**
   * Get tools by category
   */
  getByCategory(category: string): ToolDefinition[] {
    return this.list().filter(tool => tool.metadata?.category === category);
  }

  /**
   * Get tool schemas for LLM integration
   */
  getSchemas(): Array<{
    name: string;
    description: string;
    parameters: any;
  }> {
    return this.list().map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  /**
   * Execute a tool with context
   */
  async execute<T = any>(
    toolName: string, 
    params: any, 
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult<T>> {
    const startTime = Date.now();
    const tool = this.tools.get(toolName);
    
    if (!tool) {
      return {
        success: false,
        error: `Tool '${toolName}' not found`,
        duration: Date.now() - startTime,
      };
    }

    try {
      // Validate parameters
      const validationError = this.validateParameters(tool, params);
      if (validationError) {
        return {
          success: false,
          error: validationError,
          duration: Date.now() - startTime,
        };
      }

      // Execute tool
      const data = await tool.handler(params);
      
      const result: ToolExecutionResult<T> = {
        success: true,
        data,
        duration: Date.now() - startTime,
        metadata: {
          toolName,
          riskLevel: tool.metadata?.riskLevel,
        },
      };

      // Log execution
      this.logExecution(toolName, context, result);
      
      return result;
    } catch (error: unknown) {
      const result: ToolExecutionResult<T> = {
        success: false,
        error: error instanceof Error ? (error as Error).message : String(error),
        duration: Date.now() - startTime,
      };

      // Log failed execution
      this.logExecution(toolName, context, result);
      
      return result;
    }
  }

  /**
   * Validate tool definition
   */
  private validateToolDefinition(tool: ToolDefinition): void {
    if (!tool.name || typeof tool.name !== 'string') {
      throw new Error('Tool name is required and must be a string');
    }
    
    if (!tool.description || typeof tool.description !== 'string') {
      throw new Error('Tool description is required and must be a string');
    }
    
    if (!tool.handler || typeof tool.handler !== 'function') {
      throw new Error('Tool handler is required and must be a function');
    }
    
    if (!tool.parameters || typeof tool.parameters !== 'object') {
      throw new Error('Tool parameters schema is required');
    }
  }

  /**
   * Validate parameters against tool schema
   */
  private validateParameters(tool: ToolDefinition, params: any): string | null {
    const schema = tool.parameters;
    
    if (schema.required) {
      for (const required of schema.required) {
        if (!(required in params)) {
          return `Missing required parameter: ${required}`;
        }
      }
    }
    
    // Basic type validation for known types
    for (const [key, value] of Object.entries(params)) {
      const propSchema = schema.properties?.[key];
      if (!propSchema) continue;
      
      const expectedType = propSchema.type;
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      
      if (expectedType && actualType !== expectedType) {
        return `Parameter '${key}' expected ${expectedType}, got ${actualType}`;
      }
    }
    
    return null;
  }

  /**
   * Log tool execution
   */
  private logExecution(
    toolName: string,
    context: ToolExecutionContext,
    result: ToolExecutionResult
  ): void {
    this.executionLog.push({
      toolName,
      context,
      result,
    });
    
    // Keep only last 1000 executions
    if (this.executionLog.length > 1000) {
      this.executionLog.splice(0, this.executionLog.length - 1000);
    }
  }

  /**
   * Get execution statistics
   */
  getStats(): {
    totalTools: number;
    totalExecutions: number;
    successRate: number;
    toolUsage: Record<string, number>;
    riskLevelBreakdown: Record<string, number>;
  } {
    const totalTools = this.tools.size;
    const totalExecutions = this.executionLog.length;
    const successful = this.executionLog.filter(e => e.result.success).length;
    
    const toolUsage: Record<string, number> = {};
    for (const entry of this.executionLog) {
      toolUsage[entry.toolName] = (toolUsage[entry.toolName] || 0) + 1;
    }
    
    const riskLevelBreakdown: Record<string, number> = {};
    for (const tool of this.tools.values()) {
      const risk = tool.metadata?.riskLevel || 'medium';
      riskLevelBreakdown[risk] = (riskLevelBreakdown[risk] || 0) + 1;
    }
    
    return {
      totalTools,
      totalExecutions,
      successRate: totalExecutions > 0 ? successful / totalExecutions : 0,
      toolUsage,
      riskLevelBreakdown,
    };
  }

  /**
   * Get recent execution history
   */
  getExecutionHistory(limit = 50): Array<{
    toolName: string;
    timestamp: Date;
    success: boolean;
    duration: number;
    source: string;
  }> {
    return this.executionLog
      .slice(-limit)
      .map(entry => ({
        toolName: entry.toolName,
        timestamp: entry.context.timestamp,
        success: entry.result.success,
        duration: entry.result.duration,
        source: entry.context.source,
      }));
  }
}

// --- Singleton Export ---

let registry: ToolRegistry | null = null;

export function getToolRegistry(): ToolRegistry {
  if (!registry) {
    registry = new ToolRegistry();
  }
  return registry;
}

export { shellTool, browserTools };