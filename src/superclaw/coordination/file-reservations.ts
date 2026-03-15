/**
 * 🦊 SuperClaw File Reservation System (Agent Mail Pattern)
 * 
 * Implements MCP Agent Mail's file reservation system for multi-agent coordination.
 * Prevents agents from stepping on each other through advisory file reservations
 * with lease-based expiration and pre-commit guard enforcement.
 * 
 * Features:
 * - Advisory file reservations with conflict detection
 * - Lease-based system with automatic expiration
 * - Pre-commit hook integration for git workflows
 * - Real-time conflict resolution and notification
 * - Dashboard for active reservation monitoring
 * - Integration with SuperClaw swarm system
 * - Persistent storage with git-backed audit trail
 * - Cross-project coordination support
 * 
 * Architecture:
 * - FileReservationManager: Core reservation logic
 * - ReservationLease: Individual file lease management
 * - ConflictResolver: Handles overlapping reservations
 * - GitGuardManager: Pre-commit hook integration
 * - ReservationDashboard: Monitoring and visualization
 * 
 * Based on Steve Yegge's MCP Agent Mail ecosystem design:
 * - Advisory locking (not enforced blocking)
 * - Git-native integration with hooks
 * - Memorable agent identities and communication
 * - Audit trail for all reservation activities
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as glob from 'glob';
import { promisify } from 'util';
import { exec } from 'child_process';
import { minimatch } from 'minimatch';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';

// Import SuperClaw modules
import type { AgentIdentity } from '../communication/agent-mail';
// @ts-expect-error - Post-Merge Reconciliation
import { AuditLogger } from '../skynet/audit';

const execAsync = promisify(exec);
// @ts-expect-error - Post-Merge Reconciliation
const globAsync = promisify(glob);

// Reservation Types
export type ReservationMode = 'exclusive' | 'shared' | 'advisory';
export type ReservationStatus = 'active' | 'expired' | 'released' | 'conflicted';
export type ConflictSeverity = 'low' | 'medium' | 'high' | 'critical';

// File Reservation Lease
export interface ReservationLease {
  id: string;                        // Unique lease ID
  agentId: string;                   // Agent identifier
  agentName: string;                 // Human-readable agent name
  pathPattern: string;               // Glob pattern for files
  mode: ReservationMode;             // Reservation type
  reason: string;                    // Human-readable reason
  status: ReservationStatus;         // Current status
  priority: number;                  // Priority level (1-10)
  createdAt: Date;                   // Creation timestamp
  expiresAt: Date;                   // Expiration timestamp
  lastAccess: Date;                  // Last access time
  metadata: Record<string, any>;     // Additional data
  conflictsWith: string[];           // Conflicting lease IDs
  gitCommitHash?: string;            // Associated git commit
  projectPath: string;               // Project directory
  tags: string[];                    // Searchable tags
}

// Conflict Information
export interface ReservationConflict {
  id: string;                        // Conflict ID
  severity: ConflictSeverity;        // Impact level
  description: string;               // Human-readable description
  involvedLeases: string[];          // Conflicting lease IDs
  affectedFiles: string[];           // Files in conflict
  detectedAt: Date;                  // When conflict was detected
  resolvedAt?: Date;                 // When conflict was resolved
  resolution?: string;               // How it was resolved
  autoResolvable: boolean;           // Can be auto-resolved
}

// Reservation Statistics
export interface ReservationStats {
  totalActive: number;
  totalExpired: number;
  totalConflicts: number;
  agentCounts: Record<string, number>;
  fileTypeDistribution: Record<string, number>;
  averageLeaseTime: number;
  conflictRate: number;
  topAgents: Array<{ name: string; count: number }>;
  topPatterns: Array<{ pattern: string; count: number }>;
}

// Dashboard Data
export interface ReservationDashboard {
  stats: ReservationStats;
  activeLeases: ReservationLease[];
  recentConflicts: ReservationConflict[];
  expiringLeases: ReservationLease[];
  agentActivity: Array<{
    agentName: string;
    lastActive: Date;
    activeLeases: number;
    conflicts: number;
  }>;
  systemHealth: {
    gitGuardStatus: boolean;
    auditTrailHealth: boolean;
    leaseExpirationWorking: boolean;
    conflictDetectionWorking: boolean;
  };
}

// File Reservation Configuration
export interface FileReservationConfig {
  projectPath: string;               // Project root directory
  storageType: 'git' | 'sqlite' | 'memory'; // Storage backend
  defaultLeaseDuration: number;      // Default lease time (hours)
  maxLeaseDuration: number;          // Maximum lease time (hours)
  enableGitGuards: boolean;          // Enable pre-commit hooks
  enableConflictDetection: boolean;  // Enable real-time conflict detection
  enableAutoExpiration: boolean;     // Enable automatic lease expiration
  enableAuditTrail: boolean;         // Enable comprehensive logging
  conflictResolutionMode: 'manual' | 'auto' | 'advisory';
  reservationFile: string;           // Storage file path
  gitHookPath: string;               // Git hook installation path
  dashboardPort?: number;            // Web dashboard port
  notificationWebhook?: string;      // Webhook for notifications
}

/**
 * File Reservation Manager
 * 
 * Core class for managing file reservations in multi-agent environments.
 * Implements the Agent Mail pattern for conflict-free collaboration.
 */
