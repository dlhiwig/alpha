# 🦊 SKYNET AUDIT TRAIL SYSTEM

**Wave 9: AUDIT** — TrustClaw-Style Compliance & Security

A comprehensive audit trail system for SuperClaw that provides enterprise-grade logging, monitoring, and compliance capabilities. Inspired by TrustClaw's audit features but enhanced for multi-agent environments.

## ✨ Features

### Core Capabilities
- **Comprehensive Logging**: Auto-logs all tool executions, agent spawns, and cost events
- **Privacy-Safe**: Automatically sanitizes sensitive data (API keys, tokens, passwords)
- **High Performance**: SQLite + batch processing for efficient storage
- **Rich Queries**: Advanced filtering and search capabilities
- **Multiple Export Formats**: JSON, CSV, and Parquet support
- **Real-time Monitoring**: Live event streaming and anomaly detection
- **SKYNET Integration**: Seamlessly integrates with existing SKYNET components

### Security & Compliance
- **Sensitive Data Sanitization**: Automatically redacts API keys, tokens, and credentials
- **Hierarchical Logging**: Links related events (parent/child relationships)
- **Severity Classification**: Automated severity assessment for events
- **Retention Management**: Configurable log retention with automatic cleanup
- **Audit Integrity**: Immutable log entries with tamper detection

### Monitoring & Alerting
- **Anomaly Detection**: Identifies unusual patterns in cost, latency, and errors
- **SENTINEL Integration**: Leverages SKYNET SENTINEL for advanced monitoring
- **Real-time Alerts**: Immediate notifications for high-severity events
- **Behavioral Analysis**: Tracks agent behavior patterns and performance metrics
- **Trend Analysis**: Long-term trend detection for capacity planning

## 🚀 Quick Start

### Basic Setup

```typescript
import { startAuditTrail, getAuditTrail } from './skynet/index.js';

// Initialize audit trail with default settings
const audit = startAuditTrail({
  enabled: true,
  dbPath: './data/audit-trail.db',
  sanitizeSensitiveData: true,
  alertOnHighSeverity: true
});

// Basic logging
audit.log({
  sessionId: 'session-123',
  agentId: 'agent-456',
  action: 'tool_call',
  tool: 'web_search',
  params: { query: 'AI safety research' },
  result: 'success',
  durationMs: 1500,
  tokenUsage: { input: 100, output: 200 },
  costUsd: 0.05
});
```

### Auto-Integration Setup

```typescript
import { AuditAutoIntegration, startAuditSentinelMonitoring } from './skynet/index.js';

// Enable automatic logging of all tool calls
AuditAutoIntegration.initialize();

// Start SENTINEL integration for monitoring
startAuditSentinelMonitoring({
  errorRateThreshold: 0.15,    // Alert at 15% error rate
  costSpikeThreshold: 2.0,     // Alert at 2x cost increase
  latencyThreshold: 30000,     // Alert at 30s latency
  securityEventThreshold: 5    // Max 5 security events/hour
});
```

## 📊 Usage Examples

### Manual Logging

```typescript
import { logToolCall, logAgentSpawn, logCostEvent } from './skynet/index.js';

// Log tool execution
logToolCall({
  sessionId: 'session-123',
  agentId: 'agent-456',
  tool: 'file_read',
  params: { path: '/documents/report.pdf' },
  result: 'success',
  durationMs: 800,
  tokenUsage: { input: 0, output: 500 },
  costUsd: 0.02
});

// Log agent spawn
logAgentSpawn({
  sessionId: 'session-123',
  agentId: 'child-agent-789',
  parentAgentId: 'agent-456',
  result: 'success',
  durationMs: 3000,
  metadata: {
    config: { model: 'claude-3-sonnet', maxTokens: 4000 },
    purpose: 'document analysis'
  }
});

// Log cost event
logCostEvent({
  sessionId: 'session-123',
  agentId: 'agent-456',
  costUsd: 0.15,
  tokenUsage: { input: 1000, output: 500 },
  metadata: {
    provider: 'anthropic',
    model: 'claude-3-sonnet',
    requestType: 'chat_completion'
  }
});
```

