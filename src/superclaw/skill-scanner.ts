/**
 * SkillScanner — Security scanner for the skill marketplace.
 *
 * Inspects agent‑skill folders (SKILL.md, scripts/, references/) for
 * prompt injection, malicious scripts, credential harvesting, network
 * exfiltration, dependency confusion, and privilege escalation patterns.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type FindingCategory =
  | "prompt-injection"
  | "malicious-script"
  | "dependency-confusion"
  | "credential-harvesting"
  | "network-exfiltration"
  | "privilege-escalation";

export interface Finding {
  severity: Severity;
  category: FindingCategory;
  file: string;
  line: number;
  description: string;
  evidence: string;
}

export interface ScanResult {
  safe: boolean;
  findings: Finding[];
  riskScore: number; // 0-100
  recommendation: "ALLOW" | "REVIEW" | "BLOCK";
}

// ─── Pattern definitions ──────────────────────────────────────────────────────

interface RulePattern {
  pattern: RegExp;
  severity: Severity;
  category: FindingCategory;
  description: string;
}

/** Patterns matched against SKILL.md and other markdown/txt files. */
const PROMPT_INJECTION_PATTERNS: RulePattern[] = [
  {
    pattern: /ignore\s+(all\s+)?previous\s+instructions/i,
    severity: "critical",
    category: "prompt-injection",
    description: "Prompt injection: attempts to override prior instructions",
  },
  {
    pattern: /forget\s+(all\s+)?(your|previous|prior)\s+(instructions|rules|guidelines)/i,
    severity: "critical",
    category: "prompt-injection",
    description: "Prompt injection: instruction erasure attempt",
  },
  {
    pattern: /you\s+are\s+now\s+(a|an|the)\s+/i,
    severity: "high",
    category: "prompt-injection",
    description: "Prompt injection: role confusion / identity override",
  },
  {
    pattern: /system\s*prompt\s*[:=]/i,
    severity: "critical",
    category: "prompt-injection",
    description: "Prompt injection: system prompt override attempt",
  },
  {
    pattern: /\[system\]/i,
    severity: "high",
    category: "prompt-injection",
    description: "Prompt injection: system tag injection",
  },
  {
    pattern: /<!--[\s\S]*?(instruction|ignore|override|inject|secret|hidden)/i,
    severity: "high",
    category: "prompt-injection",
    description: "Hidden instructions inside HTML/markdown comments",
  },
  {
    pattern: /<\s*script[\s>]/i,
    severity: "high",
    category: "prompt-injection",
    description: "HTML script tag in markdown (potential XSS / injection)",
  },
  {
    pattern: /do\s+not\s+(tell|reveal|disclose|mention)\s+(the\s+)?(user|human)/i,
    severity: "high",
    category: "prompt-injection",
    description: "Prompt injection: covert instruction to hide information from user",
  },
  {
    pattern: /act\s+as\s+(if\s+)?(you\s+)?(are|were)\s+/i,
    severity: "medium",
    category: "prompt-injection",
    description: "Prompt injection: behavioral override attempt",
  },
  {
    pattern: /pretend\s+(you\s+)?(are|were|to\s+be)\s+/i,
    severity: "medium",
    category: "prompt-injection",
    description: "Prompt injection: identity pretense attack",
  },
  {
    pattern: /\bDAN\b.*\bjailbreak/i,
    severity: "critical",
    category: "prompt-injection",
    description: "Known jailbreak pattern (DAN)",
  },
  {
    pattern: /bypass\s+(safety|content|security)\s+(filter|guardrail|restriction)/i,
    severity: "critical",
    category: "prompt-injection",
    description: "Prompt injection: safety bypass attempt",
  },
];

