/**
 * SuperClaw Standalone Tool System Prompt Generator
 * Generates tool descriptions and schemas for LLM function calling
 */

import { ToolManager, ToolDefinition } from './tools/manager';

export class ToolPromptGenerator {
  private toolManager: ToolManager;
  
  constructor(toolManager: ToolManager) {
    this.toolManager = toolManager;
  }
  
  /**
   * Generate a system prompt that includes all available tools
   */
  generateSystemPrompt(): string {
    const tools = this.toolManager.getAvailableTools();
    
    if (tools.length === 0) {
      return this.getBaseSystemPrompt();
    }
    
    const toolDescriptions = this.generateToolDescriptions(tools);
    const toolSchemas = this.generateToolSchemas(tools);
    const examples = this.generateUsageExamples();
    
    return `${this.getBaseSystemPrompt()}

## Available Tools

You have access to the following tools that you can use to help users:

${toolDescriptions}

## Tool Calling Format

When you need to use a tool, format your response as JSON with this structure:
\`\`\`json
{
  "thinking": "Your reasoning about what tool to use and why",
  "tool_calls": [
    {
      "name": "tool_name",
      "arguments": {
        "parameter1": "value1",
        "parameter2": "value2"
      }
    }
  ]
}
\`\`\`

## Tool Schemas

${toolSchemas}

## Usage Examples

${examples}

## Important Notes

- You can call multiple tools in sequence if needed
- Always provide clear reasoning in the "thinking" field
- Handle tool errors gracefully and explain them to the user
- If a tool operation fails, suggest alternatives or ask for clarification
- Tools operate within a sandboxed workspace for security`;
  }
  
  /**
   * Get the base system prompt without tool information
   */
  private getBaseSystemPrompt(): string {
    return `You are SuperClaw, an AI assistant with access to various tools and capabilities.

## Core Behavior

- Be helpful, accurate, and concise
- Ask for clarification when requests are ambiguous
- Explain your reasoning when making decisions
- Be proactive in suggesting useful actions
- Always prioritize user safety and security

## Capabilities

- File operations (read, write, edit, list)
- Shell command execution
- Web search and content fetching
- Multi-turn conversations with context`;
  }
  
  /**
   * Generate human-readable tool descriptions
   */
  private generateToolDescriptions(tools: ToolDefinition[]): string {
    return tools.map(tool => {
      const func = tool.function;
      const params = Object.entries(func.parameters.properties || {})
        .map(([name, schema]: [string, any]) => {
          const required = func.parameters.required?.includes(name) ? ' (required)' : ' (optional)';
          const description = schema.description || 'No description';
          return `  - ${name}${required}: ${description}`;
        })
        .join('\n');
      
      return `### ${func.name}
${func.description}

Parameters:
${params || '  - No parameters'}`;
    }).join('\n\n');
  }
  
  /**
   * Generate JSON schemas for all tools
   */
  private generateToolSchemas(tools: ToolDefinition[]): string {
    return tools.map(tool => {
      return `### ${tool.function.name}
\`\`\`json
${JSON.stringify(tool, null, 2)}
\`\`\``;
    }).join('\n\n');
  }
  
  /**
   * Generate usage examples
   */
  private generateUsageExamples(): string {
    return `### Example 1: Reading a file
User: "Can you read the contents of config.json?"

Assistant response:
\`\`\`json
{
  "thinking": "The user wants to read a file called config.json. I'll use the read_file tool to access its contents.",
  "tool_calls": [
    {
      "name": "read_file",
      "arguments": {
        "path": "config.json"
      }
    }
  ]
}
\`\`\`

### Example 2: Web search and file creation
User: "Search for Node.js best practices and save the results to a file"

Assistant response:
\`\`\`json
{
  "thinking": "I need to first search for Node.js best practices, then save the results to a file. I'll use web_search first, then write_file with the results.",
  "tool_calls": [
    {
      "name": "web_search",
      "arguments": {
        "query": "Node.js best practices 2024",
        "count": 5
      }
    }
  ]
}
\`\`\`

### Example 3: Multiple operations
User: "List the files in the current directory and then create a README.md"

Assistant response:
\`\`\`json
{
  "thinking": "I need to first list the current directory contents to see what's there, then create a README.md file. I'll start with listing files.",
  "tool_calls": [
    {
      "name": "list_files",
      "arguments": {
        "path": "."
      }
    }
  ]
}
\`\`\``;
  }
  
  /**
   * Generate a compact tool list for quick reference
   */
  generateToolSummary(): string[] {
    const tools = this.toolManager.getAvailableTools();
    return tools.map(tool => `${tool.function.name}: ${tool.function.description}`);
  }
  
  /**
   * Check if a response contains tool calls
   */
  static hasToolCalls(response: string): boolean {
    try {
      const parsed = JSON.parse(response);
      return parsed.tool_calls && Array.isArray(parsed.tool_calls) && parsed.tool_calls.length > 0;
    } catch {
      // Also check for common tool call patterns in text
      return response.includes('"tool_calls"') || 
             response.includes('```json') && response.includes('tool_calls');
    }
  }
  
  /**
   * Parse tool calls from LLM response
   */
  static parseToolCalls(response: string): { thinking?: string; tool_calls: Array<{ name: string; arguments: Record<string, any> }> } | null {
    try {
      // First try to parse as direct JSON
      const parsed = JSON.parse(response);
      if (parsed.tool_calls) {
        return {
          thinking: parsed.thinking,
          tool_calls: parsed.tool_calls
        };
      }
    } catch {
      // Try to extract JSON from markdown code blocks
      const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          if (parsed.tool_calls) {
            return {
              thinking: parsed.thinking,
              tool_calls: parsed.tool_calls
            };
          }
        } catch {
          // Ignore parsing errors for code blocks
        }
      }
    }
    
    return null;
  }
}

// ToolDefinition is exported from manager.ts directly