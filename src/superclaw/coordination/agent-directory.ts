/**
 * Agent Directory Service - MCP Agent Mail Directory/LDAP Pattern
 * 
 * Provides agent discovery, memorable identities, contact policies, and capability advertisement
 * for SuperClaw swarm coordination.
 * 
 * Based on Steve Yegge's MCP Agent Mail directory pattern from the ecosystem.
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export interface AgentCapability {
  name: string;
  description: string;
  category: 'coding' | 'analysis' | 'communication' | 'orchestration' | 'specialized';
  proficiency: 1 | 2 | 3 | 4 | 5; // 1=novice, 5=expert
  tools?: string[];
}

export interface ContactPolicy {
  allowAll: boolean;
  allowedAgents: string[];
  blockedAgents: string[];
  requireReason: boolean;
  maxMessagesPerHour: number;
}

export interface AgentProfile {
  id: string;
  name: string;
  displayName: string;
  description: string;
  capabilities: AgentCapability[];
  contactPolicy: ContactPolicy;
  status: 'active' | 'busy' | 'offline' | 'maintenance';
  location?: string;
  model?: string;
  provider?: string;
  lastSeen: Date;
  created: Date;
  tags: string[];
  version?: string;
}

export interface DiscoveryQuery {
  capability?: string;
  category?: string;
  minProficiency?: number;
  tags?: string[];
  status?: string[];
  model?: string;
  provider?: string;
}

export interface DirectoryStats {
  totalAgents: number;
  activeAgents: number;
  capabilities: Record<string, number>;
  models: Record<string, number>;
  providers: Record<string, number>;
}

/**
 * AgentDirectory - Core directory service for agent discovery and coordination
 * 
 * Features:
 * - Agent registration with capabilities
 * - Discovery queries (find agents by skill)
 * - Contact policies (who can message whom)
 * - Memorable agent identities
 * - Git-backed persistence
 * - MOLTBOOK integration
 */
export class AgentDirectory {
  private agents: Map<string, AgentProfile> = new Map();
  private directoryPath: string;
  private initialized = false;

  constructor(directoryPath?: string) {
    this.directoryPath = directoryPath || path.join(process.cwd(), '.superclaw', 'directory');
  }

  /**
   * Initialize the directory service
   */
  async initialize(): Promise<void> {
    if (this.initialized) {return;}

    try {
      await fs.mkdir(this.directoryPath, { recursive: true });
      await this.loadAgents();
      this.initialized = true;
      
      // Schedule periodic cleanup of offline agents
      setInterval(() => this.cleanupOfflineAgents(), 5 * 60 * 1000); // 5 minutes
    } catch (error: unknown) {
      throw new Error(`Failed to initialize agent directory: ${error instanceof Error ? (error).message : 'Unknown error'}`, { cause: error });
    }
  }

  /**
   * Generate a unique, memorable agent ID
   */
  private generateAgentId(name: string): string {
    const hash = crypto.createHash('sha256').update(name + Date.now()).digest('hex');
    const shortHash = hash.substring(0, 8);
    const sanitizedName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    return `${sanitizedName}-${shortHash}`;
  }

  /**
   * Register a new agent in the directory
   */
  async registerAgent(profile: Omit<AgentProfile, 'id' | 'created' | 'lastSeen'>): Promise<string> {
    if (!this.initialized) {await this.initialize();}

    const id = this.generateAgentId(profile.name);
    const fullProfile: AgentProfile = {
      ...profile,
      id,
      created: new Date(),
      lastSeen: new Date()
    };

    this.agents.set(id, fullProfile);
    await this.saveAgent(fullProfile);
    
    console.log(`📝 Agent registered: ${fullProfile.displayName} (${id})`);
    return id;
  }

  /**
   * Update agent heartbeat and status
   */
  async updateAgentStatus(agentId: string, status: AgentProfile['status'], location?: string): Promise<void> {
    if (!this.initialized) {await this.initialize();}

    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    agent.status = status;
    agent.lastSeen = new Date();
    if (location) {agent.location = location;}

    this.agents.set(agentId, agent);
    await this.saveAgent(agent);
  }