### Advanced Queries

```typescript
const audit = getAuditTrail();

// Find all failed operations in the last hour
const recentFailures = audit.query({
  result: 'failure',
  dateFrom: new Date(Date.now() - 60 * 60 * 1000),
  orderBy: 'timestamp',
  orderDir: 'desc'
});

// Find high-cost operations
const expensiveOps = audit.query({
  costThreshold: 1.0,  // $1+
  orderBy: 'cost',
  orderDir: 'desc',
  limit: 10
});

// Find slow operations by specific agent
const slowOps = audit.query({
  agentId: 'agent-456',
  durationThreshold: 5000,  // 5+ seconds
  action: 'tool_call'
});

// Multi-criteria search
const complexQuery = audit.query({
  sessionId: 'session-123',
  action: ['tool_call', 'cost_event'],
  result: ['success', 'failure'],
  dateFrom: new Date('2026-02-01'),
  dateTo: new Date('2026-02-21'),
  severity: ['medium', 'high', 'critical'],
  tags: ['security', 'compliance'],
  limit: 100,
  offset: 0
});
```

### Export & Reporting

```typescript
// Export to JSON
const jsonReport = audit.export('json', {
  dateFrom: new Date('2026-02-01'),
  dateTo: new Date('2026-02-21'),
  action: 'tool_call'
});

// Export to CSV for spreadsheet analysis
const csvReport = audit.export('csv', {
  agentId: 'agent-456',
  result: 'failure'
});

// Export filtered data for compliance
const complianceData = audit.export('json', {
  severity: ['high', 'critical'],
  action: ['security', 'auth'],
  dateFrom: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
});
```

### Statistics & Analytics

```typescript
// Get comprehensive statistics
const stats = audit.getStats();

console.log(`
📊 Audit Statistics:
- Total logs: ${stats.totalLogs}
- Total cost: $${stats.totalCost.toFixed(2)}
- Error rate: ${(stats.errorRate * 100).toFixed(1)}%
- Average duration: ${stats.averageDuration.toFixed(0)}ms

🏆 Top Agents:
${stats.topAgents.map(a => `  - ${a.agentId}: ${a.count} calls, $${a.cost.toFixed(2)}`).join('\n')}

🔧 Top Tools:
${stats.topTools.map(t => `  - ${t.tool}: ${t.count} calls, ${t.avgDuration.toFixed(0)}ms avg`).join('\n')}
`);

// Time-bounded statistics
const lastWeekStats = audit.getStats(
  new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
  new Date() // now
);
```

## 🔒 Data Sanitization

The audit system automatically sanitizes sensitive data to prevent credential leakage:

### Sensitive Key Detection
- `password`, `token`, `key`, `secret`, `auth`, `credential`
- `api_key`, `apikey`, `access_token`, `refresh_token`
- `private_key`, `ssh_key`, `cert`, `certificate`
- `authorization`, `bearer`, `oauth`, `jwt`

### Pattern-Based Sanitization
- OpenAI/Anthropic API keys: `sk-*`, `sk-ant-*`
- GitHub tokens: `ghp_*`, `gho_*`
- AWS keys: `AKIA*`
- OAuth tokens: `ya29.*`
- Credit card numbers: `****-****-****-****`

### Example

```typescript
// Input with sensitive data
const params = {
  apiKey: 'sk-1234567890abcdef',
  config: {
    password: 'secret123',
    publicData: 'this is fine'
  },
  headers: {
    'Authorization': 'Bearer ghp_abcdef123456'
  }
};

// Automatically sanitized in logs
audit.log({
  sessionId: 'session-123',
  agentId: 'agent-456',
  action: 'tool_call',
  params: params, // Will be sanitized
  result: 'success',
  durationMs: 500
});

// Stored as:
// {
//   params: {
//     apiKey: '[REDACTED]',
//     config: {
//       password: '[REDACTED]',
//       publicData: 'this is fine'
//     },
//     headers: {
//       'Authorization': '[REDACTED]'
//     }
//   }
// }
```

## 📈 SENTINEL Integration

The audit system integrates with SKYNET SENTINEL for advanced monitoring and alerting:

