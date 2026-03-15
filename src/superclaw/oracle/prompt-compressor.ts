/**
 * Prompt Compressor - Auto-optimization layer for SuperClaw
 * 
 * MISSION: Seamlessly integrate SynthLang optimization into SuperClaw prompts
 * 
 * Features:
 * - Auto-detection of compression opportunities
 * - Context-aware optimization
 * - Performance monitoring and A/B testing
 * - Rollback on semantic degradation
 */

import { SynthLangOptimizer, OptimizationMetrics, OptimizationOptions } from './synthlang-optimizer';

export interface CompressionConfig {
  enabled: boolean;
  autoOptimize: boolean;
  minPromptLength: number; // Only compress prompts above this length
  maxCompressionTime: number; // Milliseconds
  targetReduction: number; // 0.0 - 1.0
  semanticThreshold: number; // Minimum semantic accuracy required
  aggressiveness: 'conservative' | 'moderate' | 'aggressive';
  enableSymbolicNotation: boolean;
  enableCaching: boolean;
}

export interface CompressionResult {
  original: string;
  compressed: string;
  metrics: OptimizationMetrics;
  used: boolean;
  reason?: string; // Why compression was/wasn't applied
}

export class PromptCompressor {
  private optimizer: SynthLangOptimizer;
  private config: CompressionConfig;
  private performanceStats: {
    totalCompressions: number;
    totalSavings: number; // Token savings
    averageAccuracy: number;
    failureCount: number;
    rollbackCount: number;
  };
  
  constructor(config: Partial<CompressionConfig> = {}) {
    this.optimizer = new SynthLangOptimizer();
    
    // Default configuration
    this.config = {
      enabled: true,
      autoOptimize: true,
      minPromptLength: 100, // Only compress prompts > 100 chars
      maxCompressionTime: 3000, // 3 seconds max
      targetReduction: 0.70, // 70% reduction target
      semanticThreshold: 0.95, // 95% semantic accuracy required
      aggressiveness: 'moderate',
      enableSymbolicNotation: true,
      enableCaching: true,
      ...config
    };
    
    this.performanceStats = {
      totalCompressions: 0,
      totalSavings: 0,
      averageAccuracy: 0,
      failureCount: 0,
      rollbackCount: 0
    };
  }
  
  /**
   * Main compression entry point - intelligently compress prompts
   */
  async compress(prompt: string, context?: any): Promise<CompressionResult> {
    // Quick checks to determine if compression should be applied
    if (!this.config.enabled) {
      return {
        original: prompt,
        compressed: prompt,
        metrics: this.getNoCompressionMetrics(prompt),
        used: false,
        reason: 'Compression disabled'
      };
    }
    
    if (prompt.length < this.config.minPromptLength) {
      return {
        original: prompt,
        compressed: prompt,
        metrics: this.getNoCompressionMetrics(prompt),
        used: false,
        reason: `Prompt too short (${prompt.length} < ${this.config.minPromptLength})`
      };
    }
    
    // Skip compression for certain patterns
    if (this.shouldSkipCompression(prompt, context)) {
      return {
        original: prompt,
        compressed: prompt,
        metrics: this.getNoCompressionMetrics(prompt),
        used: false,
        reason: 'Matched skip pattern'
      };
    }
    
    try {
      const optimizationOptions = this.getOptimizationOptions();
      const { optimized, metrics } = await this.optimizer.optimize(prompt, optimizationOptions);
      
      // Validate compression quality
      if (metrics.semanticAccuracy < this.config.semanticThreshold) {
        this.performanceStats.rollbackCount++;
        return {
          original: prompt,
          compressed: prompt,
          metrics: this.getNoCompressionMetrics(prompt),
          used: false,
          reason: `Semantic accuracy too low (${metrics.semanticAccuracy.toFixed(3)} < ${this.config.semanticThreshold})`
        };
      }
      
      // Update performance statistics
      this.performanceStats.totalCompressions++;
      this.performanceStats.totalSavings += (metrics.originalTokens - metrics.optimizedTokens);
      this.performanceStats.averageAccuracy = 
        (this.performanceStats.averageAccuracy * (this.performanceStats.totalCompressions - 1) + metrics.semanticAccuracy) 
        / this.performanceStats.totalCompressions;
      
      return {
        original: prompt,
        compressed: optimized,
        metrics,
        used: true,
        reason: `Compressed with ${metrics.reductionPercent.toFixed(1)}% reduction`
      };
      
    } catch (error: unknown) {
      console.error('Prompt compression failed:', error);
      this.performanceStats.failureCount++;
      
      return {
        original: prompt,
        compressed: prompt,
        metrics: this.getNoCompressionMetrics(prompt),
        used: false,
        reason: `Compression failed: ${(error as Error).message}`
      };
    }
  }
  
