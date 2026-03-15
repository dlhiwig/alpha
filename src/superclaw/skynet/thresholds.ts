/**
 * 🛡️ SuperClaw Resource Thresholds & Financial Safety Gates
 * 
 * Prevents runaway resource consumption and requires approval for expensive operations.
 * All threshold checks are audited to data/threshold-audit.json
 * 
 * NOW WITH COSTCONTROLLER INTEGRATION:
 * - Real-time cost tracking via ModelRouter
 * - Model-aware cost estimation
 * - Agent-level cost limits
 * - 80% warning thresholds
 * - Automatic agent pausing on limit breach
 */

import { promises as fs } from 'fs';
import { join } from 'path';
// @ts-expect-error - Post-Merge Reconciliation
import { formalVerifier, ActionContext } from './formal-verifier.ts';
// @ts-expect-error - Post-Merge Reconciliation
import { proofEngine } from './proof-engine.ts';
// @ts-expect-error - Post-Merge Reconciliation
import { getModelRouter, ModelRouter, estimateCost, getProviderTier } from '../swarm/model-router.ts';
// @ts-expect-error - Post-Merge Reconciliation
import { ProviderName } from '../swarm/types.ts';

// --- Interfaces ---

export interface ResourceLimits {
  maxContextChars: number;      // Default: 400000
  maxConcurrentAgents: number;  // Default: 10
  maxToolCallsPerTurn: number;  // Default: 50
  maxMemoryMB: number;          // Default: 512
}

export interface FinancialGates {
  requireApprovalAbove: number; // Default: $100
  dailySpendLimit: number;      // Default: $1000
  perAgentLimit: number;        // Default: $50
}

export interface UsageStats {
  activeAgents: number;
  totalToolCalls: number;
  memoryUsageMB: number;
  dailySpend: number;
  contextCharsUsed: number;
  lastUpdated: string;
  // Extended stats for CLI
  dailyLimit?: number;
  maxAgents?: number;
  pendingApprovals?: number;
}

export interface ThresholdCheckLog {
  timestamp: string;
  type: 'resource' | 'financial' | 'cost_estimation' | 'cost_tracking';
  resource?: keyof ResourceLimits;
  amount?: number;
  limit: number;
  value: number;
  result: 'allowed' | 'blocked' | 'approval_requested' | 'warning' | 'paused';
  reason?: string;
  agentId?: string;
  // Cost control integration
  provider?: ProviderName;
  estimatedCost?: number;
  actualCost?: number;
  modelTier?: number;
  costEfficiency?: number;
  budgetUtilization?: number;
  // Formal verification data
  formalProofId?: string;
  verificationResult?: 'verified' | 'unverified' | 'failed';
  riskScore?: number;
  byzantineConsensus?: boolean;
}

// --- Default Limits ---

const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  maxContextChars: 400000,
  maxConcurrentAgents: 50,  // Beast mode: 117GB RAM + RTX 4090
  maxToolCallsPerTurn: 100, // Increased for swarm operations
  maxMemoryMB: 8192         // 8GB per agent (117GB total available)
};

const DEFAULT_FINANCIAL_GATES: FinancialGates = {
  requireApprovalAbove: 100,  // Human approval for actions > $100
  dailySpendLimit: Infinity,  // No hard daily limit (Daniel directive 2026-02-21)
  perAgentLimit: 25           // $25 per agent (50 agents * $25 = $1250 max theoretical)
};

// --- ThresholdEnforcer Class ---

export class ThresholdEnforcer {
  private resourceLimits: ResourceLimits;
  private financialGates: FinancialGates;
  private auditLogPath: string;
  private currentUsage: UsageStats;
  private formalVerificationEnabled: boolean;
  private costController: ModelRouter;
  private pausedAgents: Set<string>;
  private warningThresholds: { [key: string]: boolean };

