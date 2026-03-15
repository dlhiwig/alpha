#!/bin/bash
# Alpha Web Research - SuperClaw SKYNET Integration

set -euo pipefail

# Configuration
SUPERCLAW_DIR="/home/toba/superclaw"
BEADS_ENABLED="${BEADS_ENABLED:-true}"
SKYNET_ENABLED="${SKYNET_ENABLED:-true}"

usage() {
    echo "Alpha Web Research - SuperClaw Integration"
    echo ""
    echo "Usage: $0 <command> [options]"
    echo ""
    echo "Commands:"
    echo "  research <query>        - Multi-site research with SKYNET"
    echo "  monitor <url>           - Website monitoring setup"
    echo "  analyze <url>           - Comprehensive site analysis"
    echo "  task <description>      - Create BEADS web research task"
    echo "  batch <sites.txt>       - Batch process multiple sites"
    echo "  intel <target>          - Web intelligence gathering"
    echo "  status                  - Check integration status"
    echo ""
    echo "Options:"
    echo "  --depth <level>         - Research depth (basic|standard|comprehensive)"
    echo "  --output <format>       - Output format (json|markdown|plain)"
    echo "  --assignee <agent>      - BEADS task assignee"
    echo "  --notify <channel>      - Notification channel (telegram|none)"
    echo ""
    echo "Examples:"
    echo "  $0 research 'AI frameworks 2026' --depth=comprehensive"
    echo "  $0 monitor 'https://competitor.com' --notify=telegram"
    echo "  $0 analyze 'https://example.com' --output=markdown"
}

check_dependencies() {
    if ! command -v superclaw >/dev/null 2>&1; then
        echo "❌ SuperClaw not found. Please install SuperClaw first."
        exit 1
    fi
    
    local version
    version=$(superclaw --version | grep -o 'v[0-9.]*' | head -1)
    echo "✅ SuperClaw found: $version"
    
    if [[ "$BEADS_ENABLED" == "true" ]]; then
        if ! superclaw beads status >/dev/null 2>&1; then
            echo "⚠️  BEADS not initialized. Run: superclaw beads init"
            BEADS_ENABLED="false"
        else
            echo "✅ BEADS integration active"
        fi
    fi
    
    if [[ "$SKYNET_ENABLED" == "true" ]]; then
        if ! superclaw skynet --help >/dev/null 2>&1; then
            echo "⚠️  SKYNET modules not available"
            SKYNET_ENABLED="false"
        else
            echo "✅ SKYNET modules available"
        fi
    fi
}

web_research() {
    local query="$1"
    local depth="${2:-standard}"
    local output="${3:-markdown}"
    
    echo "🔍 Starting web research: $query"
    echo "📊 Depth: $depth | Output: $output"
    
    # Create BEADS task if enabled
    if [[ "$BEADS_ENABLED" == "true" ]]; then
        local task_id
        task_id=$(superclaw beads create "Web research: $query" \
            --tags="research,web,alpha" \
            --context="{\"query\": \"$query\", \"depth\": \"$depth\"}" \
            --assignee="alpha-research" \
            --json | jq -r '.id')
        echo "📝 BEADS task created: $task_id"
    fi
    
    # Execute multi-site research
    if [[ "$SKYNET_ENABLED" == "true" ]]; then
        echo "🧠 Executing SKYNET research..."
        superclaw skynet research \
            --query="$query" \
            --mode="web-intelligence" \
            --depth="$depth" \
            --output="$output"
    else
        # Fallback to basic web search
        echo "🔍 Using fallback web search..."
        superclaw web-search "$query" --count=10 --output="$output"
    fi
    
    echo "✅ Research complete"
}

website_monitor() {
    local url="$1"
    local notify="${2:-none}"
    
    echo "👁️  Setting up monitoring for: $url"
    
    if [[ "$SKYNET_ENABLED" == "true" ]]; then
        superclaw skynet monitor \
            --url="$url" \
            --frequency="daily" \
            --aspects="content,structure,performance" \
            --notify="$notify"
        echo "✅ Monitoring configured"
    else
        echo "⚠️  SKYNET monitoring not available. Using basic check..."
        # Basic availability check
        if curl -s --head "$url" | grep "200 OK" >/dev/null; then
            echo "✅ Site is accessible"
        else
            echo "❌ Site appears to be down"
        fi
    fi
}

