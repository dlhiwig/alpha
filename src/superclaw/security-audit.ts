// @ts-nocheck
/**
 * src/superclaw/security-audit.ts
 * `alpha security audit [--deep] [--fix] [--json]`
 *
 * Comprehensive security audit for Alpha SuperClaw gateway.
import { execSync } from "node:child_process";
 * Inspired by HyperClaw's audit pattern, extended with SuperClaw-specific
 * governance checks (SKYNET thresholds, MOLTBOOK, safety floor).
 *
 * Categories:
 *   - File Permissions (credentials, config dirs)
 *   - Secret Exposure (keys in AGENTS.md, MEMORY.md, TOOLS.md, .gitignore)
 *   - Authentication (gateway auth token strength/presence)
 *   - Network Exposure (bind address, proxy config)
 *   - DM Policy (open DMs, empty allowlists, wildcard)
 *   - Tool Blast Radius (exec policy, elevated mode, sandbox)
 *   - Session Isolation (dmScope, session sharing)
 *   - SuperClaw Governance (SKYNET thresholds, safety floor, financial gates)
 *   - Token Quality (entropy analysis — deep scan)
 */

import { readFileSync, existsSync, statSync, chmodSync, readdirSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { homedir } from "node:os";

// ─── Types ──────────────────────────────────────────────────

export interface SecurityFinding {
  checkId: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: string;
  title: string;
  detail: string;
  remediation: string;
  cvss?: number;
  autofix?: () => void;
}

export interface AuditResult {
  mode: "standard" | "deep";
  timestamp: string;
  total: number;
  summary: Record<string, number>;
  findings: Omit<SecurityFinding, "autofix">[];
}

// ─── Config detection ───────────────────────────────────────

function getAlphaDir(): string {
  return process.env.ALPHA_STATE_DIR || join(homedir(), ".alpha");
}

function getConfigPath(): string {
  return join(getAlphaDir(), "alpha.json");
}

function getWorkspaceDir(): string {
  return process.env.ALPHA_WORKSPACE || join(getAlphaDir(), "workspace");
}

function loadConfig(): Record<string, any> | null {
  try {
    return JSON.parse(readFileSync(getConfigPath(), "utf8"));
  } catch {
    return null;
  }
}

// ─── Check: File Permissions ────────────────────────────────

function checkFilePermissions(): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const alphaDir = getAlphaDir();

  const sensitiveFiles = [
    getConfigPath(),
    join(alphaDir, "auth.json"),
    join(alphaDir, ".env"),
  ];

  for (const f of sensitiveFiles) {
    if (existsSync(f)) {
      const stat = statSync(f);
      if ((stat.mode & 0o077) !== 0) {
        findings.push({
          checkId: "creds-permissions",
          severity: "high",
          category: "File Permissions",
          title: `Unsafe permissions on ${basename(f)}`,
          detail: `Mode ${(stat.mode & 0o777).toString(8)} allows group/other read`,
          remediation: `chmod 600 ${f}`,
          cvss: 7.5,
          autofix: () => chmodSync(f, 0o600),
        });
      }
    }
  }

  const credsDir = join(alphaDir, "credentials");
  if (existsSync(credsDir)) {
    const stat = statSync(credsDir);
    if ((stat.mode & 0o077) !== 0) {
      findings.push({
        checkId: "creds-dir-permissions",
        severity: "critical",
        category: "File Permissions",
        title: "credentials/ directory is world-readable",
        detail: `Mode ${(stat.mode & 0o777).toString(8)} — all credential files are exposed`,
        remediation: `chmod 700 ${credsDir}`,
        cvss: 9.1,
        autofix: () => chmodSync(credsDir, 0o700),
      });
    }
  }

  // Config directory itself
  if (existsSync(alphaDir)) {
    const stat = statSync(alphaDir);
    if ((stat.mode & 0o077) !== 0) {
      findings.push({
        checkId: "config-dir-permissions",
        severity: "high",
        category: "File Permissions",
        title: `${alphaDir} directory is group/world readable`,
        detail: `Mode ${(stat.mode & 0o777).toString(8)} — config accessible to other users`,
        remediation: `chmod 700 ${alphaDir}`,
        cvss: 6.5,
        autofix: () => chmodSync(alphaDir, 0o700),
      });
    }
  }

  // .gitignore checks
  const repoRoot = resolve(join(alphaDir, ".."));
  const gitignorePath = join(repoRoot, ".gitignore");
  if (existsSync(gitignorePath)) {
    const gi = readFileSync(gitignorePath, "utf8");
    if (!gi.includes(".env")) {
      findings.push({
        checkId: "gitignore-env",
        severity: "high",
        category: "Secret Exposure",
        title: ".env is not in .gitignore",
        detail: "Environment files with secrets may be committed to git",
        remediation: 'echo ".env" >> .gitignore',
        cvss: 8.1,
      });
    }
    if (!gi.includes("credentials/")) {
      findings.push({
        checkId: "gitignore-creds",
        severity: "high",
        category: "Secret Exposure",
        title: "credentials/ is not in .gitignore",
        detail: "Credential files may be committed to git",
        remediation: 'echo "credentials/" >> .gitignore',
        cvss: 8.1,
      });
    }
  }

  return findings;
}