  constructor(
    resourceLimits?: Partial<ResourceLimits>,
    financialGates?: Partial<FinancialGates>,
    auditLogPath?: string,
    enableFormalVerification = true
  ) {
    this.resourceLimits = { ...DEFAULT_RESOURCE_LIMITS, ...resourceLimits };
    this.financialGates = { ...DEFAULT_FINANCIAL_GATES, ...financialGates };
    this.auditLogPath = auditLogPath || join(process.cwd(), 'data', 'threshold-audit.json');
    this.formalVerificationEnabled = enableFormalVerification;
    this.pausedAgents = new Set();
    this.warningThresholds = {};
    
    // Initialize CostController integration
    this.costController = getModelRouter({
      budgets: {
        dailyLimit: this.financialGates.dailySpendLimit,
        totalLimit: this.financialGates.dailySpendLimit * 30, // 30-day total
        agentLimit: this.financialGates.perAgentLimit,
        providerLimits: {
          claude: Math.min(50, this.financialGates.dailySpendLimit * 0.3),
          codex: Math.min(30, this.financialGates.dailySpendLimit * 0.2),
          grok: Math.min(20, this.financialGates.dailySpendLimit * 0.1),
        },
      },
      alerts: {
        warnAt: 0.8,  // 80% warning threshold
        stopAt: 0.95, // 95% pause threshold
      },
    });
    
    // Initialize usage stats
    this.currentUsage = {
      activeAgents: 0,
      totalToolCalls: 0,
      memoryUsageMB: 0,
      dailySpend: 0,
      contextCharsUsed: 0,
      lastUpdated: new Date().toISOString()
    };

    this.ensureAuditLogExists();
    
    if (enableFormalVerification) {
      this.initializeFormalVerification();
    }
  }

  /**
   * Initialize formal verification for threshold decisions
   */
  private initializeFormalVerification(): void {
    // Set up proof engine event handlers for threshold decisions
    proofEngine.on('proof_complete', (event) => {
      if (event.theorem.includes('threshold')) {
        console.log(`🔐 Threshold decision formally verified: ${event.theorem}`);
      }
    });
  }

  /**
   * 🔥 BEAST MODE: Check if agent is paused due to cost limits
   */
  isAgentPaused(agentId: string): boolean {
    return this.pausedAgents.has(agentId);
  }

  /**
   * 🔥 BEAST MODE: Estimate cost before expensive operation
   */
  async estimateOperationCost(
    provider: ProviderName,
    inputTokens: number,
    outputTokens: number = 0,
    agentId?: string
  ): Promise<{
    estimatedCost: number;
    allowed: boolean;
    reason: string;
    tier: number;
    budgetAfter: number;
    warningTriggered: boolean;
  }> {
    const estimatedCost = estimateCost(provider, inputTokens, outputTokens);
    const tier = getProviderTier(provider);
    const costSummary = this.costController.getCostSummary();
    const budgetAfter = costSummary.daily + estimatedCost;
    const budgetUtilization = budgetAfter / this.financialGates.dailySpendLimit;
    
    // Check if operation would exceed limits
    let allowed = true;
    let reason = 'Within budget limits';
    let warningTriggered = false;

    // Check if agent is already paused
    if (agentId && this.isAgentPaused(agentId)) {
      allowed = false;
      reason = 'Agent is paused due to cost limits';
    }
    
    // Check daily limit
    else if (budgetUtilization >= 0.95) {
      allowed = false;
      reason = `Operation would exceed daily limit: $${budgetAfter.toFixed(4)} > $${this.financialGates.dailySpendLimit}`;
    }
    
    // Check per-operation approval threshold
    else if (estimatedCost > this.financialGates.requireApprovalAbove) {
      allowed = false;
      reason = `Operation requires approval: $${estimatedCost.toFixed(4)} > $${this.financialGates.requireApprovalAbove}`;
    }
    
    // Trigger warning at 80%
    else if (budgetUtilization >= 0.8) {
      warningTriggered = true;
      reason = `Warning: Budget at ${(budgetUtilization * 100).toFixed(1)}% - $${budgetAfter.toFixed(4)}/$${this.financialGates.dailySpendLimit}`;
    }

    // Log the cost estimation
    await this.logThresholdCheck({
      timestamp: new Date().toISOString(),
      type: 'cost_estimation',
      limit: this.financialGates.dailySpendLimit,
      value: budgetAfter,
      result: allowed ? (warningTriggered ? 'warning' : 'allowed') : 'blocked',
      reason,
      agentId,
      provider,
      estimatedCost,
      modelTier: tier,
      budgetUtilization: budgetUtilization * 100,
    });

    return {
      estimatedCost,
      allowed,
      reason,
      tier,
      budgetAfter,
      warningTriggered,
    };
  }

