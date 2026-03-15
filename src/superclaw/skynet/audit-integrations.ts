// @ts-nocheck
/**
 * 🦊 SKYNET AUDIT INTEGRATIONS
 * 
 * Auto-logging integrations for existing SKYNET systems.
 * Automatically captures tool executions, agent spawns, and cost events.
 */

import { getAuditTrail } from './audit';
import { recordProviderRequest } from './sentinel';

// ═══════════════════════════════════════════════════════════════
// TOOL EXECUTION INTERCEPTOR
// ═══════════════════════════════════════════════════════════════

interface ToolExecutionContext {
  sessionId: string;
  agentId: string;
  tool: string;
  params: any;
  startTime: number;
}

export class ToolExecutionInterceptor {
  private static contexts = new Map<string, ToolExecutionContext>();

  static beforeToolExecution(params: {
    sessionId: string;
    agentId: string;
    tool: string;
    params: any;
  }): string {
    const contextId = `${params.sessionId}_${params.agentId}_${Date.now()}_${Math.random()}`;
    
    this.contexts.set(contextId, {
      ...params,
      startTime: Date.now()
    });

    return contextId;
  }

  static afterToolExecution(contextId: string, result: {
    success: boolean;
    output?: any;
    error?: Error;
    tokenUsage?: { input: number; output: number };
    costUsd?: number;
  }): void {
    const context = this.contexts.get(contextId);
    if (!context) {return;}

    const durationMs = Date.now() - context.startTime;
    const audit = getAuditTrail();

    // Log to audit trail
    audit.logToolCall({
      sessionId: context.sessionId,
      agentId: context.agentId,
      tool: context.tool,
      params: context.params,
      result: result.success ? 'success' : 'failure',
      durationMs,
      tokenUsage: result.tokenUsage,
      costUsd: result.costUsd,
      errorMessage: result.error?.message
    });

    // Also log to SENTINEL for provider monitoring
    // @ts-expect-error - Post-Merge Reconciliation
    recordProviderRequest(context.tool, {
      success: result.success,
      latencyMs: durationMs,
      cost: result.costUsd || 0,
      error: result.error?.message
    });

    // Clean up context
    this.contexts.delete(contextId);
  }
}

// ═══════════════════════════════════════════════════════════════
// AGENT SPAWN INTERCEPTOR
// ═══════════════════════════════════════════════════════════════

export class AgentSpawnInterceptor {
  private static spawnContexts = new Map<string, { startTime: number; sessionId: string; parentAgentId: string }>();

