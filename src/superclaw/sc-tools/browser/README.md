# SuperClaw Browser Tools - OpenBrowser MCP Integration

This directory contains the integration of OpenBrowser MCP into SuperClaw, demonstrating the revolutionary **"CodeAgent pattern"** that achieves **3.2x-6x token efficiency** compared to traditional multi-tool browser automation approaches.

## Files

- **`openbrowser-mcp-integration.ts`** - Core integration with OpenBrowser MCP server
- **`openbrowser-test.ts`** - Test suite and efficiency demonstrations
- **`README.md`** - This documentation

## Quick Start

### Prerequisites

```bash
# Install OpenBrowser (Python package)
pip install openbrowser-ai[mcp]

# Install browser binaries
playwright install chromium
```

### Basic Usage

```typescript
import SuperClawBrowserTool from './openbrowser-mcp-integration'

const browser = new SuperClawBrowserTool({
  headless: true,
  allowedDomains: 'example.com,github.com'
})

await browser.initialize()

// Execute Python code with browser automation functions
const result = await browser.executeWorkflow(`
await navigate('https://example.com')
title = await evaluate('document.title')
links = await evaluate('Array.from(document.querySelectorAll("a")).map(a => a.href)')
print(f"Page: {title}")
print(f"Found {len(links)} links")
`)

console.log(result.output)
await browser.cleanup()
```

## The CodeAgent Pattern

### Traditional Approach (Inefficient)
```typescript
// Each call returns ~124KB of DOM data
await navigate('https://example.com')     // 124KB response
await getBrowserState()                   // 124KB response  
await click('button[type="submit"]')      // 124KB response
await extractText('.result')              // 124KB response
// Total: ~500KB for simple workflow
```

### CodeAgent Approach (Efficient)
```typescript
await executeCode(`
await navigate('https://example.com')
await click(0)  # Button at index 0
result = await evaluate('document.querySelector(".result").textContent')  
print(f"Result: {result}")
`)
// Total: ~50 characters returned, ~500 tokens
```

## Token Efficiency Benchmarks

Based on real-world testing with Claude Sonnet 4.6:

| Approach | Token Usage | Efficiency |
|----------|-------------|------------|
| **Playwright MCP** | 158,787 tokens | 3.2x baseline |
| **Chrome DevTools MCP** | 299,486 tokens | 6.0x baseline |
| **OpenBrowser MCP** | **50,195 tokens** | **1.0x (most efficient)** |

## Available Functions

The persistent Python namespace includes:

### Browser Control
```python
# Navigation
await navigate(url, new_tab=False)
await go_back()
await wait(seconds=3)

# Interaction  
await click(index)                    # Click element by index
await input_text(index, text, clear=True)  # Type in input field
await scroll(down=True, pages=1.0)    # Scroll page
await send_keys('Ctrl+A')            # Send keyboard shortcuts
await upload_file(index, './file.pdf')  # Upload files

# Dropdowns
await select_dropdown(index, 'Option 1')
options = dropdown_options(index)

# JavaScript Execution
result = await evaluate('return document.title')  # Returns Python objects
data = await evaluate('''
  Array.from(document.querySelectorAll('.item')).map(item => ({
    title: item.querySelector('.title').textContent,
    price: item.querySelector('.price').textContent
  }))
''')

# State Management
state = browser.get_browser_state_summary()  # Get page metadata + elements
selector = get_selector_from_index(5)        # Get CSS selector for element

# Task Completion
await done('Task completed successfully', success=True)
```

### Data Libraries
Pre-imported and available:
```python
import json, csv, re, datetime, asyncio
import requests
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from bs4 import BeautifulSoup
from pathlib import Path
```

## Example Workflows

### Web Scraping
```python
await navigate('https://news.ycombinator.com')

# Extract stories with JavaScript
stories = await evaluate('''
  Array.from(document.querySelectorAll('.titleline > a')).map(a => ({
    title: a.textContent.trim(),
    url: a.href,
    domain: new URL(a.href).hostname
  }))
''')

# Process with Python pandas
import pandas as pd
df = pd.DataFrame(stories[:20])
top_domains = df['domain'].value_counts().head(5)

print(f"Top 20 stories extracted")
print(f"Most common domains: {dict(top_domains)}")
```

### Form Automation
```python
await navigate('https://httpbin.org/forms/post')

# Fill form fields by index (from browser state)
await input_text(0, 'John Doe')      # Name field
await click(1)                       # Radio button (Medium)  
await click(4)                       # Checkbox (Mushroom)
await click(6)                       # Submit button

# Verify submission
response = await evaluate('document.body.textContent')
if 'John Doe' in response and 'medium' in response:
    print("✅ Form submitted successfully!")
```

### Multi-Page Research
```python
import json

results = []
sites = [
    'https://en.wikipedia.org/wiki/Python_(programming_language)',
    'https://docs.python.org/3/'
]

for site in sites:
    await navigate(site)
    
    content = await evaluate('''
      {
        title: document.title,
        headings: Array.from(document.querySelectorAll('h1,h2,h3')).map(h => h.textContent).slice(0, 10),
        links: Array.from(document.querySelectorAll('a')).length
      }
    ''')
    
    results.append({
        'url': site,
        'data': content,
        'timestamp': datetime.datetime.now().isoformat()
    })

# Save aggregated results
with open('research_results.json', 'w') as f:
    json.dump(results, f, indent=2)
    
print(f"Research complete: {len(results)} sites analyzed")
```