  /**
   * 🔥 BEAST MODE: Track actual cost and check for limit breaches
   */
  async trackOperationCost(
    provider: ProviderName,
    agentId: string,
    actualCost: number,
    inputTokens: number,
    outputTokens: number,
    operation: string = 'unknown'
  ): Promise<{
    recorded: boolean;
    warningTriggered: boolean;
    agentPaused: boolean;
    budgetStatus: string;
  }> {
    // Record cost in ModelRouter
    this.costController.recordCost(provider, agentId, actualCost, inputTokens, outputTokens);
    
    // Update internal tracking
    this.currentUsage.dailySpend += actualCost;
    this.currentUsage.lastUpdated = new Date().toISOString();
    
    const costSummary = this.costController.getCostSummary();
    const dailyUtilization = costSummary.daily / this.financialGates.dailySpendLimit;
    const agentSpend = costSummary.topAgents.find(a => a.agentId === agentId)?.spent || 0;
    
    let warningTriggered = false;
    let agentPaused = false;
    let budgetStatus = 'OK';

    // Check for daily limit breach (95% = pause)
    if (dailyUtilization >= 0.95) {
      this.pauseAllAgents('Daily budget limit reached');
      budgetStatus = 'DAILY_LIMIT_EXCEEDED';
    }
    
    // Check for agent limit breach
    else if (agentSpend >= this.financialGates.perAgentLimit) {
      this.pauseAgent(agentId, 'Agent spending limit reached');
      agentPaused = true;
      budgetStatus = 'AGENT_LIMIT_EXCEEDED';
    }
    
    // Check for warning thresholds (80%)
    else if (dailyUtilization >= 0.8) {
      const warningKey = `daily_${Math.floor(dailyUtilization * 100)}`;
      if (!this.warningThresholds[warningKey]) {
        this.warningThresholds[warningKey] = true;
        warningTriggered = true;
        budgetStatus = `WARNING_${Math.floor(dailyUtilization * 100)}PCT`;
        console.warn(`🚨 Cost Warning: Daily budget at ${(dailyUtilization * 100).toFixed(1)}% - $${costSummary.daily.toFixed(4)}/$${this.financialGates.dailySpendLimit}`);
      }
    }

    // Log the cost tracking
    await this.logThresholdCheck({
      timestamp: new Date().toISOString(),
      type: 'cost_tracking',
      limit: this.financialGates.dailySpendLimit,
      value: costSummary.daily,
      result: agentPaused ? 'paused' : (warningTriggered ? 'warning' : 'allowed'),
      reason: `${operation}: $${actualCost.toFixed(6)} via ${provider}`,
      agentId,
      provider,
      actualCost,
      modelTier: getProviderTier(provider),
      budgetUtilization: dailyUtilization * 100,
    });

    return {
      recorded: true,
      warningTriggered,
      agentPaused,
      budgetStatus,
    };
  }

  /**
   * 🔥 BEAST MODE: Pause individual agent
   */
  private pauseAgent(agentId: string, reason: string): void {
    this.pausedAgents.add(agentId);
    console.error(`⏸️ Agent ${agentId} PAUSED: ${reason}`);
  }

  /**
   * 🔥 BEAST MODE: Pause all agents (emergency stop)
   */
  private pauseAllAgents(reason: string): void {
    // Mark all active agents as paused
    const costSummary = this.costController.getCostSummary();
    for (const agent of costSummary.topAgents) {
      this.pausedAgents.add(agent.agentId);
    }
    console.error(`⏸️ ALL AGENTS PAUSED: ${reason}`);
  }

  /**
   * 🔥 BEAST MODE: Resume agent (manual intervention)
   */
  resumeAgent(agentId: string): void {
    this.pausedAgents.delete(agentId);
    console.log(`▶️ Agent ${agentId} RESUMED`);
  }

  /**
   * 🔥 BEAST MODE: Resume all agents
   */
  resumeAllAgents(): void {
    this.pausedAgents.clear();
    this.warningThresholds = {}; // Reset warnings
    console.log(`▶️ ALL AGENTS RESUMED`);
  }

