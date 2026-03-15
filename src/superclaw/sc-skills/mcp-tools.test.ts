// @ts-nocheck
/**
 * MCP Tools Skill Tests
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { getMCPToolsSkill, MCPToolsSkill } from './mcp-tools';

describe('MCP Tools Skill', () => {
  let mcp: MCPToolsSkill;

  beforeAll(() => {
    mcp = getMCPToolsSkill();
  });

  test('getMCPToolsSkill returns skill instance', () => {
    expect(mcp).toBeDefined();
    expect(mcp.listServers).toBeDefined();
    expect(mcp.listTools).toBeDefined();
    expect(mcp.call).toBeDefined();
  });

  test('listServers returns array', async () => {
    const servers = await mcp.listServers();
    expect(Array.isArray(servers)).toBe(true);
    // May be empty if no MCP servers configured
  });

  test('listTools returns array for known server', async () => {
    const servers = await mcp.listServers();
    if (servers.length > 0) {
      const tools = await mcp.listTools(servers[0].name);
      expect(Array.isArray(tools)).toBe(true);
    }
  });

  test('getAllTools returns combined tool list', async () => {
    const allTools = await mcp.getAllTools();
    expect(Array.isArray(allTools)).toBe(true);
  }, 30000); // 30s timeout - MCP calls can be slow

  test('generateToolPrompt returns string', async () => {
    const prompt = await mcp.generateToolPrompt();
    expect(typeof prompt).toBe('string');
  }, 30000); // 30s timeout

  // Skip filesystem tests if not available
  test.skipIf(!process.env.MCP_FILESYSTEM)('filesystem.read_text_file works', async () => {
    const result = await mcp.call({
      selector: 'filesystem.read_text_file',
      args: { path: '/home/toba/.openclaw/workspace/IDENTITY.md', head: 5 },
    });
    expect(result).toBeDefined();
    expect(result.success).toBeDefined();
  });

  test.skipIf(!process.env.MCP_FILESYSTEM)('readFile convenience method works', async () => {
    const content = await mcp.readFile('/home/toba/.openclaw/workspace/SOUL.md', { head: 3 });
    expect(typeof content).toBe('string');
  });

  // Network test - may timeout in CI
  test.skipIf(process.env.CI)('fetch.fetch works', async () => {
    const result = await mcp.call({
      selector: 'fetch.fetch',
      args: { url: 'https://httpbin.org/get' },
      timeout: 10000,
    });
    expect(result).toBeDefined();
  });
});