  static beforeAgentSpawn(params: {
    sessionId: string;
    parentAgentId: string;
    agentConfig: any;
  }): string {
    const spawnId = `spawn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    this.spawnContexts.set(spawnId, {
      startTime: Date.now(),
      sessionId: params.sessionId,
      parentAgentId: params.parentAgentId
    });

    return spawnId;
  }

  static afterAgentSpawn(spawnId: string, result: {
    success: boolean;
    agentId?: string;
    error?: Error;
    metadata?: any;
  }): void {
    const context = this.spawnContexts.get(spawnId);
    if (!context) {return;}

    const durationMs = Date.now() - context.startTime;
    const audit = getAuditTrail();

    audit.logAgentSpawn({
      sessionId: context.sessionId,
      agentId: result.agentId || 'unknown',
      parentAgentId: context.parentAgentId,
      result: result.success ? 'success' : 'failure',
      durationMs,
      metadata: {
        ...result.metadata,
        errorMessage: result.error?.message
      }
    });

    this.spawnContexts.delete(spawnId);
  }
}

// ═══════════════════════════════════════════════════════════════
// COST EVENT INTERCEPTOR
// ═══════════════════════════════════════════════════════════════

export class CostEventInterceptor {
  static logCostEvent(params: {
    sessionId: string;
    agentId: string;
    provider: string;
    model: string;
    tokenUsage: { input: number; output: number };
    costUsd: number;
    requestType?: string;
  }): void {
    const audit = getAuditTrail();

    audit.logCostEvent({
      sessionId: params.sessionId,
      agentId: params.agentId,
      costUsd: params.costUsd,
      tokenUsage: params.tokenUsage,
      metadata: {
        provider: params.provider,
        model: params.model,
        requestType: params.requestType
      }
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// AUTO-INTEGRATION HOOKS
// ═══════════════════════════════════════════════════════════════

interface OpenClawTool {
  name: string;
  execute: Function;
}

export class AuditAutoIntegration {
  private static originalToolExecute = new Map<string, Function>();
  private static originalAgentSpawn: Function | null = null;
  private static originalCostTracker: Function | null = null;

  static initialize(): void {
    console.log('🦊 AUDIT: Initializing auto-integration hooks...');
    
    // Try to hook into common tool execution patterns
    this.hookToolExecution();
    this.hookAgentSpawning();
    this.hookCostTracking();

    console.log('🦊 AUDIT: Auto-integration hooks initialized');
  }

  private static hookToolExecution(): void {
    // Hook into global tool registry if available
    if (typeof global !== 'undefined' && (global as any).openClawTools) {
      const tools = (global as any).openClawTools as Map<string, OpenClawTool>;
      
      for (const [toolName, tool] of tools) {
        if (!this.originalToolExecute.has(toolName)) {
          this.originalToolExecute.set(toolName, tool.execute);
          
          tool.execute = async (...args: any[]) => {
            const sessionId = this.extractSessionId(args);
            const agentId = this.extractAgentId(args);
            
            const contextId = ToolExecutionInterceptor.beforeToolExecution({
              sessionId,
              agentId,
              tool: toolName,
              params: args[0] || {}
            });

            try {
              const result = await this.originalToolExecute.get(toolName)!.apply(tool, args);
              
              ToolExecutionInterceptor.afterToolExecution(contextId, {
                success: true,
                output: result
              });
              
              return result;
            } catch (error: unknown) {
              ToolExecutionInterceptor.afterToolExecution(contextId, {
                success: false,
                error: error as Error
              });
              
              throw error;
            }
          };
        }
      }
    }
  }

  private static hookAgentSpawning(): void {
    // Hook into SubAgent spawning
    try {
      const subAgentModule = require('./sub-agent.js');
      if (subAgentModule.spawnSubAgent && !this.originalAgentSpawn) {
        this.originalAgentSpawn = subAgentModule.spawnSubAgent;
        
        subAgentModule.spawnSubAgent = async (config: any) => {
          const spawnId = AgentSpawnInterceptor.beforeAgentSpawn({
            sessionId: config.sessionId || 'unknown',
            parentAgentId: config.parentId || 'main',
            agentConfig: config
          });

          try {
            const agent = await this.originalAgentSpawn!(config);
            
            AgentSpawnInterceptor.afterAgentSpawn(spawnId, {
              success: true,
              agentId: agent.id,
              metadata: { config }
            });
            
            return agent;
          } catch (error: unknown) {
            AgentSpawnInterceptor.afterAgentSpawn(spawnId, {
              success: false,
              error: error as Error
            });
            
            throw error;
          }
        };
      }
    } catch (error: unknown) {
      // Module might not be available yet
      console.warn('Could not hook agent spawning:', error);
    }
  }

  private static hookCostTracking(): void {
    // Hook into CostControl system
    try {
      const costControlModule = require('./cost-control.js');
      if (costControlModule.CostController) {
        const originalRecordTransaction = costControlModule.CostController.prototype.recordTransaction;
        
        if (originalRecordTransaction && !this.originalCostTracker) {
          this.originalCostTracker = originalRecordTransaction;
          
          costControlModule.CostController.prototype.recordTransaction = function(transaction: any) {
            CostEventInterceptor.logCostEvent({
              sessionId: transaction.sessionId || 'unknown',
              agentId: transaction.agentId || 'unknown',
              provider: transaction.provider || 'unknown',
              model: transaction.model || 'unknown',
              tokenUsage: {
                input: transaction.inputTokens || 0,
                output: transaction.outputTokens || 0
              },
              costUsd: transaction.costUSD || 0,
              requestType: transaction.taskType
            });

            return this.originalCostTracker.call(this, transaction);
          };
        }
      }
    } catch (error: unknown) {
      console.warn('Could not hook cost tracking:', error);
    }
  }

  private static extractSessionId(args: any[]): string {
    // Try to extract session ID from various argument patterns
    if (args[0]?.sessionId) {return args[0].sessionId;}
    if (args[0]?.context?.sessionId) {return args[0].context.sessionId;}
    if (args[1]?.sessionId) {return args[1].sessionId;}
    return process.env.OPENCLAW_SESSION_ID || 'unknown';
  }

  private static extractAgentId(args: any[]): string {
    // Try to extract agent ID from various argument patterns
    if (args[0]?.agentId) {return args[0].agentId;}
    if (args[0]?.context?.agentId) {return args[0].context.agentId;}
    if (args[1]?.agentId) {return args[1].agentId;}
    return process.env.OPENCLAW_AGENT_ID || 'main';
  }

  static cleanup(): void {
    // Restore original functions
    if (typeof global !== 'undefined' && (global as any).openClawTools) {
      const tools = (global as any).openClawTools as Map<string, OpenClawTool>;
      
      for (const [toolName, tool] of tools) {
        const originalExecute = this.originalToolExecute.get(toolName);
        if (originalExecute) {
          tool.execute = originalExecute;
        }
      }
    }

    this.originalToolExecute.clear();
    this.originalAgentSpawn = null;
    this.originalCostTracker = null;

    console.log('🦊 AUDIT: Auto-integration hooks cleaned up');
  }
}

// ═══════════════════════════════════════════════════════════════
// MANUAL LOGGING HELPERS
// ═══════════════════════════════════════════════════════════════

export function logToolCall(params: {
  sessionId: string;
  agentId: string;
  tool: string;
  params: any;
  result: 'success' | 'failure' | 'timeout';
  durationMs: number;
  tokenUsage?: { input: number; output: number };
  costUsd?: number;
  errorMessage?: string;
}): void {
  const audit = getAuditTrail();
  audit.logToolCall(params);
}

export function logAgentSpawn(params: {
  sessionId: string;
  agentId: string;
  parentAgentId?: string;
  result: 'success' | 'failure';
  durationMs: number;
  metadata?: any;
}): void {
  const audit = getAuditTrail();
  audit.logAgentSpawn(params);
}

export function logCostEvent(params: {
  sessionId: string;
  agentId: string;
  costUsd: number;
  tokenUsage: { input: number; output: number };
  metadata?: any;
}): void {
  const audit = getAuditTrail();
  audit.logCostEvent(params);
}

export function logSecurityEvent(params: {
  sessionId: string;
  agentId: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  metadata?: any;
}): void {
  const audit = getAuditTrail();
  audit.log({
    sessionId: params.sessionId,
    agentId: params.agentId,
    action: 'security',
    result: 'success',
    durationMs: 0,
    severity: params.severity,
    metadata: {
      securityMessage: params.message,
      ...params.metadata
    }
  });
}

export function logSystemEvent(params: {
  sessionId: string;
  agentId: string;
  message: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  metadata?: any;
}): void {
  const audit = getAuditTrail();
  audit.log({
    sessionId: params.sessionId,
    agentId: params.agentId,
    action: 'system',
    result: 'success',
    durationMs: 0,
    severity: params.severity || 'low',
    metadata: {
      systemMessage: params.message,
      ...params.metadata
    }
  });
}