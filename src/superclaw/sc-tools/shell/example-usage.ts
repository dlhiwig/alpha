#!/usr/bin/env node
// @ts-nocheck
/**
 * Example usage of CodeAgent Shell Tool
 * 
 * Demonstrates various features and patterns using the shell_execute function.
 * Run with: npx ts-node src/tools/shell/example-usage.ts
 */

import { shell_execute } from './code-agent-shell';

// Example 1: Basic system information gathering
async function systemInfo() {
  console.log('🔍 Gathering system information...\n');
  
  const result = await shell_execute({
    script: `
      echo "=== System Information ==="
      echo "Hostname: $(hostname)"
      echo "OS: $(uname -s)"
      echo "Kernel: $(uname -r)"
      echo "Uptime: $(uptime)"
      echo ""
      echo "=== Memory Usage ==="
      free -h
      echo ""
      echo "=== Disk Usage ==="
      df -h | grep -E '^/dev/'
      echo ""
      echo "=== Top 5 Processes by Memory ==="
      ps aux --sort=-%mem | head -6
    `,
    security: {
      noSudo: true,
      allowlist: ['echo', 'hostname', 'uname', 'uptime', 'free', 'df', 'grep', 'ps', 'head']
    },
    output: {
      summarize: 'auto'
    },
    tokenTracking: {
      enabled: true,
      budgetLimit: 2000
    }
  });

  if (result.success) {
    console.log('✅ System information gathered successfully');
    console.log(`Duration: ${result.metrics.duration}ms`);
    console.log(`Tokens used: ${result.metrics.tokenUsage?.totalTokens}`);
    console.log('\nOutput:');
    console.log(result.output);
  } else {
    console.error('❌ Failed to gather system information:', result.error);
  }
  
  if (result.warnings?.length) {
    console.warn('\n⚠️ Warnings:', result.warnings);
  }
  
  console.log('\n' + '='.repeat(80) + '\n');
}

// Example 2: Project setup with progress tracking
async function projectSetup() {
  console.log('🚀 Setting up new project...\n');

  const result = await shell_execute({
    script: `
      #!/bin/bash
      set -e
      
      PROJECT_NAME="demo-project-$(date +%s)"
      
      echo "PROGRESS: Creating project directory: $PROJECT_NAME"
      mkdir -p "/tmp/$PROJECT_NAME"
      cd "/tmp/$PROJECT_NAME"
      
      echo "PROGRESS: Initializing package.json"
      cat > package.json << 'EOF'
{
  "name": "$PROJECT_NAME",
  "version": "1.0.0",
  "description": "Demo project created by CodeAgent Shell",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "test": "echo \\"No tests yet\\""
  }
}
EOF
      
      echo "PROGRESS: Creating main application file"
      cat > index.js << 'EOF'
console.log('Hello from CodeAgent Shell demo!');
console.log('Project created at:', new Date().toISOString());
EOF
      
      echo "PROGRESS: Creating README"
      cat > README.md << 'EOF'
# Demo Project

This project was created using SuperClaw's CodeAgent Shell tool.

## Usage

\`\`\`bash
npm start
\`\`\`
EOF
      
      echo "PROGRESS: Project setup complete!"
      echo ""
      echo "Project structure:"
      find . -type f -name "*.json" -o -name "*.js" -o -name "*.md" | sort
      echo ""
      echo "Project size: $(du -sh . | cut -f1)"
    `,
    cwd: '/tmp',
    progress: {
      enabled: true,
      interval: 1000,
      markers: ['PROGRESS: Creating', 'PROGRESS: Initializing', 'PROGRESS: Project setup complete']
    },
    tokenTracking: {
      enabled: true,
      budgetLimit: 3000
    },
    output: {
      summarize: 'auto',
      keepRaw: true
    }
  });

  if (result.success) {
    console.log('✅ Project setup completed successfully');
    console.log(`Duration: ${result.metrics.duration}ms`);
    
    if (result.progress?.length) {
      console.log('\n📊 Progress Reports:');
      result.progress.forEach(p => {
        const marker = p.marker ? ` [${p.marker}]` : '';
        console.log(`  ${p.timestamp.toISOString()}: ${p.message}${marker}`);
      });
    }
    
    console.log('\nFinal Output:');
    console.log(result.output);
  } else {
    console.error('❌ Project setup failed:', result.error);
  }
  
  console.log('\n' + '='.repeat(80) + '\n');
}

