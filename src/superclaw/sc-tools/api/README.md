# SuperClaw CodeAgent API Tool

The CodeAgent API tool implements the "single tool + code execution" pattern for API operations, inspired by OpenBrowser's approach. Instead of having separate `get()`, `post()`, `put()`, `delete()` tools, this provides one `api_execute` tool that runs Python code with HTTP libraries pre-loaded.

## Benefits

- **One tool call orchestrates complex API workflows**
- **Returns only script output**, not full HTTP responses
- **Built-in authentication, rate limiting, and retry logic**
- **Token usage tracking and statistics**
- **Pre-loaded libraries and helper functions**

## Pattern Comparison

### Traditional Approach
```
get("https://api.example.com/users") → Full HTTP response
post("https://api.example.com/users", {...}) → Full HTTP response  
get("https://api.example.com/users/123/posts") → Full HTTP response
= 3 tool calls, lots of response data
```

### CodeAgent Approach
```javascript
api_execute(`
# Get user, create post, fetch results
user = http.get('https://api.example.com/users/me').json()
post_data = {'title': 'Hello', 'author': user['id']}
new_post = http.post('https://api.example.com/posts', json=post_data).json()
posts = http.get(f'https://api.example.com/users/{user["id"]}/posts').json()
print(f"Created post {new_post['id']}, user now has {len(posts)} posts")
`)
= 1 tool call, only summary output
```

## Pre-loaded Libraries

The execution environment comes with:

- **`requests`** - HTTP library with retry logic
- **`json`** - JSON parsing and encoding
- **`os`** - Environment variables and system access
- **`time`** - Timing and delays
- **`base64`** - Base64 encoding/decoding
- **`urllib`** - URL utilities
- **`jwt`** - JWT token handling (if available)

## Built-in Utilities

### HTTP Session (`http`)
Pre-configured `RateLimitedSession` with:
- Rate limiting (default: 10 requests/second)
- Automatic retries on failures
- Request/response size tracking
- Built-in timeout handling

```python
# Basic usage
response = http.get('https://api.example.com/data')
response = http.post('https://api.example.com/data', json={'key': 'value'})
response = http.put('https://api.example.com/data/123', json=update_data)
response = http.delete('https://api.example.com/data/123')
```

### Authentication Helpers (`AuthHelper`)
Common auth patterns:

```python
# Bearer token
headers = AuthHelper.bearer_token('your-token-here')
response = http.get('https://api.example.com/protected', headers=headers)

# API key
headers = AuthHelper.api_key_header('your-key', 'X-API-Key')  
response = http.get('https://api.example.com/data', headers=headers)

# Basic auth
headers = AuthHelper.basic_auth('username', 'password')
response = http.get('https://api.example.com/secure', headers=headers)

# OAuth2
headers = AuthHelper.oauth2_headers('access-token')
response = http.get('https://api.example.com/oauth', headers=headers)
```

### Response Helpers

```python
# Safe JSON parsing
data = safe_json(response)  # Returns None if not valid JSON

# Extract nested data
title = extract_data(response, 'data.user.profile.name')
items = extract_data(response, 'results.0.items')  # Array index

# Response summary for debugging
summary = summarize_response(response, max_content=500)
print(summary)
```

### Rate Limiting

```python
# Adjust rate limiting
set_rate_limit(5.0)  # 5 requests per second

# Rate limiting is automatic - no need to manually sleep
for i in range(10):
    response = http.get(f'https://api.example.com/item/{i}')
    # Automatically rate limited
```

### Statistics Tracking

Statistics are automatically tracked and printed:
```
--- API Execution Stats ---
Duration: 2.34s
Total requests: 5
Successful: 4
Failed: 1
Data transferred: 1542 bytes
Success rate: 80.0%
```

## Usage Examples

### Basic API Call
```javascript
await api_execute({
  code: `
response = http.get('https://jsonplaceholder.typicode.com/posts/1')
post = safe_json(response)
print(f"Post title: {post['title']}")
print(f"Author ID: {post['userId']}")
  `
})
```

### With Authentication
```javascript
await api_execute({
  code: `
headers = AuthHelper.bearer_token(os.environ['API_GITHUB_TOKEN'])
response = http.get('https://api.github.com/user', headers=headers)
user = safe_json(response)
print(f"GitHub user: {user['login']}")
  `,
  auth: {
    GITHUB_TOKEN: 'ghp_your_token_here'
  }
})
```

### Complex Workflow
```javascript
await api_execute({
  code: `
# Multi-step workflow: Get trending repos, check their issues
headers = AuthHelper.bearer_token(os.environ['API_GITHUB_TOKEN'])

