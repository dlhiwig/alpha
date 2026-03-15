/**
 * SuperClaw MCP Tools Registry
 * 
 * Central registry for all MCP-compatible tools available to SuperClaw agents.
 */

export { PinchTabTool, createPinchTabTool } from './pinchtab.js';

// Tool registry for dynamic loading
export const toolRegistry = {
  pinchtab: () => import('./pinchtab.js').then(m => m.createPinchTabTool()),
};

export type ToolName = keyof typeof toolRegistry;
