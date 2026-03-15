---
name: superclaw-web-tools
description: "SuperClaw website tools and SKYNET web integrations for enhanced web automation, browser control, and site analysis capabilities"
homepage: https://github.com/dlhiwig/superclaw
metadata:
  {
    "openclaw":
      {
        "emoji": "🌐",
        "requires": { "bins": ["superclaw"] },
        "tags": ["web", "browser", "automation", "superclaw", "skynet"]
      },
  }
---

# SuperClaw Web Tools Integration

SuperClaw's advanced web automation capabilities integrated into Alpha for enhanced website interaction, browser automation, and intelligent web workflows.

## Prerequisites

1. SuperClaw installed (`superclaw --version` should show v2.3.0+)
2. BEADS memory system initialized (`superclaw beads status`)
3. Browser automation dependencies (Playwright/Chrome)

## Core Capabilities

### 1. Enhanced Web Search
```bash
# SuperClaw's intelligent web search with context awareness
superclaw web-search "latest AI developments" --context="technical research" --depth=5
```

### 2. OpenBrowser MCP Integration (CodeAgent Pattern)
- **3.2x-6x token efficiency** compared to traditional browser automation
- Persistent Python namespace for complex workflows
- JavaScript evaluation with Python data processing

### 3. SKYNET Web Intelligence
- Automated competitive analysis
- Website monitoring and change detection  
- Content intelligence gathering

## Usage Examples

### Advanced Web Research
```bash
# Use SuperClaw's research capabilities
superclaw beads create "Research competitor analysis" --assignee=alpha
superclaw swarm research --target="https://competitor.com" --analysis="feature-comparison"
```

### Browser Automation Workflows
```javascript
// CodeAgent pattern for efficient automation
const workflow = `
await navigate('https://example.com')
data = await evaluate('''
  Array.from(document.querySelectorAll('.product')).map(item => ({
    title: item.querySelector('.title').textContent,
    price: item.querySelector('.price').textContent
  }))
''')
return {'products': len(data), 'data': data}
`

// Execute via SuperClaw browser tool
superclaw browser execute --code="${workflow}"
```

### Website Monitoring
```bash
# SKYNET-powered website intelligence
superclaw skynet monitor --url="https://target-site.com" --alerts=telegram
superclaw skynet diff --url="https://docs.example.com" --since="24h"
```

## Integration Commands

### Web Search Enhancement
```bash
# Enhanced search with SKYNET intelligence
alpha-web-search() {
    local query="$1"
    local mode="${2:-research}"
    
    # Use SuperClaw's enhanced search
    superclaw web-search "$query" --mode="$mode" --json | \
    jq -r '.results[] | "[\(.title)](\(.url))\n\(.snippet)\n"'
}
```

### Browser Task Automation
```bash
# Create browser automation task in BEADS
alpha-browser-task() {
    local description="$1"
    local url="$2"
    
    superclaw beads create "$description" \
        --tags="browser,automation" \
        --context="{\"url\": \"$url\"}" \
        --assignee="alpha-browser"
}
```

### SKYNET Web Intelligence
```bash
# Web intelligence gathering
alpha-web-intel() {
    local target="$1"
    local analysis="${2:-basic}"
    
    superclaw skynet analyze \
        --target="$target" \
        --mode="web-intelligence" \
        --analysis="$analysis" \
        --output="markdown"
}
```

## Token-Efficient Patterns

### CodeAgent Browser Pattern
Instead of multiple tool calls returning 124KB each:
```bash
# Traditional: 4 calls × 124KB = ~500KB
browser_navigate "https://example.com"
browser_get_state  
browser_click "submit"
browser_extract_text ".result"
```

Use CodeAgent pattern for ~500 tokens total:
```python
await navigate('https://example.com')
await click(0)  # Submit button at index 0  
result = await evaluate('document.querySelector(".result").textContent')
print(f"Result: {result}")
```

### Batch Web Operations
```bash
# Process multiple sites efficiently
sites="site1.com site2.com site3.com"
superclaw browser batch-process --sites="$sites" --extract="title,links,content"
```

## SKYNET Integration Features

### 1. Automated Web Intelligence
- Competitive monitoring
- Technology stack detection
- Content change tracking
- SEO analysis automation

### 2. Research Workflows
- Multi-site research coordination
- Source verification and fact-checking
- Automated report generation
- Citation management

### 3. Security Intelligence  
- Website security assessment
- Vulnerability detection
- Privacy analysis
- Compliance checking

## Installation & Setup

### Initialize SuperClaw Web Tools
```bash
# Initialize BEADS for web task management
superclaw beads init

# Set up browser automation
superclaw browser setup --engine="playwright"

# Configure SKYNET web intelligence
superclaw skynet configure --web-intel=true
```

### Alpha Skill Integration
```bash
# Link SuperClaw tools to Alpha
ln -sf /home/toba/superclaw/src/tools/web-* /home/toba/alpha/skills/superclaw-web-tools/tools/
ln -sf /home/toba/superclaw/src/skynet/ /home/toba/alpha/skills/superclaw-web-tools/skynet/
```

## Workflow Examples

### Research Project
```bash
# 1. Create research task
superclaw beads create "AI framework comparison" --tags="research,web"

# 2. Execute multi-site analysis
superclaw skynet research \
    --query="AI frameworks 2026" \
    --sites="github.com,arxiv.org,papers.io" \
    --depth="comprehensive"

# 3. Generate report  
superclaw beads show --format="markdown" > research_report.md
```

### Competitive Analysis
```bash
# Monitor competitor websites
superclaw skynet monitor \
    --targets="competitor1.com,competitor2.com" \
    --aspects="features,pricing,announcements" \
    --frequency="daily" \
    --notify="telegram"
```

### Website Health Check
```bash
# Comprehensive site analysis
superclaw browser health-check "https://mysite.com" \
    --aspects="performance,seo,security,accessibility" \
    --report="detailed"
```

## Performance Optimization

### Token Efficiency
- Use CodeAgent pattern for browser automation (3.2x-6x efficiency)
- Batch operations where possible
- Cache frequently accessed data via BEADS
- Intelligent content extraction over full DOM snapshots

### Resource Management  
- Reuse browser sessions across tasks
- Implement request rate limiting
- Cache web search results
- Use SKYNET for intelligent task prioritization

## Troubleshooting

### SuperClaw Connection Issues
```bash
# Check SuperClaw status
superclaw gateway --health

# Verify BEADS integration
superclaw beads status

# Test browser automation
superclaw browser test --url="https://httpbin.org"
```

### SKYNET Module Issues
```bash
# Verify SKYNET modules
superclaw skynet --modules

# Check web intelligence status  
superclaw skynet web-intel --status

# Test research capabilities
superclaw skynet research --test
```

## Integration Checklist

- [ ] SuperClaw v2.3.0+ installed and configured
- [ ] BEADS memory system initialized
- [ ] Browser automation (Playwright/Chrome) set up
- [ ] SKYNET web intelligence modules enabled
- [ ] Alpha skill symlinks created
- [ ] Token efficiency patterns implemented
- [ ] Web monitoring workflows configured
- [ ] Research automation pipelines established

## References

- SuperClaw Browser Tools: `/home/toba/superclaw/src/tools/browser/`
- SKYNET Web Intelligence: `/home/toba/superclaw/src/skynet/`
- OpenBrowser MCP: CodeAgent pattern implementation
- BEADS Task Management: Memory-persistent workflow coordination