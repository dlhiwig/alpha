/**
 * Agent Domain Entity
 * From claude-flow v3 (ruvnet/claude-flow)
 * 
 * Modified to support real LLM execution
 */

import type {
  Agent as IAgent,
  AgentConfig,
  AgentStatus,
  AgentType,
  AgentRole,
  Task,
  TaskResult
} from './types';

import type { LLMProvider, LLMMessage, LLMResponse } from '../llm/provider';
import { buildAgentPrompt, buildTaskPrompt, type PromptContext } from '../llm/prompts';

export interface AgentOptions extends AgentConfig {
  llmProvider?: LLMProvider;
  systemPrompt?: string;
  conversationHistory?: LLMMessage[];
}

export class Agent implements IAgent {
  public readonly id: string;
  public readonly type: AgentType;
  public status: AgentStatus;
  public capabilities: string[];
  public role?: AgentRole;
  public parent?: string;
  public metadata?: Record<string, unknown>;
  public createdAt: number;
  public lastActive: number;

  // LLM-related properties
  private llmProvider?: LLMProvider;
  private systemPrompt: string;
  private conversationHistory: LLMMessage[];
  private lastResponse?: LLMResponse;

  constructor(config: AgentOptions) {
    this.id = config.id;
    this.type = config.type;
    this.status = 'active';
    this.capabilities = config.capabilities || [];
    this.role = config.role;
    this.parent = config.parent;
    this.metadata = config.metadata || {};
    this.createdAt = Date.now();
    this.lastActive = Date.now();

    // LLM setup
    this.llmProvider = config.llmProvider;
    this.systemPrompt = config.systemPrompt || buildAgentPrompt(this.type, this.role);
    this.conversationHistory = config.conversationHistory || [];
  }

  /**
   * Set or update the LLM provider
   */
  setLLMProvider(provider: LLMProvider): void {
    this.llmProvider = provider;
  }

  /**
   * Get the current system prompt
   */
  getSystemPrompt(): string {
    return this.systemPrompt;
  }

  /**
   * Get conversation history
   */
  getConversationHistory(): LLMMessage[] {
    return [...this.conversationHistory];
  }

  /**
   * Clear conversation history (for fresh context)
   */
  clearHistory(): void {
    this.conversationHistory = [];
  }

  /**
   * Get the last LLM response (for metrics/debugging)
   */
  getLastResponse(): LLMResponse | undefined {
    return this.lastResponse;
  }

  async executeTask(task: Task): Promise<TaskResult> {
    if (this.status !== 'active' && this.status !== 'idle') {
      return {
        taskId: task.id,
        status: 'failed',
        error: `Agent ${this.id} is not available (status: ${this.status})`,
        agentId: this.id
      };
    }

    const startTime = Date.now();
    this.status = 'busy';
    this.lastActive = startTime;

    try {
      // Execute any custom callback first
      if (task.onExecute) {
        await task.onExecute();
      }

      // Process the task (with LLM if available)
      const result = await this.processTaskExecution(task);

      const duration = Date.now() - startTime;
      this.status = 'active';
      this.lastActive = Date.now();

      return {
        taskId: task.id,
        status: 'completed',
        result,
        duration,
        agentId: this.id,
        metadata: this.lastResponse ? {
          model: this.lastResponse.model,
          inputTokens: this.lastResponse.usage?.inputTokens,
          outputTokens: this.lastResponse.usage?.outputTokens,
          llmDurationMs: this.lastResponse.durationMs
        } : undefined
      };
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      this.status = 'active';

      return {
        taskId: task.id,
        status: 'failed',
        error: error instanceof Error ? (error as Error).message : String(error),
        duration,
        agentId: this.id
      };
    }
  }

  private async processTaskExecution(task: Task): Promise<string> {
    // If no LLM provider, fall back to mock execution
    if (!this.llmProvider) {
      console.log(`[Agent ${this.id}] No LLM provider - using mock execution`);
      const processingTime: Record<string, number> = {
        high: 50,
        medium: 100,
        low: 200
      };
      const overhead = processingTime[task.priority] || 100;
      await new Promise(resolve => setTimeout(resolve, overhead));
      return `[Mock] Task ${task.id} completed by ${this.id}`;
    }

    // Build the task prompt
    const context: PromptContext = {
      taskDescription: task.description || `Execute task: ${task.id}`,
      taskType: task.type,
      dependencies: task.dependencies,
      metadata: task.metadata as Record<string, unknown> | undefined
    };

    const taskPrompt = buildTaskPrompt(context);

    // Build messages array
    const messages: LLMMessage[] = [
      { role: 'system', content: this.systemPrompt },
      ...this.conversationHistory,
      { role: 'user', content: taskPrompt }
    ];

    console.log(`[Agent ${this.id}] Calling LLM with ${messages.length} messages...`);

    // Call the LLM
    this.lastResponse = await this.llmProvider.complete(messages);

    console.log(`[Agent ${this.id}] LLM responded in ${this.lastResponse.durationMs}ms (${this.lastResponse.usage?.outputTokens || '?'} tokens)`);

    // Add to conversation history
    this.conversationHistory.push(
      { role: 'user', content: taskPrompt },
      { role: 'assistant', content: this.lastResponse.content }
    );

    // Trim history if too long (keep last 10 exchanges)
    const maxHistory = 20; // 10 user + 10 assistant messages
    if (this.conversationHistory.length > maxHistory) {
      this.conversationHistory = this.conversationHistory.slice(-maxHistory);
    }

    return this.lastResponse.content;
  }

  hasCapability(capability: string): boolean {
    return this.capabilities.includes(capability);
  }

  canExecute(taskType: string): boolean {
    const typeToCapability: Record<string, string> = {
      code: 'code',
      test: 'test',
      review: 'review',
      design: 'design',
      deploy: 'deploy',
      refactor: 'refactor',
      debug: 'debug',
      research: 'research',
      analyze: 'analyze'
    };

    const requiredCapability = typeToCapability[taskType];
    return requiredCapability ? this.hasCapability(requiredCapability) : true;
  }

  terminate(): void {
    this.status = 'terminated';
    this.lastActive = Date.now();
  }

  setIdle(): void {
    if (this.status === 'active' || this.status === 'busy') {
      this.status = 'idle';
      this.lastActive = Date.now();
    }
  }

  activate(): void {
    if (this.status !== 'terminated') {
      this.status = 'active';
      this.lastActive = Date.now();
    }
  }

  toJSON(): IAgent {
    return {
      id: this.id,
      type: this.type,
      status: this.status,
      capabilities: this.capabilities,
      role: this.role,
      parent: this.parent,
      metadata: this.metadata,
      createdAt: this.createdAt,
      lastActive: this.lastActive
    };
  }

  static fromConfig(config: AgentOptions): Agent {
    return new Agent(config);
  }
}

export { Agent as default };