  /**
   * Discover agents by capabilities and criteria
   */
  async discoverAgents(query: DiscoveryQuery): Promise<AgentProfile[]> {
    if (!this.initialized) {await this.initialize();}

    let results = Array.from(this.agents.values());

    // Filter by capability
    if (query.capability) {
      results = results.filter(agent => 
        agent.capabilities.some(cap => 
          cap.name.toLowerCase().includes(query.capability!.toLowerCase())
        )
      );
    }

    // Filter by category
    if (query.category) {
      results = results.filter(agent =>
        agent.capabilities.some(cap => cap.category === query.category)
      );
    }

    // Filter by minimum proficiency
    if (query.minProficiency) {
      results = results.filter(agent =>
        agent.capabilities.some(cap => cap.proficiency >= query.minProficiency!)
      );
    }

    // Filter by tags
    if (query.tags && query.tags.length > 0) {
      results = results.filter(agent =>
        query.tags!.some(tag => agent.tags.includes(tag))
      );
    }

    // Filter by status
    if (query.status && query.status.length > 0) {
      results = results.filter(agent => query.status!.includes(agent.status));
    }

    // Filter by model
    if (query.model) {
      results = results.filter(agent => 
        agent.model?.toLowerCase().includes(query.model!.toLowerCase())
      );
    }

    // Filter by provider
    if (query.provider) {
      results = results.filter(agent =>
        agent.provider?.toLowerCase().includes(query.provider!.toLowerCase())
      );
    }

    // Sort by relevance (active status, recent activity, high proficiency)
    results.sort((a, b) => {
      const aScore = this.calculateRelevanceScore(a, query);
      const bScore = this.calculateRelevanceScore(b, query);
      return bScore - aScore;
    });

    return results;
  }

  /**
   * Calculate relevance score for sorting
   */
  private calculateRelevanceScore(agent: AgentProfile, query: DiscoveryQuery): number {
    let score = 0;

    // Status bonus
    if (agent.status === 'active') {score += 100;}
    else if (agent.status === 'busy') {score += 50;}

    // Recent activity bonus
    const hoursSinceLastSeen = (Date.now() - agent.lastSeen.getTime()) / (1000 * 60 * 60);
    score += Math.max(0, 50 - hoursSinceLastSeen);

    // Capability match bonus
    if (query.capability) {
      agent.capabilities.forEach(cap => {
        if (cap.name.toLowerCase().includes(query.capability!.toLowerCase())) {
          score += cap.proficiency * 10;
        }
      });
    }

    return score;
  }

  /**
   * Check if agent A can contact agent B according to contact policies
   */
  async canContact(fromAgentId: string, toAgentId: string, reason?: string): Promise<boolean> {
    if (!this.initialized) {await this.initialize();}

    const toAgent = this.agents.get(toAgentId);
    if (!toAgent) {return false;}

    const policy = toAgent.contactPolicy;

    // Check if blocked
    if (policy.blockedAgents.includes(fromAgentId)) {
      return false;
    }

    // Check if allowed
    if (policy.allowAll || policy.allowedAgents.includes(fromAgentId)) {
      if (policy.requireReason && !reason) {
        return false;
      }
      return true;
    }

    return false;
  }

  /**
   * Get agent profile by ID
   */
  async getAgent(agentId: string): Promise<AgentProfile | null> {
    if (!this.initialized) {await this.initialize();}
    return this.agents.get(agentId) || null;
  }

  /**
   * List all agents with optional filtering
   */
  async listAgents(filter?: Partial<DiscoveryQuery>): Promise<AgentProfile[]> {
    if (!this.initialized) {await this.initialize();}
    
    if (!filter) {
      return Array.from(this.agents.values());
    }

    return this.discoverAgents(filter);
  }

