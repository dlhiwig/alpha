/**
 * SuperClaw Agent Pool
 * 
 * Improvement over OpenClaw: Reusable, specialized agents with pooling
 * 
 * Features:
 * - Pre-configured agent roles with custom prompts
 * - Connection pooling for efficiency
 * - Agent specialization (thinking, fast, tool-use)
 * - Cost tracking per agent
 */

import { getModelConfig, getPromptTemplates, getRolePrompt } from '../utils/config-loader';

// --- Types ---

export type AgentType = 'thinking' | 'fast' | 'tool' | 'review' | 'general';

export interface AgentConfig {
  id: string;
  role: string;
  type: AgentType;
  model?: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}

export type TrustTier = 'trusted' | 'standard' | 'probation' | 'untrusted';

export interface AgentInstance {
  config: AgentConfig;
  busy: boolean;
  totalCalls: number;
  totalTokens: { input: number; output: number };
  totalLatency: number;
  lastUsed: Date | null;
  
  // Trust system (inspired by @claude-flow/guidance)
  trustScore: number;      // 0-1, starts at 0.5
  trustTier: TrustTier;
  outcomes: { allow: number; deny: number };
}

export interface AgentCallResult {
  text: string;
  tokens: { input: number; output: number };
  latency: number;
  cost: number;
}

// Trust tier rate multipliers
const TRUST_MULTIPLIERS: Record<TrustTier, number> = {
  trusted: 2.0,      // >=0.8: 2x rate
  standard: 1.0,     // >=0.5: 1x rate  
  probation: 0.5,    // >=0.3: 0.5x rate
  untrusted: 0.1,    // <0.3: 0.1x rate
};

// Trust score thresholds
const TRUST_THRESHOLDS = {
  trusted: 0.8,
  standard: 0.5,
  probation: 0.3,
};

function getTrustTier(score: number): TrustTier {
  if (score >= TRUST_THRESHOLDS.trusted) return 'trusted';
  if (score >= TRUST_THRESHOLDS.standard) return 'standard';
  if (score >= TRUST_THRESHOLDS.probation) return 'probation';
  return 'untrusted';
}

// --- Cost Calculation ---

const COST_PER_1K_TOKENS = {
  'claude-opus-4-5-20251101': { input: 0.015, output: 0.075 },
  'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
  'claude-haiku-3-5-20241022': { input: 0.0008, output: 0.004 },
  'dolphin-llama3:8b': { input: 0, output: 0 }, // Local = free
};

function calculateCost(model: string, tokens: { input: number; output: number }): number {
  const rates = COST_PER_1K_TOKENS[model as keyof typeof COST_PER_1K_TOKENS] || 
                COST_PER_1K_TOKENS['claude-sonnet-4-20250514'];
  return (tokens.input / 1000 * rates.input) + (tokens.output / 1000 * rates.output);
}

// --- Default Agent Configurations ---

const DEFAULT_AGENT_CONFIGS: Record<string, Partial<AgentConfig>> = {
  architect: {
    type: 'thinking',
    model: 'claude-sonnet-4-20250514',
    temperature: 0.7,
  },
  coder: {
    type: 'tool',
    model: 'claude-sonnet-4-20250514',
    temperature: 0.3,
  },
  reviewer: {
    type: 'review',
    model: 'claude-sonnet-4-20250514',
    temperature: 0.5,
  },
  researcher: {
    type: 'general',
    model: 'claude-sonnet-4-20250514',
    temperature: 0.6,
  },
  writer: {
    type: 'general',
    model: 'claude-sonnet-4-20250514',
    temperature: 0.7,
  },
  fast: {
    type: 'fast',
    model: 'dolphin-llama3:8b', // Local for speed
    temperature: 0.5,
  },
};

// --- Agent Pool Class ---

export class AgentPool {
  private agents: Map<string, AgentInstance> = new Map();
  private apiKey: string;
  private modelConfig = getModelConfig();
  private prompts = getPromptTemplates();

  constructor(configs?: AgentConfig[]) {
    this.apiKey = process.env.ANTHROPIC_API_KEY || '';
    
    // Initialize with provided configs or defaults
    if (configs) {
      for (const config of configs) {
        this.addAgent(config);
      }
    }
  }

  // --- Pool Management ---

