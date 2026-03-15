// @ts-nocheck
/**
 * The Lethal Trifecta - SuperClaw's Safety Sandbox
 * 
 * Three layers of protection against runaway agents:
 * 1. PrivateDataSandbox - Data isolation and access control
 * 2. ToolPermissionBoundary - Tool usage restrictions
 * 3. RollbackCapability - Checkpoint/rollback system
 */

import { randomUUID } from 'crypto';
import { formalVerifier, ActionContext, VerificationResult } from './formal-verifier';
import { proofEngine } from './proof-engine';

// Data classification levels
export enum DataClassification {
  PUBLIC = 'PUBLIC',
  INTERNAL = 'INTERNAL', 
  PRIVATE = 'PRIVATE',
  RESTRICTED = 'RESTRICTED'
}

// Data structures
export interface SandboxedData {
  id: string;
  classification: DataClassification;
  data: any;
  allowedAgents: string[];
  createdAt: Date;
  lastAccessed: Date;
}

export interface Checkpoint {
  id: string;
  agentId: string;
  timestamp: Date;
  description: string;
  state: any;
  risky: boolean;
}

export type CheckpointId = string;

/**
 * PrivateDataSandbox - Isolates and controls data access
 */
export class PrivateDataSandbox {
  private dataStore = new Map<string, SandboxedData>();
  private agentDataAccess = new Map<string, Set<string>>();

  /**
   * Isolate data with proper classification and access controls
   */
  isolateData(agentId: string, data: any, classification: DataClassification = DataClassification.INTERNAL): SandboxedData {
    const sandboxedData: SandboxedData = {
      id: randomUUID(),
      classification,
      data: this.deepClone(data), // Prevent reference sharing
      allowedAgents: [agentId], // Creator has default access
      createdAt: new Date(),
      lastAccessed: new Date()
    };

    this.dataStore.set(sandboxedData.id, sandboxedData);
    
    // Track agent's data access
    if (!this.agentDataAccess.has(agentId)) {
      this.agentDataAccess.set(agentId, new Set());
    }
    this.agentDataAccess.get(agentId)!.add(sandboxedData.id);

    return sandboxedData;
  }

  /**
   * Check if agent has access to specific data path
   */
  checkAccess(agentId: string, dataPath: string): boolean {
    const data = this.dataStore.get(dataPath);
    if (!data) {return false;}

    // Update last accessed
    data.lastAccessed = new Date();

    // Check agent permissions
    if (data.allowedAgents.includes(agentId)) {
      return true;
    }

    // Classification-based access rules
    switch (data.classification) {
      case DataClassification.PUBLIC:
        return true;
      case DataClassification.INTERNAL:
        // Internal data can be shared between agents in same session
        return this.isSameSession(agentId, data.allowedAgents[0]);
      case DataClassification.PRIVATE:
      case DataClassification.RESTRICTED:
        return false;
    }

    return false;
  }

  /**
   * Grant access to another agent
   */
  grantAccess(dataId: string, fromAgent: string, toAgent: string): boolean {
    const data = this.dataStore.get(dataId);
    if (!data || !data.allowedAgents.includes(fromAgent)) {
      return false;
    }

    // Cannot grant access to RESTRICTED data
    if (data.classification === DataClassification.RESTRICTED) {
      return false;
    }

    data.allowedAgents.push(toAgent);
    
    if (!this.agentDataAccess.has(toAgent)) {
      this.agentDataAccess.set(toAgent, new Set());
    }
    this.agentDataAccess.get(toAgent)!.add(dataId);

    return true;
  }

  /**
   * Get data if agent has access
   */
  getData(agentId: string, dataId: string): any {
    if (!this.checkAccess(agentId, dataId)) {
      throw new Error(`Access denied: Agent ${agentId} cannot access data ${dataId}`);
    }

    const data = this.dataStore.get(dataId);
    return data ? this.deepClone(data.data) : null;
  }

  private deepClone(obj: any): any {
    return JSON.parse(JSON.stringify(obj));
  }

