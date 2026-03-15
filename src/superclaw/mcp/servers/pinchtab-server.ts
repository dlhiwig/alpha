/**
 * PinchTab MCP Server for SuperClaw
 * 
 * Exposes PinchTab browser automation as an MCP server.
 * Can be run standalone or integrated into SuperClaw.
 * 
 * Usage:
 *   npx tsx src/mcp/servers/pinchtab-server.ts
 *   
 * Or register with Claude/Codex:
 *   claude mcp add pinchtab --transport http http://127.0.0.1:9868/mcp
 */

import { createServer } from 'http';
import { PinchTabTool, createPinchTabTool } from '../tools/pinchtab';

const PORT = parseInt(process.env.PINCHTAB_MCP_PORT || '9868');
const PINCHTAB_URL = process.env.PINCHTAB_URL || 'http://localhost:9867';

// Initialize PinchTab tool
const pinchtab = createPinchTabTool({ baseUrl: PINCHTAB_URL });

// MCP Server state
let requestId = 0;
const sessions = new Map<string, { created: Date }>();

// MCP Protocol handlers
const handlers: Record<string, (params: any) => Promise<any>> = {
  'initialize': async (params) => ({
    protocolVersion: '2024-11-05',
    capabilities: {
      tools: { listChanged: false },
    },
    serverInfo: {
      name: 'pinchtab',
      version: '1.0.0',
    },
    instructions: `PinchTab Browser Automation - Token-efficient browser control for AI agents.

Actions:
- navigate: Go to a URL
- snapshot: Get DOM snapshot (interactive elements only with interactive=true)
- click: Click element by ref (e.g., "e5")
- fill: Fill input by ref with text
- press: Press key on element
- text: Extract page text (most efficient)
- screenshot: Take screenshot (expensive, ~10K tokens)
- create_instance: Create browser with profile
- list_instances: List active browsers

Tips:
- Use snapshot with interactive=true for forms
- Use text extraction instead of screenshots when possible
- Profiles persist sessions across restarts`,
  }),
  
  'tools/list': async () => ({
    tools: [pinchtab.schema],
  }),
  
  'tools/call': async (params) => {
    const { name, arguments: args } = params;
    
    if (name !== 'pinchtab') {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }
    
    const result = await pinchtab.execute(args);
    
    return {
      content: [{
        type: 'text',
        text: result.success 
          ? JSON.stringify(result.data, null, 2)
          : `Error: ${result.error}`,
      }],
      isError: !result.success,
    };
  },
};

// SSE Response helper
function sseResponse(data: any): string {
  return `event: message\ndata: ${JSON.stringify(data)}\n\n`;
}

// HTTP Server
const server = createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, mcp-session-id');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  if (req.method !== 'POST' || req.url !== '/mcp') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }
  
  // Check Accept header
  const accept = req.headers['accept'] || '';
  if (!accept.includes('text/event-stream')) {
    res.writeHead(406, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      id: 'server-error',
      error: {
        code: -32600,
        message: 'Not Acceptable: Client must accept text/event-stream',
      },
    }));
    return;
  }
  
  // Parse request body
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }
  
  let request: any;
  try {
    request = JSON.parse(body);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      id: 'server-error',
      error: { code: -32700, message: 'Parse error' },
    }));
    return;
  }
  
  // Handle session
  let sessionId = req.headers['mcp-session-id'] as string;
  if (!sessionId && request.method !== 'initialize') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      id: 'server-error',
      error: { code: -32600, message: 'Missing session ID' },
    }));
    return;
  }
  
  if (request.method === 'initialize') {
    sessionId = `session_${++requestId}_${Date.now()}`;
    sessions.set(sessionId, { created: new Date() });
  }
  
  // Process request
  const handler = handlers[request.method];
  if (!handler) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'mcp-session-id': sessionId,
    });
    res.end(sseResponse({
      jsonrpc: '2.0',
      id: request.id,
      error: { code: -32601, message: `Method not found: ${request.method}` },
    }));
    return;
  }
  
  try {
    const result = await handler(request.params || {});
    
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'mcp-session-id': sessionId,
    });
    res.end(sseResponse({
      jsonrpc: '2.0',
      id: request.id,
      result,
    }));
  } catch (error) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'mcp-session-id': sessionId,
    });
    res.end(sseResponse({
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : String(error),
      },
    }));
  }
});

// Start server
server.listen(PORT, '127.0.0.1', () => {
  console.log(`
  PinchTab MCP Server
  -------------------
  MCP Endpoint: http://127.0.0.1:${PORT}/mcp
  PinchTab URL: ${PINCHTAB_URL}
  
  Register with Claude:
    claude mcp add pinchtab --transport http http://127.0.0.1:${PORT}/mcp
  
  Available actions:
    navigate, snapshot, click, fill, press, text, screenshot,
    create_instance, list_instances
  `);
});

export { server };