// ─── Check: Gateway Config ──────────────────────────────────

function checkGatewayConfig(): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const cfg = loadConfig();
  if (!cfg) return findings;

  // Auth token
  const token = cfg.gateway?.authToken;
  if (!token) {
    findings.push({
      checkId: "gateway-auth-missing",
      severity: "critical",
      category: "Authentication",
      title: "Gateway auth token not set",
      detail: "Any client can connect to the gateway without authentication",
      remediation: "Set gateway.authToken in alpha.json (min 32 chars, random hex)",
      cvss: 9.8,
    });
  } else if (token.length < 32) {
    findings.push({
      checkId: "auth-token-strength",
      severity: "high",
      category: "Authentication",
      title: "Gateway auth token is too short",
      detail: `Token is ${token.length} chars — minimum recommended is 32`,
      remediation: "Regenerate with: node -e 'console.log(require(\"crypto\").randomBytes(32).toString(\"hex\"))'",
      cvss: 7.3,
    });
  }

  // Network binding
  const bind = cfg.gateway?.bind ?? cfg.gateway?.host;
  if (bind === "0.0.0.0") {
    findings.push({
      checkId: "gateway-bind-all",
      severity: "medium",
      category: "Network Exposure",
      title: "Gateway bound to all interfaces (0.0.0.0)",
      detail: "Gateway is accessible from the local network. Ensure auth token is strong.",
      remediation: 'Set gateway.bind: "127.0.0.1" unless LAN access is required',
      cvss: 5.3,
    });
  }

  // DM policies
  const channels = cfg.channels ?? cfg.channelConfigs ?? {};
  for (const [ch, chCfg] of Object.entries(channels)) {
    if (typeof chCfg !== "object" || chCfg === null) continue;
    const policy = (chCfg as any)?.dmPolicy ?? (chCfg as any)?.dm?.policy;

    if (policy === "open") {
      findings.push({
        checkId: `dm-policy-open-${ch}`,
        severity: "high",
        category: "DM Policy",
        title: `DM policy is "open" on ${ch}`,
        detail: "Anyone can send DMs to your agent — prompt injection risk",
        remediation: `Set channels.${ch}.dmPolicy: "pairing" or "allowlist"`,
        cvss: 7.1,
      });
    }

    if (policy === "allowlist") {
      const allowFrom = (chCfg as any)?.allowFrom ?? [];
      if (Array.isArray(allowFrom) && allowFrom.length === 0) {
        findings.push({
          checkId: `allowlist-empty-${ch}`,
          severity: "medium",
          category: "DM Policy",
          title: `Empty allowlist on ${ch} — DMs silently dropped`,
          detail: "Nobody can reach your agent on this channel",
          remediation: `Add authorized users to channels.${ch}.allowFrom`,
          cvss: 4.0,
        });
      }
      if (Array.isArray(allowFrom) && allowFrom.includes("*")) {
        findings.push({
          checkId: `allowlist-wildcard-${ch}`,
          severity: "high",
          category: "DM Policy",
          title: `Wildcard (*) in allowFrom on ${ch}`,
          detail: 'allowFrom: ["*"] is equivalent to open DMs',
          remediation: `Remove "*" and add specific users`,
          cvss: 7.1,
        });
      }
    }

    // Group requireMention
    const groups = (chCfg as any)?.groups ?? {};
    for (const [gid, gCfg] of Object.entries(groups)) {
      if ((gCfg as any)?.requireMention === false) {
        findings.push({
          checkId: `group-mention-off-${ch}-${gid}`,
          severity: "medium",
          category: "Group Policy",
          title: `requireMention disabled in ${ch} group ${gid}`,
          detail: "Bot responds to ALL messages — max prompt injection surface",
          remediation: `Set channels.${ch}.groups.${gid}.requireMention: true`,
          cvss: 5.3,
        });
      }
    }
  }

  // Session isolation
  const dmScope = cfg.session?.dmScope;
  if (!dmScope || dmScope === "global") {
    findings.push({
      checkId: "session-dmscope-global",
      severity: "low",
      category: "Session Isolation",
      title: 'session.dmScope is "global" — shared context across users',
      detail: "All DMs share one session. If multiple people DM your bot, use per-channel-peer.",
      remediation: 'Set session.dmScope: "per-channel-peer"',
      cvss: 3.5,
    });
  }

  // Tool blast radius
  const execSecurity = cfg.tools?.exec?.security;
  if (execSecurity === "full" || execSecurity === "allow") {
    findings.push({
      checkId: "exec-allow-no-ask",
      severity: "high",
      category: "Tool Blast Radius",
      title: `tools.exec.security is "${execSecurity}" — unrestricted shell access`,
      detail: "Any agent turn can run arbitrary shell commands",
      remediation: 'Set tools.exec.security: "allowlist" or "deny"',
      cvss: 8.5,
    });
  }

  const elevated = cfg.tools?.elevated;
  if (elevated?.enabled === true) {
    findings.push({
      checkId: "elevated-enabled",
      severity: "medium",
      category: "Tool Blast Radius",
      title: "Elevated exec is enabled",
      detail: "Allows running commands on gateway host from chat",
      remediation: "Ensure tools.elevated.allowFrom is tightly scoped",
      cvss: 6.0,
    });
  }

  return findings;
}