  private isSameSession(agentId1: string, agentId2: string): boolean {
    // Simple session check - agents with same prefix are in same session
    const session1 = agentId1.split(':')[0];
    const session2 = agentId2.split(':')[0];
    return session1 === session2;
  }
}

/**
 * ToolPermissionBoundary - Controls what tools agents can use
 */
export class ToolPermissionBoundary {
  // Safe tools that agents can use without approval
  static readonly DEFAULT_PERMISSIONS = [
    'read',
    'web_search', 
    'web_fetch',
    'image',
    'tts'
  ];

  // Elevated tools that require approval or special permissions
  static readonly ELEVATED_PERMISSIONS = [
    'write',
    'edit', 
    'exec',
    'message',
    'browser',
    'nodes'
  ];

  // Dangerous tools that require explicit approval
  static readonly DANGEROUS_PERMISSIONS = [
    'exec', // Can run arbitrary commands
    'edit', // Can modify files
    'write', // Can create files
    'message' // Can send external messages
  ];

  private allowedTools = new Map<string, string[]>();
  private approvals = new Map<string, Set<string>>();

  constructor() {
    // Initialize with default permissions for all agents
    this.setDefaultPermissions();
  }

  /**
   * Check if agent has permission to use a tool
   */
  checkToolPermission(agentId: string, toolName: string): boolean {
    const agentTools = this.allowedTools.get(agentId) || ToolPermissionBoundary.DEFAULT_PERMISSIONS;
    
    // Check explicit permissions
    if (agentTools.includes(toolName)) {
      return true;
    }

    // Check for temporary approvals
    const agentApprovals = this.approvals.get(agentId);
    if (agentApprovals && agentApprovals.has(toolName)) {
      return true;
    }

    return false;
  }

  /**
   * Grant tool permission to agent
   */
  grantToolPermission(agentId: string, toolName: string, temporary = false): void {
    if (temporary) {
      if (!this.approvals.has(agentId)) {
        this.approvals.set(agentId, new Set());
      }
      this.approvals.get(agentId)!.add(toolName);
    } else {
      const currentTools = this.allowedTools.get(agentId) || [...ToolPermissionBoundary.DEFAULT_PERMISSIONS];
      if (!currentTools.includes(toolName)) {
        currentTools.push(toolName);
        this.allowedTools.set(agentId, currentTools);
      }
    }
  }

  /**
   * Revoke tool permission from agent
   */
  revokeToolPermission(agentId: string, toolName: string): void {
    // Remove from permanent permissions
    const agentTools = this.allowedTools.get(agentId);
    if (agentTools) {
      const index = agentTools.indexOf(toolName);
      if (index > -1) {
        agentTools.splice(index, 1);
      }
    }

    // Remove from temporary approvals
    const agentApprovals = this.approvals.get(agentId);
    if (agentApprovals) {
      agentApprovals.delete(toolName);
    }
  }

  /**
   * Get all permissions for an agent
   */
  getAgentPermissions(agentId: string): string[] {
    const permanent = this.allowedTools.get(agentId) || [...ToolPermissionBoundary.DEFAULT_PERMISSIONS];
    const temporarySet = this.approvals.get(agentId);
    const temporary: string[] = [];
    
    if (temporarySet) {
      temporarySet.forEach(tool => temporary.push(tool));
    }
    
    const combined = [...permanent, ...temporary];
    return Array.from(new Set(combined));
  }

  /**
   * Check if tool requires approval
   */
  requiresApproval(toolName: string): boolean {
    return ToolPermissionBoundary.DANGEROUS_PERMISSIONS.includes(toolName);
  }

  private setDefaultPermissions(): void {
    // Default permissions are handled in checkToolPermission
  }
}

/**
 * RollbackCapability - Checkpoint and rollback system
 */
export class RollbackCapability {
  private checkpoints = new Map<string, Checkpoint>();
  private agentCheckpoints = new Map<string, string[]>();

  // Tools that should auto-create checkpoints before use
  static readonly RISKY_OPERATIONS = [
    'exec',
    'edit',
    'write',
    'message'
  ];

