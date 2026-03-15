#!/bin/bash
# Alpha Browser Automation - SuperClaw CodeAgent Pattern Integration

set -euo pipefail

# Configuration
SUPERCLAW_DIR="/home/toba/superclaw"
BROWSER_ENGINE="${BROWSER_ENGINE:-openbrowser}"
HEADLESS="${HEADLESS:-true}"
TIMEOUT="${TIMEOUT:-30}"

usage() {
    echo "Alpha Browser Automation - SuperClaw Integration"
    echo ""
    echo "Usage: $0 <command> [options]"
    echo ""
    echo "Commands:"
    echo "  execute <code>          - Execute browser automation code"
    echo "  navigate <url>          - Navigate to URL and get state"
    echo "  workflow <file>         - Execute automation workflow from file"
    echo "  scrape <url> <selector> - Quick scrape data from URL"
    echo "  form <url> <data.json>  - Fill and submit form"
    echo "  monitor <url>           - Monitor page for changes"
    echo "  health <url>            - Comprehensive site health check"
    echo "  batch <urls.txt>        - Batch process multiple URLs"
    echo "  status                  - Check automation status"
    echo ""
    echo "Options:"
    echo "  --headless <true|false> - Browser visibility mode"
    echo "  --engine <name>         - Browser engine (openbrowser|playwright)"
    echo "  --timeout <seconds>     - Operation timeout"
    echo "  --output <format>       - Output format (json|text|markdown)"
    echo "  --stealth               - Enable stealth mode"
    echo ""
    echo "Examples:"
    echo "  $0 navigate 'https://example.com'"
    echo "  $0 scrape 'https://news.ycombinator.com' '.titleline > a'"
    echo "  $0 workflow automation-script.py"
    echo "  $0 health 'https://mysite.com' --output=markdown"
}

check_browser_dependencies() {
    echo "🔍 Checking browser automation dependencies..."
    
    if ! command -v superclaw >/dev/null 2>&1; then
        echo "❌ SuperClaw not found"
        exit 1
    fi
    
    # Check for OpenBrowser MCP
    if command -v uvx >/dev/null 2>&1; then
        if uvx openbrowser-ai --version >/dev/null 2>&1; then
            echo "✅ OpenBrowser MCP available"
            BROWSER_ENGINE="openbrowser"
        else
            echo "⚠️  OpenBrowser MCP not installed. Install with: pip install openbrowser-ai[mcp]"
        fi
    fi
    
    # Check for Playwright
    if command -v playwright >/dev/null 2>&1; then
        echo "✅ Playwright available"
        [[ "$BROWSER_ENGINE" == "openbrowser" ]] || BROWSER_ENGINE="playwright"
    else
        echo "⚠️  Playwright not available. Install with: pip install playwright && playwright install"
    fi
    
    echo "🎯 Using engine: $BROWSER_ENGINE"
}

execute_code() {
    local code="$1"
    local output_format="${2:-json}"
    
    echo "🤖 Executing browser automation code..."
    echo "📝 Code preview: ${code:0:100}..."
    
    case "$BROWSER_ENGINE" in
        openbrowser)
            execute_openbrowser_code "$code" "$output_format"
            ;;
        playwright)
            execute_playwright_code "$code" "$output_format"
            ;;
        *)
            echo "❌ Unsupported browser engine: $BROWSER_ENGINE"
            exit 1
            ;;
    esac
}

execute_openbrowser_code() {
    local code="$1"
    local output_format="$2"
    
    # Create temporary Python file with the code
    local temp_file="/tmp/alpha-browser-$$.py"
    cat > "$temp_file" << EOF
import asyncio
import json
from datetime import datetime

# Pre-imported data libraries
import pandas as pd
import numpy as np
from bs4 import BeautifulSoup
import requests

# Browser automation functions will be injected by OpenBrowser
async def main():
    try:
        # User code starts here
$code
        # User code ends here
        
        await done("Browser automation completed successfully", success=True)
        
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        await done(f"Browser automation failed: {str(e)}", success=False)

if __name__ == "__main__":
    asyncio.run(main())
EOF

    echo "🚀 Executing via OpenBrowser MCP..."
    
    # Execute with OpenBrowser
    local result
    if result=$(uvx openbrowser-ai --mcp --code="$temp_file" --headless="$HEADLESS" 2>&1); then
        echo "✅ Execution successful"
        
        case "$output_format" in
            json)
                echo "$result" | jq -r '.' 2>/dev/null || echo "$result"
                ;;
            *)
                echo "$result"
                ;;
        esac
    else
        echo "❌ Execution failed:"
        echo "$result"
    fi
    
    # Cleanup
    rm -f "$temp_file"
}