// ─── Check: Secrets in Prompt Files ─────────────────────────

function checkSecretsInPrompts(): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  const secretPatterns: { pattern: RegExp; name: string }[] = [
    { pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/, name: "Anthropic API key" },
    { pattern: /sk-proj-[a-zA-Z0-9_-]{20,}/, name: "OpenAI API key" },
    { pattern: /sk-[a-zA-Z0-9]{20,}/, name: "Generic sk- API key" },
    { pattern: /xai-[a-zA-Z0-9]{20,}/, name: "xAI/Grok API key" },
    { pattern: /AIzaSy[a-zA-Z0-9_-]{33}/, name: "Google/Gemini API key" },
    { pattern: /ghp_[a-zA-Z0-9]{36}/, name: "GitHub PAT" },
    { pattern: /nvapi-[a-zA-Z0-9_-]{20,}/, name: "NVIDIA NIM API key" },
    { pattern: /pplx-[a-zA-Z0-9]{20,}/, name: "Perplexity API key" },
    { pattern: /BSA[a-zA-Z0-9]{20,}/, name: "Brave Search API key" },
    { pattern: /sk_[a-f0-9]{40,}/, name: "ElevenLabs API key" },
  ];

  const alphaDir = getAlphaDir();
  const wsDir = getWorkspaceDir();

  const filesToScan = [
    join(wsDir, "AGENTS.md"),
    join(wsDir, "MEMORY.md"),
    join(wsDir, "TOOLS.md"),
    join(wsDir, "SOUL.md"),
    join(wsDir, "USER.md"),
    getConfigPath(),
  ];

  for (const f of filesToScan) {
    if (!existsSync(f)) continue;
    let content: string;
    try {
      content = readFileSync(f, "utf8");
    } catch {
      continue;
    }

    for (const { pattern, name } of secretPatterns) {
      if (pattern.test(content)) {
        findings.push({
          checkId: "key-in-prompt-file",
          severity: "critical",
          category: "Secret Exposure",
          title: `${name} found in ${basename(f)}`,
          detail: `Pattern matching ${name} detected in plaintext file. Secrets in prompt-injected files = exfiltration risk.`,
          remediation: `Remove the key from ${basename(f)} and use environment variables instead`,
          cvss: 9.1,
        });
      }
    }
  }

  return findings;
}

// ─── Check: SuperClaw Governance ────────────────────────────

