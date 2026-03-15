// @ts-nocheck
/**
 * Tool Executor for SuperClaw
 * 
 * Parses tool calls from LLM responses and executes them safely.
 */

import { ITool, ToolResult, ToolCall, ToolExecutionContext, ToolRegistry, ToolExecutionError, ToolErrorType } from './contracts';

/**
 * Configuration for tool execution
 */
export interface ExecutorConfig {
  /** Maximum execution time per tool (ms) */
  timeout: number;
  /** Maximum number of concurrent tool executions */
  maxConcurrent: number;
  /** Whether to validate parameters strictly */
  strictValidation: boolean;
  /** Default execution context */
  defaultContext?: Partial<ToolExecutionContext>;
}

/**
 * Default executor configuration
 */
const DEFAULT_EXECUTOR_CONFIG: ExecutorConfig = {
  timeout: 30000, // 30 seconds
  maxConcurrent: 5,
  strictValidation: true,
  defaultContext: {
    securityLevel: 'sandbox',
    workingDir: '/tmp'
  }
};

/**
 * Tool execution result with timing and metadata
 */
export interface ExecutionResult {
  /** The tool call that was executed */
  call: ToolCall;
  /** The result of the execution */
  result: ToolResult;
  /** Execution timing information */
  timing: {
    started: string;
    completed: string;
    duration: number;
  };
}

/**
 * Tool executor that can parse and execute tool calls
 */
export class ToolExecutor {
  private registry: ToolRegistry;
  private config: ExecutorConfig;
  private activeExecutions = new Map<string, Promise<ExecutionResult>>();

  constructor(registry: ToolRegistry, config?: Partial<ExecutorConfig>) {
    this.registry = registry;
    this.config = { ...DEFAULT_EXECUTOR_CONFIG, ...config };
  }

  /**
   * Parse tool calls from various LLM response formats
   */
  parseToolCalls(response: string): ToolCall[] {
    const toolCalls: ToolCall[] = [];

    try {
      // Try to parse as JSON first (OpenAI format)
      const parsed = JSON.parse(response);
      
      if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
        // OpenAI function calling format
        for (const call of parsed.tool_calls) {
          if (call.function) {
            toolCalls.push({
              id: call.id,
              name: call.function.name,
              parameters: typeof call.function.arguments === 'string' 
                ? JSON.parse(call.function.arguments) 
                : call.function.arguments
            });
          }
        }
      } else if (parsed.name && parsed.parameters) {
        // Single tool call format
        toolCalls.push({
          name: parsed.name,
          parameters: parsed.parameters
        });
      }
    } catch (jsonError) {
      // Try to parse tool calls from markdown/text format
      const toolCallRegex = /```(?:json|tool|function)\s*\n([\s\S]*?)\n```/gi;
      let match;

      while ((match = toolCallRegex.exec(response)) !== null) {
        try {
          const callData = JSON.parse(match[1]);
          if (callData.name || callData.tool_name) {
            toolCalls.push({
              name: callData.name || callData.tool_name,
              parameters: callData.parameters || callData.params || {},
              id: callData.id
            });
          }
        } catch (parseError) {
          console.warn('Failed to parse tool call from markdown block:', parseError);
        }
      }

      // Try XML-style tool calls (Claude format)
      const xmlToolRegex = /<tool_call[^>]*>\s*<name>(.*?)<\/name>\s*<parameters>([\s\S]*?)<\/parameters>\s*<\/tool_call>/gi;
      let xmlMatch;

      while ((xmlMatch = xmlToolRegex.exec(response)) !== null) {
        try {
          const name = xmlMatch[1].trim();
          const parametersText = xmlMatch[2].trim();
          let parameters = {};

          // Try to parse as JSON
          try {
            parameters = JSON.parse(parametersText);
          } catch {
            // If not JSON, try to parse as key-value pairs
            const kvRegex = /<(\w+)>(.*?)<\/\1>/g;
            let kvMatch;
            while ((kvMatch = kvRegex.exec(parametersText)) !== null) {
              // @ts-expect-error - Post-Merge Reconciliation
              parameters[kvMatch[1]] = kvMatch[2];
            }
          }

          toolCalls.push({
            name: name,
            parameters: parameters
          });
        } catch (parseError) {
          console.warn('Failed to parse XML tool call:', parseError);
        }
      }
    }

