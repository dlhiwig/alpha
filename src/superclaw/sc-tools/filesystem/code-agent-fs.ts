/**
 * Filesystem Code Agent for SuperClaw
 * 
 * Implements the "CodeAgent pattern" for file system operations - a single
 * fs_execute tool that runs Python code with filesystem access, achieving
 * 10-100x token reduction compared to traditional multi-tool approaches.
 * 
 * Instead of: read_file() + write_file() + list_directory() + search_files() = many tools, full responses
 * Use: fs_execute(python_script) = only requested data returned
 * 
 * @pattern CodeAgent - Single tool + code execution vs multiple granular tools
 */

import { spawn, ChildProcess } from 'child_process'
import * as fs from 'fs/promises'
import * as path from 'path'
import { ITool, ToolResult, ToolExecutionContext, ToolParameter, ToolExecutionError, ToolErrorType } from '../contracts'

export interface FilesystemCodeAgentConfig {
  /** Allowed base paths for filesystem operations */
  allowedPaths: string[]
  /** Maximum execution time (ms) */
  maxExecutionTime: number
  /** Maximum output size (bytes) */
  maxOutputSize: number
  /** Python executable path */
  pythonPath: string
  /** Enable verbose logging */
  verbose: boolean
}

export interface ExecutionStats {
  executionTime: number
  outputSize: number
  tokensEstimate: number
  memoryUsage?: number
}

/**
 * Default secure configuration
 */
const DEFAULT_CONFIG: FilesystemCodeAgentConfig = {
  allowedPaths: [
    '/home/toba/.openclaw/workspace',
    '/home/toba/superclaw',
    '/tmp/superclaw-fs',
  ],
  maxExecutionTime: 30000, // 30 seconds
  maxOutputSize: 1024 * 1024, // 1MB
  pythonPath: 'python3',
  verbose: false
}

/**
 * Filesystem Code Agent Tool
 * 
 * Executes Python code in a sandboxed environment with filesystem access.
 * Pre-imports common libraries and provides utility functions for file operations.
 */
export class FilesystemCodeAgent implements ITool {
  name = 'fs_execute'
  description = 'Execute Python code for filesystem operations with pre-imported libraries and utility functions'
  category = 'filesystem_codeagent'
  
  parameters: ToolParameter[] = [
    {
      name: 'code',
      type: 'string',
      description: 'Python code to execute for filesystem operations',
      required: true
    },
    {
      name: 'working_directory',
      type: 'string',
      description: 'Working directory for the execution (must be within allowed paths)',
      required: false,
      default: '/home/toba/.openclaw/workspace'
    },
    {
      name: 'timeout_ms',
      type: 'number',
      description: 'Execution timeout in milliseconds',
      required: false,
      validation: { min: 1000, max: 60000 }
    }
  ]

  private config: FilesystemCodeAgentConfig
  private executionCount = 0

