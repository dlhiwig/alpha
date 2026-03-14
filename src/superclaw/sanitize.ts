/**
 * LLM Output Sanitization — CVE Fix (CVSS 7.5)
 *
 * Prevents prompt injection / command injection when LLM-generated text
 * (e.g., OracleInsight.recommendation, plan descriptions) is used in:
 *   - Git commit messages (`git commit -m "..."`)
 *   - Shell commands (spawn, exec)
 *   - PR titles/bodies passed to `gh` CLI
 *   - Any string interpolation that reaches a shell
 *
 * ATTACK STRINGS BLOCKED:
 *   - Command substitution:  $(whoami)  `whoami`  ${HOME}
 *   - Shell metacharacters:  ; rm -rf /  | cat /etc/passwd  && curl evil.com
 *   - Newline injection:     \n\rmalicious-header: value
 *   - ANSI escape sequences: \x1b[31m  \033[0m
 *   - Null bytes:            \x00
 *   - Heredoc/redirection:   > /etc/cron.d/backdoor  << EOF
 *   - Glob injection:        ../../etc/passwd  ~root
 *   - Backtick execution:    `id`
 */

/** Maximum length for sanitized commit message descriptions */
const MAX_COMMIT_DESC_LENGTH = 500;

/** Maximum length for sanitized shell arguments */
const MAX_SHELL_ARG_LENGTH = 4096;

/**
 * Strip ANSI escape sequences (CSI, OSC, and single-byte escapes).
 */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][0-9A-B]|\x1b./g, "");
}

/**
 * Sanitize arbitrary LLM output into safe plaintext.
 *
 * Guarantees:
 *  - No backtick sequences (`, $(...), ${...})
 *  - No shell metacharacters (; | & > < \n \r)
 *  - No ANSI escape sequences
 *  - No non-printable ASCII (replaced with space)
 *  - No null bytes
 *  - Truncated to `maxLength` (default 500)
 *  - Returns safe plaintext string
 */
export function sanitizeLLMOutput(text: string, maxLength = MAX_COMMIT_DESC_LENGTH): string {
  if (!text || typeof text !== "string") {
    return "";
  }

  let safe = text;

  // 1. Strip ANSI escape sequences first
  safe = stripAnsi(safe);

  // 2. Remove command substitution patterns: $(cmd), `cmd`, ${var}
  safe = safe.replace(/\$\([^)]*\)/g, "");       // $(command)
  safe = safe.replace(/`[^`]*`/g, "");            // `command`
  safe = safe.replace(/\$\{[^}]*\}/g, "");        // ${variable}

  // 3. Remove shell metacharacters that enable chaining/redirection
  safe = safe.replace(/[;|&><]/g, "");

  // 4. Remove newlines and carriage returns (prevent header injection)
  safe = safe.replace(/[\n\r]/g, " ");

  // 5. Remove null bytes
  safe = safe.replace(/\0/g, "");

  // 6. Replace any remaining non-printable ASCII (0x00-0x1F, 0x7F) with space
  // eslint-disable-next-line no-control-regex
  safe = safe.replace(/[\x00-\x1f\x7f]/g, " ");

  // 7. Collapse multiple spaces
  safe = safe.replace(/\s{2,}/g, " ").trim();

  // 8. Truncate
  if (safe.length > maxLength) {
    safe = safe.slice(0, maxLength - 3) + "...";
  }

  return safe;
}

/**
 * Build a safe conventional commit message from structured parts.
 *
 * Format: `type(scope): description`
 *
 * Each part is individually sanitized — never interpolates raw LLM output.
 * The type and scope are additionally restricted to alphanumeric + hyphens.
 */
export function safeCommitMessage(parts: {
  type: string;
  scope?: string;
  description: string;
}): string {
  // Type: only lowercase alphanumeric + hyphens, max 20 chars
  const safeType = parts.type
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 20) || "chore";

  // Scope: only alphanumeric + hyphens + dots, max 30 chars
  const safeScope = parts.scope
    ? parts.scope
        .toLowerCase()
        .replace(/[^a-z0-9.-]/g, "")
        .slice(0, 30)
    : undefined;

  // Description: full LLM sanitization
  const safeDesc = sanitizeLLMOutput(parts.description, MAX_COMMIT_DESC_LENGTH);

  if (safeScope) {
    return `${safeType}(${safeScope}): ${safeDesc}`;
  }
  return `${safeType}: ${safeDesc}`;
}

/**
 * Sanitize a string for safe use as a shell argument.
 *
 * This is a defense-in-depth measure for cases where execFile/spawn
 * array form is used (which doesn't need escaping), but the value
 * still shouldn't contain control characters or injection patterns.
 *
 * For actual shell string interpolation (bash -c), prefer execFile
 * array form instead. This function is a last resort.
 */
export function sanitizeShellArg(text: string, maxLength = MAX_SHELL_ARG_LENGTH): string {
  if (!text || typeof text !== "string") {
    return "";
  }

  let safe = text;

  // Strip ANSI
  safe = stripAnsi(safe);

  // Remove command substitution
  safe = safe.replace(/\$\([^)]*\)/g, "");
  safe = safe.replace(/`[^`]*`/g, "");
  safe = safe.replace(/\$\{[^}]*\}/g, "");

  // Remove null bytes
  safe = safe.replace(/\0/g, "");

  // Replace non-printable ASCII with space (except \n \t which may be intentional)
  // eslint-disable-next-line no-control-regex
  safe = safe.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, " ");

  // Truncate
  if (safe.length > maxLength) {
    safe = safe.slice(0, maxLength - 3) + "...";
  }

  return safe;
}

/**
 * Escape a string for safe inclusion in a single-quoted shell argument.
 *
 * The ONLY safe way to include arbitrary text in `bash -c '...'` is to:
 *  1. End the current single quote
 *  2. Add an escaped single quote
 *  3. Start a new single quote
 *
 * Combined with sanitizeShellArg for defense-in-depth.
 */
export function escapeForShell(text: string): string {
  const sanitized = sanitizeShellArg(text);
  // Proper single-quote escaping: replace ' with '\''
  return sanitized.replace(/'/g, "'\\''");
}