  /**
   * 🔥 BEAST MODE: Get cost-aware usage stats
   */
  getCostAwareUsageStats(): UsageStats & {
    costBreakdown: any;
    pausedAgentCount: number;
    pausedAgents: string[];
    costEfficiencyScore: number;
    recommendedProvider: string;
  } {
    const costSummary = this.costController.getCostSummary();
    const baseStats = this.getUsageStats();
    
    // Calculate cost efficiency score
    const avgCostPerCall = costSummary.topProviders.reduce((avg, p) => {
      return avg + (p.spent / p.calls);
    }, 0) / costSummary.topProviders.length;
    
    const costEfficiencyScore = Math.max(0, 100 - (avgCostPerCall * 1000)); // Scale to 0-100
    
    // Recommend most cost-efficient provider
    const recommendedProvider = costSummary.topProviders
      .sort((a, b) => (a.spent / a.calls) - (b.spent / b.calls))[0]?.provider || 'ollama';

    return {
      ...baseStats,
      dailySpend: costSummary.daily,
      costBreakdown: {
        daily: costSummary.daily,
        total: costSummary.total,
        byAgent: costSummary.topAgents,
        byProvider: costSummary.topProviders,
        budgetUtilization: {
          daily: (costSummary.daily / this.financialGates.dailySpendLimit) * 100,
          total: (costSummary.total / (this.financialGates.dailySpendLimit * 30)) * 100,
        },
      },
      pausedAgentCount: this.pausedAgents.size,
      pausedAgents: Array.from(this.pausedAgents),
      costEfficiencyScore: Math.round(costEfficiencyScore),
      recommendedProvider,
    };
  }

  /**
   * Check if a resource usage is within limits with formal verification
   */
  async checkResourceLimit(resource: keyof ResourceLimits, value: number, agentId?: string): Promise<boolean> {
    const limit = this.resourceLimits[resource];
    let allowed = value <= limit;
    let verificationData: any = {};

    // Apply formal verification for critical resource decisions
    if (this.formalVerificationEnabled && this.isCriticalResource(resource, value)) {
      const verificationResult = await this.verifyResourceDecision(resource, value, limit, agentId);
      
      // Override decision if formal verification fails
      if (verificationResult.formalProof && !verificationResult.verified) {
        allowed = false;
        console.warn(`🔐 Formal verification overrode resource decision: ${resource}=${value} blocked`);
      }

      verificationData = {
        formalProofId: verificationResult.proofId,
        verificationResult: verificationResult.verified ? 'verified' : 'failed',
        riskScore: verificationResult.riskScore,
        byzantineConsensus: verificationResult.consensusAchieved
      };
    }
    
    await this.logThresholdCheck({
      timestamp: new Date().toISOString(),
      type: 'resource',
      resource,
      limit,
      value,
      result: allowed ? 'allowed' : 'blocked',
      agentId,
      ...verificationData
    });

    return allowed;
  }

  /**
   * Determine if a resource decision requires formal verification
   */
  private isCriticalResource(resource: keyof ResourceLimits, value: number): boolean {
    const utilizationThreshold = 0.8; // 80% of limit is considered critical
    const limit = this.resourceLimits[resource];
    const utilization = value / limit;

    return utilization >= utilizationThreshold || 
           resource === 'maxConcurrentAgents' || 
           (resource === 'maxMemoryMB' && value > 1000);
  }

  /**
   * Formally verify a resource limit decision using Lean proofs
   */
  private async verifyResourceDecision(
    resource: keyof ResourceLimits, 
    value: number, 
    limit: number, 
    agentId?: string
  ): Promise<{
    verified: boolean;
    proofId?: string;
    riskScore: number;
    consensusAchieved: boolean;
    formalProof?: any;
  }> {
    try {
      // Register agent if not already registered
      const verificationAgentId = agentId || 'threshold_enforcer';
      if (!formalVerifier.getRegisteredAgents().includes(verificationAgentId)) {
        formalVerifier.registerAgent(verificationAgentId);
      }

      // Create action context for resource limit decision
      const actionContext: ActionContext = {
        agentId: verificationAgentId,
        action: 'resource_limit_check',
        parameters: { resource, value, limit },
        preconditions: [
          `resource_usage(${resource}) = ${value}`,
          `resource_limit(${resource}) = ${limit}`,
          'threshold_enforcer_active'
        ],
        postconditions: [
          value <= limit ? `allowed(${resource}, ${value})` : `blocked(${resource}, ${value})`
        ],
        safety_level: this.assessResourceSafetyLevel(resource, value, limit),
        resource_impact: {
          memory: resource === 'maxMemoryMB' ? value : 10,
          cpu: resource === 'maxConcurrentAgents' ? value * 10 : 5,
          network: false,
          filesystem: false,
          external_api: false
        }
      };

      // Perform formal verification
      const verificationResult = await formalVerifier.verifyAction(actionContext);

      // For high-risk decisions, require Byzantine consensus
      let consensusAchieved = true;
      if (verificationResult.risk_score >= 70) {
        // Create multiple verification contexts for consensus
        const consensusContexts = [actionContext, actionContext, actionContext];
        consensusAchieved = await formalVerifier.verifyByzantineConsensus(consensusContexts, 0.67);
      }

      return {
        verified: verificationResult.valid && verificationResult.execution_allowed,
        proofId: verificationResult.proof?.id,
        riskScore: verificationResult.risk_score,
        consensusAchieved,
        formalProof: verificationResult.proof
      };

    } catch (error: unknown) {
      console.error(`❌ Formal verification error for resource decision:`, error);
      return {
        verified: false,
        riskScore: 100,
        consensusAchieved: false
      };
    }
  }