execute_playwright_code() {
    local code="$1"
    local output_format="$2"
    
    echo "🎭 Executing via Playwright..."
    
    # Create temporary Node.js file
    local temp_file="/tmp/alpha-browser-$$.js"
    cat > "$temp_file" << EOF
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: ${HEADLESS} });
    const context = await browser.newContext();
    const page = await context.newPage();
    
    // Helper functions
    const navigate = async (url) => await page.goto(url);
    const click = async (selector) => await page.click(selector);
    const type = async (selector, text) => await page.fill(selector, text);
    const getText = async (selector) => await page.textContent(selector);
    const evaluate = async (script) => await page.evaluate(script);
    
    try {
        // User code starts here
        $code
        // User code ends here
        
        console.log('✅ Browser automation completed');
    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await browser.close();
    }
})();
EOF

    if node "$temp_file"; then
        echo "✅ Playwright execution successful"
    else
        echo "❌ Playwright execution failed"
    fi
    
    rm -f "$temp_file"
}

navigate_url() {
    local url="$1"
    local output_format="${2:-json}"
    
    echo "🌐 Navigating to: $url"
    
    local code="
await navigate('$url')
title = await evaluate('document.title')
links = await evaluate('Array.from(document.querySelectorAll(\"a\")).length')  
images = await evaluate('Array.from(document.querySelectorAll(\"img\")).length')
forms = await evaluate('Array.from(document.querySelectorAll(\"form\")).length')

result = {
    'url': '$url',
    'title': title,
    'elements': {
        'links': links,
        'images': images, 
        'forms': forms
    },
    'timestamp': '$(date -Iseconds)'
}

print(json.dumps(result, indent=2))
"
    
    execute_code "$code" "$output_format"
}

execute_workflow() {
    local workflow_file="$1"
    
    if [[ ! -f "$workflow_file" ]]; then
        echo "❌ Workflow file not found: $workflow_file"
        exit 1
    fi
    
    echo "📜 Executing workflow: $workflow_file"
    
    local code
    code=$(cat "$workflow_file")
    
    execute_code "$code" "text"
}

scrape_data() {
    local url="$1"
    local selector="$2"
    local output_format="${3:-json}"
    
    echo "🕷️  Scraping $url for: $selector"
    
    local code="
await navigate('$url')
await wait(2)  # Wait for page to load

data = await evaluate('''
    Array.from(document.querySelectorAll(\"$selector\")).map(element => ({
        text: element.textContent.trim(),
        href: element.href || null,
        html: element.outerHTML.substring(0, 200)
    }))
''')

result = {
    'url': '$url',
    'selector': '$selector', 
    'count': len(data),
    'data': data[:10],  # Limit to first 10 results
    'timestamp': '$(date -Iseconds)'
}

print(json.dumps(result, indent=2))
"
    
    execute_code "$code" "$output_format"
}

form_automation() {
    local url="$1"
    local data_file="$2"
    
    if [[ ! -f "$data_file" ]]; then
        echo "❌ Form data file not found: $data_file"
        exit 1
    fi
    
    echo "📝 Automating form at $url with data from $data_file"
    
    # Read form data
    local form_data
    form_data=$(cat "$data_file")
    
    local code="
import json

await navigate('$url')
await wait(2)

# Load form data
form_data = json.loads('$form_data')

# Get form elements
forms = await evaluate('document.querySelectorAll(\"form\").length')
if forms == 0:
    print('❌ No forms found on page')
    return

# Fill form fields based on data
for field, value in form_data.items():
    try:
        # Try various selectors
        selectors = [
            f'input[name=\"{field}\"]',
            f'input[id=\"{field}\"]', 
            f'textarea[name=\"{field}\"]',
            f'select[name=\"{field}\"]'
        ]
        
        for selector in selectors:
            elements = await evaluate(f'document.querySelectorAll(\"{selector}\").length')
            if elements > 0:
                await input_text(0, str(value))  # Fill first matching element
                print(f'✅ Filled {field}: {value}')
                break
        else:
            print(f'⚠️  Field not found: {field}')
    except Exception as e:
        print(f'❌ Error filling {field}: {e}')

# Submit form
submit_buttons = await evaluate('document.querySelectorAll(\"input[type=submit], button[type=submit]\").length')
if submit_buttons > 0:
    await click(0)  # Click first submit button
    await wait(3)
    print('✅ Form submitted')
else:
    print('⚠️  No submit button found')

print('✅ Form automation complete')
"
    
    execute_code "$code" "text"
}

