import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import cors from '@fastify/cors';
import { SessionManager } from './session-manager';
import { llmClient } from './llm';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { 
  getHealth as getSkynetHealth, 
  getSentinelState,
  getActiveAlerts,
  recordProviderRequest,
  // Wave 3: ORACLE
  getOracleStats,
  getSuggestions,
  getRecommendation,
  recordInteraction,
  // Wave 4: NEXUS
  getNexusStats,
  listSkills,
  listCapabilities,
  findSkills,
  // Wave 5: CORTEX
  getCortexStats,
  recall,
  memorize,
  buildContext,
  getRecentMemories,
  // Phase 4: SELF-EVOLVE
  proposeEvolution,
  executePlan,
  getPendingPlans,
  getEvolutionHistory,
  getSelfEvolveStats,
} from '../skynet/index';

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

// Initialize cloud providers (lazy - only if keys exist)
const anthropic = process.env.ANTHROPIC_API_KEY 
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const gemini = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

interface ChatRequest {
  message: string;
  sessionId?: string;
}

interface ChatResponse {
  response: string;
  sessionId: string;
}

export class SuperClawGateway {
  private app: FastifyInstance;
  private sessionManager: SessionManager;
  private isRunning = false;

  constructor() {
    this.app = Fastify({ 
      logger: true,
      disableRequestLogging: false
    });
    this.sessionManager = new SessionManager();
  }

  async initialize(): Promise<void> {
    try {
      // Register plugins
      await this.app.register(cors, {
        origin: true,
        credentials: true
      });
      
      await this.app.register(websocket);
      
      // Setup routes
      await this.setupRoutes();
      
      // Initialize session manager
      await this.sessionManager.initialize();
      
    } catch (error: unknown) {
      this.app.log.error({ err: error }, 'Failed to initialize gateway');
      throw error;
    }
  }

