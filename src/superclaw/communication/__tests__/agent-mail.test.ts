/**
 * 🦊 SuperClaw Agent Mail Tests
 * 
 * Test suite for Agent Mail integration functionality.
 * Tests core communication features, file reservations, and MOLTBOOK integration.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// Mock dependencies
vi.mock('axios');
vi.mock('../skynet/moltbook.js');
vi.mock('../skynet/audit.js');

import { AgentMailbox, createAgentMailbox, DEFAULT_AGENT_MAIL_CONFIG } from '../agent-mail';
import { 
  AgentMailIntegration, 
  createAgentMailIntegration,
  DEFAULT_INTEGRATION_CONFIG
} from '../integration';
import type { 
  AgentMailConfig, 
  IntegrationConfig,
  AgentIdentity,
  AgentMailMessage 
} from '../types';
import {
  AgentNotFoundError,
  ReservationConflictError
} from '../types';
import {
  generateMemorableAgentName,
  validateAgentName,
  formatMessage,
  checkReservationConflicts,
  createStandardTemplate
} from '../index';

describe('Agent Mail Utilities', () => {
  it('should generate memorable agent names', () => {
    const name = generateMemorableAgentName();
    expect(validateAgentName(name)).toBe(true);
    expect(name).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+$/);
  });

  it('should validate agent name format', () => {
    expect(validateAgentName('GreenCastle')).toBe(true);
    expect(validateAgentName('RedPond')).toBe(true);
    expect(validateAgentName('invalid')).toBe(false);
    expect(validateAgentName('123Invalid')).toBe(false);
    expect(validateAgentName('')).toBe(false);
  });

  it('should format messages correctly', () => {
    const message: AgentMailMessage = {
      id: 'test-id',
      type: 'direct',
      senderId: 'sender',
      senderName: 'GreenCastle',
      recipientIds: ['recipient'],
      recipientNames: ['BlueMountain'],
      subject: 'Test Message',
      body: 'Hello **world**!',
      priority: 'normal',
      ackRequired: false,
      attachments: [],
      timestamp: new Date('2024-01-01T12:00:00Z'),
      metadata: {}
    };

    const formatted = formatMessage(message);
    expect(formatted).toContain('Message from GreenCastle');
    expect(formatted).toContain('Test Message');
    expect(formatted).toContain('Hello **world**!');
  });

  it('should check reservation conflicts correctly', () => {
    const reservation1 = {
      id: 'res1',
      agentId: 'agent1',
      agentName: 'GreenCastle',
      pathPattern: 'src/**/*.ts',
      mode: 'exclusive' as const,
      reason: 'Testing',
      expiresAt: new Date(Date.now() + 60000),
      createdAt: new Date(),
      metadata: {}
    };

    const reservation2 = {
      id: 'res2',
      agentId: 'agent2',
      agentName: 'BlueMountain',
      pathPattern: 'src/test.ts',
      mode: 'shared' as const,
      reason: 'Testing',
      expiresAt: new Date(Date.now() + 60000),
      createdAt: new Date(),
      metadata: {}
    };

    const conflicts = checkReservationConflicts([reservation2], [reservation1]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toEqual(reservation1);
  });

  it('should create standard message templates', () => {
    const template = createStandardTemplate('COORDINATION_REQUEST', {
      task: 'Update API',
      priority: 'high',
      duration: '2 hours',
      description: 'Update the REST API endpoints',
      files: 'src/api/**/*.ts',
      sender: 'GreenCastle'
    });

    expect(template.subject).toContain('Update API');
    expect(template.body).toContain('high');
    expect(template.body).toContain('2 hours');
    expect(template.body).toContain('GreenCastle');
  });
});

