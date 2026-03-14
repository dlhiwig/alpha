/**
 * Nemotron-3-Super Integration for Alpha's SKYNET Layer
 *
 * Integrates locally-running Nemotron-3-Super (via Ollama) for:
 *   - Code/PR/Skill security auditing with CVSS ratings
 *   - Swarm consensus judging (multi-agent response evaluation)
 *   - General inference with token rate tracking
 *
 * @module nemotron-integration
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export type RiskLevel = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface Finding {
  /** Short identifier (e.g. "SQL_INJECTION", "HARDCODED_SECRET") */
  id: string;
  /** One-line summary */
  title: string;
  /** Full description of the vulnerability/issue */
  description: string;
  /** CVSS v3.1 base score (0.0–10.0) */
  cvssScore: number;
  /** CVSS severity bucket */
  severity: RiskLevel;
  /** Affected file path or code location, if known */
  location?: string;
  /** CWE identifier, if applicable */
  cweId?: string;
}

export interface AuditResult {
  findings: Finding[];
  overallRisk: RiskLevel;
  recommendations: string[];
  /** Model used for this audit */
  model: string;
  /** Wall-clock time in ms */
  durationMs: number;
  /** Tokens generated */
  tokensGenerated: number;
}

export interface AgentResponse {
  agentId: string;
  response: string;
  model?: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface JudgeResult {
  /** ID of the winning agent */
  winner: string;
  /** Confidence in the verdict (0.0–1.0) */
  confidence: number;
  /** Explanation of why this response won */
  reasoning: string;
  /** Per-agent scores */
  scores: Array<{ agentId: string; score: number; strengths: string[]; weaknesses: string[] }>;
  /** Model used for judging */
  model: string;
  /** Wall-clock time in ms */
  durationMs: number;
}

export interface NemotronClientConfig {
  /** Ollama base URL. Default: http://127.0.0.1:11434 */
  baseUrl: string;
  /** Primary model name. Default: nemotron-3-super */
  model: string;
  /** Fallback model if primary fails. Default: qwen3.5:27b */
  fallbackModel: string;
  /** Request timeout in ms. Default: 300_000 (5 min, Nemotron cold-start) */
  timeoutMs: number;
  /** Expected baseline token rate (tok/s) for tracking. Default: 3.5 */
  baselineTokenRate: number;
}

interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
  total_duration?: number;
  eval_count?: number;
  eval_duration?: number;
  prompt_eval_count?: number;
}

interface OllamaChatResponse {
  model: string;
  message: { role: string; content: string };
  done: boolean;
  total_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

interface TokenRateEntry {
  timestamp: number;
  model: string;
  tokensGenerated: number;
  durationMs: number;
  tokPerSec: number;
}

// ═══════════════════════════════════════════════════════════════════
// NemotronClient — Ollama API wrapper
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: NemotronClientConfig = {
  baseUrl: "http://127.0.0.1:11434",
  model: "nemotron-3-super",
  fallbackModel: "qwen3.5:27b",
  timeoutMs: 300_000,
  baselineTokenRate: 3.5,
};

export class NemotronClient {
  readonly config: NemotronClientConfig;
  private rateHistory: TokenRateEntry[] = [];
  private usingFallback = false;

