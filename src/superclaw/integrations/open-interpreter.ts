/**
 * Open Interpreter Integration for SuperClaw
 * 
 * Provides code execution capabilities via Open Interpreter's
 * multi-language subprocess architecture.
 * 
 * @see /home/toba/open-interpreter
 * @see /home/toba/.openclaw/workspace/memory/research/open-interpreter-analysis.md
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';

const OI_VENV = '/home/toba/open-interpreter/.venv';
const OI_PYTHON = path.join(OI_VENV, 'bin', 'python');

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  language: string;
  code: string;
  duration: number;
}

export interface OpenInterpreterConfig {
  model?: string;           // LLM model to use
  apiKey?: string;          // API key for model
  offline?: boolean;        // Disable online features
  autoRun?: boolean;        // Auto-approve code execution
  maxBudget?: number;       // Max API spend in USD
  contextWindow?: number;   // Token context window
}

/**
 * OpenInterpreterBridge
 * 
 * Bridges SuperClaw agents to Open Interpreter's code execution capabilities.
 * Uses the Python subprocess approach from Open Interpreter.
 */
export class OpenInterpreterBridge extends EventEmitter {
  private config: OpenInterpreterConfig;
  private process: ChildProcess | null = null;
  
  constructor(config: OpenInterpreterConfig = {}) {
    super();
    this.config = {
      model: config.model || 'gpt-4o',
      autoRun: config.autoRun ?? true,
      offline: config.offline ?? false,
      ...config
    };
  }
  
  /**
   * Execute code in a specific language
   */
  async executeCode(language: string, code: string): Promise<ExecutionResult> {
    const startTime = Date.now();
    
    return new Promise((resolve, reject) => {
      const pythonCode = `
import sys
sys.path.insert(0, '/home/toba/open-interpreter')
from interpreter import interpreter

interpreter.auto_run = True
interpreter.offline = ${this.config.offline ? 'True' : 'False'}
interpreter.llm.model = "${this.config.model}"

# Execute code directly via computer.terminal
result = interpreter.computer.run("${language}", '''${code.replace(/'/g, "\\'")}''')
for chunk in result:
    if 'content' in chunk:
        print(chunk['content'], end='', flush=True)
`;

      const proc = spawn(OI_PYTHON, ['-c', pythonCode], {
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
      });
      
      let output = '';
      let error = '';
      
      proc.stdout?.on('data', (data) => {
        output += data.toString();
        this.emit('output', data.toString());
      });
      
      proc.stderr?.on('data', (data) => {
        error += data.toString();
        this.emit('error', data.toString());
      });
      
      proc.on('close', (exitCode) => {
        resolve({
          success: exitCode === 0,
          output: output.trim(),
          error: error.trim() || undefined,
          language,
          code,
          duration: Date.now() - startTime
        });
      });
      
      proc.on('error', (err) => {
        reject(err);
      });
    });
  }
  
  /**
   * Chat with Open Interpreter (full agent mode)
   */
  async chat(message: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const pythonCode = `
import sys
sys.path.insert(0, '/home/toba/open-interpreter')
from interpreter import interpreter

interpreter.auto_run = True
interpreter.offline = ${this.config.offline ? 'True' : 'False'}
interpreter.llm.model = "${this.config.model}"

for chunk in interpreter.chat("${message.replace(/"/g, '\\"')}", display=False, stream=True):
    if 'content' in chunk:
        print(chunk.get('content', ''), end='', flush=True)
`;

      const proc = spawn(OI_PYTHON, ['-c', pythonCode], {
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
      });
      
      let output = '';
      
      proc.stdout?.on('data', (data) => {
        output += data.toString();
        this.emit('chunk', data.toString());
      });
      
      proc.stderr?.on('data', (data) => {
        this.emit('error', data.toString());
      });
      
      proc.on('close', () => {
        resolve(output.trim());
      });
      
      proc.on('error', reject);
    });
  }
  
  /**
   * Get available languages
   */
  getSupportedLanguages(): string[] {
    return [
      'python',
      'javascript',
      'shell',
      'bash',
      'powershell',
      'ruby',
      'r',
      'java',
      'applescript',
      'html',
      'react'
    ];
  }
}

// Export singleton for quick usage
export const openInterpreter = new OpenInterpreterBridge();

// CLI test
if (require.main === module) {
  (async () => {
    console.log('Testing Open Interpreter integration...');
    
    const result = await openInterpreter.executeCode('python', 'print("Hello from Open Interpreter!")');
    console.log('Result:', result);
    
    // Test shell
    const shellResult = await openInterpreter.executeCode('shell', 'echo "Shell works too!"');
    console.log('Shell Result:', shellResult);
  })();
}