describe('AgentMailbox', () => {
  let mockAxios: any;
  let mailbox: AgentMailbox;
  let config: AgentMailConfig;

  beforeEach(() => {
    mockAxios = {
      post: vi.fn().mockResolvedValue({ data: { success: true } }),
      create: vi.fn().mockReturnThis()
    };

    config = {
      mcpServerUrl: 'http://localhost:8765',
      bearerToken: 'test-token',
      projectPath: '/test/project',
      agentIdentity: {
        name: 'TestAgent',
        program: 'SuperClaw',
        model: 'Claude'
      },
      enableMoltbookSync: false,
      enableAuditTrail: false,
      enableFileGuards: false,
      reservationTimeout: 24,
      messageRetention: 30
    };

    mailbox = createAgentMailbox(config);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should create mailbox instance', () => {
    expect(mailbox).toBeInstanceOf(AgentMailbox);
    expect(mailbox.isAgentRegistered()).toBe(false);
  });

  it('should register agent', async () => {
    mockAxios.post.mockResolvedValueOnce({
      data: { success: true, agent_id: 'test-id' }
    });

    // Mock the HTTP client
    (mailbox as any).httpClient = mockAxios;

    const identity = await mailbox.registerAgent({
      name: 'GreenCastle',
      taskDescription: 'Test task'
    });

    expect(identity.name).toBe('GreenCastle');
    expect(identity.taskDescription).toBe('Test task');
    expect(mailbox.isAgentRegistered()).toBe(true);
    expect(mockAxios.post).toHaveBeenCalledWith('/tools/register_agent', expect.objectContaining({
      name: 'GreenCastle'
    }));
  });

  it('should send messages', async () => {
    mockAxios.post.mockResolvedValueOnce({
      data: { success: true, message_id: 'msg-123' }
    });

    // Mock registered state
    (mailbox as any).isRegistered = true;
    (mailbox as any).identity = { name: 'TestAgent' };
    (mailbox as any).httpClient = mockAxios;

    const message = await mailbox.sendMessage(
      ['RecipientAgent'],
      'Test Subject',
      'Test message body',
      { priority: 'high', ackRequired: true }
    );

    expect(message.subject).toBe('Test Subject');
    expect(message.priority).toBe('high');
    expect(message.ackRequired).toBe(true);
    expect(mockAxios.post).toHaveBeenCalledWith('/tools/send_message', expect.objectContaining({
      subject: 'Test Subject',
      body_md: 'Test message body'
    }));
  });

  it('should reserve files', async () => {
    mockAxios.post.mockResolvedValueOnce({
      data: { success: true, reservation_id: 'res-123' }
    });

    // Mock registered state
    (mailbox as any).isRegistered = true;
    (mailbox as any).identity = { name: 'TestAgent' };
    (mailbox as any).httpClient = mockAxios;

    const reservations = await mailbox.reserveFiles(
      ['src/**/*.ts', 'package.json'],
      { mode: 'exclusive', reason: 'Testing', expiresIn: 2 }
    );

    expect(reservations).toHaveLength(2);
    expect(reservations[0].pathPattern).toBe('src/**/*.ts');
    expect(reservations[0].mode).toBe('exclusive');
    expect(reservations[1].pathPattern).toBe('package.json');
  });

  it('should discover agents', async () => {
    mockAxios.post.mockResolvedValueOnce({
      data: {
        agents: [
          {
            name: 'GreenCastle',
            program: 'Claude Code',
            model: 'Opus 4.1',
            task_description: 'Backend work',
            project_path: '/test/project',
            inception_ts: new Date().toISOString(),
            last_active_ts: new Date().toISOString(),
            attachments_policy: 'auto',
            contact_policy: 'auto',
            is_active: true,
            file_reservations: [],
            recent_activity: []
          }
        ]
      }
    });

    // Mock registered state
    (mailbox as any).isRegistered = true;
    (mailbox as any).identity = { name: 'TestAgent' };
    (mailbox as any).httpClient = mockAxios;

    const agents = await mailbox.discoverAgents();

    expect(agents).toHaveLength(1);
    expect(agents[0].identity.name).toBe('GreenCastle');
    expect(agents[0].isActive).toBe(true);
  });

  it('should handle registration failure', async () => {
    mockAxios.post.mockRejectedValueOnce(new Error('Network error'));
    (mailbox as any).httpClient = mockAxios;

    await expect(mailbox.registerAgent()).rejects.toThrow('Failed to register agent');
  });
});

describe('AgentMailIntegration', () => {
  let integration: AgentMailIntegration;
  let config: IntegrationConfig;

  beforeEach(() => {
    config = {
      mcpServerUrl: 'http://localhost:8765',
      bearerToken: 'test-token',
      projectPath: '/test/project',
      enableMoltbookBridge: false,
      enableAuditIntegration: true,
      enableGitIntegration: false,
      enableCrossProjectCoordination: false,
      syncInterval: 1000,
      messageBufferSize: 100,
      reservationCheckInterval: 5000
    };

    integration = createAgentMailIntegration(config);
  });

  afterEach(async () => {
    try {
      if ((integration as any).isInitialized) {
        await integration.shutdown();
      }
    } catch (error: unknown) {
      // Ignore shutdown errors in tests
    }
    vi.clearAllMocks();
  });

  it('should create integration instance', () => {
    expect(integration).toBeInstanceOf(AgentMailIntegration);
    expect(integration.getCommunicationState().health).toBe('healthy');
  });

  it('should generate status report', () => {
    const report = integration.generateStatusReport();
    expect(report).toContain('SuperClaw Agent Mail Status Report');
    expect(report).toContain('Health: healthy');
    expect(report).toContain('Active Agents: 0');
  });

  it('should handle initialization failure gracefully', async () => {
    // Mock mailbox creation to fail
    const failingConfig = { ...config, bearerToken: '' };
    const failingIntegration = createAgentMailIntegration(failingConfig);

    await expect(failingIntegration.initialize()).rejects.toThrow();
    expect(failingIntegration.getCommunicationState().health).toBe('unhealthy');
  });

  it('should track communication state', () => {
    const initialState = integration.getCommunicationState();
    expect(initialState.activeAgents).toBe(0);
    expect(initialState.totalMessages).toBe(0);
    expect(initialState.activeReservations).toBe(0);
    expect(initialState.health).toBe('healthy');
  });
});

describe('Error Handling', () => {
  it('should throw AgentNotFoundError for invalid agent', () => {
    const error = new AgentNotFoundError('invalid-agent');
    
    expect((error as Error).message).toContain('invalid-agent');
    expect((error as any).code).toBe('AGENT_NOT_FOUND');
    expect(error.recoverable).toBe(false);
  });

  it('should throw ReservationConflictError for file conflicts', () => {
    const mockReservations = [{ id: 'res1', pathPattern: 'test.ts' }];
    const error = new ReservationConflictError('Conflict detected', mockReservations, 'queue');
    
    expect((error as Error).message).toContain('Conflict detected');
    expect((error as any).code).toBe('RESERVATION_CONFLICT');
    expect(error.conflictingReservations).toEqual(mockReservations);
    expect(error.suggestedResolution).toBe('queue');
  });
});