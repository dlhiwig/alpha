/**
 * 🦊 SKYNET AUDIT-SENTINEL INTEGRATION
 * 
 * Connects the Audit Trail system with SKYNET SENTINEL for enhanced monitoring,
 * alerting, and anomaly detection based on audit logs.
 */

import { getAuditTrail, AuditLog } from './audit.js';
import { createAlert, getProviderStats } from './sentinel.js';

// ═══════════════════════════════════════════════════════════════
// AUDIT-BASED MONITORING
// ═══════════════════════════════════════════════════════════════

interface AuditMonitorConfig {
  errorRateThreshold: number;     // Alert if error rate exceeds this (0.0-1.0)
  costSpikeThreshold: number;     // Alert if cost spike exceeds this multiplier
  latencyThreshold: number;       // Alert if average latency exceeds this (ms)
  securityEventThreshold: number; // Max security events per hour
  checkInterval: number;          // How often to run checks (ms)
}

const DEFAULT_CONFIG: AuditMonitorConfig = {
  errorRateThreshold: 0.15,       // 15% error rate
  costSpikeThreshold: 2.0,        // 2x cost increase
  latencyThreshold: 30000,        // 30 seconds
  securityEventThreshold: 5,      // 5 security events per hour
  checkInterval: 5 * 60 * 1000,   // 5 minutes
};

export class AuditSentinelIntegration {
  private config: AuditMonitorConfig;
  private monitorTimer: NodeJS.Timeout | null = null;
  private lastCheckTime: Date = new Date();
  private baselineCosts: Map<string, number> = new Map();
  private alertHistory: Set<string> = new Set();

  constructor(config: Partial<AuditMonitorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.setupAuditEventListeners();
  }

  // ═══════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════

  public start(): void {
    console.log('🦊 AUDIT-SENTINEL: Starting integrated monitoring...');
    
    this.monitorTimer = setInterval(() => {
      this.performAuditAnalysis();
    }, this.config.checkInterval);

    this.performAuditAnalysis(); // Run initial check
    console.log('🦊 AUDIT-SENTINEL: Monitoring started');
  }

  public stop(): void {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
    
    console.log('🦊 AUDIT-SENTINEL: Monitoring stopped');
  }

  // ═══════════════════════════════════════════════════════════════
  // REAL-TIME EVENT MONITORING
  // ═══════════════════════════════════════════════════════════════

  private setupAuditEventListeners(): void {
    const audit = getAuditTrail();

    // Monitor high-severity events in real-time
    audit.on('high_severity', (log: AuditLog) => {
      this.handleHighSeverityEvent(log);
    });

    // Monitor all log events for patterns
    audit.on('log', (log: AuditLog) => {
      this.analyzeLogPattern(log);
    });
  }

  private handleHighSeverityEvent(log: AuditLog): void {
    const alertKey = `audit_high_severity_${log.id}`;
    
    if (this.alertHistory.has(alertKey)) return;
    this.alertHistory.add(alertKey);

    createAlert(
      log.severity === 'critical' ? 'critical' : 'warning',
      'audit.high_severity',
      `High severity ${log.action} by ${log.agentId}: ${log.errorMessage || 'Unknown issue'}`,
      {
        logId: log.id,
        action: log.action,
        tool: log.tool,
        agentId: log.agentId,
        sessionId: log.sessionId,
        cost: log.costUsd,
        duration: log.durationMs
      }
    );
  }

