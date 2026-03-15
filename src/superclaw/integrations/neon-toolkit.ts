// @ts-nocheck
/**
 * Neon Toolkit Integration for SuperClaw
 * 
 * Ephemeral database management for AI agent tasks.
 * Each swarm task can spin up its own isolated Postgres instance.
 */

import { NeonToolkit } from '@neondatabase/toolkit';

// Initialize with API key from environment
const apiKey = process.env.NEON_API_KEY;

if (!apiKey) {
  console.warn('⚠️  NEON_API_KEY not set - Neon toolkit will not be available');
}

export const neonToolkit = apiKey ? new NeonToolkit(apiKey) : null;

/**
 * Create an ephemeral database for a swarm task
 */
export async function createTaskDatabase(taskId: string) {
  if (!neonToolkit) {
    throw new Error('Neon toolkit not initialized - set NEON_API_KEY');
  }

  console.log(`🗄️  Creating ephemeral database for task: ${taskId}`);
  
  const project = await neonToolkit.createProject({
    name: `superclaw-${taskId}`,
  });

  console.log(`✅ Database created: ${project.project.id}`);
  console.log(`   Connection: ${project.connectionURIs[0]?.connection_uri?.substring(0, 50)}...`);

  return project;
}

/**
 * Run SQL on a task database
 */
export async function runTaskSQL(project: Awaited<ReturnType<typeof createTaskDatabase>>, sql: string): Promise<unknown> {
  if (!neonToolkit) {
    throw new Error('Neon toolkit not initialized');
  }

  return neonToolkit.sql(project, sql);
}

/**
 * Tear down a task database
 */
export async function destroyTaskDatabase(project: Awaited<ReturnType<typeof createTaskDatabase>>) {
  if (!neonToolkit) {
    throw new Error('Neon toolkit not initialized');
  }

  console.log(`🗑️  Destroying database: ${project.project.id}`);
  await neonToolkit.deleteProject(project);
  console.log(`✅ Database destroyed`);
}

/**
 * Full API client for advanced operations
 */
export function getApiClient() {
  if (!neonToolkit) {
    throw new Error('Neon toolkit not initialized');
  }
  return neonToolkit.apiClient;
}

/**
 * List all projects (useful for cleanup)
 */
export async function listProjects() {
  const client = getApiClient();
  const { data } = await client.listProjects({});
  return data.projects;
}

// ============================================================================
// Swarm Integration Helpers
// ============================================================================

export interface TaskDatabaseContext {
  project: Awaited<ReturnType<typeof createTaskDatabase>>;
  taskId: string;
  createdAt: number;
}

// Track active task databases
const activeTaskDatabases = new Map<string, TaskDatabaseContext>();

/**
 * Get or create a database for a task
 */
export async function getTaskDatabase(taskId: string): Promise<TaskDatabaseContext> {
  let ctx = activeTaskDatabases.get(taskId);
  
  if (!ctx) {
    const project = await createTaskDatabase(taskId);
    ctx = {
      project,
      taskId,
      createdAt: Date.now(),
    };
    activeTaskDatabases.set(taskId, ctx);
  }

  return ctx;
}

/**
 * Cleanup task database
 */
export async function cleanupTaskDatabase(taskId: string): Promise<void> {
  const ctx = activeTaskDatabases.get(taskId);
  
  if (ctx) {
    await destroyTaskDatabase(ctx.project);
    activeTaskDatabases.delete(taskId);
  }
}

/**
 * Cleanup all active task databases (for shutdown)
 */
export async function cleanupAllTaskDatabases(): Promise<void> {
  console.log(`🧹 Cleaning up ${activeTaskDatabases.size} active task databases...`);
  
  const cleanupPromises = Array.from(activeTaskDatabases.keys()).map(taskId => 
    cleanupTaskDatabase(taskId).catch(err => 
      console.error(`Failed to cleanup ${taskId}:`, err)
    )
  );

  await Promise.all(cleanupPromises);
  console.log(`✅ All task databases cleaned up`);
}

// ============================================================================
// Test function
// ============================================================================

export async function testNeonToolkit() {
  console.log('🧪 Testing Neon Toolkit integration...\n');

  if (!neonToolkit) {
    console.error('❌ NEON_API_KEY not set');
    return false;
  }

  try {
    // Create ephemeral DB
    const ctx = await getTaskDatabase('test-' + Date.now());
    
    // Create table
    await runTaskSQL(ctx.project, `
      CREATE TABLE IF NOT EXISTS swarm_results (
        id SERIAL PRIMARY KEY,
        agent_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        result JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('✅ Created swarm_results table');

    // Insert data
    await runTaskSQL(ctx.project, `
      INSERT INTO swarm_results (agent_id, task_id, result)
      VALUES ('coder-1', 'task-001', '{"status": "completed", "output": "Hello World"}');
    `);
    console.log('✅ Inserted test data');

    // Query data
    const results = await runTaskSQL(ctx.project, `SELECT * FROM swarm_results;`);
    console.log('✅ Query results:', results);

    // Cleanup
    await cleanupTaskDatabase(ctx.taskId);
    console.log('\n🎉 Neon Toolkit integration test passed!');
    
    return true;
  } catch (error: unknown) {
    console.error('❌ Test failed:', error);
    return false;
  }
}

// Run test if executed directly
if (require.main === module) {
  testNeonToolkit().then(success => {
    process.exit(success ? 0 : 1);
  });
}
