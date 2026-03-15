// @ts-nocheck
/**
 * 🦊 SKYNET CREDIT SYSTEM — Prevent Runaway Recursive Spawning
 * 
 * Implements credit-based resource allocation to prevent infinite agent spawning.
 * Inspired by flow-nexus economic model with SuperClaw enhancements.
 * 
 * Features:
 * - Credit-based spawn limits
 * - Depth-based cost scaling
 * - Automatic credit recovery
 * - Agent death credit refund
 * - Economic emergency brakes
 */

import { EventEmitter } from 'events';
import { memorize } from './cortex';

// ═══════════════════════════════════════════════════════════════
// TYPES & INTERFACES
// ═══════════════════════════════════════════════════════════════

export interface CreditConfig {
  initialCredits: number;
  maxCredits: number;
  rechargeRate: number;        // credits per minute
  rechargeInterval: number;    // minutes
  
  // Cost scaling by depth
  baseCost: number;            // cost at depth 0
  depthMultiplier: number;     // exponential scaling factor
  maxDepth: number;            // hard depth limit
  
  // Emergency limits
  maxConcurrentAgents: number;
  emergencyThreshold: number;  // credits below which to trigger emergency mode
  emergencyMode: boolean;      // locked until credits recover
}

export interface SpawnCost {
  totalCost: number;
  baseCost: number;
  depthCost: number;
  agentCount: number;
  depth: number;
}

export interface CreditTransaction {
  id: string;
  timestamp: number;
  type: 'spend' | 'refund' | 'recharge';
  amount: number;
  reason: string;
  agentId?: string;
  depth?: number;
  balance: number;
}

// ═══════════════════════════════════════════════════════════════
// CREDIT SYSTEM CLASS
// ═══════════════════════════════════════════════════════════════

