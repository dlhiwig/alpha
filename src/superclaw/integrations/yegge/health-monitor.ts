/**
 * Yegge Ecosystem Health Monitor
 * 
 * Comprehensive health monitoring for all Yegge ecosystem components:
 * - BEADS (memory & task management)
 * - Gas Town (orchestration)
 * - MCP Agent Mail (communication)
 * - VC (quality gates)
 * - EFRIT (tool execution)
 * 
 * Provides real-time health status, metrics collection, and alerting.
 */

import { EventEmitter } from 'events';
import { YeggeConfig } from './config';
import { YeggeEventBridge, SuperClawYeggeEvent } from './event-bridge';

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  lastCheck: number;
  responseTime: number;
  errorRate: number;
  memoryUsage: number;
  uptime: number;
  version?: string;
  details: Record<string, any>;
}

export interface ComponentHealth {
  beads: HealthStatus;
  gastown: HealthStatus;
  mcpAgentMail: HealthStatus;
  vc: HealthStatus;
  efrit: HealthStatus;
}

export interface SystemHealth {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  components: ComponentHealth;
  metrics: {
    totalRequests: number;
    totalErrors: number;
    avgResponseTime: number;
    memoryUsageTotal: number;
    activeConnections: number;
  };
  alerts: HealthAlert[];
  lastUpdate: number;
}

export interface HealthAlert {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  component: keyof ComponentHealth;
  message: string;
  timestamp: number;
  acknowledged: boolean;
  details: Record<string, any>;
}

export interface HealthCheckResult {
  component: string;
  status: HealthStatus;
  alerts: HealthAlert[];
}

export class YeggeHealthMonitor extends EventEmitter {
  private config: YeggeConfig;
  private eventBridge: YeggeEventBridge;
  private componentHealth: ComponentHealth;
  private alerts: Map<string, HealthAlert> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private startTime: number = Date.now();
  private metrics = {
    totalRequests: 0,
    totalErrors: 0,
    responseTimeSum: 0,
    requestCount: 0,
  };
  
  constructor(config: YeggeConfig, eventBridge: YeggeEventBridge) {
    super();
    this.config = config;
    this.eventBridge = eventBridge;
    
    // Initialize component health status
    this.componentHealth = {
      beads: this.createInitialHealthStatus(),
      gastown: this.createInitialHealthStatus(),
      mcpAgentMail: this.createInitialHealthStatus(),
      vc: this.createInitialHealthStatus(),
      efrit: this.createInitialHealthStatus(),
    };
    
    this.setupMonitoring();
  }
  
  // Start monitoring all components
  startMonitoring(): void {
    if (!this.config.superclaw.integration.healthMonitoring.enabled) {
      console.log('Yegge health monitoring is disabled');
      return;
    }
    
    const interval = this.config.superclaw.integration.healthMonitoring.checkInterval * 1000;
    
    this.checkInterval = setInterval(async () => {
      await this.performHealthChecks();
    }, interval);
    
    // Initial health check
    setTimeout(() => this.performHealthChecks(), 1000);
    
    console.log(`Yegge health monitoring started (interval: ${interval}ms)`);
  }
  
