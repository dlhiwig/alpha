// SuperClaw Skill Types

export type AgentRole = 'architect' | 'coder' | 'reviewer' | 'researcher' | 'writer' | 'analyst';

export interface AgentConfig {
  role: AgentRole;
  focus: string;
  condition?: string; // Optional: when to include this agent
}

export interface SkillInput {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required?: boolean;
  default?: unknown;
}

export interface SkillOutput {
  format: 'markdown' | 'json' | 'code' | 'text';
  sections?: Array<{
    name: string;
    required: boolean;
  }>;
}

export interface SkillHints {
  maxAgents?: number;
  timeout?: number;
  model?: string;
  parallel?: boolean;
  temperature?: number;
}

export interface SkillDefinition {
  id: string;
  name: string;
  version: string;
  description?: string;
  
  // Matching
  triggers: {
    keywords: string[];
    patterns?: string[];
    examples?: string[];
  };
  
  // Agent configuration
  agents: {
    required: AgentConfig[];
    optional?: AgentConfig[];
  };
  
  // I/O schema
  input: {
    required: SkillInput[];
    optional?: SkillInput[];
  };
  
  output: SkillOutput;
  
  // Execution hints
  hints?: SkillHints;
}

export interface SkillMatch {
  skill: SkillDefinition;
  confidence: number; // 0.0 - 1.0
  matchType: 'keyword' | 'pattern' | 'example' | 'default';
  matchedOn?: string;
}

export interface SkillRegistry {
  skills: Map<string, SkillDefinition>;
  match(input: string): SkillMatch | null;
  get(id: string): SkillDefinition | null;
  list(): SkillDefinition[];
}