# Step 1: Search trending Python repos
search_response = http.get(
  'https://api.github.com/search/repositories',
  params={'q': 'language:python', 'sort': 'stars', 'per_page': 5},
  headers=headers
)
repos = safe_json(search_response)['items']

print(f"Found {len(repos)} trending Python repos:")

# Step 2: Check issues for each repo  
for repo in repos:
  issues_response = http.get(repo['issues_url'].replace('{/number}', ''), headers=headers)
  issues = safe_json(issues_response)
  
  print(f"  {repo['name']}: {repo['stargazers_count']} stars, {len(issues)} open issues")

print("Analysis complete!")
  `,
  auth: {
    GITHUB_TOKEN: 'ghp_your_token_here'
  },
  timeout: 60
})
```

### Error Handling
```javascript
await api_execute({
  code: `
results = []

for endpoint in ['posts', 'comments', 'users']:
  try:
    response = http.get(f'https://jsonplaceholder.typicode.com/{endpoint}')
    data = safe_json(response)
    results.append({'endpoint': endpoint, 'count': len(data), 'success': True})
    print(f"✓ {endpoint}: {len(data)} items")
  except Exception as e:
    results.append({'endpoint': endpoint, 'error': str(e), 'success': False})
    print(f"✗ {endpoint}: {str(e)}")

successful = sum(1 for r in results if r['success'])
print(f"\\nSummary: {successful}/{len(results)} endpoints successful")
  `
})
```

## Parameters

### `code` (required)
Python code to execute. Pre-loaded with HTTP libraries and helpers.

### `auth` (optional)
Key-value pairs of authentication tokens/keys to inject as environment variables:
```javascript
{
  auth: {
    GITHUB_TOKEN: 'ghp_...',
    TWITTER_KEY: 'twitter_...',
    API_KEY: 'custom_key'
  }
}
```
These become available as `os.environ['API_GITHUB_TOKEN']`, `os.environ['API_TWITTER_KEY']`, etc.

### `timeout` (optional)
Execution timeout in seconds (default: 30, max: 300).

### `workdir` (optional)  
Working directory for temporary files (defaults to `/tmp/superclaw-api`).

### `env` (optional)
Additional environment variables to set.

## Best Practices

### 1. Focus on Output, Not Responses
```python
# ✓ Good - Extract what you need
response = http.get('https://api.example.com/users')  
users = safe_json(response)
print(f"Found {len(users)} active users")
for user in users[:5]:
  print(f"  {user['name']} ({user['email']})")

# ✗ Avoid - Don't print full responses  
print(response.text)  # Too verbose
```

### 2. Use Helper Functions
```python
# ✓ Good - Use helpers
data = safe_json(response)
username = extract_data(response, 'user.profile.username')

# ✗ Avoid - Manual parsing
data = json.loads(response.text)  # Can fail
username = response.json()['user']['profile']['username']  # Can fail
```

### 3. Handle Errors Gracefully
```python
# ✓ Good - Graceful handling
try:
  response = http.get('https://api.example.com/data')
  if response.status_code == 200:
    data = safe_json(response)
    print(f"Success: {len(data)} items")
  else:
    print(f"API error: {response.status_code}")
except Exception as e:
  print(f"Request failed: {e}")
```

### 4. Leverage Rate Limiting
```python
# ✓ Good - Let the tool handle it
for item in large_list:
  response = http.get(f'https://api.example.com/item/{item}')
  # Automatically rate limited

# ✗ Avoid - Manual delays  
time.sleep(0.1)  # Unnecessary
```

### 5. Use Authentication Helpers
```python  
# ✓ Good - Use helpers
headers = AuthHelper.bearer_token(os.environ['API_TOKEN'])

# ✗ Avoid - Manual headers
headers = {'Authorization': f'Bearer {os.environ["API_TOKEN"]}'}
```

## Error Handling

The tool handles errors at multiple levels:

1. **Python execution errors** - Captured in `stderr`
2. **HTTP errors** - Handled by retry logic  
3. **Timeout errors** - Script killed after timeout
4. **Authentication errors** - Clear error messages

## Security Notes

- Auth tokens are injected as environment variables, not hardcoded
- Temporary script files are automatically cleaned up
- Rate limiting prevents API abuse
- Execution is sandboxed with timeout limits

## Testing

Run the test suite:
```bash
cd /home/toba/superclaw
npm test src/tools/api/code-agent-api.test.ts
```

Tests cover:
- Basic Python execution
- HTTP capabilities 
- Authentication injection
- Rate limiting
- Response helpers
- Error handling
- Complex workflows