### Real-time Monitoring
- **Error Rate Tracking**: Alerts when error rates exceed thresholds
- **Cost Spike Detection**: Detects unusual cost increases
- **Latency Anomalies**: Identifies performance degradation
- **Security Event Clustering**: Monitors security-related events

### Automated Alerts

```typescript
// SENTINEL will automatically create alerts for:
// - Error rates above 15% (configurable)
// - Cost spikes above 2x baseline (configurable)
// - Latency above 30 seconds (configurable)
// - More than 5 security events per hour (configurable)

// Custom alert example:
audit.on('high_severity', (log) => {
  if (log.severity === 'critical') {
    // Immediate notification
    console.log(`🚨 CRITICAL EVENT: ${log.action} by ${log.agentId}`);
    
    // Could integrate with:
    // - Slack notifications
    // - Email alerts
    // - PagerDuty incidents
    // - Discord webhooks
  }
});
```

### Behavioral Analysis

```typescript
// The SENTINEL integration automatically tracks:
// - Agent performance patterns
// - Tool usage trends  
// - Cost optimization opportunities
// - Security threat indicators

const integration = getAuditSentinelIntegration();
const monitoringStats = integration.getMonitoringStats();

console.log(`
🔍 Monitoring Statistics:
- Alerts generated: ${monitoringStats.alertsGenerated}
- Agents monitored: ${monitoringStats.baselineAgents}
- Last check: ${monitoringStats.lastCheckTime.toISOString()}
`);
```

## 🛠 Configuration Options

```typescript
interface AuditConfig {
  enabled: boolean;                    // Enable/disable audit trail
  dbPath?: string;                     // SQLite database path
  jsonBackupPath?: string;             // JSON backup file path
  maxLogsInMemory?: number;            // Max logs to buffer (10,000)
  batchWriteSize?: number;             // Batch size for writes (100)
  enableRealTimeStream?: boolean;      // Real-time event streaming (true)
  sanitizeSensitiveData?: boolean;     // Auto-sanitize secrets (true)
  retentionDays?: number;              // Log retention period (365)
  compressionEnabled?: boolean;        // Enable log compression (true)
  alertOnHighSeverity?: boolean;       // Alert on high-severity events (true)
  notificationChannels?: string[];     // Notification channels
}

// Example production configuration
const productionConfig: AuditConfig = {
  enabled: true,
  dbPath: '/var/log/superclaw/audit-trail.db',
  jsonBackupPath: '/var/log/superclaw/audit-backup.jsonl',
  maxLogsInMemory: 50000,
  batchWriteSize: 500,
  enableRealTimeStream: true,
  sanitizeSensitiveData: true,
  retentionDays: 2555, // 7 years for compliance
  compressionEnabled: true,
  alertOnHighSeverity: true,
  notificationChannels: ['slack', 'email', 'pagerduty']
};
```

## 🏗 Architecture

### Components

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   AuditTrail    │    │  Integrations   │    │   SENTINEL      │
│                 │    │                 │    │                 │
│ • Core logging  │◄──►│ • Auto-capture  │◄──►│ • Monitoring    │
│ • Data storage  │    │ • Interceptors  │    │ • Alerting      │
│ • Query engine  │    │ • Convenience   │    │ • Analytics     │
│ • Export tools  │    │   methods       │    │ • Anomaly det.  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
          │                        │                        │
          ▼                        ▼                        ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│    SQLite DB    │    │   Tool Hooks    │    │    Alerts       │
│                 │    │                 │    │                 │
│ • Indexed logs  │    │ • Agent spawns  │    │ • Error rates   │
│ • Performance   │    │ • Cost events   │    │ • Cost spikes   │
│ • Retention     │    │ • System events │    │ • Security      │
│ • Compression   │    │ • Security logs │    │ • Performance   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Data Flow

1. **Event Capture**: Tool calls, agent spawns, cost events → Interceptors
2. **Data Sanitization**: Remove sensitive information automatically
3. **Batch Processing**: Collect events → Write in batches for performance
4. **Storage**: SQLite (primary) + JSON (backup) with indexing
5. **Real-time Streaming**: Emit events for live monitoring
6. **SENTINEL Analysis**: Anomaly detection and alerting
7. **Query & Export**: Advanced filtering and multiple export formats

