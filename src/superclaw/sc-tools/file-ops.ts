/**
 * File Operations Tools for SuperClaw
 * 
 * Implements basic file system operations with security sandboxing.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { ITool, ToolResult, ToolExecutionContext, ToolParameter, ToolExecutionError, ToolErrorType } from './contracts';

/**
 * Security configuration for file operations
 */
export interface FileOpsConfig {
  /** Allowed base paths for file operations */
  allowedPaths: string[];
  /** Maximum file size for read operations (bytes) */
  maxFileSize: number;
  /** Maximum directory depth for listing */
  maxDepth: number;
  /** Whether to allow creation of new directories */
  allowDirectoryCreation: boolean;
}

/**
 * Default security configuration
 */
const DEFAULT_CONFIG: FileOpsConfig = {
  allowedPaths: [
    '/tmp',
    '/home/toba/superclaw',
    '/home/toba/.openclaw/workspace'
  ],
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxDepth: 10,
  allowDirectoryCreation: true
};

/**
 * Validate and normalize file paths for security
 */
function validatePath(filePath: string, config: FileOpsConfig): string {
  try {
    const resolvedPath = path.resolve(filePath);
    
    // Check if path is within allowed directories
    const isAllowed = config.allowedPaths.some(allowedPath => {
      const resolvedAllowed = path.resolve(allowedPath);
      return resolvedPath.startsWith(resolvedAllowed);
    });

    if (!isAllowed) {
      throw new ToolExecutionError(
        ToolErrorType.PERMISSION_DENIED,
        `Path '${filePath}' is not within allowed directories: ${config.allowedPaths.join(', ')}`,
        'file_ops'
      );
    }

    return resolvedPath;
  } catch (error: unknown) {
    throw new ToolExecutionError(
      ToolErrorType.INVALID_PARAMETERS,
      `Invalid file path: ${error instanceof Error ? (error as Error).message : 'Unknown error'}`,
      'file_ops'
    );
  }
}

/**
 * Log file operations for audit trail
 */
