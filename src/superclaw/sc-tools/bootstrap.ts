// @ts-nocheck
/**
 * SuperClaw Tools Bootstrap
 * 
 * Auto-registers all available tools in the global tool registry
 */

import { globalToolRegistry } from './contracts';
import { apiExecuteTool } from './api';
import { dbExecuteTool } from './database/code-agent-db';
// Import other tool instances as they become available
// import { fileOperationTools } from './file-ops';

/**
 * Register all available tools in the global registry
 */
export function bootstrapTools(): void {
  console.log('Bootstrapping SuperClaw tools...');

  // Register API tools
  try {
    globalToolRegistry.register(apiExecuteTool);
    console.log('✓ Registered api_execute tool');
  } catch (error: unknown) {
    console.warn('Failed to register api_execute tool:', error);
  }

  // Register Database tools
  try {
    // @ts-expect-error - Post-Merge Reconciliation
    globalToolRegistry.register(dbExecuteTool);
    console.log('✓ Registered db_execute tool');
  } catch (error: unknown) {
    console.warn('Failed to register db_execute tool:', error);
  }

  // Register other tools here as they become available
  // Example:
  // try {
  //   globalToolRegistry.register(fileOperationTools.readFile);
  //   console.log('✓ Registered file operation tools');
  // } catch (error: unknown) {
  //   console.warn('Failed to register file operation tools:', error);
  // }

  const toolCount = globalToolRegistry.list().length;
  console.log(`✓ Bootstrap complete: ${toolCount} tools registered`);
}

/**
 * Get all registered tool definitions in OpenAI function format
 */
export function getToolDefinitions() {
  return globalToolRegistry.getFunctionDefinitions();
}

/**
 * Auto-bootstrap when module is imported (can be disabled via env var)
 */
if (process.env.SUPERCLAW_AUTO_BOOTSTRAP !== 'false') {
  bootstrapTools();
}