/**
 * SuperClaw CLI Providers
 * 
 * Unified interface for orchestrating external LLM CLIs:
 * - Codex CLI (OpenAI) - Code generation
 * - Gemini CLI (Google) - General + multimodal
 * - Claude Code (Anthropic) - Reasoning + code
 * 
 * Architecture:
 *   OpenClaw → SuperClaw → llm-run → [codex|gemini|claude]
 */

export * from './types';
export * from './executor';

import {
  checkAllProviders,
  execute,
  executeAuto,
  executeParallel,
  executeWithConsensus,
} from './executor';
import type { CLIProviderName, CLIExecuteRequest, CLIExecuteResult } from './types';

/**
 * SuperClaw CLI Provider Manager
 * 
 * Provides high-level orchestration of CLI providers.
 */
export class CLIProviderManager {
  private initialized = false;
  private availableProviders: CLIProviderName[] = [];
  
  /**
   * Initialize and check available providers
   */
  async init(): Promise<void> {
    if (this.initialized) {return;}
    
    const statuses = await checkAllProviders();
    this.availableProviders = statuses
      .filter((s) => s.available)
      .map((s) => s.name);
    
    this.initialized = true;
    
    console.log(`[cli-providers] Available: ${this.availableProviders.join(', ') || 'none'}`);
  }
  
  /**
   * Get list of available providers
   */
  getAvailable(): CLIProviderName[] {
    return [...this.availableProviders];
  }
  
  /**
   * Execute a prompt with a specific provider
   */
  async execute(request: CLIExecuteRequest): Promise<CLIExecuteResult> {
    await this.init();
    return execute(request);
  }
  
  /**
   * Execute with automatic provider selection
   */
  async auto(
    prompt: string,
    taskType: 'code' | 'reasoning' | 'general' = 'general'
  ): Promise<CLIExecuteResult> {
    await this.init();
    return executeAuto(prompt, taskType);
  }
  
  /**
   * Execute across all available providers
   */
  async parallel(prompt: string): Promise<CLIExecuteResult[]> {
    await this.init();
    return executeParallel(prompt, this.availableProviders);
  }
  
  /**
   * Execute with consensus across providers
   */
  async consensus(prompt: string): Promise<{
    consensus: string | null;
    results: CLIExecuteResult[];
    agreement: number;
  }> {
    await this.init();
    return executeWithConsensus(prompt, this.availableProviders);
  }
  
  /**
   * Route a task to the best provider based on content analysis
   */
  async route(prompt: string): Promise<CLIExecuteResult> {
    await this.init();
    
    // Simple routing heuristics
    const lowerPrompt = prompt.toLowerCase();
    
    let taskType: 'code' | 'reasoning' | 'general' = 'general';
    
    // Code indicators
    if (
      lowerPrompt.includes('write code') ||
      lowerPrompt.includes('function') ||
      lowerPrompt.includes('implement') ||
      lowerPrompt.includes('debug') ||
      lowerPrompt.includes('refactor') ||
      /\.(ts|js|py|go|rs|java|cpp|c|rb)/.test(lowerPrompt)
    ) {
      taskType = 'code';
    }
    // Reasoning indicators
    else if (
      lowerPrompt.includes('explain') ||
      lowerPrompt.includes('analyze') ||
      lowerPrompt.includes('compare') ||
      lowerPrompt.includes('why') ||
      lowerPrompt.includes('how does') ||
      lowerPrompt.includes('design') ||
      lowerPrompt.includes('architect')
    ) {
      taskType = 'reasoning';
    }
    
    return this.auto(prompt, taskType);
  }
}

// Singleton instance
export const cliProviders = new CLIProviderManager();
