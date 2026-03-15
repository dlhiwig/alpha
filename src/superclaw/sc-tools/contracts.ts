/**
 * Tool System Contracts for SuperClaw
 * 
 * Defines interfaces and types for the tool execution system.
 * Tools are functions that LLMs can call to perform actions like file operations.
 */

/**
 * Result of tool execution
 */
export interface ToolResult {
  /** Whether the tool execution was successful */
  success: boolean;
  /** Output data from the tool (JSON-serializable) */
  output?: any;
  /** Error message if execution failed */
  error?: string;
  /** Additional metadata about the execution */
  metadata?: {
    timestamp: string;
    executionTime?: number;
    toolName: string;
    [key: string]: any;
  };
}

/**
 * Parameter definition for a tool
 */
export interface ToolParameter {
  /** Parameter name */
  name: string;
  /** Parameter type (string, number, boolean, array, object) */
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  /** Human-readable description */
  description: string;
  /** Whether this parameter is required */
  required: boolean;
  /** Default value if not provided */
  default?: any;
  /** Validation rules */
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    enum?: any[];
  };
}

/**
 * Tool interface that all tools must implement
 */
export interface ITool {
  /** Unique tool name */
  name: string;
  /** Human-readable description of what the tool does */
  description: string;
  /** Tool parameters definition */
  parameters: ToolParameter[];
  /** Tool category for organization */
  category?: string;
  /** Whether this tool requires elevated permissions */
  requiresElevation?: boolean;
  /** Allowed file paths for file operations (security) */
  allowedPaths?: string[];
  
  /**
   * Execute the tool with given parameters
   * @param params Parameters passed to the tool
   * @param context Additional context (user, session, etc.)
   */
  execute(params: Record<string, any>, context?: ToolExecutionContext): Promise<ToolResult>;
}

/**
 * Context provided during tool execution
 */
export interface ToolExecutionContext {
  /** Current user (if applicable) */
  userId?: string;
  /** Session ID */
  sessionId?: string;
  /** Current working directory */
  workingDir?: string;
  /** Security level */
  securityLevel?: 'sandbox' | 'user' | 'elevated';
  /** Additional context data */
  metadata?: Record<string, any>;
}

/**
 * Tool registry for managing available tools
 */
export class ToolRegistry {
  private tools: Map<string, ITool> = new Map();

  /**
   * Register a new tool
   */
  register(tool: ITool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool with name '${tool.name}' already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * Unregister a tool
   */
  unregister(toolName: string): boolean {
    return this.tools.delete(toolName);
  }

  /**
   * Get a tool by name
   */
  get(toolName: string): ITool | undefined {
    return this.tools.get(toolName);
  }

  /**
   * List all registered tools
   */
  list(): ITool[] {
    return Array.from(this.tools.values());
  }

  /**
   * List tools by category
   */
  listByCategory(category: string): ITool[] {
    return this.list().filter(tool => tool.category === category);
  }

  /**
   * Get tool names for OpenAI function calling format
   */
  getFunctionDefinitions(): any[] {
    return this.list().map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: tool.parameters.reduce((props, param) => {
          props[param.name] = {
            type: param.type,
            description: param.description,
            ...(param.validation?.enum && { enum: param.validation.enum })
          };
          return props;
        }, {} as any),
        required: tool.parameters.filter(p => p.required).map(p => p.name)
      }
    }));
  }

  /**
   * Clear all registered tools
   */
  clear(): void {
    this.tools.clear();
  }
}

/**
 * Tool call parsed from LLM response
 */
export interface ToolCall {
  /** Tool name to execute */
  name: string;
  /** Parameters to pass to the tool */
  parameters: Record<string, any>;
  /** Call ID for tracking */
  id?: string;
}

/**
 * Error types for tool execution
 */
export enum ToolErrorType {
  TOOL_NOT_FOUND = 'TOOL_NOT_FOUND',
  INVALID_PARAMETERS = 'INVALID_PARAMETERS',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  EXECUTION_FAILED = 'EXECUTION_FAILED',
  TIMEOUT = 'TIMEOUT',
  RATE_LIMIT = 'RATE_LIMIT'
}

/**
 * Tool execution error
 */
export class ToolExecutionError extends Error {
  constructor(
    public type: ToolErrorType,
    message: string,
    public toolName?: string,
    public details?: any
  ) {
    super(message);
    this.name = 'ToolExecutionError';
  }
}

/**
 * Default global tool registry instance
 */
export const globalToolRegistry = new ToolRegistry();