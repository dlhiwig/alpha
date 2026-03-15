// @ts-nocheck
/**
 * SuperClaw Standalone Tool Manager
 * Built-in tools to replace OpenClaw's remote skills system
 */

import { AgentContext } from '../agent/executor';

export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
  execute(args: Record<string, any>, context: AgentContext): Promise<any>;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

interface ToolParameterSchema {
  type: 'object';
  properties: Record<string, any>;
  required?: string[];
}

export class ToolManager {
  private tools = new Map<string, Tool>();
  
  constructor() {
    this.registerBuiltInTools();
  }
  
  private registerBuiltInTools(): void {
    // File operations
    this.registerTool(new ReadFileTool());
    this.registerTool(new WriteFileTool());
    this.registerTool(new EditFileTool());
    
    // Shell execution
    this.registerTool(new ExecTool());
    
    // Web operations - TODO: Implement these
    // this.registerTool(new WebSearchTool());
    // this.registerTool(new WebFetchTool());
    
    // Utility tools
    this.registerTool(new ListFilesTool());
  }
  
  registerTool(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }
  
  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }
  
  getAvailableTools(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));
  }
  
  async execute(name: string, args: Record<string, any>, context: AgentContext): Promise<any> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    
    try {
      return await tool.execute(args, context);
    } catch (error: unknown) {
      console.error(`Tool execution failed for ${name}:`, error);
      throw error;
    }
  }
  
  listTools(): string[] {
    return Array.from(this.tools.keys());
  }
}

// Built-in tool implementations

class ReadFileTool implements Tool {
  name = 'read_file';
  description = 'Read the contents of a file';
  parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to read' },
      encoding: { type: 'string', description: 'File encoding (default: utf-8)', default: 'utf-8' }
    },
    required: ['path']
  };
  
  async execute(args: { path: string; encoding?: string }, context: AgentContext): Promise<any> {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    try {
      // Basic path safety - prevent directory traversal
      const safePath = path.resolve(context.workspace, args.path);
      if (!safePath.startsWith(context.workspace)) {
        throw new Error('Path is outside workspace');
      }
      
      const content = await fs.readFile(safePath, { encoding: (args.encoding as BufferEncoding) || 'utf-8' });
      return {
        success: true,
        content,
        path: args.path,
        size: content.length
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: (error as Error).message,
        path: args.path
      };
    }
  }
}

class WriteFileTool implements Tool {
  name = 'write_file';
  description = 'Write content to a file';
  parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to write' },
      content: { type: 'string', description: 'Content to write to the file' },
      encoding: { type: 'string', description: 'File encoding (default: utf-8)', default: 'utf-8' }
    },
    required: ['path', 'content']
  };
  
  async execute(args: { path: string; content: string; encoding?: string }, context: AgentContext): Promise<any> {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    try {
      // Basic path safety - prevent directory traversal
      const safePath = path.resolve(context.workspace, args.path);
      if (!safePath.startsWith(context.workspace)) {
        throw new Error('Path is outside workspace');
      }
      
      // Create directory if it doesn't exist
      const dirPath = path.dirname(safePath);
      await fs.mkdir(dirPath, { recursive: true });
      
      await fs.writeFile(safePath, args.content, { encoding: (args.encoding as BufferEncoding) || 'utf-8' });
      return {
        success: true,
        path: args.path,
        bytesWritten: Buffer.byteLength(args.content, (args.encoding as BufferEncoding) || 'utf-8')
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: (error as Error).message,
        path: args.path
      };
    }
  }
}

class EditFileTool implements Tool {
  name = 'edit_file';
  description = 'Edit a file by replacing specific text';
  parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to edit' },
      old_text: { type: 'string', description: 'Text to find and replace' },
      new_text: { type: 'string', description: 'Text to replace with' }
    },
    required: ['path', 'old_text', 'new_text']
  };
  
  async execute(args: { path: string; old_text: string; new_text: string }, context: AgentContext): Promise<any> {
    // TODO: Implement file editing with workspace sandboxing
    return {
      success: false,
      error: 'File operations not implemented yet'
    };
  }
}

class ExecTool implements Tool {
  name = 'exec';
  description = 'Execute a shell command';
  parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to execute' },
      timeout: { type: 'number', description: 'Timeout in seconds (default: 30)', default: 30 },
      cwd: { type: 'string', description: 'Working directory for command execution' }
    },
    required: ['command']
  };
  
  async execute(args: { command: string; timeout?: number; cwd?: string }, context: AgentContext): Promise<any> {
    // TODO: Implement shell execution with proper sandboxing and security
    return {
      success: false,
      error: 'Shell execution not implemented yet'
    };
  }
}

// Web tools are now imported from separate modules

class ListFilesTool implements Tool {
  name = 'list_files';
  description = 'List files and directories in a path';
  parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory path to list (default: current workspace)', default: '.' },
      recursive: { type: 'boolean', description: 'List files recursively', default: false },
      max_depth: { type: 'number', description: 'Maximum depth for recursive listing', default: 3 }
    }
  };
  
  async execute(args: { path?: string; recursive?: boolean; max_depth?: number }, context: AgentContext): Promise<any> {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    try {
      const targetPath = args.path || '.';
      const safePath = path.resolve(context.workspace, targetPath);
      
      // Basic path safety
      if (!safePath.startsWith(context.workspace)) {
        throw new Error('Path is outside workspace');
      }
      
      const stats = await fs.stat(safePath);
      if (!stats.isDirectory()) {
        return {
          success: false,
          error: 'Path is not a directory',
          path: targetPath
        };
      }
      
      // @ts-expect-error - Post-Merge Reconciliation
      const files = [];
      
      const readDir = async (dirPath: string, currentDepth = 0): Promise<void> => {
        if (args.recursive && currentDepth >= (args.max_depth || 3)) {
          return;
        }
        
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          const relativePath = path.relative(context.workspace, fullPath);
          
          const fileInfo = {
            name: entry.name,
            path: relativePath,
            type: entry.isDirectory() ? 'directory' : 'file',
            size: entry.isFile() ? (await fs.stat(fullPath)).size : undefined
          };
          
          files.push(fileInfo);
          
          if (args.recursive && entry.isDirectory()) {
            await readDir(fullPath, currentDepth + 1);
          }
        }
      };
      
      await readDir(safePath);
      
      return {
        success: true,
        path: targetPath,
        // @ts-expect-error - Post-Merge Reconciliation
        files,
        count: files.length
      };
      
    } catch (error: unknown) {
      return {
        success: false,
        error: (error as Error).message,
        path: args.path || '.'
      };
    }
  }
}