  /**
   * Batch compress multiple prompts with intelligent load balancing
   */
  async compressBatch(
    prompts: Array<{ prompt: string; context?: any }>,
    options: { parallel?: boolean; maxConcurrent?: number } = {}
  ): Promise<CompressionResult[]> {
    const { parallel = true, maxConcurrent = 5 } = options;
    
    if (!parallel) {
      // Sequential processing
      const results: CompressionResult[] = [];
      for (const { prompt, context } of prompts) {
        results.push(await this.compress(prompt, context));
      }
      return results;
    }
    
    // Parallel processing with concurrency limit
    const chunks = this.chunkArray(prompts, maxConcurrent);
    const allResults: CompressionResult[] = [];
    
    for (const chunk of chunks) {
      const chunkResults = await Promise.all(
        chunk.map(({ prompt, context }) => this.compress(prompt, context))
      );
      allResults.push(...chunkResults);
    }
    
    return allResults;
  }
  
  /**
   * Auto-compression middleware for SuperClaw agents
   */
  createMiddleware() {
    return (prompt: string, agentContext?: any) => {
      if (!this.config.autoOptimize) {
        return { prompt, compressed: false };
      }
      
      // Async compression with fallback
      this.compress(prompt, agentContext)
        .then(result => {
          if (result.used && result.metrics.reductionPercent > 10) {
            console.log(`🚀 SynthLang compressed prompt: ${result.metrics.reductionPercent.toFixed(1)}% reduction`);
          }
        })
        .catch(error => {
          console.warn('Auto-compression failed:', error);
        });
      
      // For now, return original prompt (could be enhanced for async/await pattern)
      return { prompt, compressed: false };
    };
  }
  