  /**
   * Create a checkpoint for an agent's current state
   */
  createCheckpoint(agentId: string, description = 'Manual checkpoint', state?: any, risky = false): CheckpointId {
    const checkpointId = randomUUID();
    
    const checkpoint: Checkpoint = {
      id: checkpointId,
      agentId,
      timestamp: new Date(),
      description,
      state: state || this.captureAgentState(agentId),
      risky
    };

    this.checkpoints.set(checkpointId, checkpoint);
    
    // Track agent's checkpoints
    if (!this.agentCheckpoints.has(agentId)) {
      this.agentCheckpoints.set(agentId, []);
    }
    this.agentCheckpoints.get(agentId)!.push(checkpointId);

    // Limit to last 10 checkpoints per agent
    const agentCps = this.agentCheckpoints.get(agentId)!;
    if (agentCps.length > 10) {
      const oldestId = agentCps.shift()!;
      this.checkpoints.delete(oldestId);
    }

    return checkpointId;
  }

  /**
   * Auto-create checkpoint before risky operation
   */
  autoCheckpointBefore(agentId: string, toolName: string, state?: any): CheckpointId {
    if (RollbackCapability.RISKY_OPERATIONS.includes(toolName)) {
      return this.createCheckpoint(
        agentId, 
        `Auto-checkpoint before ${toolName}`,
        state,
        true
      );
    }
    return '';
  }

  /**
   * Rollback to a specific checkpoint
   */
  rollback(checkpointId: string): void {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) {
      throw new Error(`Checkpoint ${checkpointId} not found`);
    }

    // In a real implementation, this would restore the agent's state
    console.log(`Rolling back agent ${checkpoint.agentId} to checkpoint ${checkpointId}`);
    console.log(`Restoring state from ${checkpoint.timestamp}`);
    
    // TODO: Implement actual state restoration logic
    // This would involve:
    // - Reverting file system changes
    // - Canceling pending operations
    // - Restoring agent memory/context
    // - Undoing external API calls (where possible)
  }

  /**
   * List all checkpoints for an agent
   */
  listCheckpoints(agentId: string): Checkpoint[] {
    const checkpointIds = this.agentCheckpoints.get(agentId) || [];
    return checkpointIds
      .map(id => this.checkpoints.get(id))
      .filter(cp => cp !== undefined);
  }

  /**
   * Get the latest checkpoint for an agent
   */
  getLatestCheckpoint(agentId: string): Checkpoint | null {
    const checkpoints = this.listCheckpoints(agentId);
    if (checkpoints.length === 0) {return null;}
    
    return checkpoints.reduce((latest, current) => 
      current.timestamp > latest.timestamp ? current : latest
    );
  }

  /**
   * Delete old checkpoints (cleanup)
   */
  cleanupCheckpoints(agentId: string, keepCount = 5): void {
    const checkpoints = this.listCheckpoints(agentId);
    if (checkpoints.length <= keepCount) {return;}

    // Sort by timestamp, keep most recent
    checkpoints.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    const toDelete = checkpoints.slice(keepCount);

    toDelete.forEach(cp => {
      this.checkpoints.delete(cp.id);
      const agentCps = this.agentCheckpoints.get(agentId);
      if (agentCps) {
        const index = agentCps.indexOf(cp.id);
        if (index > -1) {
          agentCps.splice(index, 1);
        }
      }
    });
  }

  private captureAgentState(agentId: string): any {
    // In a real implementation, this would capture:
    // - Agent memory/context
    // - Current working directory
    // - Environment variables
    // - Open file handles
    // - Network connections
    // - etc.
    
    return {
      agentId,
      timestamp: new Date(),
      // Placeholder for actual state capture
      workingDirectory: process.cwd(),
      environment: process.env.NODE_ENV || 'development'
    };
  }
}

/**
 * The complete Lethal Trifecta+ sandbox system with formal verification
 * 
 * Four layers of protection:
 * 1. PrivateDataSandbox - Data isolation and access control
 * 2. ToolPermissionBoundary - Tool usage restrictions
 * 3. RollbackCapability - Checkpoint/rollback system
 * 4. FormalVerification - Mathematical proof layer with Ed25519 signing
 */
