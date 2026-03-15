/**
 * Deterministic Executor for SuperClaw with FACT Cache Integration
 * 
 * Implements cache-first tool execution following FACT architecture principles:
 * 1. Cache check first (sub-50ms target)
 * 2. Deterministic tool execution if cache miss
 * 3. Intelligent caching of results
 * 4. Comprehensive audit trail
 */

import { performance } from 'perf_hooks';
import { ITool, ToolResult, ToolCall, ToolExecutionContext, ToolExecutionError, ToolErrorType } from './contracts';
import { FACTCache, globalFACTCache, CacheMetrics } from './fact-cache';

/**
 * Execution audit entry for full traceability
 */
export interface ExecutionAuditEntry {
  /** Unique execution ID */
  executionId: string;
  /** Tool call that was executed */
  toolCall: ToolCall;
  /** Execution result */
  result: ToolResult;
  /** Whether result came from cache */
  cacheHit: boolean;
  /** Execution timing */
  timing: {
    started: number;
    cacheChecked: number;
    toolExecuted?: number;
    cacheSaved?: number;
    completed: number;
    totalMs: number;
    cacheCheckMs: number;
    toolExecutionMs?: number;
    cacheSaveMs?: number;
  };
  /** Execution context */
  context?: ToolExecutionContext;
  /** Cache strategy used */
  cacheStrategy?: string;
  /** Token count for cost analysis */
  tokenCount?: number;
  /** Error information if failed */
  error?: {
    type: string;
    message: string;
    stack?: string;
  };
}

/**
 * Performance metrics for the deterministic executor
 */
export interface ExecutorMetrics {
  /** Total executions processed */
  totalExecutions: number;
  /** Cache hit count */
  cacheHits: number;
  /** Cache miss count */
  cacheMisses: number;
  /** Cache hit rate */
  cacheHitRate: number;
  /** Average total response time */
  avgResponseTimeMs: number;
  /** Average cache hit response time */
  avgCacheHitTimeMs: number;
  /** Average tool execution time (cache miss) */
  avgToolExecutionTimeMs: number;
  /** Success rate */
  successRate: number;
  /** Error rate */
  errorRate: number;
  /** Performance grade based on FACT targets */
  performanceGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  /** Cost savings from caching */
  costSavingsPercent: number;
}

/**
 * Configuration for the deterministic executor
 */
export interface DeterministicExecutorConfig {
  /** Whether to enable caching */
  enableCache: boolean;
  /** Cache instance to use (defaults to global) */
  cache?: FACTCache;
  /** Maximum execution time per tool */
  timeoutMs: number;
  /** Whether to maintain full audit trail */
  enableAuditTrail: boolean;
  /** Maximum audit entries to keep in memory */
  maxAuditEntries: number;
  /** Target response time for performance grading */
  targetResponseTimeMs: number;
  /** Target cache hit rate */
  targetCacheHitRate: number;
}

/**
 * Default configuration following FACT performance targets
 */
const DEFAULT_CONFIG: DeterministicExecutorConfig = {
  enableCache: true,
  timeoutMs: 30000,
  enableAuditTrail: true,
  maxAuditEntries: 10000,
  targetResponseTimeMs: 50, // Sub-50ms FACT target
  targetCacheHitRate: 0.87  // 87% FACT target
};

/**
 * Deterministic Tool Executor with FACT Cache Integration
 */
export class DeterministicExecutor {
  private config: DeterministicExecutorConfig;
  private cache: FACTCache;
  private auditTrail: ExecutionAuditEntry[] = [];
  private metrics: ExecutorMetrics;
  private executionCounter = 0;

  constructor(config: Partial<DeterministicExecutorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.cache = config.cache || globalFACTCache;
    
    this.metrics = {
      totalExecutions: 0,
      cacheHits: 0,
      cacheMisses: 0,
      cacheHitRate: 0,
      avgResponseTimeMs: 0,
      avgCacheHitTimeMs: 0,
      avgToolExecutionTimeMs: 0,
      successRate: 1.0,
      errorRate: 0,
      performanceGrade: 'A+',
      costSavingsPercent: 0
    };
  }