  /**
   * Determine if compression should be skipped based on content analysis
   */
  private shouldSkipCompression(prompt: string, context?: any): boolean {
    // Skip for very code-heavy prompts (compression might break syntax)
    const codePatterns = [
      /```[\s\S]*```/g, // Code blocks
      /function\s+\w+\(/g,
      /class\s+\w+/g,
      /import\s+.*from/g,
      /const\s+\w+\s*=/g
    ];
    
    const codeBlockCount = (prompt.match(/```/g) || []).length;
    if (codeBlockCount >= 4) { // More than 2 code blocks
      return true;
    }
    
    // Skip for configuration/JSON-heavy prompts
    const jsonPatterns = [
      /{\s*["\w]+\s*:\s*["\w[\]{}]/g,
      /\[\s*{\s*["\w]+/g
    ];
    
    const jsonMatches = jsonPatterns.reduce((count, pattern) => {
      return count + (prompt.match(pattern) || []).length;
    }, 0);
    
    if (jsonMatches > 5) {
      return true;
    }
    
    // Skip for very mathematical content (symbols might interfere)
    const mathPatterns = [
      /\$.*\$/g, // LaTeX math
      /\\[a-zA-Z]+\{/g, // LaTeX commands
      /[∫∑∏∂∆∇]/g // Mathematical symbols
    ];
    
    const mathMatches = mathPatterns.reduce((count, pattern) => {
      return count + (prompt.match(pattern) || []).length;
    }, 0);
    
    if (mathMatches > 3) {
      return true;
    }
    
    // Context-based skipping
    if (context?.skipCompression || context?.preserveFormatting) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Get optimization options based on aggressiveness level
   */
  private getOptimizationOptions(): OptimizationOptions {
    const baseOptions: OptimizationOptions = {
      useSymbolicNotation: this.config.enableSymbolicNotation,
      preserveSemantics: true,
      maxCompressionTime: this.config.maxCompressionTime
    };
    
    switch (this.config.aggressiveness) {
      case 'conservative':
        return {
          ...baseOptions,
          targetReduction: Math.min(0.5, this.config.targetReduction),
        };
      
      case 'moderate':
        return {
          ...baseOptions,
          targetReduction: this.config.targetReduction,
        };
      
      case 'aggressive':
        return {
          ...baseOptions,
          targetReduction: Math.min(0.85, this.config.targetReduction * 1.2),
          maxCompressionTime: this.config.maxCompressionTime * 0.7, // Faster processing
        };
      
      default:
        return baseOptions;
    }
  }
  
  /**
   * Create metrics for non-compressed prompts
   */
  private getNoCompressionMetrics(prompt: string): OptimizationMetrics {
    const tokens = Math.ceil(prompt.length / 4);
    return {
      originalTokens: tokens,
      optimizedTokens: tokens,
      reductionPercent: 0,
      semanticAccuracy: 1.0,
      speedImprovement: 1.0,
      compressionTime: 0
    };
  }
  
  /**
   * Utility: chunk array for batch processing
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
  
  /**
   * Get performance statistics and recommendations
   */
  getPerformanceReport(): {
    // @ts-expect-error - Post-Merge Reconciliation
    stats: typeof this.performanceStats;
    recommendations: string[];
    efficiency: number;
  } {
    const efficiency = this.performanceStats.totalCompressions > 0
      ? (this.performanceStats.totalCompressions - this.performanceStats.failureCount - this.performanceStats.rollbackCount) 
        / this.performanceStats.totalCompressions
      : 0;
    
    const recommendations: string[] = [];
    
    // Generate recommendations based on performance
    if (this.performanceStats.averageAccuracy < 0.9) {
      recommendations.push('Consider reducing target compression ratio to improve semantic accuracy');
    }
    
    if (this.performanceStats.failureCount > this.performanceStats.totalCompressions * 0.1) {
      recommendations.push('High failure rate detected - check Python environment and SynthLang installation');
    }
    
    if (this.performanceStats.rollbackCount > this.performanceStats.totalCompressions * 0.2) {
      recommendations.push('Many rollbacks due to low semantic accuracy - consider raising semantic threshold');
    }
    
    if (this.performanceStats.totalSavings > 0) {
      const avgSavings = this.performanceStats.totalSavings / Math.max(1, this.performanceStats.totalCompressions);
      if (avgSavings < 20) {
        recommendations.push('Low token savings - consider increasing aggressiveness level');
      } else if (avgSavings > 100) {
        recommendations.push('High token savings achieved - compression working well');
      }
    }
    
    return {
      stats: { ...this.performanceStats },
      recommendations,
      efficiency
    };
  }
  
  /**
   * Update configuration at runtime
   */
  updateConfig(newConfig: Partial<CompressionConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }
  
  /**
   * Reset performance statistics
   */
  resetStats(): void {
    this.performanceStats = {
      totalCompressions: 0,
      totalSavings: 0,
      averageAccuracy: 0,
      failureCount: 0,
      rollbackCount: 0
    };
  }
  
  /**
   * A/B test different compression strategies
   */
  async abTestCompression(
    prompt: string,
    strategies: Array<{ name: string; config: Partial<CompressionConfig> }>
  ): Promise<Array<{ name: string; result: CompressionResult }>> {
    const results: Array<{ name: string; result: CompressionResult }> = [];
    
    for (const strategy of strategies) {
      // Temporarily apply strategy config
      const originalConfig = { ...this.config };
      this.updateConfig(strategy.config);
      
      try {
        const result = await this.compress(prompt);
        results.push({ name: strategy.name, result });
      } catch (error: unknown) {
        console.error(`A/B test strategy "${strategy.name}" failed:`, error);
      }
      
      // Restore original config
      this.config = originalConfig;
    }
    
    return results;
  }
}

// Export a default instance for easy use
export const defaultCompressor = new PromptCompressor();

/**
 * Convenience function for quick compression
 */
export async function compressPrompt(
  prompt: string, 
  config?: Partial<CompressionConfig>
): Promise<CompressionResult> {
  if (config) {
    const compressor = new PromptCompressor(config);
    return compressor.compress(prompt);
  }
  
  return defaultCompressor.compress(prompt);
}

/**
 * Express/Connect middleware for SuperClaw HTTP endpoints
 */
export function createCompressionMiddleware(config?: Partial<CompressionConfig>) {
  const compressor = new PromptCompressor(config);
  
  return async (req: any, res: any, next: any) => {
    if (req.body && req.body.prompt && typeof req.body.prompt === 'string') {
      try {
        const result = await compressor.compress(req.body.prompt, req.body.context);
        
        // Add compression metadata to request
        req.compressionResult = result;
        
        // Optionally replace the prompt with compressed version
        if (result.used && result.metrics.reductionPercent > 10) {
          req.body.prompt = result.compressed;
          req.body._original_prompt = result.original;
          req.body._compression_metadata = result.metrics;
        }
        
      } catch (error: unknown) {
        console.warn('Compression middleware error:', error);
        // Continue without compression
      }
    }
    
    next();
  };
}