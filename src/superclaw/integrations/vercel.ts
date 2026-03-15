import { Vercel } from '@vercel/sdk';

// Vercel SDK client
const VERCEL_TOKEN = process.env.VERCEL_TOKEN || 'AnXAWuF3hH4IxvltfDclhzgz';

export const vercel = new Vercel({
  bearerToken: VERCEL_TOKEN,
});

// CLI Test
if (require.main === module) {
  (async () => {
    console.log('=== Vercel Connection Test ===\n');
    
    try {
      // Get projects
      const projectsResult = await vercel.projects.getProjects({});
      const projects = Array.isArray(projectsResult) ? projectsResult : (projectsResult as any).projects || [];
      
      console.log(`Found ${projects.length} projects:\n`);
      
      for (const project of projects) {
        console.log(`📦 ${project.name}`);
        console.log(`   ID: ${project.id}`);
        console.log(`   Framework: ${project.framework || 'unknown'}`);
        
        // Get latest deployment
        try {
          const deploymentsResult = await vercel.deployments.getDeployments({
            projectId: project.id,
            limit: 1,
          });
          const deployments = Array.isArray(deploymentsResult) ? deploymentsResult : (deploymentsResult as any).deployments || [];
          
          if (deployments.length > 0) {
            const latest = deployments[0];
            console.log(`   Latest: ${latest.state} (${latest.url})`);
          }
        } catch (e) {
          // Skip deployment fetch errors
        }
        
        console.log('');
      }
    } catch (error: any) {
      console.error('Error:', (error as Error).message || error);
    }
  })();
}
