/**
 * Neo4j Knowledge Graph Adapter (Stub)
 * 
 * Stolen from: VisionFlow's Neo4j integration with OWL 2 ontology reasoning.
 * 
 * This is the "swap in when ready" adapter for production-scale knowledge graphs.
 * Same interface as InMemoryGraphAdapter — business logic doesn't change.
 * 
 * Prerequisites:
 *   npm install neo4j-driver
 *   Docker: docker run -p 7687:7687 -e NEO4J_AUTH=neo4j/password neo4j:5
 * 
 * Usage:
 *   Registry.bind('knowledgeGraph', new Neo4jGraphAdapter('bolt://localhost:7687', 'neo4j', 'password'));
 */

import type {
  KnowledgeGraphPort,
  GraphEntity,
  GraphRelationship,
  EntityFilter,
  GraphPattern,
  GraphMatch,
} from '../ports.js';

export class Neo4jGraphAdapter implements KnowledgeGraphPort {
  readonly name = 'neo4j';

  private driver: unknown; // neo4j.Driver — lazy import to avoid hard dependency

  constructor(
    private uri: string,
    private user: string,
    private password: string,
    private database: string = 'neo4j',
  ) {}

  private async getDriver(): Promise<any> {
    if (!this.driver) {
      try {
        // @ts-ignore — neo4j-driver is an optional runtime dependency (stub adapter)
        const neo4j = await import('neo4j-driver');
        this.driver = neo4j.default.driver(this.uri, neo4j.default.auth.basic(this.user, this.password));
      } catch {
        throw new Error(
          'neo4j-driver not installed. Run: npm install neo4j-driver\n' +
          'Or use InMemoryGraphAdapter for development.'
        );
      }
    }
    return this.driver;
  }

  private async run(cypher: string, params: Record<string, unknown> = {}): Promise<any> {
    const driver = await this.getDriver();
    const session = (driver as any).session({ database: this.database });
    try {
      return await session.run(cypher, params);
    } finally {
      await session.close();
    }
  }

  async upsertEntity(entity: GraphEntity): Promise<void> {
    await this.run(
      `MERGE (n:Entity {id: $id})
       SET n.type = $type, n += $properties`,
      { id: entity.id, type: entity.type, properties: entity.properties }
    );
  }

  async addRelationship(rel: GraphRelationship): Promise<void> {
    // Dynamic relationship types via APOC or string interpolation
    // Note: Cypher doesn't allow parameterized relationship types
    const safeType = rel.type.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase();
    await this.run(
      `MATCH (a:Entity {id: $fromId}), (b:Entity {id: $toId})
       CREATE (a)-[r:${safeType} {weight: $weight}]->(b)
       SET r += $properties`,
      {
        fromId: rel.fromId,
        toId: rel.toId,
        weight: rel.weight ?? 1.0,
        properties: rel.properties ?? {},
      }
    );
  }

  async queryEntities(filter: EntityFilter): Promise<GraphEntity[]> {
    let cypher = 'MATCH (n:Entity)';
    const params: Record<string, unknown> = {};

    const where: string[] = [];
    if (filter.type) {
      where.push('n.type = $type');
      params.type = filter.type;
    }
    if (filter.properties) {
      Object.entries(filter.properties).forEach(([key, value], i) => {
        where.push(`n.${key} = $prop${i}`);
        params[`prop${i}`] = value;
      });
    }

    if (where.length) cypher += ` WHERE ${where.join(' AND ')}`;
    cypher += ' RETURN n';
    if (filter.limit) cypher += ` LIMIT ${filter.limit}`;

    const result = await this.run(cypher, params);
    return result.records.map((r: any) => {
      const node = r.get('n');
      return {
        id: node.properties.id,
        type: node.properties.type,
        properties: { ...node.properties },
      };
    });
  }

  async getRelationships(
    entityId: string,
    direction: 'in' | 'out' | 'both' = 'both'
  ): Promise<GraphRelationship[]> {
    const patterns = {
      out: '(a:Entity {id: $id})-[r]->(b:Entity)',
      in: '(b:Entity)-[r]->(a:Entity {id: $id})',
      both: '(a:Entity {id: $id})-[r]-(b:Entity)',
    };

    const result = await this.run(
      `MATCH ${patterns[direction]} RETURN r, a, b`,
      { id: entityId }
    );

    return result.records.map((rec: any) => {
      const r = rec.get('r');
      return {
        id: r.elementId,
        fromId: rec.get('a').properties.id,
        toId: rec.get('b').properties.id,
        type: r.type,
        weight: r.properties.weight,
        properties: { ...r.properties },
      };
    });
  }

  async shortestPath(fromId: string, toId: string): Promise<GraphEntity[]> {
    const result = await this.run(
      `MATCH p = shortestPath(
         (a:Entity {id: $from})-[*]-(b:Entity {id: $to})
       )
       RETURN nodes(p) as path`,
      { from: fromId, to: toId }
    );

    if (result.records.length === 0) return [];

    return result.records[0].get('path').map((node: any) => ({
      id: node.properties.id,
      type: node.properties.type,
      properties: { ...node.properties },
    }));
  }

  async match(pattern: GraphPattern): Promise<GraphMatch[]> {
    // Build Cypher from pattern
    const nodeClauses = pattern.nodes.map(
      n => `(${n.alias}:Entity${n.type ? ` {type: '${n.type}'}` : ''})`
    );
    const edgeClauses = pattern.edges.map(
      e => `(${e.from})-[:${(e.type ?? '').toUpperCase() || 'RELATED'}]->(${e.to})`
    );

    const cypher = `MATCH ${[...nodeClauses, ...edgeClauses].join(', ')}
                     RETURN ${pattern.nodes.map(n => n.alias).join(', ')}`;

    const result = await this.run(cypher);
    return result.records.map((rec: any) => {
      const bindings: Record<string, GraphEntity> = {};
      for (const node of pattern.nodes) {
        const n = rec.get(node.alias);
        bindings[node.alias] = {
          id: n.properties.id,
          type: n.properties.type,
          properties: { ...n.properties },
        };
      }
      return { bindings };
    });
  }

  /** Close the driver connection. */
  async close(): Promise<void> {
    if (this.driver) {
      await (this.driver as any).close();
      this.driver = null;
    }
  }
}
