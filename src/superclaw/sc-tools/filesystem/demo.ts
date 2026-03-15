// @ts-nocheck
/**
 * Filesystem Code Agent Demo
 * 
 * Demonstrates the CodeAgent pattern for filesystem operations
 */

import FilesystemCodeAgent from './code-agent-fs'
import * as fs from 'fs/promises'
import * as path from 'path'

const DEMO_WORKSPACE = '/tmp/superclaw-fs-demo'

/**
 * Setup demo workspace with sample files
 */
async function setupDemo() {
  console.log('🔧 Setting up demo workspace...')
  
  // Create workspace
  await fs.mkdir(DEMO_WORKSPACE, { recursive: true })
  await fs.mkdir(path.join(DEMO_WORKSPACE, 'src'), { recursive: true })
  await fs.mkdir(path.join(DEMO_WORKSPACE, 'docs'), { recursive: true })
  await fs.mkdir(path.join(DEMO_WORKSPACE, 'data'), { recursive: true })
  
  // Create sample files
  const files = {
    'package.json': JSON.stringify({
      name: 'demo-project',
      version: '1.0.0',
      description: 'Demo project for filesystem code agent',
      scripts: {
        start: 'node src/index.js',
        test: 'jest'
      }
    }, null, 2),
    
    'README.md': `# Demo Project

This is a demonstration project for the Filesystem Code Agent.

## Features

- Feature A
- Feature B  
- Feature C

## Installation

\`\`\`bash
npm install
npm start
\`\`\`

## TODO

- Implement feature D
- Add more tests
- Update documentation
`,

    'src/index.js': `#!/usr/bin/env node

console.log('Hello World!');

function main() {
    // TODO: implement main functionality
    console.log('Running main...');
}

function helper() {
    // FIXME: this needs optimization
    return 'helper result';
}

if (require.main === module) {
    main();
}`,

    'src/utils.js': `// Utility functions
// TODO: add more utilities

function calculateSum(a, b) {
    return a + b;
}

function formatDate(date) {
    // BUG: timezone handling is broken
    return date.toISOString();
}

module.exports = {
    calculateSum,
    formatDate
};`,

    'docs/api.md': `# API Documentation

## Functions

### calculateSum(a, b)
Returns the sum of two numbers.

### formatDate(date)  
Formats a date object.
`,

    'data/users.csv': `name,email,role
John Doe,john@example.com,admin
Jane Smith,jane@example.com,user
Bob Johnson,bob@example.com,user`,

    'data/config.json': JSON.stringify({
      app: {
        name: 'Demo App',
        version: '1.0.0',
        debug: true
      },
      database: {
        host: 'localhost',
        port: 5432,
        name: 'demo_db'
      }
    }, null, 2)
  }
  
  for (const [filePath, content] of Object.entries(files)) {
    await fs.writeFile(path.join(DEMO_WORKSPACE, filePath), content)
  }
  
  console.log(`✅ Demo workspace created at: ${DEMO_WORKSPACE}`)
}

/**
 * Run filesystem code agent demos
 */
