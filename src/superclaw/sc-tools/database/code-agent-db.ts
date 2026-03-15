/**
 * Database CodeAgent Tool for SuperClaw
 * 
 * Implements the "CodeAgent pattern" for database operations - a single execute_db_code
 * tool that runs Python code in a persistent namespace with database access functions.
 * 
 * Benefits:
 * - Massive token reduction for data-heavy operations
 * - Single tool vs multiple (query/insert/update/delete/schema)
 * - Returns only query results, not schema dumps
 * - Persistent Python namespace for multi-step operations
 * 
 * Supported databases:
 * - PostgreSQL (via psycopg2)
 * - SQLite (built-in)
 * - Generic SQL (via sqlalchemy)
 */

import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { logger } from '../../utils/logger'

export interface DatabaseConfig {
  /** Database type: 'postgresql', 'sqlite', 'mysql', 'generic' */
  type: 'postgresql' | 'sqlite' | 'mysql' | 'generic'
  /** Connection string or database file path */
  connectionString?: string
  /** Host (for network databases) */
  host?: string
  /** Port (for network databases) */
  port?: number
  /** Database name */
  database?: string
  /** Username */
  username?: string
  /** Password */
  password?: string
  /** Connection pool size (default: 5) */
  poolSize?: number
  /** Query timeout in seconds (default: 30) */
  timeout?: number
  /** Enable query logging (default: false) */
  logQueries?: boolean
  /** SSL mode for PostgreSQL */
  sslMode?: 'disable' | 'allow' | 'prefer' | 'require'
}

export interface ExecuteDbCodeResult {
  success: boolean
  output?: string
  error?: string
  executionTime?: number
  queryCount?: number
  rowsAffected?: number
  connectionInfo?: {
    type: string
    database: string
    connected: boolean
  }
}

/**
 * Database CodeAgent - Executes Python code with database access
 * 
 * Provides a persistent Python environment with pre-loaded database libraries
 * and helper functions for secure database operations.
 */