  constructor(config: Partial<NemotronClientConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Current active model (may be fallback) */
  get activeModel(): string {
    return this.usingFallback ? this.config.fallbackModel : this.config.model;
  }

  /** Whether we've fallen back to the secondary model */
  get isFallback(): boolean {
    return this.usingFallback;
  }

  /** Average observed token rate (tok/s) over recent calls, or baseline if no data */
  get observedTokenRate(): number {
    if (this.rateHistory.length === 0) return this.config.baselineTokenRate;
    const recent = this.rateHistory.slice(-20);
    return recent.reduce((sum, e) => sum + e.tokPerSec, 0) / recent.length;
  }

  /** Token rate history for monitoring */
  get tokenRateHistory(): readonly TokenRateEntry[] {
    return this.rateHistory;
  }

  /**
   * Send a chat completion to Ollama.
   * Automatically falls back to fallbackModel on failure.
   * Sets think:false by default (Qwen3.5 thinking-mode gotcha).
   */
  async chat(
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    options: { temperature?: number; numPredict?: number } = {},
  ): Promise<{ content: string; model: string; tokensGenerated: number; durationMs: number }> {
    const startMs = Date.now();

    // Try primary model first
    try {
      const result = await this.callChat(this.config.model, messages, options);
      this.usingFallback = false;
      this.recordRate(result.model, result.tokensGenerated, Date.now() - startMs);
      return { ...result, durationMs: Date.now() - startMs };
    } catch (primaryErr) {
      console.warn(
        `[Nemotron] Primary model "${this.config.model}" failed: ${(primaryErr as Error).message}. Falling back to "${this.config.fallbackModel}"`,
      );
    }

    // Fallback
    try {
      const result = await this.callChat(this.config.fallbackModel, messages, options);
      this.usingFallback = true;
      this.recordRate(result.model, result.tokensGenerated, Date.now() - startMs);
      return { ...result, durationMs: Date.now() - startMs };
    } catch (fallbackErr) {
      throw new Error(
        `[Nemotron] Both models failed. Primary: ${this.config.model}, Fallback: ${this.config.fallbackModel}. ` +
          `Last error: ${(fallbackErr as Error).message}`,
      );
    }
  }

  /** Health check — verifies Ollama is reachable */
  async ping(): Promise<boolean> {
    try {
      const res = await fetch(this.config.baseUrl, {
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** List locally available models */
  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.config.baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Ollama /api/tags failed: ${res.status}`);
    const data = (await res.json()) as { models: Array<{ name: string }> };
    return data.models.map((m) => m.name);
  }

  // ─── Private ───────────────────────────────────────────

  private async callChat(
    model: string,
    messages: Array<{ role: string; content: string }>,
    options: { temperature?: number; numPredict?: number },
  ): Promise<{ content: string; model: string; tokensGenerated: number }> {
    const body = {
      model,
      messages,
      stream: false,
      think: false, // Qwen3.5 thinking-mode gotcha: disable by default
      options: {
        temperature: options.temperature ?? 0.2,
        ...(options.numPredict != null ? { num_predict: options.numPredict } : {}),
      },
    };

    const res = await fetch(`${this.config.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Ollama chat failed (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as OllamaChatResponse;
    const tokensGenerated = data.eval_count ?? 0;

    return {
      content: data.message.content,
      model: data.model,
      tokensGenerated,
    };
  }

  private recordRate(model: string, tokensGenerated: number, durationMs: number): void {
    const tokPerSec = durationMs > 0 ? (tokensGenerated / durationMs) * 1000 : 0;
    this.rateHistory.push({
      timestamp: Date.now(),
      model,
      tokensGenerated,
      durationMs,
      tokPerSec,
    });
    // Keep last 100 entries
    if (this.rateHistory.length > 100) {
      this.rateHistory = this.rateHistory.slice(-100);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// NemotronAuditor — Security auditing via local LLM
// ═══════════════════════════════════════════════════════════════════

const AUDIT_SYSTEM_PROMPT = `You are a senior security auditor. Analyze the provided code/diff for security vulnerabilities.

For each finding, output a JSON object in this EXACT format (one per line, no markdown fences):
{"id":"VULN_ID","title":"Short title","description":"Detailed description","cvssScore":7.5,"severity":"HIGH","location":"file:line if known","cweId":"CWE-79"}

After all findings, output a summary line:
{"overallRisk":"HIGH","recommendations":["recommendation 1","recommendation 2"]}

Severity mapping: CRITICAL (9.0-10.0), HIGH (7.0-8.9), MEDIUM (4.0-6.9), LOW (0.1-3.9).
If no vulnerabilities found, output: {"overallRisk":"LOW","recommendations":["No significant vulnerabilities detected."]}

Be thorough. Check for: injection flaws, auth bypasses, hardcoded secrets, path traversal, prototype pollution, unsafe deserialization, SSRF, command injection, XSS, insecure crypto, race conditions.`;

export class NemotronAuditor {
  constructor(private client: NemotronClient) {}

  /** Audit raw source code for security vulnerabilities */
  async auditCode(code: string): Promise<AuditResult> {
    return this.runAudit(
      `Audit the following source code for security vulnerabilities:\n\n\`\`\`\n${code}\n\`\`\``,
    );
  }

  /** Audit a GitHub PR diff before merge */
  async auditPR(diff: string): Promise<AuditResult> {
    return this.runAudit(
      `Audit the following GitHub PR diff for security vulnerabilities introduced by the changes. Focus on NEW code (lines starting with +):\n\n${diff}`,
    );
  }

  /**
   * Scan a skill marketplace submission for malware/security issues.
   * Reads SKILL.md + all .ts/.js/.sh files in the directory.
   */
  async auditSkill(skillDir: string): Promise<AuditResult> {
    const files = this.collectSkillFiles(skillDir);
    if (files.length === 0) {
      return {
        findings: [],
        overallRisk: "LOW",
        recommendations: ["No auditable files found in skill directory."],
        model: this.client.activeModel,
        durationMs: 0,
        tokensGenerated: 0,
      };
    }

    const fileContents = files
      .map((f) => `--- ${f.relativePath} ---\n${f.content}`)
      .join("\n\n");

    return this.runAudit(
      `Audit the following skill marketplace submission for malware, backdoors, data exfiltration, and security vulnerabilities.\n\nLook specifically for:\n- Outbound network calls to unknown hosts\n- File system access outside expected paths\n- Environment variable harvesting\n- Obfuscated code\n- Credential theft patterns\n- Shell command injection\n\nFiles:\n\n${fileContents}`,
    );
  }

  // ─── Private ───────────────────────────────────────────

  private async runAudit(userPrompt: string): Promise<AuditResult> {
    const result = await this.client.chat(
      [
        { role: "system", content: AUDIT_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.1, numPredict: 4096 },
    );

    return this.parseAuditResponse(result.content, result.model, result.durationMs, result.tokensGenerated);
  }

  private parseAuditResponse(
    raw: string,
    model: string,
    durationMs: number,
    tokensGenerated: number,
  ): AuditResult {
    const findings: Finding[] = [];
    let overallRisk: RiskLevel = "LOW";
    const recommendations: string[] = [];

    // Extract JSON objects from response (handles markdown fences too)
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "");
    const lines = cleaned.split("\n").filter((l) => l.trim().startsWith("{"));

    for (const line of lines) {
      try {
        const obj = JSON.parse(line.trim());

        if ("overallRisk" in obj) {
          overallRisk = this.normalizeRisk(obj.overallRisk);
          if (Array.isArray(obj.recommendations)) {
            recommendations.push(...obj.recommendations);
          }
        } else if ("id" in obj && "cvssScore" in obj) {
          findings.push({
            id: String(obj.id),
            title: String(obj.title ?? "Unknown"),
            description: String(obj.description ?? ""),
            cvssScore: Number(obj.cvssScore) || 0,
            severity: this.normalizeRisk(obj.severity ?? this.cvssToSeverity(obj.cvssScore)),
            location: obj.location ? String(obj.location) : undefined,
            cweId: obj.cweId ? String(obj.cweId) : undefined,
          });
        }
      } catch {
        // Non-JSON line, skip
      }
    }

    // If parser found findings but no summary, derive overallRisk from max CVSS
    if (findings.length > 0 && recommendations.length === 0) {
      const maxCvss = Math.max(...findings.map((f) => f.cvssScore));
      overallRisk = this.cvssToSeverity(maxCvss);
      recommendations.push("Review and remediate all findings before deployment.");
    }

    return { findings, overallRisk, recommendations, model, durationMs, tokensGenerated };
  }

  private normalizeRisk(raw: string): RiskLevel {
    const upper = String(raw).toUpperCase();
    if (upper === "CRITICAL" || upper === "HIGH" || upper === "MEDIUM" || upper === "LOW") {
      return upper;
    }
    return "MEDIUM";
  }

  private cvssToSeverity(score: number): RiskLevel {
    if (score >= 9.0) return "CRITICAL";
    if (score >= 7.0) return "HIGH";
    if (score >= 4.0) return "MEDIUM";
    return "LOW";
  }

  private collectSkillFiles(
    dir: string,
    base?: string,
  ): Array<{ relativePath: string; content: string }> {
    const result: Array<{ relativePath: string; content: string }> = [];
    const baseDir = base ?? dir;

    if (!fs.existsSync(dir)) return result;

    const AUDITABLE_EXTS = new Set([
      ".ts", ".js", ".mjs", ".cjs", ".sh", ".bash", ".py", ".md",
      ".json", ".yaml", ".yml", ".toml",
    ]);
    const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build"]);
    const MAX_FILE_SIZE = 256 * 1024; // 256KB per file

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          result.push(...this.collectSkillFiles(path.join(dir, entry.name), baseDir));
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (AUDITABLE_EXTS.has(ext)) {
          const fullPath = path.join(dir, entry.name);
          const stat = fs.statSync(fullPath);
          if (stat.size <= MAX_FILE_SIZE) {
            result.push({
              relativePath: path.relative(baseDir, fullPath),
              content: fs.readFileSync(fullPath, "utf-8"),
            });
          }
        }
      }
    }

    return result;
  }
}

// ═══════════════════════════════════════════════════════════════════
// NemotronJudge — Swarm consensus via local LLM
// ═══════════════════════════════════════════════════════════════════

const JUDGE_SYSTEM_PROMPT = `You are an impartial judge evaluating multiple AI agent responses to the same task.

Evaluate each response on: accuracy, completeness, clarity, correctness, and relevance.

Output your verdict as a single JSON object (no markdown fences):
{
  "winner": "agent_id",
  "confidence": 0.85,
  "reasoning": "Why this response is best...",
  "scores": [
    {"agentId": "agent1", "score": 0.9, "strengths": ["..."], "weaknesses": ["..."]},
    {"agentId": "agent2", "score": 0.7, "strengths": ["..."], "weaknesses": ["..."]}
  ]
}

Score each agent 0.0–1.0. Be objective. If responses are equally good, pick the most concise one and set confidence lower.`;

export class NemotronJudge {
  constructor(private client: NemotronClient) {}

  /**
   * Evaluate multiple agent responses and pick a winner.
   */
  async judgeResponses(task: string, responses: AgentResponse[]): Promise<JudgeResult> {
    if (responses.length === 0) {
      throw new Error("[NemotronJudge] No responses to judge");
    }

    if (responses.length === 1) {
      return {
        winner: responses[0].agentId,
        confidence: 1.0,
        reasoning: "Single response — automatic winner.",
        scores: [
          {
            agentId: responses[0].agentId,
            score: 1.0,
            strengths: ["Only response provided"],
            weaknesses: [],
          },
        ],
        model: this.client.activeModel,
        durationMs: 0,
      };
    }

    const responsesBlock = responses
      .map(
        (r, i) =>
          `--- Agent "${r.agentId}" (Response ${i + 1}) ---\n${r.response}\n`,
      )
      .join("\n");

    const result = await this.client.chat(
      [
        { role: "system", content: JUDGE_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Task: ${task}\n\nResponses to evaluate:\n\n${responsesBlock}`,
        },
      ],
      { temperature: 0.1, numPredict: 2048 },
    );

    return this.parseJudgeResponse(result.content, result.model, result.durationMs, responses);
  }

  // ─── Private ───────────────────────────────────────────

  private parseJudgeResponse(
    raw: string,
    model: string,
    durationMs: number,
    responses: AgentResponse[],
  ): JudgeResult {
    // Extract JSON from response
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "");

    // Try to find a JSON object
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const verdict = JSON.parse(jsonMatch[0]);

        // Validate winner exists in responses
        const validAgentIds = new Set(responses.map((r) => r.agentId));
        const winner = validAgentIds.has(verdict.winner)
          ? String(verdict.winner)
          : responses[0].agentId;

        const scores: JudgeResult["scores"] = Array.isArray(verdict.scores)
          ? verdict.scores.map((s: Record<string, unknown>) => ({
              agentId: String(s.agentId ?? "unknown"),
              score: Number(s.score) || 0,
              strengths: Array.isArray(s.strengths)
                ? s.strengths.map(String)
                : [],
              weaknesses: Array.isArray(s.weaknesses)
                ? s.weaknesses.map(String)
                : [],
            }))
          : responses.map((r) => ({
              agentId: r.agentId,
              score: 0.5,
              strengths: [],
              weaknesses: [],
            }));

        return {
          winner,
          confidence: Math.max(0, Math.min(1, Number(verdict.confidence) || 0.5)),
          reasoning: String(verdict.reasoning ?? "No reasoning provided"),
          scores,
          model,
          durationMs,
        };
      } catch {
        // JSON parse failed, fall through to fallback
      }
    }

    // Fallback: return first response as winner with low confidence
    return {
      winner: responses[0].agentId,
      confidence: 0.3,
      reasoning: `[Fallback] Could not parse judge response. Raw output: ${raw.slice(0, 200)}...`,
      scores: responses.map((r) => ({
        agentId: r.agentId,
        score: 0.5,
        strengths: [],
        weaknesses: [],
      })),
      model,
      durationMs,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// SKYNET Wiring — hook into existing Skynet instance
// ═══════════════════════════════════════════════════════════════════

export interface NemotronModule {
  client: NemotronClient;
  auditor: NemotronAuditor;
  judge: NemotronJudge;
}

/**
 * Create and attach the Nemotron module to a Skynet instance.
 * Registers the module on skynet as `skynet.nemotron`.
 *
 * @param skynet - The active Skynet instance
 * @param config - Optional NemotronClient config overrides
 * @returns The initialized NemotronModule
 */
export function attachNemotronModule(
  skynet: { recordPattern: (p: string) => void; [key: string]: unknown },
  config: Partial<NemotronClientConfig> = {},
): NemotronModule {
  const client = new NemotronClient(config);
  const auditor = new NemotronAuditor(client);
  const judge = new NemotronJudge(client);

  const module: NemotronModule = { client, auditor, judge };

  // Attach to skynet instance for discovery
  (skynet as Record<string, unknown>).nemotron = module;

  // Record activation pattern
  skynet.recordPattern("nemotron:module_attached");

  console.log(
    `[SKYNET:NEMOTRON] Module attached — model=${client.activeModel}, ` +
      `fallback=${client.config.fallbackModel}, timeout=${client.config.timeoutMs}ms`,
  );

  return module;
}