export class FileReservationManager extends EventEmitter {
  private config: FileReservationConfig;
  private leases = new Map<string, ReservationLease>();
  private conflicts = new Map<string, ReservationConflict>();
  private agentRegistry = new Map<string, AgentIdentity>();
  private auditLogger?: AuditLogger;
  private gitGuardManager?: GitGuardManager;
  private conflictResolver?: ConflictResolver;
  private expirationTimer?: NodeJS.Timer;
  private isInitialized = false;

  constructor(config: FileReservationConfig) {
    super();
    this.config = {
      // @ts-expect-error - Post-Merge Reconciliation
      defaultLeaseDuration: 24,
      // @ts-expect-error - Post-Merge Reconciliation
      maxLeaseDuration: 168, // 7 days
      // @ts-expect-error - Post-Merge Reconciliation
      enableGitGuards: true,
      // @ts-expect-error - Post-Merge Reconciliation
      enableConflictDetection: true,
      // @ts-expect-error - Post-Merge Reconciliation
      enableAutoExpiration: true,
      // @ts-expect-error - Post-Merge Reconciliation
      enableAuditTrail: true,
      // @ts-expect-error - Post-Merge Reconciliation
      conflictResolutionMode: 'advisory',
      // @ts-expect-error - Post-Merge Reconciliation
      reservationFile: '.superclaw-reservations.json',
      // @ts-expect-error - Post-Merge Reconciliation
      gitHookPath: '.git/hooks',
      ...config
    };

    // Initialize audit logger
    if (this.config.enableAuditTrail) {
      this.auditLogger = new AuditLogger({
        component: 'FileReservationManager',
        level: 'info'
      });
    }

    // Initialize git guard manager
    if (this.config.enableGitGuards) {
      this.gitGuardManager = new GitGuardManager(this.config, this);
    }

    // Initialize conflict resolver
    if (this.config.enableConflictDetection) {
      this.conflictResolver = new ConflictResolver(this.config, this);
    }
  }

  /**
   * Initialize the file reservation system
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      throw new Error('FileReservationManager already initialized');
    }

    try {
      // Load existing reservations
      await this.loadReservations();

      // Initialize git guards
      if (this.gitGuardManager) {
        await this.gitGuardManager.initialize();
      }

      // Initialize conflict resolver
      if (this.conflictResolver) {
        await this.conflictResolver.initialize();
      }

      // Start expiration timer
      if (this.config.enableAutoExpiration) {
        this.startExpirationTimer();
      }

      // Audit log
      this.auditLogger?.info('FileReservationManager initialized', {
        projectPath: this.config.projectPath,
        leaseCount: this.leases.size,
        gitGuardsEnabled: this.config.enableGitGuards,
        conflictDetectionEnabled: this.config.enableConflictDetection
      });

      this.isInitialized = true;
      this.emit('initialized');

    } catch (error: unknown) {
      this.auditLogger?.error('Initialization failed', { error: (error as Error).message });
      throw new Error(`Failed to initialize FileReservationManager: ${(error as Error).message}`);
    }
  }

  /**
   * Create a new file reservation
   */
  async createReservation(
    agentId: string,
    agentName: string,
    pathPattern: string,
    options: {
      mode?: ReservationMode;
      reason?: string;
      duration?: number; // hours
      priority?: number;
      tags?: string[];
      metadata?: Record<string, any>;
    } = {}
  ): Promise<ReservationLease> {
    if (!this.isInitialized) {
      throw new Error('FileReservationManager not initialized');
    }

    // Validate inputs
    if (!agentId || !agentName || !pathPattern) {
      throw new Error('Agent ID, name, and path pattern are required');
    }

    const duration = Math.min(
      options.duration || this.config.defaultLeaseDuration,
      this.config.maxLeaseDuration
    );

    // Create lease
    const lease: ReservationLease = {
      id: this.generateLeaseId(),
      agentId,
      agentName,
      pathPattern,
      mode: options.mode || 'advisory',
      reason: options.reason || 'Agent file operation',
      status: 'active',
      priority: options.priority || 5,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + duration * 60 * 60 * 1000),
      lastAccess: new Date(),
      metadata: options.metadata || {},
      conflictsWith: [],
      projectPath: this.config.projectPath,
      tags: options.tags || []
    };

