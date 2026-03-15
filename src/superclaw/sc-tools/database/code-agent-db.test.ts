/**
 * Tests for Database CodeAgent Tool
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { DatabaseCodeAgent, createDatabaseCodeAgent, type DatabaseConfig } from './code-agent-db'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'

describe('DatabaseCodeAgent', () => {
  let agent: DatabaseCodeAgent
  let testDbPath: string

  beforeAll(() => {
    // Create test directory
    const testDir = join(__dirname, 'test-data')
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true })
    }
    testDbPath = join(testDir, 'test.db')
  })

  afterAll(() => {
    // Clean up test files
    const testDir = join(__dirname, 'test-data')
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
  })

  beforeEach(async () => {
    // Create fresh SQLite agent for each test
    const config: DatabaseConfig = {
      type: 'sqlite',
      connectionString: testDbPath
    }
    agent = createDatabaseCodeAgent(config)
  })

  afterEach(async () => {
    if (agent) {
      await agent.close()
    }
  })

  describe('Initialization', () => {
    test('should initialize successfully with SQLite', async () => {
      await agent.initialize()
      const status = agent.getStatus()
      
      expect(status.initialized).toBe(true)
      expect(status.config.type).toBe('sqlite')
    })

    test('should handle initialization errors gracefully', async () => {
      const badConfig: DatabaseConfig = {
        type: 'postgresql',
        connectionString: 'invalid://connection'
      }
      const badAgent = createDatabaseCodeAgent(badConfig)
      
      await expect(badAgent.initialize()).rejects.toThrow()
      await badAgent.close()
    })
  })

  describe('Basic Database Operations', () => {
    test('should create table and insert data', async () => {
      const result = await agent.executeCode(`
# Create a test table
execute("""
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    age INTEGER
)
""")

# Insert test data
affected = insert("users", {
    "name": "John Doe",
    "email": "john@example.com", 
    "age": 30
})

print(f"Inserted {affected} user(s)")
`)

      expect(result.success).toBe(true)
      expect(result.output).toContain('Inserted 1 user(s)')
      expect(result.queryCount).toBeGreaterThan(0)
      expect(result.rowsAffected).toBe(1)
    })

    test('should query data successfully', async () => {
      // First setup data
      await agent.executeCode(`
execute("""
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    age INTEGER
)
""")

insert("users", {"name": "Alice", "email": "alice@example.com", "age": 25})
insert("users", {"name": "Bob", "email": "bob@example.com", "age": 35})
`)

      // Then query it
      const result = await agent.executeCode(`
users = query("SELECT * FROM users ORDER BY name")
for user in users:
    print(f"{user['name']}: {user['age']} years old")

print(f"Found {len(users)} users")
`)

      expect(result.success).toBe(true)
      expect(result.output).toContain('Alice: 25 years old')
      expect(result.output).toContain('Bob: 35 years old')
      expect(result.output).toContain('Found 2 users')
    })

    test('should update data correctly', async () => {
      // Setup data
      await agent.executeCode(`
execute("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, age INTEGER)")
user_id = execute("INSERT INTO users (name, age) VALUES (?, ?)", ["Charlie", 28])
`)

      // Update data
      const result = await agent.executeCode(`
affected = update("users", {"age": 29}, "name = ?", ["Charlie"])
print(f"Updated {affected} user(s)")

# Verify update
user = query("SELECT * FROM users WHERE name = ?", ["Charlie"])[0]
print(f"Charlie is now {user['age']} years old")
`)

      expect(result.success).toBe(true)
      expect(result.output).toContain('Updated 1 user(s)')
      expect(result.output).toContain('Charlie is now 29 years old')
    })

    test('should delete data correctly', async () => {
      // Setup data
      await agent.executeCode(`
execute("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, age INTEGER)")
execute("INSERT INTO users (name, age) VALUES (?, ?)", ["Dave", 40])
execute("INSERT INTO users (name, age) VALUES (?, ?)", ["Eve", 35])
`)

      // Delete data
      const result = await agent.executeCode(`
affected = delete("users", "age > ?", [37])
print(f"Deleted {affected} user(s)")

remaining = query("SELECT COUNT(*) as count FROM users")[0]["count"]
print(f"Remaining users: {remaining}")
`)

      expect(result.success).toBe(true)
      expect(result.output).toContain('Deleted 1 user(s)')
      expect(result.output).toContain('Remaining users: 1')
    })
  })

  describe('Batch Operations', () => {
    test('should handle batch inserts with execute_many', async () => {
      const result = await agent.executeCode(`
execute("CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, price REAL)")

# Batch insert
products = [
    {"name": "Product A", "price": 19.99},
    {"name": "Product B", "price": 29.99},
    {"name": "Product C", "price": 39.99}
]

sql = "INSERT INTO products (name, price) VALUES (?, ?)"
param_list = [(p["name"], p["price"]) for p in products]
affected = execute_many(sql, param_list)

print(f"Inserted {affected} products")

# Verify
count = query("SELECT COUNT(*) as count FROM products")[0]["count"]
print(f"Total products: {count}")
`)

      expect(result.success).toBe(true)
      expect(result.output).toContain('Inserted 3 products')
      expect(result.output).toContain('Total products: 3')
    })
  })

  describe('Schema Operations', () => {
    test('should retrieve table schema information', async () => {
      // Setup table
      await agent.executeCode(`
execute("""
CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    department TEXT,
    salary REAL,
    hire_date TEXT
)
""")
`)

      // Get schema
      const result = await agent.executeCode(`
schema = get_schema("employees")
print(f"Schema for employees table:")
for column in schema.get("employees", []):
    print(f"  {column}")

# Also test getting all tables
tables = get_schema()
print(f"Available tables: {tables.get('tables', [])}")
`)

      expect(result.success).toBe(true)
      expect(result.output).toContain('Schema for employees table')
      expect(result.output).toContain('Available tables')
    })
  })

  describe('Error Handling', () => {
    test('should handle SQL syntax errors gracefully', async () => {
      const result = await agent.executeCode(`
# This should fail due to syntax error
try:
    query("SELECT * FORM users")  # typo: FORM instead of FROM
except Exception as e:
    print(f"Caught error: {str(e)}")
    print("Continuing execution...")

print("After error handling")
`)

      expect(result.success).toBe(true)
      expect(result.output).toContain('Caught error')
      expect(result.output).toContain('After error handling')
    })

    test('should handle Python runtime errors', async () => {
      const result = await agent.executeCode(`
try:
    # This will cause a division by zero error
    result = 10 / 0
except ZeroDivisionError as e:
    print(f"Math error: {str(e)}")

print("Error handled successfully")
`)

      expect(result.success).toBe(true)
      expect(result.output).toContain('Math error')
      expect(result.output).toContain('Error handled successfully')
    })
  })

  describe('Complex Data Operations', () => {
    test('should handle complex queries with joins and aggregations', async () => {
      const result = await agent.executeCode(`
# Setup related tables
execute("""
CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
)
""")

execute("""
CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    department_id INTEGER,
    salary REAL,
    FOREIGN KEY (department_id) REFERENCES departments(id)
)
""")

# Insert departments
execute("INSERT INTO departments (id, name) VALUES (1, 'Engineering')")
execute("INSERT INTO departments (id, name) VALUES (2, 'Marketing')")

# Insert employees
employees_data = [
    ("Alice Johnson", 1, 75000),
    ("Bob Smith", 1, 80000),
    ("Carol Brown", 2, 60000),
    ("David Wilson", 2, 65000)
]

for name, dept_id, salary in employees_data:
    execute("INSERT INTO employees (name, department_id, salary) VALUES (?, ?, ?)", 
           [name, dept_id, salary])

# Complex query with JOIN and aggregation
results = query("""
SELECT 
    d.name as department,
    COUNT(e.id) as employee_count,
    AVG(e.salary) as avg_salary,
    MAX(e.salary) as max_salary
FROM departments d
LEFT JOIN employees e ON d.id = e.department_id
GROUP BY d.id, d.name
ORDER BY avg_salary DESC
""")

for row in results:
    print(f"Department: {row['department']}")
    print(f"  Employees: {row['employee_count']}")
    print(f"  Avg Salary: $" + f"{row['avg_salary']:.2f}")
    print(f"  Max Salary: $" + f"{row['max_salary']:.2f}")
    print()
`)

      expect(result.success).toBe(true)
      expect(result.output).toContain('Department: Engineering')
      expect(result.output).toContain('Department: Marketing')
      expect(result.output).toContain('Employees:')
      expect(result.output).toContain('Avg Salary:')
    })

    test('should handle data transformations', async () => {
      const result = await agent.executeCode(`
# Create and populate a sales table
execute("""
CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_name TEXT,
    quantity INTEGER,
    price REAL,
    sale_date TEXT
)
""")

sales_data = [
    ("Widget A", 10, 15.99, "2024-01-15"),
    ("Widget B", 5, 25.50, "2024-01-16"),
    ("Widget A", 8, 15.99, "2024-01-17"),
    ("Widget C", 12, 8.75, "2024-01-18")
]

for product, qty, price, date in sales_data:
    execute("INSERT INTO sales (product_name, quantity, price, sale_date) VALUES (?, ?, ?, ?)",
           [product, qty, price, date])

# Data analysis
results = query("""
SELECT 
    product_name,
    SUM(quantity) as total_quantity,
    SUM(quantity * price) as total_revenue,
    AVG(price) as avg_price,
    COUNT(*) as sale_count
FROM sales
GROUP BY product_name
ORDER BY total_revenue DESC
""")

print("Sales Analysis:")
print("-" * 60)
total_revenue = 0
for row in results:
    revenue = row['total_revenue']
    total_revenue += revenue
    print(f"{row['product_name']:12} | {row['total_quantity']:3} units | $" + f"{revenue:7.2f} | $" + f"{row['avg_price']:6.2f} avg")

print("-" * 60)
print(f"{'TOTAL':12} |             | $" + f"{total_revenue:7.2f} |")
`)

      expect(result.success).toBe(true)
      expect(result.output).toContain('Sales Analysis:')
      expect(result.output).toContain('Widget A')
      expect(result.output).toContain('TOTAL')
      expect(result.queryCount).toBeGreaterThan(0)
    })
  })

  describe('Performance and Monitoring', () => {
    test('should track query count and execution metrics', async () => {
      const result = await agent.executeCode(`
# Multiple operations
execute("CREATE TABLE IF NOT EXISTS metrics_test (id INTEGER PRIMARY KEY, value INTEGER)")

for i in range(5):
    execute("INSERT INTO metrics_test (value) VALUES (?)", [i])

results = query("SELECT COUNT(*) as count FROM metrics_test")
print(f"Total records: {results[0]['count']}")

# Multiple queries
for i in range(3):
    query("SELECT * FROM metrics_test WHERE value = ?", [i])

print("Metrics test completed")
`)

      expect(result.success).toBe(true)
      expect(result.queryCount).toBe(9) // 1 CREATE + 5 INSERT + 1 COUNT + 3 SELECT = 10 queries, but CREATE might not count
      expect(result.rowsAffected).toBe(5) // 5 inserted records
    })

    test('should handle timeout scenarios', async () => {
      // Create agent with short timeout for testing
      const shortTimeoutAgent = createDatabaseCodeAgent({
        type: 'sqlite',
        connectionString: ':memory:',
        timeout: 1 // 1 second timeout
      })

      try {
        const result = await shortTimeoutAgent.executeCode(`
import time
print("Starting long operation...")
time.sleep(2)  # Sleep longer than timeout
print("This should not be reached")
`)

        // If we get here, the timeout didn't work as expected
        expect(false).toBe(true) // Force failure
      } catch (error: unknown) {
        expect((error as Error).message).toContain('timeout')
      } finally {
        await shortTimeoutAgent.close()
      }
    }, 10000) // Allow test itself to take longer

    test('should provide accurate status information', async () => {
      await agent.initialize()
      
      // Execute some operations
      await agent.executeCode('execute("CREATE TABLE test (id INTEGER)")')
      await agent.executeCode('execute("INSERT INTO test VALUES (1)")')
      
      const status = agent.getStatus()
      
      expect(status.initialized).toBe(true)
      expect(status.executionCount).toBe(2)
      expect(status.tokenUsage.queries).toBeGreaterThan(0)
      expect(status.config.type).toBe('sqlite')
    })
  })
})

describe('Database Configuration', () => {
  test('should create agents with different database types', () => {
    const configs: DatabaseConfig[] = [
      { type: 'sqlite', connectionString: ':memory:' },
      { 
        type: 'postgresql', 
        host: 'localhost', 
        port: 5432, 
        database: 'testdb',
        username: 'user',
        password: 'pass'
      },
      { type: 'mysql', connectionString: 'mysql://user:pass@localhost/testdb' },
      { type: 'generic', connectionString: 'sqlite:///:memory:' }
    ]

    for (const config of configs) {
      const agent = createDatabaseCodeAgent(config)
      expect(agent).toBeInstanceOf(DatabaseCodeAgent)
      
      const status = agent.getStatus()
      expect(status.config.type).toBe(config.type)
    }
  })

  test('should merge default configuration correctly', () => {
    const config: DatabaseConfig = {
      type: 'postgresql',
      host: 'localhost'
    }

    const agent = createDatabaseCodeAgent(config)
    const status = agent.getStatus()

    expect(status.config.poolSize).toBe(5) // default
    expect(status.config.timeout).toBe(30) // default
    expect(status.config.logQueries).toBe(false) // default
    expect(status.config.sslMode).toBe('prefer') // default
    expect(status.config.host).toBe('localhost') // provided
  })
})

describe('Tool Definition', () => {
  test('should export correct tool definition', async () => {
    const { dbExecuteTool } = await import('./code-agent-db')

    expect(dbExecuteTool.name).toBe('db_execute')
    expect(dbExecuteTool.description).toContain('Execute Python code with database access')
    expect(dbExecuteTool.parameters.type).toBe('object')
    expect(dbExecuteTool.parameters.properties.code).toBeDefined()
    expect(dbExecuteTool.parameters.required).toContain('code')
    expect(dbExecuteTool.metadata.category).toBe('database')
    expect(dbExecuteTool.metadata.riskLevel).toBe('medium')
  })
})