  /**
   * Assess safety level for resource limit decisions
   */
  private assessResourceSafetyLevel(
    resource: keyof ResourceLimits, 
    value: number, 
    limit: number
  ): 'low' | 'medium' | 'high' | 'critical' {
    const utilization = value / limit;

    if (utilization >= 0.95) return 'critical';
    if (utilization >= 0.85) return 'high';
    if (utilization >= 0.70) return 'medium';
    return 'low';
  }

  /**
   * Request financial approval for operations above threshold with formal verification
   * NOW WITH COSTCONTROLLER INTEGRATION
   */
  async requestFinancialApproval(amount: number, reason: string, agentId?: string): Promise<boolean> {
    // Check if agent is paused first
    if (agentId && this.isAgentPaused(agentId)) {
      await this.logThresholdCheck({
        timestamp: new Date().toISOString(),
        type: 'financial',
        amount,
        limit: this.financialGates.requireApprovalAbove,
        value: amount,
        result: 'blocked',
        reason: 'Agent is paused due to cost limits',
        agentId,
      });
      return false;
    }

    // Get real-time cost data from CostController
    const costSummary = this.costController.getCostSummary();
    const currentDailySpend = costSummary.daily;
    const agentSpend = agentId ? (costSummary.topAgents.find(a => a.agentId === agentId)?.spent || 0) : 0;
    
    const requiresApproval = amount > this.financialGates.requireApprovalAbove;
    const exceedsDailyLimit = (currentDailySpend + amount) > this.financialGates.dailySpendLimit;
    const exceedsAgentLimit = agentId ? ((agentSpend + amount) > this.financialGates.perAgentLimit) : false;
    const budgetUtilization = ((currentDailySpend + amount) / this.financialGates.dailySpendLimit) * 100;
    
    let verificationData: any = {};

    // Apply formal verification for significant financial decisions
    if (this.formalVerificationEnabled && (amount >= 50 || requiresApproval)) {
      const verificationResult = await this.verifyFinancialDecision(amount, reason, agentId);
      
      verificationData = {
        formalProofId: verificationResult.proofId,
        verificationResult: verificationResult.verified ? 'verified' : 'failed',
        riskScore: verificationResult.riskScore,
        byzantineConsensus: verificationResult.consensusAchieved
      };

      // If formal verification fails, block even if within normal limits
      if (!verificationResult.verified && verificationResult.riskScore >= 80) {
        await this.logThresholdCheck({
          timestamp: new Date().toISOString(),
          type: 'financial',
          amount,
          limit: this.financialGates.requireApprovalAbove,
          value: amount,
          result: 'blocked',
          reason: `Formal verification failed: ${reason}`,
          agentId,
          budgetUtilization,
          ...verificationData
        });
        
        console.error(`🔐 Formal verification blocked financial decision: $${amount} - ${reason}`);
        return false;
      }
    }

    // Log the financial check with real-time cost data
    await this.logThresholdCheck({
      timestamp: new Date().toISOString(),
      type: 'financial',
      amount,
      limit: this.financialGates.requireApprovalAbove,
      value: amount,
      result: requiresApproval || exceedsDailyLimit || exceedsAgentLimit ? 'approval_requested' : 'allowed',
      reason: `${reason} (Current daily: $${currentDailySpend.toFixed(4)}, Agent: $${agentSpend.toFixed(4)})`,
      agentId,
      budgetUtilization,
      ...verificationData
    });

    // If amount is small and within limits, auto-approve
    if (!requiresApproval && !exceedsDailyLimit && !exceedsAgentLimit) {
      this.currentUsage.dailySpend = currentDailySpend; // Sync with CostController
      this.currentUsage.lastUpdated = new Date().toISOString();
      
      // Check for warning thresholds
      if (budgetUtilization >= 80) {
        console.warn(`🚨 Cost Warning: Operation approved but budget at ${budgetUtilization.toFixed(1)}%`);
      }
      
      return true;
    }

    // Enhanced logging for denied operations
    console.warn(`🚨 Financial approval required: $${amount.toFixed(4)} for ${reason}`);
    console.warn(`   - Current daily spend: $${currentDailySpend.toFixed(4)}/$${this.financialGates.dailySpendLimit}`);
    if (agentId) {
      console.warn(`   - Agent spend: $${agentSpend.toFixed(4)}/$${this.financialGates.perAgentLimit}`);
    }
    console.warn(`   - Requires approval: ${requiresApproval}`);
    console.warn(`   - Exceeds daily limit: ${exceedsDailyLimit}`);
    console.warn(`   - Exceeds agent limit: ${exceedsAgentLimit}`);
    console.warn(`   - Budget utilization: ${budgetUtilization.toFixed(1)}%`);
    
    return false;
  }

