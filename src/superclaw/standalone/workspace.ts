import { promises as fs } from 'fs';
import { join, resolve, normalize, relative } from 'path';

export interface WorkspaceConfig {
  root: string;
  allowedExtensions?: string[]; // default: allow all
  maxFileSize?: number; // in bytes, default: 50MB
}

/**
 * Workspace Manager for SuperClaw - handles safe file operations within workspace
 * 
 * Features:
 * - Configurable workspace root
 * - Safe path resolution (prevents directory traversal)
 * - File type restrictions
 * - Size limits
 * - Automatic directory creation
 */
export class WorkspaceManager {
  private root: string;
  private allowedExtensions: Set<string> | null;
  private maxFileSize: number;

  constructor(rootOrConfig: string | WorkspaceConfig) {
    if (typeof rootOrConfig === 'string') {
      this.root = resolve(rootOrConfig);
      this.allowedExtensions = null; // Allow all
      this.maxFileSize = 50 * 1024 * 1024; // 50MB
    } else {
      this.root = resolve(rootOrConfig.root);
      this.allowedExtensions = rootOrConfig.allowedExtensions 
        ? new Set(rootOrConfig.allowedExtensions.map(ext => ext.toLowerCase()))
        : null;
      this.maxFileSize = rootOrConfig.maxFileSize || 50 * 1024 * 1024;
    }
  }

  /**
   * Resolve a path within the workspace, ensuring it's safe
   */
  resolvePath(relativePath: string): string {
    // Normalize and resolve the path
    const normalized = normalize(relativePath);
    const resolved = resolve(this.root, normalized);
    
    // Ensure the resolved path is within the workspace
    if (!resolved.startsWith(this.root)) {
      throw new Error(`Path traversal detected: ${relativePath} resolves outside workspace`);
    }
    
    return resolved;
  }

  /**
   * Check if a file extension is allowed
   */
  private checkExtension(filePath: string): void {
    if (!this.allowedExtensions) {return;} // All extensions allowed
    
    const extension = filePath.split('.').pop()?.toLowerCase();
    if (!extension || !this.allowedExtensions.has(extension)) {
      throw new Error(`File extension not allowed: ${extension}`);
    }
  }

  /**
   * Check if file size is within limits
   */
  private async checkFileSize(filePath: string): Promise<void> {
    try {
      const stats = await fs.stat(filePath);
      if (stats.size > this.maxFileSize) {
        throw new Error(`File too large: ${stats.size} bytes (max: ${this.maxFileSize})`);
      }
    } catch (error: unknown) {
      if ((error as any).code !== 'ENOENT') {
        throw error;
      }
      // File doesn't exist, size check passes
    }
  }

  /**
   * Read a file from the workspace
   */
  async readFile(relativePath: string): Promise<string> {
    const fullPath = this.resolvePath(relativePath);
    this.checkExtension(fullPath);
    await this.checkFileSize(fullPath);
    
    return await fs.readFile(fullPath, 'utf8');
  }

  /**
   * Write a file to the workspace
   */
  async writeFile(relativePath: string, content: string): Promise<void> {
    const fullPath = this.resolvePath(relativePath);
    this.checkExtension(fullPath);
    
    // Check content size
    const contentSize = Buffer.byteLength(content, 'utf8');
    if (contentSize > this.maxFileSize) {
      throw new Error(`Content too large: ${contentSize} bytes (max: ${this.maxFileSize})`);
    }
    
    // Ensure directory exists
    const dir = join(fullPath, '..');
    await fs.mkdir(dir, { recursive: true });
    
    await fs.writeFile(fullPath, content, 'utf8');
  }

  /**
   * Append to a file in the workspace
   */
  async appendFile(relativePath: string, content: string): Promise<void> {
    const fullPath = this.resolvePath(relativePath);
    this.checkExtension(fullPath);
    
    // Check current file size + new content
    await this.checkFileSize(fullPath);
    const contentSize = Buffer.byteLength(content, 'utf8');
    
    try {
      const stats = await fs.stat(fullPath);
      if (stats.size + contentSize > this.maxFileSize) {
        throw new Error(`File would become too large: ${stats.size + contentSize} bytes (max: ${this.maxFileSize})`);
      }
    } catch (error: unknown) {
      if ((error as any).code !== 'ENOENT') {
        throw error;
      }
      // File doesn't exist, just check content size
      if (contentSize > this.maxFileSize) {
        throw new Error(`Content too large: ${contentSize} bytes (max: ${this.maxFileSize})`, { cause: error });
      }
    }
    
    // Ensure directory exists
    const dir = join(fullPath, '..');
    await fs.mkdir(dir, { recursive: true });
    
    await fs.appendFile(fullPath, content, 'utf8');
  }

