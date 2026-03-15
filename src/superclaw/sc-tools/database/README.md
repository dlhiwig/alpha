# Database CodeAgent Tool

A single-tool solution for database operations that implements the "CodeAgent pattern" - executing Python code in a persistent namespace with pre-loaded database libraries and helper functions.

## 🎯 Benefits

- **Massive token reduction**: Single tool vs multiple (query/insert/update/delete/schema)
- **Returns only results**: No schema dumps or metadata unless requested
- **Persistent namespace**: Multi-step operations without reconnection overhead
- **Universal compatibility**: PostgreSQL, SQLite, MySQL, and generic SQL support
- **Production ready**: Connection pooling, parameterized queries, timeout protection

## 🚀 Quick Start

```typescript
import { createDatabaseCodeAgent, DatabaseConfig } from './code-agent-db'

// SQLite example
const config: DatabaseConfig = {
  type: 'sqlite',
  connectionString: './myapp.db'
}

const agent = createDatabaseCodeAgent(config)
await agent.initialize()

const result = await agent.executeCode(`
# Query users
users = query("SELECT * FROM users WHERE age > ?", [25])
for user in users:
    print(f"{user['name']}: {user['email']}")
`)

console.log(result.output) // User names and emails
```

## 🛠 Available Functions

The Python environment includes these pre-loaded functions:

### Core Query Functions

```python
# Execute SELECT queries - returns List[Dict]
results = query("SELECT * FROM users WHERE age > ?", [25])

# Execute INSERT/UPDATE/DELETE - returns affected row count
affected = execute("UPDATE users SET status = ? WHERE id = ?", ["active", 123])

# Batch operations - efficient for multiple inserts/updates
param_list = [{"name": "John", "age": 30}, {"name": "Jane", "age": 25}]
affected = execute_many("INSERT INTO users (name, age) VALUES (?, ?)", 
                       [(p["name"], p["age"]) for p in param_list])
```

### Helper Functions

```python
# Insert single row - returns affected count
user_id = insert("users", {"name": "John", "email": "john@example.com", "age": 30})

# Update with conditions - returns affected count
affected = update("users", {"status": "active"}, "age > ?", [18])

# Delete with conditions - returns affected count  
affected = delete("users", "status = ?", ["inactive"])

# Get schema information
schema = get_schema("users")  # Single table
all_tables = get_schema()     # All tables
```

## 📊 Database Support

### SQLite
```typescript
const config = {
  type: 'sqlite',
  connectionString: '/path/to/database.db' // or ':memory:'
}
```

### PostgreSQL
```typescript
const config = {
  type: 'postgresql',
  host: 'localhost',
  port: 5432,
  database: 'myapp',
  username: 'user',
  password: 'password',
  poolSize: 10,
  sslMode: 'prefer'
}

// Or with connection string
const config = {
  type: 'postgresql',
  connectionString: 'postgresql://user:password@localhost:5432/myapp'
}
```

### MySQL / Generic
```typescript
const config = {
  type: 'mysql',
  connectionString: 'mysql://user:password@localhost:3306/myapp'
}

const config = {
  type: 'generic', 
  connectionString: 'sqlite:///path/to/db.sqlite'
}
```

## 🔧 Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `type` | `'postgresql' \| 'sqlite' \| 'mysql' \| 'generic'` | - | Database type |
| `connectionString` | `string` | - | Full connection string (optional if individual params provided) |
| `host` | `string` | - | Database host |
| `port` | `number` | `5432` | Database port |
| `database` | `string` | - | Database name |
| `username` | `string` | - | Username |
| `password` | `string` | - | Password |
| `poolSize` | `number` | `5` | Connection pool size |
| `timeout` | `number` | `30` | Query timeout in seconds |
| `logQueries` | `boolean` | `false` | Log all SQL queries |
| `sslMode` | `'disable' \| 'allow' \| 'prefer' \| 'require'` | `'prefer'` | SSL mode (PostgreSQL) |

## 📝 Usage Examples

### Basic CRUD Operations

