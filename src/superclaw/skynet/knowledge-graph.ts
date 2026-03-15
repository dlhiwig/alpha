/**
 * 🧠 SKYNET Knowledge Graph with PageRank
 * 
 * Graph-based memory with influence scoring. Surfaces important
 * insights by analyzing relationships between facts.
 * 
 * Based on Ruflo's MemoryGraph + PageRank + Community Detection.
 * 
 * Features:
 * - PageRank for importance scoring
 * - Community detection for clustering related facts
 * - Jaccard similarity for edge weights
 * - Influence propagation across the graph
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

// --- Types ---

export interface MemoryNode {
  id: string;
  content: string;
  category: string;
  pageRank: number;         // Importance score (0-1)
  community: number;        // Community/cluster ID
  edges: string[];          // Connected node IDs
  edgeWeights: Map<string, number>;  // Edge weights (similarity)
  createdAt: number;
  accessCount: number;
  metadata: Record<string, any>;
}

export interface KnowledgeGraphConfig {
  /** PageRank damping factor */
  dampingFactor: number;
  /** PageRank iterations */
  maxIterations: number;
  /** Minimum edge weight to create connection */
  minEdgeWeight: number;
  /** Path to persist graph */
  persistPath: string;
  /** Max nodes in graph */
  maxNodes: number;
}

export interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  communityCount: number;
  avgPageRank: number;
  topNodes: MemoryNode[];
}

// --- Default Config ---

const DEFAULT_CONFIG: KnowledgeGraphConfig = {
  dampingFactor: 0.85,
  maxIterations: 100,
  minEdgeWeight: 0.2,
  persistPath: './data/knowledge-graph.json',
  maxNodes: 5000,
};

// --- Knowledge Graph Service ---

export class KnowledgeGraph extends EventEmitter {
  private config: KnowledgeGraphConfig;
  private nodes: Map<string, MemoryNode> = new Map();
  private initialized = false;

  constructor(config: Partial<KnowledgeGraphConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize graph - load persisted data
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.loadGraph();
    this.initialized = true;
    this.emit('initialized', { nodeCount: this.nodes.size });
  }

  /**
   * Add a memory node to the graph
   */
  addNode(id: string, content: string, category: string, metadata: Record<string, any> = {}): MemoryNode {
    const node: MemoryNode = {
      id,
      content,
      category,
      pageRank: 1 / (this.nodes.size + 1),  // Initial uniform rank
      community: -1,
      edges: [],
      edgeWeights: new Map(),
      createdAt: Date.now(),
      accessCount: 0,
      metadata,
    };

    this.nodes.set(id, node);

    // Connect to similar nodes
    this.connectSimilarNodes(node);

    // Enforce max nodes
    if (this.nodes.size > this.config.maxNodes) {
      this.pruneLowestRanked();
    }

    this.emit('nodeAdded', node);
    return node;
  }

  /**
   * Get node by ID
   */
  getNode(id: string): MemoryNode | undefined {
    const node = this.nodes.get(id);
    if (node) {
      node.accessCount++;
    }
    return node;
  }

