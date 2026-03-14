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
import { resolveSecureStatePath } from "./secure-state.js";
import * as path from "node:path";
import { promisify } from "node:util";

import { sanitizeLLMOutput, safeCommitMessage } from "./sanitize.js";

const execFileAsync = promisify(execFile);

// ─── Security: CVE Mitigation — Path Injection → RCE ─────────

/**
 * Allowlist of directory prefixes permitted for self-evolution file operations.
 * Any file path outside these directories is rejected before it reaches git.
 *
 * CVE mitigation: prevents attackers from injecting paths like
 * `../../.git/hooks/pre-commit` to achieve arbitrary code execution.
 */
const PATH_ALLOWLIST: readonly string[] = ["src/", "docs/", "config/", "tests/"] as const;

/**
 * Directories that must NEVER be written to, regardless of allowlist.
 * Targets executable/workflow locations that could lead to RCE.
 */
const PATH_DENYLIST: readonly string[] = [
  ".git/hooks/",
  ".git/",
  ".github/workflows/",
  ".github/actions/",
  ".husky/",
  "node_modules/.bin/",
  "scripts/",
] as const;

/**
 * Security error thrown when path validation or git operation safety checks fail.
 * Distinguishes intentional security rejections from generic runtime errors.
 */
export class SecurityError extends Error {
  public readonly code = "SECURITY_PATH_VIOLATION";

  constructor(message: string) {
    super(message);
    this.name = "SecurityError";
  }
}

/**
 * Sanitize and validate a file path against traversal, symlink, and allowlist attacks.
 *
 * **CVE mitigation (CVSS 9.8):** The self-evolution engine receives `filePaths`
 * from `EvolutionOpportunity` objects which may originate from untrusted sources
 * (oracle patterns, external suggestions). Without sanitization, an attacker can
 * inject paths like `../../.git/hooks/pre-commit` to achieve arbitrary code
 * execution when the path is passed to `git add` / `git commit`.
 *
 * Checks performed:
 * 1. Rejects paths containing `..` segments (traversal)
 * 2. Resolves to absolute and verifies it stays under `baseDir`
 * 3. Rejects symlinks (prevents symlink-based escapes)
 * 4. Rejects paths targeting executable locations (`.git/hooks/`, workflows, etc.)
 * 5. Requires path falls under one of the `PATH_ALLOWLIST` prefixes
 *
 * @param filePath  - The untrusted path to validate
 * @param baseDir   - The repository root directory (paths must stay within)
 * @returns The sanitized absolute path
 * @throws {SecurityError} if any check fails
 */
export async function sanitizeFilePath(filePath: string, baseDir: string): Promise<string> {
  // 1. Reject path traversal sequences early (before any resolution)
  if (filePath.includes("..")) {
    throw new SecurityError(
      `Path traversal rejected: "${filePath}" contains ".." segment`,
    );
  }

  // 2. Resolve to absolute and verify containment
  const resolvedBase = path.resolve(baseDir);
  const resolved = path.resolve(resolvedBase, filePath);

  if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) {
    throw new SecurityError(
      `Path escape rejected: "${filePath}" resolves outside base directory "${resolvedBase}"`,
    );
  }

  // 3. Compute the relative path for allowlist / denylist checks
  const relative = path.relative(resolvedBase, resolved);

  // Normalize to forward slashes for consistent matching
  const relativeNorm = relative.replace(/\\/g, "/");

  // 4. Check denylist — reject executable / dangerous locations
  for (const denied of PATH_DENYLIST) {
    if (relativeNorm.startsWith(denied) || relativeNorm === denied.replace(/\/$/, "")) {
      throw new SecurityError(
        `Denied path rejected: "${filePath}" targets restricted location "${denied}"`,
      );
    }
  }

  // 5. Check allowlist — must be under a permitted prefix
  const allowed = PATH_ALLOWLIST.some((prefix) => relativeNorm.startsWith(prefix));
  if (!allowed) {
    throw new SecurityError(
      `Path not in allowlist: "${filePath}" (relative: "${relativeNorm}"). ` +
      `Permitted prefixes: ${PATH_ALLOWLIST.join(", ")}`,
    );
  }

  // 6. Check for symlinks (prevents symlink-based escapes)
  try {
    const stat = await fs.lstat(resolved);
    if (stat.isSymbolicLink()) {
      throw new SecurityError(
        `Symlink rejected: "${filePath}" is a symbolic link — potential escape vector`,
      );
    }
  } catch (err) {
    // File doesn't exist yet (new file creation) — that's OK, no symlink risk
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err; // Re-throw SecurityError or unexpected errors
    }
  }

  return resolved;
}