async function runDemos() {
  const codeAgent = new FilesystemCodeAgent({
    allowedPaths: [DEMO_WORKSPACE],
    verbose: true
  })
  
  console.log('\n' + '='.repeat(60))
  console.log('🚀 FILESYSTEM CODE AGENT DEMO')
  console.log('='.repeat(60))
  
  // Demo 1: Directory Analysis
  console.log('\n📊 Demo 1: Directory Analysis')
  console.log('-'.repeat(30))
  
  const analysisResult = await codeAgent.execute({
    code: `
# Analyze the demo workspace
analysis = analyze_dir('.')
print(f"📁 Directory: {analysis['directory']}")
print(f"📄 Files: {analysis['total_files']}")
print(f"📂 Directories: {analysis['total_directories']}")
print(f"💾 Total Size: {analysis['total_size_mb']} MB")

print("\\n📋 File Types:")
for ext, count in list(analysis['file_types'].items())[:10]:
    print(f"  {ext or 'no extension'}: {count} files")

print("\\n📈 Largest Files:")
for file_info in analysis['largest_files'][:5]:
    print(f"  {file_info['path']}: {file_info['size_mb']} MB")
`,
    working_directory: DEMO_WORKSPACE
  })
  
  if (analysisResult.success) {
    console.log(analysisResult.output?.result)
  } else {
    console.error('❌ Error:', analysisResult.error)
  }
  
  // Demo 2: Content Search
  console.log('\n🔍 Demo 2: Content Search')
  console.log('-'.repeat(30))
  
  const searchResult = await codeAgent.execute({
    code: `
# Search for TODO/FIXME/BUG comments
todos = search_content(r'TODO|FIXME|BUG', '.', '*.js')
print(f"🚨 Found {len(todos)} TODO/FIXME/BUG items:")

for todo in todos:
    type_match = 'TODO' if 'TODO' in todo['line_content'] else ('FIXME' if 'FIXME' in todo['line_content'] else 'BUG')
    print(f"  [{type_match}] {todo['file']}:{todo['line_number']} - {todo['line_content'].strip()}")

# Search for function definitions
functions = search_content(r'function\\s+\\w+\\s*\\(', '.', '*.js')
print(f"\\n🔧 Found {len(functions)} function definitions:")

for func in functions:
    print(f"  {func['file']}:{func['line_number']} - {func['match']}")

# Analyze markdown headers
md_files = list_files('.', '*.md', recursive=True)
total_headers = 0
for md_file in md_files:
    content = read_file(md_file['path'])
    headers = len([line for line in content.split('\\n') if line.startswith('#')])
    total_headers += headers
    print(f"\\n📝 {md_file['relative_path']}: {headers} headers")

print(f"\\n📚 Total markdown headers: {total_headers}")
`,
    working_directory: DEMO_WORKSPACE
  })
  
  if (searchResult.success) {
    console.log(searchResult.output?.result)
  } else {
    console.error('❌ Error:', searchResult.error)
  }
  
  // Demo 3: Data Processing
  console.log('\n📊 Demo 3: Data Processing & Report Generation')
  console.log('-'.repeat(50))
  
  const dataResult = await codeAgent.execute({
    code: `
# Process CSV data
csv_files = list_files('.', '*.csv', recursive=True)
print(f"📈 Processing {len(csv_files)} CSV files...")

for csv_file in csv_files:
    content = read_file(csv_file['path'])
    lines = content.strip().split('\\n')
    headers = lines[0].split(',') if lines else []
    data_rows = lines[1:] if len(lines) > 1 else []
    
    print(f"\\n📋 {csv_file['relative_path']}:")
    print(f"  Columns: {', '.join(headers)}")
    print(f"  Rows: {len(data_rows)}")
    
    if 'users.csv' in csv_file['name']:
        # Analyze user roles
        role_counts = {}
        for row in data_rows:
            parts = row.split(',')
            if len(parts) >= 3:
                role = parts[2]
                role_counts[role] = role_counts.get(role, 0) + 1
        print(f"  Role distribution: {role_counts}")

# Process JSON config files
json_files = list_files('.', '*.json', recursive=True)
print(f"\\n⚙️ Processing {len(json_files)} JSON config files...")

configs = {}
for json_file in json_files:
    try:
        content = read_file(json_file['path'])
        data = json.loads(content)
        configs[json_file['name']] = data
        print(f"  ✅ {json_file['relative_path']}: {len(str(data))} chars")
    except Exception as e:
        print(f"  ❌ {json_file['relative_path']}: {e}")

# Generate summary report
report_lines = [
    "# Workspace Analysis Report",
    f"Generated: {datetime.datetime.now().isoformat()}\\n",
    "## File Summary"
]

# Add file type breakdown
analysis = analyze_dir('.')
for ext, count in analysis['file_types'].items():
    report_lines.append(f"- **{ext or 'No extension'}**: {count} files")

report_lines.extend([
    "\\n## Code Quality Issues",
    f"- TODO items: {len(search_content(r'TODO', '.', '*.js'))}",
    f"- FIXME items: {len(search_content(r'FIXME', '.', '*.js'))}",
    f"- BUG items: {len(search_content(r'BUG', '.', '*.js'))}",
])

report_lines.extend([
    "\\n## Configuration Files"
])

for name, config in configs.items():
    report_lines.append(f"- **{name}**: {len(json.dumps(config))} characters")

# Write report
write_file('ANALYSIS_REPORT.md', '\\n'.join(report_lines))
print(f"\\n📄 Generated report: ANALYSIS_REPORT.md")

# Show final stats
print(f"\\n📊 Final Statistics:")
print(f"  Files processed: {analysis['total_files']}")
print(f"  Total size: {analysis['total_size_mb']} MB")
print(f"  Code issues found: {len(search_content(r'TODO|FIXME|BUG', '.', '*.js'))}")
print(f"  Report generated: ✅")
`,
    working_directory: DEMO_WORKSPACE
  })
  
  if (dataResult.success) {
    console.log(dataResult.output?.result)
  } else {
    console.error('❌ Error:', dataResult.error)
  }
  
  // Show execution stats
  console.log('\n📈 Execution Statistics:')
  console.log('-'.repeat(30))
  if (dataResult.output?.stats) {
    const stats = dataResult.output.stats
    console.log(`⏱️  Execution Time: ${stats.executionTime}ms`)
    console.log(`📏 Output Size: ${stats.outputSize} bytes`)
    console.log(`🎯 Estimated Tokens: ${stats.tokensEstimate}`)
  }
  
  console.log('\n✅ Demo completed successfully!')
}

/**
 * Cleanup demo workspace
 */
async function cleanup() {
  try {
    await fs.rm(DEMO_WORKSPACE, { recursive: true, force: true })
    console.log('🧹 Demo workspace cleaned up')
  } catch (error: unknown) {
    console.warn('⚠️  Cleanup warning:', error)
  }
}

/**
 * Main demo runner
 */
async function main() {
  try {
    await setupDemo()
    await runDemos()
  } catch (error: unknown) {
    console.error('❌ Demo failed:', error)
  } finally {
    await cleanup()
  }
}

// Run if called directly (ES Module check)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error)
}

export { main as runFilesystemDemo }
export default main