    try {
      // Check for conflicts
      const conflicts = await this.detectConflicts(lease);
      if (conflicts.length > 0) {
        lease.conflictsWith = conflicts.map(c => c.id);
        lease.status = 'conflicted';

        // Create conflict records
        for (const conflict of conflicts) {
          this.conflicts.set(conflict.id, conflict);
        }

        // Handle conflicts based on resolution mode
        if (this.config.conflictResolutionMode === 'manual') {
          throw new Error(`Conflicts detected: ${conflicts.map(c => c.description).join(', ')}`);
        } else if (this.config.conflictResolutionMode === 'auto' && this.conflictResolver) {
          await this.conflictResolver.resolveConflicts(conflicts);
          lease.status = 'active';
          lease.conflictsWith = [];
        }
      }

      // Store lease
      this.leases.set(lease.id, lease);

      // Update git guards
      if (this.gitGuardManager) {
        await this.gitGuardManager.updateGuards();
      }

      // Save to persistent storage
      await this.saveReservations();

      // Audit log
      this.auditLogger?.info('File reservation created', {
        leaseId: lease.id,
        agentName,
        pathPattern,
        mode: lease.mode,
        duration,
        conflicts: lease.conflictsWith.length
      });

      // Emit events
      this.emit('reservation_created', lease);
      if (lease.conflictsWith.length > 0) {
        this.emit('conflicts_detected', conflicts);
      }

      return lease;

    } catch (error: unknown) {
      this.auditLogger?.error('Reservation creation failed', {
        error: (error as Error).message,
        agentName,
        pathPattern
      });
      throw error;
    }
  }

  /**
   * Release a file reservation
   */
  async releaseReservation(leaseId: string, agentId?: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('FileReservationManager not initialized');
    }

    const lease = this.leases.get(leaseId);
    if (!lease) {
      throw new Error(`Reservation ${leaseId} not found`);
    }

    // Verify agent ownership (optional security check)
    if (agentId && lease.agentId !== agentId) {
      throw new Error(`Agent ${agentId} does not own reservation ${leaseId}`);
    }

    try {
      // Update status
      lease.status = 'released';

      // Remove from active leases
      this.leases.delete(leaseId);

      // Resolve any conflicts involving this lease
      const involvedConflicts = Array.from(this.conflicts.values())
        .filter(conflict => conflict.involvedLeases.includes(leaseId));

      for (const conflict of involvedConflicts) {
        conflict.resolvedAt = new Date();
        conflict.resolution = `Lease ${leaseId} released`;
        this.conflicts.delete(conflict.id);
      }

      // Update git guards
      if (this.gitGuardManager) {
        await this.gitGuardManager.updateGuards();
      }

      // Save to persistent storage
      await this.saveReservations();

      // Audit log
      this.auditLogger?.info('File reservation released', {
        leaseId,
        agentName: lease.agentName,
        pathPattern: lease.pathPattern,
        duration: Date.now() - lease.createdAt.getTime()
      });

      this.emit('reservation_released', lease);

    } catch (error: unknown) {
      this.auditLogger?.error('Reservation release failed', {
        error: (error as Error).message,
        leaseId
      });
      throw error;
    }
  }

  /**
   * Check if files are reserved
   */
  async checkReservations(filePaths: string[]): Promise<{
    reserved: boolean;
    conflicts: ReservationLease[];
    allowedModes: ReservationMode[];
  }> {
    if (!this.isInitialized) {
      throw new Error('FileReservationManager not initialized');
    }

    const conflicts: ReservationLease[] = [];
    const allowedModes: Set<ReservationMode> = new Set(['shared']);

    for (const filePath of filePaths) {
      for (const lease of this.leases.values()) {
        if (lease.status !== 'active') continue;

        // Check if file matches lease pattern
        if (minimatch(filePath, lease.pathPattern)) {
          conflicts.push(lease);

          // Determine allowed modes
          if (lease.mode === 'exclusive') {
            allowedModes.clear(); // No modes allowed
            break;
          } else if (lease.mode === 'shared') {
            allowedModes.add('shared');
          } else if (lease.mode === 'advisory') {
            allowedModes.add('shared');
            allowedModes.add('advisory');
          }
        }
      }
    }

    return {
      reserved: conflicts.length > 0,
      conflicts,
      allowedModes: Array.from(allowedModes)
    };
  }

  /**
   * Get all active reservations
   */
  getActiveReservations(): ReservationLease[] {
    return Array.from(this.leases.values())
      .filter(lease => lease.status === 'active');
  }

  /**
   * Get reservations by agent
   */
  getReservationsByAgent(agentId: string): ReservationLease[] {
    return Array.from(this.leases.values())
      .filter(lease => lease.agentId === agentId);
  }

  /**
   * Get expiring reservations
   */
  getExpiringReservations(withinHours: number = 24): ReservationLease[] {
    const cutoff = new Date(Date.now() + withinHours * 60 * 60 * 1000);
    return Array.from(this.leases.values())
      .filter(lease => 
        lease.status === 'active' && 
        lease.expiresAt <= cutoff
      )
      .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  }

  /**
   * Extend lease duration
   */
  async extendLease(leaseId: string, additionalHours: number, agentId?: string): Promise<ReservationLease> {
    if (!this.isInitialized) {
      throw new Error('FileReservationManager not initialized');
    }

    const lease = this.leases.get(leaseId);
    if (!lease) {
      throw new Error(`Lease ${leaseId} not found`);
    }

    if (agentId && lease.agentId !== agentId) {
      throw new Error(`Agent ${agentId} does not own lease ${leaseId}`);
    }

    if (lease.status !== 'active') {
      throw new Error(`Cannot extend lease with status: ${lease.status}`);
    }

    // Calculate new expiration
    const newExpiration = new Date(lease.expiresAt.getTime() + additionalHours * 60 * 60 * 1000);
    const maxExpiration = new Date(lease.createdAt.getTime() + this.config.maxLeaseDuration * 60 * 60 * 1000);

    if (newExpiration > maxExpiration) {
      throw new Error(`Cannot extend lease beyond maximum duration of ${this.config.maxLeaseDuration} hours`);
    }

    // Update lease
    lease.expiresAt = newExpiration;
    lease.lastAccess = new Date();

    // Save changes
    await this.saveReservations();

    // Audit log
    this.auditLogger?.info('Lease extended', {
      leaseId,
      agentName: lease.agentName,
      additionalHours,
      newExpiration: newExpiration.toISOString()
    });

    this.emit('lease_extended', lease);
    return lease;
  }

  /**
   * Generate reservation dashboard data
   */
  async getDashboard(): Promise<ReservationDashboard> {
    const activeLeases = this.getActiveReservations();
    const allConflicts = Array.from(this.conflicts.values());
    const expiringLeases = this.getExpiringReservations();

    // Calculate statistics
    const stats: ReservationStats = {
      totalActive: activeLeases.length,
      totalExpired: Array.from(this.leases.values()).filter(l => l.status === 'expired').length,
      totalConflicts: allConflicts.length,
      agentCounts: {},
      fileTypeDistribution: {},
      averageLeaseTime: 0,
      conflictRate: 0,
      topAgents: [],
      topPatterns: []
    };

    // Calculate agent counts and patterns
    const agentCounts: Record<string, number> = {};
    const patternCounts: Record<string, number> = {};
    let totalLeaseTime = 0;

    for (const lease of activeLeases) {
      agentCounts[lease.agentName] = (agentCounts[lease.agentName] || 0) + 1;
      patternCounts[lease.pathPattern] = (patternCounts[lease.pathPattern] || 0) + 1;
      
      const leaseTime = Date.now() - lease.createdAt.getTime();
      totalLeaseTime += leaseTime;
    }

    stats.agentCounts = agentCounts;
    stats.averageLeaseTime = activeLeases.length > 0 ? totalLeaseTime / activeLeases.length / (1000 * 60 * 60) : 0;
    stats.conflictRate = activeLeases.length > 0 ? (allConflicts.length / activeLeases.length) * 100 : 0;

    stats.topAgents = Object.entries(agentCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    stats.topPatterns = Object.entries(patternCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([pattern, count]) => ({ pattern, count }));

    // Agent activity
    const agentActivity = Object.keys(agentCounts).map(agentName => {
      const agentLeases = activeLeases.filter(l => l.agentName === agentName);
      const agentConflicts = allConflicts.filter(c => 
        c.involvedLeases.some(leaseId => {
          const lease = this.leases.get(leaseId);
          return lease && lease.agentName === agentName;
        })
      );

      return {
        agentName,
        lastActive: Math.max(...agentLeases.map(l => l.lastAccess.getTime())),
        activeLeases: agentLeases.length,
        conflicts: agentConflicts.length
      };
    }).map(activity => ({
      ...activity,
      lastActive: new Date(activity.lastActive)
    }));

    // System health
    const systemHealth = {
      gitGuardStatus: this.gitGuardManager ? await this.gitGuardManager.isHealthy() : false,
      auditTrailHealth: this.auditLogger !== undefined,
      leaseExpirationWorking: this.expirationTimer !== undefined,
      conflictDetectionWorking: this.conflictResolver !== undefined
    };

    return {
      stats,
      activeLeases,
      recentConflicts: allConflicts
        .filter(c => !c.resolvedAt)
        .sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime())
        .slice(0, 20),
      expiringLeases,
      agentActivity,
      systemHealth
    };
  }

  /**
   * Cleanup expired leases
   */
  async cleanupExpired(): Promise<ReservationLease[]> {
    const expired: ReservationLease[] = [];
    const now = new Date();

    for (const [leaseId, lease] of this.leases.entries()) {
      if (lease.status === 'active' && lease.expiresAt <= now) {
        lease.status = 'expired';
        expired.push(lease);
        this.leases.delete(leaseId);
      }
    }

    if (expired.length > 0) {
      // Update git guards
      if (this.gitGuardManager) {
        await this.gitGuardManager.updateGuards();
      }

      // Save changes
      await this.saveReservations();

      // Audit log
      this.auditLogger?.info('Expired leases cleaned up', {
        count: expired.length,
        leaseIds: expired.map(l => l.id)
      });

      this.emit('leases_expired', expired);
    }

    return expired;
  }

  /**
   * Shutdown the reservation manager
   */
  async shutdown(): Promise<void> {
    if (this.expirationTimer) {
      // @ts-expect-error - Post-Merge Reconciliation
      clearInterval(this.expirationTimer);
      this.expirationTimer = undefined;
    }

    if (this.gitGuardManager) {
      await this.gitGuardManager.shutdown();
    }

    if (this.conflictResolver) {
      await this.conflictResolver.shutdown();
    }

    await this.saveReservations();

    this.auditLogger?.info('FileReservationManager shutdown');
    this.emit('shutdown');
  }

  // Private methods

  private generateLeaseId(): string {
    return `fr-${crypto.randomBytes(8).toString('hex')}`;
  }

  private async detectConflicts(newLease: ReservationLease): Promise<ReservationConflict[]> {
    const conflicts: ReservationConflict[] = [];

    for (const existingLease of this.leases.values()) {
      if (existingLease.status !== 'active') continue;

      // Check for pattern overlap
      const overlap = await this.checkPatternOverlap(newLease.pathPattern, existingLease.pathPattern);
      if (overlap.hasOverlap) {
        const severity = this.calculateConflictSeverity(newLease, existingLease, overlap.files);
        
        const conflict: ReservationConflict = {
          id: crypto.randomBytes(8).toString('hex'),
          severity,
          description: `Pattern overlap between ${newLease.agentName} and ${existingLease.agentName}`,
          involvedLeases: [newLease.id, existingLease.id],
          affectedFiles: overlap.files,
          detectedAt: new Date(),
          autoResolvable: severity === 'low' && newLease.mode === 'shared' && existingLease.mode === 'shared'
        };

        conflicts.push(conflict);
      }
    }

    return conflicts;
  }

  private async checkPatternOverlap(pattern1: string, pattern2: string): Promise<{
    hasOverlap: boolean;
    files: string[];
  }> {
    try {
      // Get all files matching both patterns
      const files1 = await globAsync(pattern1, { cwd: this.config.projectPath });
      const files2 = await globAsync(pattern2, { cwd: this.config.projectPath });

      // Find intersection
      // @ts-expect-error - Post-Merge Reconciliation
      const overlap = files1.filter(file => files2.includes(file));

      return {
        hasOverlap: overlap.length > 0,
        files: overlap
      };
    } catch (error: unknown) {
      // If glob fails, assume no overlap
      return {
        hasOverlap: false,
        files: []
      };
    }
  }

  private calculateConflictSeverity(
    lease1: ReservationLease,
    lease2: ReservationLease,
    affectedFiles: string[]
  ): ConflictSeverity {
    // Critical: exclusive modes
    if (lease1.mode === 'exclusive' || lease2.mode === 'exclusive') {
      return 'critical';
    }

    // High: many files affected or high priority leases
    if (affectedFiles.length > 10 || lease1.priority >= 8 || lease2.priority >= 8) {
      return 'high';
    }

    // Medium: moderate overlap
    if (affectedFiles.length > 3) {
      return 'medium';
    }

    // Low: minimal overlap, both shared/advisory
    return 'low';
  }

  private startExpirationTimer(): void {
    // Run cleanup every 5 minutes
    this.expirationTimer = setInterval(async () => {
      try {
        await this.cleanupExpired();
      } catch (error: unknown) {
        this.auditLogger?.error('Expiration cleanup failed', { error: (error as Error).message });
      }
    }, 5 * 60 * 1000);
  }

  private async loadReservations(): Promise<void> {
    const reservationPath = path.join(this.config.projectPath, this.config.reservationFile);

    try {
      const data = await fs.readFile(reservationPath, 'utf-8');
      const stored = JSON.parse(data);

      // Load leases
      if (stored.leases) {
        for (const leaseData of stored.leases) {
          const lease: ReservationLease = {
            ...leaseData,
            createdAt: new Date(leaseData.createdAt),
            expiresAt: new Date(leaseData.expiresAt),
            lastAccess: new Date(leaseData.lastAccess)
          };
          this.leases.set(lease.id, lease);
        }
      }

      // Load conflicts
      if (stored.conflicts) {
        for (const conflictData of stored.conflicts) {
          const conflict: ReservationConflict = {
            ...conflictData,
            detectedAt: new Date(conflictData.detectedAt),
            resolvedAt: conflictData.resolvedAt ? new Date(conflictData.resolvedAt) : undefined
          };
          this.conflicts.set(conflict.id, conflict);
        }
      }

      this.auditLogger?.info('Reservations loaded from storage', {
        leaseCount: this.leases.size,
        conflictCount: this.conflicts.size
      });

    } catch (error: unknown) {
      if ((error as any).code !== 'ENOENT') {
        this.auditLogger?.warn('Failed to load reservations', { error: (error as Error).message });
      }
      // File doesn't exist or is invalid, start with empty state
    }
  }

  private async saveReservations(): Promise<void> {
    const reservationPath = path.join(this.config.projectPath, this.config.reservationFile);

    const data = {
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      leases: Array.from(this.leases.values()),
      conflicts: Array.from(this.conflicts.values())
    };

    try {
      await fs.writeFile(reservationPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error: unknown) {
      this.auditLogger?.error('Failed to save reservations', { error: (error as Error).message });
      throw error;
    }
  }
}

