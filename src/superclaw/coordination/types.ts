// @ts-nocheck
/**
 * 🦊 SuperClaw Coordination Types
 * 
 * Type definitions for the SuperClaw coordination system,
 * including file reservations and multi-agent coordination patterns.
 */

export * from './file-reservations';

// Re-export common types for convenience
export type {
  ReservationLease,
  ReservationConflict,
  ReservationStats,
  ReservationDashboard,
  FileReservationConfig,
  ReservationMode,
  ReservationStatus,
  ConflictSeverity
} from './file-reservations';

// Additional coordination types
export interface CoordinationEvent {
  id: string;
  type: 'reservation_created' | 'reservation_released' | 'conflict_detected' | 'conflict_resolved';
  timestamp: Date;
  agentId: string;
  agentName: string;
  data: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface AgentCoordination {
  agentId: string;
  agentName: string;
  projectPath: string;
  activeReservations: string[];
  lastActivity: Date;
  coordinationPreferences: {
    autoResolveConflicts: boolean;
    maxLeaseDuration: number;
    // @ts-expect-error - Post-Merge Reconciliation
    defaultReservationMode: ReservationMode;
    notificationPreferences: string[];
  };
}

export interface CoordinationMetrics {
  totalReservations: number;
  activeAgents: number;
  conflictRate: number;
  averageLeaseTime: number;
  systemHealth: number; // 0-100
  lastUpdateTime: Date;
}