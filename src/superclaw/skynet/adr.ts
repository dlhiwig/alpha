/**
 * 📜 SKYNET Architecture Decision Records (ADR)
 * 
 * Tracks architectural decisions to prevent drift and maintain
 * consistency. Based on Ruflo's ADR pattern.
 * 
 * ADRs document:
 * - Context: Why we needed to decide
 * - Decision: What we decided
 * - Consequences: What this means going forward
 * - Status: Proposed → Accepted → Deprecated/Superseded
 * 
 * Benefits:
 * - Prevents re-litigating old decisions
 * - Onboards new agents/developers
 * - Tracks technical debt and evolution
 * - Provides audit trail
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

// --- Types ---

export type ADRStatus = 'proposed' | 'accepted' | 'deprecated' | 'superseded';

export interface ADR {
  id: string;
  number: number;
  title: string;
  status: ADRStatus;
  date: string;
  context: string;
  decision: string;
  consequences: string;
  tags: string[];
  supersededBy?: string;
  relatedTo?: string[];
  author: string;
  createdAt: number;
  updatedAt: number;
}

export interface ADRFilter {
  status?: ADRStatus | ADRStatus[];
  tags?: string[];
  search?: string;
  author?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface ADRConfig {
  /** Directory to store ADRs */
  adrPath: string;
  /** Prefix for ADR files */
  filePrefix: string;
  /** Template for new ADRs */
  template: string;
}

// --- Default Config ---

const DEFAULT_CONFIG: ADRConfig = {
  adrPath: './docs/adr',
  filePrefix: 'ADR-',
  template: `# ADR-{NUMBER}: {TITLE}

**Status:** {STATUS}
**Date:** {DATE}
**Author:** {AUTHOR}

## Context

{CONTEXT}

## Decision

{DECISION}

## Consequences

{CONSEQUENCES}

## Tags

{TAGS}
`,
};

// --- ADR Service ---

export class ADRService extends EventEmitter {
  private config: ADRConfig;
  private adrs: Map<string, ADR> = new Map();
  private initialized = false;

