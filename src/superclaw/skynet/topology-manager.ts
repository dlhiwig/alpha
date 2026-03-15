// @ts-nocheck
/**
 * 🦊 SKYNET TOPOLOGY MANAGER — Multi-Agent Network Topologies
 * 
 * Implements 4 network topology patterns for recursive agent spawning.
 * Based on flow-nexus architecture with SuperClaw enhancements.
 * 
 * Topologies:
 * - MESH: All agents connect to all (peer-to-peer)
 * - STAR: Central coordinator with spoke agents
 * - RING: Circular chain of agents
 * - HIERARCHICAL: Tree structure with parent-child relationships
 */

import { EventEmitter } from 'events';
import { memorize } from './cortex';

// ═══════════════════════════════════════════════════════════════
// TYPES & INTERFACES
// ═══════════════════════════════════════════════════════════════

export type TopologyType = 'mesh' | 'star' | 'ring' | 'hierarchical';

export interface TopologyNode {
  agentId: string;
  role: string;
  depth: number;
  position: number;
  connections: string[];
  parent?: string;
  children: string[];
  metadata: Record<string, any>;
  spawned: number;
}

export interface TopologyConfig {
  type: TopologyType;
  maxNodes: number;
  maxDepth: number;
  
  // Star topology specific
  centralRole?: string;
  
  // Hierarchical topology specific
  branchingFactor?: number;
  
  // Ring topology specific
  ringSize?: number;
  
  // Mesh topology specific  
  maxConnections?: number;
  
  // Communication patterns
  messageRouting: 'direct' | 'broadcast' | 'hierarchical' | 'ring';
  failoverStrategy: 'none' | 'reconnect' | 'promote' | 'replicate';
}

export interface TopologyStats {
  nodeCount: number;
  maxDepth: number;
  avgConnections: number;
  centralNodes: string[];
  isolatedNodes: string[];
  communicationPaths: number;
  efficiency: number; // 0-1 score
}

// ═══════════════════════════════════════════════════════════════
// TOPOLOGY MANAGER CLASS
// ═══════════════════════════════════════════════════════════════

export class TopologyManager extends EventEmitter {
  private config: TopologyConfig;
  private nodes: Map<string, TopologyNode>;
  private topology: TopologyType;
  private rootNode: string | null = null;