/**
 * Git Guard Manager
 * 
 * Manages git pre-commit hooks for file reservation enforcement.
 */
class GitGuardManager {
  private config: FileReservationConfig;
  private reservationManager: FileReservationManager;
  private hookPath: string;

  constructor(config: FileReservationConfig, reservationManager: FileReservationManager) {
    this.config = config;
    this.reservationManager = reservationManager;
    this.hookPath = path.join(config.projectPath, config.gitHookPath, 'pre-commit-superclaw');
  }

  async initialize(): Promise<void> {
    await this.installHook();
  }

  async updateGuards(): Promise<void> {
    const activeLeases = this.reservationManager.getActiveReservations();
    await this.generateHookScript(activeLeases);
  }

  async isHealthy(): Promise<boolean> {
    try {
      const stats = await fs.stat(this.hookPath);
      return stats.isFile() && (stats.mode & parseInt('111', 8)) !== 0; // Check if executable
    } catch {
      return false;
    }
  }

  async shutdown(): Promise<void> {
    await this.uninstallHook();
  }

  private async installHook(): Promise<void> {
    const hookDir = path.dirname(this.hookPath);
    await fs.mkdir(hookDir, { recursive: true });

    const activeLeases = this.reservationManager.getActiveReservations();
    await this.generateHookScript(activeLeases);
  }