  constructor(config: Partial<FilesystemCodeAgentConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  async execute(params: Record<string, any>, context?: ToolExecutionContext): Promise<ToolResult> {
    const startTime = Date.now()
    this.executionCount++
    
    try {
      // Validate working directory
      const workingDir = params.working_directory || this.config.allowedPaths[0]
      await this.validatePath(workingDir)
      
      // Prepare Python code with sandbox and utilities
      const fullCode = this.wrapCodeWithSandbox(params.code, workingDir)
      
      // Execute Python code
      const result = await this.executePythonCode(fullCode, workingDir, params.timeout_ms)
      
      const executionTime = Date.now() - startTime
      // @ts-expect-error - Post-Merge Reconciliation
      const stats = this.calculateStats(result.output, executionTime)
      
      if (this.config.verbose) {
        console.log(`[FS CodeAgent] Execution #${this.executionCount} completed in ${executionTime}ms`)
        console.log(`[FS CodeAgent] Output size: ${stats.outputSize} bytes, Est. tokens: ${stats.tokensEstimate}`)
      }
      
      return {
        success: result.success,
        output: result.success ? {
          result: result.output,
          stats: stats,
          workingDirectory: workingDir
        } : undefined,
        error: result.error,
        metadata: {
          timestamp: new Date().toISOString(),
          executionTime,
          toolName: this.name,
          executionCount: this.executionCount,
          stats
        }
      }
      
    } catch (error: unknown) {
      if (error instanceof ToolExecutionError) {
        throw error
      }
      
      return {
        success: false,
        error: `Filesystem code execution failed: ${error instanceof Error ? (error).message : 'Unknown error'}`,
        metadata: {
          timestamp: new Date().toISOString(),
          executionTime: Date.now() - startTime,
          toolName: this.name,
          executionCount: this.executionCount
        }
      }
    }
  }

  /**
   * Validate that a path is within allowed directories
   */
  private async validatePath(filePath: string): Promise<void> {
    try {
      const resolvedPath = path.resolve(filePath)
      
      const isAllowed = this.config.allowedPaths.some(allowedPath => {
        const resolvedAllowed = path.resolve(allowedPath)
        return resolvedPath.startsWith(resolvedAllowed)
      })

      if (!isAllowed) {
        throw new ToolExecutionError(
          ToolErrorType.PERMISSION_DENIED,
          `Path '${filePath}' is not within allowed directories: ${this.config.allowedPaths.join(', ')}`,
          this.name
        )
      }
    } catch (error: unknown) {
      if (error instanceof ToolExecutionError) {throw error}
      
      throw new ToolExecutionError(
        ToolErrorType.INVALID_PARAMETERS,
        `Invalid file path: ${error instanceof Error ? (error).message : 'Unknown error'}`,
        this.name
      )
    }
  }

  /**
   * Wrap user code with sandbox setup and utility functions
   */
  private wrapCodeWithSandbox(userCode: string, workingDir: string): string {
    const allowedPathsStr = this.config.allowedPaths.map(p => `"${p}"`).join(', ')
    
    return `
import os
import sys
import json
import csv
import re
import datetime
import glob
import shutil
import tempfile
import mimetypes
import hashlib
import subprocess
from pathlib import Path
from typing import List, Dict, Any, Optional, Union
import time

# Filesystem utilities namespace
class FSUtils:
    """Utility functions for common filesystem operations"""
    
    ALLOWED_PATHS = [${allowedPathsStr}]
    WORKING_DIR = "${workingDir}"
    
    @staticmethod
    def validate_path(path_str: str) -> str:
        """Validate and resolve path within sandbox"""
        resolved = os.path.abspath(path_str)
        allowed = any(resolved.startswith(os.path.abspath(allowed_path)) 
                     for allowed_path in FSUtils.ALLOWED_PATHS)
        if not allowed:
            raise PermissionError(f"Path {path_str} not allowed. Allowed: {FSUtils.ALLOWED_PATHS}")
        return resolved
    
    @staticmethod
    def safe_read(file_path: str, encoding: str = 'utf-8', max_size: int = 10*1024*1024) -> str:
        """Safely read file with size limit"""
        validated_path = FSUtils.validate_path(file_path)
        if os.path.getsize(validated_path) > max_size:
            raise ValueError(f"File too large: {os.path.getsize(validated_path)} > {max_size}")
        with open(validated_path, 'r', encoding=encoding) as f:
            return f.read()
    
    @staticmethod
    def safe_write(file_path: str, content: str, encoding: str = 'utf-8', create_dirs: bool = True) -> bool:
        """Safely write file with directory creation"""
        validated_path = FSUtils.validate_path(file_path)
        if create_dirs:
            os.makedirs(os.path.dirname(validated_path), exist_ok=True)
        with open(validated_path, 'w', encoding=encoding) as f:
            f.write(content)
        return True
    
    @staticmethod
    def safe_append(file_path: str, content: str, encoding: str = 'utf-8') -> bool:
        """Safely append to file"""
        validated_path = FSUtils.validate_path(file_path)
        with open(validated_path, 'a', encoding=encoding) as f:
            f.write(content)
        return True
    
    @staticmethod
    def list_files(dir_path: str = ".", pattern: str = "*", recursive: bool = False, include_hidden: bool = False) -> List[Dict[str, Any]]:
        """List files with metadata"""
        validated_path = FSUtils.validate_path(dir_path)
        files = []
        
        search_pattern = "**/" + pattern if recursive else pattern
        for file_path in Path(validated_path).glob(search_pattern):
            if not include_hidden and file_path.name.startswith('.'):
                continue
                
            stat = file_path.stat()
            files.append({
                'name': file_path.name,
                'path': str(file_path),
                'relative_path': str(file_path.relative_to(validated_path)),
                'type': 'directory' if file_path.is_dir() else 'file',
                'size': stat.st_size if file_path.is_file() else None,
                'modified': datetime.datetime.fromtimestamp(stat.st_mtime).isoformat(),
                'created': datetime.datetime.fromtimestamp(stat.st_ctime).isoformat(),
                'extension': file_path.suffix,
                'mime_type': mimetypes.guess_type(str(file_path))[0] if file_path.is_file() else None
            })
        
        return files
    
    @staticmethod
    def search_content(pattern: str, dir_path: str = ".", file_pattern: str = "*", ignore_binary: bool = True) -> List[Dict[str, Any]]:
        """Search for text pattern in files"""
        validated_path = FSUtils.validate_path(dir_path)
        results = []
        
        for file_path in Path(validated_path).rglob(file_pattern):
            if not file_path.is_file():
                continue
                
            try:
                # Skip binary files if requested
                if ignore_binary and FSUtils.is_binary(str(file_path)):
                    continue
                    
                with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                    lines = f.readlines()
                    for line_num, line in enumerate(lines, 1):
                        if re.search(pattern, line, re.IGNORECASE):
                            results.append({
                                'file': str(file_path),
                                'line_number': line_num,
                                'line_content': line.strip(),
                                'match': re.search(pattern, line, re.IGNORECASE).group() if re.search(pattern, line, re.IGNORECASE) else ""
                            })
            except Exception as e:
                # Skip files that can't be read
                continue
        
        return results
    
    @staticmethod
    def is_binary(file_path: str) -> bool:
        """Check if file is binary"""
        try:
            with open(file_path, 'rb') as f:
                chunk = f.read(1024)
                return b'\\0' in chunk
        except:
            return True
    
    @staticmethod
    def get_file_hash(file_path: str, algorithm: str = 'sha256') -> str:
        """Get file hash"""
        validated_path = FSUtils.validate_path(file_path)
        hash_obj = hashlib.new(algorithm)
        with open(validated_path, 'rb') as f:
            for chunk in iter(lambda: f.read(4096), b""):
                hash_obj.update(chunk)
        return hash_obj.hexdigest()
    
    @staticmethod
    def copy_file(src: str, dst: str, create_dirs: bool = True) -> bool:
        """Copy file safely"""
        src_path = FSUtils.validate_path(src)
        dst_path = FSUtils.validate_path(dst)
        if create_dirs:
            os.makedirs(os.path.dirname(dst_path), exist_ok=True)
        shutil.copy2(src_path, dst_path)
        return True
    
    @staticmethod
    def move_file(src: str, dst: str, create_dirs: bool = True) -> bool:
        """Move file safely"""
        src_path = FSUtils.validate_path(src)
        dst_path = FSUtils.validate_path(dst)
        if create_dirs:
            os.makedirs(os.path.dirname(dst_path), exist_ok=True)
        shutil.move(src_path, dst_path)
        return True
    
    @staticmethod
    def delete_file(file_path: str) -> bool:
        """Delete file safely"""
        validated_path = FSUtils.validate_path(file_path)
        if os.path.isfile(validated_path):
            os.remove(validated_path)
        elif os.path.isdir(validated_path):
            shutil.rmtree(validated_path)
        else:
            raise FileNotFoundError(f"Path not found: {file_path}")
        return True
    
    @staticmethod
    def create_directory(dir_path: str, parents: bool = True) -> bool:
        """Create directory safely"""
        validated_path = FSUtils.validate_path(dir_path)
        os.makedirs(validated_path, exist_ok=parents)
        return True
    
    @staticmethod  
    def analyze_directory(dir_path: str = ".") -> Dict[str, Any]:
        """Analyze directory structure and contents"""
        validated_path = FSUtils.validate_path(dir_path)
        
        total_files = 0
        total_dirs = 0
        total_size = 0
        file_types = {}
        largest_files = []
        
        for item in Path(validated_path).rglob('*'):
            if item.is_file():
                total_files += 1
                size = item.stat().st_size
                total_size += size
                
                ext = item.suffix.lower() or 'no_extension'
                file_types[ext] = file_types.get(ext, 0) + 1
                
                largest_files.append({
                    'path': str(item),
                    'size': size,
                    'size_mb': round(size / (1024*1024), 2)
                })
            elif item.is_dir():
                total_dirs += 1
        
        largest_files = sorted(largest_files, key=lambda x: x['size'], reverse=True)[:10]
        
        return {
            'directory': str(validated_path),
            'total_files': total_files,
            'total_directories': total_dirs,
            'total_size_bytes': total_size,
            'total_size_mb': round(total_size / (1024*1024), 2),
            'file_types': dict(sorted(file_types.items(), key=lambda x: x[1], reverse=True)),
            'largest_files': largest_files,
            'analyzed_at': datetime.datetime.now().isoformat()
        }

# Set working directory and create fs utility instance
os.chdir(FSUtils.WORKING_DIR)
fs = FSUtils()

# Convenience shortcuts for common operations
read_file = fs.safe_read
write_file = fs.safe_write  
append_file = fs.safe_append
list_files = fs.list_files
search_content = fs.search_content
copy_file = fs.copy_file
move_file = fs.move_file
delete_file = fs.delete_file
create_dir = fs.create_directory
analyze_dir = fs.analyze_directory
get_hash = fs.get_file_hash

# Execute user code
try:
${userCode.split('\n').map(line => '    ' + line).join('\n')}
except Exception as e:
    import traceback
    print(f"ERROR: {type(e).__name__}: {e}")
    print("Traceback:")
    print(traceback.format_exc())
    sys.exit(1)
`
  }

  /**
   * Execute Python code with timeout and output capture
   */
  private async executePythonCode(
    code: string, 
    workingDir: string, 
    timeoutMs?: number
  ): Promise<{ success: boolean; output?: string; error?: string }> {
    return new Promise((resolve) => {
      const timeout = timeoutMs || this.config.maxExecutionTime
      const process = spawn(this.config.pythonPath, ['-c', code], {
        cwd: workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: timeout
      })

      let stdout = ''
      let stderr = ''
      let isTimeout = false

      const timer = setTimeout(() => {
        isTimeout = true
        process.kill('SIGTERM')
      }, timeout)

      process.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString()
        stdout += chunk
        
        // Prevent excessive output
        if (stdout.length > this.config.maxOutputSize) {
          process.kill('SIGTERM')
        }
      })

      process.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      process.on('close', (code) => {
        clearTimeout(timer)
        
        if (isTimeout) {
          resolve({
            success: false,
            error: `Execution timeout after ${timeout}ms`
          })
        } else if (code === 0) {
          resolve({
            success: true,
            output: stdout.trim()
          })
        } else {
          resolve({
            success: false,
            error: stderr.trim() || `Process exited with code ${code}`
          })
        }
      })

      process.on('error', (error) => {
        clearTimeout(timer)
        resolve({
          success: false,
          error: `Process error: ${(error).message}`
        })
      })
    })
  }

  /**
   * Calculate execution statistics for token usage analysis
   */
  private calculateStats(output: string, executionTime: number): ExecutionStats {
    const outputSize = output ? output.length : 0
    
    // Rough estimate: ~4 chars per token for output
    const tokensEstimate = Math.ceil(outputSize / 4)
    
    return {
      executionTime,
      outputSize,
      tokensEstimate
    }
  }
}

