import { Vercel } from '@vercel/sdk';

const VERCEL_TOKEN = 'AnXAWuF3hH4IxvltfDclhzgz';
const vercel = new Vercel({ bearerToken: VERCEL_TOKEN });

async function auditVercel() {
  console.log('=== Vercel Account Audit ===\n');
  
  // Get projects
  const projectsResult = await vercel.projects.getProjects({});
  const projects = Array.isArray(projectsResult) ? projectsResult : (projectsResult as any).projects || [];
  
  for (const project of projects) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`📦 PROJECT: ${project.name}`);
    console.log(`${'='.repeat(50)}`);
    console.log(`ID: ${project.id}`);
    console.log(`Framework: ${project.framework || 'unknown'}`);
    console.log(`Node Version: ${project.nodeVersion || 'default'}`);
    console.log(`Root Directory: ${project.rootDirectory || '/'}`);
    console.log(`Created: ${new Date(project.createdAt).toISOString()}`);
    
    // Git info
    if (project.link) {
      const link = project.link;
      console.log(`\n📂 Git Repository:`);
      console.log(`   Type: ${link.type}`);
      console.log(`   Repo: ${link.repo}`);
      console.log(`   Branch: ${link.productionBranch || 'main'}`);
    }
    
    // Domains
    console.log(`\n🌐 Domains:`);
    try {
      const domainsResult = await vercel.projects.getProjectDomains({ idOrName: project.id });
      const domains = (domainsResult as any).domains || [];
      for (const domain of domains) {
        console.log(`   - ${domain.name} ${domain.verified ? '✓' : '(unverified)'}`);
      }
    } catch (e) {
      console.log('   (unable to fetch domains)');
    }
    
    // Recent deployments
    console.log(`\n🚀 Recent Deployments:`);
    try {
      const deploymentsResult = await vercel.deployments.getDeployments({
        projectId: project.id,
        limit: 5,
      });
      const deployments = Array.isArray(deploymentsResult) ? deploymentsResult : (deploymentsResult as any).deployments || [];
      
      for (const dep of deployments) {
        const date = new Date(dep.createdAt).toISOString().slice(0, 16);
        console.log(`   ${dep.state.padEnd(10)} | ${date} | ${dep.url}`);
      }
    } catch (e) {
      console.log('   (unable to fetch deployments)');
    }
    
    // Environment variables (names only, not values)
    console.log(`\n🔐 Environment Variables:`);
    try {
      const envResult = await vercel.projects.filterProjectEnvs({ idOrName: project.id });
      const envs = (envResult as any).envs || [];
      for (const env of envs) {
        console.log(`   - ${env.key} [${env.target?.join(', ') || 'all'}]`);
      }
      if (envs.length === 0) {console.log('   (none configured)');}
    } catch (e) {
      console.log('   (unable to fetch env vars)');
    }
  }
}

auditVercel().catch(console.error);
