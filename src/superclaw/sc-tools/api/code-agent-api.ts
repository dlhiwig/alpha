/**
 * SuperClaw CodeAgent API Tool
 * 
 * Implements the "single tool + code execution" pattern for API operations.
 * Instead of multiple API tools (get, post, put, delete), this provides
 * one tool that executes Python code with HTTP libraries pre-loaded.
 * 
 * Benefits:
 * - One tool call orchestrates complex API workflows
 * - Only returns script output, not full HTTP responses
 * - Built-in auth, rate limiting, retry logic
 * - Token usage tracking
 */

import { spawn } from 'child_process';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import type { AgentContext } from '../../standalone/agent/executor';

export interface ApiExecuteArgs {
  /** Python code to execute with HTTP libraries pre-loaded */
  code: string;
  /** Authentication tokens/keys to inject (key-value pairs) */
  auth?: Record<string, string>;
  /** Maximum execution time in seconds (default: 30, max: 300) */
  timeout?: number;
  /** Working directory for temporary files */
  workdir?: string;
  /** Environment variables to set */
  env?: Record<string, string>;
}

export interface ApiExecuteResult {
  success: boolean;
  output?: string;
  error?: string;
  exitCode?: number;
  duration: number;
  tokensUsed?: number;
  requestsCount?: number;
  metadata?: {
    executionId: string;
    timestamp: Date;
    scriptSize: number;
  };
}