  /**
   * Search nodes by content similarity
   */
  search(query: string, limit = 10): MemoryNode[] {
    const results: Array<{ node: MemoryNode; score: number }> = [];

    for (const node of this.nodes.values()) {
      const score = this.calculateSimilarity(query, node.content);
      if (score > 0.1) {
        results.push({ node, score: score * node.pageRank });  // Boost by PageRank
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(r => r.node);
  }

  /**
   * Get most influential nodes (highest PageRank)
   */
  getInfluential(limit = 10): MemoryNode[] {
    return Array.from(this.nodes.values())
      .sort((a, b) => b.pageRank - a.pageRank)
      .slice(0, limit);
  }

  /**
   * Get nodes in a community
   */
  getCommunity(communityId: number): MemoryNode[] {
    return Array.from(this.nodes.values())
      .filter(n => n.community === communityId);
  }

  /**
   * Run PageRank algorithm
   */
  computePageRank(): void {
    const nodes = Array.from(this.nodes.values());
    const n = nodes.length;
    if (n === 0) return;

    const d = this.config.dampingFactor;
    const tolerance = 0.0001;

    // Initialize
    for (const node of nodes) {
      node.pageRank = 1 / n;
    }

    // Iterate
    for (let iter = 0; iter < this.config.maxIterations; iter++) {
      let maxDiff = 0;

      for (const node of nodes) {
        let rank = (1 - d) / n;

        // Sum contributions from incoming edges
        for (const sourceId of node.edges) {
          const source = this.nodes.get(sourceId);
          if (source && source.edges.length > 0) {
            const weight = node.edgeWeights.get(sourceId) || 1;
            rank += d * (source.pageRank / source.edges.length) * weight;
          }
        }

        const diff = Math.abs(rank - node.pageRank);
        maxDiff = Math.max(maxDiff, diff);
        node.pageRank = rank;
      }

      // Check convergence
      if (maxDiff < tolerance) {
        break;
      }
    }

    // Normalize
    const sum = nodes.reduce((s, n) => s + n.pageRank, 0);
    for (const node of nodes) {
      node.pageRank /= sum;
    }

    this.emit('pageRankComputed');
  }

  /**
   * Detect communities using label propagation
   */
  detectCommunities(): number {
    const nodes = Array.from(this.nodes.values());
    if (nodes.length === 0) return 0;

    // Initialize each node to its own community
    nodes.forEach((node, i) => {
      node.community = i;
    });

    // Iterate label propagation
    const maxIter = 50;
    for (let iter = 0; iter < maxIter; iter++) {
      let changed = false;

      // Shuffle nodes for randomness
      const shuffled = [...nodes].sort(() => Math.random() - 0.5);

      for (const node of shuffled) {
        // Count community votes from neighbors
        const votes = new Map<number, number>();

        for (const neighborId of node.edges) {
          const neighbor = this.nodes.get(neighborId);
          if (neighbor) {
            const weight = node.edgeWeights.get(neighborId) || 1;
            votes.set(
              neighbor.community,
              (votes.get(neighbor.community) || 0) + weight
            );
          }
        }

        // Find most common community
        if (votes.size > 0) {
          let maxVotes = 0;
          let bestCommunity = node.community;

          for (const [community, count] of votes) {
            if (count > maxVotes) {
              maxVotes = count;
              bestCommunity = community;
            }
          }

          if (bestCommunity !== node.community) {
            node.community = bestCommunity;
            changed = true;
          }
        }
      }

      if (!changed) break;
    }

    // Count unique communities
    const communities = new Set(nodes.map(n => n.community));
    this.emit('communitiesDetected', { count: communities.size });
    return communities.size;
  }

  /**
   * Get graph statistics
   */
  getStats(): GraphStats {
    const nodes = Array.from(this.nodes.values());
    const edgeCount = nodes.reduce((sum, n) => sum + n.edges.length, 0) / 2;
    const communities = new Set(nodes.map(n => n.community)).size;
    const avgPageRank = nodes.reduce((sum, n) => sum + n.pageRank, 0) / nodes.length || 0;

    return {
      nodeCount: nodes.length,
      edgeCount,
      communityCount: communities,
      avgPageRank,
      topNodes: this.getInfluential(5),
    };
  }

  /**
   * Persist graph to disk
   */
  async save(): Promise<void> {
    const dir = path.dirname(this.config.persistPath);
    fs.mkdirSync(dir, { recursive: true });

    const data = Array.from(this.nodes.values()).map(node => ({
      ...node,
      edgeWeights: Array.from(node.edgeWeights.entries()),
    }));

    fs.writeFileSync(this.config.persistPath, JSON.stringify(data, null, 2));
    this.emit('saved');
  }

  /**
   * Shutdown and persist
   */
  async shutdown(): Promise<void> {
    await this.save();
    this.emit('shutdown');
  }

  // --- Private Methods ---

  private connectSimilarNodes(newNode: MemoryNode): void {
    for (const node of this.nodes.values()) {
      if (node.id === newNode.id) continue;

      const similarity = this.calculateSimilarity(newNode.content, node.content);

      if (similarity >= this.config.minEdgeWeight) {
        // Add bidirectional edge
        newNode.edges.push(node.id);
        newNode.edgeWeights.set(node.id, similarity);

        node.edges.push(newNode.id);
        node.edgeWeights.set(newNode.id, similarity);
      }
    }
  }

  private calculateSimilarity(a: string, b: string): number {
    // Jaccard similarity on word sets
    const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 2));
    const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(w => w.length > 2));

    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
    const union = new Set([...wordsA, ...wordsB]);

    return intersection.size / union.size;
  }

  private pruneLowestRanked(): void {
    const nodes = Array.from(this.nodes.values())
      .sort((a, b) => a.pageRank - b.pageRank);

    const toRemove = nodes.slice(0, Math.floor(nodes.length * 0.1));  // Remove bottom 10%

    for (const node of toRemove) {
      // Remove from neighbors' edge lists
      for (const neighborId of node.edges) {
        const neighbor = this.nodes.get(neighborId);
        if (neighbor) {
          neighbor.edges = neighbor.edges.filter(e => e !== node.id);
          neighbor.edgeWeights.delete(node.id);
        }
      }
      this.nodes.delete(node.id);
    }

    this.emit('pruned', { removed: toRemove.length });
  }

  private async loadGraph(): Promise<void> {
    try {
      const data = fs.readFileSync(this.config.persistPath, 'utf-8');
      const parsed = JSON.parse(data) as Array<any>;

      for (const item of parsed) {
        const node: MemoryNode = {
          ...item,
          edgeWeights: new Map(item.edgeWeights || []),
        };
        this.nodes.set(node.id, node);
      }
    } catch {
      // No existing file - start fresh
    }
  }
}

// --- Factory ---

let instance: KnowledgeGraph | null = null;

export function getKnowledgeGraph(config?: Partial<KnowledgeGraphConfig>): KnowledgeGraph {
  if (!instance) {
    instance = new KnowledgeGraph(config);
  }
  return instance;
}

export default KnowledgeGraph;
