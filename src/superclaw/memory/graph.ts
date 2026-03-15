/**
 * Memory Graph - Visualize and traverse memory relationships
 */

import type { AgentMemory, MemoryRelationship, RelationshipType } from './types'

export interface GraphNode {
  id: string
  label: string
  type: string
  size: number
  metadata: Record<string, any>
}

export interface GraphEdge {
  source: string
  target: string
  type: RelationshipType
  weight: number
}

export interface MemoryGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export class MemoryGraphBuilder {
  private nodes: Map<string, GraphNode> = new Map()
  private edges: GraphEdge[] = []
  
  addMemory(memory: AgentMemory): this {
    this.nodes.set(memory.id, {
      id: memory.id,
      label: memory.title,
      type: memory.type,
      size: memory.description?.length || 0,
      metadata: {
        status: memory.status,
        compactionLevel: memory.compactionLevel,
        createdAt: memory.createdAt
      }
    })
    return this
  }
  
  addRelationship(rel: MemoryRelationship): this {
    this.edges.push({
      source: rel.sourceId,
      target: rel.targetId,
      type: rel.type,
      weight: (rel.metadata as any)?.strength || 1
    })
    return this
  }
  
  build(): MemoryGraph {
    return {
      nodes: Array.from(this.nodes.values()),
      edges: this.edges
    }
  }
  
  // Graph algorithms
  
  findPath(fromId: string, toId: string): string[] | null {
    const visited = new Set<string>()
    const queue: { id: string; path: string[] }[] = [{ id: fromId, path: [fromId] }]
    
    while (queue.length > 0) {
      const { id, path } = queue.shift()!
      
      if (id === toId) {return path}
      if (visited.has(id)) {continue}
      
      visited.add(id)
      
      for (const edge of this.edges) {
        if (edge.source === id && !visited.has(edge.target)) {
          queue.push({ id: edge.target, path: [...path, edge.target] })
        }
      }
    }
    
    return null
  }
  
  getConnectedComponent(startId: string): Set<string> {
    const component = new Set<string>()
    const queue = [startId]
    
    while (queue.length > 0) {
      const id = queue.shift()!
      if (component.has(id)) {continue}
      
      component.add(id)
      
      for (const edge of this.edges) {
        if (edge.source === id) {queue.push(edge.target)}
        if (edge.target === id) {queue.push(edge.source)}
      }
    }
    
    return component
  }
  
  getCentralNodes(limit: number = 10): GraphNode[] {
    // Calculate degree centrality
    const degrees = new Map<string, number>()
    
    for (const edge of this.edges) {
      degrees.set(edge.source, (degrees.get(edge.source) || 0) + 1)
      degrees.set(edge.target, (degrees.get(edge.target) || 0) + 1)
    }
    
    return Array.from(this.nodes.values())
      .map(node => ({ node, degree: degrees.get(node.id) || 0 }))
      .toSorted((a, b) => b.degree - a.degree)
      .slice(0, limit)
      .map(({ node }) => node)
  }
  
  // Export formats
  
  toDOT(): string {
    let dot = 'digraph MemoryGraph {\n'
    dot += '  rankdir=LR;\n'
    
    for (const node of this.nodes.values()) {
      const color = this.getNodeColor(node.type)
      dot += `  "${node.id}" [label="${node.label.slice(0, 30)}" color="${color}"];\n`
    }
    
    for (const edge of this.edges) {
      const style = this.getEdgeStyle(edge.type)
      dot += `  "${edge.source}" -> "${edge.target}" [style="${style}"];\n`
    }
    
    dot += '}\n'
    return dot
  }
  
  toMermaid(): string {
    let mermaid = 'graph LR\n'
    
    for (const node of this.nodes.values()) {
      const shape = this.getNodeShape(node.type)
      mermaid += `  ${node.id}${shape.open}"${node.label.slice(0, 20)}"${shape.close}\n`
    }
    
    for (const edge of this.edges) {
      const arrow = this.getArrowType(edge.type)
      mermaid += `  ${edge.source} ${arrow} ${edge.target}\n`
    }
    
    return mermaid
  }
  
  private getNodeColor(type: string): string {
    const colors: Record<string, string> = {
      learning: 'blue',
      decision: 'green',
      context: 'yellow',
      capability: 'purple',
      relationship: 'orange'
    }
    return colors[type] || 'gray'
  }
  
  private getNodeShape(type: string): { open: string; close: string } {
    const shapes: Record<string, { open: string; close: string }> = {
      learning: { open: '(', close: ')' },
      decision: { open: '{', close: '}' },
      context: { open: '[', close: ']' },
      capability: { open: '((', close: '))' },
      relationship: { open: '([', close: '])' }
    }
    return shapes[type] || { open: '[', close: ']' }
  }
  
  private getEdgeStyle(type: RelationshipType): string {
    const styles: Record<string, string> = {
      'builds-on': 'solid',
      'conflicts-with': 'dashed',
      'validates': 'dotted',
      'supercedes': 'bold'
    }
    return styles[type] || 'solid'
  }
  
  private getArrowType(type: RelationshipType): string {
    const arrows: Record<string, string> = {
      'builds-on': '-->',
      'conflicts-with': '-.->',
      'validates': '==>',
      'supercedes': '-->'
    }
    return arrows[type] || '-->'
  }
}

// Convenience function
export function buildMemoryGraph(
  memories: AgentMemory[],
  relationships: MemoryRelationship[]
): MemoryGraph {
  const builder = new MemoryGraphBuilder()
  
  for (const memory of memories) {
    builder.addMemory(memory)
  }
  
  for (const rel of relationships) {
    builder.addRelationship(rel)
  }
  
  return builder.build()
}