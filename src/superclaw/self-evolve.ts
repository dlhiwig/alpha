/**
 * Alpha Self-Evolution Engine
 *
 * Detects improvement opportunities from Oracle patterns/mistakes,
 * generates code patches, and routes them through PR governance:
 *
 *   - Low priority + Low impact  → auto-commit directly (no PR)
 *   - Medium/High priority OR impact → GitHub PR + human review
 *
 * Actual code generation is delegated to LLM agents later;
 * this module owns the governance scaffold and gh CLI integration.
 */

import { execFile } from "node:child_process";
import crypto from "node:crypto";
import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ─── Types ────────────────────────────────────────────────────

export type RiskLevel = "low" | "medium" | "high";

export interface EvolutionOpportunity {
  id: string;
  source: "oracle-pattern" | "oracle-mistake" | "manual" | "sentinel-anomaly";
  description: string;
  suggestedFix?: string;
  priority: RiskLevel;
  impact: RiskLevel;
  filePaths?: string[];
  timestamp: number;
}

export interface CodePatch {
  file: string;
  action: "create" | "modify" | "delete";
  content?: string;
  diff?: string;
}

export interface EvolutionPlan {
  id: string;
  opportunity: EvolutionOpportunity;
  title: string;
  description: string;
  patches: CodePatch[];
  governance: GovernanceRoute;
  status: "planned" | "auto-committed" | "pr-opened" | "merged" | "rejected";
  prUrl?: string;
  prNumber?: number;
  commitSha?: string;
  createdAt: number;
  completedAt?: number;
}

export type GovernanceRoute = "auto-commit" | "pr-required";

export interface SelfEvolveStats {
  totalOpportunities: number;
  totalPlans: number;
  autoCommitted: number;
  prsOpened: number;
  prsMerged: number;
  prsRejected: number;
  pending: number;
}

export interface SelfEvolverConfig {
  repoOwner: string;
  repoName: string;
  baseBranch: string;
  branchPrefix: string;
  stateDir: string;
  /** When true, auto-commit is allowed for low/low changes */
  autoCommitEnabled: boolean;
  /** Maximum patches per auto-commit batch */
  maxAutoCommitPatches: number;
}

const DEFAULT_CONFIG: SelfEvolverConfig = {
  repoOwner: "dlhiwig",
  repoName: "alpha",
  baseBranch: "alpha/main",
  branchPrefix: "self-evolve",
  stateDir: path.join(homedir(), ".alpha", "self-evolve"),
  autoCommitEnabled: true,
  maxAutoCommitPatches: 5,
};

// ─── Governance Decision ──────────────────────────────────────

function routeGovernance(priority: RiskLevel, impact: RiskLevel): GovernanceRoute {
  if (priority === "low" && impact === "low") {
    return "auto-commit";
  }
  return "pr-required";
}

// ─── SelfEvolver ──────────────────────────────────────────────

export class SelfEvolver {
  private config: SelfEvolverConfig;
  private plans: EvolutionPlan[] = [];
  private opportunities: EvolutionOpportunity[] = [];
  private initialized = false;

  constructor(config?: Partial<SelfEvolverConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await fs.mkdir(this.config.stateDir, { recursive: true });
    await this.loadState();

    this.initialized = true;
    console.log("[SELF-EVOLVE] Initialized — governance routes active");
  }

  // ─── Opportunity Detection ────────────────────────────────

