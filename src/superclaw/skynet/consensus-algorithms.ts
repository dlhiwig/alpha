/**
 * 🤝 Consensus Algorithms for SuperClaw AgentBus
 * 
 * Implementation of distributed consensus algorithms adapted for multi-agent coordination:
 * - Raft: Leader-based consensus for hierarchical topologies
 * - Byzantine Fault Tolerance: Handles unreliable/drifting agents
 * - CRDT: Conflict-free replicated data types for eventual consistency
 * - Hybrid approaches for complex agent coordination scenarios
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════
// CONSENSUS TYPES & INTERFACES
// ═══════════════════════════════════════════════════════════════

export type ConsensusAlgorithm = 'raft' | 'byzantine' | 'crdt' | 'pbft' | 'pos' | 'hybrid';
export type ConsensusState = 'leader' | 'follower' | 'candidate' | 'observer';
export type VoteType = 'approve' | 'reject' | 'abstain' | 'veto';

export interface ConsensusNode {
  id: string;
  state: ConsensusState;
  term: number;
  votedFor?: string;
  lastLogIndex: number;
  commitIndex: number;
  reliability: number; // 0-1 score for Byzantine algorithms
  stake?: number; // For proof-of-stake variants
}

export interface ConsensusProposal {
  id: string;
  proposerId: string;
  term: number;
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
  dependencies?: string[];
  priority?: number;
  timeout?: number;
}

export interface ConsensusVote {
  nodeId: string;
  proposalId: string;
  vote: VoteType;
  term: number;
  timestamp: number;
  signature?: string;
  reason?: string;
}

export interface ConsensusResult {
  proposalId: string;
  accepted: boolean;
  votes: ConsensusVote[];
  finalValue: unknown;
  confidence: number;
  algorithm: ConsensusAlgorithm;
  duration: number;
  errors?: string[];
}

export interface ConsensusConfig {
  algorithm: ConsensusAlgorithm;
  electionTimeout: number;
  heartbeatInterval: number;
  maxRetries: number;
  byzantineFaultTolerance: number; // Max % of Byzantine nodes to tolerate
  quorumSize?: number; // Override default quorum calculation
  enablePartitioning?: boolean;
  conflictResolution?: 'last-writer-wins' | 'merge' | 'voting';
}

// ═══════════════════════════════════════════════════════════════
// ABSTRACT CONSENSUS ENGINE
// ═══════════════════════════════════════════════════════════════

export abstract class ConsensusEngine extends EventEmitter {
  protected nodes: Map<string, ConsensusNode> = new Map();
  protected proposals: Map<string, ConsensusProposal> = new Map();
  protected votes: Map<string, ConsensusVote[]> = new Map();
  protected config: ConsensusConfig;
  protected currentTerm = 0;
  protected isRunning = false;
  
  constructor(config: ConsensusConfig) {
    super();
    this.config = config;
  }
  
  abstract propose(proposal: Omit<ConsensusProposal, 'id' | 'timestamp' | 'term'>): Promise<ConsensusResult>;
  abstract vote(nodeId: string, proposalId: string, vote: VoteType, reason?: string): Promise<void>;
  abstract getLeader(): ConsensusNode | null;
  abstract handleNodeFailure(nodeId: string): Promise<void>;
  abstract handleNodeRecovery(nodeId: string): Promise<void>;
  
  addNode(nodeId: string, initialState: Partial<ConsensusNode> = {}): void {
    const node: ConsensusNode = {
      id: nodeId,
      state: 'follower',
      term: this.currentTerm,
      lastLogIndex: 0,
      commitIndex: 0,
      reliability: 1.0,
      ...initialState
    };
    
    this.nodes.set(nodeId, node);
    this.emit('node:added', { nodeId, node });
  }
  
  removeNode(nodeId: string): void {
    this.nodes.delete(nodeId);
    this.emit('node:removed', { nodeId });
  }
  
  getNodes(): ConsensusNode[] {
    return Array.from(this.nodes.values());
  }
  
  getNode(nodeId: string): ConsensusNode | undefined {
    return this.nodes.get(nodeId);
  }
  
  protected calculateQuorum(): number {
    if (this.config.quorumSize) {return this.config.quorumSize;}
    return Math.floor(this.nodes.size / 2) + 1;
  }
  
  protected isQuorumReached(voteCount: number): boolean {
    return voteCount >= this.calculateQuorum();
  }
  
  start(): void {
    if (this.isRunning) {return;}
    this.isRunning = true;
    this.emit('consensus:started');
  }
  
  stop(): void {
    if (!this.isRunning) {return;}
    this.isRunning = false;
    this.emit('consensus:stopped');
  }
  
  getStatus(): {
    algorithm: ConsensusAlgorithm;
    nodeCount: number;
    currentTerm: number;
    leader: string | null;
    isRunning: boolean;
  } {
    return {
      algorithm: this.config.algorithm,
      nodeCount: this.nodes.size,
      currentTerm: this.currentTerm,
      leader: this.getLeader()?.id || null,
      isRunning: this.isRunning
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// RAFT CONSENSUS IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════

export class RaftConsensus extends ConsensusEngine {
  private leaderId?: string;
  private electionTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private logEntries: Array<{ term: number; proposal: ConsensusProposal }> = [];
  
  constructor(config: ConsensusConfig) {
    super({ ...config, algorithm: 'raft' });
  }
  
  start(): void {
    super.start();
    this.startElectionTimer();
  }
  
  stop(): void {
    super.stop();
    if (this.electionTimer) {clearTimeout(this.electionTimer);}
    if (this.heartbeatTimer) {clearTimeout(this.heartbeatTimer);}
  }
  
  async propose(proposal: Omit<ConsensusProposal, 'id' | 'timestamp' | 'term'>): Promise<ConsensusResult> {
    const fullProposal: ConsensusProposal = {
      ...proposal,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      term: this.currentTerm
    };
    
    // Only leader can propose
    const leader = this.getLeader();
    if (!leader || leader.id !== fullProposal.proposerId) {
      throw new Error('Only the leader can propose in Raft consensus');
    }
    
    this.proposals.set(fullProposal.id, fullProposal);
    this.logEntries.push({ term: this.currentTerm, proposal: fullProposal });
    
    // Replicate to followers
    const votes = await this.replicateToFollowers(fullProposal);
    
    // Calculate result
    const approvals = votes.filter(v => v.vote === 'approve').length + 1; // +1 for leader
    const quorum = this.calculateQuorum();
    
    return {
      proposalId: fullProposal.id,
      accepted: approvals >= quorum,
      votes,
      finalValue: approvals >= quorum ? fullProposal.data : null,
      confidence: approvals / this.nodes.size,
      algorithm: 'raft',
      duration: Date.now() - fullProposal.timestamp
    };
  }
  
  async vote(nodeId: string, proposalId: string, vote: VoteType, reason?: string): Promise<void> {
    const node = this.nodes.get(nodeId);
    const proposal = this.proposals.get(proposalId);
    
    if (!node || !proposal) {return;}
    
    const consensusVote: ConsensusVote = {
      nodeId,
      proposalId,
      vote,
      term: this.currentTerm,
      timestamp: Date.now(),
      reason
    };
    
    if (!this.votes.has(proposalId)) {
      this.votes.set(proposalId, []);
    }
    this.votes.get(proposalId)!.push(consensusVote);
    
    this.emit('vote:cast', consensusVote);
  }
  
  getLeader(): ConsensusNode | null {
    return this.leaderId ? this.nodes.get(this.leaderId) || null : null;
  }
  
  async handleNodeFailure(nodeId: string): Promise<void> {
    const node = this.nodes.get(nodeId);
    if (!node) {return;}
    
    // If leader failed, trigger election
    if (this.leaderId === nodeId) {
      this.leaderId = undefined;
      this.startElection();
    }
    
    this.emit('node:failed', { nodeId });
  }
  
  async handleNodeRecovery(nodeId: string): Promise<void> {
    const node = this.nodes.get(nodeId);
    if (!node) {return;}
    
    // Reset node state and sync log
    node.state = 'follower';
    node.term = this.currentTerm;
    
    this.emit('node:recovered', { nodeId });
  }
  
  private startElectionTimer(): void {
    if (this.electionTimer) {clearTimeout(this.electionTimer);}
    
    const timeout = this.config.electionTimeout + Math.random() * this.config.electionTimeout;
    this.electionTimer = setTimeout(() => this.startElection(), timeout);
  }
  
  private startElection(): void {
    if (!this.isRunning) {return;}
    
    this.currentTerm++;
    this.leaderId = undefined;
    
    // Find a candidate node (highest reliability)
    const candidates = Array.from(this.nodes.values())
      .filter(n => n.reliability > 0.7)
      .toSorted((a, b) => b.reliability - a.reliability);
    
    if (candidates.length === 0) {return;}
    
    const candidate = candidates[0];
    candidate.state = 'candidate';
    candidate.term = this.currentTerm;
    candidate.votedFor = candidate.id;
    
    // Simulate election (in real implementation, would request votes)
    let votes = 1; // Candidate votes for itself
    for (const node of Array.from(this.nodes.values())) {
      if (node.id !== candidate.id && node.reliability > 0.5) {
        votes++;
      }
    }
    
    if (votes >= this.calculateQuorum()) {
      this.electLeader(candidate.id);
    } else {
      this.startElectionTimer();
    }
  }
  
  private electLeader(nodeId: string): void {
    this.leaderId = nodeId;
    const leader = this.nodes.get(nodeId);
    
    if (leader) {
      leader.state = 'leader';
      
      // Set other nodes as followers
      for (const node of Array.from(this.nodes.values())) {
        if (node.id !== nodeId) {
          node.state = 'follower';
          node.votedFor = undefined;
        }
      }
      
      this.startHeartbeat();
      this.emit('leader:elected', { leaderId: nodeId });
    }
  }
  
  private startHeartbeat(): void {
    if (this.heartbeatTimer) {clearTimeout(this.heartbeatTimer);}
    
    this.heartbeatTimer = setTimeout(() => {
      this.emit('heartbeat', { leaderId: this.leaderId, term: this.currentTerm });
      if (this.isRunning) {this.startHeartbeat();}
    }, this.config.heartbeatInterval);
  }
  
  private async replicateToFollowers(proposal: ConsensusProposal): Promise<ConsensusVote[]> {
    const votes: ConsensusVote[] = [];
    
    for (const node of Array.from(this.nodes.values())) {
      if (node.state === 'follower') {
        // Simulate follower vote based on reliability
        const vote: VoteType = node.reliability > 0.6 ? 'approve' : 'reject';
        
        const consensusVote: ConsensusVote = {
          nodeId: node.id,
          proposalId: proposal.id,
          vote,
          term: this.currentTerm,
          timestamp: Date.now()
        };
        
        votes.push(consensusVote);
      }
    }
    
    return votes;
  }
}

// ═══════════════════════════════════════════════════════════════
// BYZANTINE FAULT TOLERANT CONSENSUS
// ═══════════════════════════════════════════════════════════════

export class ByzantineConsensus extends ConsensusEngine {
  private faultyNodes: Set<string> = new Set();
  private rounds: Map<string, number> = new Map();
  
  constructor(config: ConsensusConfig) {
    super({ ...config, algorithm: 'byzantine' });
  }
  
  async propose(proposal: Omit<ConsensusProposal, 'id' | 'timestamp' | 'term'>): Promise<ConsensusResult> {
    const fullProposal: ConsensusProposal = {
      ...proposal,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      term: this.currentTerm
    };
    
    this.proposals.set(fullProposal.id, fullProposal);
    
    // Multi-round Byzantine consensus
    const maxFaultyNodes = Math.floor((this.nodes.size - 1) / 3);
    const votes = await this.collectByzantineVotes(fullProposal);
    
    // Filter reliable votes
    const reliableVotes = votes.filter(v => !this.faultyNodes.has(v.nodeId));
    const requiredVotes = Math.floor(2 * reliableVotes.length / 3) + 1;
    const approvals = reliableVotes.filter(v => v.vote === 'approve').length;
    
    return {
      proposalId: fullProposal.id,
      accepted: approvals >= requiredVotes,
      votes,
      finalValue: approvals >= requiredVotes ? fullProposal.data : null,
      confidence: approvals / reliableVotes.length,
      algorithm: 'byzantine',
      duration: Date.now() - fullProposal.timestamp
    };
  }
  
  async vote(nodeId: string, proposalId: string, vote: VoteType, reason?: string): Promise<void> {
    const node = this.nodes.get(nodeId);
    if (!node) {return;}
    
    // Check if node is Byzantine (unreliable)
    if (node.reliability < 0.5) {
      this.faultyNodes.add(nodeId);
      // Byzantine nodes may give inconsistent votes
      vote = Math.random() > 0.5 ? 'approve' : 'reject';
    }
    
    const consensusVote: ConsensusVote = {
      nodeId,
      proposalId,
      vote,
      term: this.currentTerm,
      timestamp: Date.now(),
      reason
    };
    
    if (!this.votes.has(proposalId)) {
      this.votes.set(proposalId, []);
    }
    this.votes.get(proposalId)!.push(consensusVote);
    
    this.emit('vote:cast', consensusVote);
  }
  
  getLeader(): ConsensusNode | null {
    // Byzantine consensus doesn't have a single leader
    return null;
  }
  
  async handleNodeFailure(nodeId: string): Promise<void> {
    this.faultyNodes.add(nodeId);
    this.emit('node:failed', { nodeId });
  }
  
  async handleNodeRecovery(nodeId: string): Promise<void> {
    this.faultyNodes.delete(nodeId);
    const node = this.nodes.get(nodeId);
    if (node) {
      node.reliability = Math.min(node.reliability + 0.1, 1.0); // Slowly restore trust
    }
    this.emit('node:recovered', { nodeId });
  }
  
  private async collectByzantineVotes(proposal: ConsensusProposal): Promise<ConsensusVote[]> {
    const votes: ConsensusVote[] = [];
    
    for (const node of Array.from(this.nodes.values())) {
      const isFaulty = this.faultyNodes.has(node.id) || node.reliability < 0.5;
      
      let vote: VoteType;
      if (isFaulty) {
        // Faulty nodes vote randomly or maliciously
        vote = Math.random() > 0.5 ? 'approve' : 'reject';
      } else {
        // Honest nodes vote based on reliability and proposal validity
        vote = node.reliability > 0.7 ? 'approve' : 'reject';
      }
      
      votes.push({
        nodeId: node.id,
        proposalId: proposal.id,
        vote,
        term: this.currentTerm,
        timestamp: Date.now()
      });
    }
    
    return votes;
  }
}

// ═══════════════════════════════════════════════════════════════
// CRDT CONSENSUS IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════

export class CRDTConsensus extends ConsensusEngine {
  private state: Map<string, any> = new Map();
  private vectorClock: Map<string, number> = new Map();
  
  constructor(config: ConsensusConfig) {
    super({ ...config, algorithm: 'crdt' });
  }
  
  async propose(proposal: Omit<ConsensusProposal, 'id' | 'timestamp' | 'term'>): Promise<ConsensusResult> {
    const fullProposal: ConsensusProposal = {
      ...proposal,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      term: this.currentTerm
    };
    
    this.proposals.set(fullProposal.id, fullProposal);
    
    // CRDT: All updates are eventually consistent
    const mergedState = this.mergeProposal(fullProposal);
    const votes = await this.collectCRDTVotes(fullProposal);
    
    return {
      proposalId: fullProposal.id,
      accepted: true, // CRDT always accepts (eventually consistent)
      votes,
      finalValue: mergedState,
      confidence: 1.0,
      algorithm: 'crdt',
      duration: Date.now() - fullProposal.timestamp
    };
  }
  
  async vote(nodeId: string, proposalId: string, vote: VoteType, reason?: string): Promise<void> {
    // In CRDT, votes are contributions to the state
    const consensusVote: ConsensusVote = {
      nodeId,
      proposalId,
      vote,
      term: this.currentTerm,
      timestamp: Date.now(),
      reason
    };
    
    if (!this.votes.has(proposalId)) {
      this.votes.set(proposalId, []);
    }
    this.votes.get(proposalId)!.push(consensusVote);
    
    // Update vector clock
    this.vectorClock.set(nodeId, (this.vectorClock.get(nodeId) || 0) + 1);
    
    this.emit('vote:cast', consensusVote);
  }
  
  getLeader(): ConsensusNode | null {
    // CRDT is leaderless
    return null;
  }
  
  async handleNodeFailure(nodeId: string): Promise<void> {
    // CRDT handles partitions gracefully
    this.emit('node:failed', { nodeId });
  }
  
  async handleNodeRecovery(nodeId: string): Promise<void> {
    // Sync state when node recovers
    const node = this.nodes.get(nodeId);
    if (node) {
      // Reset vector clock for this node
      this.vectorClock.set(nodeId, 0);
    }
    this.emit('node:recovered', { nodeId });
  }
  
  private mergeProposal(proposal: ConsensusProposal): any {
    const key = `${proposal.type}:${proposal.proposerId}`;
    
    if (this.config.conflictResolution === 'last-writer-wins') {
      this.state.set(key, proposal.data);
    } else if (this.config.conflictResolution === 'merge') {
      const existing = this.state.get(key) || {};
      this.state.set(key, { ...existing, ...proposal.data });
    }
    
    return this.state.get(key);
  }
  
  private async collectCRDTVotes(proposal: ConsensusProposal): Promise<ConsensusVote[]> {
    const votes: ConsensusVote[] = [];
    
    for (const node of Array.from(this.nodes.values())) {
      // Each node contributes its view
      votes.push({
        nodeId: node.id,
        proposalId: proposal.id,
        vote: 'approve', // CRDT doesn't reject, just merges
        term: this.currentTerm,
        timestamp: Date.now()
      });
    }
    
    return votes;
  }
  
  getState(): Map<string, any> {
    return new Map(this.state);
  }
  
  getVectorClock(): Map<string, number> {
    return new Map(this.vectorClock);
  }
}

// ═══════════════════════════════════════════════════════════════
// CONSENSUS FACTORY
// ═══════════════════════════════════════════════════════════════

export class ConsensusFactory {
  static create(config: ConsensusConfig): ConsensusEngine {
    switch (config.algorithm) {
      case 'raft':
        return new RaftConsensus(config);
      case 'byzantine':
        return new ByzantineConsensus(config);
      case 'crdt':
        return new CRDTConsensus(config);
      default:
        throw new Error(`Unsupported consensus algorithm: ${config.algorithm}`);
    }
  }
  
  static getDefaultConfig(algorithm: ConsensusAlgorithm): ConsensusConfig {
    const baseConfig = {
      electionTimeout: 5000,
      heartbeatInterval: 1000,
      maxRetries: 3,
      byzantineFaultTolerance: 0.33,
      enablePartitioning: true,
      conflictResolution: 'last-writer-wins' as const
    };
    
    return {
      ...baseConfig,
      algorithm
    };
  }
}

export default ConsensusFactory;