import { sql } from '@vercel/postgres';

async function addSampleContent() {
  console.log('Adding sample content for approval...');
  
  // First insert a task
  const task = await sql`
    INSERT INTO agent_queue (task_type, payload, status)
    VALUES ('generate_workout_tip', '{"user_id": 123, "recent_miles": 5}'::jsonb, 'processing')
    RETURNING id
  `;
  
  const taskId = task.rows[0].id;
  const content = "Great job on your 5-mile run! Here is a tip: Try adding 30 seconds of sprints every 5 minutes to boost your endurance. Keep up the awesome work on your Double Eagle Fitness challenge!";
  
  // Then insert the content for approval
  await sql`
    INSERT INTO content_approvals (queue_id, content, status)
    VALUES (${taskId}, ${content}, 'pending')
  `;
  
  console.log(`✅ Sample content added (task_id: ${taskId})`);
}

addSampleContent().catch(console.error);