  /**
   * Get directory statistics
   */
  async getStats(): Promise<DirectoryStats> {
    if (!this.initialized) {await this.initialize();}

    const agents = Array.from(this.agents.values());
    const capabilities: Record<string, number> = {};
    const models: Record<string, number> = {};
    const providers: Record<string, number> = {};

    agents.forEach(agent => {
      // Count capabilities
      agent.capabilities.forEach(cap => {
        capabilities[cap.name] = (capabilities[cap.name] || 0) + 1;
      });

      // Count models
      if (agent.model) {
        models[agent.model] = (models[agent.model] || 0) + 1;
      }

      // Count providers
      if (agent.provider) {
        providers[agent.provider] = (providers[agent.provider] || 0) + 1;
      }
    });

    return {
      totalAgents: agents.length,
      activeAgents: agents.filter(a => a.status === 'active').length,
      capabilities,
      models,
      providers
    };
  }

  /**
   * Remove agent from directory
   */
  async unregisterAgent(agentId: string): Promise<void> {
    if (!this.initialized) {await this.initialize();}

    const agent = this.agents.get(agentId);
    if (agent) {
      this.agents.delete(agentId);
      await this.deleteAgentFile(agentId);
      console.log(`🗑️  Agent unregistered: ${agent.displayName} (${agentId})`);
    }
  }

  /**
   * Cleanup agents that have been offline too long
   */
  private async cleanupOfflineAgents(): Promise<void> {
    const OFFLINE_THRESHOLD = 24 * 60 * 60 * 1000; // 24 hours
    const now = Date.now();

    for (const [id, agent] of this.agents.entries()) {
      const timeSinceLastSeen = now - agent.lastSeen.getTime();
      
      if (agent.status === 'offline' && timeSinceLastSeen > OFFLINE_THRESHOLD) {
        console.log(`🧹 Cleaning up offline agent: ${agent.displayName} (${id})`);
        await this.unregisterAgent(id);
      }
    }
  }

  /**
   * Load agents from filesystem
   */
  private async loadAgents(): Promise<void> {
    try {
      const files = await fs.readdir(this.directoryPath);
      const agentFiles = files.filter(f => f.endsWith('.json'));

      for (const file of agentFiles) {
        try {
          const filePath = path.join(this.directoryPath, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const agent: AgentProfile = JSON.parse(content);
          
          // Convert date strings back to Date objects
          agent.created = new Date(agent.created);
          agent.lastSeen = new Date(agent.lastSeen);
          
          this.agents.set(agent.id, agent);
        } catch (error: unknown) {
          console.warn(`⚠️  Failed to load agent file ${file}: ${error instanceof Error ? (error).message : 'Unknown error'}`);
        }
      }

      console.log(`📚 Loaded ${this.agents.size} agents from directory`);
    } catch (error: unknown) {
      // Directory doesn't exist yet, that's ok
      console.log('📁 Agent directory not found, starting fresh');
    }
  }

  /**
   * Save agent profile to filesystem
   */
  private async saveAgent(agent: AgentProfile): Promise<void> {
    const filePath = path.join(this.directoryPath, `${agent.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(agent, null, 2));
  }

  /**
   * Delete agent file from filesystem
   */
  private async deleteAgentFile(agentId: string): Promise<void> {
    const filePath = path.join(this.directoryPath, `${agentId}.json`);
    try {
      await fs.unlink(filePath);
    } catch (error: unknown) {
      // File might not exist, that's ok
    }
  }
}

/**
 * Create default contact policy for agents
 */
export function createDefaultContactPolicy(): ContactPolicy {
  return {
    allowAll: true,
    allowedAgents: [],
    blockedAgents: [],
    requireReason: false,
    maxMessagesPerHour: 100
  };
}

/**
 * Create a sample agent profile for testing
 */
export function createSampleAgentProfile(name: string): Omit<AgentProfile, 'id' | 'created' | 'lastSeen'> {
  return {
    name,
    displayName: `${name} Agent`,
    description: `AI agent specialized in ${name.toLowerCase()} tasks`,
    capabilities: [
      {
        name: name.toLowerCase(),
        description: `Expert in ${name.toLowerCase()} operations`,
        category: 'specialized',
        proficiency: 4,
        tools: [`${name.toLowerCase()}-tool`]
      }
    ],
    contactPolicy: createDefaultContactPolicy(),
    status: 'active',
    tags: [name.toLowerCase(), 'superclaw'],
    model: 'claude-3-sonnet',
    provider: 'anthropic'
  };
}

// Singleton instance for global use
export const agentDirectory = new AgentDirectory();