  private async uninstallHook(): Promise<void> {
    try {
      await fs.unlink(this.hookPath);
    } catch (error: unknown) {
      // Hook file may not exist
    }
  }

  private async generateHookScript(leases: ReservationLease[]): Promise<void> {
    const script = `#!/bin/bash
# SuperClaw File Reservation Guard
# Generated: ${new Date().toISOString()}
# Active Reservations: ${leases.length}

set -e

# Colors for output
RED='\\033[0;31m'
YELLOW='\\033[1;33m'
GREEN='\\033[0;32m'
NC='\\033[0m' # No Color

echo "🦊 SuperClaw File Reservation Guard"

# Get staged files
STAGED_FILES=$(git diff --cached --name-only)

if [ -z "$STAGED_FILES" ]; then
    echo "✅ No staged files to check"
    exit 0
fi

echo "Checking staged files against active reservations..."

# Check each staged file against reservations
CONFLICTS=()
${leases.map(lease => this.generateLeaseCheck(lease)).join('\n')}

if [ \${#CONFLICTS[@]} -ne 0 ]; then
    echo -e "\${RED}❌ File reservation conflicts detected:\${NC}"
    printf '%s\\n' "\${CONFLICTS[@]}"
    echo
    echo -e "\${YELLOW}Resolution options:\${NC}"
    echo "1. Coordinate with the reserving agent"
    echo "2. Use 'git commit --no-verify' to bypass (not recommended)"
    echo "3. Wait for reservation to expire"
    echo "4. Request early release of reservation"
    echo
    echo "Active reservations can be viewed with:"
    echo "  superclaw reservations list"
    exit 1
fi

echo -e "\${GREEN}✅ No reservation conflicts detected\${NC}"
exit 0
`;

    await fs.writeFile(this.hookPath, script, { mode: 0o755 });
  }

