#!/bin/bash
# Alpha PinchTab Integration Test

echo "🦊 Alpha PinchTab Integration Test"
echo "================================="

# Check PinchTab server status
echo "1. Checking PinchTab server..."
if curl -s http://localhost:9867/health > /dev/null; then
    echo "✅ PinchTab server running"
else
    echo "❌ PinchTab server not accessible"
    exit 1
fi

# Get health status
echo "2. Server status:"
curl -s http://localhost:9867/health | jq .

# List instances
echo "3. Current instances:"
curl -s http://localhost:9867/instances | jq .

# Test simple navigation with the default instance
echo "4. Testing navigation..."
RESULT=$(curl -s -X POST http://localhost:9867/navigate -H "Content-Type: application/json" -d '{"url":"https://httpbin.org/html"}')
echo "Navigate result: $RESULT"

# Wait for page load
sleep 3

# Try to get page text
echo "5. Testing text extraction..."
curl -s http://localhost:9867/text

echo ""
echo "🎯 Integration Test Results:"
echo "- PinchTab Server: ✅ Running"
echo "- HTTP API: ✅ Accessible" 
echo "- Browser Control: ⚠️  Needs Chrome configuration"
echo ""
echo "Next steps: Configure Chrome/Chromium for headless operation"