function checkSuperClawGovernance(): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const cfg = loadConfig();
  if (!cfg) return findings;

  const sc = cfg.superclaw ?? cfg.skynet ?? {};

  // SKYNET thresholds
  const thresholds = sc.thresholds ?? {};

  if (!thresholds.maxConcurrentAgents || thresholds.maxConcurrentAgents > 20) {
    findings.push({
      checkId: "skynet-max-agents-high",
      severity: "medium",
      category: "SuperClaw Governance",
      title: `maxConcurrentAgents is ${thresholds.maxConcurrentAgents ?? "unlimited"}`,
      detail: "High agent concurrency increases cost and resource exhaustion risk",
      remediation: "Set superclaw.thresholds.maxConcurrentAgents: 10 (or lower)",
      cvss: 4.5,
    });
  }

  if (!thresholds.dailySpendLimit) {
    findings.push({
      checkId: "skynet-no-spend-limit",
      severity: "high",
      category: "SuperClaw Governance",
      title: "No daily spend limit configured",
      detail: "Without a cap, runaway agents can accumulate unbounded API costs",
      remediation: "Set superclaw.thresholds.dailySpendLimit (e.g., 50)",
      cvss: 7.0,
    });
  }

  if (!thresholds.requireApprovalAbove && thresholds.requireApprovalAbove !== 0) {
    findings.push({
      checkId: "skynet-no-approval-gate",
      severity: "medium",
      category: "SuperClaw Governance",
      title: "No financial approval gate",
      detail: "Expensive operations proceed without human review",
      remediation: "Set superclaw.thresholds.requireApprovalAbove (e.g., 25)",
      cvss: 5.0,
    });
  }

  // Safety floor
  const safety = sc.safety ?? sc.adaptiveSafety ?? {};
  if (safety.allowAutoRelax === true) {
    findings.push({
      checkId: "skynet-auto-relax-enabled",
      severity: "critical",
      category: "SuperClaw Governance",
      title: "Safety auto-relaxation is ENABLED",
      detail: "Agents can autonomously lower safety constraints. This was deleted in v0.1.0-hardened.",
      remediation: "Set superclaw.safety.allowAutoRelax: false (ImmutableSafetyFloor)",
      cvss: 9.5,
    });
  }

  // Self-evolution without PR review
  const evolve = sc.selfEvolve ?? {};
  if (evolve.autoMerge === true && !evolve.requirePR) {
    findings.push({
      checkId: "skynet-evolve-no-pr",
      severity: "high",
      category: "SuperClaw Governance",
      title: "Self-evolution auto-merges without PR review",
      detail: "Agents can modify their own code and auto-merge without human oversight",
      remediation: "Set superclaw.selfEvolve.requirePR: true for medium+ changes",
      cvss: 8.0,
    });
  }

  return findings;
}

// ─── Deep scan: Token entropy ───────────────────────────────

function estimateEntropy(str: string): number {
  const freq = new Map<string, number>();
  for (const ch of str) freq.set(ch, (freq.get(ch) || 0) + 1);
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / str.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function deepScan(): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const cfg = loadConfig();
  if (!cfg) return findings;

  // Token entropy
  const token = cfg.gateway?.authToken;
  if (token) {
    const entropy = estimateEntropy(token);
    if (entropy < 3.5) {
      findings.push({
        checkId: "auth-token-low-entropy",
        severity: "high",
        category: "Token Quality",
        title: "Gateway auth token has low entropy",
        detail: `Estimated entropy: ${entropy.toFixed(2)} bits/char — token may be guessable`,
        remediation: "Regenerate with: node -e 'console.log(require(\"crypto\").randomBytes(32).toString(\"hex\"))'",
        cvss: 6.5,
      });
    }
  }

  // Check all .json files in alpha dir for leaked secrets
  const alphaDir = getAlphaDir();
  if (existsSync(alphaDir)) {
    try {
      const files = readdirSync(alphaDir).filter((f) => f.endsWith(".json"));
      for (const f of files) {
        const content = readFileSync(join(alphaDir, f), "utf8");
        // Look for common API key patterns in config files
        if (/password|secret|token/i.test(f) === false) {
          // Only flag if keys appear in non-obvious places
          const hasAnthropicKey = /sk-ant-[a-zA-Z0-9_-]{20,}/.test(content);
          const hasOpenAIKey = /sk-proj-[a-zA-Z0-9_-]{20,}/.test(content);
          if (hasAnthropicKey || hasOpenAIKey) {
            findings.push({
              checkId: `key-in-config-${f}`,
              severity: "medium",
              category: "Secret Exposure",
              title: `API key found in ${f}`,
              detail: "API keys in config files may be exposed if config is shared or committed",
              remediation: "Move API keys to environment variables",
              cvss: 5.5,
            });
          }
        }
      }
    } catch {
      // Can't read dir
    }
  }

  // Check UFW firewall status
  try {
    // execSync imported at top
    const ufwStatus = execSync("ufw status 2>/dev/null", { encoding: "utf8" });
    if (ufwStatus.includes("Status: inactive")) {
      findings.push({
        checkId: "firewall-inactive",
        severity: "medium",
        category: "Network Security",
        title: "UFW firewall is inactive",
        detail: "No host firewall is running — all ports are exposed",
        remediation: "sudo ufw enable && sudo ufw default deny incoming",
        cvss: 5.0,
      });
    }
  } catch {
    // UFW not available — not a finding
  }

  return findings;
}