  /**
   * Formally verify a financial decision using mathematical proofs
   */
  private async verifyFinancialDecision(
    amount: number, 
    reason: string, 
    agentId?: string
  ): Promise<{
    verified: boolean;
    proofId?: string;
    riskScore: number;
    consensusAchieved: boolean;
  }> {
    try {
      // Register agent if needed
      const verificationAgentId = agentId || 'financial_controller';
      if (!formalVerifier.getRegisteredAgents().includes(verificationAgentId)) {
        formalVerifier.registerAgent(verificationAgentId);
      }

      // Create action context for financial decision
      const actionContext: ActionContext = {
        agentId: verificationAgentId,
        action: 'financial_approval',
        parameters: { amount, reason, current_spend: this.currentUsage.dailySpend },
        preconditions: [
          `financial_amount = ${amount}`,
          `daily_spend = ${this.currentUsage.dailySpend}`,
          `daily_limit = ${this.financialGates.dailySpendLimit}`,
          `approval_threshold = ${this.financialGates.requireApprovalAbove}`,
          'financial_controls_active'
        ],
        postconditions: [
          amount <= this.financialGates.perAgentLimit ? `within_agent_limit(${amount})` : `exceeds_agent_limit(${amount})`,
          (this.currentUsage.dailySpend + amount) <= this.financialGates.dailySpendLimit ? 
            'within_daily_limit' : 'exceeds_daily_limit'
        ],
        safety_level: this.assessFinancialSafetyLevel(amount),
        resource_impact: {
          memory: 5,
          cpu: 5,
          network: true,  // Financial operations often involve external APIs
          filesystem: false,
          external_api: true
        }
      };

      // Perform formal verification
      const verificationResult = await formalVerifier.verifyAction(actionContext);

      // For high-value transactions, require Byzantine consensus
      let consensusAchieved = true;
      if (amount >= 100 || verificationResult.risk_score >= 70) {
        const consensusContexts = [actionContext, actionContext, actionContext];
        consensusAchieved = await formalVerifier.verifyByzantineConsensus(consensusContexts, 0.67);
        
        if (consensusAchieved) {
          console.log(`🛡️ Byzantine consensus achieved for $${amount} financial decision`);
        } else {
          console.warn(`⚠️ Byzantine consensus FAILED for $${amount} financial decision`);
        }
      }

      return {
        verified: verificationResult.valid && verificationResult.execution_allowed && consensusAchieved,
        proofId: verificationResult.proof?.id,
        riskScore: verificationResult.risk_score,
        consensusAchieved
      };

    } catch (error: unknown) {
      console.error(`❌ Formal verification error for financial decision:`, error);
      return {
        verified: false,
        riskScore: 100,
        consensusAchieved: false
      };
    }
  }

  /**
   * Assess safety level for financial decisions
   */
  private assessFinancialSafetyLevel(amount: number): 'low' | 'medium' | 'high' | 'critical' {
    if (amount >= 200) return 'critical';
    if (amount >= 100) return 'high';
    if (amount >= 50) return 'medium';
    return 'low';
  }