  /**
   * Execute tool call with cache-first approach
   */
  async executeToolCall(
    tool: ITool,
    toolCall: ToolCall,
    context?: ToolExecutionContext
  ): Promise<ToolResult> {
    const executionId = this.generateExecutionId();
    const startTime = performance.now();
    
    let auditEntry: ExecutionAuditEntry = {
      executionId,
      toolCall: { ...toolCall },
      result: { success: false, error: 'Not executed' },
      cacheHit: false,
      timing: {
        started: startTime,
        cacheChecked: 0,
        completed: 0,
        totalMs: 0,
        cacheCheckMs: 0
      },
      context: context ? { ...context } : undefined
    };

    try {
      // Step 1: Cache check (FACT cache-first pattern)
      let result: ToolResult | null = null;
      
      if (this.config.enableCache) {
        const cacheCheckStart = performance.now();
        result = await this.cache.get(toolCall, context);
        const cacheCheckEnd = performance.now();
        
        auditEntry.timing.cacheChecked = cacheCheckEnd;
        auditEntry.timing.cacheCheckMs = cacheCheckEnd - cacheCheckStart;
        
        if (result) {
          // Cache hit - return immediately
          auditEntry.cacheHit = true;
          auditEntry.result = { ...result };
          
          const endTime = performance.now();
          auditEntry.timing.completed = endTime;
          auditEntry.timing.totalMs = endTime - startTime;
          
          this.updateMetrics(auditEntry);
          this.addToAuditTrail(auditEntry);
          
          return result;
        }
      }

      // Step 2: Cache miss - execute tool
      const toolExecutionStart = performance.now();
      
      try {
        result = await this.executeToolWithTimeout(tool, toolCall, context);
        auditEntry.result = { ...result };
        
        const toolExecutionEnd = performance.now();
        auditEntry.timing.toolExecuted = toolExecutionEnd;
        auditEntry.timing.toolExecutionMs = toolExecutionEnd - toolExecutionStart;
        
      } catch (error: unknown) {
        // Handle execution error
        const toolError = error as ToolExecutionError;
        result = {
          success: false,
          error: toolError.message || String(error),
          metadata: {
            timestamp: new Date().toISOString(),
            toolName: tool.name,
            executionTime: performance.now() - toolExecutionStart,
            errorType: toolError.type || 'unknown'
          }
        };
        
        auditEntry.result = { ...result };
        auditEntry.error = {
          type: toolError.type || 'execution_error',
          message: toolError.message || String(error),
          stack: toolError.stack
        };
      }

      // Step 3: Store result in cache if successful
      if (this.config.enableCache && result.success) {
        const cacheSaveStart = performance.now();
        
        try {
          const cached = await this.cache.store(toolCall, result, context);
          const cacheSaveEnd = performance.now();
          
          auditEntry.timing.cacheSaved = cacheSaveEnd;
          auditEntry.timing.cacheSaveMs = cacheSaveEnd - cacheSaveStart;
          
          if (cached) {
            // Add cache strategy to audit
            auditEntry.cacheStrategy = this.determineCacheStrategy(toolCall, result);
            auditEntry.tokenCount = this.estimateTokenCount(toolCall, result);
          }
        } catch (cacheError) {
          // Cache storage failed - continue without caching
          console.warn('Failed to store result in cache:', cacheError);
        }
      }

      const endTime = performance.now();
      auditEntry.timing.completed = endTime;
      auditEntry.timing.totalMs = endTime - startTime;
      
      this.updateMetrics(auditEntry);
      this.addToAuditTrail(auditEntry);
      
      return result;

    } catch (error: unknown) {
      // Handle unexpected errors
      const endTime = performance.now();
      auditEntry.timing.completed = endTime;
      auditEntry.timing.totalMs = endTime - startTime;
      
      const unexpectedError: ToolResult = {
        success: false,
        error: `Unexpected execution error: ${error}`,
        metadata: {
          timestamp: new Date().toISOString(),
          toolName: tool.name,
          executionTime: auditEntry.timing.totalMs
        }
      };
      
      auditEntry.result = unexpectedError;
      auditEntry.error = {
        type: 'unexpected_error',
        message: String(error),
        stack: error instanceof Error ? error.stack : undefined
      };
      
      this.updateMetrics(auditEntry);
      this.addToAuditTrail(auditEntry);
      
      return unexpectedError;
    }
  }

