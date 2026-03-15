/**
 * SuperClaw Gateway Server
 * HTTP + WebSocket API for swarm orchestration
 */

import Fastify, { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import cors from '@fastify/cors';
import { getSwarmService, SwarmEvent } from '../core/swarm-service';
import { getThresholdEnforcer } from '../skynet/thresholds';
import { registerWebSocketRoutes } from './websocket';

const DEFAULT_PORT = 18800;
const DEFAULT_HOST = '127.0.0.1';

export interface GatewayOptions {
  port?: number;
  host?: string;
  apiKey?: string;
}

export interface GatewayServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  getAddress(): string;
}

export async function createGatewayServer(opts: GatewayOptions = {}): Promise<GatewayServer> {
  const port = opts.port || Number(process.env.SUPERCLAW_PORT) || DEFAULT_PORT;
  const host = opts.host || process.env.SUPERCLAW_HOST || DEFAULT_HOST;
  const apiKey = opts.apiKey || process.env.SUPERCLAW_API_KEY;

  const app: FastifyInstance = Fastify({
    logger: {
      level: 'info',
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    },
  });

  // Register plugins
  await app.register(cors, { origin: true });
  await app.register(websocket);

  // Register WebSocket routes
  await registerWebSocketRoutes(app, apiKey);

  // Initialize swarm service
  const swarmService = getSwarmService();

  // --- Auth Middleware ---
  if (apiKey) {
    app.addHook('preHandler', async (request, reply) => {
      // Skip auth for health endpoint
      if (request.url === '/health') return;
      
      const authHeader = request.headers.authorization;
      const providedKey = authHeader?.startsWith('Bearer ') 
        ? authHeader.slice(7) 
        : request.headers['x-api-key'];
      
      if (providedKey !== apiKey) {
        reply.code(401).send({ error: 'Unauthorized' });
      }
    });
  }

  // --- Health Endpoint ---
  app.get('/health', async () => {
    return { 
      status: 'ok', 
      service: 'superclaw',
      timestamp: new Date().toISOString(),
    };
  });

  // --- Status Endpoint ---
  app.get('/v1/status', async () => {
    const status = swarmService.getStatus();
    return {
      ...status,
      version: '0.1.0',
      uptime: process.uptime(),
    };
  });

  // --- List Runs ---
  app.get('/v1/swarm', async (request) => {
    const query = request.query as { limit?: string };
    const limit = query.limit ? parseInt(query.limit, 10) : 10;
    const runs = swarmService.listRuns(limit);
    return { runs };
  });

  // --- Get Run ---
  app.get('/v1/swarm/:runId', async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const run = swarmService.getRun(runId);
    
    if (!run) {
      reply.code(404).send({ error: 'Run not found' });
      return;
    }
    
    return run;
  });

  // --- Start Swarm ---
  app.post('/v1/swarm', async (request, reply) => {
    const body = request.body as { 
      objective: string;
      maxAgents?: number;
      timeout?: number;
      model?: string;
    };

    if (!body.objective) {
      reply.code(400).send({ error: 'objective is required' });
      return;
    }

    const { runId, run } = await swarmService.runSwarm({
      objective: body.objective,
      maxAgents: body.maxAgents,
      timeout: body.timeout,
      model: body.model,
    });

    return {
      runId,
      status: 'accepted',
      wsUrl: `ws://${host}:${port}/v1/swarm/${runId}/stream`,
    };
  });

  // --- WebSocket Stream ---
  app.get('/v1/swarm/:runId/stream', { websocket: true }, (socket, request) => {
    const { runId } = request.params as { runId: string };
    const run = swarmService.getRun(runId);

    if (!run) {
      socket.send(JSON.stringify({ error: 'Run not found' }));
      socket.close();
      return;
    }

    // Send current state
    socket.send(JSON.stringify({ 
      event: 'connected', 
      runId,
      currentStatus: run.status,
    }));

    // Subscribe to events
    const handler = (event: SwarmEvent) => {
      if ('runId' in event && event.runId === runId) {
        socket.send(JSON.stringify(event));
        
        // Close on completion or failure
        if (event.event === 'run.completed' || event.event === 'run.failed') {
          setTimeout(() => socket.close(), 100);
        }
      }
    };

    swarmService.on('swarm-event', handler);

    socket.on('close', () => {
      swarmService.off('swarm-event', handler);
    });
  });

  // --- Convenience: Run and Wait ---
  app.post('/v1/swarm/sync', async (request, reply) => {
    const body = request.body as { 
      objective: string;
      maxAgents?: number;
      timeout?: number;
    };

    if (!body.objective) {
      reply.code(400).send({ error: 'objective is required' });
      return;
    }

    const { runId } = await swarmService.runSwarm({
      objective: body.objective,
      maxAgents: body.maxAgents,
      timeout: body.timeout,
    });

    // Wait for completion
    const timeout = body.timeout || 300000; // 5 minutes default
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        const run = swarmService.getRun(runId);
        
        if (!run) {
          clearInterval(checkInterval);
          reject(new Error('Run disappeared'));
          return;
        }

        if (run.status === 'completed') {
          clearInterval(checkInterval);
          resolve(run);
          return;
        }

        if (run.status === 'failed') {
          clearInterval(checkInterval);
          reply.code(500).send({ error: run.error, runId });
          return;
        }

        if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval);
          reply.code(408).send({ error: 'Timeout', runId });
          return;
        }
      }, 500);
    });
  });

  // --- Skynet Thresholds Endpoint ---
  app.get('/skynet/thresholds', async () => {
    const enforcer = getThresholdEnforcer();
    const limits = enforcer.getLimits();
    const usage = enforcer.getUsageStats();
    const auditLog = await enforcer.getAuditLog(50);
    
    return {
      limits,
      usage,
      auditLog: auditLog.slice(0, 20), // Return last 20 entries
      status: 'active',
      version: '1.0.0'
    };
  });

  app.post('/skynet/thresholds/limits', async (request, reply) => {
    const body = request.body as {
      resource?: Partial<any>;
      financial?: Partial<any>;
    };

    const enforcer = getThresholdEnforcer();
    
    if (body.resource) {
      enforcer.updateResourceLimits(body.resource);
    }
    
    if (body.financial) {
      enforcer.updateFinancialGates(body.financial);
    }

    const updated = enforcer.getLimits();
    return {
      success: true,
      limits: updated,
      message: 'Limits updated successfully'
    };
  });

  app.post('/skynet/thresholds/reset', async () => {
    const enforcer = getThresholdEnforcer();
    enforcer.resetDailyCounters();
    
    return {
      success: true,
      usage: enforcer.getUsageStats(),
      message: 'Daily counters reset'
    };
  });

  app.get('/skynet/thresholds/audit', async (request) => {
    const query = request.query as { limit?: string };
    const limit = query.limit ? parseInt(query.limit, 10) : 100;
    
    const enforcer = getThresholdEnforcer();
    const auditLog = await enforcer.getAuditLog(limit);
    
    return {
      auditLog,
      totalEntries: auditLog.length,
      limit
    };
  });

  // --- Server Methods ---
  
  async function start(): Promise<void> {
    await swarmService.start();
    await app.listen({ port, host });
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                  🚀 SuperClaw Gateway                        ║
╠══════════════════════════════════════════════════════════════╣
║  HTTP API:  http://${host}:${port}                           
║  WS API:    ws://${host}:${port}/v1/swarm/:runId/stream      
║  Health:    http://${host}:${port}/health                    
╠══════════════════════════════════════════════════════════════╣
║  Swarm Endpoints:                                            ║
║    POST /v1/swarm         - Start a swarm                    ║
║    POST /v1/swarm/sync    - Start and wait for result        ║
║    GET  /v1/swarm         - List runs                        ║
║    GET  /v1/swarm/:runId  - Get run details                  ║
║    WS   /v1/swarm/:runId/stream - Real-time events           ║
║                                                              ║
║  Skynet Thresholds:                                          ║
║    GET  /skynet/thresholds       - View limits & usage       ║
║    POST /skynet/thresholds/limits - Update limits            ║
║    POST /skynet/thresholds/reset  - Reset daily counters     ║
║    GET  /skynet/thresholds/audit  - View audit log           ║
╚══════════════════════════════════════════════════════════════╝
    `);
  }

  async function stop(): Promise<void> {
    swarmService.stop();
    await app.close();
  }

  function getAddress(): string {
    return `http://${host}:${port}`;
  }

  return { start, stop, getAddress };
}

// --- CLI Entry Point ---
if (import.meta.url === `file://${process.argv[1]}`) {
  createGatewayServer().then(server => {
    server.start().catch(console.error);
    
    process.on('SIGINT', async () => {
      console.log('\nShutting down...');
      await server.stop();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      await server.stop();
      process.exit(0);
    });
  });
}