export class CreditSystem extends EventEmitter {
  private config: CreditConfig;
  private currentCredits: number;
  private activeAgents: Map<string, { cost: number; depth: number; spawned: number }>;
  private transactions: CreditTransaction[];
  private rechargeTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<CreditConfig> = {}) {
    super();
    
    // Default configuration inspired by flow-nexus
    this.config = {
      initialCredits: 100,
      maxCredits: 500,
      rechargeRate: 10,
      rechargeInterval: 1, // 1 minute
      
      baseCost: 5,
      depthMultiplier: 2.0,
      maxDepth: 8,
      
      maxConcurrentAgents: 50,
      emergencyThreshold: 10,
      emergencyMode: false,
      
      ...config
    };

    this.currentCredits = this.config.initialCredits;
    this.activeAgents = new Map();
    this.transactions = [];

    this.startRechargeTimer();
    
    memorize(
      `CreditSystem initialized with ${this.currentCredits} credits`,
      // @ts-expect-error - Post-Merge Reconciliation
      'system',
      'credit:init'
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // CORE CREDIT OPERATIONS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Calculate spawn cost based on depth and current agent count
   */
  calculateSpawnCost(depth: number): SpawnCost {
    const agentCount = this.activeAgents.size;
    const baseCost = this.config.baseCost;
    
    // Exponential scaling by depth: cost = baseCost * (multiplier ^ depth)
    const depthCost = baseCost * Math.pow(this.config.depthMultiplier, depth);
    
    // Additional cost based on current agent count
    const congestionCost = Math.floor(agentCount / 10) * baseCost;
    
    const totalCost = Math.ceil(depthCost + congestionCost);

    return {
      totalCost,
      baseCost,
      depthCost,
      agentCount,
      depth
    };
  }

  /**
   * Check if spawn is allowed and return cost analysis
   */
  canSpawn(depth: number): { allowed: boolean; cost: SpawnCost; reason?: string } {
    const cost = this.calculateSpawnCost(depth);

    // Check emergency mode
    if (this.config.emergencyMode) {
      return { allowed: false, cost, reason: 'Emergency mode active - spawning locked' };
    }

    // Check depth limits
    if (depth > this.config.maxDepth) {
      return { allowed: false, cost, reason: `Depth ${depth} exceeds maximum ${this.config.maxDepth}` };
    }

    // Check agent count limits
    if (this.activeAgents.size >= this.config.maxConcurrentAgents) {
      return { allowed: false, cost, reason: `Maximum concurrent agents (${this.config.maxConcurrentAgents}) reached` };
    }

    // Check credit availability
    if (this.currentCredits < cost.totalCost) {
      return { allowed: false, cost, reason: `Insufficient credits: need ${cost.totalCost}, have ${this.currentCredits}` };
    }

    return { allowed: true, cost };
  }

  /**
   * Spend credits for agent spawn
   */
  spendCredits(agentId: string, depth: number): SpawnCost {
    const cost = this.calculateSpawnCost(depth);
    
    if (this.currentCredits < cost.totalCost) {
      throw new Error(`Insufficient credits: need ${cost.totalCost}, have ${this.currentCredits}`);
    }

    this.currentCredits -= cost.totalCost;
    this.activeAgents.set(agentId, {
      cost: cost.totalCost,
      depth,
      spawned: Date.now()
    });

    this.recordTransaction({
      type: 'spend',
      amount: cost.totalCost,
      reason: `Agent spawn at depth ${depth}`,
      agentId,
      depth
    });

    // Check emergency threshold
    if (this.currentCredits <= this.config.emergencyThreshold) {
      this.enterEmergencyMode();
    }

    this.emit('creditsSpent', { agentId, cost, remaining: this.currentCredits });
    return cost;
  }

  /**
   * Refund credits when agent dies
   */
  refundCredits(agentId: string, partial = false): number {
    const agent = this.activeAgents.get(agentId);
    if (!agent) {
      return 0;
    }

    // Calculate refund based on agent lifetime
    const lifetime = Date.now() - agent.spawned;
    const minLifetime = 60000; // 1 minute minimum
    
    let refundAmount = agent.cost;
    
    // Partial refund if agent died quickly (possible failure)
    if (partial && lifetime < minLifetime) {
      refundAmount = Math.ceil(agent.cost * 0.5); // 50% refund for quick failures
    }

    this.currentCredits += refundAmount;
    this.activeAgents.delete(agentId);

    this.recordTransaction({
      type: 'refund',
      amount: refundAmount,
      reason: partial ? 'Agent early termination' : 'Agent completed',
      agentId
    });

    // Exit emergency mode if credits recovered
    if (this.currentCredits > this.config.emergencyThreshold && this.config.emergencyMode) {
      this.exitEmergencyMode();
    }

    this.emit('creditsRefunded', { agentId, amount: refundAmount, remaining: this.currentCredits });
    return refundAmount;
  }

  // ═══════════════════════════════════════════════════════════════
  // EMERGENCY MANAGEMENT
  // ═══════════════════════════════════════════════════════════════

  private enterEmergencyMode(): void {
    this.config.emergencyMode = true;
    this.emit('emergencyMode', { entered: true, credits: this.currentCredits });
    
    memorize(
      `Emergency mode activated - credits: ${this.currentCredits}`,
      // @ts-expect-error - Post-Merge Reconciliation
      'alert',
      'credit:emergency:enter'
    );
  }

  private exitEmergencyMode(): void {
    this.config.emergencyMode = false;
    this.emit('emergencyMode', { entered: false, credits: this.currentCredits });
    
    memorize(
      `Emergency mode deactivated - credits recovered: ${this.currentCredits}`,
      'fact',
      'credit:emergency:exit'
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // RECHARGE SYSTEM
  // ═══════════════════════════════════════════════════════════════

  private startRechargeTimer(): void {
    this.rechargeTimer = setInterval(() => {
      this.rechargeCredits();
    }, this.config.rechargeInterval * 60 * 1000); // Convert minutes to ms
  }

  private rechargeCredits(): void {
    if (this.currentCredits >= this.config.maxCredits) {
      return;
    }

    const oldCredits = this.currentCredits;
    this.currentCredits = Math.min(
      this.currentCredits + this.config.rechargeRate,
      this.config.maxCredits
    );

    if (oldCredits !== this.currentCredits) {
      this.recordTransaction({
        type: 'recharge',
        amount: this.currentCredits - oldCredits,
        reason: 'Automatic recharge'
      });

      this.emit('creditsRecharged', { 
        amount: this.currentCredits - oldCredits, 
        total: this.currentCredits 
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // TRANSACTION LOGGING
  // ═══════════════════════════════════════════════════════════════

  private recordTransaction(transaction: Omit<CreditTransaction, 'id' | 'timestamp' | 'balance'>): void {
    const fullTransaction: CreditTransaction = {
      id: `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      balance: this.currentCredits,
      ...transaction
    };

    this.transactions.push(fullTransaction);

    // Keep only last 1000 transactions
    if (this.transactions.length > 1000) {
      this.transactions = this.transactions.slice(-1000);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // GETTERS & STATUS
  // ═══════════════════════════════════════════════════════════════

  getCredits(): number {
    return this.currentCredits;
  }

  getActiveAgentCount(): number {
    return this.activeAgents.size;
  }

  getStatus() {
    return {
      credits: this.currentCredits,
      maxCredits: this.config.maxCredits,
      activeAgents: this.activeAgents.size,
      maxAgents: this.config.maxConcurrentAgents,
      emergencyMode: this.config.emergencyMode,
      emergencyThreshold: this.config.emergencyThreshold,
      transactions: this.transactions.length,
      config: this.config
    };
  }

  getTransactionHistory(limit = 50): CreditTransaction[] {
    return this.transactions.slice(-limit);
  }

  getActiveAgents(): Array<{ agentId: string; cost: number; depth: number; uptime: number }> {
    return Array.from(this.activeAgents.entries()).map(([agentId, data]) => ({
      agentId,
      cost: data.cost,
      depth: data.depth,
      uptime: Date.now() - data.spawned
    }));
  }

  // ═══════════════════════════════════════════════════════════════
  // CONFIGURATION & CLEANUP
  // ═══════════════════════════════════════════════════════════════

  updateConfig(newConfig: Partial<CreditConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.emit('configUpdated', this.config);
  }

  /**
   * Emergency reset - use with caution
   */
  emergencyReset(): void {
    this.currentCredits = this.config.initialCredits;
    this.activeAgents.clear();
    this.config.emergencyMode = false;
    
    this.recordTransaction({
      type: 'recharge',
      amount: this.config.initialCredits,
      reason: 'Emergency reset'
    });

    memorize(
      'CreditSystem emergency reset performed',
      // @ts-expect-error - Post-Merge Reconciliation
      'alert',
      'credit:emergency:reset'
    );

    this.emit('emergencyReset');
  }

  /**
   * Cleanup on shutdown
   */
  destroy(): void {
    if (this.rechargeTimer) {
      clearInterval(this.rechargeTimer);
      this.rechargeTimer = null;
    }
    this.removeAllListeners();
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════

let globalCreditSystem: CreditSystem | null = null;

export function getCreditSystem(config?: Partial<CreditConfig>): CreditSystem {
  if (!globalCreditSystem) {
    globalCreditSystem = new CreditSystem(config);
  }
  return globalCreditSystem;
}

export function resetCreditSystem(): void {
  if (globalCreditSystem) {
    globalCreditSystem.destroy();
    globalCreditSystem = null;
  }
}