/**
 * 🧠 SKYNET EWC++ (Elastic Weight Consolidation)
 * 
 * Prevents catastrophic forgetting when learning new patterns.
 * Based on Ruflo's EWC++ implementation.
 * 
 * When ORACLE learns new patterns, EWC++ ensures old successful
 * patterns aren't overwritten. Uses Fisher Information Matrix to
 * identify which "weights" (pattern associations) are important.
 * 
 * @see https://arxiv.org/abs/1612.00796 (Original EWC paper)
 * @see Ruflo's implementation for agent systems
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

// --- Types ---

export interface PatternWeight {
  id: string;
  pattern: string;
  weight: number;           // Importance score (0-1)
  fisherInfo: number;       // Fisher Information (how critical to preserve)
  lastUsed: number;         // Timestamp
  successCount: number;     // Times pattern led to success
  failCount: number;        // Times pattern led to failure
  consolidated: boolean;    // True if marked as "don't forget"
}

export interface EWCConfig {
  /** Lambda parameter - how much to penalize changes to important weights */
  lambda: number;
  /** Minimum Fisher Information to consider a pattern important */
  fisherThreshold: number;
  /** How often to consolidate (ms) */
  consolidationIntervalMs: number;
  /** Path to persist weights */
  persistPath: string;
  /** Max patterns to track */
  maxPatterns: number;
}

export interface ConsolidationResult {
  patternsAnalyzed: number;
  patternsConsolidated: number;
  patternsPruned: number;
  topPatterns: PatternWeight[];
}

// --- Default Config ---

const DEFAULT_CONFIG: EWCConfig = {
  lambda: 0.4,                    // Moderate penalty for changing important weights
  fisherThreshold: 0.3,           // Patterns with Fisher > 0.3 are important
  consolidationIntervalMs: 3600000, // Consolidate every hour
  persistPath: './data/ewc-weights.json',
  maxPatterns: 10000,
};

// --- EWC++ Service ---

export class EWCPlusPlus extends EventEmitter {
  private config: EWCConfig;
  private patterns: Map<string, PatternWeight> = new Map();
  private consolidationTimer?: NodeJS.Timeout;
  private initialized = false;

  constructor(config: Partial<EWCConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize EWC++ - load persisted patterns
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load persisted patterns
    await this.loadPatterns();

    // Start consolidation timer
    this.consolidationTimer = setInterval(
      () => this.consolidate(),
      this.config.consolidationIntervalMs
    );

    this.initialized = true;
    this.emit('initialized', { patternCount: this.patterns.size });
  }

  /**
   * Record a pattern outcome (success or failure)
   */
  recordOutcome(pattern: string, success: boolean): void {
    const id = this.hashPattern(pattern);
    let weight = this.patterns.get(id);

    if (!weight) {
      weight = {
        id,
        pattern,
        weight: 0.5,          // Start neutral
        fisherInfo: 0,
        lastUsed: Date.now(),
        successCount: 0,
        failCount: 0,
        consolidated: false,
      };
      this.patterns.set(id, weight);
    }

    // Update counts
    if (success) {
      weight.successCount++;
      weight.weight = Math.min(1, weight.weight + 0.05);
    } else {
      weight.failCount++;
      weight.weight = Math.max(0, weight.weight - 0.03);
    }

    weight.lastUsed = Date.now();

    // Recalculate Fisher Information
    this.updateFisherInfo(weight);

    this.emit('outcome', { pattern, success, weight: weight.weight });
  }

  /**
   * Check if a pattern should be preserved (don't overwrite)
   */
  shouldPreserve(pattern: string): boolean {
    const id = this.hashPattern(pattern);
    const weight = this.patterns.get(id);

    if (!weight) return false;

    // Preserve if consolidated OR high Fisher info
    return weight.consolidated || weight.fisherInfo > this.config.fisherThreshold;
  }

  /**
   * Get penalty for modifying a pattern (higher = don't change)
   */
  getModificationPenalty(pattern: string): number {
    const id = this.hashPattern(pattern);
    const weight = this.patterns.get(id);

    if (!weight) return 0;

    // EWC loss = lambda * Fisher * (new - old)^2
    // We return Fisher * lambda as the penalty coefficient
    return this.config.lambda * weight.fisherInfo;
  }

