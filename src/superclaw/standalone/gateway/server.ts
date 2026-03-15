// @ts-nocheck
/**
 * SuperClaw Standalone Gateway Server
 * Fastify-based replacement for OpenClaw Express gateway
 */

import Fastify, { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import cors from '@fastify/cors';

export interface GatewayOptions {
  port?: number;
  host?: string;
  logLevel?: string;
}

export class SuperClawGateway {
  private app: FastifyInstance;
  
  constructor(private options: GatewayOptions = {}) {
    this.app = Fastify({
      logger: {
        level: options.logLevel || 'info'
      }
    });
  }
  
  async initialize(): Promise<void> {
    // Register plugins
    await this.app.register(cors, { origin: true });
    await this.app.register(websocket);
    
    // Setup routes
    await this.setupRoutes();
  }
  
  private async setupRoutes(): Promise<void> {
    // Health check
    this.app.get('/health', async () => {
      return { 
        status: 'ok', 
        service: 'superclaw-standalone',
        timestamp: new Date().toISOString()
      };
    });
    
    // Status endpoint
    this.app.get('/v1/status', async () => {
      return {
        version: '1.0.0',
        mode: 'standalone',
        uptime: process.uptime(),
        providers: ['claude', 'gemini', 'openai', 'ollama']
      };
    });
    
    // Chat endpoint (compatibility with OpenClaw)
    this.app.post('/v1/chat', async (request, reply) => {
      // TODO: Implement agent execution
      reply.code(501).send({ error: 'Not implemented yet' });
    });
    
    // WebSocket endpoint
    this.app.get('/v1/stream', { websocket: true }, (socket) => {
      socket.on('message', (message) => {
        // TODO: Handle WebSocket messages
        socket.send(JSON.stringify({ error: 'Not implemented yet' }));
      });
    });
  }
  
  async start(): Promise<void> {
    const port = this.options.port || 18800;
    const host = this.options.host || '127.0.0.1';
    
    await this.initialize();
    await this.app.listen({ port, host });
    
    console.log(`🚀 SuperClaw Standalone Gateway started on http://${host}:${port}`);
  }
  
  async stop(): Promise<void> {
    await this.app.close();
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const gateway = new SuperClawGateway();
  
  gateway.start().catch(console.error);
  
  process.on('SIGINT', async () => {
    console.log('\n👋 Shutting down...');
    await gateway.stop();
    process.exit(0);
  });
}