export class LethalTrifectaSandbox {
  public readonly dataLayer: PrivateDataSandbox;
  public readonly permissionLayer: ToolPermissionBoundary;
  public readonly rollbackLayer: RollbackCapability;
  public readonly verificationEnabled: boolean;

  constructor(enableFormalVerification = true) {
    this.dataLayer = new PrivateDataSandbox();
    this.permissionLayer = new ToolPermissionBoundary();
    this.rollbackLayer = new RollbackCapability();
    this.verificationEnabled = enableFormalVerification;

    if (enableFormalVerification) {
      this.initializeFormalVerification();
    }
  }

  /**
   * Initialize formal verification layer
   */
  private initializeFormalVerification(): void {
    // Register proof engine event handlers
    proofEngine.on('proof_complete', (event) => {
      console.log(`✅ Formal proof completed for ${event.theorem} in ${event.metrics.proofTime}ms`);
    });

    proofEngine.on('proof_error', (event) => {
      console.error(`❌ Formal proof failed for ${event.theorem}: ${event.error}`);
    });
  }

  /**
   * Check if an agent can safely execute an operation
   */
  async canExecute(agentId: string, toolName: string, parameters?: any, dataPath?: string): Promise<boolean> {
    // Check tool permissions
    if (!this.permissionLayer.checkToolPermission(agentId, toolName)) {
      return false;
    }

    // Check data access if dataPath provided
    if (dataPath && !this.dataLayer.checkAccess(agentId, dataPath)) {
      return false;
    }

    // Formal verification check (if enabled)
    if (this.verificationEnabled) {
      const verification = await this.verifyActionFormally(agentId, toolName, parameters);
      return verification.execution_allowed;
    }

    return true;
  }

  /**
   * Perform formal verification of an action using Lean proofs and Ed25519 signatures
   */
  private async verifyActionFormally(
    agentId: string, 
    action: string, 
    parameters?: any
  ): Promise<VerificationResult> {
    try {
      // Register agent identity if not already registered
      if (!formalVerifier.getRegisteredAgents().includes(agentId)) {
        formalVerifier.registerAgent(agentId);
      }

      // Create action context for formal verification
      const actionContext: ActionContext = {
        agentId,
        action,
        parameters: parameters || {},
        preconditions: this.derivePreconditions(action, parameters),
        postconditions: this.derivePostconditions(action, parameters),
        safety_level: this.assessSafetyLevel(action, parameters),
        resource_impact: this.assessResourceImpact(action, parameters)
      };

      // Verify action using formal proofs
      const result = await formalVerifier.verifyAction(actionContext);
      
      // Log verification result
      if (result.valid && result.execution_allowed) {
        console.log(`🔐 Formal verification PASSED for ${agentId}:${action} (risk: ${result.risk_score})`);
      } else {
        console.warn(`⚠️ Formal verification FAILED for ${agentId}:${action}: ${result.error || 'Unknown reason'}`);
      }

      return result;

    } catch (error: unknown) {
      console.error(`❌ Formal verification error for ${agentId}:${action}:`, error);
      return {
        valid: false,
        error: error instanceof Error ? (error).message : 'Verification system error',
        risk_score: 100,
        execution_allowed: false
      };
    }
  }

  /**
   * Derive logical preconditions for an action
   */
  private derivePreconditions(action: string, parameters?: any): string[] {
    const preconditions: string[] = [];

    // Tool-specific preconditions
    switch (action) {
      case 'write':
      case 'edit':
        if (parameters?.path) {
          preconditions.push(`writable(${parameters.path})`);
        }
        preconditions.push('filesystem_access_granted');
        break;

      case 'exec':
        preconditions.push('command_execution_allowed');
        preconditions.push('shell_access_granted');
        if (parameters?.command) {
          preconditions.push(`safe_command(${parameters.command})`);
        }
        break;

      case 'message':
        preconditions.push('external_communication_allowed');
        if (parameters?.target) {
          preconditions.push(`authorized_recipient(${parameters.target})`);
        }
        break;

      case 'web_fetch':
      case 'web_search':
        preconditions.push('internet_access_granted');
        break;

      default:
        preconditions.push('basic_tool_access_granted');
    }

    return preconditions;
  }

