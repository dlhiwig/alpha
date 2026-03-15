#!/bin/bash
# Alpha Browser Tool - PinchTab Integration

PINCHTAB_SERVER="http://localhost:9867"

function check_server() {
    if ! curl -s "$PINCHTAB_SERVER/health" > /dev/null; then
        echo "❌ PinchTab server not running. Start with: pinchtab server &"
        exit 1
    fi
}

function browser_nav() {
    local url="$1"
    local profile="${2:-default}"
    
    check_server
    echo "🌐 Navigating to: $url (profile: $profile)"
    
    # Try direct navigation first
    result=$(curl -s -X POST "$PINCHTAB_SERVER/navigate" \
        -H "Content-Type: application/json" \
        -d "{\"url\":\"$url\"}")
    
    echo "$result"
}

function browser_snap() {
    local interactive=""
    if [[ "$1" == "--interactive" ]]; then
        interactive="?filter=interactive"
    fi
    
    check_server
    echo "📸 Taking page snapshot..."
    
    curl -s "$PINCHTAB_SERVER/snapshot$interactive" | jq .
}

function browser_text() {
    check_server
    echo "📝 Extracting page text..."
    
    curl -s "$PINCHTAB_SERVER/text"
}

function browser_health() {
    check_server
    echo "🔍 PinchTab Status:"
    curl -s "$PINCHTAB_SERVER/health" | jq .
}

function browser_instances() {
    check_server
    echo "🖥️  Browser Instances:"
    curl -s "$PINCHTAB_SERVER/instances" | jq .
}

function show_help() {
    echo "Alpha Browser Tool - PinchTab Integration"
    echo "========================================"
    echo ""
    echo "Commands:"
    echo "  nav <url> [profile]     Navigate to URL"
    echo "  snap [--interactive]    Take page snapshot"
    echo "  text                    Extract page text"
    echo "  health                  Check service status"
    echo "  instances               List browser instances"
    echo "  help                    Show this help"
    echo ""
    echo "Examples:"
    echo "  alpha-browser nav https://github.com"
    echo "  alpha-browser snap --interactive"
    echo "  alpha-browser text"
    echo ""
    echo "Note: PinchTab server must be running (pinchtab server &)"
}

# Main command dispatch
case "$1" in
    "nav"|"navigate")
        if [[ -z "$2" ]]; then
            echo "Usage: $0 nav <url> [profile]"
            exit 1
        fi
        browser_nav "$2" "$3"
        ;;
    "snap"|"snapshot")
        browser_snap "$2"
        ;;
    "text")
        browser_text
        ;;
    "health"|"status")
        browser_health
        ;;
    "instances"|"list")
        browser_instances
        ;;
    "help"|"-h"|"--help"|"")
        show_help
        ;;
    *)
        echo "Unknown command: $1"
        show_help
        exit 1
        ;;
esac