  addAgent(config: AgentConfig): void {
    const defaults = DEFAULT_AGENT_CONFIGS[config.role] || {};
    const fullConfig: AgentConfig = {
      ...defaults,
      ...config,
      systemPrompt: config.systemPrompt || getRolePrompt(config.role),
    };

    this.agents.set(config.id, {
      config: fullConfig,
      busy: false,
      totalCalls: 0,
      totalTokens: { input: 0, output: 0 },
      totalLatency: 0,
      lastUsed: null,
      // Initialize trust
      trustScore: 0.5,
      trustTier: 'standard',
      outcomes: { allow: 0, deny: 0 },
    });
  }

  removeAgent(id: string): boolean {
    return this.agents.delete(id);
  }

  getAgent(id: string): AgentInstance | undefined {
    return this.agents.get(id);
  }

  getAvailableAgent(role?: string): AgentInstance | undefined {
    for (const agent of this.agents.values()) {
      if (!agent.busy && (!role || agent.config.role === role)) {
        return agent;
      }
    }
    return undefined;
  }

  listAgents(): AgentInstance[] {
    return Array.from(this.agents.values());
  }

  getPoolStats(): {
    total: number;
    busy: number;
    available: number;
    totalCalls: number;
    totalTokens: { input: number; output: number };
    totalCost: number;
    trust: {
      byTier: Record<TrustTier, number>;
      averageScore: number;
    };
  } {
    let busy = 0;
    let totalCalls = 0;
    let totalTokens = { input: 0, output: 0 };
    let totalCost = 0;

    for (const agent of this.agents.values()) {
      if (agent.busy) busy++;
      totalCalls += agent.totalCalls;
      totalTokens.input += agent.totalTokens.input;
      totalTokens.output += agent.totalTokens.output;
      totalCost += calculateCost(
        agent.config.model || 'claude-sonnet-4-20250514',
        agent.totalTokens
      );
    }

    const trustStats = this.getTrustStats();

    return {
      total: this.agents.size,
      busy,
      available: this.agents.size - busy,
      totalCalls,
      totalTokens,
      totalCost,
      trust: {
        byTier: trustStats.byTier,
        averageScore: trustStats.averageScore,
      },
    };
  }

  // --- Agent Execution ---

  async execute(
    agentId: string,
    prompt: string,
    options?: { stream?: boolean }
  ): Promise<AgentCallResult> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    if (agent.busy) {
      throw new Error(`Agent is busy: ${agentId}`);
    }

    agent.busy = true;
    const startTime = Date.now();