  /**
   * Run consolidation - identify important patterns to preserve
   */
  async consolidate(): Promise<ConsolidationResult> {
    const patterns = Array.from(this.patterns.values());
    let consolidated = 0;
    let pruned = 0;

    for (const weight of patterns) {
      // Consolidate high-performing patterns
      if (
        weight.fisherInfo > this.config.fisherThreshold &&
        weight.successCount > 5 &&
        weight.weight > 0.7
      ) {
        weight.consolidated = true;
        consolidated++;
      }

      // Prune old, unused, low-value patterns
      const ageMs = Date.now() - weight.lastUsed;
      if (
        ageMs > 30 * 24 * 60 * 60 * 1000 && // 30 days old
        weight.weight < 0.3 &&
        !weight.consolidated
      ) {
        this.patterns.delete(weight.id);
        pruned++;
      }
    }

    // Enforce max patterns
    if (this.patterns.size > this.config.maxPatterns) {
      const toRemove = this.patterns.size - this.config.maxPatterns;
      const sortedByImportance = patterns
        .filter(p => !p.consolidated)
        .sort((a, b) => a.fisherInfo - b.fisherInfo);

      for (let i = 0; i < toRemove && i < sortedByImportance.length; i++) {
        this.patterns.delete(sortedByImportance[i].id);
        pruned++;
      }
    }

    // Persist
    await this.savePatterns();

    const result: ConsolidationResult = {
      patternsAnalyzed: patterns.length,
      patternsConsolidated: consolidated,
      patternsPruned: pruned,
      topPatterns: this.getTopPatterns(10),
    };

    this.emit('consolidated', result);
    return result;
  }

  /**
   * Get top patterns by importance
   */
  getTopPatterns(limit = 10): PatternWeight[] {
    return Array.from(this.patterns.values())
      .sort((a, b) => b.fisherInfo - a.fisherInfo)
      .slice(0, limit);
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalPatterns: number;
    consolidatedPatterns: number;
    avgWeight: number;
    avgFisher: number;
  } {
    const patterns = Array.from(this.patterns.values());
    const consolidated = patterns.filter(p => p.consolidated).length;
    const avgWeight = patterns.reduce((sum, p) => sum + p.weight, 0) / patterns.length || 0;
    const avgFisher = patterns.reduce((sum, p) => sum + p.fisherInfo, 0) / patterns.length || 0;

    return {
      totalPatterns: patterns.length,
      consolidatedPatterns: consolidated,
      avgWeight,
      avgFisher,
    };
  }

  /**
   * Shutdown - persist and cleanup
   */
  async shutdown(): Promise<void> {
    if (this.consolidationTimer) {
      clearInterval(this.consolidationTimer);
    }
    await this.savePatterns();
    this.emit('shutdown');
  }

  // --- Private Methods ---

  private updateFisherInfo(weight: PatternWeight): void {
    // Fisher Information approximation based on outcome variance
    // Higher success rate with more samples = higher Fisher
    const total = weight.successCount + weight.failCount;
    if (total < 2) {
      weight.fisherInfo = 0;
      return;
    }

    const successRate = weight.successCount / total;
    // Fisher = n * p * (1-p) for binomial, normalized
    const fisher = Math.sqrt(total) * successRate * (1 - successRate + 0.1);
    // Boost for high success rate
    const boost = successRate > 0.8 ? 1.5 : 1;
    
    weight.fisherInfo = Math.min(1, fisher * boost);
  }

  private hashPattern(pattern: string): string {
    // Simple hash for pattern ID
    let hash = 0;
    for (let i = 0; i < pattern.length; i++) {
      const char = pattern.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `pat_${Math.abs(hash).toString(36)}`;
  }

  private async loadPatterns(): Promise<void> {
    try {
      const data = fs.readFileSync(this.config.persistPath, 'utf-8');
      const parsed = JSON.parse(data) as PatternWeight[];
      for (const weight of parsed) {
        this.patterns.set(weight.id, weight);
      }
    } catch {
      // No existing file or invalid - start fresh
    }
  }

  private async savePatterns(): Promise<void> {
    const dir = path.dirname(this.config.persistPath);
    fs.mkdirSync(dir, { recursive: true });
    const data = Array.from(this.patterns.values());
    fs.writeFileSync(this.config.persistPath, JSON.stringify(data, null, 2));
  }
}

// --- Factory ---

let instance: EWCPlusPlus | null = null;

export function getEWC(config?: Partial<EWCConfig>): EWCPlusPlus {
  if (!instance) {
    instance = new EWCPlusPlus(config);
  }
  return instance;
}

export default EWCPlusPlus;