export class CodeAgentApiTool {
  name = 'api_execute';
  description = 'Execute Python code with HTTP libraries for API orchestration';
  parameters = {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'Python code to execute. Pre-loaded libraries: requests, json, os, time, base64, urllib, jwt'
      },
      auth: {
        type: 'object',
        description: 'Authentication tokens/keys to inject as environment variables',
        additionalProperties: { type: 'string' }
      },
      timeout: {
        type: 'number',
        description: 'Timeout in seconds (default: 30, max: 300)',
        default: 30,
        minimum: 1,
        maximum: 300
      },
      workdir: {
        type: 'string',
        description: 'Working directory for temp files (defaults to /tmp/superclaw-api)'
      },
      env: {
        type: 'object',
        description: 'Additional environment variables',
        additionalProperties: { type: 'string' }
      }
    },
    required: ['code']
  };

  private readonly defaultWorkdir = '/tmp/superclaw-api';
  private readonly pythonTemplate = `#!/usr/bin/env python3
"""
SuperClaw CodeAgent API Execution Environment
Pre-loaded libraries and utilities for HTTP/API operations
"""

import json
import os
import time
import base64
import urllib.parse
from urllib.parse import urlencode, urljoin
import sys
import traceback
from typing import Dict, Any, Optional, List
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta

# HTTP and Request handling
import requests
from requests.adapters import HTTPAdapter
try:
    from requests.packages.urllib3.util.retry import Retry
except ImportError:
    from urllib3.util.retry import Retry

# JWT handling (if available)
try:
    import jwt
except ImportError:
    jwt = None

# --- Rate Limiting & Retry Logic ---

@dataclass
class RequestStats:
    total_requests: int = 0
    successful_requests: int = 0
    failed_requests: int = 0
    total_bytes: int = 0
    start_time: float = 0
    
    def __post_init__(self):
        if self.start_time == 0:
            self.start_time = time.time()

# Global stats tracking
_request_stats = RequestStats()

class RateLimitedSession:
    """HTTP session with built-in rate limiting and retry logic"""
    
    def __init__(self, 
                 requests_per_second: float = 10.0,
                 max_retries: int = 3,
                 backoff_factor: float = 1.0,
                 timeout: int = 30):
        
        self.session = requests.Session()
        self.requests_per_second = requests_per_second
        self.last_request_time = 0
        
        # Configure retry strategy
        retry_strategy = Retry(
            total=max_retries,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["HEAD", "GET", "POST", "PUT", "DELETE", "OPTIONS", "TRACE"],
            backoff_factor=backoff_factor
        )
        
        adapter = HTTPAdapter(max_retries=retry_strategy)
        self.session.mount("http://", adapter)
        self.session.mount("https://", adapter)
        
        self.session.timeout = timeout
    
    def _rate_limit(self):
        """Enforce rate limiting"""
        if self.requests_per_second <= 0:
            return
        
        min_interval = 1.0 / self.requests_per_second
        elapsed = time.time() - self.last_request_time
        
        if elapsed < min_interval:
            sleep_time = min_interval - elapsed
            time.sleep(sleep_time)
        
        self.last_request_time = time.time()
    
    def request(self, method: str, url: str, **kwargs) -> requests.Response:
        """Make rate-limited HTTP request"""
        self._rate_limit()
        
        _request_stats.total_requests += 1
        
        try:
            response = self.session.request(method, url, **kwargs)
            
            # Track response size
            content_length = response.headers.get('content-length')
            if content_length:
                _request_stats.total_bytes += int(content_length)
            else:
                _request_stats.total_bytes += len(response.content)
            
            if response.status_code < 400:
                _request_stats.successful_requests += 1
            else:
                _request_stats.failed_requests += 1
            
            return response
            
        except Exception as e:
            _request_stats.failed_requests += 1
            raise
    
    def get(self, url: str, **kwargs) -> requests.Response:
        return self.request('GET', url, **kwargs)
    
    def post(self, url: str, **kwargs) -> requests.Response:
        return self.request('POST', url, **kwargs)
    
    def put(self, url: str, **kwargs) -> requests.Response:
        return self.request('PUT', url, **kwargs)
    
    def delete(self, url: str, **kwargs) -> requests.Response:
        return self.request('DELETE', url, **kwargs)
    
    def patch(self, url: str, **kwargs) -> requests.Response:
        return self.request('PATCH', url, **kwargs)

# --- Authentication Helpers ---

class AuthHelper:
    """Common authentication patterns"""
    
    @staticmethod
    def bearer_token(token: str) -> Dict[str, str]:
        """Generate Bearer token headers"""
        return {"Authorization": f"Bearer {token}"}
    
    @staticmethod
    def api_key_header(key: str, header_name: str = "X-API-Key") -> Dict[str, str]:
        """Generate API key headers"""
        return {header_name: key}
    
    @staticmethod
    def basic_auth(username: str, password: str) -> Dict[str, str]:
        """Generate Basic auth headers"""
        credentials = base64.b64encode(f"{username}:{password}".encode()).decode()
        return {"Authorization": f"Basic {credentials}"}
    
    @staticmethod
    def oauth2_headers(access_token: str) -> Dict[str, str]:
        """Generate OAuth2 headers"""
        return {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json"
        }

# --- Response Helpers ---

def safe_json(response: requests.Response) -> Optional[Dict[str, Any]]:
    """Safely parse JSON response"""
    try:
        return response.json()
    except (ValueError, json.JSONDecodeError):
        return None

def extract_data(response: requests.Response, path: str = None) -> Any:
    """Extract data from response, optionally following a JSON path"""
    data = safe_json(response)
    if not data or not path:
        return data
    
    # Simple dot-notation path following
    keys = path.split('.')
    current = data
    
    for key in keys:
        if isinstance(current, dict) and key in current:
            current = current[key]
        elif isinstance(current, list) and key.isdigit():
            idx = int(key)
            if 0 <= idx < len(current):
                current = current[idx]
            else:
                return None
        else:
            return None
    
    return current

def summarize_response(response: requests.Response, max_content: int = 500) -> str:
    """Create a summary of the HTTP response"""
    content_preview = ""
    if response.content:
        text = response.text[:max_content]
        if len(response.text) > max_content:
            text += "... (truncated)"
        content_preview = text
    
    return f"""Status: {response.status_code} {response.reason}
Headers: {dict(response.headers)}
Content: {content_preview}"""

# --- Global Session Instance ---
# Pre-configured session with sensible defaults
http = RateLimitedSession(
    requests_per_second=10.0,  # 10 RPS default
    max_retries=3,
    backoff_factor=1.0,
    timeout=30
)

# --- Utility Functions ---

def print_stats():
    """Print execution statistics"""
    duration = time.time() - _request_stats.start_time
    print(f"\\n--- API Execution Stats ---")
    print(f"Duration: {duration:.2f}s")
    print(f"Total requests: {_request_stats.total_requests}")
    print(f"Successful: {_request_stats.successful_requests}")
    print(f"Failed: {_request_stats.failed_requests}")
    print(f"Data transferred: {_request_stats.total_bytes} bytes")
    if _request_stats.total_requests > 0:
        print(f"Success rate: {_request_stats.successful_requests/_request_stats.total_requests*100:.1f}%")

def set_rate_limit(requests_per_second: float):
    """Update the global rate limit"""
    global http
    http.requests_per_second = requests_per_second

# --- Pre-loaded Auth from Environment ---
AUTH_TOKENS = {}
for key, value in os.environ.items():
    if key.startswith('API_'):
        AUTH_TOKENS[key] = value

# --- Main Execution ---
if __name__ == "__main__":
    try:
        # USER CODE STARTS HERE
{{USER_CODE}}
        # USER CODE ENDS HERE
        
    except Exception as e:
        print(f"ERROR: {str(e)}", file=sys.stderr)
        traceback.print_exc()
        sys.exit(1)
    finally:
        # Always print stats at the end
        if _request_stats.total_requests > 0:
            print_stats()
`;

  async execute(args: ApiExecuteArgs, context: AgentContext): Promise<ApiExecuteResult> {
    const startTime = Date.now();
    const executionId = randomBytes(8).toString('hex');
    
    let scriptPath: string | null = null;
    
    try {
      const { 
        code, 
        auth = {}, 
        timeout = 30, 
        workdir = this.defaultWorkdir, 
        env = {} 
      } = args;

      // Validate timeout
      const actualTimeout = Math.min(Math.max(timeout, 1), 300);

      // Create working directory
      if (!existsSync(workdir)) {
        await mkdir(workdir, { recursive: true });
      }

      // Create temporary script file
      scriptPath = join(workdir, `api_script_${executionId}.py`);
      
      // Inject user code into template with proper indentation
      const indentedCode = code.split('\n').map(line => 
        line.trim() ? `        ${line}` : line
      ).join('\n');
      const fullScript = this.pythonTemplate.replace('{{USER_CODE}}', indentedCode);
      
      await writeFile(scriptPath, fullScript, 'utf8');

      // Prepare environment variables
      const scriptEnv = {
        ...process.env,
        ...env,
        // Inject auth tokens as API_* env vars
        ...Object.fromEntries(
          Object.entries(auth).map(([key, value]) => [
            key.startsWith('API_') ? key : `API_${key.toUpperCase()}`,
            value
          ])
        ),
        PYTHONPATH: process.env.PYTHONPATH || '',
        PYTHONIOENCODING: 'utf-8'
      };

      // Execute Python script
      const result = await this.executePythonScript(scriptPath, actualTimeout, scriptEnv);

      const duration = Date.now() - startTime;

      return {
        success: result.exitCode === 0,
        output: result.stdout,
        error: result.stderr,
        // @ts-expect-error - Post-Merge Reconciliation
        exitCode: result.exitCode,
        duration,
        requestsCount: this.extractRequestsCount(result.stdout),
        metadata: {
          executionId,
          timestamp: new Date(),
          scriptSize: code.length
        }
      };

    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      
      return {
        success: false,
        error: error instanceof Error ? (error as Error).message : 'Unknown execution error',
        duration,
        metadata: {
          executionId,
          timestamp: new Date(),
          scriptSize: args.code.length
        }
      };
    } finally {
      // Clean up temporary script file
      if (scriptPath && existsSync(scriptPath)) {
        try {
          await unlink(scriptPath);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    }
  }

  private async executePythonScript(
    scriptPath: string, 
    timeout: number, 
    env: Record<string, string>
  ): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    
    return new Promise((resolve, reject) => {
      const child = spawn('python3', [scriptPath], {
        env,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';
      let timeoutHandle: NodeJS.Timeout;

      // Set up timeout
      const timeoutMs = timeout * 1000;
      timeoutHandle = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Script execution timeout after ${timeout}s`));
      }, timeoutMs);

      // Collect output
      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      // Handle completion
      child.on('close', (exitCode) => {
        clearTimeout(timeoutHandle);
        resolve({ stdout, stderr, exitCode });
      });

      child.on('error', (error) => {
        clearTimeout(timeoutHandle);
        reject(error);
      });
    });
  }

  private extractRequestsCount(output: string): number {
    // Extract request count from stats output
    const match = output.match(/Total requests: (\\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }
}

// Export singleton instance
export const codeAgentApiTool = new CodeAgentApiTool();