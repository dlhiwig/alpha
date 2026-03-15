/**
 * Telemetry Module
 * 
 * Per-run records for fallback executions.
 * Enables: TUI Tasks view, cost dashboards, debugging "why did it choose X?"
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface TelemetryOptions {
  enabled?: boolean;
  dir?: string; // default: data/runs (relative to package root)
}

export interface FallbackAttemptRecord {
  provider: string;
  model?: string;
  startedAt: number;
  durationMs: number;
  outcome: 'success' | 'failed' | 'skipped';  // Clean enum
  errorClass?: string;
  errorMessage?: string;
  estCostUsd?: number;
  // Validation attributes (separate from outcome)
  validated?: boolean;        // Was validator used?
  repairAttempted?: boolean;  // Did we try to repair?
  repaired?: boolean;         // repairAttempted AND succeeded?
}

export interface FallbackRunRecord {
  id: string;
  plan: string;
  createdAt: number;
  promptHash: string;
  promptChars: number;
  jsonMode: boolean;
  attempts: FallbackAttemptRecord[];
  winner?: { provider: string; model?: string };
  totalMs: number;
  estCostUsd?: number;
  validatorUsed?: boolean;
  repairAttempted?: boolean;
}

/**
 * Generate a unique run ID
 */
export function makeRunId(): string {
  return crypto.randomUUID();
}

/**
 * Hash prompt for deduplication/grouping
 */
export function hashPrompt(prompt: string): string {
  return crypto.createHash('sha256').update(prompt).digest('hex').slice(0, 16);
}

/**
 * Get default telemetry directory
 */
function getDefaultTelemetryDir(): string {
  // Relative to package root (two levels up from src/swarm/)
  return path.join(__dirname, '..', '..', 'data', 'runs');
}

/**
 * Write a run record to disk
 * Never throws - telemetry should not break execution
 */
export async function writeRunRecord(
  rec: FallbackRunRecord,
  opts?: TelemetryOptions
): Promise<void> {
  if (!opts?.enabled) {return;}
  
  try {
    const dir = opts.dir ?? getDefaultTelemetryDir();
    await fs.mkdir(dir, { recursive: true });
    
    const filename = `${rec.createdAt}-${rec.id}.json`;
    const filepath = path.join(dir, filename);
    
    await fs.writeFile(filepath, JSON.stringify(rec, null, 2), 'utf8');
  } catch (err) {
    // Silently ignore telemetry write failures
    console.error('[telemetry] Failed to write run record:', err);
  }
}

/**
 * List recent run records
 */
export async function listRunRecords(
  opts?: { dir?: string; limit?: number }
): Promise<FallbackRunRecord[]> {
  const dir = opts?.dir ?? getDefaultTelemetryDir();
  const limit = opts?.limit ?? 100;
  
  try {
    const files = await fs.readdir(dir);
    const jsonFiles = files
      .filter(f => f.endsWith('.json'))
      .toSorted()
      .toReversed()
      .slice(0, limit);
    
    const records: FallbackRunRecord[] = [];
    for (const file of jsonFiles) {
      try {
        const content = await fs.readFile(path.join(dir, file), 'utf8');
        records.push(JSON.parse(content));
      } catch {
        // Skip corrupted files
      }
    }
    
    return records;
  } catch {
    return [];
  }
}

/**
 * Estimate cost for a provider call (rough estimates)
 * These are ballpark figures - adjust based on actual pricing
 */
export function estimateCost(
  provider: string,
  model: string | undefined,
  inputTokens: number,
  outputTokens: number
): number {
  // Costs per 1M tokens (input/output)
  const pricing: Record<string, { input: number; output: number }> = {
    claude: { input: 3.0, output: 15.0 },      // Sonnet
    gemini: { input: 0.075, output: 0.30 },    // Flash
    codex: { input: 2.5, output: 10.0 },       // GPT-4o
    ollama: { input: 0, output: 0 },           // Free (local)
  };
  
  const rates = pricing[provider] ?? pricing.claude;
  const inputCost = (inputTokens / 1_000_000) * rates.input;
  const outputCost = (outputTokens / 1_000_000) * rates.output;
  
  return inputCost + outputCost;
}
