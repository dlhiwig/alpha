/**
 * Simple LLM integration module for SuperClaw Gateway
 * 
 * Provides a clean interface to call Ollama for chat completions with tool support
 */

import { ToolManager } from './tools/manager';
import { ToolPromptGenerator } from './tool-prompt';
import { AgentContext } from './agent/executor';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

interface LLMRequest {
  message: string;
  sessionHistory?: Message[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

interface LLMResponse {
  response: string;
  model: string;
  tokensUsed: {
    input: number;
    output: number;
  };
  latency: number;
  toolCalls?: Array<{
    name: string;
    arguments: Record<string, any>;
    result?: any;
    error?: string;
  }>;
}

export class LLMClient {
  private readonly endpoint: string;
  private readonly defaultModel: string;
  private readonly timeoutMs: number;
  private toolManager: ToolManager;
  private toolPromptGenerator: ToolPromptGenerator;
  private agentContext: AgentContext;

  constructor(
    endpoint: string = 'http://127.0.0.1:11434',
    defaultModel: string = 'dolphin-llama3:8b',
    timeoutMs: number = 30000
  ) {
    this.endpoint = endpoint;
    this.defaultModel = defaultModel;
    this.timeoutMs = timeoutMs;
    this.toolManager = new ToolManager();
    this.toolPromptGenerator = new ToolPromptGenerator(this.toolManager);
    // Initialize a basic agent context - this could be enhanced later
    this.agentContext = {
      sessionId: 'default',
      userId: 'anonymous',
      agentId: 'default-agent',
      memory: new Map(),
      history: [],
      workspace: process.cwd(),
      tools: this.toolManager.listTools()
    };
  }

  /**
   * Generate a response from the LLM given a message and optional session history
   */
  async generate(request: LLMRequest): Promise<LLMResponse> {
    const startTime = Date.now();
    const model = request.model || this.defaultModel;
    let totalTokensInput = 0;
    let totalTokensOutput = 0;

    try {
      // Build the prompt with session history and tools
      const prompt = this.buildPromptWithTools(request.message, request.sessionHistory);

      // First LLM call
      let response = await this.callLLM(model, prompt, request);
      totalTokensInput += response.tokensUsed.input;
      totalTokensOutput += response.tokensUsed.output;

      // Check if response contains tool calls
      const toolCallData = ToolPromptGenerator.parseToolCalls(response.response);
      
      if (toolCallData && toolCallData.tool_calls.length > 0) {
        console.log(`[LLM] Found ${toolCallData.tool_calls.length} tool calls`);
        
        // Execute tools
        const executedCalls = await this.executeTools(toolCallData.tool_calls);
        
        // Build follow-up prompt with tool results
        const followUpPrompt = this.buildFollowUpPrompt(
          prompt, 
          response.response,
          toolCallData,
          executedCalls
        );
        
        // Second LLM call with tool results
        const followUpResponse = await this.callLLM(model, followUpPrompt, request);
        totalTokensInput += followUpResponse.tokensUsed.input;
        totalTokensOutput += followUpResponse.tokensUsed.output;
        
        const totalLatency = Date.now() - startTime;
        
        return {
          response: followUpResponse.response,
          model: followUpResponse.model,
          tokensUsed: {
            input: totalTokensInput,
            output: totalTokensOutput
          },
          latency: totalLatency,
          toolCalls: executedCalls
        };
      }

      // No tool calls, return original response
      return response;

    } catch (error: unknown) {
      const latency = Date.now() - startTime;
      
      // @ts-expect-error - Post-Merge Reconciliation
      if (error.name === 'TimeoutError') {
        throw new Error(`LLM request timed out after ${this.timeoutMs}ms`, { cause: error });
      }
      
      throw new Error(`LLM generation failed: ${(error as Error).message}`, { cause: error });
    }
  }

  /**
   * Make a single LLM API call
   */
  private async callLLM(model: string, prompt: string, request: LLMRequest): Promise<LLMResponse> {
    const startTime = Date.now();
    
    // Prepare Ollama API request
    const ollamaRequest = {
      model,
      prompt,
      stream: false,
      options: {
        temperature: request.temperature || 0.7,
        num_predict: request.maxTokens || 2048,
      }
    };

    // Make the API call
    const response = await fetch(`${this.endpoint}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(ollamaRequest),
      signal: AbortSignal.timeout(this.timeoutMs)
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data: any = await response.json();
    const latency = Date.now() - startTime;

    return {
      response: data.response,
      model: data.model,
      tokensUsed: {
        input: data.prompt_eval_count || this.estimateTokens(prompt),
        output: data.eval_count || this.estimateTokens(data.response)
      },
      latency
    };
  }

  /**
   * Execute tool calls
   */
  private async executeTools(toolCalls: Array<{ name: string; arguments: Record<string, any> }>): Promise<Array<{
    name: string;
    arguments: Record<string, any>;
    result?: any;
    error?: string;
  }>> {
    const results = [];
    
    for (const call of toolCalls) {
      try {
        console.log(`[LLM] Executing tool: ${call.name} with args:`, call.arguments);
        const result = await this.toolManager.execute(call.name, call.arguments, this.agentContext);
        results.push({
          ...call,
          result
        });
      } catch (error: unknown) {
        console.error(`[LLM] Tool execution failed for ${call.name}:`, error);
        results.push({
          ...call,
          error: (error as Error).message
        });
      }
    }
    
    return results;
  }

  /**
   * Build follow-up prompt with tool results
   */
  private buildFollowUpPrompt(
    originalPrompt: string, 
    llmResponse: string,
    toolCallData: { thinking?: string; tool_calls: Array<{ name: string; arguments: Record<string, any> }> },
    executedCalls: Array<{ name: string; arguments: Record<string, any>; result?: any; error?: string }>
  ): string {
    let followUpPrompt = originalPrompt;
    followUpPrompt += `\n\nAssistant: ${llmResponse}`;
    
    // Add tool execution results
    followUpPrompt += '\n\n[TOOL EXECUTION RESULTS]\n';
    
    for (const execution of executedCalls) {
      followUpPrompt += `\nTool: ${execution.name}\n`;
      followUpPrompt += `Arguments: ${JSON.stringify(execution.arguments)}\n`;
      
      if (execution.error) {
        followUpPrompt += `Error: ${execution.error}\n`;
      } else {
        followUpPrompt += `Result: ${JSON.stringify(execution.result, null, 2)}\n`;
      }
    }
    
    followUpPrompt += '\n[END TOOL RESULTS]\n\n';
    followUpPrompt += 'Based on the tool execution results above, provide a helpful response to the user. Do not include JSON tool calls in your response - just give a natural language answer based on the results.';
    followUpPrompt += '\n\nAssistant:';
    
    return followUpPrompt;
  }

  /**
   * Check if Ollama is running and accessible
   */
  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.endpoint}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get available models
   */
  async getModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.endpoint}/api/tags`);
      if (!response.ok) {
        throw new Error(`Failed to get models: ${response.statusText}`);
      }
      
      const data: any = await response.json();
      return data.models?.map((model: any) => model.name) || [];
    } catch (error: unknown) {
      throw new Error(`Failed to get models: ${(error as Error).message}`, { cause: error });
    }
  }

  /**
   * Build a conversational prompt with session history and tools
   */
  private buildPromptWithTools(message: string, sessionHistory?: Message[]): string {
    let prompt = '';

    // Add system prompt with tools
    const systemPrompt = this.toolPromptGenerator.generateSystemPrompt();
    prompt += `${systemPrompt}\n\n`;

    // Add conversation history if available
    if (sessionHistory && sessionHistory.length > 0) {
      // Take last 10 messages to keep context reasonable
      const recentHistory = sessionHistory.slice(-10);
      
      for (const msg of recentHistory) {
        if (msg.role === 'user') {
          prompt += `Human: ${msg.content}\n`;
        } else if (msg.role === 'assistant') {
          prompt += `Assistant: ${msg.content}\n`;
        } else if (msg.role === 'system') {
          // Skip system messages as we already added our system prompt
          continue;
        }
      }
    }

    // Add current message
    prompt += `Human: ${message}\n`;
    prompt += `Assistant:`;

    return prompt;
  }

  /**
   * Build a conversational prompt without tools (legacy method)
   */
  private buildPrompt(message: string, sessionHistory?: Message[]): string {
    return this.buildPromptWithTools(message, sessionHistory);
  }

  /**
   * Estimate token count (rough approximation)
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Get available tools
   */
  getAvailableTools(): string[] {
    return this.toolManager.listTools();
  }

  /**
   * Get tool manager instance
   */
  getToolManager(): ToolManager {
    return this.toolManager;
  }

  /**
   * Update agent context (useful for session management)
   */
  updateAgentContext(context: Partial<AgentContext>): void {
    this.agentContext = { ...this.agentContext, ...context };
  }

  /**
   * Generate tool summary for debugging
   */
  getToolSummary(): string[] {
    return this.toolPromptGenerator.generateToolSummary();
  }
}

// Export a default instance
export const llmClient = new LLMClient();