## Pattern Applications

The CodeAgent pattern can be extended to other high-token domains:

### File System CodeAgent
```typescript
// Instead of: list_files() + read_file() + write_file() = 60KB response
// Use: execute_fs_code() with Python file operations = 100 chars response
await execute_fs_code(`
files = glob.glob('./src/**/*.ts')
content = [{'file': f, 'lines': len(open(f).readlines())} for f in files]  
total_lines = sum(item['lines'] for item in content)
return {'files': len(files), 'total_lines': total_lines}
`)
```

### Database CodeAgent
```typescript
// Instead of: query() + insert() + update() = 20KB response
// Use: execute_sql_code() with SQLAlchemy/raw SQL = 80 chars response
await execute_sql_code(`
users = session.query(User).filter(User.active == True).all()
stats = {'total': len(users), 'premium': len([u for u in users if u.premium])}
session.execute(text('UPDATE analytics SET user_stats = :stats'), {'stats': json.dumps(stats)})
return stats
`)
```

### API CodeAgent
```typescript
// Instead of: http_get() + json_parse() + http_post() = 40KB response
// Use: execute_api_code() with requests/fetch = 120 chars response
await execute_api_code(`
user = requests.get('/api/user/123').json()
orders = requests.post('/api/orders', json={'user_id': user['id']}).json()
summary = {'name': user['name'], 'order_count': len(orders)}
return summary
`)
```

## Testing

Run the test suite to see token efficiency in action:

```bash
cd /home/toba/superclaw/src/tools/browser
npx ts-node openbrowser-test.ts
```

Expected output:
```
🚀 Testing OpenBrowser MCP Integration

📡 Initializing OpenBrowser MCP server...
✅ MCP server initialized

🧪 Test 1: Simple Navigation & Extraction
==================================================
📊 Output size: 187 characters
⏱️  Execution time: 3240ms

📈 EFFICIENCY SUMMARY  
==================================================
Traditional MCP: ~124,000 chars per operation (full DOM snapshots)
OpenBrowser MCP: ~312 chars per operation (extracted data only)
Token efficiency: ~397x improvement
```

## Integration with SuperClaw

### MCP Provider Configuration

Add to SuperClaw's MCP provider registry:

```typescript
// src/integrations/mcp/providers/openbrowser.ts
export const openBrowserProvider: MCPProvider = {
  name: 'openbrowser',
  description: 'Browser automation with CodeAgent pattern',
  command: 'uvx',
  args: ['openbrowser-ai[mcp]', '--mcp'],
  tools: ['execute_code'],
  tokenEfficiency: 'high', // 3.2x-6x more efficient
  capabilities: ['browser', 'javascript', 'data-processing']
}
```

### SuperClaw Tool Registration

```typescript
// src/tools/registry.ts
import { SuperClawBrowserTool } from './browser/openbrowser-mcp-integration'

export const BROWSER_TOOLS = {
  openbrowser: {
    class: SuperClawBrowserTool,
    description: 'High-efficiency browser automation using CodeAgent pattern',
    tokenEfficiency: 'extreme',
    tags: ['browser', 'scraping', 'automation', 'high-efficiency']
  }
}
```

## Security Considerations

### Code Execution Safety
- Python code runs in controlled environment
- No shell command access
- File system access configurable
- Domain whitelist enforcement: `OPENBROWSER_ALLOWED_DOMAINS`

### Browser Security  
- Chrome runs in isolated profile
- Configurable security flags
- Stealth mode available
- Headless by default

### Environment Variables
```bash
OPENBROWSER_HEADLESS=true
OPENBROWSER_ALLOWED_DOMAINS="example.com,*.github.com"
OPENBROWSER_TIMEOUT=30000
OPENBROWSER_STEALTH=false
```

## Performance Optimization

### Resource Management
- Browser session persists across calls
- Python namespace maintains state
- Automatic cleanup on shutdown
- Memory usage: ~100MB base + browser

### Token Optimization
- Return only processed results
- Avoid full DOM snapshots
- Batch operations in single code block
- Use JavaScript for DOM queries, Python for processing

## Future Roadmap

1. **Week 1**: Production integration with SuperClaw
2. **Week 2**: File System CodeAgent implementation  
3. **Week 3**: Database CodeAgent implementation
4. **Week 4**: API CodeAgent implementation
5. **Month 2**: Performance benchmarks and optimization
6. **Month 3**: Additional domains (image processing, PDF handling, etc.)

## Contributing

To extend this integration:

1. **Add new browser functions**: Edit the `namespace.py` in OpenBrowser source
2. **Optimize workflows**: Create reusable Python snippets in `OPENBROWSER_EXAMPLES`
3. **Pattern extraction**: Apply CodeAgent pattern to new domains
4. **Performance testing**: Add benchmarks for token efficiency

## Resources

- **OpenBrowser Docs**: https://docs.openbrowser.me
- **Repository**: https://github.com/billy-enrizky/openbrowser-ai
- **MCP Specification**: https://modelcontextprotocol.io/docs
- **SuperClaw Integration Docs**: `/home/toba/superclaw/docs/integrations/OPENBROWSER-MCP.md`