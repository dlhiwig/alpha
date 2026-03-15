// @ts-nocheck
/**
 * Database CodeAgent Integration Tests
 * 
 * Tests the complete workflow including SuperClaw registry integration
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { createDatabaseCodeAgent, dbExecuteTool, type DatabaseConfig } from './code-agent-db'
import { globalToolRegistry } from '../contracts'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync } from 'fs'

describe('Database CodeAgent Integration', () => {
  let testDbPath: string
  let dbAgent: ReturnType<typeof createDatabaseCodeAgent>

  beforeAll(async () => {
    // Setup test database
    const testDir = join(__dirname, 'integration-test-data')
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true })
    }
    testDbPath = join(testDir, 'integration.db')

    // Create global database agent
    const config: DatabaseConfig = {
      type: 'sqlite',
      connectionString: testDbPath,
      logQueries: true
    }
    
    dbAgent = createDatabaseCodeAgent(config)
    await dbAgent.initialize()

    // Register database tool with SuperClaw registry
    const dbHandler = async (params: { code: string; config?: DatabaseConfig }) => {
      let agent = dbAgent
      
      // Use custom config if provided
      if (params.config) {
        agent = createDatabaseCodeAgent(params.config)
      }
      
      try {
        return await agent.executeCode(params.code)
      } finally {
        // Only close if using temporary agent
        if (params.config && agent !== dbAgent) {
          await agent.close()
        }
      }
    }

    // Register the tool
    globalToolRegistry.register({
      ...dbExecuteTool,
      // @ts-expect-error - Post-Merge Reconciliation
      handler: dbHandler
    })
  })

  afterAll(async () => {
    // Cleanup
    if (dbAgent) {
      await dbAgent.close()
    }
    
    const testDir = join(__dirname, 'integration-test-data')
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
  })

  test('should demonstrate complete e-commerce analytics workflow', async () => {
    // Execute complex multi-step database operations
    // @ts-expect-error - Post-Merge Reconciliation
    const result = await globalToolRegistry.execute('db_execute', {
      code: `
# Setup e-commerce database schema
print("Setting up e-commerce database...")

# Create tables
execute("""
CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT
)
""")

execute("""
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price DECIMAL(10,2),
    category_id INTEGER,
    stock_quantity INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id)
)
""")

execute("""
CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    first_name TEXT,
    last_name TEXT,
    registration_date TEXT DEFAULT CURRENT_TIMESTAMP
)
""")

execute("""
CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER,
    order_date TEXT DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'pending',
    total_amount DECIMAL(10,2),
    FOREIGN KEY (customer_id) REFERENCES customers(id)
)
""")

execute("""
CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    product_id INTEGER,
    quantity INTEGER,
    unit_price DECIMAL(10,2),
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
)
""")

print("Database schema created successfully")
`
    })

    expect(result.success).toBe(true)
    expect(result.output).toContain('Database schema created successfully')
  })

  test('should perform simple analytics', async () => {
    // @ts-expect-error - Post-Merge Reconciliation
    const result = await globalToolRegistry.execute('db_execute', {
      code: `
# Insert sample data
categories = [
    {"name": "Electronics", "description": "Electronic devices"},
    {"name": "Books", "description": "Books and materials"}
]

for category in categories:
    insert("categories", category)

# Insert products
products = [
    {"name": "Laptop", "price": 999.99, "category_id": 1, "stock_quantity": 50},
    {"name": "Book", "price": 29.99, "category_id": 2, "stock_quantity": 100}
]

for product in products:
    insert("products", product)

# Query results
product_count = query("SELECT COUNT(*) as count FROM products")[0]["count"]
print(f"Total products: {product_count}")

category_count = query("SELECT COUNT(*) as count FROM categories")[0]["count"]
print(f"Total categories: {category_count}")
`
    })

    expect(result.success).toBe(true)
    expect(result.output).toContain('Total products: 2')
    expect(result.output).toContain('Total categories: 2')
  })

  test('should demonstrate token efficiency', async () => {
    // @ts-expect-error - Post-Merge Reconciliation
    const result = await globalToolRegistry.execute('db_execute', {
      code: `
print("TOKEN EFFICIENCY DEMONSTRATION")
print("=" * 40)

# This single call replaces multiple traditional database operations
schema_info = get_schema("products")
print(f"Products table has {len(schema_info.get('products', []))} columns")

# Query and process data
products = query("SELECT * FROM products")
total_value = sum(float(p['price']) * p['stock_quantity'] for p in products)
print(f"Total inventory value: {total_value:.2f}")

# Update and audit in one flow
for product in products:
    if product['stock_quantity'] < 75:
        execute("UPDATE products SET stock_quantity = ? WHERE id = ?", 
               [100, product['id']])

print("Inventory management completed in single operation")
print("Traditional approach would need 5+ separate API calls!")
`
    })

    expect(result.success).toBe(true)
    expect(result.output).toContain('TOKEN EFFICIENCY DEMONSTRATION')
    expect(result.output).toContain('Traditional approach would need 5+ separate API calls!')
    expect(result.queryCount).toBeGreaterThan(2)
  })
})