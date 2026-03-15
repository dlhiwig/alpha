# PinchTab Browser Automation Skill

Advanced browser automation and web interaction capabilities for Alpha using PinchTab.

## Quick Start

```bash
# Basic navigation and interaction
pinchtab nav https://example.com
pinchtab snap --interactive
pinchtab click e5
pinchtab text
```

## Core Capabilities

### Navigation & Page Interaction
- **Navigate:** Open URLs in browser instances
- **Snapshot:** Get page structure with clickable elements (800 tokens vs 10,000+ for full HTML)
- **Actions:** Click, type, fill forms, submit, scroll
- **Text Extraction:** Get clean text content efficiently
- **Screenshots:** Capture visual page state when needed

### Multi-Instance Management
- **Profiles:** Separate browser environments (work, personal, testing)
- **Parallel Operations:** Run multiple browser instances simultaneously
- **Session Persistence:** Stay logged in across browser restarts

### Advanced Features
- **Accessibility-First:** Stable element references (e5, e12) instead of fragile coordinates
- **Stealth Mode:** Bypass basic bot detection
- **Form Automation:** Complex form filling and submission workflows
- **Multi-Tab Orchestration:** Coordinate actions across multiple tabs

## API Integration

### PinchTab HTTP API (localhost:9867)

#### Launch Instance
```bash
curl -X POST http://localhost:9867/instances/launch \
  -H "Content-Type: application/json" \
  -d '{"name":"work","mode":"headless","profile":"work"}'
```

#### Navigate & Interact
```bash
# Open tab
curl -X POST http://localhost:9867/instances/$INST/tabs/open \
  -d '{"url":"https://github.com"}'

# Get interactive elements  
curl "http://localhost:9867/tabs/$TAB/snapshot?filter=interactive"

# Click element
curl -X POST "http://localhost:9867/tabs/$TAB/action" \
  -d '{"kind":"click","ref":"e5"}'

# Fill form
curl -X POST "http://localhost:9867/tabs/$TAB/action" \
  -d '{"kind":"fill","ref":"e3","text":"username"}'
```

### Alpha Integration Commands

```bash
# Alpha browser control commands
alpha browser nav <url> [--profile work|personal|test]
alpha browser snap [--interactive] [--text-only]
alpha browser click <element-ref>
alpha browser fill <element-ref> <text>
alpha browser submit [element-ref]
alpha browser text [--clean]
alpha browser screenshot [--full-page]

# Multi-instance operations
alpha browser profile create <name> [--headed|--headless]
alpha browser profile list
alpha browser profile switch <name>
alpha browser instances list
alpha browser instances launch <profile> [--parallel]
```

## Use Cases

### GitHub Automation
```bash
# Review pull requests
alpha browser nav https://github.com/dlhiwig/alpha/pulls
alpha browser snap --interactive
alpha browser click e12  # Click first PR
alpha browser text       # Read PR description
alpha browser fill e8 "LGTM, merging"  # Add comment
alpha browser click e15  # Submit comment
alpha browser click e20  # Approve & merge
```

### Email Management
```bash
# Complex Gmail operations
alpha browser nav https://gmail.com --profile work
alpha browser snap --interactive
alpha browser click e5   # Compose button
alpha browser fill e3 "recipient@domain.com"
alpha browser fill e7 "Subject: Alpha Integration Update"
alpha browser fill e12 "Integration complete. PinchTab operational."
alpha browser click e18  # Send
```

### Research & Data Collection
```bash
# Multi-site research with login persistence
alpha browser profile create research --headed
alpha browser nav https://site1.com --profile research
alpha browser fill e5 "username" && alpha browser fill e7 "password"
alpha browser click e10  # Login
alpha browser nav https://site2.com  # Stays logged in
alpha browser text > research_data.txt
```