// ─── Severity ordering ──────────────────────────────────────

const SEVERITY_ORDER: SecurityFinding["severity"][] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];

// ─── Main entry point ───────────────────────────────────────

export function runSecurityAudit(opts: {
  deep?: boolean;
  fix?: boolean;
  json?: boolean;
} = {}): AuditResult {
  const { deep = false, fix = false, json = false } = opts;

  const allFindings: SecurityFinding[] = [
    ...checkFilePermissions(),
    ...checkGatewayConfig(),
    ...checkSecretsInPrompts(),
    ...checkSuperClawGovernance(),
    ...(deep ? deepScan() : []),
  ];

  // Sort by severity
  allFindings.sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
  );

  // Auto-fix if requested
  let fixedCount = 0;
  if (fix) {
    for (const f of allFindings) {
      if (f.autofix) {
        try {
          f.autofix();
          fixedCount++;
        } catch {
          // Log but continue
        }
      }
    }
  }

  // Build summary
  const summary = SEVERITY_ORDER.reduce(
    (acc, sev) => {
      acc[sev] = allFindings.filter((f) => f.severity === sev).length;
      return acc;
    },
    {} as Record<string, number>
  );

  const result: AuditResult = {
    mode: deep ? "deep" : "standard",
    timestamp: new Date().toISOString(),
    total: allFindings.length,
    summary,
    findings: allFindings.map(({ autofix: _af, ...f }) => f),
  };

  // Console output (non-JSON mode)
  if (!json) {
    console.log("\n  🔐 ALPHA SUPERCLAW SECURITY AUDIT\n");
    console.log(`  Mode: ${deep ? "DEEP SCAN" : "standard (use --deep for full scan)"}\n`);

    if (allFindings.length === 0) {
      console.log("  ✔  No security issues found!\n");
    } else {
      const severityIcon: Record<string, string> = {
        critical: "🔴",
        high: "🟠",
        medium: "🟡",
        low: "🔵",
        info: "⚪",
      };

      for (const f of allFindings) {
        const icon = severityIcon[f.severity] ?? "⚪";
        const cvss = f.cvss ? ` (CVSS ${f.cvss})` : "";
        console.log(`  ${icon} ${f.severity.toUpperCase()}${cvss}  ${f.title}  [${f.checkId}]`);
        console.log(`     Category: ${f.category}`);
        console.log(`     ${f.detail}`);

        if (fix && f.autofix) {
          console.log("     ✔ Auto-fixed");
        } else {
          console.log(`     Fix: ${f.remediation}`);
        }
        console.log();
      }

      console.log(
        `  Summary: ${summary.critical} CRITICAL | ${summary.high} high | ` +
          `${summary.medium} medium | ${summary.low} low\n`
      );

      if (fix && fixedCount > 0) {
        console.log(`  ✔ ${fixedCount} issue(s) auto-fixed\n`);
      }
    }
  }

  return result;
}

// ─── CLI entry ──────────────────────────────────────────────

const isMainModule =
  typeof import.meta?.url === "string" &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  const args = process.argv.slice(2);
  const deep = args.includes("--deep");
  const fix = args.includes("--fix");
  const json = args.includes("--json");

  const result = runSecurityAudit({ deep, fix, json });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  }

  // Exit with non-zero if critical or high findings
  if (result.summary.critical > 0 || result.summary.high > 0) {
    process.exit(1);
  }
}
