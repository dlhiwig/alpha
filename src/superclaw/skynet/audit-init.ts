/**
 * 🦊 SKYNET AUDIT INITIALIZATION
 * 
 * Automatic initialization and setup of the audit trail system
 * when SuperClaw starts. Includes proper integration with existing
 * SKYNET components and graceful error handling.
 */

import { 
  startAuditTrail, 
  startAuditSentinelMonitoring,
  AuditAutoIntegration 
} from './index';
import path from 'path';
import fs from 'fs/promises';

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

interface SuperClawAuditConfig {
  enabled: boolean;
  dataDir: string;
  sentinelMonitoring: boolean;
  autoIntegration: boolean;
  production: boolean;
  alertChannels: string[];
}

const DEFAULT_CONFIG: SuperClawAuditConfig = {
  enabled: process.env.SUPERCLAW_AUDIT_ENABLED !== 'false',
  dataDir: process.env.SUPERCLAW_DATA_DIR || path.join(process.cwd(), 'data'),
  sentinelMonitoring: process.env.SUPERCLAW_AUDIT_SENTINEL !== 'false',
  autoIntegration: process.env.SUPERCLAW_AUDIT_AUTO !== 'false',
  production: process.env.NODE_ENV === 'production',
  alertChannels: (process.env.SUPERCLAW_AUDIT_CHANNELS || '').split(',').filter(Boolean)
};

// ═══════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════

