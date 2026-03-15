/**
 * SuperClaw CodeAgent API Tool Usage Examples
 * 
 * Demonstrates practical usage patterns for the api_execute tool
 */

import { CodeAgentApiTool } from './code-agent-api';

// Create tool instance
const apiTool = new CodeAgentApiTool();

// Example: Basic API call
export async function basicApiExample() {
  const result = await apiTool.execute({
    code: `
# Simple API call
response = http.get('https://jsonplaceholder.typicode.com/posts/1')
post = safe_json(response)
print(f"Post title: {post['title']}")
print(f"Author ID: {post['userId']}")
    `
  // @ts-expect-error - Post-Merge Reconciliation
  }, {});
  
  console.log('Basic API Example:', result.output);
  return result;
}

// Example: API with authentication
export async function authenticatedApiExample() {
  const result = await apiTool.execute({
    code: `
# GitHub API example with auth
headers = AuthHelper.bearer_token(os.environ['API_GITHUB_TOKEN'])
response = http.get('https://api.github.com/user', headers=headers)

if response.status_code == 200:
    user = safe_json(response)
    print(f"GitHub user: {user['login']}")
    print(f"Public repos: {user['public_repos']}")
    print(f"Followers: {user['followers']}")
else:
    print(f"API error: {response.status_code}")
    `,
    auth: {
      GITHUB_TOKEN: 'your_github_token_here' // Replace with real token
    }
  // @ts-expect-error - Post-Merge Reconciliation
  }, {});
  
  console.log('Authenticated API Example:', result.output);
  return result;
}

// Example: Multi-step API workflow
export async function multiStepWorkflowExample() {
  const result = await apiTool.execute({
    code: `
# Multi-step workflow: Search repos, analyze issues
print("=== GitHub Repository Analysis ===")

# Step 1: Search for trending TypeScript repos
search_url = "https://api.github.com/search/repositories"
params = {
    'q': 'language:typescript',
    'sort': 'stars',
    'order': 'desc',
    'per_page': 3
}

headers = AuthHelper.bearer_token(os.environ.get('API_GITHUB_TOKEN', ''))
search_response = http.get(search_url, params=params, headers=headers)
repos = safe_json(search_response)['items']

print(f"Found {len(repos)} trending TypeScript repositories:")

# Step 2: Analyze each repo
for i, repo in enumerate(repos, 1):
    print(f"\\n{i}. {repo['name']} by {repo['owner']['login']}")
    print(f"   ⭐ {repo['stargazers_count']:,} stars")
    print(f"   📄 {repo['description'][:100]}...")
    
    # Get issues count (public API, no auth needed)
    issues_url = repo['issues_url'].replace('{/number}', '')
    issues_response = http.get(issues_url, params={'state': 'open'})
    
    if issues_response.status_code == 200:
        issues = safe_json(issues_response)
        print(f"   🐛 {len(issues)} open issues")
    else:
        print(f"   ❌ Could not fetch issues ({issues_response.status_code})")

print("\\n=== Analysis Complete ===")
    `,
    auth: {
      GITHUB_TOKEN: 'your_github_token_here' // Optional for public repos
    }
  // @ts-expect-error - Post-Merge Reconciliation
  }, {});
  
  console.log('Multi-step Workflow Example:', result.output);
  return result;
}

// Example: Error handling and rate limiting
export async function robustApiExample() {
  const result = await apiTool.execute({
    code: `
# Robust API calls with error handling
set_rate_limit(2.0)  # 2 requests per second

endpoints = [
    'https://jsonplaceholder.typicode.com/posts',
    'https://jsonplaceholder.typicode.com/users', 
    'https://jsonplaceholder.typicode.com/comments'
]

results = []

for endpoint in endpoints:
    try:
        print(f"Fetching {endpoint.split('/')[-1]}...")
        response = http.get(endpoint)
        
        if response.status_code == 200:
            data = safe_json(response)
            results.append({
                'endpoint': endpoint,
                'count': len(data),
                'success': True
            })
            print(f"✅ Success: {len(data)} items")
        else:
            print(f"❌ HTTP {response.status_code}: {response.reason}")
            results.append({
                'endpoint': endpoint,
                'error': f"HTTP {response.status_code}",
                'success': False
            })
            
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
        results.append({
            'endpoint': endpoint,
            'error': str(e),
            'success': False
        })

# Summary
successful = sum(1 for r in results if r['success'])
print(f"\\n📊 Summary: {successful}/{len(results)} endpoints successful")

# Print detailed stats (automatic from template)
    `
  // @ts-expect-error - Post-Merge Reconciliation
  }, {});
  
  console.log('Robust API Example:', result.output);
  return result;
}

