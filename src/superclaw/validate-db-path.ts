/**
 * SQLite Path Validation — CVE fix for path injection (CVSS 8.1)
 *
 * Prevents arbitrary file creation/corruption by validating that
 * any SQLite database path is confined within the expected state directory.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ─── Security Error ──────────────────────────────────────────

export class SecurityError extends Error {
  readonly code = "SECURITY_DB_PATH_INJECTION";
  constructor(message: string) {
    super(message);
    this.name = "SecurityError";
  }
}

// ─── Allowed extensions ──────────────────────────────────────

const ALLOWED_EXTENSIONS = new Set([".db", ".sqlite", ".sqlite3"]);

// ─── Validation ──────────────────────────────────────────────

/**
 * Validate and resolve a database path, ensuring it is a safe child
 * of the given `stateDir`.
 *
 * @param dbPath   - Requested database file path (relative or absolute)
 * @param stateDir - The trusted parent directory that must contain the DB
 * @param label    - Human-readable label for audit logs (e.g. "skynet-audit")
 * @returns The validated absolute path
 * @throws {SecurityError} if the path escapes stateDir, is a symlink, has
 *         a forbidden extension, or the parent dir has wrong permissions.
 */
export function validateDbPath(
  dbPath: string,
  stateDir: string,
  label = "database",
): string {
  // 1. Reject raw input containing `..` path components
  if (dbPath.includes("..")) {
    throw new SecurityError(
      `[${label}] dbPath contains '..' component — path traversal rejected: ${dbPath}`,
    );
  }

  // 2. Resolve to absolute
  const resolvedState = path.resolve(stateDir);
  const resolvedDb = path.resolve(resolvedState, dbPath);

  // 3. Verify the resolved path is a child of stateDir
  const relative = path.relative(resolvedState, resolvedDb);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new SecurityError(
      `[${label}] dbPath escapes stateDir — resolved to "${resolvedDb}" which is outside "${resolvedState}"`,
    );
  }

  // 4. Check extension
  const ext = path.extname(resolvedDb).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new SecurityError(
      `[${label}] dbPath has disallowed extension "${ext}" — must be one of: ${[...ALLOWED_EXTENSIONS].join(", ")}`,
    );
  }

  // 5. Reject symlinks (check the file itself if it exists)
  if (fs.existsSync(resolvedDb)) {
    const stat = fs.lstatSync(resolvedDb);
    if (stat.isSymbolicLink()) {
      throw new SecurityError(
        `[${label}] dbPath "${resolvedDb}" is a symbolic link — rejected`,
      );
    }
  }

  // 6. Ensure parent directory exists with secure permissions
  const parentDir = path.dirname(resolvedDb);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true, mode: 0o700 });
  } else {
    // Verify parent is a real directory (not a symlink)
    const parentStat = fs.lstatSync(parentDir);
    if (parentStat.isSymbolicLink()) {
      throw new SecurityError(
        `[${label}] parent directory "${parentDir}" is a symbolic link — rejected`,
      );
    }
    // Tighten permissions if too open (owner-only)
    const mode = parentStat.mode & 0o777;
    if (mode & 0o077) {
      try {
        fs.chmodSync(parentDir, 0o700);
      } catch {
        // Non-fatal — log but continue (may not own the dir)
        console.warn(
          `[SECURITY][${label}] Could not tighten permissions on "${parentDir}" (current: ${mode.toString(8)})`,
        );
      }
    }
  }

  return resolvedDb;
}

/**
 * Resolve the effective dbPath from optional user config, applying
 * full validation. Logs an audit warning when a non-default path is used.
 *
 * @param userDbPath   - User-supplied dbPath (may be undefined)
 * @param stateDir     - Trusted state directory
 * @param defaultName  - Default filename (e.g. "skynet-audit.db")
 * @param label        - Audit label
 */
export function resolveAndValidateDbPath(
  userDbPath: string | undefined,
  stateDir: string,
  defaultName: string,
  label = "database",
): string {
  const defaultPath = path.join(stateDir, defaultName);
  const requested = userDbPath ?? defaultPath;

  // Audit log: non-default path requested
  if (userDbPath && path.resolve(stateDir, userDbPath) !== path.resolve(defaultPath)) {
    console.warn(
      `[SECURITY AUDIT][${label}] Non-default dbPath requested: "${userDbPath}" (default: "${defaultName}")`,
    );
  }

  return validateDbPath(requested, stateDir, label);
}
