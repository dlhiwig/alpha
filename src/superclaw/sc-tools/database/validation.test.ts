/**
 * Simple validation tests for Database CodeAgent Tool
 */

import { describe, test, expect } from 'vitest'
import { createDatabaseCodeAgent, dbExecuteTool, type DatabaseConfig } from './code-agent-db'

describe('Database CodeAgent Validation', () => {
  test('should export correct tool definition structure', () => {
    expect(dbExecuteTool).toBeDefined()
    expect(dbExecuteTool.name).toBe('db_execute')
    expect(dbExecuteTool.description).toContain('Execute Python code with database access')
    expect(dbExecuteTool.parameters).toBeDefined()
    expect(dbExecuteTool.parameters.type).toBe('object')
    expect(dbExecuteTool.parameters.properties.code).toBeDefined()
    expect(dbExecuteTool.parameters.required).toEqual(['code'])
    expect(dbExecuteTool.metadata).toBeDefined()
    expect(dbExecuteTool.metadata.category).toBe('database')
    expect(dbExecuteTool.metadata.riskLevel).toBe('medium')
  })

  test('should create database code agent instances', () => {
    const config: DatabaseConfig = {
      type: 'sqlite',
      connectionString: ':memory:'
    }

    const agent = createDatabaseCodeAgent(config)
    expect(agent).toBeDefined()
    
    const status = agent.getStatus()
    expect(status.initialized).toBe(false)
    expect(status.config.type).toBe('sqlite')
    expect(status.config.poolSize).toBe(5) // default
    expect(status.config.timeout).toBe(30) // default
  })

  test('should support different database configurations', () => {
    const configs: DatabaseConfig[] = [
      { type: 'sqlite', connectionString: ':memory:' },
      { type: 'postgresql', host: 'localhost', port: 5432, database: 'test' },
      { type: 'mysql', connectionString: 'mysql://user:pass@localhost/db' },
      { type: 'generic', connectionString: 'sqlite:///:memory:' }
    ]

    for (const config of configs) {
      const agent = createDatabaseCodeAgent(config)
      expect(agent).toBeInstanceOf(Object)
      
      const status = agent.getStatus()
      expect(status.config.type).toBe(config.type)
    }
  })

  test('should merge configuration with defaults correctly', () => {
    const config: DatabaseConfig = {
      type: 'postgresql',
      host: 'localhost',
      poolSize: 10,
      logQueries: true
    }

    const agent = createDatabaseCodeAgent(config)
    const status = agent.getStatus()

    expect(status.config.type).toBe('postgresql')
    expect(status.config.host).toBe('localhost')
    expect(status.config.poolSize).toBe(10) // provided
    expect(status.config.timeout).toBe(30) // default
    expect(status.config.logQueries).toBe(true) // provided
    expect(status.config.sslMode).toBe('prefer') // default
  })

  test('should have correct token usage tracking structure', () => {
    const agent = createDatabaseCodeAgent({ type: 'sqlite', connectionString: ':memory:' })
    const status = agent.getStatus()

    expect(status.tokenUsage).toBeDefined()
    expect(status.tokenUsage.inputTokens).toBe(0)
    expect(status.tokenUsage.outputTokens).toBe(0)
    expect(status.tokenUsage.queries).toBe(0)
  })

  test('should include all required Python functions in generated script', () => {
    const agent = createDatabaseCodeAgent({ type: 'sqlite', connectionString: ':memory:' })
    const pythonScript = (agent as any).generatePythonScript()

    // Check for core database functions
    expect(pythonScript).toContain('def query(')
    expect(pythonScript).toContain('def execute(')
    expect(pythonScript).toContain('def execute_many(')
    expect(pythonScript).toContain('def get_schema(')

    // Check for helper functions
    expect(pythonScript).toContain('def insert(')
    expect(pythonScript).toContain('def update(')
    expect(pythonScript).toContain('def delete(')

    // Check for connection management
    expect(pythonScript).toContain('def setup_database(')
    expect(pythonScript).toContain('def get_connection(')

    // Check for database-specific imports
    expect(pythonScript).toContain('import sqlite3')
    expect(pythonScript).toContain('import psycopg2')
    expect(pythonScript).toContain('import sqlalchemy')
  })

  test('should handle different database types in Python script generation', () => {
    const configs = [
      { type: 'sqlite' as const, connectionString: ':memory:' },
      { type: 'postgresql' as const, host: 'localhost', database: 'test' },
      { type: 'mysql' as const, connectionString: 'mysql://user@localhost/db' }
    ]

    for (const config of configs) {
      const agent = createDatabaseCodeAgent(config)
      const pythonScript = (agent as any).generatePythonScript()

      // Should contain the correct database type
      expect(pythonScript).toContain(`"type": "${config.type}"`)
      
      if (config.connectionString) {
        expect(pythonScript).toContain(`"connectionString": "${config.connectionString}"`)
      }
      
      if ('host' in config && config.host) {
        expect(pythonScript).toContain(`"host": "${config.host}"`)
      }
    }
  })
})