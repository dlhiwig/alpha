/**
 * Secure State Directory Resolution
 *
 * CVE FIX: Prevents path traversal via HOME environment poisoning.
 * os.homedir() reads $HOME, which can be attacker-controlled in containers
 * or malicious environments. This module provides hardened alternatives.
 *
 * @module secure-state
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ─── Constants ───────────────────────────────────────────────

/** Hardcoded secure default — never derived from environment */
const DEFAULT_STATE_BASE = "/home/toba/.alpha";

/** Directories that must never be used as state roots */
const FORBIDDEN_PREFIXES = [
  "/tmp",
  "/proc",
  "/sys",
  "/dev",
  "/etc",
  "/boot",
  "/sbin",
  "/bin",
  "/usr/sbin",
  "/usr/bin",
  "/var/run",
  "/run",
  "/root",
];

// ─── Validation ──────────────────────────────────────────────

/**
 * Validate a candidate state path is safe to use.
 *
 * Checks:
 *  - Must be absolute
 *  - No `..` path components (after normalization)
 *  - Not under any forbidden system directory
 *  - Not a symlink (if it already exists)
 *  - Under an allowed parent (at least 2 components deep, e.g. /home/user/...)
 */
export function validateStatePath(p: string): boolean {
  // Must be absolute
  if (!path.isAbsolute(p)) return false;

  // Normalize to resolve any . or redundant separators (but NOT ..)
  const normalized = path.normalize(p);

  // Reject if normalization changed structure in a way that indicates traversal
  // path.normalize resolves ".." so check the original for literal ".."
  if (p.includes("..")) return false;

  // Also verify the normalized path has no ".." (belt and suspenders)
  const parts = normalized.split(path.sep).filter(Boolean);
  if (parts.some((part) => part === "..")) return false;

  // Must be at least 3 levels deep (e.g., /home/user/something)
  if (parts.length < 3) return false;

  // Check forbidden prefixes
  for (const forbidden of FORBIDDEN_PREFIXES) {
    const normalizedForbidden = path.normalize(forbidden);
    if (
      normalized === normalizedForbidden ||
      normalized.startsWith(normalizedForbidden + path.sep)
    ) {
      return false;
    }
  }

  // If the path already exists, reject symlinks
  try {
    const lstat = fs.lstatSync(normalized);
    if (lstat.isSymbolicLink()) return false;
  } catch {
    // Path doesn't exist yet — that's fine
  }

  return true;
}

/**
 * Verify directory ownership matches current process uid.
 * Returns true if the directory is owned by us, false otherwise.
 */
function verifyOwnership(dirPath: string): boolean {
  try {
    const stat = fs.statSync(dirPath);
    return stat.uid === process.getuid!();
  } catch {
    return false;
  }
}

// ─── Resolution ──────────────────────────────────────────────

/**
 * Resolve a secure state directory, immune to HOME poisoning.
 *
 * Priority:
 *  1. `SUPERCLAW_STATE_DIR` env var (if set AND passes validation)
 *  2. `ALPHA_STATE_DIR` env var (if set AND passes validation)
 *  3. Hardcoded default: `/home/toba/.alpha`
 *
 * After resolution:
 *  - Creates directory with mode 0o700 if missing
 *  - Verifies ownership matches current user
 *
 * @throws Error if the resolved directory fails ownership check
 */
export function resolveSecureStateDir(): string {
  let resolved: string | null = null;

  // Try SUPERCLAW_STATE_DIR first
  const superclawDir = process.env.SUPERCLAW_STATE_DIR;
  if (superclawDir && validateStatePath(superclawDir)) {
    resolved = path.normalize(superclawDir);
  }

  // Try ALPHA_STATE_DIR second
  if (!resolved) {
    const alphaDir = process.env.ALPHA_STATE_DIR;
    if (alphaDir && validateStatePath(alphaDir)) {
      resolved = path.normalize(alphaDir);
    }
  }

  // Fall back to hardcoded default
  if (!resolved) {
    resolved = DEFAULT_STATE_BASE;
  }

  // Ensure directory exists with restrictive permissions
  if (!fs.existsSync(resolved)) {
    fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
  }

  // Verify ownership (skip on Windows where getuid doesn't exist)
  if (typeof process.getuid === "function" && !verifyOwnership(resolved)) {
    throw new Error(
      `[SECURE-STATE] Directory ${resolved} is not owned by current user (uid=${process.getuid()}). ` +
        `Refusing to use potentially compromised state directory.`,
    );
  }

  return resolved;
}

/**
 * Resolve a secure sub-path within the state directory.
 * Validates the final path doesn't escape the state root.
 *
 * @param subPath - Relative path segments under the state dir (e.g., "memory", "shared.sqlite")
 * @returns Absolute validated path
 * @throws Error if the resulting path escapes the state root
 */
export function resolveSecureStatePath(...subPath: string[]): string {
  const stateDir = resolveSecureStateDir();
  const joined = path.join(stateDir, ...subPath);
  const normalized = path.normalize(joined);

  // Ensure the resolved path is actually under stateDir (no breakout)
  if (!normalized.startsWith(stateDir + path.sep) && normalized !== stateDir) {
    throw new Error(
      `[SECURE-STATE] Path breakout detected: ${normalized} is not under ${stateDir}`,
    );
  }

  return normalized;
}