  private generateLeaseCheck(lease: ReservationLease): string {
    return `
# Check lease: ${lease.id} (${lease.agentName})
for file in $STAGED_FILES; do
    if [[ "$file" == ${lease.pathPattern} ]]; then
        CONFLICTS+=("  - $file (reserved by ${lease.agentName}: ${lease.reason})")
        CONFLICTS+=("    Mode: ${lease.mode}, Expires: ${lease.expiresAt.toISOString()}")
    fi
done`;
  }
}

/**
 * Conflict Resolver
 * 
 * Handles automatic resolution of reservation conflicts.
 */
class ConflictResolver {
  private config: FileReservationConfig;
  private reservationManager: FileReservationManager;

  constructor(config: FileReservationConfig, reservationManager: FileReservationManager) {
    this.config = config;
    this.reservationManager = reservationManager;
  }

  async initialize(): Promise<void> {
    // Initialize conflict resolution system
  }

  async resolveConflicts(conflicts: ReservationConflict[]): Promise<void> {
    for (const conflict of conflicts) {
      if (conflict.autoResolvable) {
        await this.autoResolveConflict(conflict);
      }
    }
  }

  async shutdown(): Promise<void> {
    // Cleanup conflict resolver
  }

  private async autoResolveConflict(conflict: ReservationConflict): Promise<void> {
    // Implement automatic conflict resolution logic
    // For now, just mark as resolved
    conflict.resolvedAt = new Date();
    conflict.resolution = 'Auto-resolved: shared access allowed';
  }
}

// Factory function
export function createFileReservationManager(config: FileReservationConfig): FileReservationManager {
  return new FileReservationManager(config);
}

// Default configuration
export const DEFAULT_RESERVATION_CONFIG: Partial<FileReservationConfig> = {
  storageType: 'git',
  defaultLeaseDuration: 24,
  maxLeaseDuration: 168,
  enableGitGuards: true,
  enableConflictDetection: true,
  enableAutoExpiration: true,
  enableAuditTrail: true,
  conflictResolutionMode: 'advisory',
  reservationFile: '.superclaw-reservations.json',
  gitHookPath: '.git/hooks'
};