  constructor(config: Partial<ADRConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize ADR system - load existing ADRs
   */
  async initialize(): Promise<void> {
    if (this.initialized) {return;}

    // Ensure directory exists
    fs.mkdirSync(this.config.adrPath, { recursive: true });

    // Load existing ADRs
    await this.loadADRs();

    this.initialized = true;
    this.emit('initialized', { adrCount: this.adrs.size });
  }

  /**
   * Create a new ADR
   */
  create(params: {
    title: string;
    context: string;
    decision: string;
    consequences: string;
    tags?: string[];
    author?: string;
  }): ADR {
    const number = this.getNextNumber();
    const id = `${this.config.filePrefix}${String(number).padStart(4, '0')}`;
    const now = Date.now();

    const adr: ADR = {
      id,
      number,
      title: params.title,
      status: 'proposed',
      date: new Date().toISOString().split('T')[0],
      context: params.context,
      decision: params.decision,
      consequences: params.consequences,
      tags: params.tags || [],
      author: params.author || 'SKYNET',
      createdAt: now,
      updatedAt: now,
    };

    this.adrs.set(id, adr);
    this.saveADR(adr);

    this.emit('created', adr);
    return adr;
  }

  /**
   * Accept an ADR (transition from proposed)
   */
  accept(id: string): ADR | null {
    const adr = this.adrs.get(id);
    if (!adr || adr.status !== 'proposed') {return null;}

    adr.status = 'accepted';
    adr.updatedAt = Date.now();
    this.saveADR(adr);

    this.emit('accepted', adr);
    return adr;
  }

  /**
   * Deprecate an ADR
   */
  deprecate(id: string, reason?: string): ADR | null {
    const adr = this.adrs.get(id);
    if (!adr) {return null;}

    adr.status = 'deprecated';
    adr.updatedAt = Date.now();
    if (reason) {
      adr.consequences += `\n\n**Deprecation Reason:** ${reason}`;
    }
    this.saveADR(adr);

    this.emit('deprecated', adr);
    return adr;
  }

  /**
   * Supersede an ADR with a new one
   */
  supersede(oldId: string, newAdr: Parameters<typeof this.create>[0]): ADR | null {
    const oldAdr = this.adrs.get(oldId);
    if (!oldAdr) {return null;}

    // Create new ADR
    const created = this.create({
      ...newAdr,
      context: `This supersedes ${oldId}.\n\n${newAdr.context}`,
    });

    // Update old ADR
    oldAdr.status = 'superseded';
    oldAdr.supersededBy = created.id;
    oldAdr.updatedAt = Date.now();
    this.saveADR(oldAdr);

    // Link new to old
    created.relatedTo = [oldId];
    this.saveADR(created);

    this.emit('superseded', { old: oldAdr, new: created });
    return created;
  }

  /**
   * Get an ADR by ID
   */
  get(id: string): ADR | undefined {
    return this.adrs.get(id);
  }

  /**
   * List all ADRs with optional filtering
   */
  list(filter?: ADRFilter): ADR[] {
    let results = Array.from(this.adrs.values());

    if (filter) {
      // Filter by status
      if (filter.status) {
        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
        results = results.filter(adr => statuses.includes(adr.status));
      }

      // Filter by tags
      if (filter.tags && filter.tags.length > 0) {
        results = results.filter(adr =>
          filter.tags!.some(tag => adr.tags.includes(tag))
        );
      }

      // Filter by search term
      if (filter.search) {
        const search = filter.search.toLowerCase();
        results = results.filter(adr =>
          adr.title.toLowerCase().includes(search) ||
          adr.context.toLowerCase().includes(search) ||
          adr.decision.toLowerCase().includes(search)
        );
      }

      // Filter by author
      if (filter.author) {
        results = results.filter(adr => adr.author === filter.author);
      }

      // Filter by date range
      if (filter.dateFrom) {
        results = results.filter(adr => adr.date >= filter.dateFrom!);
      }
      if (filter.dateTo) {
        results = results.filter(adr => adr.date <= filter.dateTo!);
      }
    }

    // Sort by number descending (newest first)
    return results.toSorted((a, b) => b.number - a.number);
  }

  /**
   * Search for relevant ADRs
   */
  findRelevant(query: string): ADR[] {
    const keywords = query.toLowerCase().split(/\W+/).filter(w => w.length > 2);
    const scored: Array<{ adr: ADR; score: number }> = [];

    for (const adr of this.adrs.values()) {
      let score = 0;
      const text = `${adr.title} ${adr.context} ${adr.decision} ${adr.tags.join(' ')}`.toLowerCase();

      for (const keyword of keywords) {
        if (text.includes(keyword)) {
          score += 1;
        }
        if (adr.title.toLowerCase().includes(keyword)) {
          score += 2;  // Title matches worth more
        }
        if (adr.tags.some(t => t.toLowerCase().includes(keyword))) {
          score += 1.5;  // Tag matches
        }
      }

      if (score > 0) {
        scored.push({ adr, score });
      }
    }

    return scored
      .toSorted((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(s => s.adr);
  }

  /**
   * Check if a decision conflicts with existing ADRs
   */
  checkConflicts(decision: string): ADR[] {
    // Find accepted ADRs that might conflict
    const keywords = decision.toLowerCase().split(/\W+/).filter(w => w.length > 3);
    const conflicts: ADR[] = [];

    for (const adr of this.adrs.values()) {
      if (adr.status !== 'accepted') {continue;}

      const adrWords = `${adr.decision} ${adr.consequences}`.toLowerCase();

      // Look for opposing keywords
      const negations = ['not', 'never', 'avoid', 'don\'t', 'shouldn\'t', 'must not'];
      for (const keyword of keywords) {
        for (const neg of negations) {
          if (adrWords.includes(`${neg} ${keyword}`) || adrWords.includes(`${neg} use ${keyword}`)) {
            conflicts.push(adr);
            break;
          }
        }
      }
    }

    return conflicts;
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number;
    byStatus: Record<ADRStatus, number>;
    topTags: Array<{ tag: string; count: number }>;
    recentlyUpdated: ADR[];
  } {
    const adrs = Array.from(this.adrs.values());

    // Count by status
    const byStatus: Record<ADRStatus, number> = {
      proposed: 0,
      accepted: 0,
      deprecated: 0,
      superseded: 0,
    };
    for (const adr of adrs) {
      byStatus[adr.status]++;
    }

    // Count tags
    const tagCounts = new Map<string, number>();
    for (const adr of adrs) {
      for (const tag of adr.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }
    const topTags = Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .toSorted((a, b) => b.count - a.count)
      .slice(0, 10);

    // Recently updated
    const recentlyUpdated = adrs
      .toSorted((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 5);

    return {
      total: adrs.length,
      byStatus,
      topTags,
      recentlyUpdated,
    };
  }

  /**
   * Generate markdown index of all ADRs
   */
  generateIndex(): string {
    const adrs = this.list();
    const lines = [
      '# Architecture Decision Records',
      '',
      '## Summary',
      '',
      `Total ADRs: ${adrs.length}`,
      '',
      '## Index',
      '',
      '| ID | Title | Status | Date |',
      '|-----|-------|--------|------|',
    ];

    for (const adr of adrs) {
      lines.push(`| ${adr.id} | ${adr.title} | ${adr.status} | ${adr.date} |`);
    }

    return lines.join('\n');
  }

  // --- Private Methods ---

  private getNextNumber(): number {
    let max = 0;
    for (const adr of this.adrs.values()) {
      if (adr.number > max) {max = adr.number;}
    }
    return max + 1;
  }

  private saveADR(adr: ADR): void {
    const content = this.config.template
      .replace('{NUMBER}', String(adr.number).padStart(4, '0'))
      .replace('{TITLE}', adr.title)
      .replace('{STATUS}', adr.status)
      .replace('{DATE}', adr.date)
      .replace('{AUTHOR}', adr.author)
      .replace('{CONTEXT}', adr.context)
      .replace('{DECISION}', adr.decision)
      .replace('{CONSEQUENCES}', adr.consequences)
      .replace('{TAGS}', adr.tags.map(t => `- ${t}`).join('\n'));

    const filePath = path.join(this.config.adrPath, `${adr.id}.md`);
    fs.writeFileSync(filePath, content);

    // Also save JSON for easy loading
    const jsonPath = path.join(this.config.adrPath, `${adr.id}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(adr, null, 2));
  }

  private async loadADRs(): Promise<void> {
    try {
      const files = fs.readdirSync(this.config.adrPath);

      for (const file of files) {
        if (!file.endsWith('.json')) {continue;}

        const filePath = path.join(this.config.adrPath, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const adr = JSON.parse(content) as ADR;
        this.adrs.set(adr.id, adr);
      }
    } catch {
      // No existing ADRs
    }
  }
}

// --- Factory ---

let instance: ADRService | null = null;

export function getADRService(config?: Partial<ADRConfig>): ADRService {
  if (!instance) {
    instance = new ADRService(config);
  }
  return instance;
}

export default ADRService;