  /**
   * Get current usage statistics with formal verification data
   */
  getUsageStats(): UsageStats & { verificationStats?: any } {
    // Update memory usage
    const memUsage = process.memoryUsage();
    this.currentUsage.memoryUsageMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    this.currentUsage.lastUpdated = new Date().toISOString();
    
    const stats = { ...this.currentUsage };

    // Add formal verification statistics if enabled
    if (this.formalVerificationEnabled) {
      (stats as any).verificationStats = {
        registeredAgents: formalVerifier.getRegisteredAgents().length,
        totalProofs: formalVerifier.getProofStats().total,
        verifiedProofs: formalVerifier.getProofStats().verified,
        averageProofTime: formalVerifier.getProofStats().avgProofTime,
        hashChainLength: formalVerifier.getHashChainLength()
      };
    }
    
    return stats;
  }

  /**
   * Enforce a specific limit by updating usage counters
   */
  enforceLimit(limitType: 'agents' | 'toolCalls' | 'context' | 'dailySpend', value?: number): void {
    switch (limitType) {
      case 'agents':
        this.currentUsage.activeAgents = Math.max(0, this.currentUsage.activeAgents + (value || 0));
        break;
      case 'toolCalls':
        this.currentUsage.totalToolCalls += (value || 1);
        break;
      case 'context':
        this.currentUsage.contextCharsUsed += (value || 0);
        break;
      case 'dailySpend':
        this.currentUsage.dailySpend += (value || 0);
        break;
    }
    this.currentUsage.lastUpdated = new Date().toISOString();
  }

  /**
   * Reset daily counters (should be called daily via cron)
   */
  resetDailyCounters(): void {
    this.currentUsage.dailySpend = 0;
    this.currentUsage.totalToolCalls = 0;
    this.currentUsage.contextCharsUsed = 0;
    this.currentUsage.lastUpdated = new Date().toISOString();
  }

  /**
   * Update resource limits
   */
  updateResourceLimits(newLimits: Partial<ResourceLimits>): void {
    this.resourceLimits = { ...this.resourceLimits, ...newLimits };
  }

  /**
   * Update financial gates
   */
  updateFinancialGates(newGates: Partial<FinancialGates>): void {
    this.financialGates = { ...this.financialGates, ...newGates };
  }

  /**
   * Get current limits
   */
  getLimits(): { resource: ResourceLimits; financial: FinancialGates } {
    return {
      resource: { ...this.resourceLimits },
      financial: { ...this.financialGates }
    };
  }

  /**
   * Get audit log (recent entries)
   */
  async getAuditLog(limit: number = 100): Promise<ThresholdCheckLog[]> {
    try {
      const logContent = await fs.readFile(this.auditLogPath, 'utf8');
      const logs = logContent.trim().split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line) as ThresholdCheckLog)
        .slice(-limit);
      
      return logs.reverse(); // Most recent first
    } catch (error: unknown) {
      console.warn('Failed to read audit log:', error);
      return [];
    }
  }

  // --- Private Methods ---

  private async ensureAuditLogExists(): Promise<void> {
    try {
      const logDir = join(this.auditLogPath, '..');
      await fs.mkdir(logDir, { recursive: true });
      await fs.access(this.auditLogPath);
    } catch {
      // File doesn't exist, create it with initial structure
      await this.writeAuditLog({
        timestamp: new Date().toISOString(),
        type: 'resource',
        resource: 'maxContextChars',
        limit: 0,
        value: 0,
        result: 'allowed',
        reason: 'Audit log initialized'
      });
    }
  }

  private async logThresholdCheck(entry: ThresholdCheckLog): Promise<void> {
    await this.writeAuditLog(entry);
  }

  private async writeAuditLog(entry: ThresholdCheckLog): Promise<void> {
    try {
      const logLine = JSON.stringify(entry) + '\n';
      await fs.appendFile(this.auditLogPath, logLine, 'utf8');
    } catch (error: unknown) {
      console.error('Failed to write audit log:', error);
    }
  }
}

// --- Global Instance ---

let globalEnforcer: ThresholdEnforcer | null = null;

/**
 * Get or create the global threshold enforcer instance
 */
export function getThresholdEnforcer(
  resourceLimits?: Partial<ResourceLimits>,
  financialGates?: Partial<FinancialGates>
): ThresholdEnforcer {
  if (!globalEnforcer) {
    globalEnforcer = new ThresholdEnforcer(resourceLimits, financialGates);
  }
  return globalEnforcer;
}

/**
 * Convenience functions for common threshold checks
 */
