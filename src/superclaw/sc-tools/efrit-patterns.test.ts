// @ts-nocheck
/**
 * Tests for EFRIT Tool Execution Patterns
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { rmSync, existsSync } from 'fs';
import { ToolRegistry } from './registry';
import { 
  EfritExecutionEngine,
  EfritSessionState,
  EfritToolCategory,
  createEfritEngine
} from './efrit-patterns';

describe('EFRIT Tool Execution Patterns', () => {
  let registry: ToolRegistry;
  let engine: EfritExecutionEngine;
  let testDataDir: string;

  beforeEach(() => {
    registry = new ToolRegistry();
    testDataDir = join(tmpdir(), `efrit-test-${Date.now()}`);
    engine = createEfritEngine(registry, testDataDir);
  });

  afterEach(() => {
    if (existsSync(testDataDir)) {
      rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  describe('Session Management', () => {
    it('should create a new EFRIT session', async () => {
      const command = 'Create a function to reverse a string';
      const sessionId = await engine.createSession(command);

      expect(sessionId).toMatch(/^efrit_\d+_[a-z0-9]+$/);
      
      const status = engine.getSessionStatus(sessionId);
      expect(status).toBeDefined();
      expect(status!.status).toBe('active');
      expect(status!.toolsExecuted).toBe(0);
      expect(status!.checkpoints).toBe(0);
    });

    it('should persist session state', async () => {
      const command = 'Test command for persistence';
      const sessionId = await engine.createSession(command, {
        workingDirectory: '/test/dir',
        safetyLevel: 'paranoid'
      });

      const status = engine.getSessionStatus(sessionId);
      expect(status).toBeDefined();
      expect(status!.id).toBe(sessionId);
    });

    it('should track multiple sessions', async () => {
      const session1 = await engine.createSession('Command 1');
      const session2 = await engine.createSession('Command 2');

      expect(session1).not.toBe(session2);
      
      const status1 = engine.getSessionStatus(session1);
      const status2 = engine.getSessionStatus(session2);
      
      expect(status1?.id).toBe(session1);
      expect(status2?.id).toBe(session2);
    });
  });

  describe('Natural Language Processing', () => {
    it('should execute natural language commands', async () => {
      const sessionId = await engine.createSession('Initial setup');
      
      const result = await engine.executeNaturalLanguage(
        sessionId,
        'List all JavaScript files in the current directory'
      );

      expect(result.success).toBe(true);
      expect(result.sessionId).toBe(sessionId);
      expect(result.message).toContain('EFRIT execution framework ready');
      expect(result.nextActions).toHaveLength(1);
      expect(result.checkpointCreated).toBeDefined();
    });

    it('should handle user guidance injection', async () => {
      const sessionId = await engine.createSession('Initial setup');
      
      const result = await engine.executeNaturalLanguage(
        sessionId,
        'Refactor the authentication module',
        'Focus only on the login function'
      );

      expect(result.success).toBe(true);
      const status = engine.getSessionStatus(sessionId);
      expect(status?.id).toBe(sessionId);
    });

    it('should map natural language to tool suggestions', async () => {
      const context = {
        userId: 'test',
        sessionId: 'test',
        timestamp: new Date(),
        source: 'test',
        workingDirectory: '/test',
        projectRoot: '/test',
        safetyLevel: 'safe' as const,
        maxToolCalls: 10,
        circuitBreakerTrips: 0,
        userGuidance: []
      };

      const mappings = await engine.mapNaturalLanguageToTools(
        'create a new file called test.js',  // lowercase to match the includes() check
        context
      );

      expect(mappings.length).toBeGreaterThan(0);
      const createFileMapping = mappings.find(m => m.tool === 'create_file');
      expect(createFileMapping).toBeDefined();
      expect(createFileMapping!.confidence).toBeGreaterThan(0.8);
      expect(createFileMapping!.reasoning).toContain('creating a file');
    });

    it('should map git commands correctly', async () => {
      const context = {
        userId: 'test',
        sessionId: 'test', 
        timestamp: new Date(),
        source: 'test',
        workingDirectory: '/test',
        projectRoot: '/test/repo',
        safetyLevel: 'safe' as const,
        maxToolCalls: 10,
        circuitBreakerTrips: 0,
        userGuidance: []
      };

      const mappings = await engine.mapNaturalLanguageToTools(
        'Show me the git status',
        context
      );

      expect(mappings).toHaveLength(1);
      expect(mappings[0].tool).toBe('vcs_status');
      expect(mappings[0].confidence).toBeGreaterThan(0.9);
      expect(mappings[0].parameters.repository).toBe('/test/repo');
    });
  });

  describe('Checkpoint System', () => {
    it('should create checkpoints for long operations', async () => {
      const sessionId = await engine.createSession('Test checkpointing');
      const session = (engine as any).sessions.get(sessionId) as EfritSessionState;
      
      const checkpoint = await engine.createCheckpoint(
        session,
        'Before major refactoring'
      );

      expect(checkpoint.id).toMatch(/^checkpoint_\d+$/);
      expect(checkpoint.description).toBe('Before major refactoring');
      expect(checkpoint.canRestore).toBe(true);
      expect(checkpoint.state).toBeDefined();
    });

    it('should restore from checkpoints', async () => {
      const sessionId = await engine.createSession('Test restoration');
      const session = (engine as any).sessions.get(sessionId) as EfritSessionState;
      
      // Create some state
      session.todoList.push({
        id: 'todo1',
        description: 'Test todo',
        status: 'pending',
        priority: 'medium',
        dependencies: [],
        estimatedSteps: 1,
        actualSteps: 0,
        createdBy: 'claude'
      });

      const checkpoint = await engine.createCheckpoint(session, 'Test checkpoint');
      
      // Modify state after checkpoint
      session.todoList[0].status = 'completed';
      
      // Restore from checkpoint
      await engine.restoreCheckpoint(sessionId, checkpoint.id);
      
      // Verify restoration
      const restoredSession = (engine as any).sessions.get(sessionId) as EfritSessionState;
      expect(restoredSession.todoList[0].status).toBe('pending');
      expect(restoredSession.status).toBe('active');
    });
  });

  describe('Todo Management', () => {
    it('should create and update todos', async () => {
      const sessionId = await engine.createSession('Test todos');
      
      const todos = [
        {
          description: 'Parse input parameters',
          priority: 'high' as const,
          estimatedSteps: 3
        },
        {
          description: 'Validate data structure',
          priority: 'medium' as const,
          estimatedSteps: 2,
          dependencies: ['todo1']
        }
      ];

      await engine.updateTodoList(sessionId, todos);
      
      const status = engine.getSessionStatus(sessionId);
      expect(status?.todos.total).toBe(2);
      expect(status?.todos.pending).toBe(2);
      expect(status?.todos.completed).toBe(0);
    });

    it('should update existing todos', async () => {
      const sessionId = await engine.createSession('Test todo updates');
      
      // Create initial todo
      await engine.updateTodoList(sessionId, [{
        description: 'Initial task',
        status: 'pending' as const
      }]);

      // Get the created todo ID
      const session = (engine as any).sessions.get(sessionId) as EfritSessionState;
      const todoId = session.todoList[0].id;

      // Update the todo
      await engine.updateTodoList(sessionId, [{
        id: todoId,
        status: 'completed' as const,
        actualSteps: 5
      }]);

      const status = engine.getSessionStatus(sessionId);
      expect(status?.todos.completed).toBe(1);
      expect(status?.todos.pending).toBe(0);
    });
  });

  describe('Safety Controls', () => {
    it('should handle circuit breaker activation', async () => {
      const sessionId = await engine.createSession('Test circuit breaker', {
        maxToolCalls: 5
      });

      // Simulate multiple failures
      const session = (engine as any).sessions.get(sessionId) as EfritSessionState;
      session.context.circuitBreakerTrips = 10; // Exceed threshold

      const result = await engine.executeNaturalLanguage(
        sessionId,
        'This should fail due to circuit breaker'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Circuit breaker activated');
    });

    it('should track execution steps for safety', async () => {
      const sessionId = await engine.createSession('Test execution tracking');

      // Execute a command to generate steps
      await engine.executeNaturalLanguage(sessionId, 'Test command');

      const session = (engine as any).sessions.get(sessionId) as EfritSessionState;
      expect(session.executionTrace.length).toBeGreaterThan(0);
      
      const lastStep = session.executionTrace[session.executionTrace.length - 1];
      expect(lastStep.timestamp).toBeDefined();
      expect(lastStep.type).toBeDefined();
    });
  });

  describe('Tool Integration', () => {
    it('should integrate with SuperClaw tool registry', () => {
      // Verify that EFRIT tools are registered
      const tools = registry.list();
      const efritTools = tools.filter(tool => 
        tool.name.includes('eval_sexp') || 
        tool.name.includes('shell_exec') ||
        tool.name.includes('edit_file')
      );

      expect(efritTools.length).toBeGreaterThan(0);
    });

    it('should categorize tools correctly', () => {
      const tools = registry.list();
      const codeExecTools = tools.filter(tool => 
        tool.metadata?.category === EfritToolCategory.CODE_EXEC
      );
      const fileEditTools = tools.filter(tool => 
        tool.metadata?.category === EfritToolCategory.FILE_EDIT
      );

      expect(codeExecTools.length).toBeGreaterThan(0);
      expect(fileEditTools.length).toBeGreaterThan(0);
    });
  });

  describe('Event System', () => {
    it('should emit session creation events', async () => {
      return new Promise<void>((resolve) => {
        engine.on('session:created', (event) => {
          expect(event.sessionId).toBeDefined();
          expect(event.command).toBe('Test event emission');
          resolve();
        });

        engine.createSession('Test event emission');
      });
    });

    it('should emit execution events', async () => {
      return new Promise<void>((resolve) => {
        let eventsReceived = 0;
        const expectedEvents = 2; // started + completed

        const checkCompletion = () => {
          eventsReceived++;
          if (eventsReceived === expectedEvents) {
            resolve();
          }
        };

        engine.on('execution:started', (event) => {
          expect(event.sessionId).toBeDefined();
          expect(event.command).toBe('Test execution events');
          checkCompletion();
        });

        engine.on('execution:completed', (event) => {
          expect(event.sessionId).toBeDefined();
          expect(event.result).toBeDefined();
          checkCompletion();
        });

        engine.createSession('Test setup').then(sessionId => {
          engine.executeNaturalLanguage(sessionId, 'Test execution events');
        });
      });
    });

    it('should emit checkpoint events', async () => {
      return new Promise<void>((resolve) => {
        engine.on('checkpoint:created', (event) => {
          expect(event.sessionId).toBeDefined();
          expect(event.checkpoint).toBeDefined();
          expect(event.checkpoint.description).toBe('Test checkpoint event');
          resolve();
        });

        engine.createSession('Test checkpoint events').then(sessionId => {
          const session = (engine as any).sessions.get(sessionId) as EfritSessionState;
          engine.createCheckpoint(session, 'Test checkpoint event');
        });
      });
    });
  });
});

describe('EFRIT Integration with SuperClaw', () => {
  it('should create EFRIT engine with factory function', () => {
    const registry = new ToolRegistry();
    const engine = createEfritEngine(registry);

    expect(engine).toBeInstanceOf(EfritExecutionEngine);
  });

  it('should work with existing SuperClaw tools', async () => {
    const registry = new ToolRegistry();
    const engine = createEfritEngine(registry);

    // Verify integration with existing SuperClaw tools
    const tools = registry.list();
    const shellTools = tools.filter(tool => tool.name.includes('shell'));
    
    expect(shellTools.length).toBeGreaterThan(0);
  });
});