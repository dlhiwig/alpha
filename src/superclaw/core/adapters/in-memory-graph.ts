/**
 * In-Memory Knowledge Graph Adapter
 * 
 * Implements KnowledgeGraphPort with adjacency list + BFS.
 * This is the "good enough for now" adapter.
 * When we need scale → swap to Neo4jAdapter via Registry.
 * 
 * Stolen idea: VisionFlow's Neo4j OWL 2 ontology reasoning.
 * Our version: Start simple, swap later without changing business logic.
 */

import type {
  KnowledgeGraphPort,
  GraphEntity,
  GraphRelationship,
  EntityFilter,
  GraphPattern,
  GraphMatch,
} from '../ports.js';

export class InMemoryGraphAdapter implements KnowledgeGraphPort {
  readonly name = 'in-memory-graph';

  private entities = new Map<string, GraphEntity>();
  private relationships = new Map<string, GraphRelationship>();
  private outEdges = new Map<string, Set<string>>(); // entityId → Set<relId>
  private inEdges = new Map<string, Set<string>>();  // entityId → Set<relId>
  private relCounter = 0;

  async upsertEntity(entity: GraphEntity): Promise<void> {
    const existing = this.entities.get(entity.id);
    if (existing) {
      this.entities.set(entity.id, {
        ...existing,
        ...entity,
        properties: { ...existing.properties, ...entity.properties },
      });
    } else {
      this.entities.set(entity.id, entity);
      this.outEdges.set(entity.id, new Set());
      this.inEdges.set(entity.id, new Set());
    }
  }

  async addRelationship(rel: GraphRelationship): Promise<void> {
    const id = rel.id ?? `rel_${++this.relCounter}`;
    const stored = { ...rel, id };
    this.relationships.set(id, stored);

    if (!this.outEdges.has(rel.fromId)) {this.outEdges.set(rel.fromId, new Set());}
    if (!this.inEdges.has(rel.toId)) {this.inEdges.set(rel.toId, new Set());}

    this.outEdges.get(rel.fromId)!.add(id);
    this.inEdges.get(rel.toId)!.add(id);
  }

  async queryEntities(filter: EntityFilter): Promise<GraphEntity[]> {
    let results: GraphEntity[] = [];

    for (const entity of this.entities.values()) {
      if (filter.type && entity.type !== filter.type) {continue;}
      if (filter.properties) {
        const match = Object.entries(filter.properties).every(
          ([k, v]) => entity.properties[k] === v
        );
        if (!match) {continue;}
      }
      results.push(entity);
    }

    if (filter.limit) {results = results.slice(0, filter.limit);}
    return results;
  }

  async getRelationships(
    entityId: string,
    direction: 'in' | 'out' | 'both' = 'both'
  ): Promise<GraphRelationship[]> {
    const results: GraphRelationship[] = [];

    if (direction === 'out' || direction === 'both') {
      for (const relId of this.outEdges.get(entityId) ?? []) {
        const rel = this.relationships.get(relId);
        if (rel) {results.push(rel);}
      }
    }

    if (direction === 'in' || direction === 'both') {
      for (const relId of this.inEdges.get(entityId) ?? []) {
        const rel = this.relationships.get(relId);
        if (rel) {results.push(rel);}
      }
    }

    return results;
  }

  async shortestPath(fromId: string, toId: string): Promise<GraphEntity[]> {
    if (fromId === toId) {
      const e = this.entities.get(fromId);
      return e ? [e] : [];
    }

    // BFS
    const visited = new Set<string>();
    const parent = new Map<string, string>();
    const queue: string[] = [fromId];
    visited.add(fromId);

    while (queue.length > 0) {
      const current = queue.shift()!;

      for (const relId of this.outEdges.get(current) ?? []) {
        const rel = this.relationships.get(relId);
        if (!rel) {continue;}
        const neighbor = rel.toId;

        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          parent.set(neighbor, current);

          if (neighbor === toId) {
            // Reconstruct path
            const path: GraphEntity[] = [];
            let node: string | undefined = toId;
            while (node !== undefined) {
              const entity = this.entities.get(node);
              if (entity) {path.unshift(entity);}
              node = parent.get(node);
            }
            return path;
          }

          queue.push(neighbor);
        }
      }
    }

    return []; // No path
  }

  async match(pattern: GraphPattern): Promise<GraphMatch[]> {
    // Simple single-edge pattern matching for now.
    // Full subgraph isomorphism is NP-complete — we do brute force on small graphs.
    if (pattern.edges.length === 0) {
      // Just node matching
      const results: GraphMatch[] = [];
      for (const entity of this.entities.values()) {
        const nodeSpec = pattern.nodes[0];
        if (nodeSpec && (!nodeSpec.type || entity.type === nodeSpec.type)) {
          results.push({ bindings: { [nodeSpec.alias]: entity } });
        }
      }
      return results;
    }

    // Single edge pattern: (a)-[r]->(b)
    if (pattern.edges.length === 1 && pattern.nodes.length === 2) {
      const edge = pattern.edges[0];
      const fromSpec = pattern.nodes.find(n => n.alias === edge.from);
      const toSpec = pattern.nodes.find(n => n.alias === edge.to);
      const results: GraphMatch[] = [];

      for (const rel of this.relationships.values()) {
        if (edge.type && rel.type !== edge.type) {continue;}

        const fromEntity = this.entities.get(rel.fromId);
        const toEntity = this.entities.get(rel.toId);
        if (!fromEntity || !toEntity) {continue;}

        if (fromSpec?.type && fromEntity.type !== fromSpec.type) {continue;}
        if (toSpec?.type && toEntity.type !== toSpec.type) {continue;}

        results.push({
          bindings: {
            [edge.from]: fromEntity,
            [edge.to]: toEntity,
            _rel: rel,
          },
        });
      }

      return results;
    }

    // Complex patterns: fall back to empty (implement when needed)
    return [];
  }

  // ─── Utilities ───

  get entityCount(): number {
    return this.entities.size;
  }

  get relationshipCount(): number {
    return this.relationships.size;
  }

  /** Export the entire graph (for persistence or migration to Neo4j). */
  export(): { entities: GraphEntity[]; relationships: GraphRelationship[] } {
    return {
      entities: [...this.entities.values()],
      relationships: [...this.relationships.values()],
    };
  }

  /** Import a graph dump. */
  import(data: { entities: GraphEntity[]; relationships: GraphRelationship[] }): void {
    for (const entity of data.entities) {
      this.entities.set(entity.id, entity);
      if (!this.outEdges.has(entity.id)) {this.outEdges.set(entity.id, new Set());}
      if (!this.inEdges.has(entity.id)) {this.inEdges.set(entity.id, new Set());}
    }
    for (const rel of data.relationships) {
      const id = rel.id ?? `rel_${++this.relCounter}`;
      this.relationships.set(id, { ...rel, id });
      this.outEdges.get(rel.fromId)?.add(id);
      this.inEdges.get(rel.toId)?.add(id);
    }
  }

  /** Clear everything. */
  clear(): void {
    this.entities.clear();
    this.relationships.clear();
    this.outEdges.clear();
    this.inEdges.clear();
  }
}