  /**
   * Detect improvement opportunities from Oracle insights and mistakes.
   * Returns new opportunities found this cycle.
   */
  detectOpportunities(
    oracleInsights: {
      pattern: string;
      frequency: number;
      recommendation: string;
      confidence: number;
    }[],
    oracleMistakes: {
      pattern: string;
      rootCause: string;
      correction: string;
      severity: RiskLevel;
    }[],
  ): EvolutionOpportunity[] {
    const found: EvolutionOpportunity[] = [];

    // High-confidence patterns → improvement opportunities
    for (const insight of oracleInsights) {
      if (insight.confidence < 0.5) {
        continue;
      }

      const existing = this.opportunities.find(
        (o) => o.source === "oracle-pattern" && o.description.includes(insight.pattern),
      );
      if (existing) {
        continue;
      }

      const opp: EvolutionOpportunity = {
        id: this.generateId("opp"),
        source: "oracle-pattern",
        description: insight.recommendation,
        priority: insight.confidence >= 0.8 ? "medium" : "low",
        impact: insight.frequency >= 10 ? "medium" : "low",
        timestamp: Date.now(),
      };
      found.push(opp);
      this.opportunities.push(opp);
    }

    // Mistakes → fix opportunities
    for (const mistake of oracleMistakes) {
      const existing = this.opportunities.find(
        (o) => o.source === "oracle-mistake" && o.description.includes(mistake.pattern),
      );
      if (existing) {
        continue;
      }

      const opp: EvolutionOpportunity = {
        id: this.generateId("opp"),
        source: "oracle-mistake",
        description: `Fix: ${mistake.pattern} — ${mistake.rootCause}`,
        suggestedFix: mistake.correction,
        priority: mistake.severity,
        impact: mistake.severity,
        timestamp: Date.now(),
      };
      found.push(opp);
      this.opportunities.push(opp);
    }

    if (found.length > 0) {
      console.log(`[SELF-EVOLVE] Detected ${found.length} new improvement opportunities`);
    }

    return found;
  }

  /**
   * Manually register an evolution opportunity.
   */
  addOpportunity(
    description: string,
    opts: {
      priority?: RiskLevel;
      impact?: RiskLevel;
      suggestedFix?: string;
      filePaths?: string[];
    } = {},
  ): EvolutionOpportunity {
    const opp: EvolutionOpportunity = {
      id: this.generateId("opp"),
      source: "manual",
      description,
      suggestedFix: opts.suggestedFix,
      priority: opts.priority ?? "medium",
      impact: opts.impact ?? "medium",
      filePaths: opts.filePaths,
      timestamp: Date.now(),
    };
    this.opportunities.push(opp);
    return opp;
  }

  // ─── Plan Creation ────────────────────────────────────────

  /**
   * Create an evolution plan from an opportunity.
   * Patches will be populated later by an LLM agent; this sets up governance.
   */
  createPlan(
    opportunityId: string,
    title: string,
    description: string,
    patches: CodePatch[] = [],
  ): EvolutionPlan {
    const opp = this.opportunities.find((o) => o.id === opportunityId);
    if (!opp) {
      throw new Error(`Opportunity not found: ${opportunityId}`);
    }

    const governance = routeGovernance(opp.priority, opp.impact);

    const plan: EvolutionPlan = {
      id: this.generateId("plan"),
      opportunity: opp,
      title,
      description,
      patches,
      governance,
      status: "planned",
      createdAt: Date.now(),
    };

    this.plans.push(plan);
    this.saveState().catch(() => {}); // fire-and-forget persist

    console.log(
      `[SELF-EVOLVE] Plan created: "${title}" → route=${governance} (${opp.priority}/${opp.impact})`,
    );

    return plan;
  }

  // ─── Execution ────────────────────────────────────────────

  /**
   * Execute a plan: auto-commit or create PR based on governance route.
   */
  async executePlan(planId: string): Promise<EvolutionPlan> {
    const plan = this.plans.find((p) => p.id === planId);
    if (!plan) {
      throw new Error(`Plan not found: ${planId}`);
    }

    if (plan.status !== "planned") {
      throw new Error(`Plan ${planId} already executed (status: ${plan.status})`);
    }

    if (plan.patches.length === 0) {
      throw new Error(`Plan ${planId} has no patches — generate code first`);
    }

    if (plan.governance === "auto-commit" && this.config.autoCommitEnabled) {
      if (plan.patches.length > this.config.maxAutoCommitPatches) {
        // Too many patches for auto-commit — escalate to PR
        console.log(
          `[SELF-EVOLVE] Escalating plan ${planId} to PR (${plan.patches.length} patches > max ${this.config.maxAutoCommitPatches})`,
        );
        plan.governance = "pr-required";
      }
    }

    if (plan.governance === "auto-commit" && this.config.autoCommitEnabled) {
      await this.autoCommit(plan);
    } else {
      await this.createPR(plan);
    }

    plan.completedAt = Date.now();
    await this.saveState();
    return plan;
  }