  /**
   * Execute tool with timeout protection
   */
  private async executeToolWithTimeout(
    tool: ITool,
    toolCall: ToolCall,
    context?: ToolExecutionContext
  ): Promise<ToolResult> {
    return new Promise(async (resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new ToolExecutionError(ToolErrorType.TIMEOUT, `Tool execution timed out after ${this.config.timeoutMs}ms`));
      }, this.config.timeoutMs);

      try {
        const result = await tool.execute(toolCall.parameters || {}, context);
        clearTimeout(timeoutId);
        resolve(result);
      } catch (error: unknown) {
        clearTimeout(timeoutId);
        reject(error);
      }
    });
  }

  /**
   * Generate unique execution ID
   */
  private generateExecutionId(): string {
    this.executionCounter++;
    const timestamp = Date.now();
    const counter = this.executionCounter.toString().padStart(6, '0');
    return `exec_${timestamp}_${counter}`;
  }

  /**
   * Determine cache strategy for audit purposes
   */
  private determineCacheStrategy(toolCall: ToolCall, result: ToolResult): string {
    const { name } = toolCall;
    
    if (name.includes('config') || name.includes('schema')) return 'static';
    if (name.includes('user') || name.includes('preference')) return 'semi-dynamic';
    if (name.includes('temp') || name.includes('calculate')) return 'ephemeral';
    return 'dynamic';
  }

  /**
   * Estimate token count for cost analysis
   */
  private estimateTokenCount(toolCall: ToolCall, result: ToolResult): number {
    const callText = JSON.stringify(toolCall);
    const resultText = JSON.stringify(result);
    return Math.ceil((callText.length + resultText.length) / 4);
  }

  /**
   * Update performance metrics
   */
  private updateMetrics(auditEntry: ExecutionAuditEntry): void {
    this.metrics.totalExecutions++;
    
    if (auditEntry.cacheHit) {
      this.metrics.cacheHits++;
      
      // Update cache hit response time
      const newAvg = (this.metrics.avgCacheHitTimeMs * (this.metrics.cacheHits - 1) + auditEntry.timing.totalMs) / this.metrics.cacheHits;
      this.metrics.avgCacheHitTimeMs = newAvg;
    } else {
      this.metrics.cacheMisses++;
      
      // Update tool execution time
      if (auditEntry.timing.toolExecutionMs) {
        const newAvg = (this.metrics.avgToolExecutionTimeMs * (this.metrics.cacheMisses - 1) + auditEntry.timing.toolExecutionMs) / this.metrics.cacheMisses;
        this.metrics.avgToolExecutionTimeMs = newAvg;
      }
    }
    
    // Update overall response time
    const newAvgResponse = (this.metrics.avgResponseTimeMs * (this.metrics.totalExecutions - 1) + auditEntry.timing.totalMs) / this.metrics.totalExecutions;
    this.metrics.avgResponseTimeMs = newAvgResponse;
    
    // Update rates
    this.metrics.cacheHitRate = this.metrics.cacheHits / this.metrics.totalExecutions;
    
    const successCount = this.auditTrail.filter(entry => entry.result.success).length;
    this.metrics.successRate = successCount / this.metrics.totalExecutions;
    this.metrics.errorRate = 1 - this.metrics.successRate;
    
    // Calculate cost savings (assume cache hit saves 95% of cost)
    this.metrics.costSavingsPercent = (this.metrics.cacheHits * 0.95) / this.metrics.totalExecutions * 100;
    
    // Calculate performance grade
    this.metrics.performanceGrade = this.calculatePerformanceGrade();
  }

  /**
   * Calculate performance grade based on FACT targets
   */
  private calculatePerformanceGrade(): 'A+' | 'A' | 'B' | 'C' | 'D' | 'F' {
    const hitRateScore = this.metrics.cacheHitRate >= this.config.targetCacheHitRate ? 100 : (this.metrics.cacheHitRate / this.config.targetCacheHitRate) * 100;
    const responseTimeScore = this.metrics.avgCacheHitTimeMs <= this.config.targetResponseTimeMs ? 100 : (this.config.targetResponseTimeMs / this.metrics.avgCacheHitTimeMs) * 100;
    const successScore = this.metrics.successRate * 100;
    
    const overallScore = (hitRateScore * 0.4) + (responseTimeScore * 0.4) + (successScore * 0.2);
    
    if (overallScore >= 95) return 'A+';
    if (overallScore >= 90) return 'A';
    if (overallScore >= 80) return 'B';
    if (overallScore >= 70) return 'C';
    if (overallScore >= 60) return 'D';
    return 'F';
  }

  /**
   * Add entry to audit trail with size management
   */
  private addToAuditTrail(entry: ExecutionAuditEntry): void {
    if (!this.config.enableAuditTrail) return;
    
    this.auditTrail.push(entry);
    
    // Trim audit trail if it exceeds max size
    if (this.auditTrail.length > this.config.maxAuditEntries) {
      const removeCount = Math.floor(this.config.maxAuditEntries * 0.1); // Remove oldest 10%
      this.auditTrail.splice(0, removeCount);
    }
  }

  /**
   * Get current performance metrics
   */
  public getMetrics(): ExecutorMetrics {
    return { ...this.metrics };
  }

  /**
   * Get cache metrics
   */
  public getCacheMetrics(): CacheMetrics {
    return this.cache.getMetrics();
  }

  /**
   * Get recent audit trail entries
   */
  public getAuditTrail(limit?: number): ExecutionAuditEntry[] {
    if (!this.config.enableAuditTrail) return [];
    
    const entries = [...this.auditTrail];
    if (limit) {
      return entries.slice(-limit);
    }
    return entries;
  }

  /**
   * Get performance report combining executor and cache metrics
   */
  public getPerformanceReport(): {
    executor: ExecutorMetrics;
    cache: CacheMetrics;
    summary: {
      totalExecutions: number;
      cacheEfficiency: number;
      avgResponseTime: number;
      performanceGrade: string;
      meetsTargets: boolean;
      recommendations: string[];
    };
  } {
    const cacheMetrics = this.getCacheMetrics();
    
    const meetsTargets = this.metrics.avgCacheHitTimeMs <= this.config.targetResponseTimeMs &&
                        this.metrics.cacheHitRate >= this.config.targetCacheHitRate;
    
    const recommendations: string[] = [];
    
    if (this.metrics.avgCacheHitTimeMs > this.config.targetResponseTimeMs) {
      recommendations.push(`Cache hit response time (${this.metrics.avgCacheHitTimeMs.toFixed(1)}ms) exceeds target (${this.config.targetResponseTimeMs}ms)`);
    }
    
    if (this.metrics.cacheHitRate < this.config.targetCacheHitRate) {
      recommendations.push(`Cache hit rate (${(this.metrics.cacheHitRate * 100).toFixed(1)}%) is below target (${(this.config.targetCacheHitRate * 100).toFixed(1)}%)`);
    }
    
    if (this.metrics.errorRate > 0.05) {
      recommendations.push(`Error rate (${(this.metrics.errorRate * 100).toFixed(1)}%) is above acceptable threshold (5%)`);
    }

    return {
      executor: this.metrics,
      cache: cacheMetrics,
      summary: {
        totalExecutions: this.metrics.totalExecutions,
        cacheEfficiency: this.metrics.cacheHitRate * 100,
        avgResponseTime: this.metrics.avgResponseTimeMs,
        performanceGrade: this.metrics.performanceGrade,
        meetsTargets,
        recommendations
      }
    };
  }

  /**
   * Clear audit trail and reset metrics
   */
  public reset(): void {
    this.auditTrail = [];
    this.metrics = {
      totalExecutions: 0,
      cacheHits: 0,
      cacheMisses: 0,
      cacheHitRate: 0,
      avgResponseTimeMs: 0,
      avgCacheHitTimeMs: 0,
      avgToolExecutionTimeMs: 0,
      successRate: 1.0,
      errorRate: 0,
      performanceGrade: 'A+',
      costSavingsPercent: 0
    };
    this.executionCounter = 0;
  }

  /**
   * Export audit trail for analysis
   */
  public exportAuditTrail(): string {
    return JSON.stringify(this.auditTrail, null, 2);
  }

  /**
   * Shutdown executor
   */
  public shutdown(): void {
    this.auditTrail = [];
  }
}

/**
 * Global deterministic executor instance
 */
export const globalDeterministicExecutor = new DeterministicExecutor();