  constructor(config: TopologyConfig) {
    super();
    this.config = config;
    this.topology = config.type;
    this.nodes = new Map();
    
    memorize(
      `TopologyManager initialized: ${config.type} topology`,
      // @ts-expect-error - Post-Merge Reconciliation
      'system',
      `topology:init:${config.type}`
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // NODE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════

  /**
   * Add a new agent node to the topology
   */
  addNode(agentId: string, role: string, depth = 0, metadata: Record<string, any> = {}): TopologyNode {
    if (this.nodes.has(agentId)) {
      throw new Error(`Node ${agentId} already exists in topology`);
    }

    if (this.nodes.size >= this.config.maxNodes) {
      throw new Error(`Maximum nodes (${this.config.maxNodes}) reached`);
    }

    const node: TopologyNode = {
      agentId,
      role,
      depth,
      position: this.calculateNodePosition(),
      connections: [],
      children: [],
      metadata,
      spawned: Date.now()
    };

    // Set root node for hierarchical topologies
    if (this.nodes.size === 0) {
      this.rootNode = agentId;
    }

    this.nodes.set(agentId, node);
    this.establishConnections(node);

    this.emit('nodeAdded', { node, topology: this.getTopologySnapshot() });
    
    memorize(
      `Node added to ${this.topology} topology: ${agentId} (${role}) at depth ${depth}`,
      'fact',
      `topology:node:add:${agentId}`
    );

    return node;
  }

  /**
   * Remove a node and handle topology reorganization
   */
  removeNode(agentId: string): boolean {
    const node = this.nodes.get(agentId);
    if (!node) {return false;}

    // Handle different removal strategies based on topology
    switch (this.topology) {
      case 'star':
        this.handleStarNodeRemoval(node);
        break;
      case 'ring':
        this.handleRingNodeRemoval(node);
        break;
      case 'hierarchical':
        this.handleHierarchicalNodeRemoval(node);
        break;
      case 'mesh':
        this.handleMeshNodeRemoval(node);
        break;
    }

    this.nodes.delete(agentId);
    this.emit('nodeRemoved', { agentId, role: node.role });
    
    memorize(
      `Node removed from ${this.topology} topology: ${agentId}`,
      'fact',
      `topology:node:remove:${agentId}`
    );

    return true;
  }

  // ═══════════════════════════════════════════════════════════════
  // TOPOLOGY-SPECIFIC CONNECTION LOGIC
  // ═══════════════════════════════════════════════════════════════

  private establishConnections(newNode: TopologyNode): void {
    switch (this.topology) {
      case 'mesh':
        this.establishMeshConnections(newNode);
        break;
      case 'star':
        this.establishStarConnections(newNode);
        break;
      case 'ring':
        this.establishRingConnections(newNode);
        break;
      case 'hierarchical':
        this.establishHierarchicalConnections(newNode);
        break;
    }
  }

  private establishMeshConnections(newNode: TopologyNode): void {
    const maxConn = this.config.maxConnections || this.config.maxNodes;
    
    // Connect to all existing nodes (up to maxConnections)
    const existingNodes = Array.from(this.nodes.values())
      .filter(n => n.agentId !== newNode.agentId)
      .slice(0, maxConn);

    for (const node of existingNodes) {
      // Bidirectional connection
      newNode.connections.push(node.agentId);
      node.connections.push(newNode.agentId);
      
      // Limit connections per node
      if (node.connections.length > maxConn) {
        node.connections = node.connections.slice(0, maxConn);
      }
    }
  }

  private establishStarConnections(newNode: TopologyNode): void {
    if (this.nodes.size === 1) {
      // First node becomes the central hub
      newNode.role = this.config.centralRole || 'coordinator';
      return;
    }

    const hub = this.findCentralNode();
    if (hub) {
      // Connect to hub only
      newNode.connections.push(hub.agentId);
      hub.connections.push(newNode.agentId);
    }
  }

  private establishRingConnections(newNode: TopologyNode): void {
    const existingNodes = Array.from(this.nodes.values())
      .filter(n => n.agentId !== newNode.agentId)
      .toSorted((a, b) => a.position - b.position);

    if (existingNodes.length === 0) {return;}

    if (existingNodes.length === 1) {
      // Simple bidirectional connection for 2 nodes
      newNode.connections.push(existingNodes[0].agentId);
      existingNodes[0].connections.push(newNode.agentId);
      return;
    }

    // Insert into ring structure
    const insertPosition = newNode.position;
    let leftNode: TopologyNode | null = null;
    let rightNode: TopologyNode | null = null;

    // Find insertion point
    for (let i = 0; i < existingNodes.length; i++) {
      if (existingNodes[i].position < insertPosition) {
        leftNode = existingNodes[i];
      } else {
        rightNode = existingNodes[i];
        break;
      }
    }

    // Handle wraparound
    if (!leftNode) {leftNode = existingNodes[existingNodes.length - 1];}
    if (!rightNode) {rightNode = existingNodes[0];}

    // Establish ring connections
    if (leftNode && rightNode) {
      // Remove old connection between left and right
      leftNode.connections = leftNode.connections.filter(id => id !== rightNode.agentId);
      rightNode.connections = rightNode.connections.filter(id => id !== leftNode.agentId);

      // Add new connections
      newNode.connections.push(leftNode.agentId, rightNode.agentId);
      leftNode.connections.push(newNode.agentId);
      rightNode.connections.push(newNode.agentId);
    }
  }

  private establishHierarchicalConnections(newNode: TopologyNode): void {
    if (this.nodes.size === 1) {return;} // Root node

    const branchingFactor = this.config.branchingFactor || 3;
    
    // Find parent at the previous depth level
    const potentialParents = Array.from(this.nodes.values())
      .filter(n => n.depth === newNode.depth - 1)
      .toSorted((a, b) => a.children.length - b.children.length);

    let parent = potentialParents.find(p => p.children.length < branchingFactor);
    
    if (!parent && potentialParents.length > 0) {
      // All parents at depth-1 are full, use the one with fewest children
      parent = potentialParents[0];
    }

    if (!parent) {
      // No valid parent found, attach to root
      const root = this.nodes.get(this.rootNode!);
      if (root) {parent = root;}
    }

    if (parent) {
      newNode.parent = parent.agentId;
      parent.children.push(newNode.agentId);
      
      // Establish bidirectional connection
      newNode.connections.push(parent.agentId);
      parent.connections.push(newNode.agentId);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // NODE REMOVAL HANDLERS
  // ═══════════════════════════════════════════════════════════════

  private handleMeshNodeRemoval(node: TopologyNode): void {
    // Simply remove all connections to this node
    for (const connId of node.connections) {
      const connNode = this.nodes.get(connId);
      if (connNode) {
        connNode.connections = connNode.connections.filter(id => id !== node.agentId);
      }
    }
  }

  private handleStarNodeRemoval(node: TopologyNode): void {
    const isHub = this.isCentralNode(node);
    
    if (isHub) {
      // Hub removal - promote a spoke to be the new hub
      const spokes = Array.from(this.nodes.values())
        .filter(n => n.agentId !== node.agentId)
        .toSorted((a, b) => b.connections.length - a.connections.length);

      if (spokes.length > 0) {
        const newHub = spokes[0];
        newHub.role = this.config.centralRole || 'coordinator';
        
        // Connect all other spokes to new hub
        for (const spoke of spokes.slice(1)) {
          if (!newHub.connections.includes(spoke.agentId)) {
            newHub.connections.push(spoke.agentId);
            spoke.connections = [newHub.agentId];
          }
        }
      }
    } else {
      // Spoke removal - just remove connections
      this.handleMeshNodeRemoval(node);
    }
  }

  private handleRingNodeRemoval(node: TopologyNode): void {
    if (node.connections.length === 2) {
      // Standard ring node with 2 connections
      const [left, right] = node.connections.map(id => this.nodes.get(id)).filter(Boolean) as TopologyNode[];
      
      if (left && right) {
        // Connect left and right directly
        left.connections = left.connections.filter(id => id !== node.agentId);
        right.connections = right.connections.filter(id => id !== node.agentId);
        
        left.connections.push(right.agentId);
        right.connections.push(left.agentId);
      }
    } else {
      // Edge case handling
      this.handleMeshNodeRemoval(node);
    }
  }

  private handleHierarchicalNodeRemoval(node: TopologyNode): void {
    // Remove from parent's children
    if (node.parent) {
      const parent = this.nodes.get(node.parent);
      if (parent) {
        parent.children = parent.children.filter(id => id !== node.agentId);
        parent.connections = parent.connections.filter(id => id !== node.agentId);
      }
    }

    // Promote children or reassign to grandparent
    for (const childId of node.children) {
      const child = this.nodes.get(childId);
      if (child && node.parent) {
        const grandparent = this.nodes.get(node.parent);
        if (grandparent) {
          child.parent = grandparent.agentId;
          child.depth = grandparent.depth + 1;
          grandparent.children.push(child.agentId);
          
          child.connections = child.connections.filter(id => id !== node.agentId);
          child.connections.push(grandparent.agentId);
          grandparent.connections.push(child.agentId);
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // UTILITY METHODS
  // ═══════════════════════════════════════════════════════════════

  private calculateNodePosition(): number {
    return this.nodes.size;
  }

  private findCentralNode(): TopologyNode | null {
    return Array.from(this.nodes.values())
      .toSorted((a, b) => b.connections.length - a.connections.length)[0] || null;
  }

  private isCentralNode(node: TopologyNode): boolean {
    if (this.topology !== 'star') {return false;}
    
    const avgConnections = this.getTopologyStats().avgConnections;
    return node.connections.length > avgConnections * 1.5;
  }

  // ═══════════════════════════════════════════════════════════════
  // ROUTING & COMMUNICATION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Find optimal path between two nodes
   */
  findPath(fromId: string, toId: string): string[] {
    const from = this.nodes.get(fromId);
    const to = this.nodes.get(toId);
    
    if (!from || !to) {return [];}
    if (fromId === toId) {return [fromId];}

    // BFS to find shortest path
    const queue: Array<{ nodeId: string; path: string[] }> = [{ nodeId: fromId, path: [fromId] }];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const { nodeId, path } = queue.shift()!;
      
      if (nodeId === toId) {
        return path;
      }

      if (visited.has(nodeId)) {continue;}
      visited.add(nodeId);

      const node = this.nodes.get(nodeId);
      if (node) {
        for (const connId of node.connections) {
          if (!visited.has(connId)) {
            queue.push({ nodeId: connId, path: [...path, connId] });
          }
        }
      }
    }

    return []; // No path found
  }

  /**
   * Get all nodes that should receive a broadcast message from a source
   */
  getBroadcastTargets(fromId: string): string[] {
    switch (this.config.messageRouting) {
      case 'direct':
        return this.nodes.get(fromId)?.connections || [];
      
      case 'broadcast':
        return Array.from(this.nodes.keys()).filter(id => id !== fromId);
      
      case 'hierarchical':
        return this.getHierarchicalBroadcastTargets(fromId);
      
      case 'ring':
        return this.getRingBroadcastTargets(fromId);
      
      default:
        return [];
    }
  }

  private getHierarchicalBroadcastTargets(fromId: string): string[] {
    const node = this.nodes.get(fromId);
    if (!node) {return [];}

    const targets: string[] = [];
    
    // Send to parent
    if (node.parent) {targets.push(node.parent);}
    
    // Send to children
    targets.push(...node.children);
    
    return targets;
  }

  private getRingBroadcastTargets(fromId: string): string[] {
    const node = this.nodes.get(fromId);
    return node?.connections || [];
  }

  // ═══════════════════════════════════════════════════════════════
  // TOPOLOGY ANALYSIS
  // ═══════════════════════════════════════════════════════════════

  getTopologyStats(): TopologyStats {
    const nodes = Array.from(this.nodes.values());
    const totalConnections = nodes.reduce((sum, node) => sum + node.connections.length, 0);
    
    return {
      nodeCount: nodes.length,
      maxDepth: Math.max(...nodes.map(n => n.depth), 0),
      avgConnections: nodes.length > 0 ? totalConnections / nodes.length : 0,
      centralNodes: this.findCentralNodes(),
      isolatedNodes: nodes.filter(n => n.connections.length === 0).map(n => n.agentId),
      communicationPaths: this.calculateCommunicationPaths(),
      efficiency: this.calculateTopologyEfficiency()
    };
  }

  private findCentralNodes(): string[] {
    const nodes = Array.from(this.nodes.values());
    const avgConnections = nodes.reduce((sum, n) => sum + n.connections.length, 0) / nodes.length;
    
    return nodes
      .filter(n => n.connections.length > avgConnections * 1.5)
      .map(n => n.agentId);
  }

  private calculateCommunicationPaths(): number {
    let paths = 0;
    const nodeIds = Array.from(this.nodes.keys());
    
    for (let i = 0; i < nodeIds.length; i++) {
      for (let j = i + 1; j < nodeIds.length; j++) {
        const path = this.findPath(nodeIds[i], nodeIds[j]);
        if (path.length > 0) {paths++;}
      }
    }
    
    return paths;
  }

  private calculateTopologyEfficiency(): number {
    const nodes = this.nodes.size;
    if (nodes <= 1) {return 1.0;}

    const stats = this.getTopologyStats();
    const maxPossiblePaths = (nodes * (nodes - 1)) / 2;
    
    // Efficiency based on connectivity and path lengths
    const connectivityScore = stats.communicationPaths / maxPossiblePaths;
    const redundancyScore = Math.min(stats.avgConnections / nodes, 1.0);
    
    return (connectivityScore + redundancyScore) / 2;
  }

  // ═══════════════════════════════════════════════════════════════
  // GETTERS & EXPORTS
  // ═══════════════════════════════════════════════════════════════

  getNode(agentId: string): TopologyNode | undefined {
    return this.nodes.get(agentId);
  }

  getAllNodes(): TopologyNode[] {
    return Array.from(this.nodes.values());
  }

  getTopologySnapshot() {
    return {
      type: this.topology,
      rootNode: this.rootNode,
      nodeCount: this.nodes.size,
      nodes: Array.from(this.nodes.entries()).map(([id, node]) => ({
        id,
        ...node
      })),
      stats: this.getTopologyStats()
    };
  }

  getConfig(): TopologyConfig {
    return { ...this.config };
  }

  updateConfig(newConfig: Partial<TopologyConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.emit('configUpdated', this.config);
  }

  destroy(): void {
    this.nodes.clear();
    this.rootNode = null;
    this.removeAllListeners();
  }
}