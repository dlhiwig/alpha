// @ts-nocheck
/**
 * 🦊 SKYNET AUDIT TRAIL — Test Suite
 * 
 * Comprehensive tests for the audit trail system including:
 * - Core functionality
 * - Data sanitization
 * - Query operations
 * - Export functionality
 * - Integration hooks
 * - Performance tests
 */

import fs from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';
import { AuditTrail, AuditAction, AuditFilters } from '../audit';
import { 
  ToolExecutionInterceptor, 
  AgentSpawnInterceptor,
  CostEventInterceptor,
  logToolCall,
  logAgentSpawn,
  logCostEvent 
} from '../audit-integrations';

describe('SKYNET Audit Trail System', () => {
  let testDbPath: string;
  let testJsonPath: string;
  let auditTrail: AuditTrail;

  beforeEach(async () => {
    // Stop any existing singleton to avoid conflicts
    try {
      const { stopAuditTrail } = await import('../audit');
      stopAuditTrail();
    } catch {}

    // Create temporary files for testing
    const tempDir = await fs.mkdtemp(path.join(tmpdir(), 'audit-test-'));
    testDbPath = path.join(tempDir, 'test-audit.db');
    testJsonPath = path.join(tempDir, 'test-audit.jsonl');

    auditTrail = new AuditTrail({
      enabled: true,
      dbPath: testDbPath,
      jsonBackupPath: testJsonPath,
      batchWriteSize: 1, // Immediate writes for testing
      sanitizeSensitiveData: true
    });

    // Set this instance as the singleton for convenience methods
    const { setAuditTrailInstance } = await import('../audit');
    setAuditTrailInstance(auditTrail);

    // Wait for initialization
    await new Promise(resolve => {
      auditTrail.once('initialized', resolve);
      // Timeout after 1 second if not initialized
      setTimeout(resolve, 1000);
    });
  });

  afterEach(async () => {
    await auditTrail.close();

    // Clear the singleton
    const { setAuditTrailInstance } = await import('../audit');
    setAuditTrailInstance(null);
    
    // Clean up test files
    try {
      await fs.unlink(testDbPath);
      await fs.unlink(testJsonPath);
    } catch (error: unknown) {
      // Files might not exist, that's okay
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // CORE FUNCTIONALITY TESTS
  // ═══════════════════════════════════════════════════════════════

  describe('Core Audit Trail Functionality', () => {
    test('should log tool call successfully', () => {
      const action: AuditAction = {
        sessionId: 'test-session-1',
        agentId: 'test-agent-1',
        action: 'tool_call',
        tool: 'web_search',
        params: { query: 'test query', limit: 10 },
        result: 'success',
        durationMs: 1500,
        tokenUsage: { input: 100, output: 200 },
        costUsd: 0.05
      };

      expect(() => {
        auditTrail.log(action);
      }).not.toThrow();
    });

    test('should log agent spawn successfully', () => {
      const action: AuditAction = {
        sessionId: 'test-session-1',
        agentId: 'test-agent-2',
        action: 'agent_spawn',
        result: 'success',
        durationMs: 3000,
        metadata: { parentAgent: 'main', config: { model: 'claude-3-sonnet' } }
      };

      auditTrail.log(action);

      const logs = auditTrail.query({ sessionId: 'test-session-1' });
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe('agent_spawn');
      expect(logs[0].agentId).toBe('test-agent-2');
      expect(logs[0].result).toBe('success');
    });

    test('should log cost event successfully', () => {
      const action: AuditAction = {
        sessionId: 'test-session-1',
        agentId: 'test-agent-1',
        action: 'cost_event',
        result: 'success',
        durationMs: 0,
        tokenUsage: { input: 1000, output: 500 },
        costUsd: 0.15,
        metadata: { provider: 'anthropic', model: 'claude-3-sonnet' }
      };

      auditTrail.log(action);

      const logs = auditTrail.query({ action: 'cost_event' });
      expect(logs).toHaveLength(1);
      expect(logs[0].costUsd).toBe(0.15);
      expect(logs[0].tokenUsage).toEqual({ input: 1000, output: 500 });
    });

    test('should log error events with stack traces', () => {
      const action: AuditAction = {
        sessionId: 'test-session-1',
        agentId: 'test-agent-1',
        action: 'tool_call',
        tool: 'file_read',
        params: { path: '/nonexistent/file.txt' },
        result: 'failure',
        durationMs: 100,
        errorMessage: 'File not found',
        stackTrace: 'Error: File not found\n    at readFile (/path/to/file.js:10:15)',
        severity: 'medium'
      };

      auditTrail.log(action);

      const logs = auditTrail.query({ result: 'failure' });
      expect(logs).toHaveLength(1);
      expect(logs[0].errorMessage).toBe('File not found');
      expect(logs[0].stackTrace).toContain('Error: File not found');
      expect(logs[0].severity).toBe('medium');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // DATA SANITIZATION TESTS
  // ═══════════════════════════════════════════════════════════════

  describe('Data Sanitization', () => {
    test('should sanitize API keys', () => {
      const action: AuditAction = {
        sessionId: 'test-session-1',
        agentId: 'test-agent-1',
        action: 'tool_call',
        tool: 'api_call',
        params: {
          url: 'https://api.example.com',
          headers: {
            'Authorization': 'Bearer sk-1234567890abcdef1234567890abcdef',
            'X-API-Key': 'ghp_1234567890abcdef1234567890abcdef123456'
          },
          apiKey: 'sk-ant-api03-abcdef1234567890',
          password: 'secretpassword123'
        },
        result: 'success',
        durationMs: 500
      };

      auditTrail.log(action);

      const logs = auditTrail.query({ tool: 'api_call' });
      expect(logs).toHaveLength(1);
      
      const params = logs[0].params;
      expect(params.headers.Authorization).toBe('[REDACTED]');
      expect(params.headers['X-API-Key']).toBe('[REDACTED]');
      expect(params.apiKey).toBe('[REDACTED]');
      expect(params.password).toBe('[REDACTED]');
      expect(params.url).toBe('https://api.example.com'); // URL should not be sanitized
    });

    test('should sanitize sensitive patterns in strings', () => {
      const action: AuditAction = {
        sessionId: 'test-session-1',
        agentId: 'test-agent-1',
        action: 'tool_call',
        tool: 'text_process',
        params: {
          text: 'Please use API key sk-1234567890abcdef and token ghp_abcdef123456 for authentication',
          config: 'export OPENAI_API_KEY=sk-proj-abcdef1234567890'
        },
        result: 'success',
        durationMs: 200
      };

      auditTrail.log(action);

      const logs = auditTrail.query({ tool: 'text_process' });
      const params = logs[0].params;
      
      expect(params.text).toContain('[REDACTED]');
      expect(params.text).not.toContain('sk-1234567890abcdef');
      expect(params.text).not.toContain('ghp_abcdef123456');
      
      expect(params.config).toContain('[REDACTED]');
      expect(params.config).not.toContain('sk-proj-abcdef1234567890');
    });

    test('should handle nested object sanitization', () => {
      const action: AuditAction = {
        sessionId: 'test-session-1',
        agentId: 'test-agent-1',
        action: 'tool_call',
        tool: 'complex_call',
        params: {
          level1: {
            level2: {
              api_key: 'secret123',
              level3: {
                password: 'nested_secret',
                publicData: 'this is fine'
              }
            },
            token: 'jwt_token_here'
          }
        },
        result: 'success',
        durationMs: 300
      };

      auditTrail.log(action);

      const logs = auditTrail.query({ tool: 'complex_call' });
      const params = logs[0].params;
      
      expect(params.level1.level2.api_key).toBe('[REDACTED]');
      expect(params.level1.level2.level3.password).toBe('[REDACTED]');
      expect(params.level1.level2.level3.publicData).toBe('this is fine');
      expect(params.level1.token).toBe('[REDACTED]');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // QUERY FUNCTIONALITY TESTS
  // ═══════════════════════════════════════════════════════════════

  describe('Query Functionality', () => {
    beforeEach(() => {
      // Add test data
      const testActions = [
        {
          sessionId: 'session-1',
          agentId: 'agent-1',
          action: 'tool_call' as const,
          tool: 'web_search',
          result: 'success' as const,
          durationMs: 1000,
          costUsd: 0.01
        },
        {
          sessionId: 'session-1',
          agentId: 'agent-1',
          action: 'tool_call' as const,
          tool: 'file_read',
          result: 'failure' as const,
          durationMs: 500,
          errorMessage: 'Permission denied'
        },
        {
          sessionId: 'session-2',
          agentId: 'agent-2',
          action: 'agent_spawn' as const,
          result: 'success' as const,
          durationMs: 2000
        },
        {
          sessionId: 'session-1',
          agentId: 'agent-1',
          action: 'cost_event' as const,
          result: 'success' as const,
          durationMs: 0,
          costUsd: 0.05,
          tokenUsage: { input: 200, output: 100 }
        }
      ];

      testActions.forEach(action => auditTrail.log(action));
    });

    test('should query by session ID', () => {
      const logs = auditTrail.query({ sessionId: 'session-1' });
      expect(logs).toHaveLength(3);
      expect(logs.every(log => log.sessionId === 'session-1')).toBe(true);
    });

    test('should query by agent ID', () => {
      const logs = auditTrail.query({ agentId: 'agent-2' });
      expect(logs).toHaveLength(1);
      expect(logs[0].agentId).toBe('agent-2');
      expect(logs[0].action).toBe('agent_spawn');
    });

    test('should query by action type', () => {
      const logs = auditTrail.query({ action: 'tool_call' });
      expect(logs).toHaveLength(2);
      expect(logs.every(log => log.action === 'tool_call')).toBe(true);
    });

    test('should query by multiple action types', () => {
      const logs = auditTrail.query({ action: ['tool_call', 'cost_event'] });
      expect(logs).toHaveLength(3);
      expect(logs.every(log => ['tool_call', 'cost_event'].includes(log.action))).toBe(true);
    });

    test('should query by result status', () => {
      const failureLogs = auditTrail.query({ result: 'failure' });
      expect(failureLogs).toHaveLength(1);
      expect(failureLogs[0].result).toBe('failure');
      expect(failureLogs[0].errorMessage).toBe('Permission denied');
    });

    test('should query by tool name', () => {
      const logs = auditTrail.query({ tool: 'web_search' });
      expect(logs).toHaveLength(1);
      expect(logs[0].tool).toBe('web_search');
      expect(logs[0].result).toBe('success');
    });

    test('should query by cost threshold', () => {
      const logs = auditTrail.query({ costThreshold: 0.02 });
      expect(logs).toHaveLength(1);
      expect(logs[0].costUsd).toBe(0.05);
      expect(logs[0].action).toBe('cost_event');
    });

    test('should query by duration threshold', () => {
      const logs = auditTrail.query({ durationThreshold: 1500 });
      expect(logs).toHaveLength(1);
      expect(logs[0].durationMs).toBe(2000);
      expect(logs[0].action).toBe('agent_spawn');
    });

    test('should support pagination', () => {
      const page1 = auditTrail.query({ limit: 2, offset: 0 });
      const page2 = auditTrail.query({ limit: 2, offset: 2 });
      
      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      expect(page1[0].id).not.toBe(page2[0].id);
    });

    test('should support ordering', () => {
      const ascLogs = auditTrail.query({ orderBy: 'duration', orderDir: 'asc' });
      const descLogs = auditTrail.query({ orderBy: 'duration', orderDir: 'desc' });
      
      expect(ascLogs[0].durationMs).toBeLessThanOrEqual(ascLogs[1].durationMs);
      expect(descLogs[0].durationMs).toBeGreaterThanOrEqual(descLogs[1].durationMs);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // EXPORT FUNCTIONALITY TESTS
  // ═══════════════════════════════════════════════════════════════

  describe('Export Functionality', () => {
    beforeEach(() => {
      auditTrail.log({
        sessionId: 'export-test',
        agentId: 'test-agent',
        action: 'tool_call',
        tool: 'test_tool',
        result: 'success',
        durationMs: 1000,
        costUsd: 0.01,
        tokenUsage: { input: 100, output: 50 }
      });
    });

    test('should export to JSON format', () => {
      const jsonExport = auditTrail.export('json', { sessionId: 'export-test' });
      const parsed = JSON.parse(jsonExport);
      
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].sessionId).toBe('export-test');
      expect(parsed[0].action).toBe('tool_call');
    });

    test('should export to CSV format', () => {
      const csvExport = auditTrail.export('csv', { sessionId: 'export-test' });
      const lines = csvExport.split('\n');
      
      expect(lines[0]).toContain('id,timestamp,sessionId'); // Header
      expect(lines[1]).toContain('export-test'); // Data
      expect(lines[1]).toContain('tool_call');
    });

    test('should export to parquet format (JSON schema)', () => {
      const parquetExport = auditTrail.export('parquet', { sessionId: 'export-test' });
      const parsed = JSON.parse(parquetExport);
      
      expect(parsed).toHaveProperty('schema');
      expect(parsed).toHaveProperty('data');
      expect(parsed.schema.id.type).toBe('string');
      expect(parsed.schema.timestamp.type).toBe('timestamp');
      expect(parsed.data).toHaveLength(1);
    });

    test('should handle empty export gracefully', () => {
      const csvExport = auditTrail.export('csv', { sessionId: 'nonexistent' });
      expect(csvExport).toBe('');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // STATISTICS TESTS
  // ═══════════════════════════════════════════════════════════════

  describe('Statistics Functionality', () => {
    beforeEach(() => {
      const testData = [
        { action: 'tool_call', tool: 'web_search', result: 'success', cost: 0.01, duration: 1000 },
        { action: 'tool_call', tool: 'web_search', result: 'failure', cost: 0, duration: 500 },
        { action: 'tool_call', tool: 'file_read', result: 'success', cost: 0.002, duration: 200 },
        { action: 'agent_spawn', result: 'success', cost: 0, duration: 3000 },
        { action: 'cost_event', result: 'success', cost: 0.05, duration: 0 }
      ];

      testData.forEach((data, index) => {
        auditTrail.log({
          sessionId: 'stats-test',
          agentId: `agent-${index % 2}`,
          action: data.action as any,
          tool: data.tool,
          result: data.result as any,
          durationMs: data.duration,
          costUsd: data.cost || undefined
        });
      });
    });

    test('should calculate basic statistics', () => {
      const stats = auditTrail.getStats();
      
      expect(stats.totalLogs).toBe(5);
      expect(stats.totalCost).toBeCloseTo(0.062, 3); // 0.01 + 0.002 + 0.05
      expect(stats.errorRate).toBeCloseTo(0.2, 1); // 1 failure out of 5 logs
    });

    test('should break down logs by action', () => {
      const stats = auditTrail.getStats();
      
      expect(stats.logsByAction.tool_call).toBe(3);
      expect(stats.logsByAction.agent_spawn).toBe(1);
      expect(stats.logsByAction.cost_event).toBe(1);
    });

    test('should break down logs by result', () => {
      const stats = auditTrail.getStats();
      
      expect(stats.logsByResult.success).toBe(4);
      expect(stats.logsByResult.failure).toBe(1);
    });

    test('should identify top agents', () => {
      const stats = auditTrail.getStats();
      
      expect(stats.topAgents).toHaveLength(2);
      expect(stats.topAgents[0].count).toBeGreaterThanOrEqual(2);
    });

    test('should identify top tools', () => {
      const stats = auditTrail.getStats();
      
      const webSearchTool = stats.topTools.find(t => t.tool === 'web_search');
      expect(webSearchTool).toBeDefined();
      expect(webSearchTool!.count).toBe(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // INTEGRATION TESTS
  // ═══════════════════════════════════════════════════════════════

  describe('Integration Functionality', () => {
    test('should provide convenience method for tool calls', () => {
      expect(() => {
        logToolCall({
          sessionId: 'integration-test',
          agentId: 'test-agent',
          tool: 'test_tool',
          params: { test: 'data' },
          result: 'success',
          durationMs: 500,
          costUsd: 0.01
        });
      }).not.toThrow();

      const logs = auditTrail.query({ sessionId: 'integration-test' });
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe('tool_call');
    });

    test('should provide convenience method for agent spawns', () => {
      logAgentSpawn({
        sessionId: 'integration-test',
        agentId: 'child-agent',
        parentAgentId: 'parent-agent',
        result: 'success',
        durationMs: 2000
      });

      const logs = auditTrail.query({ sessionId: 'integration-test' });
      expect(logs.some(log => log.action === 'agent_spawn')).toBe(true);
    });

    test('should provide convenience method for cost events', () => {
      logCostEvent({
        sessionId: 'integration-test',
        agentId: 'test-agent',
        costUsd: 0.25,
        tokenUsage: { input: 500, output: 300 }
      });

      const logs = auditTrail.query({ action: 'cost_event' });
      expect(logs.some(log => log.costUsd === 0.25)).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // PERFORMANCE TESTS
  // ═══════════════════════════════════════════════════════════════

  describe('Performance Tests', () => {
    test('should handle bulk logging efficiently', () => {
      const startTime = Date.now();
      
      // Log 1000 entries
      for (let i = 0; i < 1000; i++) {
        auditTrail.log({
          sessionId: `bulk-test-${i % 10}`,
          agentId: `agent-${i % 5}`,
          action: 'tool_call',
          tool: `tool-${i % 3}`,
          result: i % 10 === 0 ? 'failure' : 'success',
          durationMs: Math.random() * 1000,
          costUsd: Math.random() * 0.1
        });
      }
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Should complete within reasonable time (adjust based on your requirements)
      expect(duration).toBeLessThan(5000); // 5 seconds for 1000 logs
      
      const logs = auditTrail.query({ limit: 1100 });
      expect(logs.length).toBeGreaterThanOrEqual(1000);
    });

    test('should query large datasets efficiently', () => {
      // Add test data first
      for (let i = 0; i < 500; i++) {
        auditTrail.log({
          sessionId: `perf-test-${i % 10}`,
          agentId: `agent-${i % 5}`,
          action: 'tool_call',
          tool: `tool-${i % 3}`,
          result: 'success',
          durationMs: i * 10,
          costUsd: i * 0.001
        });
      }

      const startTime = Date.now();
      
      // Complex query
      const logs = auditTrail.query({
        action: 'tool_call',
        result: 'success',
        durationThreshold: 1000,
        orderBy: 'cost',
        orderDir: 'desc',
        limit: 50
      });
      
      const endTime = Date.now();
      const queryTime = endTime - startTime;
      
      expect(queryTime).toBeLessThan(1000); // Should complete within 1 second
      expect(logs.length).toBeLessThanOrEqual(50);
      expect(logs.every(log => log.durationMs >= 1000)).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // ERROR HANDLING TESTS
  // ═══════════════════════════════════════════════════════════════

  describe('Error Handling', () => {
    test('should handle invalid export format gracefully', () => {
      expect(() => {
        auditTrail.export('invalid' as any);
      }).toThrow('Unsupported export format');
    });

    test('should handle database errors gracefully', async () => {
      // Close the database to simulate an error
      await auditTrail.close();
      
      // Should not throw when logging to a closed database
      expect(() => {
        auditTrail.log({
          sessionId: 'error-test',
          agentId: 'test-agent',
          action: 'tool_call',
          result: 'success',
          durationMs: 100
        });
      }).not.toThrow();
    });

    test('should handle malformed log data gracefully', () => {
      expect(() => {
        auditTrail.log({
          sessionId: '', // Empty session ID
          agentId: null as any, // Invalid agent ID
          action: 'tool_call',
          result: 'success',
          durationMs: -100 // Negative duration
        });
      }).not.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // INTERCEPTOR TESTS
  // ═══════════════════════════════════════════════════════════════

  describe('Interceptor Functionality', () => {
    test('should track tool execution context', () => {
      const contextId = ToolExecutionInterceptor.beforeToolExecution({
        sessionId: 'interceptor-test',
        agentId: 'test-agent',
        tool: 'test_tool',
        params: { test: 'data' }
      });

      expect(contextId).toBeTruthy();
      expect(typeof contextId).toBe('string');

      // Complete the execution
      ToolExecutionInterceptor.afterToolExecution(contextId, {
        success: true,
        output: 'test result',
        tokenUsage: { input: 50, output: 25 },
        costUsd: 0.005
      });

      const logs = auditTrail.query({ sessionId: 'interceptor-test' });
      expect(logs).toHaveLength(1);
      expect(logs[0].tool).toBe('test_tool');
      expect(logs[0].result).toBe('success');
    });

    test('should track agent spawn context', () => {
      const spawnId = AgentSpawnInterceptor.beforeAgentSpawn({
        sessionId: 'spawn-test',
        parentAgentId: 'parent-agent',
        agentConfig: { model: 'claude-3-sonnet' }
      });

      AgentSpawnInterceptor.afterAgentSpawn(spawnId, {
        success: true,
        agentId: 'child-agent-123',
        metadata: { startTime: Date.now() }
      });

      const logs = auditTrail.query({ sessionId: 'spawn-test' });
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe('agent_spawn');
      expect(logs[0].agentId).toBe('child-agent-123');
    });

    test('should log cost events directly', () => {
      CostEventInterceptor.logCostEvent({
        sessionId: 'cost-test',
        agentId: 'test-agent',
        provider: 'anthropic',
        model: 'claude-3-sonnet',
        tokenUsage: { input: 1000, output: 500 },
        costUsd: 0.12,
        requestType: 'chat_completion'
      });

      const logs = auditTrail.query({ action: 'cost_event' });
      expect(logs.some(log => 
        log.costUsd === 0.12 && 
        log.metadata?.provider === 'anthropic'
      )).toBe(true);
    });
  });
});