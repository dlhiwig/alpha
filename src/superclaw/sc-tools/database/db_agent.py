#!/usr/bin/env python3
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
    "type": "sqlite",
    "connectionString": "/home/toba/superclaw/src/tools/database/test-data/test.db",
    "host": "",
    "port": 5432,
    "database": "",
    "username": "",
    "password": "",
    "poolSize": 5,
    "timeout": 30,
    "logQueries": false
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
        
        code = '\n'.join(code_lines)
        
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