  /**
   * Check if a file exists in the workspace
   */
  async fileExists(relativePath: string): Promise<boolean> {
    try {
      const fullPath = this.resolvePath(relativePath);
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get file info (size, modified time, etc.)
   */
  async getFileInfo(relativePath: string): Promise<{
    size: number;
    modified: Date;
    created: Date;
    isFile: boolean;
    isDirectory: boolean;
  }> {
    const fullPath = this.resolvePath(relativePath);
    const stats = await fs.stat(fullPath);
    
    return {
      size: stats.size,
      modified: stats.mtime,
      created: stats.birthtime,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory()
    };
  }

  /**
   * List files in a directory within the workspace
   */
  async listDirectory(relativePath: string = ''): Promise<string[]> {
    const fullPath = this.resolvePath(relativePath);
    const entries = await fs.readdir(fullPath);
    return entries;
  }

  /**
   * List files recursively within the workspace
   */
  async listFilesRecursively(relativePath: string = '', options?: {
    includeDirectories?: boolean;
    extensions?: string[];
    maxDepth?: number;
  }): Promise<string[]> {
    const fullPath = this.resolvePath(relativePath);
    const files: string[] = [];
    
    const traverse = async (dirPath: string, depth: number = 0): Promise<void> => {
      if (options?.maxDepth && depth > options.maxDepth) {return;}
      
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const entryPath = join(dirPath, entry.name);
        const relativeEntryPath = relative(this.root, entryPath);
        
        if (entry.isDirectory()) {
          if (options?.includeDirectories) {
            files.push(relativeEntryPath);
          }
          await traverse(entryPath, depth + 1);
        } else if (entry.isFile()) {
          // Check extension filter
          if (options?.extensions) {
            const ext = entry.name.split('.').pop()?.toLowerCase();
            if (!ext || !options.extensions.includes(ext)) {
              continue;
            }
          }
          files.push(relativeEntryPath);
        }
      }
    };
    
    await traverse(fullPath);
    return files.toSorted();
  }

  /**
   * Create a directory within the workspace
   */
  async createDirectory(relativePath: string): Promise<void> {
    const fullPath = this.resolvePath(relativePath);
    await fs.mkdir(fullPath, { recursive: true });
  }

  /**
   * Delete a file from the workspace
   */
  async deleteFile(relativePath: string): Promise<void> {
    const fullPath = this.resolvePath(relativePath);
    await fs.unlink(fullPath);
  }

  /**
   * Delete a directory from the workspace
   */
  async deleteDirectory(relativePath: string, recursive: boolean = false): Promise<void> {
    const fullPath = this.resolvePath(relativePath);
    await fs.rmdir(fullPath, { recursive });
  }

  /**
   * Move/rename a file within the workspace
   */
  async moveFile(fromRelativePath: string, toRelativePath: string): Promise<void> {
    const fromFullPath = this.resolvePath(fromRelativePath);
    const toFullPath = this.resolvePath(toRelativePath);
    
    // Ensure destination directory exists
    const toDir = join(toFullPath, '..');
    await fs.mkdir(toDir, { recursive: true });
    
    await fs.rename(fromFullPath, toFullPath);
  }

  /**
   * Copy a file within the workspace
   */
  async copyFile(fromRelativePath: string, toRelativePath: string): Promise<void> {
    const fromFullPath = this.resolvePath(fromRelativePath);
    const toFullPath = this.resolvePath(toRelativePath);
    
    // Check file size before copying
    await this.checkFileSize(fromFullPath);
    this.checkExtension(toFullPath);
    
    // Ensure destination directory exists
    const toDir = join(toFullPath, '..');
    await fs.mkdir(toDir, { recursive: true });
    
    await fs.copyFile(fromFullPath, toFullPath);
  }

  /**
   * Get workspace root path
   */
  getRoot(): string {
    return this.root;
  }

  /**
   * Get workspace statistics
   */
  async getWorkspaceStats(): Promise<{
    totalFiles: number;
    totalSize: number;
    fileTypes: Record<string, number>;
  }> {
    const files = await this.listFilesRecursively();
    let totalSize = 0;
    const fileTypes: Record<string, number> = {};
    
    for (const file of files) {
      try {
        const info = await this.getFileInfo(file);
        totalSize += info.size;
        
        const ext = file.split('.').pop()?.toLowerCase() || 'no-extension';
        fileTypes[ext] = (fileTypes[ext] || 0) + 1;
      } catch (error: unknown) {
        // Skip files we can't read
        continue;
      }
    }
    
    return {
      totalFiles: files.length,
      totalSize,
      fileTypes
    };
  }

  /**
   * Find files by pattern within the workspace
   */
  async findFiles(pattern: string | RegExp): Promise<string[]> {
    const files = await this.listFilesRecursively();
    const regex = typeof pattern === 'string' 
      ? new RegExp(pattern.replace(/\*/g, '.*'), 'i')
      : pattern;
    
    return files.filter(file => regex.test(file));
  }
}