### Performance Characteristics

- **Write Performance**: 10,000+ logs/second with batching
- **Query Performance**: Sub-second queries on millions of records
- **Storage Efficiency**: ~500 bytes per log entry (compressed)
- **Memory Usage**: Configurable buffering, minimal baseline footprint
- **Scalability**: Handles 100M+ logs with proper indexing

## 🔧 Advanced Usage

### Custom Severity Classification

```typescript
// Custom severity logic
audit.log({
  sessionId: 'session-123',
  agentId: 'agent-456',
  action: 'tool_call',
  tool: 'file_delete',
  params: { path: '/critical/data.json' },
  result: 'success',
  durationMs: 100,
  severity: 'high', // Manual severity override
  tags: ['destructive', 'critical-data']
});
```

### Hierarchical Logging

```typescript
// Parent operation
const parentLogId = 'parent-operation-123';
audit.log({
  sessionId: 'session-123',
  agentId: 'agent-456',
  action: 'tool_call',
  tool: 'document_analyzer',
  result: 'success',
  durationMs: 5000,
  metadata: { logId: parentLogId }
});

// Child operations
for (const page of pages) {
  audit.log({
    sessionId: 'session-123',
    agentId: 'agent-456',
    action: 'tool_call',
    tool: 'ocr_extract',
    params: { page: page.number },
    result: 'success',
    durationMs: 800,
    parentLogId: parentLogId // Links to parent
  });
}
```

### Custom Event Streaming

```typescript
const audit = getAuditTrail();

// Listen to all events
audit.on('log', (log) => {
  if (log.costUsd && log.costUsd > 0.50) {
    console.log(`💰 High cost operation: $${log.costUsd} for ${log.tool}`);
  }
});

// Listen to high-severity events only
audit.on('high_severity', (log) => {
  // Send to external monitoring system
  sendToDatadog({
    event: 'audit.high_severity',
    severity: log.severity,
    agent: log.agentId,
    action: log.action,
    cost: log.costUsd,
    duration: log.durationMs
  });
});
```

### Compliance Reporting

```typescript
// Generate compliance report for the last quarter
function generateComplianceReport(startDate: Date, endDate: Date) {
  const audit = getAuditTrail();
  
  // Security events
  const securityEvents = audit.query({
    action: ['security', 'auth'],
    dateFrom: startDate,
    dateTo: endDate,
    severity: ['medium', 'high', 'critical']
  });
  
  // High-cost operations
  const expensiveOps = audit.query({
    costThreshold: 5.0,
    dateFrom: startDate,
    dateTo: endDate
  });
  
  // Error analysis
  const errors = audit.query({
    result: 'failure',
    dateFrom: startDate,
    dateTo: endDate
  });
  
  // Generate report
  const report = {
    period: { start: startDate, end: endDate },
    summary: {
      totalEvents: audit.query({ dateFrom: startDate, dateTo: endDate }).length,
      securityEvents: securityEvents.length,
      highCostOperations: expensiveOps.length,
      errorCount: errors.length,
      totalCost: audit.getStats(startDate, endDate).totalCost
    },
    details: {
      securityEvents: securityEvents.slice(0, 10), // Top 10
      expensiveOperations: expensiveOps.slice(0, 10),
      topErrors: errors.slice(0, 10)
    }
  };
  
  return audit.export('json', { dateFrom: startDate, dateTo: endDate });
}
```

## 🧪 Testing

The audit system includes comprehensive tests covering:

- **Core Functionality**: Logging, querying, exporting
- **Data Sanitization**: Sensitive data removal
- **Performance**: Bulk operations and query efficiency
- **Integration**: Interceptors and convenience methods
- **Error Handling**: Graceful degradation
- **Edge Cases**: Invalid data, database errors

```bash
# Run audit trail tests
npm test -- src/skynet/__tests__/audit.test.ts

# Run with coverage
npm run test:coverage
```

## 🚨 Troubleshooting