    return toolCalls;
  }

  /**
   * Validate tool parameters against tool definition
   */
  private validateParameters(tool: ITool, parameters: Record<string, any>): void {
    if (!this.config.strictValidation) {return;}

    for (const paramDef of tool.parameters) {
      const value = parameters[paramDef.name];

      // Check required parameters
      if (paramDef.required && (value === undefined || value === null)) {
        throw new ToolExecutionError(
          ToolErrorType.INVALID_PARAMETERS,
          `Required parameter '${paramDef.name}' is missing`,
          tool.name
        );
      }

      // Skip validation if parameter is not provided and not required
      if (value === undefined || value === null) {continue;}

      // Type validation
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (actualType !== paramDef.type) {
        throw new ToolExecutionError(
          ToolErrorType.INVALID_PARAMETERS,
          `Parameter '${paramDef.name}' expected ${paramDef.type} but got ${actualType}`,
          tool.name
        );
      }

      // Validation rules
      if (paramDef.validation) {
        const validation = paramDef.validation;

        // Number range validation
        if (typeof value === 'number') {
          if (validation.min !== undefined && value < validation.min) {
            throw new ToolExecutionError(
              ToolErrorType.INVALID_PARAMETERS,
              `Parameter '${paramDef.name}' value ${value} is below minimum ${validation.min}`,
              tool.name
            );
          }
          if (validation.max !== undefined && value > validation.max) {
            throw new ToolExecutionError(
              ToolErrorType.INVALID_PARAMETERS,
              `Parameter '${paramDef.name}' value ${value} is above maximum ${validation.max}`,
              tool.name
            );
          }
        }

        // String pattern validation
        if (typeof value === 'string' && validation.pattern) {
          const regex = new RegExp(validation.pattern);
          if (!regex.test(value)) {
            throw new ToolExecutionError(
              ToolErrorType.INVALID_PARAMETERS,
              `Parameter '${paramDef.name}' does not match required pattern: ${validation.pattern}`,
              tool.name
            );
          }
        }

        // Enum validation
        if (validation.enum && !validation.enum.includes(value)) {
          throw new ToolExecutionError(
            ToolErrorType.INVALID_PARAMETERS,
            `Parameter '${paramDef.name}' must be one of: ${validation.enum.join(', ')}`,
            tool.name
          );
        }
      }
    }

    // Add default values for missing optional parameters
    for (const paramDef of tool.parameters) {
      if (parameters[paramDef.name] === undefined && paramDef.default !== undefined) {
        parameters[paramDef.name] = paramDef.default;
      }
    }
  }

  /**
   * Execute a single tool call with timeout protection
   */
  async executeTool(call: ToolCall, context?: ToolExecutionContext): Promise<ExecutionResult> {
    const startTime = Date.now();
    const started = new Date().toISOString();

    try {
      // Check if tool exists
      const tool = this.registry.get(call.name);
      if (!tool) {
        throw new ToolExecutionError(
          ToolErrorType.TOOL_NOT_FOUND,
          `Tool '${call.name}' not found in registry`,
          call.name
        );
      }

      // Validate parameters
      this.validateParameters(tool, call.parameters);

      // Merge context with defaults
      const executionContext: ToolExecutionContext = {
        ...this.config.defaultContext,
        ...context,
        sessionId: context?.sessionId || `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      };

      // Execute with timeout
      const executePromise = tool.execute(call.parameters, executionContext);
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new ToolExecutionError(
            ToolErrorType.TIMEOUT,
            `Tool execution timed out after ${this.config.timeout}ms`,
            call.name
          ));
        }, this.config.timeout);
      });

      const result = await Promise.race([executePromise, timeoutPromise]);

      const completed = new Date().toISOString();
      const duration = Date.now() - startTime;

      return {
        call,
        result,
        timing: {
          started,
          completed,
          duration
        }
      };

    } catch (error: unknown) {
      const completed = new Date().toISOString();
      const duration = Date.now() - startTime;

      let toolResult: ToolResult;

      if (error instanceof ToolExecutionError) {
        toolResult = {
          success: false,
          error: (error as Error).message,
          metadata: {
            timestamp: completed,
            executionTime: duration,
            toolName: call.name,
            errorType: error.type
          }
        };
      } else {
        toolResult = {
          success: false,
          error: `Unexpected error: ${error instanceof Error ? (error).message : 'Unknown error'}`,
          metadata: {
            timestamp: completed,
            executionTime: duration,
            toolName: call.name,
            errorType: ToolErrorType.EXECUTION_FAILED
          }
        };
      }

      return {
        call,
        result: toolResult,
        timing: {
          started,
          completed,
          duration
        }
      };
    }
  }

  /**
   * Execute multiple tool calls, respecting concurrency limits
   */
  async executeToolCalls(calls: ToolCall[], context?: ToolExecutionContext): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];

    // Execute in batches to respect concurrency limits
    for (let i = 0; i < calls.length; i += this.config.maxConcurrent) {
      const batch = calls.slice(i, i + this.config.maxConcurrent);
      const batchPromises = batch.map(call => this.executeTool(call, context));
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Parse and execute tool calls from LLM response
   */
  async parseAndExecute(response: string, context?: ToolExecutionContext): Promise<ExecutionResult[]> {
    const toolCalls = this.parseToolCalls(response);
    
    if (toolCalls.length === 0) {
      return [];
    }

    return this.executeToolCalls(toolCalls, context);
  }

  /**
   * Format execution results for LLM consumption
   */
  formatResults(results: ExecutionResult[]): string {
    if (results.length === 0) {
      return 'No tools were executed.';
    }

    const formatted = results.map(result => {
      const { call, result: toolResult, timing } = result;
      
      let output = `## ${call.name}\n`;
      output += `**Status:** ${toolResult.success ? '✅ Success' : '❌ Failed'}\n`;
      output += `**Duration:** ${timing.duration}ms\n`;
      
      if (toolResult.success) {
        output += `**Output:**\n\`\`\`json\n${JSON.stringify(toolResult.output, null, 2)}\n\`\`\`\n`;
      } else {
        output += `**Error:** ${toolResult.error}\n`;
      }
      
      return output;
    }).join('\n---\n\n');

    return `# Tool Execution Results\n\n${formatted}`;
  }

  /**
   * Get current execution statistics
   */
  getStats(): { activeExecutions: number; totalTools: number } {
    return {
      activeExecutions: this.activeExecutions.size,
      totalTools: this.registry.list().length
    };
  }
}

/**
 * Create a configured tool executor with file operations
 */
export function createFileOpsExecutor(): ToolExecutor {
  const registry = new ToolRegistry();
  
  // Import and register file operation tools
  const { fileOperationTools } = require('./file-ops');
  
  for (const tool of fileOperationTools) {
    registry.register(tool);
  }

  return new ToolExecutor(registry);
}