  // Stop monitoring
  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    console.log('Yegge health monitoring stopped');
  }
  
  // Perform health checks on all components
  private async performHealthChecks(): Promise<void> {
    const checkPromises = [];
    
    if (this.config.beads.enabled) {
      checkPromises.push(this.checkBeadsHealth());
    }
    
    if (this.config.gastown.enabled) {
      checkPromises.push(this.checkGastownHealth());
    }
    
    if (this.config.mcpAgentMail.enabled) {
      checkPromises.push(this.checkMCPAgentMailHealth());
    }
    
    if (this.config.vc.enabled) {
      checkPromises.push(this.checkVCHealth());
    }
    
    if (this.config.efrit.enabled) {
      checkPromises.push(this.checkEfritHealth());
    }
    
    const results = await Promise.allSettled(checkPromises);
    
    // Process results and update health status
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        this.updateComponentHealth(result.value);
      } else {
        console.error(`Health check failed:`, result.reason);
      }
    });
    
    // Emit health update event
    this.eventBridge.publishEvent({
      source: 'superclaw-yegge',
      type: 'health-check',
      timestamp: Date.now(),
      data: {
        healthStatus: this.getOverallHealthStatus(),
        metrics: {
          responseTime: this.getAverageResponseTime(),
          errorRate: this.getErrorRate(),
          memoryUsage: this.getTotalMemoryUsage(),
        },
      },
    });
    
    this.emit('health-update', this.getSystemHealth());
  }
  
  // Check BEADS health
  private async checkBeadsHealth(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const alerts: HealthAlert[] = [];
    
    try {
      // In production, this would make actual API calls to BEADS
      // For now, simulate health check
      const mockHealth = await this.simulateComponentHealth('beads', {
        databaseConnected: true,
        memoryUsage: Math.random() * 100 + 50, // 50-150MB
        activeTasks: Math.floor(Math.random() * 50),
        queueSize: Math.floor(Math.random() * 20),
      });
      
      const responseTime = Date.now() - startTime;
      
      // Check thresholds
      const thresholds = this.config.superclaw.integration.healthMonitoring.alertThresholds;
      
      if (responseTime > thresholds.responseTime) {
        alerts.push(this.createAlert('medium', 'beads', 'High response time', {
          responseTime,
          threshold: thresholds.responseTime,
        }));
      }
      
      if (mockHealth.memoryUsage > thresholds.memoryUsage) {
        alerts.push(this.createAlert('high', 'beads', 'High memory usage', {
          memoryUsage: mockHealth.memoryUsage,
          threshold: thresholds.memoryUsage,
        }));
      }
      
      const status: HealthStatus = {
        status: alerts.length > 0 ? 'degraded' : 'healthy',
        lastCheck: Date.now(),
        responseTime,
        errorRate: 0,
        memoryUsage: mockHealth.memoryUsage,
        uptime: Date.now() - this.startTime,
        details: mockHealth,
      };
      
      return { component: 'beads', status, alerts };
      
    } catch (error: unknown) {
      const responseTime = Date.now() - startTime;
      const alert = this.createAlert('critical', 'beads', 'Health check failed', { error: String(error) });
      
      const status: HealthStatus = {
        status: 'unhealthy',
        lastCheck: Date.now(),
        responseTime,
        errorRate: 100,
        memoryUsage: 0,
        uptime: Date.now() - this.startTime,
        details: { error: String(error) },
      };
      
      return { component: 'beads', status, alerts: [alert] };
    }
  }
  
  // Check Gas Town health
  private async checkGastownHealth(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const alerts: HealthAlert[] = [];
    
    try {
      const mockHealth = await this.simulateComponentHealth('gastown', {
        mayorActive: true,
        activeAgents: Math.floor(Math.random() * 10) + 1,
        activeRigs: Math.floor(Math.random() * 5) + 1,
        queuedConvoys: Math.floor(Math.random() * 15),
        memoryUsage: Math.random() * 150 + 100, // 100-250MB
      });
      
      const responseTime = Date.now() - startTime;
      const thresholds = this.config.superclaw.integration.healthMonitoring.alertThresholds;
      
      if (responseTime > thresholds.responseTime) {
        alerts.push(this.createAlert('medium', 'gastown', 'High response time', {
          responseTime,
          threshold: thresholds.responseTime,
        }));
      }
      
      if (mockHealth.activeAgents > this.config.gastown.mayor.maxAgents * 0.9) {
        alerts.push(this.createAlert('medium', 'gastown', 'High agent utilization', {
          activeAgents: mockHealth.activeAgents,
          maxAgents: this.config.gastown.mayor.maxAgents,
        }));
      }
      
      const status: HealthStatus = {
        status: alerts.length > 0 ? 'degraded' : 'healthy',
        lastCheck: Date.now(),
        responseTime,
        errorRate: 0,
        memoryUsage: mockHealth.memoryUsage,
        uptime: Date.now() - this.startTime,
        details: mockHealth,
      };
      
      return { component: 'gastown', status, alerts };
      
    } catch (error: unknown) {
      const responseTime = Date.now() - startTime;
      const alert = this.createAlert('critical', 'gastown', 'Health check failed', { error: String(error) });
      
      const status: HealthStatus = {
        status: 'unhealthy',
        lastCheck: Date.now(),
        responseTime,
        errorRate: 100,
        memoryUsage: 0,
        uptime: Date.now() - this.startTime,
        details: { error: String(error) },
      };
      
      return { component: 'gastown', status, alerts: [alert] };
    }
  }
  
  // Check MCP Agent Mail health
  private async checkMCPAgentMailHealth(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const alerts: HealthAlert[] = [];
    
    try {
      const mockHealth = await this.simulateComponentHealth('mcp-agent-mail', {
        serverRunning: true,
        activeConnections: Math.floor(Math.random() * 20) + 5,
        messagesInQueue: Math.floor(Math.random() * 100),
        fileReservations: Math.floor(Math.random() * 10),
        memoryUsage: Math.random() * 80 + 40, // 40-120MB
      });
      
      const responseTime = Date.now() - startTime;
      const thresholds = this.config.superclaw.integration.healthMonitoring.alertThresholds;
      
      if (mockHealth.messagesInQueue > 500) {
        alerts.push(this.createAlert('medium', 'mcpAgentMail', 'High message queue size', {
          queueSize: mockHealth.messagesInQueue,
        }));
      }
      
      const status: HealthStatus = {
        status: alerts.length > 0 ? 'degraded' : 'healthy',
        lastCheck: Date.now(),
        responseTime,
        errorRate: 0,
        memoryUsage: mockHealth.memoryUsage,
        uptime: Date.now() - this.startTime,
        details: mockHealth,
      };
      
      return { component: 'mcpAgentMail', status, alerts };
      
    } catch (error: unknown) {
      const responseTime = Date.now() - startTime;
      const alert = this.createAlert('critical', 'mcpAgentMail', 'Health check failed', { error: String(error) });
      
      const status: HealthStatus = {
        status: 'unhealthy',
        lastCheck: Date.now(),
        responseTime,
        errorRate: 100,
        memoryUsage: 0,
        uptime: Date.now() - this.startTime,
        details: { error: String(error) },
      };
      
      return { component: 'mcpAgentMail', status, alerts: [alert] };
    }
  }
  
  // Check VC health
  private async checkVCHealth(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const alerts: HealthAlert[] = [];
    
    try {
      const mockHealth = await this.simulateComponentHealth('vc', {
        colonyActive: true,
        activeAgents: Math.floor(Math.random() * 8) + 2,
        issuesInProgress: Math.floor(Math.random() * 20) + 5,
        qualityGateSuccessRate: 85 + Math.random() * 10, // 85-95%
        memoryUsage: Math.random() * 200 + 150, // 150-350MB
      });
      
      const responseTime = Date.now() - startTime;
      const thresholds = this.config.superclaw.integration.healthMonitoring.alertThresholds;
      
      if (mockHealth.qualityGateSuccessRate < this.config.vc.production.targetSuccessRate) {
        alerts.push(this.createAlert('high', 'vc', 'Low quality gate success rate', {
          successRate: mockHealth.qualityGateSuccessRate,
          target: this.config.vc.production.targetSuccessRate,
        }));
      }
      
      const status: HealthStatus = {
        status: alerts.length > 0 ? 'degraded' : 'healthy',
        lastCheck: Date.now(),
        responseTime,
        errorRate: 100 - mockHealth.qualityGateSuccessRate,
        memoryUsage: mockHealth.memoryUsage,
        uptime: Date.now() - this.startTime,
        details: mockHealth,
      };
      
      return { component: 'vc', status, alerts };
      
    } catch (error: unknown) {
      const responseTime = Date.now() - startTime;
      const alert = this.createAlert('critical', 'vc', 'Health check failed', { error: String(error) });
      
      const status: HealthStatus = {
        status: 'unhealthy',
        lastCheck: Date.now(),
        responseTime,
        errorRate: 100,
        memoryUsage: 0,
        uptime: Date.now() - this.startTime,
        details: { error: String(error) },
      };
      
      return { component: 'vc', status, alerts: [alert] };
    }
  }
  
  // Check EFRIT health
  private async checkEfritHealth(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const alerts: HealthAlert[] = [];
    
    try {
      const mockHealth = await this.simulateComponentHealth('efrit', {
        runtimeActive: true,
        activeSessions: Math.floor(Math.random() * 5) + 1,
        toolsAvailable: 35,
        safetyChecksEnabled: true,
        checkpointsCount: Math.floor(Math.random() * 50) + 10,
        memoryUsage: Math.random() * 60 + 30, // 30-90MB
      });
      
      const responseTime = Date.now() - startTime;
      
      if (!mockHealth.safetyChecksEnabled) {
        alerts.push(this.createAlert('high', 'efrit', 'Safety checks disabled', {
          safetyChecksEnabled: false,
        }));
      }
      
      const status: HealthStatus = {
        status: alerts.length > 0 ? 'degraded' : 'healthy',
        lastCheck: Date.now(),
        responseTime,
        errorRate: 0,
        memoryUsage: mockHealth.memoryUsage,
        uptime: Date.now() - this.startTime,
        details: mockHealth,
      };
      
      return { component: 'efrit', status, alerts };
      
    } catch (error: unknown) {
      const responseTime = Date.now() - startTime;
      const alert = this.createAlert('critical', 'efrit', 'Health check failed', { error: String(error) });
      
      const status: HealthStatus = {
        status: 'unhealthy',
        lastCheck: Date.now(),
        responseTime,
        errorRate: 100,
        memoryUsage: 0,
        uptime: Date.now() - this.startTime,
        details: { error: String(error) },
      };
      
      return { component: 'efrit', status, alerts: [alert] };
    }
  }
  
  // Update component health status
  private updateComponentHealth(result: HealthCheckResult): void {
    const component = result.component as keyof ComponentHealth;
    this.componentHealth[component] = result.status;
    
    // Process alerts
    for (const alert of result.alerts) {
      this.alerts.set(alert.id, alert);
    }
    
    // Update metrics
    this.metrics.totalRequests++;
    this.metrics.requestCount++;
    this.metrics.responseTimeSum += result.status.responseTime;
    
    if (result.status.errorRate > 0) {
      this.metrics.totalErrors++;
    }
  }
  
  // Get overall system health
  getSystemHealth(): SystemHealth {
    const componentStates = Object.values(this.componentHealth);
    const unhealthyCount = componentStates.filter(c => c.status === 'unhealthy').length;
    const degradedCount = componentStates.filter(c => c.status === 'degraded').length;
    
    let overall: 'healthy' | 'degraded' | 'unhealthy';
    if (unhealthyCount > 0) {
      overall = 'unhealthy';
    } else if (degradedCount > 0) {
      overall = 'degraded';
    } else {
      overall = 'healthy';
    }
    
    return {
      overall,
      components: { ...this.componentHealth },
      metrics: {
        totalRequests: this.metrics.totalRequests,
        totalErrors: this.metrics.totalErrors,
        avgResponseTime: this.getAverageResponseTime(),
        memoryUsageTotal: this.getTotalMemoryUsage(),
        activeConnections: this.getActiveConnections(),
      },
      alerts: Array.from(this.alerts.values()),
      lastUpdate: Date.now(),
    };
  }
  
  // Utility methods
  private createInitialHealthStatus(): HealthStatus {
    return {
      status: 'unknown',
      lastCheck: 0,
      responseTime: 0,
      errorRate: 0,
      memoryUsage: 0,
      uptime: 0,
      details: {},
    };
  }
  
  private createAlert(
    severity: 'low' | 'medium' | 'high' | 'critical',
    component: keyof ComponentHealth,
    message: string,
    details: Record<string, any>
  ): HealthAlert {
    return {
      id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      severity,
      component,
      message,
      timestamp: Date.now(),
      acknowledged: false,
      details,
    };
  }
  
  private async simulateComponentHealth(component: string, mockData: Record<string, any>): Promise<any> {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, Math.random() * 100 + 50));
    return mockData;
  }
  
  private getOverallHealthStatus(): 'healthy' | 'degraded' | 'unhealthy' {
    return this.getSystemHealth().overall;
  }
  
  private getAverageResponseTime(): number {
    return this.metrics.requestCount > 0 
      ? this.metrics.responseTimeSum / this.metrics.requestCount 
      : 0;
  }
  
  private getErrorRate(): number {
    return this.metrics.totalRequests > 0 
      ? (this.metrics.totalErrors / this.metrics.totalRequests) * 100 
      : 0;
  }
  
  private getTotalMemoryUsage(): number {
    return Object.values(this.componentHealth)
      .reduce((sum, component) => sum + component.memoryUsage, 0);
  }
  
  private getActiveConnections(): number {
    // Sum up active connections from all components
    return Object.values(this.componentHealth)
      .reduce((sum, component) => {
        const connections = component.details?.activeConnections || 
                           component.details?.activeAgents || 
                           component.details?.activeSessions || 0;
        return sum + connections;
      }, 0);
  }
  
  private setupMonitoring(): void {
    // Listen for component-specific events that might indicate health issues
    this.eventBridge.subscribe({
      id: 'health-monitor-errors',
      filter: {
        type: ['quality-gate-failed', 'safety-check-failed', 'task-blocked'],
      },
      handler: (event) => {
        // Create alerts based on error events
        if (event.type === 'quality-gate-failed') {
          this.alerts.set(`error-${Date.now()}`, this.createAlert(
            'medium',
            'vc',
            'Quality gate failed',
            { event }
          ));
        }
      },
      priority: 1,
    });
  }
  
  // Acknowledge alert
  acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.get(alertId);
    if (alert) {
      alert.acknowledged = true;
      this.emit('alert-acknowledged', alert);
      return true;
    }
    return false;
  }
  
  // Clear old alerts
  clearOldAlerts(maxAge: number = 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - maxAge;
    let cleared = 0;
    
    for (const [id, alert] of this.alerts) {
      if (alert.timestamp < cutoff && alert.acknowledged) {
        this.alerts.delete(id);
        cleared++;
      }
    }
    
    return cleared;
  }
}

// Factory function
export function createYeggeHealthMonitor(config: YeggeConfig, eventBridge: YeggeEventBridge): YeggeHealthMonitor {
  return new YeggeHealthMonitor(config, eventBridge);
}