health_check() {
    local url="$1"
    local output_format="${2:-markdown}"
    
    echo "🏥 Performing health check on: $url"
    
    local code="
import time

start_time = time.time()
await navigate('$url')
load_time = time.time() - start_time

# Basic metrics
title = await evaluate('document.title')
status = await evaluate('document.readyState') 
links = await evaluate('Array.from(document.querySelectorAll(\"a\")).length')
images = await evaluate('Array.from(document.querySelectorAll(\"img\")).length')
scripts = await evaluate('Array.from(document.querySelectorAll(\"script\")).length')
stylesheets = await evaluate('Array.from(document.querySelectorAll(\"link[rel=stylesheet]\")).length')

# Performance check
perf = await evaluate('''
    window.performance ? {
        navigation: window.performance.getEntriesByType('navigation')[0],
        resources: window.performance.getEntriesByType('resource').length
    } : null
''')

# Accessibility check  
accessibility = await evaluate('''
    {
        images_without_alt: Array.from(document.querySelectorAll('img:not([alt])')).length,
        headings: Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).length,
        forms_without_labels: Array.from(document.querySelectorAll('input:not([aria-label]):not([aria-labelledby])')).length
    }
''')

result = {
    'url': '$url',
    'title': title,
    'load_time_seconds': round(load_time, 2),
    'ready_state': status,
    'elements': {
        'links': links,
        'images': images,
        'scripts': scripts,
        'stylesheets': stylesheets
    },
    'performance': perf,
    'accessibility': accessibility,
    'timestamp': '$(date -Iseconds)'
}

print('# 🏥 Website Health Check Report')
print(f'**URL:** $url')  
print(f'**Title:** {title}')
print(f'**Load Time:** {load_time:.2f}s')
print(f'**Status:** {status}')
print('')
print('## 📊 Elements')
print(f'- Links: {links}')
print(f'- Images: {images}') 
print(f'- Scripts: {scripts}')
print(f'- Stylesheets: {stylesheets}')
print('')
if accessibility:
    print('## ♿ Accessibility')
    print(f'- Images without alt text: {accessibility[\"images_without_alt\"]}')
    print(f'- Headings: {accessibility[\"headings\"]}')  
    print(f'- Forms without labels: {accessibility[\"forms_without_labels\"]}')
print('')
print(f'**Report generated:** $(date)')
"
    
    execute_code "$code" "$output_format"
}

batch_process_urls() {
    local urls_file="$1"
    
    if [[ ! -f "$urls_file" ]]; then
        echo "❌ URLs file not found: $urls_file"
        exit 1
    fi
    
    echo "🔄 Batch processing URLs from: $urls_file"
    
    local count=0
    local results_dir="/tmp/alpha-batch-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$results_dir"
    
    while IFS= read -r url; do
        [[ -z "$url" || "$url" =~ ^#.*$ ]] && continue
        
        echo "[$((++count))] Processing: $url"
        
        local output_file="$results_dir/result-${count}.json"
        navigate_url "$url" "json" > "$output_file" 2>&1
        
        echo "   → Saved to: $output_file"
    done < "$urls_file"
    
    echo "✅ Batch processing complete: $count URLs"
    echo "   Results in: $results_dir/"
    
    # Create summary
    local summary_file="$results_dir/summary.json"
    echo "{\"total_urls\": $count, \"results_dir\": \"$results_dir\", \"timestamp\": \"$(date -Iseconds)\"}" > "$summary_file"
}

show_status() {
    echo "🤖 Alpha Browser Automation Status"
    echo "=================================="
    check_browser_dependencies
    echo ""
    
    echo "⚙️  Configuration:"
    echo "   Engine: $BROWSER_ENGINE"
    echo "   Headless: $HEADLESS"
    echo "   Timeout: ${TIMEOUT}s"
    echo ""
    
    echo "🎯 Available Commands:"
    echo "   execute   - Run browser automation code"  
    echo "   navigate  - Navigate and analyze page"
    echo "   scrape    - Extract data from page"
    echo "   form      - Automate form filling"
    echo "   health    - Comprehensive site check"
    echo "   batch     - Process multiple URLs"
    echo ""
    
    echo "💡 Quick Start:"
    echo "   alpha-browser-automation navigate 'https://example.com'"
    echo "   alpha-browser-automation scrape 'https://news.ycombinator.com' '.titleline > a'"
}

# Main execution
main() {
    case "${1:-}" in
        execute)
            [[ $# -lt 2 ]] && usage && exit 1
            execute_code "$2" "${3:-json}"
            ;;
        navigate)
            [[ $# -lt 2 ]] && usage && exit 1
            navigate_url "$2" "${3:-json}"
            ;;
        workflow)
            [[ $# -lt 2 ]] && usage && exit 1
            execute_workflow "$2"
            ;;
        scrape)
            [[ $# -lt 3 ]] && usage && exit 1
            scrape_data "$2" "$3" "${4:-json}"
            ;;
        form)
            [[ $# -lt 3 ]] && usage && exit 1
            form_automation "$2" "$3"
            ;;
        health)
            [[ $# -lt 2 ]] && usage && exit 1
            health_check "$2" "${3:-markdown}"
            ;;
        batch)
            [[ $# -lt 2 ]] && usage && exit 1
            batch_process_urls "$2"
            ;;
        status)
            show_status
            ;;
        help|--help|-h)
            usage
            ;;
        *)
            echo "❌ Unknown command: ${1:-}"
            echo ""
            usage
            exit 1
            ;;
    esac
}

# Execute main function
main "$@"