```python
# Create table
execute("""
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    price DECIMAL(10,2),
    category VARCHAR(50)
)
""")

# Insert products
products = [
    {"name": "Widget A", "price": 19.99, "category": "widgets"},
    {"name": "Gadget B", "price": 29.99, "category": "gadgets"}
]

for product in products:
    insert("products", product)

# Query with filtering
expensive_products = query(
    "SELECT * FROM products WHERE price > ? ORDER BY price DESC", 
    [25.00]
)

for product in expensive_products:
    print(f"{product['name']}: ${product['price']}")

# Update prices
affected = update("products", {"price": 24.99}, "name = ?", ["Widget A"])
print(f"Updated {affected} product(s)")

# Delete discontinued items
affected = delete("products", "category = ?", ["discontinued"]) 
print(f"Deleted {affected} product(s)")
```

### Advanced Analytics

```python
# Complex reporting query
sales_report = query("""
SELECT 
    p.category,
    COUNT(o.id) as order_count,
    SUM(o.quantity * p.price) as total_revenue,
    AVG(o.quantity * p.price) as avg_order_value
FROM products p
JOIN orders o ON p.id = o.product_id
WHERE o.created_at >= ?
GROUP BY p.category
ORDER BY total_revenue DESC
""", ["2024-01-01"])

print("Sales Report by Category:")
print("-" * 50)
total_revenue = 0

for row in sales_report:
    revenue = row['total_revenue'] 
    total_revenue += revenue
    print(f"{row['category']:15} | {row['order_count']:3} orders | ${revenue:8.2f}")

print("-" * 50)
print(f"{'TOTAL':15} |            | ${total_revenue:8.2f}")
```

### Data Transformations

```python
# ETL-style operations
raw_data = query("SELECT * FROM raw_user_data WHERE processed = false")

processed_users = []
for row in raw_data:
    # Transform data
    processed_user = {
        "full_name": f"{row['first_name']} {row['last_name']}",
        "email": row['email_address'].lower().strip(),
        "age": 2024 - int(row['birth_year']),
        "status": "active" if row['is_enabled'] else "inactive"
    }
    processed_users.append(processed_user)

# Batch insert processed data
if processed_users:
    sql = "INSERT INTO users (full_name, email, age, status) VALUES (?, ?, ?, ?)"
    param_list = [(u["full_name"], u["email"], u["age"], u["status"]) 
                  for u in processed_users]
    
    affected = execute_many(sql, param_list)
    print(f"Processed {affected} users")
    
    # Mark as processed
    execute("UPDATE raw_user_data SET processed = true WHERE processed = false")
```

### Schema Introspection

```python
# Get all tables
tables = get_schema()
print("Available tables:", tables["tables"])

# Examine specific table structure
user_schema = get_schema("users")
print("\\nUsers table structure:")
for column in user_schema["users"]:
    print(f"  {column['name']}: {column['type']} {'(NOT NULL)' if not column.get('nullable') else ''}")

# Dynamic query building based on schema
columns = [col['name'] for col in user_schema["users"]]
sql = f"SELECT {', '.join(columns)} FROM users LIMIT 5"
sample_data = query(sql)

for row in sample_data:
    print(row)
```

## 🔒 Security Features

### Parameterized Queries
Always use parameterized queries to prevent SQL injection:

```python
# ✅ SAFE - Parameterized
user_id = 123
user = query("SELECT * FROM users WHERE id = ?", [user_id])

# ❌ DANGEROUS - String concatenation
user = query(f"SELECT * FROM users WHERE id = {user_id}")  # DON'T DO THIS
```

### Connection Pooling
Automatic connection pooling prevents connection exhaustion and improves performance.

### Timeout Protection
All operations have configurable timeouts to prevent hanging queries.

## 📈 Performance Monitoring

The agent tracks execution metrics:

```typescript
const status = agent.getStatus()
console.log({
  initialized: status.initialized,
  executionCount: status.executionCount,
  totalQueries: status.tokenUsage.queries,
  config: status.config
})
```

Example output:
```python
# After execution, results include metrics
result = await agent.executeCode("query('SELECT COUNT(*) FROM users')")

console.log({
  success: result.success,
  queryCount: result.queryCount,        // Queries in this execution
  rowsAffected: result.rowsAffected,    // Rows modified
  executionTime: result.executionTime,  // Milliseconds
  connectionInfo: result.connectionInfo
})
```

## 🧪 Testing

