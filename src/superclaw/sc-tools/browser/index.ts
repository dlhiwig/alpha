// @ts-nocheck
/**
 * SuperClaw Browser Tool
 * 
 * Production-ready browser automation tool using OpenBrowser MCP integration.
 * Provides the browser_execute tool that runs Python code with 3.2x-6x token efficiency.
 */

import { ToolDefinition } from '../registry';
import { SuperClawBrowserTool, OpenBrowserConfig, ExecuteCodeResult } from './openbrowser-mcp-integration';
import { trackTokenUsage, TokenUsage } from '../tracking/token-tracker';

export interface BrowserExecuteParams {
  python_code: string;
  config?: {
    headless?: boolean;
    timeout?: number;
    viewportWidth?: number;
    viewportHeight?: number;
    allowedDomains?: string;
    stealth?: boolean;
  };
}

export interface BrowserExecuteResult {
  success: boolean;
  output?: string;
  error?: string;
  executionTime: number;
  tokenUsage: TokenUsage;
  browserState?: any;
  metadata: {
    linesOfCode: number;
    codeComplexity: 'simple' | 'medium' | 'complex';
    operationType: 'navigation' | 'extraction' | 'interaction' | 'workflow';
    tokensEfficiency: number; // Estimated vs traditional browser tools
  };
}

// Global browser tool instance (singleton for resource management)
let browserToolInstance: SuperClawBrowserTool | null = null;

/**
 * Get or create the browser tool instance
 */
function getBrowserTool(config?: OpenBrowserConfig): SuperClawBrowserTool {
  if (!browserToolInstance) {
    browserToolInstance = new SuperClawBrowserTool(config);
  }
  return browserToolInstance;
}

/**
 * Analyze code complexity and type
 */
function analyzeCode(code: string): {
  linesOfCode: number;
  complexity: 'simple' | 'medium' | 'complex';
  operationType: 'navigation' | 'extraction' | 'interaction' | 'workflow';
  estimatedTokenEfficiency: number;
} {
  const lines = code.trim().split('\n').length;
  
  // Determine operation type
  let operationType: 'navigation' | 'extraction' | 'interaction' | 'workflow' = 'navigation';
  if (code.includes('evaluate(') && (code.includes('Array.from') || code.includes('querySelectorAll'))) {
    operationType = 'extraction';
  } else if (code.includes('click(') || code.includes('input_text(')) {
    operationType = 'interaction';
  } else if (lines > 10 || code.includes('for ') || code.includes('while ')) {
    operationType = 'workflow';
  }

  // Determine complexity
  let complexity: 'simple' | 'medium' | 'complex' = 'simple';
  if (lines > 20 || code.includes('pandas') || code.includes('numpy') || code.includes('json')) {
    complexity = 'complex';
  } else if (lines > 5 || code.includes('await ')) {
    complexity = 'medium';
  }

  // Estimate token efficiency vs traditional browser tools
  // Based on OpenBrowser documentation: 3.2x-6x improvement
  let estimatedTokenEfficiency = 3.2; // Conservative baseline
  
  if (operationType === 'extraction') {
    estimatedTokenEfficiency = 6.0; // Highest efficiency for data extraction
  } else if (operationType === 'workflow') {
    estimatedTokenEfficiency = 4.5; // Good efficiency for complex workflows
  } else if (operationType === 'interaction') {
    estimatedTokenEfficiency = 3.8; // Good efficiency for interactions
  }

  return {
    linesOfCode: lines,
    complexity,
    operationType,
    estimatedTokenEfficiency,
  };
}

/**
 * Browser execute tool handler
 */
async function browserExecuteHandler(params: BrowserExecuteParams): Promise<BrowserExecuteResult> {
  const startTime = Date.now();
  const { python_code, config } = params;

  try {
    // Initialize browser tool
    const browserTool = getBrowserTool(config);
    await browserTool.initialize();

    // Analyze the code
    const analysis = analyzeCode(python_code);

    // Track input tokens (rough estimate: 1 token ≈ 4 characters)
    const inputTokens = Math.ceil(python_code.length / 4);
    
    // Execute the workflow
    const result: ExecuteCodeResult = await browserTool.executeWorkflow(python_code);
    
    // Track output tokens
    const outputTokens = Math.ceil((result.output || result.error || '').length / 4);
    
    // Calculate token usage
    const tokenUsage = await trackTokenUsage({
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      model: 'openbrowser-mcp',
      operation: 'browser_execute',
      timestamp: new Date(),
    });

    const executionTime = Date.now() - startTime;

    return {
      success: result.success,
      output: result.output,
      error: result.error,
      executionTime,
      // @ts-expect-error - Post-Merge Reconciliation
      tokenUsage,
      metadata: {
        linesOfCode: analysis.linesOfCode,
        codeComplexity: analysis.complexity,
        operationType: analysis.operationType,
        tokensEfficiency: analysis.estimatedTokenEfficiency,
      },
    };

  } catch (error: unknown) {
    const executionTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? (error).message : String(error);
    
    // Track failed execution tokens
    const inputTokens = Math.ceil(python_code.length / 4);
    const outputTokens = Math.ceil(errorMessage.length / 4);
    
    const tokenUsage = await trackTokenUsage({
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      model: 'openbrowser-mcp',
      operation: 'browser_execute',
      timestamp: new Date(),
      error: true,
    });

    const analysis = analyzeCode(python_code);

    return {
      success: false,
      error: errorMessage,
      executionTime,
      // @ts-expect-error - Post-Merge Reconciliation
      tokenUsage,
      metadata: {
        linesOfCode: analysis.linesOfCode,
        codeComplexity: analysis.complexity,
        operationType: analysis.operationType,
        tokensEfficiency: analysis.estimatedTokenEfficiency,
      },
    };
  }
}