/**
 * Execute a git operation with mandatory path sanitization and allowlist enforcement.
 *
 * **CVE mitigation:** Wraps all git CLI invocations that accept file paths from
 * `EvolutionOpportunity` data. Every path is validated through `sanitizeFilePath()`
 * before being passed to `execFileAsync("git", ...)`.
 *
 * @param operation - Git sub-command (e.g., "add", "rm")
 * @param files     - Untrusted file paths to validate and pass to git
 * @param baseDir   - Repository root directory for containment checks
 * @param extraArgs - Additional git arguments (flags, NOT file paths)
 * @returns stdout/stderr from the git command
 * @throws {SecurityError} if any file path fails validation
 */
async function safeGitOperation(
  operation: string,
  files: string[],
  baseDir: string,
  extraArgs: string[] = [],
): Promise<{ stdout: string; stderr: string }> {
  if (files.length === 0) {
    throw new SecurityError("safeGitOperation called with no files");
  }

  // Sanitize every path — throws SecurityError on first violation
  const sanitizedPaths: string[] = [];
  for (const file of files) {
    const sanitized = await sanitizeFilePath(file, baseDir);
    sanitizedPaths.push(sanitized);
  }

  return execFileAsync("git", [operation, ...extraArgs, ...sanitizedPaths], {
    cwd: baseDir,
    timeout: 30_000,
  });
}

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
  stateDir: resolveSecureStatePath("self-evolve"),
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
        // CVE fix: sanitize LLM-generated recommendation at ingestion boundary
        description: sanitizeLLMOutput(insight.recommendation),
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
        // CVE fix: sanitize LLM-generated mistake text at ingestion boundary
        description: `Fix: ${sanitizeLLMOutput(mistake.pattern, 200)} — ${sanitizeLLMOutput(mistake.rootCause, 200)}`,
        suggestedFix: sanitizeLLMOutput(mistake.correction),
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
   *
   * **Security (CVE mitigation):** If `filePaths` are provided, each path
   * is validated through `sanitizeFilePath()` at registration time to
   * reject malicious paths early (fail-fast), before they enter the plan
   * pipeline.
   */
  async addOpportunity(
    description: string,
    opts: {
      priority?: RiskLevel;
      impact?: RiskLevel;
      suggestedFix?: string;
      filePaths?: string[];
    } = {},
  ): Promise<EvolutionOpportunity> {
    // Validate file paths at ingestion — fail fast on malicious input
    if (opts.filePaths && opts.filePaths.length > 0) {
      const baseDir = process.cwd();
      for (const fp of opts.filePaths) {
        await sanitizeFilePath(fp, baseDir);
      }
    }

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

  /**
   * Auto-commit low-risk changes directly to the working branch.
   *
   * **Security (CVE mitigation):** All file paths from `plan.patches` are
   * validated through `sanitizeFilePath()` before any filesystem or git
   * operation. Paths outside the allowlist or targeting executable locations
   * will throw `SecurityError` and abort the entire commit.
   */
  private async autoCommit(plan: EvolutionPlan): Promise<void> {
    console.log(`[SELF-EVOLVE] Auto-committing: "${plan.title}" (low/low)`);
    const baseDir = process.cwd();

    // Apply patches to working tree — sanitize every path first
    for (const patch of plan.patches) {
      const safePath = await sanitizeFilePath(patch.file, baseDir);

      if (patch.action === "delete") {
        await safeGitOperation("rm", [patch.file], baseDir, ["-f"]);
        continue;
      }
      if (patch.content) {
        await fs.mkdir(path.dirname(safePath), { recursive: true });
        await fs.writeFile(safePath, patch.content, "utf8");
      }
    }

    // Stage and commit via safe wrapper
    const files = plan.patches.map((p) => p.file);
    await safeGitOperation("add", files, baseDir);

    // CVE fix: sanitize LLM-derived title before interpolation into commit message
    const commitMsg = safeCommitMessage({
      type: "self-evolve",
      scope: "auto",
      description: plan.title,
    });
    const result = await this.gitExec(["commit", "-m", commitMsg]);

    // Extract commit SHA from output
    const shaMatch = result.stdout.match(/\[[\w/]+ ([a-f0-9]+)\]/);
    plan.commitSha = shaMatch?.[1] ?? "unknown";
    plan.status = "auto-committed";

    console.log(`[SELF-EVOLVE] Auto-committed: ${plan.commitSha}`);
  }

  // ─── PR Creation (medium/high) ────────────────────────────

  /**
   * Create a PR for medium/high-risk changes requiring human review.
   *
   * **Security (CVE mitigation):** All file paths from `plan.patches` are
   * validated through `sanitizeFilePath()` before any filesystem or git
   * operation. Paths outside the allowlist or targeting executable locations
   * will throw `SecurityError` and abort the PR creation.
   */
  private async createPR(plan: EvolutionPlan): Promise<void> {
    const branchName = `${this.config.branchPrefix}/${plan.id}`;
    console.log(`[SELF-EVOLVE] Creating PR: "${plan.title}" on branch ${branchName}`);
    const baseDir = process.cwd();

    // Create branch
    await this.gitExec(["checkout", "-b", branchName]);

    try {
      // Apply patches — sanitize every path first
      for (const patch of plan.patches) {
        const safePath = await sanitizeFilePath(patch.file, baseDir);

        if (patch.action === "delete") {
          await safeGitOperation("rm", [patch.file], baseDir, ["-f"]);
          continue;
        }
        if (patch.content) {
          await fs.mkdir(path.dirname(safePath), { recursive: true });
          await fs.writeFile(safePath, patch.content, "utf8");
        }
      }

      // Stage and commit via safe wrapper
      const files = plan.patches.map((p) => p.file);
      await safeGitOperation("add", files, baseDir);

      // CVE fix: sanitize LLM-derived title before interpolation into commit message
      const commitMsg = safeCommitMessage({
        type: "self-evolve",
        description: plan.title,
      });
      await this.gitExec(["commit", "-m", commitMsg]);

      // Push branch
      await this.gitExec(["push", "-u", "origin", branchName]);

      // Create PR via gh CLI — sanitize all LLM-derived content
      const safeDescription = sanitizeLLMOutput(plan.description, 2000);
      const safeOppDescription = sanitizeLLMOutput(plan.opportunity.description, 1000);
      const safeSuggestedFix = plan.opportunity.suggestedFix
        ? sanitizeLLMOutput(plan.opportunity.suggestedFix, 500)
        : "";
      const prBody = [
        "## Self-Evolution PR",
        "",
        `**Source:** ${plan.opportunity.source}`,
        `**Priority:** ${plan.opportunity.priority}`,
        `**Impact:** ${plan.opportunity.impact}`,
        `**Governance:** PR required (human review)`,
        "",
        "### Description",
        safeDescription,
        "",
        "### Opportunity",
        safeOppDescription,
        safeSuggestedFix
          ? `\n**Suggested fix:** ${safeSuggestedFix}`
          : "",
        "",
        "### Changes",
        ...plan.patches.map((p) => `- \`${sanitizeLLMOutput(p.file, 200)}\`: ${p.action}${p.diff ? ` — ${sanitizeLLMOutput(p.diff, 200)}` : ""}`),
        "",
        "---",
        `*Auto-generated by Alpha Self-Evolution Engine*`,
        `*Plan ID: \`${plan.id}\`*`,
      ].join("\n");

      // CVE fix: sanitize PR title (LLM-derived plan.title)
      const safePrTitle = `self-evolve: ${sanitizeLLMOutput(plan.title, 100)}`;
      const prResult = await this.ghExec([
        "pr",
        "create",
        "--title",
        safePrTitle,
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