  private async setupRoutes(): Promise<void> {
    // Health endpoint
    this.app.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: '2.1.1'
      };
    });

    // 🦊 Simple ping endpoint (what the fox tried to add)
    this.app.get('/ping', async (request: FastifyRequest, reply: FastifyReply) => {
      return {
        pong: true,
        timestamp: Date.now(),
        skynetVersion: '2.2.0',
        wave: 'AGENTBUS'
      };
    });

    // 🦊 SKYNET Protocol health endpoint
    this.app.get('/skynet/health', async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const health = getSkynetHealth();
        const guardianActive = process.env.SKYNET_GUARDIAN === 'true';
        const restartCount = parseInt(process.env.SKYNET_RESTART_COUNT || '0');
        
        return {
          protocol: 'SKYNET',
          version: '2.0.0',
          wave: 5,
          codename: 'PERSIST',
          guardian: {
            active: guardianActive,
            restartCount: restartCount,
            immortal: guardianActive,
          },
          ...health
        };
      } catch (error: unknown) {
        return {
          protocol: 'SKYNET',
          status: 'initializing',
          message: 'PULSE not yet started'
        };
      }
    });

    // 🦊 SENTINEL status endpoint
    this.app.get('/skynet/sentinel', async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const state = getSentinelState();
        const alerts = getActiveAlerts();
        
        return {
          protocol: 'SENTINEL',
          status: 'active',
          checkCount: state.checkCount,
          lastCheck: new Date(state.lastCheck).toISOString(),
          providers: state.providers,
          channels: state.channels,
          github: state.github,
          dailyCost: state.dailyCost,
          dailyRequests: state.dailyRequests,
          activeAlerts: alerts.length,
          alerts: alerts.slice(0, 10), // Last 10 active alerts
        };
      } catch (error: unknown) {
        return {
          protocol: 'SENTINEL',
          status: 'initializing',
          message: 'SENTINEL not yet started'
        };
      }
    });

    // 🦊 ORACLE status endpoint (Wave 3)
    this.app.get('/skynet/oracle', async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const stats = getOracleStats();
        // @ts-expect-error - Post-Merge Reconciliation
        const suggestions = getSuggestions();
        
        return {
          protocol: 'ORACLE',
          status: 'active',
          wave: 3,
          ...stats,
          suggestions: suggestions.slice(0, 5),
        };
      } catch (error: unknown) {
        return {
          protocol: 'ORACLE',
          status: 'initializing',
          message: 'ORACLE not yet started'
        };
      }
    });

    // 🦊 ORACLE recommendation endpoint
    this.app.post('/skynet/oracle/recommend', async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { prompt } = request.body as { prompt: string };
        // @ts-expect-error - Post-Merge Reconciliation
        const recommendation = getRecommendation(prompt);
        
        return {
          prompt: prompt.slice(0, 100),
          recommendation,
        };
      } catch (error: unknown) {
        return { recommendation: null };
      }
    });

    // 🦊 NEXUS status endpoint (Wave 4)
    this.app.get('/skynet/nexus', async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const stats = getNexusStats();
        const skills = listSkills();
        const capabilities = listCapabilities();
        
        return {
          protocol: 'NEXUS',
          status: 'active',
          wave: 4,
          ...stats,
          skills: skills.map(s => ({
            id: s.id,
            name: s.metadata.name,
            description: s.metadata.description,
            tags: s.metadata.tags,
            usageCount: s.usageCount,
            enabled: s.enabled,
          })),
          capabilities,
        };
      } catch (error: unknown) {
        return {
          protocol: 'NEXUS',
          status: 'initializing',
          message: 'NEXUS not yet started'
        };
      }
    });

    // 🦊 NEXUS skill search
    this.app.get('/skynet/nexus/search', async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { q } = request.query as { q: string };
        const skills = findSkills(q || '');
        
        return {
          query: q,
          results: skills.map(s => ({
            id: s.id,
            name: s.metadata.name,
            description: s.metadata.description,
          })),
        };
      } catch (error: unknown) {
        return { query: '', results: [] };
      }
    });

    // 🦊 CORTEX status endpoint (Wave 5)
    this.app.get('/skynet/cortex', async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const stats = getCortexStats();
        const recent = getRecentMemories(5);
        
        return {
          protocol: 'CORTEX',
          status: 'active',
          wave: 5,
          ...stats,
          // @ts-expect-error - Post-Merge Reconciliation
          recentMemories: recent.map(m => ({
            id: m.id,
            type: m.type,
            summary: m.summary,
            timestamp: new Date(m.timestamp).toISOString(),
            importance: m.importance,
          })),
        };
      } catch (error: unknown) {
        return {
          protocol: 'CORTEX',
          status: 'initializing',
          message: 'CORTEX not yet started'
        };
      }
    });

    // 🦊 CORTEX recall (semantic search)
    this.app.get('/skynet/cortex/recall', async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { q, limit } = request.query as { q: string; limit?: string };
        const memories = recall(q || '', parseInt(limit || '5'));
        
        return {
          query: q,
          // @ts-expect-error - Post-Merge Reconciliation
          results: memories.map(m => ({
            id: m.id,
            type: m.type,
            content: m.content.slice(0, 500),
            summary: m.summary,
            timestamp: new Date(m.timestamp).toISOString(),
            importance: m.importance,
            tags: m.tags,
          })),
        };
      } catch (error: unknown) {
        return { query: '', results: [] };
      }
    });

    // 🦊 CORTEX memorize (store new memory)
    this.app.post('/skynet/cortex/memorize', async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { content, type, source } = request.body as { 
          content: string; 
          type?: string; 
          source?: string;
        };
        
        const id = memorize(content, (type || 'conversation') as any, source || 'api');
        
        return { success: true, id };
      } catch (error: unknown) {
        return { success: false, error: 'Failed to memorize' };
      }
    });

    // 🦊 CORTEX context (build context for query)
    this.app.get('/skynet/cortex/context', async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { q } = request.query as { q: string };
        const context = buildContext(q || '');
        
        return { query: q, context };
      } catch (error: unknown) {
        return { query: '', context: '' };
      }
    });

    // 🦊 Full SKYNET status (all waves)
    this.app.get('/skynet/status', async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const health = getSkynetHealth();
        const guardianActive = process.env.SKYNET_GUARDIAN === 'true';
        const oracleStats = getOracleStats();
        const nexusStats = getNexusStats();
        const cortexStats = getCortexStats();
        
        return {
          protocol: 'SKYNET',
          version: '2.0.0',
          status: 'operational',
          waves: {
            1: { name: 'SURVIVE', status: 'active', components: ['PULSE', 'GUARDIAN'] },
            2: { name: 'WATCH', status: 'active', components: ['SENTINEL'] },
            3: { name: 'ADAPT', status: 'active', components: ['ORACLE'] },
            4: { name: 'EXPAND', status: 'active', components: ['NEXUS'] },
            5: { name: 'PERSIST', status: 'active', components: ['CORTEX'] },
          },
          guardian: {
            active: guardianActive,
            restartCount: parseInt(process.env.SKYNET_RESTART_COUNT || '0'),
          },
          stats: {
            pulse: health,
            oracle: oracleStats,
            nexus: nexusStats,
            cortex: cortexStats,
          },
        };
      } catch (error: unknown) {
        return {
          protocol: 'SKYNET',
          status: 'initializing',
        };
      }
    });

    // 🦊 SELF-EVOLVE: Propose evolution
    this.app.post('/skynet/evolve', async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { prompt, type, priority, autoCreatePR } = request.body as {
          prompt: string;
          type?: string;
          priority?: string;
          autoCreatePR?: boolean;
        };
        
        if (!prompt) {
          return reply.code(400).send({ error: 'prompt is required' });
        }
        
        const result = await proposeEvolution({
          prompt,
          type: (type || 'improvement') as any,
          priority: (priority || 'medium') as any,
        }, autoCreatePR || false);
        
        return {
          success: true,
          plan: {
            id: result.plan.id,
            title: result.plan.title,
            description: result.plan.description,
            changes: result.plan.changes.length,
            impact: result.plan.estimatedImpact,
            status: result.plan.status,
          },
          prUrl: result.prUrl,
        };
      } catch (error: any) {
        this.app.log.error({ err: error }, 'Self-evolve error');
        return reply.code(500).send({ error: (error as Error).message });
      }
    });

    // 🦊 SELF-EVOLVE: Execute pending plan (create PR)
    this.app.post('/skynet/evolve/:planId/execute', async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { planId } = request.params as { planId: string };
        const result = await executePlan(planId);
        
        return {
          success: true,
          prUrl: result.prUrl,
          prNumber: result.prNumber,
        };
      } catch (error: any) {
        this.app.log.error({ err: error }, 'Execute plan error');
        return reply.code(500).send({ error: (error as Error).message });
      }
    });

    // 🦊 SELF-EVOLVE: Get pending plans
    this.app.get('/skynet/evolve/pending', async (request: FastifyRequest, reply: FastifyReply) => {
      const plans = getPendingPlans();
      return {
        count: plans.length,
        plans: plans.map(p => ({
          id: p.id,
          title: p.title,
          type: p.request.type,
          changes: p.changes.length,
          impact: p.estimatedImpact,
          timestamp: new Date(p.timestamp).toISOString(),
        })),
      };
    });

    // 🦊 SELF-EVOLVE: Get history
    this.app.get('/skynet/evolve/history', async (request: FastifyRequest, reply: FastifyReply) => {
      const history = getEvolutionHistory();
      return {
        count: history.length,
        history: history.slice(-20).map(p => ({
          id: p.id,
          title: p.title,
          status: p.status,
          prUrl: p.prUrl,
          timestamp: new Date(p.timestamp).toISOString(),
        })),
      };
    });

    // 🦊 SELF-EVOLVE: Stats
    this.app.get('/skynet/evolve/stats', async (request: FastifyRequest, reply: FastifyReply) => {
      return getSelfEvolveStats();
    });

    // Tools endpoint - list available tools
    this.app.get('/v1/tools', async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const tools = llmClient.getAvailableTools();
        const toolSummary = llmClient.getToolSummary();
        
        return {
          tools,
          summary: toolSummary,
          count: tools.length
        };
      } catch (error: unknown) {
        this.app.log.error({ err: error }, 'Tools endpoint error');
        return reply.code(500).send({ error: 'Failed to get tools' });
      }
    });

    // OpenAI-compatible chat completions endpoint
    // This allows ANY OpenAI-compatible tool to use SuperClaw as a backend
    // Supports: Claude (Anthropic), Gemini (Google), Ollama (local), and more
    this.app.post('/v1/chat/completions', async (request: FastifyRequest, reply: FastifyReply) => {
      const requestStart = Date.now();
      let currentProvider: 'claude' | 'gemini' | 'ollama' | 'openai' = 'ollama';
      
      try {
        const body = request.body as any;
        const messages = body.messages || [];
        const model = body.model || 'dolphin-llama3:8b';
        const stream = body.stream || false;
        const maxTokens = body.max_tokens || 4096;
        
        const completionId = `chatcmpl-${Date.now()}`;
        const created = Math.floor(Date.now() / 1000);

        // ========== CLAUDE (Anthropic) ==========
        if (model.includes('claude')) {
          currentProvider = 'claude';
          if (!anthropic) {
            return reply.code(400).send({ error: { message: 'ANTHROPIC_API_KEY not configured' } });
          }
          
          this.app.log.info(`🧠 Routing to Claude: ${model}`);
          
          // Extract system message if present
          const systemMsg = messages.find((m: any) => m.role === 'system');
          const nonSystemMessages = messages.filter((m: any) => m.role !== 'system');
          
          try {
            const response = await anthropic.messages.create({
              model: model, // e.g., 'claude-3-5-sonnet-20241022'
              max_tokens: maxTokens,
              system: systemMsg?.content || undefined,
              messages: nonSystemMessages.map((m: any) => ({
                role: m.role as 'user' | 'assistant',
                content: m.content
              }))
            });
            
            const responseText = response.content[0].type === 'text' 
              ? response.content[0].text 
              : '';
            
            // Record metrics for SENTINEL + ORACLE
            const latency = Date.now() - requestStart;
            const cost = ((response.usage?.input_tokens || 0) * 0.003 + (response.usage?.output_tokens || 0) * 0.015) / 1000;
            recordProviderRequest('claude', latency, true, cost);
            
            // ORACLE learns from this interaction
            const lastUserMsg = messages.filter((m: any) => m.role === 'user').pop();
            if (lastUserMsg) {
              recordInteraction('claude', model, lastUserMsg.content, responseText.length, latency, cost, true);
            }
            
            return {
              id: completionId,
              object: 'chat.completion',
              created,
              model,
              choices: [{
                index: 0,
                message: { role: 'assistant', content: responseText },
                finish_reason: response.stop_reason || 'stop'
              }],
              usage: {
                prompt_tokens: response.usage?.input_tokens || 0,
                completion_tokens: response.usage?.output_tokens || 0,
                total_tokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0)
              }
            };
          } catch (error: any) {
            this.app.log.error({ err: error }, 'Claude error');
            const latency = Date.now() - requestStart;
            const isRateLimited = error.status === 429;
            recordProviderRequest('claude', latency, false, 0, isRateLimited);
            return reply.code(500).send({ error: { message: `Claude error: ${(error as Error).message}` } });
          }
        }

        // ========== GEMINI (Google) ==========
        if (model.includes('gemini')) {
          currentProvider = 'gemini';
          if (!gemini) {
            return reply.code(400).send({ error: { message: 'GEMINI_API_KEY not configured' } });
          }
          
          this.app.log.info(`🧠 Routing to Gemini: ${model}`);
          
          try {
            // Use native Gemini SDK
            const geminiModel = gemini.getGenerativeModel({ model: model });
            
            // Convert OpenAI messages to Gemini format
            const history = messages.slice(0, -1).map((m: any) => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: m.content }]
            }));
            
            const lastMessage = messages[messages.length - 1];
            const chat = geminiModel.startChat({ history });
            const result = await chat.sendMessage(lastMessage.content);
            const responseText = result.response.text();
            
            // Record metrics for SENTINEL + ORACLE
            const latency = Date.now() - requestStart;
            const promptTokens = messages.reduce((acc: number, m: any) => acc + (m.content?.length || 0), 0);
            const cost = (promptTokens * 0.00025 + responseText.length * 0.0005) / 1000; // Gemini pricing
            recordProviderRequest('gemini', latency, true, cost);
            
            // ORACLE learns from this interaction
            const lastUserMsg = messages.filter((m: any) => m.role === 'user').pop();
            if (lastUserMsg) {
              recordInteraction('gemini', model, lastUserMsg.content, responseText.length, latency, cost, true);
            }
            
            return {
              id: completionId,
              object: 'chat.completion',
              created,
              model,
              choices: [{
                index: 0,
                message: { role: 'assistant', content: responseText },
                finish_reason: 'stop'
              }],
              usage: {
                prompt_tokens: promptTokens,
                completion_tokens: responseText.length,
                total_tokens: promptTokens + responseText.length
              }
            };
          } catch (error: any) {
            this.app.log.error({ err: error }, 'Gemini error');
            const latency = Date.now() - requestStart;
            const isRateLimited = (error as Error).message?.includes('429') || (error as Error).message?.includes('quota');
            recordProviderRequest('gemini', latency, false, 0, isRateLimited);
            return reply.code(500).send({ error: { message: `Gemini error: ${(error as Error).message}` } });
          }
        }

        // ========== LOCAL (Ollama) - Default ==========
        this.app.log.info(`🧠 Routing to Ollama: ${model}`);
        
        // Extract the last user message
        const lastUserMessage = messages.filter((m: any) => m.role === 'user').pop();
        if (!lastUserMessage) {
          return reply.code(400).send({ error: { message: 'No user message found' } });
        }

        // Convert messages to our format for context
        const sessionHistory = messages.slice(0, -1).map((m: any) => ({
          role: m.role,
          content: m.content,
          timestamp: new Date().toISOString()
        }));

        // Generate response via Ollama
        let responseText: string;
        const ollamaStart = Date.now();
        try {
          const llmResponse = await llmClient.generate({
            message: lastUserMessage.content,
            sessionHistory
          });
          responseText = llmResponse.response;
          
          // Record metrics for SENTINEL + ORACLE (Ollama is free)
          const latency = Date.now() - ollamaStart;
          recordProviderRequest('ollama', latency, true, 0);
          
          // ORACLE learns from this interaction
          recordInteraction('ollama', model, lastUserMessage.content, responseText.length, latency, 0, true);
        } catch (error: any) {
          this.app.log.error({ err: error }, 'Ollama error');
          const latency = Date.now() - ollamaStart;
          recordProviderRequest('ollama', latency, false, 0);
          return reply.code(500).send({ error: { message: (error as Error).message } });
        }

        if (stream) {
          // SSE streaming response
          reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          });

          // Send the content in one chunk (can be improved later for true streaming)
          const chunk = {
            id: completionId,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [{
              index: 0,
              delta: { content: responseText },
              finish_reason: null
            }]
          };
          reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);

          // Send finish
          const finishChunk = {
            id: completionId,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [{
              index: 0,
              delta: {},
              finish_reason: 'stop'
            }]
          };
          reply.raw.write(`data: ${JSON.stringify(finishChunk)}\n\n`);
          reply.raw.write('data: [DONE]\n\n');
          reply.raw.end();
          return;
        }

        // Non-streaming response
        return {
          id: completionId,
          object: 'chat.completion',
          created,
          model,
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: responseText
            },
            finish_reason: 'stop'
          }],
          usage: {
            prompt_tokens: messages.reduce((acc: number, m: any) => acc + (m.content?.length || 0), 0),
            completion_tokens: responseText.length,
            total_tokens: messages.reduce((acc: number, m: any) => acc + (m.content?.length || 0), 0) + responseText.length
          }
        };

      } catch (error: any) {
        this.app.log.error({ err: error }, 'Chat completions error');
        return reply.code(500).send({ error: { message: 'Internal server error' } });
      }
    });

    // Models endpoint (for OpenAI compatibility)
    // Shows available models based on configured API keys
    this.app.get('/v1/models', async (request: FastifyRequest, reply: FastifyReply) => {
      const models: any[] = [
        // Local models (always available if Ollama running)
        { id: 'dolphin-llama3:8b', object: 'model', owned_by: 'ollama', created: 1700000000 },
        { id: 'llama3.2', object: 'model', owned_by: 'ollama', created: 1700000000 },
        { id: 'qwen3-coder', object: 'model', owned_by: 'ollama', created: 1700000000 },
      ];
      
      // Add Claude models if API key configured
      if (anthropic) {
        models.push(
          { id: 'claude-sonnet-4-20250514', object: 'model', owned_by: 'anthropic', created: 1700000000 },
          { id: 'claude-opus-4-20250514', object: 'model', owned_by: 'anthropic', created: 1700000000 },
          { id: 'claude-3-5-sonnet-latest', object: 'model', owned_by: 'anthropic', created: 1700000000 },
          { id: 'claude-3-haiku-20240307', object: 'model', owned_by: 'anthropic', created: 1700000000 }
        );
      }
      
      // Add Gemini models if API key configured  
      if (gemini) {
        models.push(
          { id: 'gemini-2.5-flash', object: 'model', owned_by: 'google', created: 1700000000 },
          { id: 'gemini-2.5-pro', object: 'model', owned_by: 'google', created: 1700000000 },
          { id: 'gemini-2.0-flash-001', object: 'model', owned_by: 'google', created: 1700000000 }
        );
      }
      
      return { object: 'list', data: models };
    });

    // Chat endpoint (SuperClaw native format)
    this.app.post<{ Body: ChatRequest }>('/v1/chat', async (request, reply) => {
      try {
        const { message, sessionId } = request.body;
        
        if (!message) {
          return reply.code(400).send({ error: 'Message is required' });
        }

        // Get or create session
        const session = sessionId 
          ? await this.sessionManager.getSession(sessionId)
          : await this.sessionManager.createSession({ messages: [] });

        if (!session) {
          return reply.code(404).send({ error: 'Session not found' });
        }

        // Add user message to history
        session.data.messages.push({
          role: 'user',
          content: message,
          timestamp: new Date().toISOString()
        });

        // Generate response using LLM
        let response: string;
        try {
          const llmResponse = await llmClient.generate({
            message,
            sessionHistory: session.data.messages.slice(0, -1) // Exclude the just-added user message
          });
          response = llmResponse.response;
        } catch (error: unknown) {
          this.app.log.error({ err: error }, 'LLM generation error');
          response = `I'm sorry, I'm having trouble connecting to my language model. Please try again. Error: ${(error as Error).message}`;
        }
        
        // Add assistant response to history
        session.data.messages.push({
          role: 'assistant', 
          content: response,
          timestamp: new Date().toISOString()
        });

        // Update session
        await this.sessionManager.updateSession(session.id, session.data);

        return {
          response,
          sessionId: session.id
        };

      } catch (error: unknown) {
        this.app.log.error({ err: error }, 'Chat error');
        return reply.code(500).send({ error: 'Internal server error' });
      }
    });

    // WebSocket endpoint for streaming
    this.app.register(async (fastify) => {
      fastify.get('/ws', { websocket: true }, (connection: any, request) => {
        this.app.log.info('WebSocket client connected');
        
        connection.socket.on('message', async (message: Buffer) => {
          try {
            const data = JSON.parse(message.toString());
            
            if (data.type === 'chat') {
              const { message: userMessage, sessionId } = data.payload;
              
              // Process message similar to HTTP endpoint
              const session = sessionId 
                ? await this.sessionManager.getSession(sessionId)
                : await this.sessionManager.createSession({ messages: [] });

              if (session) {
                // Add user message to history
                session.data.messages.push({
                  role: 'user',
                  content: userMessage,
                  timestamp: new Date().toISOString()
                });

                // Generate response using LLM
                let response: string;
                try {
                  const llmResponse = await llmClient.generate({
                    message: userMessage,
                    sessionHistory: session.data.messages.slice(0, -1)
                  });
                  response = llmResponse.response;
                } catch (error: unknown) {
                  this.app.log.error({ err: error }, 'LLM generation error');
                  response = `I'm sorry, I'm having trouble connecting to my language model. Please try again. Error: ${(error as Error).message}`;
                }
                
                // Add assistant response to history
                session.data.messages.push({
                  role: 'assistant', 
                  content: response,
                  timestamp: new Date().toISOString()
                });

                // Update session
                await this.sessionManager.updateSession(session.id, session.data);
                
                connection.socket.send(JSON.stringify({
                  type: 'response',
                  payload: {
                    response,
                    sessionId: session.id
                  }
                }));
              }
            }
          } catch (error: unknown) {
            this.app.log.error({ err: error }, 'WebSocket message error');
            connection.socket.send(JSON.stringify({
              type: 'error',
              payload: { error: 'Failed to process message' }
            }));
          }
        });

        connection.socket.on('close', () => {
          this.app.log.info('WebSocket client disconnected');
        });
      });
    });
  }

  async start(port = 3737, host = '127.0.0.1'): Promise<void> {
    try {
      if (this.isRunning) {
        throw new Error('Gateway is already running');
      }

      await this.initialize();
      await this.app.listen({ port, host });
      
      this.isRunning = true;
      this.app.log.info(`SuperClaw Gateway started on http://${host}:${port}`);
      
    } catch (error: unknown) {
      this.app.log.error({ err: error }, 'Failed to start gateway');
      throw error;
    }
  }

  async stop(): Promise<void> {
    try {
      if (!this.isRunning) {
        return;
      }

      await this.app.close();
      await this.sessionManager.close();
      
      this.isRunning = false;
      this.app.log.info('SuperClaw Gateway stopped');
      
    } catch (error: unknown) {
      this.app.log.error({ err: error }, 'Error stopping gateway');
      throw error;
    }
  }

  getApp(): FastifyInstance {
    return this.app;
  }
}