export async function initializeAuditSystem(config: Partial<SuperClawAuditConfig> = {}): Promise<{
  auditEnabled: boolean;
  sentinelEnabled: boolean;
  autoIntegrationEnabled: boolean;
  dataPath: string;
}> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  console.log('🦊 AUDIT: Initializing audit trail system...');

  if (!finalConfig.enabled) {
    console.log('🦊 AUDIT: Disabled by configuration');
    return {
      auditEnabled: false,
      sentinelEnabled: false,
      autoIntegrationEnabled: false,
      dataPath: ''
    };
  }

  try {
    // Ensure data directory exists
    await ensureDataDirectory(finalConfig.dataDir);

    // Initialize audit trail
    const auditTrail = startAuditTrail({
      enabled: true,
      dbPath: path.join(finalConfig.dataDir, 'audit-trail.db'),
      jsonBackupPath: path.join(finalConfig.dataDir, 'audit-backup.jsonl'),
      maxLogsInMemory: finalConfig.production ? 50000 : 10000,
      batchWriteSize: finalConfig.production ? 500 : 100,
      enableRealTimeStream: true,
      sanitizeSensitiveData: true,
      retentionDays: finalConfig.production ? 2555 : 365, // 7 years for prod, 1 year for dev
      compressionEnabled: finalConfig.production,
      alertOnHighSeverity: true,
      notificationChannels: finalConfig.alertChannels
    });

    // Wait for initialization
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Audit trail initialization timeout'));
      }, 10000);

      auditTrail.once('initialized', () => {
        clearTimeout(timeout);
        resolve(void 0);
      });

      auditTrail.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    console.log('🦊 AUDIT: Core audit trail initialized');

    // Initialize auto-integration if enabled
    let autoIntegrationEnabled = false;
    if (finalConfig.autoIntegration) {
      try {
        AuditAutoIntegration.initialize();
        autoIntegrationEnabled = true;
        console.log('🦊 AUDIT: Auto-integration hooks installed');
      } catch (error: unknown) {
        console.warn('🦊 AUDIT: Auto-integration failed:', error);
      }
    }

    // Initialize SENTINEL monitoring if enabled
    let sentinelEnabled = false;
    if (finalConfig.sentinelMonitoring) {
      try {
        startAuditSentinelMonitoring({
          errorRateThreshold: finalConfig.production ? 0.10 : 0.20,
          costSpikeThreshold: finalConfig.production ? 1.5 : 2.0,
          latencyThreshold: finalConfig.production ? 20000 : 30000,
          securityEventThreshold: finalConfig.production ? 3 : 5,
          checkInterval: finalConfig.production ? 2 * 60 * 1000 : 5 * 60 * 1000
        });
        sentinelEnabled = true;
        console.log('🦊 AUDIT: SENTINEL monitoring started');
      } catch (error: unknown) {
        console.warn('🦊 AUDIT: SENTINEL monitoring failed:', error);
      }
    }

    // Log system startup
    auditTrail.log({
      sessionId: process.env.SUPERCLAW_SESSION_ID || 'startup',
      agentId: 'system',
      action: 'system',
      result: 'success',
      durationMs: 0,
      severity: 'low',
      metadata: {
        event: 'audit_system_initialized',
        config: {
          production: finalConfig.production,
          sentinelEnabled,
          autoIntegrationEnabled,
          dataPath: finalConfig.dataDir
        }
      }
    });

    console.log('🦊 AUDIT: System fully initialized and operational');

    return {
      auditEnabled: true,
      sentinelEnabled,
      autoIntegrationEnabled,
      dataPath: finalConfig.dataDir
    };

  } catch (error: unknown) {
    console.error('🦊 AUDIT: Failed to initialize audit system:', error);
    
    // Try to log the failure (if basic logging is available)
    try {
      const basicAudit = startAuditTrail({
        enabled: true,
        dbPath: path.join(finalConfig.dataDir, 'audit-trail-emergency.db'),
        sanitizeSensitiveData: true
      });

      basicAudit.log({
        sessionId: 'emergency',
        agentId: 'system',
        action: 'system',
        result: 'failure',
        durationMs: 0,
        severity: 'critical',
        errorMessage: error instanceof Error ? (error as Error).message : String(error),
        metadata: {
          event: 'audit_system_initialization_failed',
          error: error
        }
      });
    } catch (emergencyError) {
      console.error('🦊 AUDIT: Emergency logging also failed:', emergencyError);
    }

    return {
      auditEnabled: false,
      sentinelEnabled: false,
      autoIntegrationEnabled: false,
      dataPath: finalConfig.dataDir
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN
// ═══════════════════════════════════════════════════════════════

export async function shutdownAuditSystem(): Promise<void> {
  console.log('🦊 AUDIT: Shutting down audit system...');

  try {
    // Cleanup auto-integration
    AuditAutoIntegration.cleanup();

    // Stop SENTINEL monitoring
    const { stopAuditSentinelMonitoring } = await import('./index.js');
    stopAuditSentinelMonitoring();

    // Stop audit trail
    const { stopAuditTrail, getAuditTrail } = await import('./index.js');
    
    // Log shutdown
    const audit = getAuditTrail();
    if (audit.isEnabled()) {
      audit.log({
        sessionId: process.env.SUPERCLAW_SESSION_ID || 'shutdown',
        agentId: 'system',
        action: 'system',
        result: 'success',
        durationMs: 0,
        severity: 'low',
        metadata: {
          event: 'audit_system_shutdown'
        }
      });

      // Give time for final log to be written
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    stopAuditTrail();
    console.log('🦊 AUDIT: Shutdown complete');

  } catch (error: unknown) {
    console.error('🦊 AUDIT: Error during shutdown:', error);
  }
}

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════

async function ensureDataDirectory(dataDir: string): Promise<void> {
  try {
    await fs.mkdir(dataDir, { recursive: true });
    
    // Test write permissions
    const testFile = path.join(dataDir, '.audit-test');
    await fs.writeFile(testFile, 'test');
    await fs.unlink(testFile);
    
  } catch (error: unknown) {
    throw new Error(`Cannot create or write to data directory ${dataDir}: ${error}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// PROCESS HANDLERS
// ═══════════════════════════════════════════════════════════════

let shutdownInitiated = false;

export function setupProcessHandlers(): void {
  const gracefulShutdown = async (signal: string) => {
    if (shutdownInitiated) return;
    shutdownInitiated = true;

    console.log(`🦊 AUDIT: Received ${signal}, initiating graceful shutdown...`);
    await shutdownAuditSystem();
    process.exit(0);
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  
  process.on('uncaughtException', async (error) => {
    console.error('🦊 AUDIT: Uncaught exception:', error);
    
    try {
      const { getAuditTrail } = await import('./index.js');
      const audit = getAuditTrail();
      
      audit.log({
        sessionId: process.env.SUPERCLAW_SESSION_ID || 'error',
        agentId: 'system',
        action: 'error',
        result: 'failure',
        durationMs: 0,
        severity: 'critical',
        errorMessage: (error as Error).message,
        stackTrace: error.stack,
        metadata: {
          event: 'uncaught_exception',
          error: {
            name: error.name,
            message: (error as Error).message,
            stack: error.stack
          }
        }
      });
    } catch (auditError) {
      console.error('🦊 AUDIT: Failed to log uncaught exception:', auditError);
    }

    await gracefulShutdown('uncaughtException');
  });

  process.on('unhandledRejection', async (reason, promise) => {
    console.error('🦊 AUDIT: Unhandled promise rejection:', reason);
    
    try {
      const { getAuditTrail } = await import('./index.js');
      const audit = getAuditTrail();
      
      audit.log({
        sessionId: process.env.SUPERCLAW_SESSION_ID || 'error',
        agentId: 'system',
        action: 'error',
        result: 'failure',
        durationMs: 0,
        severity: 'high',
        errorMessage: String(reason),
        metadata: {
          event: 'unhandled_rejection',
          reason: String(reason),
          promise: promise.toString()
        }
      });
    } catch (auditError) {
      console.error('🦊 AUDIT: Failed to log unhandled rejection:', auditError);
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════════════════════════

export async function getAuditSystemHealth(): Promise<{
  enabled: boolean;
  database: 'healthy' | 'error' | 'unavailable';
  sentinel: 'active' | 'inactive' | 'error';
  autoIntegration: 'active' | 'inactive';
  lastLogTime?: Date;
  errorRate?: number;
  totalLogs?: number;
}> {
  try {
    const { getAuditTrail, getAuditSentinelIntegration } = await import('./index.js');
    const audit = getAuditTrail();

    if (!audit.isEnabled()) {
      return {
        enabled: false,
        database: 'unavailable',
        sentinel: 'inactive',
        autoIntegration: 'inactive'
      };
    }

    // Test database health
    let databaseStatus: 'healthy' | 'error' = 'healthy';
    let stats;
    try {
      stats = audit.getStats(
        new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
        new Date()
      );
    } catch (error: unknown) {
      databaseStatus = 'error';
    }

    // Check SENTINEL health
    let sentinelStatus: 'active' | 'inactive' | 'error' = 'inactive';
    try {
      const sentinel = getAuditSentinelIntegration();
      const sentinelStats = sentinel.getMonitoringStats();
      sentinelStatus = 'active';
    } catch (error: unknown) {
      sentinelStatus = 'error';
    }

    return {
      enabled: true,
      database: databaseStatus,
      sentinel: sentinelStatus,
      autoIntegration: 'active', // Assume active if no errors
      lastLogTime: stats ? new Date() : undefined,
      errorRate: stats?.errorRate,
      totalLogs: stats?.totalLogs
    };

  } catch (error: unknown) {
    return {
      enabled: false,
      database: 'error',
      sentinel: 'error',
      autoIntegration: 'inactive'
    };
  }
}