// Example 3: Data processing with error handling
async function dataProcessing() {
  console.log('📊 Processing sample data...\n');

  const result = await shell_execute({
    script: `
      #!/bin/bash
      set -e
      
      WORK_DIR="/tmp/data-processing-$(date +%s)"
      mkdir -p "$WORK_DIR"
      cd "$WORK_DIR"
      
      echo "Creating sample CSV data..."
      cat > data.csv << 'EOF'
name,age,city,score
Alice,25,New York,85
Bob,30,San Francisco,92
Charlie,35,Chicago,78
Diana,28,Boston,96
Eve,32,Seattle,88
EOF
      
      echo "Data file created:"
      wc -l data.csv
      
      echo ""
      echo "Processing data with awk..."
      
      # Calculate average score
      echo "Average score:"
      awk -F, 'NR>1 {sum+=$4; count++} END {printf "%.2f\\n", sum/count}' data.csv
      
      # Find highest scorer
      echo ""
      echo "Highest scorer:"
      awk -F, 'NR>1 {if($4>max){max=$4; name=$1}} END {print name": "max}' data.csv
      
      # Group by city
      echo ""
      echo "Records by city:"
      awk -F, 'NR>1 {cities[$3]++} END {for(city in cities) print city": "cities[city]}' data.csv
      
      echo ""
      echo "Processing complete! 🎉"
      
      # Cleanup
      cd /tmp
      rm -rf "$WORK_DIR"
      echo "Temporary files cleaned up"
    `,
    security: {
      noSudo: true,
      allowlist: ['mkdir', 'cd', 'cat', 'wc', 'awk', 'echo', 'rm', 'date', 'printf']
    },
    output: {
      summarize: 'off' // Keep full output for data processing
    },
    tokenTracking: {
      enabled: true
    }
  });

  if (result.success) {
    console.log('✅ Data processing completed successfully');
    console.log(`Duration: ${result.metrics.duration}ms`);
    console.log('\nProcessing Results:');
    console.log(result.output);
  } else {
    console.error('❌ Data processing failed:', result.error);
    if (result.rawOutput?.stderr) {
      console.error('Error details:', result.rawOutput.stderr);
    }
  }
  
  console.log('\n' + '='.repeat(80) + '\n');
}

// Example 4: Security demonstration
async function securityDemo() {
  console.log('🔒 Demonstrating security features...\n');

  // This should fail due to security restrictions
  try {
    const result = await shell_execute({
      script: `
        echo "Attempting dangerous operations..."
        sudo rm -rf /important/data
        rm -rf /
      `,
      security: {
        noSudo: true
      }
    });
    
    console.log('❌ Security test failed - dangerous script was allowed!');
  } catch (error: unknown) {
    console.log('✅ Security test passed - dangerous script was blocked');
    console.log('Error:', (error as Error).message);
  }
  
  // This should work with allowlist
  const safeResult = await shell_execute({
    script: `
      echo "This is safe"
      date
      whoami
    `,
    security: {
      allowlist: ['echo', 'date', 'whoami']
    }
  });
  
  if (safeResult.success) {
    console.log('\n✅ Safe script executed successfully:');
    console.log(safeResult.output);
  }
  
  if (safeResult.warnings?.length) {
    console.log('\n⚠️ Security warnings:', safeResult.warnings);
  }
  
  console.log('\n' + '='.repeat(80) + '\n');
}

// Main execution
async function main() {
  console.log('🦅 CodeAgent Shell Tool Examples\n');
  console.log('Demonstrating the "single tool + code execution" pattern\n');
  
  try {
    await systemInfo();
    await projectSetup();
    await dataProcessing();
    await securityDemo();
    
    console.log('🎉 All examples completed successfully!');
    console.log('\nPattern Benefits Demonstrated:');
    console.log('• Single API call for complex multi-step operations');
    console.log('• Intelligent output summarization');
    console.log('• Progress tracking for long-running tasks');
    console.log('• Token usage tracking and budgeting');
    console.log('• Built-in security controls and validation');
    console.log('• Comprehensive error handling and reporting');
    
  } catch (error: unknown) {
    console.error('❌ Example execution failed:', error);
    process.exit(1);
  }
}

// Run examples if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}