/**
 * Browser state helper tool
 */
async function browserStateHandler(): Promise<{
  success: boolean;
  state?: any;
  error?: string;
}> {
  try {
    const browserTool = getBrowserTool();
    await browserTool.initialize();
    
    const result = await browserTool.getBrowserState();
    
    return {
      success: result.success,
      state: result.output,
      error: result.error,
    };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? (error).message : String(error),
    };
  }
}

/**
 * Browser navigation helper tool
 */
async function browserNavigateHandler(params: { url: string }): Promise<{
  success: boolean;
  message?: string;
  error?: string;
}> {
  try {
    const browserTool = getBrowserTool();
    await browserTool.initialize();
    
    const result = await browserTool.navigate(params.url);
    
    return {
      success: result.success,
      message: result.output,
      error: result.error,
    };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? (error).message : String(error),
    };
  }
}

/**
 * Browser cleanup tool
 */
async function browserCleanupHandler(): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    if (browserToolInstance) {
      await browserToolInstance.cleanup();
      browserToolInstance = null;
    }
    
    return {
      success: true,
      message: 'Browser tool cleaned up successfully',
    };
  } catch (error: unknown) {
    return {
      success: true, // Always succeed cleanup
      message: `Cleanup completed with warning: ${error instanceof Error ? (error).message : String(error)}`,
    };
  }
}

// --- Tool Definitions ---

export const browserExecuteTool: ToolDefinition = {
  name: 'browser_execute',
  description: `Execute Python code in a persistent browser automation namespace. Achieves 3.2x-6x token efficiency vs traditional browser tools.

Available functions:
- Navigation: navigate(url), go_back(), wait(seconds)
- Interaction: click(index), input_text(index, text), scroll(), send_keys()
- JavaScript: evaluate(js_code) - returns Python objects
- Data: json, csv, re, datetime, requests, numpy, pandas, matplotlib, BeautifulSoup
- Completion: done(text, success=True)

All functions are async - use await. Browser state persists between calls.`,
  
  parameters: {
    type: 'object',
    properties: {
      python_code: {
        type: 'string',
        description: 'Python code to execute with browser automation functions',
      },
      config: {
        type: 'object',
        description: 'Optional browser configuration',
        properties: {
          headless: {
            type: 'boolean',
            description: 'Run browser without GUI (default: true)',
          },
          timeout: {
            type: 'number',
            description: 'Default timeout for operations in milliseconds',
          },
          viewportWidth: {
            type: 'number',
            description: 'Browser viewport width',
          },
          viewportHeight: {
            type: 'number',
            description: 'Browser viewport height',
          },
          allowedDomains: {
            type: 'string',
            description: 'Comma-separated domain whitelist',
          },
          stealth: {
            type: 'boolean',
            description: 'Enable stealth mode to avoid detection',
          },
        },
        additionalProperties: false,
      },
    },
    required: ['python_code'],
    // @ts-expect-error - Post-Merge Reconciliation
    additionalProperties: false,
  },
  
  handler: browserExecuteHandler,
  
  metadata: {
    category: 'browser',
    riskLevel: 'medium',
    requiresAuth: false,
    version: '1.0.0',
  },
};

export const browserStateTool: ToolDefinition = {
  name: 'browser_state',
  description: 'Get current browser state including page info and interactive elements',
  
  parameters: {
    type: 'object',
    properties: {},
    // @ts-expect-error - Post-Merge Reconciliation
    additionalProperties: false,
  },
  
  handler: browserStateHandler,
  
  metadata: {
    category: 'browser',
    riskLevel: 'low',
    requiresAuth: false,
    version: '1.0.0',
  },
};

export const browserNavigateTool: ToolDefinition = {
  name: 'browser_navigate',
  description: 'Simple browser navigation to a URL',
  
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'URL to navigate to',
      },
    },
    required: ['url'],
    // @ts-expect-error - Post-Merge Reconciliation
    additionalProperties: false,
  },
  
  handler: browserNavigateHandler,
  
  metadata: {
    category: 'browser',
    riskLevel: 'low',
    requiresAuth: false,
    version: '1.0.0',
  },
};

export const browserCleanupTool: ToolDefinition = {
  name: 'browser_cleanup',
  description: 'Clean up browser resources and close connections',
  
  parameters: {
    type: 'object',
    properties: {},
    // @ts-expect-error - Post-Merge Reconciliation
    additionalProperties: false,
  },
  
  handler: browserCleanupHandler,
  
  metadata: {
    category: 'browser',
    riskLevel: 'low',
    requiresAuth: false,
    version: '1.0.0',
  },
};

// Export all browser tools
export const browserTools = [
  browserExecuteTool,
  browserStateTool,
  browserNavigateTool,
  browserCleanupTool,
];

export default browserExecuteTool;