    try {
      const result = await this.callLLM(agent.config, prompt);
      const latency = Date.now() - startTime;
      const cost = calculateCost(
        agent.config.model || 'claude-sonnet-4-20250514',
        result.tokens
      );

      // Update stats
      agent.totalCalls++;
      agent.totalTokens.input += result.tokens.input;
      agent.totalTokens.output += result.tokens.output;
      agent.totalLatency += latency;
      agent.lastUsed = new Date();

      return {
        text: result.text,
        tokens: result.tokens,
        latency,
        cost,
      };
    } finally {
      agent.busy = false;
    }
  }

  async executeByRole(
    role: string,
    prompt: string
  ): Promise<AgentCallResult & { agentId: string }> {
    // Find or create an agent for this role
    let agent = this.getAvailableAgent(role);
    
    if (!agent) {
      // Create a temporary agent for this role
      const tempId = `${role}-${Date.now()}`;
      this.addAgent({ id: tempId, role, type: 'general' });
      agent = this.agents.get(tempId)!;
    }

    const result = await this.execute(agent.config.id, prompt);
    return { ...result, agentId: agent.config.id };
  }

  // --- LLM Call ---

  private async callLLM(
    config: AgentConfig,
    prompt: string
  ): Promise<{ text: string; tokens: { input: number; output: number } }> {
    const model = config.model || this.modelConfig.default.model;
    const maxTokens = config.maxTokens || this.modelConfig.default.max_tokens;
    const temperature = config.temperature ?? 0.7;
    
    // Determine endpoint based on model
    const isLocal = model.includes('llama') || model.includes('dolphin');
    const endpoint = isLocal 
      ? this.modelConfig.endpoints.ollama
      : this.modelConfig.endpoints.anthropic;

    if (isLocal) {
      return this.callOllama(endpoint, model, config.systemPrompt || '', prompt);
    } else {
      return this.callAnthropic(endpoint, model, maxTokens, temperature, config.systemPrompt || '', prompt);
    }
  }

  private async callAnthropic(
    endpoint: string,
    model: string,
    maxTokens: number,
    temperature: number,
    systemPrompt: string,
    userPrompt: string
  ): Promise<{ text: string; tokens: { input: number; output: number } }> {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      content: Array<{ text: string }>;
      usage: { input_tokens: number; output_tokens: number };
    };

    return {
      text: data.content[0]?.text || '',
      tokens: {
        input: data.usage?.input_tokens || 0,
        output: data.usage?.output_tokens || 0,
      },
    };
  }

  private async callOllama(
    endpoint: string,
    model: string,
    systemPrompt: string,
    userPrompt: string
  ): Promise<{ text: string; tokens: { input: number; output: number } }> {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens: number; completion_tokens: number };
    };

    return {
      text: data.choices[0]?.message?.content || '',
      tokens: {
        input: data.usage?.prompt_tokens || 0,
        output: data.usage?.completion_tokens || 0,
      },
    };
  }

  // --- Trust System ---

  /**
   * Record an outcome for an agent (affects trust score)
   * @param agentId Agent ID
   * @param outcome 'allow' = successful action, 'deny' = blocked/failed action
   */
  recordOutcome(agentId: string, outcome: 'allow' | 'deny'): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    // Adjust trust score
    if (outcome === 'allow') {
      agent.trustScore = Math.min(1, agent.trustScore + 0.01);
      agent.outcomes.allow++;
    } else {
      agent.trustScore = Math.max(0, agent.trustScore - 0.05);
      agent.outcomes.deny++;
    }

    // Update tier
    agent.trustTier = getTrustTier(agent.trustScore);
  }

  /**
   * Apply time-based trust decay (call periodically)
   * @param idleMs Milliseconds since last activity
   */
  applyTrustDecay(idleMs: number): void {
    const decayRate = 0.01 * (idleMs / 3600000); // 0.01 per hour of idle
    
    for (const agent of this.agents.values()) {
      // Decay toward baseline (0.5)
      if (agent.trustScore > 0.5) {
        agent.trustScore = Math.max(0.5, agent.trustScore - decayRate);
      }
      agent.trustTier = getTrustTier(agent.trustScore);
    }
  }

  /**
   * Get rate multiplier for an agent based on trust tier
   */
  getRateMultiplier(agentId: string): number {
    const agent = this.agents.get(agentId);
    if (!agent) return 1.0;
    return TRUST_MULTIPLIERS[agent.trustTier];
  }

  /**
   * Check if agent is allowed to perform action (based on trust)
   */
  checkTrust(agentId: string, requiredTier: TrustTier = 'standard'): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    const tierOrder: TrustTier[] = ['untrusted', 'probation', 'standard', 'trusted'];
    const agentTierIndex = tierOrder.indexOf(agent.trustTier);
    const requiredTierIndex = tierOrder.indexOf(requiredTier);

    return agentTierIndex >= requiredTierIndex;
  }

  /**
   * Get trust statistics for all agents
   */
  getTrustStats(): {
    byTier: Record<TrustTier, number>;
    averageScore: number;
    totalOutcomes: { allow: number; deny: number };
  } {
    const byTier: Record<TrustTier, number> = {
      trusted: 0,
      standard: 0,
      probation: 0,
      untrusted: 0,
    };
    let totalScore = 0;
    const totalOutcomes = { allow: 0, deny: 0 };

    for (const agent of this.agents.values()) {
      byTier[agent.trustTier]++;
      totalScore += agent.trustScore;
      totalOutcomes.allow += agent.outcomes.allow;
      totalOutcomes.deny += agent.outcomes.deny;
    }

    return {
      byTier,
      averageScore: this.agents.size > 0 ? totalScore / this.agents.size : 0.5,
      totalOutcomes,
    };
  }

  // --- Cleanup ---

  clear(): void {
    this.agents.clear();
  }
}

// --- Factory Functions ---

export function createDefaultPool(): AgentPool {
  const pool = new AgentPool();
  
  // Add one of each default role
  pool.addAgent({ id: 'architect-1', role: 'architect', type: 'thinking' });
  pool.addAgent({ id: 'coder-1', role: 'coder', type: 'tool' });
  pool.addAgent({ id: 'coder-2', role: 'coder', type: 'tool' });
  pool.addAgent({ id: 'reviewer-1', role: 'reviewer', type: 'review' });
  pool.addAgent({ id: 'researcher-1', role: 'researcher', type: 'general' });
  pool.addAgent({ id: 'writer-1', role: 'writer', type: 'general' });
  
  return pool;
}

export function createMinimalPool(): AgentPool {
  const pool = new AgentPool();
  pool.addAgent({ id: 'general-1', role: 'architect', type: 'general' });
  return pool;
}