### Development Workflows
```bash
# CI/CD monitoring across platforms
alpha browser instances launch ci --parallel
alpha browser nav https://github.com/actions --profile ci
alpha browser nav https://vercel.com/dashboard --profile ci  
alpha browser nav https://aws.console.com/codepipeline --profile ci
alpha browser snap --interactive  # Check all build status
```

## Security & Configuration

### Profile Isolation
- **Work Profile:** Corporate accounts, VPN-restricted sites
- **Personal Profile:** Personal accounts, social media
- **Testing Profile:** Disposable sessions, development sites
- **Research Profile:** Temporary authentication, data collection

### Security Best Practices
- Local-only binding (127.0.0.1:9867)
- Profile-based credential isolation
- Audit logging of all browser actions
- Rate limiting for automated operations
- IDPI restrictions for public internet access

### Configuration
```json
{
  "server": {
    "bind": "127.0.0.1",
    "port": 9867,
    "profiles": ["work", "personal", "testing", "research"]
  },
  "security": {
    "idpi": true,
    "allowlist": ["localhost", "*.local"],
    "audit": true
  },
  "instances": {
    "maxParallel": 5,
    "defaultMode": "headless",
    "timeout": 300
  }
}
```

## Error Handling

### Common Issues
- **Instance timeout:** Restart with `alpha browser instances restart`
- **Element not found:** Re-snapshot with `alpha browser snap --interactive`
- **Profile corruption:** Reset with `alpha browser profile reset <name>`
- **Port conflicts:** Check with `lsof -i :9867`

### Debugging
```bash
# Check PinchTab status
curl http://localhost:9867/health

# List active instances
curl http://localhost:9867/instances

# Get instance details
curl http://localhost:9867/instances/$INST/status

# View browser logs
pinchtab logs --instance $INST
```

## Advanced Workflows

### Multi-Site Authentication
```bash
# Login to multiple related services
alpha browser profile create enterprise --headed
for site in site1.com site2.com site3.com; do
  alpha browser nav "https://$site" --profile enterprise
  alpha browser fill e5 "$USERNAME"
  alpha browser fill e7 "$PASSWORD" 
  alpha browser click e10  # Login
done
```

### Automated Testing
```bash
# E2E testing workflow
alpha browser profile create e2e-testing --headless
alpha browser nav https://app.staging.com --profile e2e-testing
alpha browser fill e3 "test@example.com"
alpha browser fill e5 "password123"
alpha browser click e8   # Login
alpha browser nav https://app.staging.com/dashboard
alpha browser snap --interactive > test_results.json
```

### Content Migration
```bash
# Extract content from legacy system
alpha browser nav https://old-system.com --profile migration
alpha browser text --clean > content_export.txt
alpha browser screenshot --full-page > visual_backup.png
alpha browser nav https://new-system.com
# Process and import content...
```

## Performance Optimization

### Token Efficiency
- Use `snap --interactive` instead of full HTML parsing (800 vs 10,000+ tokens)
- Use `text --clean` for content extraction
- Batch multiple actions in single requests when possible
- Cache element references for repeated interactions

### Resource Management
- Limit parallel instances based on system resources
- Use headless mode for background operations
- Set appropriate timeouts for long-running operations
- Clean up idle instances regularly

## Integration with Other Alpha Skills

### GitHub Skill Enhancement
```bash
# Enhanced PR workflow
alpha github pr list --repo alpha
alpha browser nav "https://github.com/dlhiwig/alpha/pull/$PR_NUMBER"
alpha browser snap --interactive
alpha browser click e15  # Review changes tab
alpha browser text > pr_analysis.txt
alpha github pr comment "$PR_NUMBER" "$(cat pr_analysis.txt)"
```

### Email Skill Enhancement
```bash
# Complex email operations beyond API limits
alpha email list --unread | while read email_id; do
  alpha browser nav "https://gmail.com/mail/u/0/#inbox/$email_id"
  alpha browser text --clean | alpha llm summarize
done
```

This skill transforms Alpha from a text-based assistant into a full web automation platform, enabling complex browser-based workflows while maintaining token efficiency and security.