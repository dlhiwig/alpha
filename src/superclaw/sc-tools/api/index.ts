// @ts-nocheck
/**
 * SuperClaw API Tools Module
 * 
 * Exports the CodeAgent API tool with proper SuperClaw tool registry integration
 */

import { codeAgentApiTool, CodeAgentApiTool, type ApiExecuteArgs, type ApiExecuteResult } from './code-agent-api';
import type { ITool, ToolParameter, ToolResult, ToolExecutionContext } from '../contracts';

/**
 * Adapter to make CodeAgentApiTool compatible with SuperClaw ITool interface
 */
class CodeAgentApiToolAdapter implements ITool {
  name = 'api_execute';
  description = 'Execute Python code with HTTP libraries for API orchestration';
  category = 'api';
  requiresElevation = false;
  
  parameters: ToolParameter[] = [
    {
      name: 'code',
      type: 'string',
      description: 'Python code to execute. Pre-loaded libraries: requests, json, os, time, base64, urllib, jwt',
      required: true
    },
    {
      name: 'auth',
      type: 'object', 
      description: 'Authentication tokens/keys to inject as environment variables',
      required: false
    },
    {
      name: 'timeout',
      type: 'number',
      description: 'Timeout in seconds (default: 30, max: 300)',
      required: false,
      default: 30,
      validation: { min: 1, max: 300 }
    },
    {
      name: 'workdir',
      type: 'string',
      description: 'Working directory for temp files (defaults to /tmp/superclaw-api)',
      required: false
    },
    {
      name: 'env',
      type: 'object',
      description: 'Additional environment variables',
      required: false
    }
  ];

  private tool: CodeAgentApiTool;

  constructor() {
    this.tool = codeAgentApiTool;
  }

  async execute(params: Record<string, any>, context?: ToolExecutionContext): Promise<ToolResult> {
    try {
      // Validate required parameters
      if (!params.code || typeof params.code !== 'string') {
        return {
          success: false,
          error: 'Parameter "code" is required and must be a string',
          metadata: {
            timestamp: new Date().toISOString(),
            toolName: this.name
          }
        };
      }

      // Convert parameters to ApiExecuteArgs
      const args: ApiExecuteArgs = {
        code: params.code,
        auth: params.auth || {},
        timeout: params.timeout || 30,
        workdir: params.workdir,
        env: params.env || {}
      };

      // Add context information to environment
      if (context) {
        args.env = {
          ...args.env,
          SUPERCLAW_USER_ID: context.userId || '',
          SUPERCLAW_SESSION_ID: context.sessionId || '',
          SUPERCLAW_WORKING_DIR: context.workingDir || ''
        };
      }

      // Execute the tool
      const startTime = Date.now();
      const result = await this.tool.execute(args, context as any);
      const executionTime = Date.now() - startTime;

      return {
        success: result.success,
        output: result.success ? {
          output: result.output,
          requestsCount: result.requestsCount,
          duration: result.duration,
          executionId: result.metadata?.executionId
        } : undefined,
        error: result.error,
        metadata: {
          timestamp: new Date().toISOString(),
          executionTime,
          toolName: this.name,
          scriptSize: result.metadata?.scriptSize,
          exitCode: result.exitCode,
          tokensUsed: result.tokensUsed
        }
      };

    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error ? (error).message : 'Unknown execution error',
        metadata: {
          timestamp: new Date().toISOString(),
          toolName: this.name
        }
      };
    }
  }
}

// Create and export the adapter instance
export const apiExecuteTool = new CodeAgentApiToolAdapter();

// Re-export types
export type { ApiExecuteArgs, ApiExecuteResult } from './code-agent-api';
export { CodeAgentApiTool } from './code-agent-api';