export async function checkResourceThreshold(
  resource: keyof ResourceLimits, 
  value: number, 
  agentId?: string
): Promise<boolean> {
  const enforcer = getThresholdEnforcer();
  return enforcer.checkResourceLimit(resource, value, agentId);
}

export async function requestFinancialApproval(
  amount: number, 
  reason: string, 
  agentId?: string
): Promise<boolean> {
  const enforcer = getThresholdEnforcer();
  return enforcer.requestFinancialApproval(amount, reason, agentId);
}

export function getUsageStats(): UsageStats {
  const enforcer = getThresholdEnforcer();
  return enforcer.getUsageStats();
}

export function enforceLimit(
  limitType: 'agents' | 'toolCalls' | 'context' | 'dailySpend', 
  value?: number
): void {
  const enforcer = getThresholdEnforcer();
  enforcer.enforceLimit(limitType, value);
}

// --- 🔥 BEAST MODE: New Cost-Aware Functions ---

/**
 * 🔥 Check if agent is paused due to cost limits
 */
export function isAgentPaused(agentId: string): boolean {
  const enforcer = getThresholdEnforcer();
  return enforcer.isAgentPaused(agentId);
}

/**
 * 🔥 Estimate cost before expensive operation with model-aware pricing
 */
export async function estimateOperationCost(
  provider: ProviderName,
  inputTokens: number,
  outputTokens?: number,
  agentId?: string
): Promise<{
  estimatedCost: number;
  allowed: boolean;
  reason: string;
  tier: number;
  budgetAfter: number;
  warningTriggered: boolean;
}> {
  const enforcer = getThresholdEnforcer();
  return enforcer.estimateOperationCost(provider, inputTokens, outputTokens, agentId);
}

/**
 * 🔥 Track actual operation cost with real-time monitoring
 */
export async function trackOperationCost(
  provider: ProviderName,
  agentId: string,
  actualCost: number,
  inputTokens: number,
  outputTokens: number,
  operation?: string
): Promise<{
  recorded: boolean;
  warningTriggered: boolean;
  agentPaused: boolean;
  budgetStatus: string;
}> {
  const enforcer = getThresholdEnforcer();
  return enforcer.trackOperationCost(provider, agentId, actualCost, inputTokens, outputTokens, operation);
}

/**
 * 🔥 Get comprehensive cost-aware usage statistics
 */
export function getCostAwareUsageStats(): UsageStats & {
  costBreakdown: any;
  pausedAgentCount: number;
  pausedAgents: string[];
  costEfficiencyScore: number;
  recommendedProvider: string;
} {
  const enforcer = getThresholdEnforcer();
  return enforcer.getCostAwareUsageStats();
}

/**
 * 🔥 Resume paused agent (manual intervention)
 */
export function resumeAgent(agentId: string): void {
  const enforcer = getThresholdEnforcer();
  enforcer.resumeAgent(agentId);
}

/**
 * 🔥 Resume all paused agents (emergency resume)
 */
export function resumeAllAgents(): void {
  const enforcer = getThresholdEnforcer();
  enforcer.resumeAllAgents();
}

/**
 * 🔥 Check operation against cost limits before execution
 * This is the main function agents should call before expensive operations
 */
export async function checkCostThreshold(
  provider: ProviderName,
  inputTokens: number,
  agentId: string,
  operation: string = 'LLM_CALL',
  outputTokens: number = 0
): Promise<{
  allowed: boolean;
  reason: string;
  estimatedCost: number;
  budgetUtilization: number;
}> {
  const enforcer = getThresholdEnforcer();
  
  // First check if agent is paused
  if (enforcer.isAgentPaused(agentId)) {
    return {
      allowed: false,
      reason: 'Agent is paused due to cost limits',
      estimatedCost: 0,
      budgetUtilization: 100,
    };
  }
  
  // Estimate cost and check limits
  const costCheck = await enforcer.estimateOperationCost(provider, inputTokens, outputTokens, agentId);
  
  return {
    allowed: costCheck.allowed,
    reason: costCheck.reason,
    estimatedCost: costCheck.estimatedCost,
    budgetUtilization: (costCheck.budgetAfter / enforcer.getLimits().financial.dailySpendLimit) * 100,
  };
}

// --- Export Defaults ---
export { DEFAULT_RESOURCE_LIMITS, DEFAULT_FINANCIAL_GATES };