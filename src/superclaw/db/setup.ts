import { sql } from '@vercel/postgres';

async function setupDatabase() {
  console.log('=== Setting up SuperClaw Database ===\n');

  try {
    // Create agent_queue table
    console.log('Creating agent_queue table...');
    await sql`
      CREATE TABLE IF NOT EXISTS agent_queue (
        id SERIAL PRIMARY KEY,
        task_type VARCHAR(50) NOT NULL,
        payload JSONB NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('✅ agent_queue created');

    // Create content_approvals table
    console.log('Creating content_approvals table...');
    await sql`
      CREATE TABLE IF NOT EXISTS content_approvals (
        id SERIAL PRIMARY KEY,
        queue_id INTEGER REFERENCES agent_queue(id),
        content TEXT NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        admin_feedback TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('✅ content_approvals created');

    // Test insert
    console.log('\nTesting with sample data...');
    const result = await sql`
      INSERT INTO agent_queue (task_type, payload)
      VALUES ('test', '{"message": "Hello from SuperClaw!"}'::jsonb)
      RETURNING id
    `;
    console.log(`✅ Test row inserted with id: ${result.rows[0].id}`);

    // Verify
    const verify = await sql`SELECT COUNT(*) as count FROM agent_queue`;
    console.log(`✅ Total rows in agent_queue: ${verify.rows[0].count}`);

    console.log('\n=== Database Setup Complete ===');
  } catch (error: unknown) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

setupDatabase();