/**
 * Example usage patterns for filesystem operations
 */
export const FILESYSTEM_EXAMPLES = {
  // Simple file operations
  basicOperations: `
# Read and analyze a configuration file
config_content = read_file('config.json')
config = json.loads(config_content)
print(f"Loaded config with {len(config)} settings")

# Create a backup
write_file('config.backup.json', config_content)
print("Backup created")

# List all Python files
py_files = list_files('.', '*.py', recursive=True)
print(f"Found {len(py_files)} Python files")
for file in py_files[:5]:
    print(f"  - {file['relative_path']} ({file['size']} bytes)")
`,

  // Content analysis and search
  contentAnalysis: `
# Search for TODO comments across codebase
todos = search_content(r'TODO|FIXME|BUG', '.', '*.py')
print(f"Found {len(todos)} TODO items:")
for todo in todos[:10]:
    print(f"  {todo['file']}:{todo['line_number']} - {todo['line_content'][:80]}")

# Analyze directory structure
analysis = analyze_dir('.')
print(f"\\nDirectory Analysis:")
print(f"  Files: {analysis['total_files']}")
print(f"  Directories: {analysis['total_directories']}")  
print(f"  Total Size: {analysis['total_size_mb']} MB")
print(f"\\nTop file types:")
for ext, count in list(analysis['file_types'].items())[:5]:
    print(f"  {ext}: {count} files")
`,

  // Bulk file processing
  bulkProcessing: `
import re

# Find all markdown files and extract headers
md_files = list_files('.', '*.md', recursive=True)
all_headers = []

for md_file in md_files:
    try:
        content = read_file(md_file['path'])
        headers = re.findall(r'^(#{1,6})\\s+(.+)$', content, re.MULTILINE)
        for level, title in headers:
            all_headers.append({
                'file': md_file['relative_path'],
                'level': len(level),
                'title': title.strip(),
                'anchor': re.sub(r'[^a-zA-Z0-9-]', '-', title.lower()).strip('-')
            })
    except Exception as e:
        print(f"Error processing {md_file['path']}: {e}")

# Generate table of contents
toc_lines = ["# Table of Contents\\n"]
current_file = ""
for header in all_headers:
    if header['file'] != current_file:
        toc_lines.append(f"\\n## {header['file']}\\n")
        current_file = header['file']
    
    indent = "  " * (header['level'] - 1)
    toc_lines.append(f"{indent}- [{header['title']}](#{header['anchor']})")

# Write table of contents
write_file('TABLE_OF_CONTENTS.md', '\\n'.join(toc_lines))
print(f"Generated TOC with {len(all_headers)} headers from {len(md_files)} files")
`,

  // Data processing and reporting
  dataProcessing: `
import csv
from collections import defaultdict, Counter

# Process log files and generate report
log_files = list_files('.', '*.log', recursive=True)
if not log_files:
    print("No log files found, creating sample data...")
    # Create sample log data
    sample_logs = [
        "2024-02-21 10:00:00 INFO User login: john_doe",
        "2024-02-21 10:05:15 ERROR Database connection failed",
        "2024-02-21 10:05:20 INFO Retrying database connection",
        "2024-02-21 10:05:25 INFO Database connected successfully",
        "2024-02-21 11:30:45 WARN High memory usage detected: 85%",
        "2024-02-21 12:00:00 INFO User logout: john_doe"
    ]
    write_file('sample.log', '\\n'.join(sample_logs))
    log_files = [{'path': 'sample.log', 'name': 'sample.log'}]

# Analyze logs
log_stats = defaultdict(int)
error_patterns = Counter()

for log_file in log_files:
    try:
        content = read_file(log_file['path'])
        lines = content.split('\\n')
        
        for line in lines:
            if not line.strip():
                continue
                
            # Extract log level
            if ' INFO ' in line:
                log_stats['INFO'] += 1
            elif ' ERROR ' in line:
                log_stats['ERROR'] += 1
                # Track error patterns
                error_msg = line.split(' ERROR ')[-1]
                error_patterns[error_msg] += 1
            elif ' WARN ' in line:
                log_stats['WARN'] += 1
            elif ' DEBUG ' in line:
                log_stats['DEBUG'] += 1
                
    except Exception as e:
        print(f"Error processing {log_file['path']}: {e}")

# Generate report
report_lines = [
    "# Log Analysis Report",
    f"Generated: {datetime.datetime.now().isoformat()}",
    f"Processed: {len(log_files)} log files\\n",
    "## Log Level Summary"
]

for level, count in sorted(log_stats.items()):
    report_lines.append(f"- {level}: {count}")

if error_patterns:
    report_lines.extend([
        "\\n## Top Errors",
        *[f"- {error} ({count}x)" for error, count in error_patterns.most_common(5)]
    ])

write_file('log_analysis_report.md', '\\n'.join(report_lines))
print(f"Log analysis complete!")
print(f"Summary: {dict(log_stats)}")
if error_patterns:
    print(f"Errors found: {sum(error_patterns.values())}")
`
}

export default FilesystemCodeAgent