### Common Issues

**1. Database Permission Errors**
```bash
# Ensure proper permissions
chmod 755 /path/to/data/directory
chmod 644 /path/to/data/audit-trail.db
```

**2. High Memory Usage**
```typescript
// Reduce batch size and memory limits
const audit = startAuditTrail({
  maxLogsInMemory: 1000,   // Reduce from 10,000
  batchWriteSize: 50       // Reduce from 100
});
```

**3. Slow Queries**
```sql
-- Check database indexes
.schema audit_logs

-- Manual index creation if needed
CREATE INDEX idx_custom ON audit_logs(session_id, timestamp);
```

**4. Storage Space Issues**
```typescript
// Enable compression and reduce retention
const audit = startAuditTrail({
  compressionEnabled: true,
  retentionDays: 90,  // Reduce from 365
});
```

### Debug Mode

```typescript
// Enable debug logging
process.env.DEBUG = 'audit:*';

const audit = startAuditTrail({
  enabled: true,
  // ... other config
});

// Manual cleanup
audit.close();
```

## 📋 Migration Guide

### From Manual Logging to Audit Trail

**Before:**
```typescript
console.log(`Tool executed: ${tool} in ${duration}ms with result ${result}`);
```

**After:**
```typescript
logToolCall({
  sessionId: getCurrentSession(),
  agentId: getCurrentAgent(),
  tool: tool,
  params: params,
  result: result,
  durationMs: duration,
  tokenUsage: usage,
  costUsd: cost
});
```

### From Basic Monitoring to SENTINEL Integration

**Before:**
```typescript
if (errorRate > 0.1) {
  console.warn('High error rate detected');
}
```

**After:**
```typescript
startAuditSentinelMonitoring({
  errorRateThreshold: 0.1,
  costSpikeThreshold: 2.0,
  latencyThreshold: 30000
});
// Automatic detection and alerting
```

## 🔮 Future Enhancements

### Planned Features
- **Machine Learning**: Automated anomaly detection using ML models
- **Real-time Dashboards**: Web-based monitoring interface
- **Advanced Analytics**: Predictive cost modeling and capacity planning
- **External Integrations**: Elasticsearch, Prometheus, Grafana
- **Blockchain Audit**: Immutable audit trails using blockchain
- **Federated Logging**: Multi-instance log aggregation

### Experimental Features
- **Event Sourcing**: Complete system state reconstruction from logs
- **Time Travel Debugging**: Replay system state from audit logs
- **Compliance Automation**: Automated compliance report generation
- **Privacy Controls**: GDPR-compliant data anonymization
- **Distributed Tracing**: OpenTelemetry integration for request tracing

---

## 📚 API Reference

### AuditTrail Class

#### Constructor
```typescript
constructor(config: AuditConfig)
```

#### Methods

**log(action: AuditAction): void**
- Logs an audit event
- Automatically sanitizes sensitive data
- Triggers real-time events

**query(filters: AuditFilters): AuditLog[]**
- Queries audit logs with advanced filtering
- Supports pagination and sorting
- Returns structured log objects

**export(format: 'json' | 'csv' | 'parquet', filters?: AuditFilters): string**
- Exports logs in specified format
- Applies filters before export
- Returns formatted string data

**getStats(dateFrom?: Date, dateTo?: Date): AuditStats**
- Returns comprehensive statistics
- Optionally time-bounded
- Includes performance metrics

**close(): Promise<void>**
- Closes database connections
- Flushes remaining logs
- Cleanup resources

### Integration Functions

**logToolCall(params): void**
- Convenience method for tool call logging
- Auto-sets action type and severity

**logAgentSpawn(params): void** 
- Convenience method for agent spawn logging
- Links to parent agent if specified

**logCostEvent(params): void**
- Convenience method for cost event logging
- Automatically calculates severity based on cost

**logSecurityEvent(params): void**
- Logs security-related events
- Always treated as high-priority

**logSystemEvent(params): void**
- Logs system-level events
- Configurable severity levels

---

*Built with ❤️ by the SuperClaw team. Part of SKYNET Protocol Wave 9: AUDIT.*