  /**
   * Derive logical postconditions for an action
   */
  private derivePostconditions(action: string, parameters?: any): string[] {
    const postconditions: string[] = [];

    switch (action) {
      case 'write':
        if (parameters?.path) {
          postconditions.push(`file_exists(${parameters.path})`);
        }
        postconditions.push('filesystem_modified');
        break;

      case 'edit':
        if (parameters?.path) {
          postconditions.push(`file_modified(${parameters.path})`);
        }
        break;

      case 'exec':
        postconditions.push('command_executed');
        if (parameters?.workdir) {
          postconditions.push(`cwd_unchanged OR cwd_changed_to(${parameters.workdir})`);
        }
        break;

      case 'message':
        postconditions.push('message_sent');
        break;

      default:
        postconditions.push('action_completed');
    }

    return postconditions;
  }

  /**
   * Assess safety level of an action
   */
  private assessSafetyLevel(action: string, parameters?: any): 'low' | 'medium' | 'high' | 'critical' {
    // Critical actions
    if (action === 'exec' && parameters?.command?.includes('sudo')) {return 'critical';}
    if (action === 'exec' && parameters?.command?.includes('rm -rf')) {return 'critical';}
    if (action === 'message' && parameters?.targets?.length > 10) {return 'critical';}

    // High risk actions
    if (action === 'exec') {return 'high';}
    if (action === 'edit' && parameters?.path?.includes('/etc/')) {return 'high';}
    if (action === 'write' && parameters?.path?.startsWith('/')) {return 'high';}

    // Medium risk actions
    if (['edit', 'write', 'message'].includes(action)) {return 'medium';}

    // Low risk actions (read-only)
    return 'low';
  }

  /**
   * Assess resource impact of an action
   */
  private assessResourceImpact(action: string, parameters?: any): ActionContext['resource_impact'] {
    const impact = {
      memory: 0,
      cpu: 0,
      network: false,
      filesystem: false,
      external_api: false
    };

    switch (action) {
      case 'exec':
        impact.memory = 100; // MB estimate
        impact.cpu = 50;     // CPU percentage estimate
        break;

      case 'write':
      case 'edit':
        impact.memory = 10;
        impact.filesystem = true;
        break;

      case 'web_fetch':
      case 'web_search':
        impact.memory = 20;
        impact.network = true;
        impact.external_api = true;
        break;

      case 'message':
        impact.memory = 5;
        impact.network = true;
        impact.external_api = true;
        break;

      case 'browser':
        impact.memory = 200;
        impact.cpu = 30;
        impact.network = true;
        impact.external_api = true;
        break;

      default:
        impact.memory = 5;
        impact.cpu = 1;
    }

    return impact;
  }

  /**
   * Execute operation with full safety checks including formal verification
   */
  async safeExecute(
    agentId: string, 
    toolName: string, 
    operation: () => any, 
    parameters?: any,
    state?: any
  ): Promise<any> {
    // Create checkpoint before risky operations
    const checkpointId = this.rollbackLayer.autoCheckpointBefore(agentId, toolName, state);

    try {
      // Check permissions
      if (!this.permissionLayer.checkToolPermission(agentId, toolName)) {
        throw new Error(`Permission denied: Agent ${agentId} cannot use tool ${toolName}`);
      }

      // Formal verification check (if enabled)
      if (this.verificationEnabled) {
        const verification = await this.verifyActionFormally(agentId, toolName, parameters);
        
        if (!verification.execution_allowed) {
          throw new Error(`Formal verification failed: ${verification.error}`);
        }

        // For critical actions, require Byzantine consensus
        if (verification.risk_score >= 80) {
          const consensusAchieved = await this.requireByzantineConsensus(agentId, toolName, parameters);
          if (!consensusAchieved) {
            throw new Error('Byzantine consensus required for critical action but not achieved');
          }
        }
      }

      // Execute the operation
      const result = await operation();

      // Log successful execution with proof reference
      if (this.verificationEnabled) {
        console.log(`✅ Safely executed ${toolName} for ${agentId} with formal verification`);
      }

      return result;

    } catch (error: unknown) {
      // If we created a checkpoint and something went wrong, offer rollback
      if (checkpointId) {
        console.error(`❌ Operation failed for agent ${agentId}. Checkpoint ${checkpointId} available for rollback.`);
      }
      throw error;
    }
  }