  private analyzeLogPattern(log: AuditLog): void {
    // Check for suspicious patterns
    if (log.action === 'security') {
      this.checkSecurityThreshold(log);
    }

    if (log.result === 'failure' && log.durationMs > this.config.latencyThreshold) {
      this.checkLatencyAnomaly(log);
    }

    if (log.costUsd && log.costUsd > 5.0) {
      this.checkCostAnomaly(log);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PERIODIC ANALYSIS
  // ═══════════════════════════════════════════════════════════════

  private performAuditAnalysis(): void {
    const now = new Date();
    const audit = getAuditTrail();

    // Analyze logs from the last check period
    const recentLogs = audit.query({
      dateFrom: this.lastCheckTime,
      dateTo: now,
      limit: 1000
    });

    if (recentLogs.length > 0) {
      this.analyzeErrorRates(recentLogs);
      this.analyzeCostTrends(recentLogs);
      this.analyzePerformanceTrends(recentLogs);
      this.analyzeSecurityEvents(recentLogs);
      this.analyzeAgentBehavior(recentLogs);
    }

    this.lastCheckTime = now;
  }

  private analyzeErrorRates(logs: AuditLog[]): void {
    const errorCounts: Map<string, { total: number; errors: number }> = new Map();

    for (const log of logs) {
      const key = log.tool || log.action;
      const current = errorCounts.get(key) || { total: 0, errors: 0 };
      
      current.total++;
      if (log.result === 'failure') {
        current.errors++;
      }
      
      errorCounts.set(key, current);
    }

    for (const [key, counts] of errorCounts) {
      const errorRate = counts.errors / counts.total;
      
      if (errorRate > this.config.errorRateThreshold && counts.total >= 10) {
        const alertKey = `audit_error_rate_${key}_${Math.floor(Date.now() / (60 * 60 * 1000))}`;
        
        if (!this.alertHistory.has(alertKey)) {
          this.alertHistory.add(alertKey);
          
          createAlert('warning', 'audit.error_rate', 
            `High error rate for ${key}: ${(errorRate * 100).toFixed(1)}% (${counts.errors}/${counts.total})`,
            {
              tool: key,
              errorRate,
              totalCalls: counts.total,
              errorCount: counts.errors,
              period: 'recent'
            }
          );
        }
      }
    }
  }

  private analyzeCostTrends(logs: AuditLog[]): void {
    const costByAgent: Map<string, number> = new Map();

    for (const log of logs) {
      if (log.costUsd) {
        const current = costByAgent.get(log.agentId) || 0;
        costByAgent.set(log.agentId, current + log.costUsd);
      }
    }

    for (const [agentId, recentCost] of costByAgent) {
      const baseline = this.baselineCosts.get(agentId) || 0;
      
      if (baseline > 0) {
        const costMultiplier = recentCost / baseline;
        
        if (costMultiplier > this.config.costSpikeThreshold) {
          const alertKey = `audit_cost_spike_${agentId}_${Math.floor(Date.now() / (60 * 60 * 1000))}`;
          
          if (!this.alertHistory.has(alertKey)) {
            this.alertHistory.add(alertKey);
            
            createAlert('warning', 'audit.cost_spike',
              `Cost spike detected for agent ${agentId}: $${recentCost.toFixed(2)} (${costMultiplier.toFixed(1)}x baseline)`,
              {
                agentId,
                recentCost,
                baseline,
                multiplier: costMultiplier,
                period: 'recent'
              }
            );
          }
        }
      }
      
      // Update baseline (rolling average)
      this.baselineCosts.set(agentId, baseline * 0.8 + recentCost * 0.2);
    }
  }

  private analyzePerformanceTrends(logs: AuditLog[]): void {
    const performanceByTool: Map<string, number[]> = new Map();

    for (const log of logs) {
      if (log.tool && log.durationMs > 0) {
        const durations = performanceByTool.get(log.tool) || [];
        durations.push(log.durationMs);
        performanceByTool.set(log.tool, durations);
      }
    }

    for (const [tool, durations] of performanceByTool) {
      const avgLatency = durations.reduce((a, b) => a + b, 0) / durations.length;
      
      if (avgLatency > this.config.latencyThreshold) {
        const alertKey = `audit_latency_${tool}_${Math.floor(Date.now() / (60 * 60 * 1000))}`;
        
        if (!this.alertHistory.has(alertKey)) {
          this.alertHistory.add(alertKey);
          
          createAlert('warning', 'audit.latency',
            `High average latency for ${tool}: ${avgLatency.toFixed(0)}ms (threshold: ${this.config.latencyThreshold}ms)`,
            {
              tool,
              averageLatency: avgLatency,
              threshold: this.config.latencyThreshold,
              sampleCount: durations.length,
              maxLatency: Math.max(...durations),
              period: 'recent'
            }
          );
        }
      }
    }
  }

  private analyzeSecurityEvents(logs: AuditLog[]): void {
    const securityEvents = logs.filter(log => 
      log.action === 'security' || 
      log.action === 'auth' ||
      (log.severity && ['high', 'critical'].includes(log.severity))
    );

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentSecurityEvents = securityEvents.filter(log => 
      log.timestamp > oneHourAgo
    );

    if (recentSecurityEvents.length > this.config.securityEventThreshold) {
      const alertKey = `audit_security_threshold_${Math.floor(Date.now() / (60 * 60 * 1000))}`;
      
      if (!this.alertHistory.has(alertKey)) {
        this.alertHistory.add(alertKey);
        
        createAlert('critical', 'audit.security_threshold',
          `Security event threshold exceeded: ${recentSecurityEvents.length} events in last hour (threshold: ${this.config.securityEventThreshold})`,
          {
            eventCount: recentSecurityEvents.length,
            threshold: this.config.securityEventThreshold,
            events: recentSecurityEvents.slice(0, 5).map(e => ({
              id: e.id,
              timestamp: e.timestamp,
              agentId: e.agentId,
              action: e.action,
              severity: e.severity
            }))
          }
        );
      }
    }
  }

  private analyzeAgentBehavior(logs: AuditLog[]): void {
    const agentStats: Map<string, {
      toolCalls: number;
      failures: number;
      avgDuration: number;
      totalCost: number;
      uniqueTools: Set<string>;
    }> = new Map();

    for (const log of logs) {
      const stats = agentStats.get(log.agentId) || {
        toolCalls: 0,
        failures: 0,
        avgDuration: 0,
        totalCost: 0,
        uniqueTools: new Set()
      };

      if (log.action === 'tool_call') {
        stats.toolCalls++;
        stats.avgDuration = (stats.avgDuration * (stats.toolCalls - 1) + log.durationMs) / stats.toolCalls;
        
        if (log.tool) {
          stats.uniqueTools.add(log.tool);
        }
      }

      if (log.result === 'failure') {
        stats.failures++;
      }

      if (log.costUsd) {
        stats.totalCost += log.costUsd;
      }

      agentStats.set(log.agentId, stats);
    }

    // Check for anomalous agent behavior
    for (const [agentId, stats] of agentStats) {
      // High failure rate
      if (stats.toolCalls > 10 && stats.failures / stats.toolCalls > 0.3) {
        const alertKey = `audit_agent_failures_${agentId}_${Math.floor(Date.now() / (60 * 60 * 1000))}`;
        
        if (!this.alertHistory.has(alertKey)) {
          this.alertHistory.add(alertKey);
          
          createAlert('warning', 'audit.agent_behavior',
            `Agent ${agentId} has high failure rate: ${((stats.failures / stats.toolCalls) * 100).toFixed(1)}%`,
            {
              agentId,
              toolCalls: stats.toolCalls,
              failures: stats.failures,
              failureRate: stats.failures / stats.toolCalls,
              period: 'recent'
            }
          );
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // ANOMALY DETECTION
  // ═══════════════════════════════════════════════════════════════

  private checkSecurityThreshold(log: AuditLog): void {
    // This is handled by analyzeSecurityEvents in bulk
    // Individual security events are logged in real-time via handleHighSeverityEvent
  }

  private checkLatencyAnomaly(log: AuditLog): void {
    if (log.durationMs > this.config.latencyThreshold * 3) { // 3x threshold = anomaly
      const alertKey = `audit_latency_anomaly_${log.id}`;
      
      if (!this.alertHistory.has(alertKey)) {
        this.alertHistory.add(alertKey);
        
        createAlert('warning', 'audit.latency_anomaly',
          `Extreme latency anomaly: ${log.tool || log.action} took ${log.durationMs}ms`,
          {
            logId: log.id,
            tool: log.tool,
            action: log.action,
            duration: log.durationMs,
            agentId: log.agentId,
            sessionId: log.sessionId
          }
        );
      }
    }
  }

  private checkCostAnomaly(log: AuditLog): void {
    if (log.costUsd && log.costUsd > 10.0) { // $10+ is an anomaly
      const alertKey = `audit_cost_anomaly_${log.id}`;
      
      if (!this.alertHistory.has(alertKey)) {
        this.alertHistory.add(alertKey);
        
        createAlert('warning', 'audit.cost_anomaly',
          `High cost event: $${log.costUsd.toFixed(2)} for ${log.tool || log.action}`,
          {
            logId: log.id,
            cost: log.costUsd,
            tool: log.tool,
            action: log.action,
            agentId: log.agentId,
            tokenUsage: log.tokenUsage
          }
        );
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════

  public getMonitoringStats(): {
    alertsGenerated: number;
    lastCheckTime: Date;
    baselineAgents: number;
    config: AuditMonitorConfig;
  } {
    return {
      alertsGenerated: this.alertHistory.size,
      lastCheckTime: this.lastCheckTime,
      baselineAgents: this.baselineCosts.size,
      config: this.config
    };
  }

  public clearAlertHistory(): void {
    this.alertHistory.clear();
    console.log('🦊 AUDIT-SENTINEL: Alert history cleared');
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════

let auditSentinelInstance: AuditSentinelIntegration | null = null;

export function getAuditSentinelIntegration(config?: Partial<AuditMonitorConfig>): AuditSentinelIntegration {
  if (!auditSentinelInstance) {
    auditSentinelInstance = new AuditSentinelIntegration(config);
  }
  return auditSentinelInstance;
}

export function startAuditSentinelMonitoring(config?: Partial<AuditMonitorConfig>): AuditSentinelIntegration {
  const integration = getAuditSentinelIntegration(config);
  integration.start();
  return integration;
}

export function stopAuditSentinelMonitoring(): void {
  if (auditSentinelInstance) {
    auditSentinelInstance.stop();
    auditSentinelInstance = null;
  }
}