```bash
# Run all tests
npm test src/tools/database/code-agent-db.test.ts

# Run with coverage
npm test -- --coverage src/tools/database/
```

Tests cover:
- SQLite, PostgreSQL, MySQL configurations
- Basic CRUD operations
- Complex queries and joins
- Batch operations
- Error handling
- Schema introspection
- Performance monitoring
- Timeout scenarios

## 🔧 Integration with SuperClaw

Register the tool with SuperClaw's registry:

```typescript
import { dbExecuteTool, createDatabaseCodeAgent } from './tools/database/code-agent-db'
import { ToolRegistry } from './tools/registry'

const registry = new ToolRegistry()

// Global database agent (reuse across executions)
const dbAgent = createDatabaseCodeAgent({
  type: 'postgresql',
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  username: process.env.DB_USER, 
  password: process.env.DB_PASS
})

// Custom handler that uses the global agent
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
    if (params.config) {
      await agent.close()
    }
  }
}

// Register with custom handler
registry.register({
  ...dbExecuteTool,
  handler: dbHandler
})
```

## 📊 Token Efficiency Comparison

Traditional approach (multiple tools):
```
Agent: I need to check user data
Tool: schema_info() → 500 tokens (full schema)
Tool: query_users() → 200 tokens  
Tool: count_orders() → 150 tokens
Tool: update_status() → 100 tokens
Total: ~950 tokens + multiple round trips
```

CodeAgent approach (single tool):
```python
Agent: I need to check user data
Tool: db_execute("""
users = query("SELECT id, name, email FROM users WHERE active = true")
print(f"Found {len(users)} active users")

order_counts = query("""
    SELECT user_id, COUNT(*) as order_count 
    FROM orders 
    GROUP BY user_id
""")

# Update status based on order activity  
for count_row in order_counts:
    if count_row['order_count'] > 10:
        update("users", {"status": "vip"}, "id = ?", [count_row['user_id']])
        
print("Status updates complete")
""") → 300 tokens (results only)
```

**Result: 3.2x token reduction + single round trip**

## 🔄 Migration from Traditional Tools

Replace multiple database tools:

### Before
```typescript
// Multiple tools needed
const tools = [
  'db_query',
  'db_insert', 
  'db_update',
  'db_delete',
  'db_schema',
  'db_execute_raw'
]
```

### After
```typescript
// Single tool handles everything
const tools = ['db_execute']
```

### Migration Script

```python
# Convert traditional tool calls to CodeAgent

# OLD: db_query("SELECT * FROM users WHERE age > 25")
users = query("SELECT * FROM users WHERE age > ?", [25])

# OLD: db_insert("users", {"name": "John", "age": 30})  
user_id = insert("users", {"name": "John", "age": 30})

# OLD: db_update("users", {"status": "active"}, {"id": 123})
affected = update("users", {"status": "active"}, "id = ?", [123])

# OLD: db_delete("users", {"status": "inactive"})
affected = delete("users", "status = ?", ["inactive"])

# OLD: db_schema("users")
schema = get_schema("users")
```

## 🚨 Error Handling

The agent includes comprehensive error handling:

```python
try:
    # Database operations
    users = query("SELECT * FROM users") 
    for user in users:
        # Process user data
        result = some_processing(user)
        
        # Update with result
        update("users", {"processed": True}, "id = ?", [user['id']])
        
except Exception as e:
    print(f"Error processing users: {str(e)}")
    # Rollback or handle error appropriately
    execute("UPDATE users SET error_flag = true WHERE processed = false")
```

Common error patterns:
- SQL syntax errors
- Connection failures  
- Constraint violations
- Timeout errors
- Python runtime errors

## 📋 Requirements

### Python Dependencies
```bash
# Required
pip install psycopg2-binary  # PostgreSQL
pip install sqlalchemy      # Generic SQL support

# Optional (for specific databases)
pip install mysql-connector-python  # MySQL
pip install pymongo                 # MongoDB (via SQLAlchemy)
```

### System Requirements
- Python 3.8+ 
- Node.js 16+
- Database drivers for target databases

## 🤝 Contributing

1. Add new database types in `generatePythonScript()`
2. Extend helper functions for specific use cases
3. Add tests for new functionality
4. Update documentation

## 📄 License

MIT License - see LICENSE file for details.