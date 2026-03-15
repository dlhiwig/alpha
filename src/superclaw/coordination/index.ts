/**
 * 🦊 SuperClaw Coordination System
 * 
 * Multi-agent coordination system implementing the Agent Mail pattern
 * for conflict-free collaboration in SuperClaw swarms.
 * 
 * Features:
 * - File reservation system with lease-based expiration
 * - Pre-commit git guard integration
 * - Real-time conflict detection and resolution
 * - Cross-agent communication and coordination
 * - Dashboard for monitoring and management
 */

export {
  FileReservationManager,
  createFileReservationManager,
  DEFAULT_RESERVATION_CONFIG
} from './file-reservations';

export * from './types';

// Convenience re-exports
export type {
  ReservationLease,
  ReservationConflict,
  ReservationStats,
  ReservationDashboard,
  FileReservationConfig,
  ReservationMode,
  ReservationStatus,
  ConflictSeverity,
  CoordinationEvent,
  AgentCoordination,
  CoordinationMetrics
} from './types';