export class DatabaseCodeAgent extends EventEmitter {
  private process: ChildProcess | null = null
  private isInitialized = false
  private config: DatabaseConfig
  private executionCount = 0
  private tokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    queries: 0
  }

  constructor(config: DatabaseConfig) {
    super()
    this.config = {
      poolSize: 5,
      timeout: 30,
      logQueries: false,
      sslMode: 'prefer',
      ...config
    }
  }

  /**
   * Initialize the Python environment with database access
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return
    }

    logger.info('Initializing Database CodeAgent...')

    // Create Python script with database setup
    const pythonScript = this.generatePythonScript()
    const scriptPath = join(__dirname, 'db_agent.py')
    writeFileSync(scriptPath, pythonScript)

    // Start Python process
    this.process = spawn('python3', [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    })

    if (!this.process.stdout || !this.process.stderr || !this.process.stdin) {
      throw new Error('Failed to start Database CodeAgent process')
    }

    // Set up event handlers
    this.process.on('error', (error) => {
      logger.error({ error }, 'Database CodeAgent process error')
      this.emit('error', error)
    })

    this.process.on('exit', (code) => {
      logger.info({ code }, 'Database CodeAgent process exited')
      this.isInitialized = false
      this.process = null
      this.emit('exit', code)
    })

    // Wait for initialization
    await this.waitForInitialization()
    this.isInitialized = true
    logger.info('Database CodeAgent initialized successfully')
  }

  /**
   * Execute Python code with database access
   */
  async executeCode(code: string): Promise<ExecuteDbCodeResult> {
    if (!this.isInitialized) {
      await this.initialize()
    }

    if (!this.process || !this.process.stdin) {
      throw new Error('Database CodeAgent not initialized')
    }

    const startTime = Date.now()
    this.executionCount++

    logger.info({ executionCount: this.executionCount }, 'Executing database code')

    return new Promise((resolve, reject) => {
      if (!this.process || !this.process.stdin || !this.process.stdout) {
        reject(new Error('Process not available'))
        return
      }

      let output = ''
      let error = ''
      let queryCount = 0
      let rowsAffected = 0

      const timeout = setTimeout(() => {
        this.process?.kill()
        reject(new Error('Code execution timeout'))
      }, this.config.timeout! * 1000)

      const onData = (data: Buffer) => {
        const text = data.toString()
        
        // Parse output for metadata
        if (text.includes('QUERY_COUNT:')) {
          queryCount = parseInt(text.match(/QUERY_COUNT:(\d+)/)?.[1] || '0')
        }
        if (text.includes('ROWS_AFFECTED:')) {
          rowsAffected = parseInt(text.match(/ROWS_AFFECTED:(\d+)/)?.[1] || '0')
        }
        
        // Filter out metadata from actual output
        const cleanText = text
          .replace(/QUERY_COUNT:\d+\n?/g, '')
          .replace(/ROWS_AFFECTED:\d+\n?/g, '')
          .replace(/EXECUTION_END\n?/g, '')

        if (text.includes('EXECUTION_END')) {
          clearTimeout(timeout)
          this.process?.stdout?.off('data', onData)
          this.process?.stderr?.off('data', onError)

          const executionTime = Date.now() - startTime
          this.tokenUsage.queries += queryCount

          resolve({
            success: true,
            output: output.trim(),
            error: error.trim() || undefined,
            executionTime,
            queryCount,
            rowsAffected,
            connectionInfo: {
              type: this.config.type,
              database: this.config.database || 'unknown',
              connected: true
            }
          })
        } else {
          output += cleanText
        }
      }

      const onError = (data: Buffer) => {
        error += data.toString()
      }

      this.process.stdout.on('data', onData)
      // @ts-expect-error - Post-Merge Reconciliation
      this.process.stderr.on('data', onError)

      // Send code to execute
      const wrappedCode = `
# Execution ${this.executionCount}
try:
    query_count = 0
    rows_affected = 0
    
${code.split('\n').map(line => '    ' + line).join('\n')}
    
    print(f"QUERY_COUNT:{query_count}")
    print(f"ROWS_AFFECTED:{rows_affected}")
    print("EXECUTION_END")
except Exception as e:
    print(f"ERROR: {str(e)}")
    print("EXECUTION_END")
`

      this.process.stdin.write(wrappedCode + '\n')
    })
  }

  /**
   * Get connection status and statistics
   */
  getStatus(): {
    initialized: boolean
    executionCount: number
    // @ts-expect-error - Post-Merge Reconciliation
    tokenUsage: typeof this.tokenUsage
    config: DatabaseConfig
  } {
    return {
      initialized: this.isInitialized,
      executionCount: this.executionCount,
      tokenUsage: { ...this.tokenUsage },
      config: { ...this.config }
    }
  }

  /**
   * Close the database agent
   */
  async close(): Promise<void> {
    if (this.process) {
      this.process.kill()
      this.process = null
    }
    this.isInitialized = false
    logger.info('Database CodeAgent closed')
  }

  /**
   * Generate the Python script for database operations
   */
  private generatePythonScript(): string {
    return `#!/usr/bin/env python3
"""
Database CodeAgent - Persistent Python environment with database access
"""

import sys
import json
import traceback
import time
import threading
from contextlib import contextmanager
from typing import Any, Dict, List, Optional, Union

# Database imports
try:
    import sqlite3
    HAS_SQLITE = True
except ImportError:
    HAS_SQLITE = False

try:
    import psycopg2
    import psycopg2.pool
    from psycopg2.extras import RealDictCursor
    HAS_POSTGRESQL = True
except ImportError:
    HAS_POSTGRESQL = False

try:
    import sqlalchemy
    from sqlalchemy import create_engine, text
    from sqlalchemy.pool import StaticPool
    HAS_SQLALCHEMY = True
except ImportError:
    HAS_SQLALCHEMY = False

# Global connection pools and state
connections = {}
pools = {}
query_count = 0
rows_affected = 0

# Configuration from environment
DB_CONFIG = {
    "type": "${this.config.type}",
    "connectionString": "${this.config.connectionString || ''}",
    "host": "${this.config.host || ''}",
    "port": ${this.config.port || 5432},
    "database": "${this.config.database || ''}",
    "username": "${this.config.username || ''}",
    "password": "${this.config.password || ''}",
    "poolSize": ${this.config.poolSize},
    "timeout": ${this.config.timeout},
    "logQueries": ${this.config.logQueries}
}

def setup_database():
    """Initialize database connections based on configuration."""
    global connections, pools
    
    db_type = DB_CONFIG["type"]
    
    if db_type == "sqlite":
        if not HAS_SQLITE:
            raise Exception("SQLite not available")
        
        db_path = DB_CONFIG.get("connectionString", ":memory:")
        connections["sqlite"] = sqlite3.connect(db_path, check_same_thread=False)
        connections["sqlite"].row_factory = sqlite3.Row
        print(f"Connected to SQLite: {db_path}")
    
    elif db_type == "postgresql":
        if not HAS_POSTGRESQL:
            raise Exception("PostgreSQL libraries not available. Install: pip install psycopg2-binary")
        
        conn_string = DB_CONFIG.get("connectionString")
        if not conn_string:
            conn_string = f"host={DB_CONFIG['host']} port={DB_CONFIG['port']} dbname={DB_CONFIG['database']} user={DB_CONFIG['username']} password={DB_CONFIG['password']}"
        
        pools["postgresql"] = psycopg2.pool.ThreadedConnectionPool(
            1, DB_CONFIG["poolSize"], conn_string
        )
        print(f"Connected to PostgreSQL pool: {DB_CONFIG['database']}")
    
    elif db_type in ["mysql", "generic"]:
        if not HAS_SQLALCHEMY:
            raise Exception("SQLAlchemy not available. Install: pip install sqlalchemy")
        
        conn_string = DB_CONFIG.get("connectionString", "sqlite:///:memory:")
        engine = create_engine(conn_string, poolclass=StaticPool)
        connections["generic"] = engine
        print(f"Connected via SQLAlchemy: {conn_string}")

@contextmanager
def get_connection():
    """Get a database connection from the pool."""
    global connections, pools
    
    db_type = DB_CONFIG["type"]
    
    if db_type == "sqlite":
        yield connections["sqlite"]
    
    elif db_type == "postgresql":
        conn = pools["postgresql"].getconn()
        try:
            yield conn
        finally:
            pools["postgresql"].putconn(conn)
    
    elif db_type in ["mysql", "generic"]:
        with connections["generic"].connect() as conn:
            yield conn

def query(sql: str, params=None) -> List[Dict[str, Any]]:
    """Execute a SELECT query and return results as list of dictionaries."""
    global query_count
    query_count += 1
    
    if DB_CONFIG["logQueries"]:
        print(f"QUERY: {sql}")
        if params:
            print(f"PARAMS: {params}")
    
    with get_connection() as conn:
        if DB_CONFIG["type"] == "sqlite":
            if params:
                cursor = conn.execute(sql, params)
            else:
                cursor = conn.execute(sql)
            columns = [description[0] for description in cursor.description] if cursor.description else []
            rows = cursor.fetchall()
            return [dict(zip(columns, row)) for row in rows]
        
        elif DB_CONFIG["type"] == "postgresql":
            with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute(sql, params)
                return [dict(row) for row in cursor.fetchall()]
        
        elif DB_CONFIG["type"] in ["mysql", "generic"]:
            result = conn.execute(text(sql), params or {})
            return [dict(row._mapping) for row in result.fetchall()]

def execute(sql: str, params=None) -> int:
    """Execute an INSERT/UPDATE/DELETE query and return affected row count."""
    global query_count, rows_affected
    query_count += 1
    
    if DB_CONFIG["logQueries"]:
        print(f"EXECUTE: {sql}")
        if params:
            print(f"PARAMS: {params}")
    
    with get_connection() as conn:
        if DB_CONFIG["type"] == "sqlite":
            if params:
                cursor = conn.execute(sql, params)
            else:
                cursor = conn.execute(sql)
            conn.commit()
            affected = cursor.rowcount
            rows_affected += affected
            return affected
        
        elif DB_CONFIG["type"] == "postgresql":
            with conn.cursor() as cursor:
                cursor.execute(sql, params)
                conn.commit()
                affected = cursor.rowcount
                rows_affected += affected
                return affected
        
        elif DB_CONFIG["type"] in ["mysql", "generic"]:
            result = conn.execute(text(sql), params or {})
            conn.commit()
            affected = result.rowcount
            rows_affected += affected
            return affected

def execute_many(sql: str, param_list: List[Dict[str, Any]]) -> int:
    """Execute a query multiple times with different parameters."""
    global query_count, rows_affected
    query_count += len(param_list)
    
    if DB_CONFIG["logQueries"]:
        print(f"EXECUTE_MANY: {sql} (batch size: {len(param_list)})")
    
    total_affected = 0
    
    with get_connection() as conn:
        if DB_CONFIG["type"] == "sqlite":
            cursor = conn.executemany(sql, param_list)
            conn.commit()
            total_affected = cursor.rowcount
        
        elif DB_CONFIG["type"] == "postgresql":
            with conn.cursor() as cursor:
                for params in param_list:
                    cursor.execute(sql, params)
                conn.commit()
                total_affected = len(param_list)  # Approximate
        
        elif DB_CONFIG["type"] in ["mysql", "generic"]:
            for params in param_list:
                result = conn.execute(text(sql), params)
                total_affected += result.rowcount
            conn.commit()
    
    rows_affected += total_affected
    return total_affected

def get_schema(table_name: str = None) -> Dict[str, Any]:
    """Get database schema information."""
    global query_count
    query_count += 1
    
    schema = {}
    
    if DB_CONFIG["type"] == "sqlite":
        with get_connection() as conn:
            if table_name:
                cursor = conn.execute(f"PRAGMA table_info({table_name})")
                columns = cursor.fetchall()
                schema[table_name] = [dict(row) for row in columns]
            else:
                cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
                tables = [row[0] for row in cursor.fetchall()]
                schema["tables"] = tables
    
    elif DB_CONFIG["type"] == "postgresql":
        with get_connection() as conn:
            with conn.cursor() as cursor:
                if table_name:
                    cursor.execute("""
                        SELECT column_name, data_type, is_nullable, column_default
                        FROM information_schema.columns 
                        WHERE table_name = %s
                    """, (table_name,))
                    schema[table_name] = [dict(zip([desc[0] for desc in cursor.description], row)) 
                                        for row in cursor.fetchall()]
                else:
                    cursor.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
                    schema["tables"] = [row[0] for row in cursor.fetchall()]
    
    return schema

# Helper functions for common operations
def insert(table: str, data: Dict[str, Any]) -> int:
    """Insert a single row into a table."""
    columns = list(data.keys())
    placeholders = ["?" if DB_CONFIG["type"] == "sqlite" else "%s"] * len(columns)
    
    sql = f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({', '.join(placeholders)})"
    return execute(sql, list(data.values()))

def update(table: str, data: Dict[str, Any], where_clause: str, where_params=None) -> int:
    """Update rows in a table."""
    set_clauses = []
    values = []
    
    placeholder = "?" if DB_CONFIG["type"] == "sqlite" else "%s"
    
    for column, value in data.items():
        set_clauses.append(f"{column} = {placeholder}")
        values.append(value)
    
    sql = f"UPDATE {table} SET {', '.join(set_clauses)} WHERE {where_clause}"
    
    if where_params:
        values.extend(where_params)
    
    return execute(sql, values)

def delete(table: str, where_clause: str, where_params=None) -> int:
    """Delete rows from a table."""
    sql = f"DELETE FROM {table} WHERE {where_clause}"
    return execute(sql, where_params)

# Initialize database connection
try:
    setup_database()
    print("Database CodeAgent initialized successfully")
except Exception as e:
    print(f"Failed to initialize database: {str(e)}")
    sys.exit(1)

# Interactive loop
print("Ready for code execution...")
sys.stdout.flush()

while True:
    try:
        # Read input until we get code to execute
        code_lines = []
        while True:
            line = sys.stdin.readline()
            if not line:
                break
            if line.strip() == "EXECUTE_END":
                break
            code_lines.append(line.rstrip())
        
        if not code_lines:
            continue
        
        code = '\\n'.join(code_lines)
        
        # Reset counters for this execution
        query_count = 0
        rows_affected = 0
        
        # Execute the code
        exec(code)
        
    except KeyboardInterrupt:
        break
    except Exception as e:
        print(f"ERROR: {str(e)}")
        print("EXECUTION_END")
        sys.stdout.flush()
`
  }

  /**
   * Wait for the Python process to initialize
   */
  private async waitForInitialization(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.process || !this.process.stdout) {
        reject(new Error('Process not available'))
        return
      }

      const timeout = setTimeout(() => {
        reject(new Error('Initialization timeout'))
      }, 10000)

      const onData = (data: Buffer) => {
        const text = data.toString()
        if (text.includes('Ready for code execution')) {
          clearTimeout(timeout)
          this.process?.stdout?.off('data', onData)
          resolve()
        }
      }

      this.process.stdout.on('data', onData)
    })
  }
}