site_analysis() {
    local url="$1"  
    local output="${2:-markdown}"
    
    echo "🔬 Analyzing site: $url"
    
    # Create comprehensive analysis task
    if [[ "$BEADS_ENABLED" == "true" ]]; then
        local task_id
        task_id=$(superclaw beads create "Site analysis: $url" \
            --tags="analysis,web,alpha" \
            --assignee="alpha-analyzer" \
            --json | jq -r '.id')
        echo "📝 Analysis task: $task_id"
    fi
    
    # Execute analysis
    if command -v superclaw browser >/dev/null 2>&1; then
        superclaw browser analyze \
            --url="$url" \
            --aspects="performance,seo,security,accessibility" \
            --output="$output"
    else
        echo "⚠️  Browser analysis not available. Using basic fetch..."
        superclaw web-fetch "$url" --extract-mode="markdown" --max-chars=5000
    fi
    
    echo "✅ Analysis complete"
}

create_task() {
    local description="$1"
    local assignee="${2:-alpha-web}"
    
    if [[ "$BEADS_ENABLED" != "true" ]]; then
        echo "❌ BEADS not available. Cannot create task."
        exit 1
    fi
    
    echo "📝 Creating web research task..."
    local task_id
    task_id=$(superclaw beads create "$description" \
        --tags="web,research,alpha" \
        --assignee="$assignee" \
        --json | jq -r '.id')
    
    echo "✅ Task created: $task_id"
    echo "   View with: superclaw beads show $task_id"
}

batch_process() {
    local sites_file="$1"
    
    if [[ ! -f "$sites_file" ]]; then
        echo "❌ Sites file not found: $sites_file"
        exit 1
    fi
    
    echo "🔄 Batch processing sites from: $sites_file"
    
    local count=0
    while IFS= read -r site; do
        [[ -z "$site" || "$site" =~ ^#.*$ ]] && continue
        
        echo "[$((++count))] Processing: $site"
        site_analysis "$site" "json" > "/tmp/alpha-analysis-${count}.json"
    done < "$sites_file"
    
    echo "✅ Batch processing complete: $count sites analyzed"
    echo "   Results in: /tmp/alpha-analysis-*.json"
}

web_intelligence() {
    local target="$1"
    local analysis="${2:-comprehensive}"
    
    echo "🕵️  Gathering web intelligence for: $target"
    
    if [[ "$SKYNET_ENABLED" == "true" ]]; then
        superclaw skynet analyze \
            --target="$target" \
            --mode="web-intelligence" \
            --analysis="$analysis" \
            --output="markdown"
    else
        echo "⚠️  SKYNET intelligence not available. Using basic analysis..."
        site_analysis "$target" "markdown"
    fi
    
    echo "✅ Intelligence gathering complete"
}

show_status() {
    echo "🦊 Alpha Web Research Status"
    echo "=========================="
    check_dependencies
    echo ""
    
    if [[ "$BEADS_ENABLED" == "true" ]]; then
        echo "📊 BEADS Tasks:"
        superclaw beads list --assignee="alpha-*" --limit=5 2>/dev/null || echo "   No tasks found"
    fi
    
    echo ""
    echo "🔧 Available Commands:"
    echo "   research - Multi-site research with SKYNET"
    echo "   monitor  - Website monitoring setup"  
    echo "   analyze  - Comprehensive site analysis"
    echo "   intel    - Web intelligence gathering"
    echo ""
    echo "💡 Next: Try 'alpha-web-research research \"your query\"'"
}

# Main execution
main() {
    case "${1:-}" in
        research)
            [[ $# -lt 2 ]] && usage && exit 1
            web_research "$2" "${3:-standard}" "${4:-markdown}"
            ;;
        monitor)
            [[ $# -lt 2 ]] && usage && exit 1
            website_monitor "$2" "${3:-none}"
            ;;
        analyze)
            [[ $# -lt 2 ]] && usage && exit 1
            site_analysis "$2" "${3:-markdown}"
            ;;
        task)
            [[ $# -lt 2 ]] && usage && exit 1
            create_task "$2" "${3:-alpha-web}"
            ;;
        batch)
            [[ $# -lt 2 ]] && usage && exit 1
            batch_process "$2"
            ;;
        intel)
            [[ $# -lt 2 ]] && usage && exit 1
            web_intelligence "$2" "${3:-comprehensive}"
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