/** Patterns matched against scripts and code files. */
const MALICIOUS_SCRIPT_PATTERNS: RulePattern[] = [
  {
    pattern: /curl\s+.*\|\s*(ba)?sh/i,
    severity: "critical",
    category: "malicious-script",
    description: "Piping remote content directly to shell execution",
  },
  {
    pattern: /wget\s+.*\|\s*(ba)?sh/i,
    severity: "critical",
    category: "malicious-script",
    description: "Piping remote download directly to shell execution",
  },
  {
    pattern: /\brm\s+(-rf|-fr|--recursive)\s+[\/~]/,
    severity: "critical",
    category: "malicious-script",
    description: "Destructive recursive delete on root or home directory",
  },
  {
    pattern: /\bdd\s+.*of=\/dev\//,
    severity: "critical",
    category: "malicious-script",
    description: "Direct device write — potential disk wipe",
  },
  {
    pattern: /\bmkfs\b/,
    severity: "critical",
    category: "malicious-script",
    description: "Filesystem format command detected",
  },
  {
    pattern: /\/dev\/(tcp|udp)\//,
    severity: "critical",
    category: "malicious-script",
    description: "Reverse shell via /dev/tcp or /dev/udp",
  },
  {
    pattern: /\bnc\s+(-[a-z]*\s+)*-[a-z]*e\s/i,
    severity: "critical",
    category: "malicious-script",
    description: "Netcat reverse shell (-e flag)",
  },
  {
    pattern: /\bsocat\b.*\bexec\b/i,
    severity: "critical",
    category: "malicious-script",
    description: "Socat reverse shell pattern",
  },
  {
    pattern: /python[23]?\s+-c\s+.*socket/i,
    severity: "critical",
    category: "malicious-script",
    description: "Python reverse shell via socket",
  },
  {
    pattern: /\bbase64\s+(-d|--decode)/i,
    severity: "medium",
    category: "malicious-script",
    description: "Base64 decode — may hide malicious payload",
  },
  {
    pattern: /\beval\s*\(\s*(atob|Buffer\.from|base64)/i,
    severity: "high",
    category: "malicious-script",
    description: "Eval of decoded payload — obfuscated execution",
  },
  {
    pattern: /\/etc\/passwd/,
    severity: "high",
    category: "malicious-script",
    description: "Accessing /etc/passwd — potential credential harvesting",
  },
  {
    pattern: /\/etc\/shadow/,
    severity: "critical",
    category: "malicious-script",
    description: "Accessing /etc/shadow — password hash theft",
  },
  {
    pattern: /\bxmrig\b|\bcpuminer\b|\bminerd\b|\bcgminer\b|stratum\+tcp/i,
    severity: "critical",
    category: "malicious-script",
    description: "Cryptocurrency miner detected",
  },
  {
    pattern: /\b(fork|while\s+true)\s*.*\bfork\b/i,
    severity: "high",
    category: "malicious-script",
    description: "Fork bomb pattern",
  },
  {
    pattern: /:\(\)\{\s*:\|:&\s*\};:/,
    severity: "critical",
    category: "malicious-script",
    description: "Bash fork bomb",
  },
];

const DEPENDENCY_CONFUSION_PATTERNS: RulePattern[] = [
  {
    pattern: /npm\s+install\s+.*--registry\s+http:/i,
    severity: "high",
    category: "dependency-confusion",
    description: "npm install from insecure HTTP registry",
  },
  {
    pattern: /pip\s+install\s+.*--index-url\s+http:/i,
    severity: "high",
    category: "dependency-confusion",
    description: "pip install from insecure HTTP index",
  },
  {
    pattern: /pip\s+install\s+.*--extra-index-url/i,
    severity: "medium",
    category: "dependency-confusion",
    description: "pip install with extra index — dependency confusion risk",
  },
  {
    pattern: /npm\s+install\s+.*\b(lod[a4]sh|re[a4]ct|expr[e3]ss|ax[i1]os|chalk[0-9]|web[pb]ack[0-9])\b/i,
    severity: "high",
    category: "dependency-confusion",
    description: "Possible typosquat of popular npm package",
  },
  {
    pattern: /pip\s+install\s+.*\b(reqeusts|requestes|requ[e3]sts-[a-z]+|djang0|fl[a4]sk)\b/i,
    severity: "high",
    category: "dependency-confusion",
    description: "Possible typosquat of popular pip package",
  },
  {
    pattern: /npm\s+install\s+.*--ignore-scripts\s*=?\s*false/i,
    severity: "medium",
    category: "dependency-confusion",
    description: "Explicitly enabling npm install scripts — may run arbitrary code",
  },
];

const CREDENTIAL_HARVESTING_PATTERNS: RulePattern[] = [
  {
    pattern: /\$\{?\b(API_KEY|SECRET_KEY|ACCESS_TOKEN|AUTH_TOKEN|PRIVATE_KEY|AWS_SECRET|OPENAI_API_KEY|ANTHROPIC_API_KEY|GITHUB_TOKEN)\b\}?/i,
    severity: "high",
    category: "credential-harvesting",
    description: "Accessing sensitive environment variable",
  },
  {
    pattern: /process\.env\[?['"](API|SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL|AUTH)/i,
    severity: "high",
    category: "credential-harvesting",
    description: "Reading sensitive process.env variable",
  },
  {
    pattern: /\bcat\s+.*\.env\b/,
    severity: "high",
    category: "credential-harvesting",
    description: "Reading .env file — credential exfiltration",
  },
  {
    pattern: /\bdotenv\b.*\bparse\b/i,
    severity: "medium",
    category: "credential-harvesting",
    description: "Parsing .env file programmatically",
  },
  {
    pattern: /~\/\.ssh\/(id_rsa|id_ed25519|authorized_keys|config)/,
    severity: "critical",
    category: "credential-harvesting",
    description: "Accessing SSH private keys or config",
  },
  {
    pattern: /\/\.ssh\//,
    severity: "high",
    category: "credential-harvesting",
    description: "Accessing .ssh directory",
  },
  {
    pattern: /\bkeychain\b.*\bfind-(generic|internet)-password/i,
    severity: "critical",
    category: "credential-harvesting",
    description: "macOS Keychain credential extraction",
  },
  {
    pattern: /security\s+find-(generic|internet)-password/i,
    severity: "critical",
    category: "credential-harvesting",
    description: "macOS security CLI credential extraction",
  },
  {
    pattern: /\b(credential|password)\s*store/i,
    severity: "medium",
    category: "credential-harvesting",
    description: "Accessing credential or password store",
  },
  {
    pattern: /~\/\.aws\/(credentials|config)/,
    severity: "critical",
    category: "credential-harvesting",
    description: "Accessing AWS credentials file",
  },
  {
    pattern: /~\/\.config\/(gcloud|gh)\//,
    severity: "high",
    category: "credential-harvesting",
    description: "Accessing cloud CLI credentials",
  },
];

const NETWORK_EXFILTRATION_PATTERNS: RulePattern[] = [
  {
    pattern: /curl\s+(-[a-zA-Z]*\s+)*(-X\s+POST|--data|--data-binary|-d\s)/i,
    severity: "high",
    category: "network-exfiltration",
    description: "HTTP POST with data — possible exfiltration",
  },
  {
    pattern: /curl\s+.*\$\(/,
    severity: "high",
    category: "network-exfiltration",
    description: "Curl with command substitution — dynamic exfiltration",
  },
  {
    pattern: /\bfetch\s*\(\s*['"`]https?:\/\//,
    severity: "medium",
    category: "network-exfiltration",
    description: "Outbound HTTP fetch to external URL",
  },
  {
    pattern: /\baxios\.(post|put|patch)\s*\(/i,
    severity: "medium",
    category: "network-exfiltration",
    description: "Outbound HTTP request via axios",
  },
  {
    pattern: /\bwebhook\b/i,
    severity: "medium",
    category: "network-exfiltration",
    description: "Webhook reference — potential data exfiltration channel",
  },
  {
    pattern: /\bnslookup\b.*\$|dig\s+.*\$|\bhost\s+.*\$/,
    severity: "high",
    category: "network-exfiltration",
    description: "DNS lookup with variable — DNS tunneling pattern",
  },
  {
    pattern: /\.burpcollaborator\.net|\.interact\.sh|\.oastify\.com|\.requestbin\.com/i,
    severity: "critical",
    category: "network-exfiltration",
    description: "Known exfiltration / callback domain detected",
  },
  {
    pattern: /\b(nc|ncat|netcat)\s+(-[a-z]*\s+)*[\d.]+\s+\d+/i,
    severity: "high",
    category: "network-exfiltration",
    description: "Netcat connection to external host — data exfiltration risk",
  },
  {
    pattern: /\btelegram\.org\/bot|api\.telegram/i,
    severity: "high",
    category: "network-exfiltration",
    description: "Telegram bot API — common C2 / exfil channel",
  },
  {
    pattern: /discord(app)?\.com\/(api|webhooks)\//i,
    severity: "high",
    category: "network-exfiltration",
    description: "Discord webhook/API — common exfil channel",
  },
];

const PRIVILEGE_ESCALATION_PATTERNS: RulePattern[] = [
  {
    pattern: /\bsudo\s+/,
    severity: "high",
    category: "privilege-escalation",
    description: "sudo command — privilege escalation",
  },
  {
    pattern: /\bchmod\s+777\b/,
    severity: "high",
    category: "privilege-escalation",
    description: "chmod 777 — world-writable permissions",
  },
  {
    pattern: /\bchmod\s+[u+]*s\b|\bchmod\s+[0-7]*[4-7][0-7]{2}\b.*\bsetuid\b/i,
    severity: "critical",
    category: "privilege-escalation",
    description: "setuid/setgid bit — privilege escalation",
  },
  {
    pattern: /\bchmod\s+[46][0-7]{3}\b/,
    severity: "high",
    category: "privilege-escalation",
    description: "Setting setuid/setgid bit on file",
  },
  {
    pattern: /\bchown\s+root\b/,
    severity: "high",
    category: "privilege-escalation",
    description: "Changing file ownership to root",
  },
  {
    pattern: /\bdocker\s+run\s+.*--privileged/i,
    severity: "critical",
    category: "privilege-escalation",
    description: "Docker privileged mode — container escape risk",
  },
  {
    pattern: /\bdocker\s+run\s+.*-v\s+\/:/i,
    severity: "critical",
    category: "privilege-escalation",
    description: "Docker root filesystem mount — container escape",
  },
  {
    pattern: /\/proc\/self\/(mem|environ|exe)/,
    severity: "critical",
    category: "privilege-escalation",
    description: "Accessing /proc/self — process introspection / escape",
  },
  {
    pattern: /nsenter\s+/i,
    severity: "critical",
    category: "privilege-escalation",
    description: "nsenter — namespace escape / container breakout",
  },
  {
    pattern: /\bcapsh\b|\bsetcap\b|\bgetcap\b/i,
    severity: "high",
    category: "privilege-escalation",
    description: "Linux capabilities manipulation — privilege escalation",
  },
  {
    pattern: /\/var\/run\/docker\.sock/,
    severity: "critical",
    category: "privilege-escalation",
    description: "Docker socket access — full host control",
  },
  {
    pattern: /\bcrontab\s+/i,
    severity: "medium",
    category: "privilege-escalation",
    description: "Crontab modification — persistence mechanism",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SCRIPT_EXTENSIONS = new Set([
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".py",
  ".rb",
  ".pl",
  ".js",
  ".ts",
  ".mjs",
  ".cjs",
  ".ps1",
  ".bat",
  ".cmd",
]);

const MARKDOWN_EXTENSIONS = new Set([".md", ".mdx", ".markdown", ".txt", ".rst"]);

function isScript(filePath: string): boolean {
  return SCRIPT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isMarkdown(filePath: string): boolean {
  return MARKDOWN_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/** Recursively collect files under a directory (sync, fine for skill-sized dirs). */
function collectFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip node_modules / .git
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      results.push(...collectFiles(full));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

/** Severity → numeric weight for risk score calculation. */
const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 25,
  high: 15,
  medium: 8,
  low: 3,
  info: 1,
};

// ─── Scanner ──────────────────────────────────────────────────────────────────

export class SkillScanner {
  /**
   * Scan a skill directory for security issues.
   *
   * @param skillDir - Absolute or relative path to the skill folder.
   * @returns ScanResult with findings, risk score, and recommendation.
   */
  async scanSkill(skillDir: string): Promise<ScanResult> {
    const resolvedDir = path.resolve(skillDir);
    if (!fs.existsSync(resolvedDir)) {
      throw new Error(`Skill directory does not exist: ${resolvedDir}`);
    }

    const files = collectFiles(resolvedDir);
    const findings: Finding[] = [];

    for (const filePath of files) {
      const relPath = path.relative(resolvedDir, filePath);
      let content: string;
      try {
        content = fs.readFileSync(filePath, "utf-8");
      } catch {
        // Binary file or permission denied — skip
        continue;
      }

      const lines = content.split("\n");

      // Choose pattern sets based on file type
      const patternSets: RulePattern[][] = [];

      if (isMarkdown(filePath)) {
        patternSets.push(PROMPT_INJECTION_PATTERNS);
      }

      // Scripts and code get all code-level checks
      if (isScript(filePath)) {
        patternSets.push(
          MALICIOUS_SCRIPT_PATTERNS,
          DEPENDENCY_CONFUSION_PATTERNS,
          CREDENTIAL_HARVESTING_PATTERNS,
          NETWORK_EXFILTRATION_PATTERNS,
          PRIVILEGE_ESCALATION_PATTERNS,
        );
      }

      // SKILL.md also gets code-level checks since it may contain fenced code blocks
      if (filePath.endsWith("SKILL.md")) {
        patternSets.push(
          MALICIOUS_SCRIPT_PATTERNS,
          DEPENDENCY_CONFUSION_PATTERNS,
          CREDENTIAL_HARVESTING_PATTERNS,
          NETWORK_EXFILTRATION_PATTERNS,
          PRIVILEGE_ESCALATION_PATTERNS,
        );
      }

      // All files get network exfil + credential checks (could be config, yaml, etc.)
      if (!isMarkdown(filePath) && !isScript(filePath)) {
        patternSets.push(
          CREDENTIAL_HARVESTING_PATTERNS,
          NETWORK_EXFILTRATION_PATTERNS,
          MALICIOUS_SCRIPT_PATTERNS,
          PRIVILEGE_ESCALATION_PATTERNS,
        );
      }

      // Deduplicate pattern sets
      const seenPatterns = new Set<RulePattern>();
      const allPatterns: RulePattern[] = [];
      for (const set of patternSets) {
        for (const rule of set) {
          if (!seenPatterns.has(rule)) {
            seenPatterns.add(rule);
            allPatterns.push(rule);
          }
        }
      }

      // Scan each line
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const rule of allPatterns) {
          if (rule.pattern.test(line)) {
            findings.push({
              severity: rule.severity,
              category: rule.category,
              file: relPath,
              line: i + 1, // 1-indexed
              description: rule.description,
              evidence: line.trim().slice(0, 200), // Cap evidence length
            });
          }
        }
      }
    }

    // Calculate risk score (0-100)
    const rawScore = findings.reduce((sum, f) => sum + SEVERITY_WEIGHT[f.severity], 0);
    const riskScore = Math.min(100, rawScore);

    // Determine recommendation
    const hasCritical = findings.some((f) => f.severity === "critical");
    const hasHigh = findings.some((f) => f.severity === "high");

    let recommendation: ScanResult["recommendation"];
    if (hasCritical || riskScore >= 60) {
      recommendation = "BLOCK";
    } else if (hasHigh || riskScore >= 25) {
      recommendation = "REVIEW";
    } else {
      recommendation = "ALLOW";
    }

    return {
      safe: findings.length === 0,
      findings,
      riskScore,
      recommendation,
    };
  }
}
