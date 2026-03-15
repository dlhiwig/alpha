#!/usr/bin/env node

/**
 * 🦊 SKYNET AUDIT CLI
 * 
 * Command-line interface for querying and managing audit logs.
 * Useful for debugging, monitoring, and compliance reporting.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { getAuditTrail, AuditFilters, AuditLog } from './audit';
import { getAuditSystemHealth } from './audit-init';
import fs from 'fs/promises';
import path from 'path';

// ═══════════════════════════════════════════════════════════════
// CLI PROGRAM SETUP
// ═══════════════════════════════════════════════════════════════

const program = new Command();

program
  .name('audit-cli')
  .description('🦊 SuperClaw Audit Trail CLI')
  .version('2.4.0')
  .option('-d, --db <path>', 'Path to audit database', './data/audit-trail.db')
  .option('--no-colors', 'Disable colored output');

// ═══════════════════════════════════════════════════════════════
// QUERY COMMAND
// ═══════════════════════════════════════════════════════════════

program
  .command('query')
  .description('Query audit logs with filters')
  .option('-s, --session <id>', 'Filter by session ID')
  .option('-a, --agent <id>', 'Filter by agent ID')
  .option('-t, --tool <name>', 'Filter by tool name')
  .option('--action <type>', 'Filter by action type (tool_call, agent_spawn, cost_event, etc.)')
  .option('--result <status>', 'Filter by result status (success, failure, timeout)')
  .option('--severity <level>', 'Filter by severity (low, medium, high, critical)')
  .option('--from <date>', 'Filter from date (ISO format or relative like "1h", "1d", "1w")')
  .option('--to <date>', 'Filter to date (ISO format)')
  .option('--cost-min <amount>', 'Minimum cost threshold (USD)', parseFloat)
  .option('--duration-min <ms>', 'Minimum duration threshold (ms)', parseInt)
  .option('--limit <count>', 'Limit number of results', parseInt, 50)
  .option('--offset <count>', 'Offset for pagination', parseInt, 0)
  .option('--order-by <field>', 'Order by field (timestamp, cost, duration)', 'timestamp')
  .option('--order-dir <direction>', 'Order direction (asc, desc)', 'desc')
  .option('--format <type>', 'Output format (table, json, csv)', 'table')
  .option('--output <file>', 'Save results to file')
  .action(async (options) => {
    try {
      const audit = getAuditTrail({
        enabled: true,
        dbPath: program.opts().db
      });

      const filters: AuditFilters = {
        sessionId: options.session,
        agentId: options.agent,
        tool: options.tool,
        action: options.action,
        result: options.result,
        severity: options.severity,
        costThreshold: options.costMin,
        durationThreshold: options.durationMin,
        limit: options.limit,
        offset: options.offset,
        orderBy: options.orderBy,
        orderDir: options.orderDir
      };

      // Parse date filters
      if (options.from) {
        filters.dateFrom = parseDate(options.from);
      }
      if (options.to) {
        filters.dateTo = parseDate(options.to);
      }

      const logs = audit.query(filters);
      
      let output: string;
      switch (options.format) {
        case 'json':
          output = JSON.stringify(logs, null, 2);
          break;
        case 'csv':
          output = audit.export('csv', filters);
          break;
        case 'table':
        default:
          output = formatLogsAsTable(logs);
          break;
      }

      if (options.output) {
        await fs.writeFile(options.output, output);
        console.log(chalk.green(`✅ Results saved to ${options.output}`));
      } else {
        console.log(output);
      }

      if (logs.length === options.limit) {
        console.log(chalk.yellow(`⚠️  Results limited to ${options.limit}. Use --limit or --offset for more.`));
      }

    } catch (error: unknown) {
      console.error(chalk.red('❌ Query failed:'), error);
      process.exit(1);
    }
  });

// ═══════════════════════════════════════════════════════════════
// STATS COMMAND
// ═══════════════════════════════════════════════════════════════

program
  .command('stats')
  .description('Show audit trail statistics')
  .option('--from <date>', 'Statistics from date')
  .option('--to <date>', 'Statistics to date')
  .option('--format <type>', 'Output format (table, json)', 'table')
  .action(async (options) => {
    try {
      const audit = getAuditTrail({
        enabled: true,
        dbPath: program.opts().db
      });

      const fromDate = options.from ? parseDate(options.from) : undefined;
      const toDate = options.to ? parseDate(options.to) : undefined;
      
      const stats = audit.getStats(fromDate, toDate);

      if (options.format === 'json') {
        console.log(JSON.stringify(stats, null, 2));
        return;
      }

      // Display formatted statistics
      console.log(chalk.blue.bold('🦊 AUDIT TRAIL STATISTICS'));
      console.log('');

      const overviewTable = new Table({
        head: ['Metric', 'Value'],
        colWidths: [30, 20]
      });

      overviewTable.push(
        ['Total Logs', stats.totalLogs.toLocaleString()],
        ['Total Cost', `$${stats.totalCost.toFixed(2)}`],
        ['Average Duration', `${stats.averageDuration.toFixed(0)}ms`],
        ['Error Rate', `${(stats.errorRate * 100).toFixed(1)}%`]
      );

      console.log(overviewTable.toString());
      console.log('');

      // Logs by action
      if (Object.keys(stats.logsByAction).length > 0) {
        console.log(chalk.green.bold('📊 LOGS BY ACTION'));
        const actionTable = new Table({
          head: ['Action', 'Count', 'Percentage'],
          colWidths: [20, 10, 12]
        });

        Object.entries(stats.logsByAction).forEach(([action, count]) => {
          const percentage = ((count / stats.totalLogs) * 100).toFixed(1);
          actionTable.push([action, count.toLocaleString(), `${percentage}%`]);
        });

        console.log(actionTable.toString());
        console.log('');
      }

      // Top agents
      if (stats.topAgents.length > 0) {
        console.log(chalk.cyan.bold('🏆 TOP AGENTS'));
        const agentTable = new Table({
          head: ['Agent ID', 'Calls', 'Total Cost'],
          colWidths: [25, 10, 12]
        });

        stats.topAgents.slice(0, 10).forEach(agent => {
          agentTable.push([
            agent.agentId,
            agent.count.toLocaleString(),
            `$${agent.cost.toFixed(2)}`
          ]);
        });

        console.log(agentTable.toString());
        console.log('');
      }

      // Top tools
      if (stats.topTools.length > 0) {
        console.log(chalk.magenta.bold('🔧 TOP TOOLS'));
        const toolTable = new Table({
          head: ['Tool', 'Calls', 'Avg Duration'],
          colWidths: [20, 10, 15]
        });

        stats.topTools.slice(0, 10).forEach(tool => {
          toolTable.push([
            tool.tool,
            tool.count.toLocaleString(),
            `${tool.avgDuration.toFixed(0)}ms`
          ]);
        });

        console.log(toolTable.toString());
        console.log('');
      }

      // Recent errors
      if (stats.recentErrors.length > 0) {
        console.log(chalk.red.bold('🚨 RECENT ERRORS'));
        const errorTable = new Table({
          head: ['Time', 'Agent', 'Tool/Action', 'Error'],
          colWidths: [20, 15, 15, 35]
        });

        stats.recentErrors.slice(0, 5).forEach(error => {
          errorTable.push([
            error.timestamp.toLocaleTimeString(),
            error.agentId.substring(0, 12) + '...',
            error.tool || error.action,
            (error.errorMessage || 'Unknown error').substring(0, 30) + '...'
          ]);
        });

        console.log(errorTable.toString());
      }

    } catch (error: unknown) {
      console.error(chalk.red('❌ Stats failed:'), error);
      process.exit(1);
    }
  });

// ═══════════════════════════════════════════════════════════════
// EXPORT COMMAND
// ═══════════════════════════════════════════════════════════════

program
  .command('export')
  .description('Export audit logs')
  .argument('<format>', 'Export format (json, csv, parquet)')
  .argument('<output>', 'Output file path')
  .option('-s, --session <id>', 'Filter by session ID')
  .option('-a, --agent <id>', 'Filter by agent ID')
  .option('--from <date>', 'Export from date')
  .option('--to <date>', 'Export to date')
  .option('--action <type>', 'Filter by action type')
  .option('--result <status>', 'Filter by result status')
  .action(async (format, output, options) => {
    try {
      const audit = getAuditTrail({
        enabled: true,
        dbPath: program.opts().db
      });

      const filters: AuditFilters = {
        sessionId: options.session,
        agentId: options.agent,
        action: options.action,
        result: options.result
      };

      if (options.from) {filters.dateFrom = parseDate(options.from);}
      if (options.to) {filters.dateTo = parseDate(options.to);}

      console.log(chalk.blue('🔄 Exporting audit logs...'));
      
      const exportData = audit.export(format, filters);
      await fs.writeFile(output, exportData);

      const logs = audit.query(filters);
      console.log(chalk.green(`✅ Exported ${logs.length} logs to ${output}`));

    } catch (error: unknown) {
      console.error(chalk.red('❌ Export failed:'), error);
      process.exit(1);
    }
  });

// ═══════════════════════════════════════════════════════════════
// HEALTH COMMAND
// ═══════════════════════════════════════════════════════════════

program
  .command('health')
  .description('Check audit system health')
  .option('--format <type>', 'Output format (table, json)', 'table')
  .action(async (options) => {
    try {
      const health = await getAuditSystemHealth();

      if (options.format === 'json') {
        console.log(JSON.stringify(health, null, 2));
        return;
      }

      console.log(chalk.blue.bold('🦊 AUDIT SYSTEM HEALTH'));
      console.log('');

      const healthTable = new Table({
        head: ['Component', 'Status', 'Details'],
        colWidths: [20, 15, 40]
      });

      const formatStatus = (status: string) => {
        switch (status) {
          case 'healthy':
          case 'active':
            return chalk.green('✅ ' + status.toUpperCase());
          case 'inactive':
          case 'unavailable':
            return chalk.yellow('⚠️  ' + status.toUpperCase());
          case 'error':
            return chalk.red('❌ ERROR');
          default:
            return status;
        }
      };

      healthTable.push(
        ['Audit System', health.enabled ? '✅ ENABLED' : '❌ DISABLED', ''],
        ['Database', formatStatus(health.database), health.totalLogs ? `${health.totalLogs} total logs` : ''],
        ['SENTINEL Monitor', formatStatus(health.sentinel), ''],
        ['Auto Integration', formatStatus(health.autoIntegration), '']
      );

      if (health.errorRate !== undefined) {
        healthTable.push([
          'Error Rate (24h)',
          health.errorRate > 0.1 ? chalk.red(`${(health.errorRate * 100).toFixed(1)}%`) : chalk.green(`${(health.errorRate * 100).toFixed(1)}%`),
          health.errorRate > 0.1 ? 'High error rate detected' : 'Normal'
        ]);
      }

      if (health.lastLogTime) {
        const timeSinceLastLog = Date.now() - health.lastLogTime.getTime();
        const lastLogStatus = timeSinceLastLog > 60000 ? chalk.yellow('> 1 min ago') : chalk.green('Recent');
        healthTable.push([
          'Last Log Activity',
          lastLogStatus,
          health.lastLogTime.toLocaleString()
        ]);
      }

      console.log(healthTable.toString());

      // Overall health indicator
      const isHealthy = health.enabled && health.database === 'healthy';
      console.log('');
      console.log('Overall Status:', isHealthy ? chalk.green('🟢 HEALTHY') : chalk.red('🔴 UNHEALTHY'));

    } catch (error: unknown) {
      console.error(chalk.red('❌ Health check failed:'), error);
      process.exit(1);
    }
  });

// ═══════════════════════════════════════════════════════════════
// CLEANUP COMMAND
// ═══════════════════════════════════════════════════════════════

program
  .command('cleanup')
  .description('Clean up old audit logs')
  .option('--days <count>', 'Keep logs newer than N days', parseInt, 90)
  .option('--dry-run', 'Show what would be deleted without actually deleting')
  .action(async (options) => {
    try {
      const audit = getAuditTrail({
        enabled: true,
        dbPath: program.opts().db
      });

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - options.days);

      console.log(chalk.blue(`🧹 Cleaning up logs older than ${options.days} days (before ${cutoffDate.toLocaleDateString()})`));

      // Find logs to delete
      const logsToDelete = audit.query({
        dateTo: cutoffDate,
        limit: 1000000 // Large limit to get all old logs
      });

      if (logsToDelete.length === 0) {
        console.log(chalk.green('✅ No old logs to clean up'));
        return;
      }

      if (options.dryRun) {
        console.log(chalk.yellow(`🔍 DRY RUN: Would delete ${logsToDelete.length} logs`));
        
        const sampleTable = new Table({
          head: ['Date', 'Agent', 'Action', 'Tool'],
          colWidths: [20, 15, 15, 15]
        });

        logsToDelete.slice(0, 10).forEach(log => {
          sampleTable.push([
            log.timestamp.toLocaleDateString(),
            log.agentId.substring(0, 12) + '...',
            log.action,
            log.tool || 'N/A'
          ]);
        });

        console.log(sampleTable.toString());
        if (logsToDelete.length > 10) {
          console.log(chalk.gray(`... and ${logsToDelete.length - 10} more`));
        }
        return;
      }

      // TODO: Implement actual cleanup in the AuditTrail class
      console.log(chalk.yellow('⚠️  Actual cleanup not yet implemented. Use --dry-run to see what would be deleted.'));

    } catch (error: unknown) {
      console.error(chalk.red('❌ Cleanup failed:'), error);
      process.exit(1);
    }
  });

// ═══════════════════════════════════════════════════════════════
// TAIL COMMAND
// ═══════════════════════════════════════════════════════════════

program
  .command('tail')
  .description('Watch audit logs in real-time')
  .option('-f, --follow', 'Follow log output (like tail -f)', true)
  .option('-n, --lines <count>', 'Show last N lines', parseInt, 10)
  .option('--filter <pattern>', 'Filter logs by text pattern')
  .action(async (options) => {
    try {
      const audit = getAuditTrail({
        enabled: true,
        dbPath: program.opts().db
      });

      // Show recent logs first
      const recentLogs = audit.query({
        orderBy: 'timestamp',
        orderDir: 'desc',
        limit: options.lines
      }).toReversed(); // Reverse to show oldest first

      console.log(chalk.blue.bold('🦊 AUDIT LOG TAIL'));
      console.log(chalk.gray(`Showing last ${options.lines} logs${options.filter ? ` (filtered: ${options.filter})` : ''}`));
      console.log('');

      recentLogs.forEach(log => {
        if (!options.filter || JSON.stringify(log).includes(options.filter)) {
          console.log(formatLogLine(log));
        }
      });

      if (options.follow) {
        console.log(chalk.gray('--- Following new logs (Ctrl+C to exit) ---'));
        
        audit.on('log', (log: AuditLog) => {
          if (!options.filter || JSON.stringify(log).includes(options.filter)) {
            console.log(formatLogLine(log));
          }
        });

        // Keep process alive
        process.stdin.resume();
      }

    } catch (error: unknown) {
      console.error(chalk.red('❌ Tail failed:'), error);
      process.exit(1);
    }
  });

// ═══════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function parseDate(dateStr: string): Date {
  // Handle relative dates
  const relativeMatch = dateStr.match(/^(\d+)(h|d|w|m)$/);
  if (relativeMatch) {
    const [, amount, unit] = relativeMatch;
    const now = new Date();
    const value = parseInt(amount);
    
    switch (unit) {
      case 'h': return new Date(now.getTime() - value * 60 * 60 * 1000);
      case 'd': return new Date(now.getTime() - value * 24 * 60 * 60 * 1000);
      case 'w': return new Date(now.getTime() - value * 7 * 24 * 60 * 60 * 1000);
      case 'm': return new Date(now.getTime() - value * 30 * 24 * 60 * 60 * 1000);
    }
  }
  
  // Handle ISO dates
  return new Date(dateStr);
}

function formatLogsAsTable(logs: AuditLog[]): string {
  if (logs.length === 0) {
    return chalk.yellow('No logs found matching the criteria.');
  }

  const table = new Table({
    head: ['Time', 'Agent', 'Action', 'Tool', 'Result', 'Duration', 'Cost'],
    colWidths: [20, 15, 12, 15, 10, 10, 10]
  });

  logs.forEach(log => {
    const resultColor = log.result === 'success' ? chalk.green : 
                       log.result === 'failure' ? chalk.red : 
                       chalk.yellow;

    table.push([
      log.timestamp.toLocaleTimeString(),
      log.agentId.substring(0, 12) + (log.agentId.length > 12 ? '...' : ''),
      log.action,
      log.tool || 'N/A',
      resultColor(log.result),
      `${log.durationMs}ms`,
      log.costUsd ? `$${log.costUsd.toFixed(3)}` : 'N/A'
    ]);
  });

  return table.toString();
}

function formatLogLine(log: AuditLog): string {
  const timestamp = chalk.gray(log.timestamp.toISOString());
  const agent = chalk.cyan(log.agentId.substring(0, 12));
  const action = chalk.blue(log.action);
  const tool = log.tool ? chalk.magenta(log.tool) : '';
  const result = log.result === 'success' ? chalk.green('✅') : 
                log.result === 'failure' ? chalk.red('❌') : chalk.yellow('⏳');
  const duration = chalk.gray(`${log.durationMs}ms`);
  const cost = log.costUsd ? chalk.yellow(`$${log.costUsd.toFixed(3)}`) : '';

  return `${timestamp} ${agent} ${action} ${tool} ${result} ${duration} ${cost}`;
}

// ═══════════════════════════════════════════════════════════════
// MAIN EXECUTION
// ═══════════════════════════════════════════════════════════════

if (require.main === module) {
  program.parse();
}

export { program };