  // ─── Auto-Commit (low/low only) ──────────────────────────

  private async autoCommit(plan: EvolutionPlan): Promise<void> {
    console.log(`[SELF-EVOLVE] Auto-committing: "${plan.title}" (low/low)`);

    // Apply patches to working tree
    for (const patch of plan.patches) {
      if (patch.action === "delete") {
        await this.ghExec(["rm", "-f", patch.file]);
        continue;
      }
      if (patch.content) {
        const fullPath = path.resolve(patch.file);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, patch.content, "utf8");
      }
    }

    // Stage and commit
    const files = plan.patches.map((p) => p.file);
    await this.gitExec(["add", ...files]);

    const commitMsg = `self-evolve(auto): ${plan.title}\n\nPlan: ${plan.id}\nSource: ${plan.opportunity.source}\nGovernance: auto-commit (low priority, low impact)`;
    const result = await this.gitExec(["commit", "-m", commitMsg]);

    // Extract commit SHA from output
    const shaMatch = result.stdout.match(/\[[\w/]+ ([a-f0-9]+)\]/);
    plan.commitSha = shaMatch?.[1] ?? "unknown";
    plan.status = "auto-committed";

    console.log(`[SELF-EVOLVE] Auto-committed: ${plan.commitSha}`);
  }

  // ─── PR Creation (medium/high) ────────────────────────────

  private async createPR(plan: EvolutionPlan): Promise<void> {
    const branchName = `${this.config.branchPrefix}/${plan.id}`;
    console.log(`[SELF-EVOLVE] Creating PR: "${plan.title}" on branch ${branchName}`);

    // Create branch
    await this.gitExec(["checkout", "-b", branchName]);

    try {
      // Apply patches
      for (const patch of plan.patches) {
        if (patch.action === "delete") {
          await this.gitExec(["rm", "-f", patch.file]);
          continue;
        }
        if (patch.content) {
          const fullPath = path.resolve(patch.file);
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, patch.content, "utf8");
        }
      }

      // Stage and commit
      const files = plan.patches.map((p) => p.file);
      await this.gitExec(["add", ...files]);

      const commitMsg = `self-evolve: ${plan.title}\n\nPlan: ${plan.id}\nSource: ${plan.opportunity.source}\nPriority: ${plan.opportunity.priority}\nImpact: ${plan.opportunity.impact}`;
      await this.gitExec(["commit", "-m", commitMsg]);

      // Push branch
      await this.gitExec(["push", "-u", "origin", branchName]);

      // Create PR via gh CLI
      const prBody = [
        "## Self-Evolution PR",
        "",
        `**Source:** ${plan.opportunity.source}`,
        `**Priority:** ${plan.opportunity.priority}`,
        `**Impact:** ${plan.opportunity.impact}`,
        `**Governance:** PR required (human review)`,
        "",
        "### Description",
        plan.description,
        "",
        "### Opportunity",
        plan.opportunity.description,
        plan.opportunity.suggestedFix
          ? `\n**Suggested fix:** ${plan.opportunity.suggestedFix}`
          : "",
        "",
        "### Changes",
        ...plan.patches.map((p) => `- \`${p.file}\`: ${p.action}${p.diff ? ` — ${p.diff}` : ""}`),
        "",
        "---",
        `*Auto-generated by Alpha Self-Evolution Engine*`,
        `*Plan ID: \`${plan.id}\`*`,
      ].join("\n");

      const prResult = await this.ghExec([
        "pr",
        "create",
        "--title",
        `self-evolve: ${plan.title}`,
        "--body",
        prBody,
        "--base",
        this.config.baseBranch,
        "--head",
        branchName,
      ]);

      // Parse PR URL from gh output
      const prUrl = prResult.stdout.trim();
      plan.prUrl = prUrl;

      // Extract PR number from URL
      const prNumMatch = prUrl.match(/\/pull\/(\d+)/);
      plan.prNumber = prNumMatch ? parseInt(prNumMatch[1], 10) : undefined;
      plan.status = "pr-opened";

      console.log(`[SELF-EVOLVE] PR created: ${prUrl}`);
    } finally {
      // Return to base branch
      await this.gitExec(["checkout", this.config.baseBranch]).catch(() => {});
    }
  }

  // ─── Query ────────────────────────────────────────────────

  getOpportunities(): EvolutionOpportunity[] {
    return [...this.opportunities];
  }

  getPlans(): EvolutionPlan[] {
    return [...this.plans];
  }

  getPendingPlans(): EvolutionPlan[] {
    return this.plans.filter((p) => p.status === "planned");
  }

  getPlan(planId: string): EvolutionPlan | undefined {
    return this.plans.find((p) => p.id === planId);
  }

  getStats(): SelfEvolveStats {
    return {
      totalOpportunities: this.opportunities.length,
      totalPlans: this.plans.length,
      autoCommitted: this.plans.filter((p) => p.status === "auto-committed").length,
      prsOpened: this.plans.filter((p) => p.status === "pr-opened").length,
      prsMerged: this.plans.filter((p) => p.status === "merged").length,
      prsRejected: this.plans.filter((p) => p.status === "rejected").length,
      pending: this.plans.filter((p) => p.status === "planned").length,
    };
  }

  // ─── Persistence ──────────────────────────────────────────

  private async loadState(): Promise<void> {
    try {
      const stateFile = path.join(this.config.stateDir, "self-evolve-state.json");
      const data = await fs.readFile(stateFile, "utf8");
      const parsed = JSON.parse(data);
      this.plans = parsed.plans ?? [];
      this.opportunities = parsed.opportunities ?? [];
      console.log(
        `[SELF-EVOLVE] Loaded ${this.plans.length} plans, ${this.opportunities.length} opportunities`,
      );
    } catch {
      // Fresh start
    }
  }

  private async saveState(): Promise<void> {
    try {
      const stateFile = path.join(this.config.stateDir, "self-evolve-state.json");
      await fs.writeFile(
        stateFile,
        JSON.stringify(
          {
            plans: this.plans.slice(-200), // keep last 200
            opportunities: this.opportunities.slice(-500),
            savedAt: Date.now(),
          },
          null,
          2,
        ),
      );
    } catch (err) {
      console.error("[SELF-EVOLVE] Failed to save state:", err);
    }
  }

  // ─── Shell Helpers ────────────────────────────────────────

  private async gitExec(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync("git", args, {
      cwd: process.cwd(),
      timeout: 30_000,
    });
  }

  private async ghExec(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return execFileAsync("gh", args, {
      cwd: process.cwd(),
      timeout: 60_000,
    });
  }

  private generateId(prefix: string): string {
    return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  }

  // ─── Shutdown ─────────────────────────────────────────────

  async shutdown(): Promise<void> {
    await this.saveState();
    console.log("[SELF-EVOLVE] Shutdown complete");
  }
}

// ─── Singleton ──────────────────────────────────────────────

let instance: SelfEvolver | null = null;

export function getSelfEvolver(config?: Partial<SelfEvolverConfig>): SelfEvolver {
  if (!instance) {
    instance = new SelfEvolver(config);
  }
  return instance;
}

export function shutdownSelfEvolver(): void {
  if (instance) {
    instance.shutdown().catch(() => {});
    instance = null;
  }
}
