/**
 * Swarm Types
 * 
 * Core types for SuperClaw's concurrent multi-agent orchestration.
 */

export type AgentRole = 
  | 'implementer'    // Codex: produce code/patches
  | 'critic'         // Claude: review for security, correctness
  | 'researcher'     // Gemini: alternatives, tradeoffs
  | 'simplifier'     // DeepSeek/Kimi: hidden assumptions, simplify
  | 'ideator'        // Grok: fast brainstorming
  | 'web'            // Perplexity: real-time web research
  | 'general'        // No specific role
  | 'vision'         // Qwen/Cosmos: image/video understanding
  | 'physical'       // Cosmos: physical world reasoning
  | 'longcontext'    // Nemotron: 1M+ context tasks
  | 'agentic';       // GLM5/Qwen: multi-step agentic

export type ProviderName = 
  | 'codex'      // OpenAI Codex
  | 'gemini'     // Google Gemini
  | 'claude'     // Anthropic Claude
  | 'deepseek'   // DeepSeek
  | 'kimi'       // Moonshot Kimi K2.5 (direct)
  | 'grok'       // xAI Grok
  | 'perplexity' // Perplexity (web-focused)
  | 'ollama'     // Local Ollama
  | 'nvidia'     // NVIDIA NIM (Kimi K2.5 via enterprise infra)
  | 'minimax'    // MiniMax M2.5 (80% SWE-Bench, $0.30/M, 1M context)
  | 'zhipu'      // Zhipu GLM-5 (744B MoE, #1 BrowseComp)
  // NVIDIA NIM models (all use NVIDIA_API_KEY)
  | 'nemotron'   // Nemotron-3-Nano-30B: 1M context, MoE
  | 'glm5'       // GLM-5 744B: Long-horizon agentic
  | 'cosmos'     // Cosmos-Reason2-8B: Physical world
  | 'qwen'       // Qwen 3.5-397B: 400B VLM, vision + agentic
  // New providers
  | 'cohere'     // Cohere Command R/R+ (RAG specialist)
  | 'mistral'    // Mistral Large/Small (European AI)
  | 'groq';      // Groq LPUs (ultra-fast inference)

export interface AgentConfig {
  provider: ProviderName;
  role: AgentRole;
  rolePrompt?: string;
  timeout?: number;
  retries?: number;
  json?: boolean;
}

export interface AgentResult {
  provider: ProviderName;
  role: AgentRole;
  output: string;
  exitCode: number;
  durationMs: number;
  error?: string;
  timedOut?: boolean;
  retryCount?: number;
  fallbackCount?: number;       // How many fallbacks were used
  originalProvider?: ProviderName;  // Initial provider before fallbacks
}

export interface SwarmRoundConfig {
  task: string;
  context?: string;
  agents: AgentConfig[];
  timeout?: number;        // Per-agent timeout (default 60s)
  roundTimeout?: number;   // Total round timeout (default 120s)
  minAgents?: number;      // Min successful agents to proceed (default 1)
  json?: boolean;          // Request JSON output from all agents
  phase?: 'fanout' | 'critique' | 'implement' | 'revise' | 'judge' | 'default';  // Phase for timeout selection
}

export interface SwarmRoundResult {
  task: string;
  results: AgentResult[];
  successful: AgentResult[];
  failed: AgentResult[];
  durationMs: number;
  partialSuccess: boolean;
}

export interface SynthesisResult {
  solution: string;
  patch?: string;
  risks: string[];
  tests?: string[];
  fallbackPlan?: string;
  conflicts: Conflict[];
  confidence: number;      // 0-1
  sources: ProviderName[];
}

export interface Conflict {
  topic: string;
  positions: { provider: ProviderName; position: string }[];
  resolution?: string;
}

export type SwarmMode = 
  | 'fanout'          // Single round, merge results
  | 'fanout-critique' // Round 1 generate, Round 2 critique
  | 'hierarchical';   // Generate → Review → Revise

export interface SwarmConfig {
  mode: SwarmMode;
  task: string;
  context?: string;
  agents?: AgentConfig[];
  maxRounds?: number;
  json?: boolean;
}

export interface SwarmResult {
  mode: SwarmMode;
  rounds: SwarmRoundResult[];
  synthesis: SynthesisResult;
  totalDurationMs: number;
}

// Default role prompts
export const ROLE_PROMPTS: Record<AgentRole, string> = {
  implementer: 'Implement the change. Produce a patch/diff. Be practical and concise. Output working code.',
  critic: 'Review for security, correctness, and edge cases. Try to break it. List specific issues found.',
  researcher: 'Generate alternatives and architecture considerations. Analyze tradeoffs. Be thorough.',
  simplifier: 'Find hidden assumptions. Simplify the approach. Propose minimal tests.',
  ideator: 'Brainstorm creative solutions quickly. Quantity over perfection. List ideas.',
  web: 'Search for relevant information. Cite sources. Provide factual context.',
  general: 'Analyze the task and provide your best solution.',
  vision: 'Analyze the image or video. Describe what you see. Extract relevant information.',
  physical: 'Reason about the physical world. Consider spatial relationships, physics, and real-world constraints.',
  longcontext: 'Process the entire context. Maintain coherence across all provided information. Reference specific details.',
  agentic: 'Break down the task into steps. Plan your approach. Execute methodically. Verify each step.',
};

// Default provider-to-role mapping
export const DEFAULT_AGENT_ROLES: Record<ProviderName, AgentRole> = {
  codex: 'implementer',
  claude: 'critic',
  gemini: 'researcher',
  deepseek: 'simplifier',
  kimi: 'simplifier',
  grok: 'ideator',
  perplexity: 'web',
  ollama: 'general',  // Local fallback, versatile
  nvidia: 'implementer',  // Enterprise Kimi K2.5 — good for code
  minimax: 'implementer', // 80% SWE-Bench, cheap bulk code gen
  zhipu: 'researcher',    // #1 BrowseComp — web/research tasks
  // NVIDIA NIM models
  nemotron: 'longcontext', // 1M context — document analysis, codebases
  glm5: 'agentic',         // 744B MoE — complex multi-step tasks
  cosmos: 'physical',      // Physical world — robotics, video
  qwen: 'vision',          // 400B VLM — image/video + agentic
  // New providers
  cohere: 'researcher',    // Command R/R+ — excellent for RAG and research
  mistral: 'general',      // European alternative — good all-rounder
  groq: 'ideator',         // Ultra-fast inference — great for brainstorming
};
