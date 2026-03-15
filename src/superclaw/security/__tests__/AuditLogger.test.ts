// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AuditLogger } from '../AuditLogger'
import * as fs from 'fs/promises'
import * as path from 'path'
import type { SecurityAuditEvent } from '../types'

describe('AuditLogger', () => {
  let logger: AuditLogger
  const testLogPath = '/tmp/test-audit/security.log'

  beforeEach(async () => {
    logger = new AuditLogger({
      logPath: testLogPath,
      maxBufferSize: 5,
      flushIntervalMs: 100
    })
    await logger.initialize()
  })

  afterEach(async () => {
    await logger.shutdown()
    try {
      await fs.rm('/tmp/test-audit', { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('initialization', () => {
    it('should create log directory if it does not exist', async () => {
      const customPath = '/tmp/test-audit-2/security.log'
      const customLogger = new AuditLogger({ logPath: customPath })
      await customLogger.initialize()
      
      const dirExists = await fs.access(path.dirname(customPath)).then(() => true, () => false)
      expect(dirExists).toBe(true)
      
      await customLogger.shutdown()
      await fs.rm('/tmp/test-audit-2', { recursive: true, force: true }).catch(() => {})
    })

    it('should use default config when none provided', () => {
      const defaultLogger = new AuditLogger()
      expect(defaultLogger).toBeDefined()
    })
  })

  describe('log', () => {
    it('should buffer events', async () => {
      await logger.log({
        sandboxId: 'test-sandbox',
        eventType: 'sandbox_created',
        details: { agentId: 'test' },
        severity: 'low'
      })
      
      // Should be buffered, not yet written
      const fileExists = await fs.access(testLogPath).then(() => true, () => false)
      expect(fileExists).toBe(false)
    })

    it('should add timestamp to events', async () => {
      const beforeTime = new Date()
      
      const eventPromise = new Promise<SecurityAuditEvent>((resolve) => {
        logger.once('event', resolve)
      })
      
      await logger.log({
        sandboxId: 'test-sandbox',
        eventType: 'sandbox_created',
        details: { agentId: 'test' },
        severity: 'low'
      })
      
      const emittedEvent = await eventPromise
      const afterTime = new Date()
      
      expect(emittedEvent.timestamp).toBeInstanceOf(Date)
      expect(emittedEvent.timestamp.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime())
      expect(emittedEvent.timestamp.getTime()).toBeLessThanOrEqual(afterTime.getTime())
    })

    it('should flush on buffer full', async () => {
      for (let i = 0; i < 6; i++) {
        await logger.log({
          sandboxId: `sandbox-${i}`,
          eventType: 'command_executed',
          details: { command: `echo ${i}` },
          severity: 'low'
        })
      }
      
      // Should have flushed
      const content = await fs.readFile(testLogPath, 'utf-8')
      expect(content).toContain('sandbox-0')
      expect(content).toContain('sandbox-4') // First 5 events should be flushed
    })

    it('should flush immediately for critical events', async () => {
      await logger.log({
        sandboxId: 'test-sandbox',
        eventType: 'command_blocked',
        details: { command: 'rm -rf /' },
        severity: 'critical'
      })
      
      const content = await fs.readFile(testLogPath, 'utf-8')
      expect(content).toContain('command_blocked')
      expect(content).toContain('rm -rf /')
    })

    it('should emit events through EventEmitter', async () => {
      let emittedEvent: SecurityAuditEvent | null = null
      logger.once('event', (event) => {
        emittedEvent = event
      })

      await logger.log({
        sandboxId: 'test-sandbox',
        eventType: 'file_access',
        details: { path: '/tmp/test' },
        severity: 'low'
      })

      expect(emittedEvent).toBeDefined()
      // @ts-expect-error - Post-Merge Reconciliation
      expect(emittedEvent?.sandboxId).toBe('test-sandbox')
      // @ts-expect-error - Post-Merge Reconciliation
      expect(emittedEvent?.eventType).toBe('file_access')
    })
  })

  describe('convenience methods', () => {
    it('logSandboxCreated should work', async () => {
      await logger.logSandboxCreated('sb-1', 'agent-1', { memory: 2048 })
      await logger.flush()
      
      const events = await logger.query({ eventType: 'sandbox_created' })
      expect(events.length).toBe(1)
      expect(events[0].sandboxId).toBe('sb-1')
      expect(events[0].details.agentId).toBe('agent-1')
      expect(events[0].details.config.memory).toBe(2048)
      expect(events[0].severity).toBe('low')
    })

    it('logCommandExecuted should work', async () => {
      await logger.logCommandExecuted('sb-1', 'ls -la', { exitCode: 0 })
      await logger.flush()
      
      const events = await logger.query({ eventType: 'command_executed' })
      expect(events.length).toBe(1)
      expect(events[0].details.command).toBe('ls -la')
      expect(events[0].details.exitCode).toBe(0)
      expect(events[0].severity).toBe('low')
    })

    it('logCommandBlocked should be high severity', async () => {
      await logger.logCommandBlocked('sb-1', 'sudo rm', 'denied command')
      await logger.flush()
      
      const events = await logger.query({ severity: 'high' })
      expect(events.length).toBe(1)
      expect(events[0].eventType).toBe('command_blocked')
      expect(events[0].details.command).toBe('sudo rm')
      expect(events[0].details.reason).toBe('denied command')
    })

    it('logNetworkBlocked should be high severity', async () => {
      await logger.logNetworkBlocked('sb-1', 'malicious.com', 'blocked domain')
      await logger.flush()
      
      const events = await logger.query({ severity: 'high' })
      expect(events.length).toBe(1)
      expect(events[0].eventType).toBe('network_blocked')
      expect(events[0].details.domain).toBe('malicious.com')
    })

    it('logResourceLimitHit should be medium severity', async () => {
      await logger.logResourceLimitHit('sb-1', 'memory', 2048, 2560)
      await logger.flush()
      
      const events = await logger.query({ severity: 'medium' })
      expect(events.length).toBe(1)
      expect(events[0].eventType).toBe('resource_limit_hit')
      expect(events[0].details.resource).toBe('memory')
      expect(events[0].details.limit).toBe(2048)
      expect(events[0].details.actual).toBe(2560)
    })
  })

  describe('flush', () => {
    it('should write buffered events to file', async () => {
      await logger.log({
        sandboxId: 'sb-1',
        eventType: 'sandbox_created',
        details: { agentId: 'test' },
        severity: 'low'
      })
      
      await logger.flush()
      
      const content = await fs.readFile(testLogPath, 'utf-8')
      const events = content.split('\n').filter(line => line.trim())
      expect(events.length).toBe(1)
      
      const parsedEvent = JSON.parse(events[0])
      expect(parsedEvent.sandboxId).toBe('sb-1')
    })

    it('should clear buffer after flush', async () => {
      await logger.log({
        sandboxId: 'sb-1',
        eventType: 'sandbox_created',
        details: { agentId: 'test' },
        severity: 'low'
      })
      
      await logger.flush()
      await logger.flush() // Second flush should not write anything
      
      const content = await fs.readFile(testLogPath, 'utf-8')
      const events = content.split('\n').filter(line => line.trim())
      expect(events.length).toBe(1) // Still only one event
    })

    it('should handle empty buffer gracefully', async () => {
      await logger.flush() // Flush empty buffer
      
      const fileExists = await fs.access(testLogPath).then(() => true, () => false)
      expect(fileExists).toBe(false) // No file should be created for empty flush
    })
  })

  describe('query', () => {
    beforeEach(async () => {
      // Set up test data
      await logger.log({ sandboxId: 'sb-1', eventType: 'command_executed', details: { command: 'ls' }, severity: 'low' })
      await logger.log({ sandboxId: 'sb-2', eventType: 'command_executed', details: { command: 'ps' }, severity: 'low' })
      await logger.log({ sandboxId: 'sb-1', eventType: 'sandbox_created', details: { agentId: 'test' }, severity: 'low' })
      await logger.log({ sandboxId: 'sb-1', eventType: 'command_blocked', details: { command: 'sudo' }, severity: 'high' })
      await logger.flush()
    })

    it('should filter by sandboxId', async () => {
      const events = await logger.query({ sandboxId: 'sb-1' })
      expect(events.length).toBe(3)
      events.forEach(event => {
        expect(event.sandboxId).toBe('sb-1')
      })
    })

    it('should filter by eventType', async () => {
      const events = await logger.query({ eventType: 'command_executed' })
      expect(events.length).toBe(2)
      events.forEach(event => {
        expect(event.eventType).toBe('command_executed')
      })
    })

    it('should filter by severity', async () => {
      const events = await logger.query({ severity: 'high' })
      expect(events.length).toBe(1)
      expect(events[0].eventType).toBe('command_blocked')
    })

    it('should filter by date range', async () => {
      const now = new Date()
      const hourAgo = new Date(now.getTime() - 60 * 60 * 1000)
      const hourFromNow = new Date(now.getTime() + 60 * 60 * 1000)
      
      // All events should be within the last hour
      const eventsInRange = await logger.query({ since: hourAgo, until: hourFromNow })
      expect(eventsInRange.length).toBe(4)
      
      // No events should be from tomorrow
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
      const eventsFromTomorrow = await logger.query({ since: tomorrow })
      expect(eventsFromTomorrow.length).toBe(0)
    })

    it('should combine multiple filters', async () => {
      const events = await logger.query({ 
        sandboxId: 'sb-1', 
        severity: 'low' 
      })
      expect(events.length).toBe(2) // sandbox_created and command_executed for sb-1
      events.forEach(event => {
        expect(event.sandboxId).toBe('sb-1')
        expect(event.severity).toBe('low')
      })
    })

    it('should return empty array for non-existent log file', async () => {
      const tempLogger = new AuditLogger({ logPath: '/tmp/non-existent/log.txt' })
      await tempLogger.initialize()
      
      const events = await tempLogger.query({})
      expect(events).toEqual([])
      
      await tempLogger.shutdown()
    })

    it('should handle malformed log entries gracefully', async () => {
      // Write malformed JSON to log file
      await fs.appendFile(testLogPath, 'invalid json line\n')
      
      // Should not crash, but might return fewer events
      const events = await logger.query({})
      expect(Array.isArray(events)).toBe(true)
    })
  })

  describe('getStats', () => {
    beforeEach(async () => {
      // Set up test data with known stats
      await logger.logSandboxCreated('sb-1', 'agent-1', {})
      await logger.logSandboxCreated('sb-2', 'agent-1', {})
      await logger.logCommandExecuted('sb-1', 'echo test', { exitCode: 0 })
      await logger.logCommandBlocked('sb-1', 'sudo', 'denied')
      await logger.logNetworkBlocked('sb-1', 'evil.com', 'blacklisted')
      await logger.flush()
    })

    it('should return accurate statistics', async () => {
      const stats = await logger.getStats()
      
      expect(stats.totalEvents).toBe(5)
      expect(stats.byType['sandbox_created']).toBe(2)
      expect(stats.byType['command_executed']).toBe(1)
      expect(stats.byType['command_blocked']).toBe(1)
      expect(stats.byType['network_blocked']).toBe(1)
      expect(stats.bySeverity['low']).toBe(3) // 2 sandbox_created + 1 command_executed
      expect(stats.bySeverity['high']).toBe(2) // 1 command_blocked + 1 network_blocked
    })

    it('should count events in last 24 hours', async () => {
      const stats = await logger.getStats()
      expect(stats.last24h).toBe(5) // All events are recent
    })

    it('should handle empty log file', async () => {
      const emptyLogger = new AuditLogger({ logPath: '/tmp/test-audit-empty/security.log' })
      await emptyLogger.initialize()
      
      const stats = await emptyLogger.getStats()
      
      expect(stats.totalEvents).toBe(0)
      expect(stats.byType).toEqual({})
      expect(stats.bySeverity).toEqual({})
      expect(stats.last24h).toBe(0)
      
      await emptyLogger.shutdown()
      await fs.rm('/tmp/test-audit-empty', { recursive: true, force: true }).catch(() => {})
    })
  })

  describe('periodic flush', () => {
    it('should flush automatically after interval', async () => {
      const quickFlushLogger = new AuditLogger({
        logPath: testLogPath,
        flushIntervalMs: 50 // Very short interval for testing
      })
      await quickFlushLogger.initialize()
      
      await quickFlushLogger.log({
        sandboxId: 'test-sandbox',
        eventType: 'sandbox_created',
        details: { agentId: 'test' },
        severity: 'low'
      })
      
      // Wait for periodic flush
      await new Promise(resolve => setTimeout(resolve, 100))
      
      const content = await fs.readFile(testLogPath, 'utf-8')
      expect(content).toContain('sandbox_created')
      
      await quickFlushLogger.shutdown()
    })
  })

  describe('shutdown', () => {
    it('should flush remaining events on shutdown', async () => {
      await logger.log({
        sandboxId: 'test-sandbox',
        eventType: 'sandbox_created',
        details: { agentId: 'test' },
        severity: 'low'
      })
      
      await logger.shutdown()
      
      const content = await fs.readFile(testLogPath, 'utf-8')
      expect(content).toContain('sandbox_created')
    })

    it('should clear flush interval on shutdown', async () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval')
      await logger.shutdown()
      expect(clearIntervalSpy).toHaveBeenCalled()
      clearIntervalSpy.mockRestore()
    })
  })

  describe('error handling', () => {
    it('should handle file write errors gracefully', async () => {
      // Create a logger with a path that will cause write errors
      const badLogger = new AuditLogger({ logPath: '/root/security.log' }) // No permission
      await badLogger.initialize().catch(() => {}) // May fail to create directory
      
      // This should not throw
      await expect(badLogger.log({
        sandboxId: 'test',
        eventType: 'sandbox_created',
        details: {},
        severity: 'low'
      })).resolves.not.toThrow()
      
      await badLogger.shutdown()
    })
  })
})