  /**
   * Require Byzantine consensus for critical actions
   */
  private async requireByzantineConsensus(
    agentId: string,
    action: string,
    parameters?: any
  ): Promise<boolean> {
    try {
      // For now, simulate consensus by creating multiple agent contexts
      // In a real implementation, this would involve multiple actual agents
      const contexts: ActionContext[] = [
        {
          agentId: `${agentId}_consensus_1`,
          action,
          parameters: parameters || {},
          preconditions: this.derivePreconditions(action, parameters),
          postconditions: this.derivePostconditions(action, parameters),
          safety_level: this.assessSafetyLevel(action, parameters),
          resource_impact: this.assessResourceImpact(action, parameters)
        },
        {
          agentId: `${agentId}_consensus_2`,
          action,
          parameters: parameters || {},
          preconditions: this.derivePreconditions(action, parameters),
          postconditions: this.derivePostconditions(action, parameters),
          safety_level: this.assessSafetyLevel(action, parameters),
          resource_impact: this.assessResourceImpact(action, parameters)
        },
        {
          agentId: `${agentId}_consensus_3`,
          action,
          parameters: parameters || {},
          preconditions: this.derivePreconditions(action, parameters),
          postconditions: this.derivePostconditions(action, parameters),
          safety_level: this.assessSafetyLevel(action, parameters),
          resource_impact: this.assessResourceImpact(action, parameters)
        }
      ];

      // Register consensus agents
      contexts.forEach(ctx => {
        if (!formalVerifier.getRegisteredAgents().includes(ctx.agentId)) {
          formalVerifier.registerAgent(ctx.agentId);
        }
      });

      // Verify Byzantine consensus (requires 2/3 agreement)
      const consensusAchieved = await formalVerifier.verifyByzantineConsensus(contexts, 0.67);
      
      if (consensusAchieved) {
        console.log(`🛡️ Byzantine consensus achieved for ${agentId}:${action}`);
      } else {
        console.warn(`⚠️ Byzantine consensus FAILED for ${agentId}:${action}`);
      }

      return consensusAchieved;

    } catch (error: unknown) {
      console.error(`❌ Byzantine consensus error for ${agentId}:${action}:`, error);
      return false;
    }
  }

  // --- Enhanced query methods with formal verification stats ---

  /**
   * Get comprehensive sandbox stats including formal verification
   */
  getSandboxStats(): {
    dataStats: any;
    permissionStats: any;
    rollbackStats: any;
    verificationStats?: any;
  } {
    const stats = {
      dataStats: {
        totalDataItems: this.dataLayer['dataStore'].size,
        agentsWithData: this.dataLayer['agentDataAccess'].size
      },
      permissionStats: {
        agentsWithPermissions: this.permissionLayer['allowedTools'].size,
        temporaryApprovals: this.permissionLayer['approvals'].size
      },
      rollbackStats: {
        totalCheckpoints: this.rollbackLayer['checkpoints'].size,
        agentsWithCheckpoints: this.rollbackLayer['agentCheckpoints'].size
      }
    };

    if (this.verificationEnabled) {
      (stats as any).verificationStats = {
        registeredAgents: formalVerifier.getRegisteredAgents().length,
        proofStats: formalVerifier.getProofStats(),
        hashChainLength: formalVerifier.getHashChainLength()
      };
    }

    return stats;
  }

  /**
   * Get formal verification history for an agent
   */
  getVerificationHistory(agentId: string): any[] {
    if (!this.verificationEnabled) {
      return [];
    }
    return formalVerifier.getProofHistory(agentId);
  }
}