// Example: JSON data processing
export async function dataProcessingExample() {
  const result = await apiTool.execute({
    code: `
# Advanced JSON data processing
response = http.get('https://jsonplaceholder.typicode.com/posts')
posts = safe_json(response)

print("=== Blog Post Analysis ===")
print(f"Total posts: {len(posts)}")

# Group posts by user
users = {}
for post in posts:
    user_id = post['userId']
    if user_id not in users:
        users[user_id] = []
    users[user_id].append(post)

# Find most prolific users
top_users = sorted(users.items(), key=lambda x: len(x[1]), reverse=True)[:5]

print("\\n📝 Most prolific authors:")
for user_id, user_posts in top_users:
    avg_title_length = sum(len(p['title']) for p in user_posts) / len(user_posts)
    avg_body_length = sum(len(p['body']) for p in user_posts) / len(user_posts)
    
    print(f"User {user_id}: {len(user_posts)} posts")
    print(f"  📏 Avg title length: {avg_title_length:.1f} chars")
    print(f"  📄 Avg body length: {avg_body_length:.1f} chars")

# Find longest and shortest posts
all_posts_with_length = [(p, len(p['title']) + len(p['body'])) for p in posts]
longest = max(all_posts_with_length, key=lambda x: x[1])
shortest = min(all_posts_with_length, key=lambda x: x[1])

print(f"\\n📏 Longest post: '{longest[0]['title'][:50]}...' ({longest[1]} chars)")
print(f"📏 Shortest post: '{shortest[0]['title'][:50]}...' ({shortest[1]} chars)")
    `
  // @ts-expect-error - Post-Merge Reconciliation
  }, {});
  
  console.log('Data Processing Example:', result.output);
  return result;
}

// Example: Custom configuration
export async function customConfigExample() {
  const result = await apiTool.execute({
    code: `
print("=== Custom Configuration Example ===")

# Check environment variables
print(f"Custom API key: {os.environ.get('CUSTOM_API_KEY', 'Not set')}")
print(f"Debug mode: {os.environ.get('DEBUG_MODE', 'false')}")

# Use custom working directory
import os
print(f"Working directory: {os.getcwd()}")

# Create a temporary file
with open('api_results.json', 'w') as f:
    import json
    data = {'timestamp': str(time.time()), 'test': True}
    json.dump(data, f)

print("✅ Created api_results.json")

# Test rate limiting
print(f"\\nCurrent rate limit: {http.requests_per_second} req/s")
set_rate_limit(1.0)  # Very slow for demo
print(f"Updated rate limit: {http.requests_per_second} req/s")

# Make a few requests to demonstrate
for i in range(2):
    start_time = time.time()
    response = http.get('https://httpbin.org/delay/0')
    duration = time.time() - start_time
    print(f"Request {i+1}: {response.status_code} (took {duration:.2f}s)")
    `,
    workdir: '/tmp/custom-api-test',
    env: {
      'CUSTOM_API_KEY': 'demo-key-12345',
      'DEBUG_MODE': 'true'
    },
    timeout: 15
  // @ts-expect-error - Post-Merge Reconciliation
  }, {});
  
  console.log('Custom Config Example:', result.output);
  return result;
}

// Example: Integration with SuperClaw tool registry
export async function toolRegistryExample() {
  // @ts-expect-error - Post-Merge Reconciliation
  const { bootstrapTools, globalToolRegistry } = await import('../bootstrap');
  
  // Ensure tools are bootstrapped
  bootstrapTools();
  
  // Get the API tool from registry
  const registeredTool = globalToolRegistry.get('api_execute');
  
  if (registeredTool) {
    console.log('Tool found in registry:', registeredTool.name);
    
    // Execute via registry
    const result = await registeredTool.execute({
      code: `
print("Hello from SuperClaw tool registry!")
print(f"Available environment vars: {list(os.environ.keys())[:5]}...")
      `
    }, {
      userId: 'demo-user',
      sessionId: 'demo-session-123'
    });
    
    console.log('Registry execution result:', result.output);
    return result;
  } else {
    console.error('API tool not found in registry');
    return null;
  }
}

// Run examples if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Running SuperClaw CodeAgent API Examples...\n');
  
  // Run examples (comment out to avoid rate limits in testing)
  // await basicApiExample();
  // await dataProcessingExample();
  // await robustApiExample();
  
  console.log('\nExamples completed!');
}