function logOperation(operation: string, filePath: string, context?: ToolExecutionContext): void {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] FILE_OP: ${operation} - ${filePath} (session: ${context?.sessionId || 'unknown'})`);
}

/**
 * Read file contents with optional line range
 */
export class ReadFileTool implements ITool {
  name = 'read_file';
  description = 'Read contents of a file with optional line range specification';
  category = 'file_operations';
  
  parameters: ToolParameter[] = [
    {
      name: 'path',
      type: 'string',
      description: 'Path to the file to read',
      required: true
    },
    {
      name: 'start_line',
      type: 'number',
      description: 'Starting line number (1-indexed, optional)',
      required: false,
      validation: { min: 1 }
    },
    {
      name: 'end_line',
      type: 'number',
      description: 'Ending line number (1-indexed, optional)',
      required: false,
      validation: { min: 1 }
    },
    {
      name: 'encoding',
      type: 'string',
      description: 'File encoding',
      required: false,
      default: 'utf8',
      validation: { enum: ['utf8', 'ascii', 'base64', 'hex'] }
    }
  ];

  async execute(params: Record<string, any>, context?: ToolExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    
    try {
      const filePath = validatePath(params.path, DEFAULT_CONFIG);
      const encoding = params.encoding || 'utf8';
      
      logOperation('READ', filePath, context);
      
      // Check if file exists and is readable
      const stats = await fs.stat(filePath);
      
      if (!stats.isFile()) {
        throw new ToolExecutionError(
          ToolErrorType.INVALID_PARAMETERS,
          `Path '${params.path}' is not a file`,
          this.name
        );
      }
      
      // Check file size
      if (stats.size > DEFAULT_CONFIG.maxFileSize) {
        throw new ToolExecutionError(
          ToolErrorType.EXECUTION_FAILED,
          `File too large: ${stats.size} bytes (max: ${DEFAULT_CONFIG.maxFileSize})`,
          this.name
        );
      }
      
      // Read file content
      const content = await fs.readFile(filePath, encoding as BufferEncoding);
      
      // Handle line range if specified
      let output: string;
      if (params.start_line || params.end_line) {
        const lines = content.split('\n');
        const startLine = Math.max(1, params.start_line || 1) - 1;
        const endLine = Math.min(lines.length, params.end_line || lines.length);
        
        output = lines.slice(startLine, endLine).join('\n');
      } else {
        output = content;
      }
      
      return {
        success: true,
        output: {
          content: output,
          encoding: encoding,
          size: stats.size,
          lines: output.split('\n').length,
          path: filePath
        },
        metadata: {
          timestamp: new Date().toISOString(),
          executionTime: Date.now() - startTime,
          toolName: this.name
        }
      };
      
    } catch (error: unknown) {
      if (error instanceof ToolExecutionError) {
        throw error;
      }
      
      return {
        success: false,
        error: `Failed to read file: ${error instanceof Error ? (error as Error).message : 'Unknown error'}`,
        metadata: {
          timestamp: new Date().toISOString(),
          executionTime: Date.now() - startTime,
          toolName: this.name
        }
      };
    }
  }
}

/**
 * Write content to a file (create or overwrite)
 */
export class WriteFileTool implements ITool {
  name = 'write_file';
  description = 'Create or overwrite a file with specified content';
  category = 'file_operations';
  
  parameters: ToolParameter[] = [
    {
      name: 'path',
      type: 'string',
      description: 'Path where to write the file',
      required: true
    },
    {
      name: 'content',
      type: 'string',
      description: 'Content to write to the file',
      required: true
    },
    {
      name: 'encoding',
      type: 'string',
      description: 'File encoding',
      required: false,
      default: 'utf8',
      validation: { enum: ['utf8', 'ascii', 'base64', 'hex'] }
    },
    {
      name: 'create_directories',
      type: 'boolean',
      description: 'Create parent directories if they don\'t exist',
      required: false,
      default: false
    }
  ];

  async execute(params: Record<string, any>, context?: ToolExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    
    try {
      const filePath = validatePath(params.path, DEFAULT_CONFIG);
      const encoding = params.encoding || 'utf8';
      const createDirectories = params.create_directories || false;
      
      logOperation('WRITE', filePath, context);
      
      // Create parent directories if requested and allowed
      if (createDirectories && DEFAULT_CONFIG.allowDirectoryCreation) {
        const parentDir = path.dirname(filePath);
        await fs.mkdir(parentDir, { recursive: true });
      }
      
      // Write file content
      await fs.writeFile(filePath, params.content, encoding as BufferEncoding);
      
      // Get file stats for response
      const stats = await fs.stat(filePath);
      
      return {
        success: true,
        output: {
          path: filePath,
          size: stats.size,
          created: stats.birthtime.toISOString(),
          modified: stats.mtime.toISOString()
        },
        metadata: {
          timestamp: new Date().toISOString(),
          executionTime: Date.now() - startTime,
          toolName: this.name
        }
      };
      
    } catch (error: unknown) {
      if (error instanceof ToolExecutionError) {
        throw error;
      }
      
      return {
        success: false,
        error: `Failed to write file: ${error instanceof Error ? (error as Error).message : 'Unknown error'}`,
        metadata: {
          timestamp: new Date().toISOString(),
          executionTime: Date.now() - startTime,
          toolName: this.name
        }
      };
    }
  }
}

/**
 * Edit file by replacing exact text
 */
export class EditFileTool implements ITool {
  name = 'edit_file';
  description = 'Edit a file by replacing exact text with new text';
  category = 'file_operations';
  
  parameters: ToolParameter[] = [
    {
      name: 'path',
      type: 'string',
      description: 'Path to the file to edit',
      required: true
    },
    {
      name: 'old_text',
      type: 'string',
      description: 'Exact text to find and replace (must match exactly)',
      required: true
    },
    {
      name: 'new_text',
      type: 'string',
      description: 'New text to replace the old text with',
      required: true
    },
    {
      name: 'encoding',
      type: 'string',
      description: 'File encoding',
      required: false,
      default: 'utf8',
      validation: { enum: ['utf8', 'ascii'] }
    }
  ];

  async execute(params: Record<string, any>, context?: ToolExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    
    try {
      const filePath = validatePath(params.path, DEFAULT_CONFIG);
      const encoding = params.encoding || 'utf8';
      
      logOperation('EDIT', filePath, context);
      
      // Read current content
      const currentContent = await fs.readFile(filePath, encoding as BufferEncoding);
      
      // Check if old text exists
      if (!currentContent.includes(params.old_text)) {
        throw new ToolExecutionError(
          ToolErrorType.EXECUTION_FAILED,
          `Text to replace not found in file: '${params.old_text.substring(0, 100)}${params.old_text.length > 100 ? '...' : ''}'`,
          this.name
        );
      }
      
      // Replace text (only first occurrence to be safe)
      const newContent = currentContent.replace(params.old_text, params.new_text);
      
      // Write back to file
      await fs.writeFile(filePath, newContent, encoding as BufferEncoding);
      
      // Get file stats for response
      const stats = await fs.stat(filePath);
      
      return {
        success: true,
        output: {
          path: filePath,
          size: stats.size,
          modified: stats.mtime.toISOString(),
          changes: {
            old_length: params.old_text.length,
            new_length: params.new_text.length,
            size_diff: params.new_text.length - params.old_text.length
          }
        },
        metadata: {
          timestamp: new Date().toISOString(),
          executionTime: Date.now() - startTime,
          toolName: this.name
        }
      };
      
    } catch (error: unknown) {
      if (error instanceof ToolExecutionError) {
        throw error;
      }
      
      return {
        success: false,
        error: `Failed to edit file: ${error instanceof Error ? (error as Error).message : 'Unknown error'}`,
        metadata: {
          timestamp: new Date().toISOString(),
          executionTime: Date.now() - startTime,
          toolName: this.name
        }
      };
    }
  }
}

/**
 * List files and directories
 */
export class ListDirectoryTool implements ITool {
  name = 'list_directory';
  description = 'List files and directories in a specified path';
  category = 'file_operations';
  
  parameters: ToolParameter[] = [
    {
      name: 'path',
      type: 'string',
      description: 'Directory path to list',
      required: true
    },
    {
      name: 'show_hidden',
      type: 'boolean',
      description: 'Include hidden files (starting with .)',
      required: false,
      default: false
    },
    {
      name: 'recursive',
      type: 'boolean',
      description: 'List files recursively',
      required: false,
      default: false
    },
    {
      name: 'max_depth',
      type: 'number',
      description: 'Maximum recursion depth (only if recursive=true)',
      required: false,
      default: 3,
      validation: { min: 1, max: 10 }
    }
  ];

  async execute(params: Record<string, any>, context?: ToolExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    
    try {
      const dirPath = validatePath(params.path, DEFAULT_CONFIG);
      const showHidden = params.show_hidden || false;
      const recursive = params.recursive || false;
      const maxDepth = Math.min(params.max_depth || 3, DEFAULT_CONFIG.maxDepth);
      
      logOperation('LIST', dirPath, context);
      
      // Check if path exists and is a directory
      const stats = await fs.stat(dirPath);
      
      if (!stats.isDirectory()) {
        throw new ToolExecutionError(
          ToolErrorType.INVALID_PARAMETERS,
          `Path '${params.path}' is not a directory`,
          this.name
        );
      }
      
      const files: any[] = [];
      
      async function listRecursive(currentPath: string, depth: number): Promise<void> {
        if (depth > maxDepth) return;
        
        const entries = await fs.readdir(currentPath, { withFileTypes: true });
        
        for (const entry of entries) {
          // Skip hidden files unless requested
          if (!showHidden && entry.name.startsWith('.')) continue;
          
          const fullPath = path.join(currentPath, entry.name);
          const relativePath = path.relative(dirPath, fullPath);
          
          try {
            const entryStats = await fs.stat(fullPath);
            
            const fileInfo = {
              name: entry.name,
              path: relativePath,
              fullPath: fullPath,
              type: entry.isDirectory() ? 'directory' : 'file',
              size: entry.isFile() ? entryStats.size : null,
              modified: entryStats.mtime.toISOString(),
              permissions: {
                readable: true, // We'll assume readable if we can stat it
                writable: true, // This is a simplification
                executable: entry.isFile() && (entryStats.mode & 0o111) !== 0
              },
              depth: depth
            };
            
            files.push(fileInfo);
            
            // Recurse into subdirectories if requested
            if (recursive && entry.isDirectory() && depth < maxDepth) {
              await listRecursive(fullPath, depth + 1);
            }
          } catch (error: unknown) {
            // Skip entries we can't access
            console.warn(`Cannot access ${fullPath}: ${error}`);
          }
        }
      }
      
      await listRecursive(dirPath, 0);
      
      return {
        success: true,
        output: {
          directory: dirPath,
          files: files,
          total_count: files.length,
          directories: files.filter(f => f.type === 'directory').length,
          files_count: files.filter(f => f.type === 'file').length
        },
        metadata: {
          timestamp: new Date().toISOString(),
          executionTime: Date.now() - startTime,
          toolName: this.name
        }
      };
      
    } catch (error: unknown) {
      if (error instanceof ToolExecutionError) {
        throw error;
      }
      
      return {
        success: false,
        error: `Failed to list directory: ${error instanceof Error ? (error as Error).message : 'Unknown error'}`,
        metadata: {
          timestamp: new Date().toISOString(),
          executionTime: Date.now() - startTime,
          toolName: this.name
        }
      };
    }
  }
}

/**
 * Export all file operation tools
 */
export const fileOperationTools = [
  new ReadFileTool(),
  new WriteFileTool(),
  new EditFileTool(),
  new ListDirectoryTool()
];