/**
 * Factory function to create database code agent instances
 */
export function createDatabaseCodeAgent(config: DatabaseConfig): DatabaseCodeAgent {
  return new DatabaseCodeAgent(config)
}

/**
 * Tool definition for SuperClaw registry
 */
export const dbExecuteTool = {
  name: 'db_execute',
  description: `Execute Python code with database access. Supports PostgreSQL, SQLite, and generic SQL via SQLAlchemy.

Available functions in Python environment:
- query(sql, params=None) -> List[Dict] - Execute SELECT queries
- execute(sql, params=None) -> int - Execute INSERT/UPDATE/DELETE
- execute_many(sql, param_list) -> int - Batch operations
- insert(table, data) -> int - Insert single row
- update(table, data, where_clause, where_params) -> int - Update rows
- delete(table, where_clause, where_params) -> int - Delete rows
- get_schema(table_name=None) -> Dict - Get schema information

Example usage:

Query data:
results = query("SELECT * FROM users WHERE age > ?", [25])
for user in results:
    print(f"{user['name']}: {user['email']}")

Insert data:
user_id = insert("users", {"name": "John", "email": "john@example.com", "age": 30})

Update data:
affected = update("users", {"age": 31}, "id = ?", [user_id])

Complex operations:
total_sales = query("SELECT SUM(amount) as total FROM orders WHERE created_at > ?", ["2024-01-01"])[0]["total"]`,
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'Python code to execute with database access'
      },
      config: {
        type: 'object',
        description: 'Database configuration (optional, can be set globally)',
        properties: {
          type: {
            type: 'string',
            enum: ['postgresql', 'sqlite', 'mysql', 'generic'],
            description: 'Database type'
          },
          connectionString: {
            type: 'string',
            description: 'Full connection string (optional if individual params provided)'
          },
          host: { type: 'string' },
          port: { type: 'number' },
          database: { type: 'string' },
          username: { type: 'string' },
          password: { type: 'string' },
          poolSize: { type: 'number', default: 5 },
          timeout: { type: 'number', default: 30 },
          logQueries: { type: 'boolean', default: false }
        }
      }
    },
    required: ['code']
  },
  handler: async (params: { code: string; config?: DatabaseConfig }) => {
    // This would be implemented when registering the tool
    throw new Error('Handler not implemented - register with SuperClaw tool registry')
  },
  metadata: {
    category: 'database',
    riskLevel: 'medium' as const,
    requiresAuth: true,
    version: '1.0.0'
  }
}