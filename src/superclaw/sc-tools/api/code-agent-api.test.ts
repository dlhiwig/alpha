/**
 * SuperClaw CodeAgent API Tool Tests
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { CodeAgentApiTool } from './code-agent-api';
import type { AgentContext } from '../../standalone/agent/executor';

describe('CodeAgentApiTool', () => {
  let tool: CodeAgentApiTool;
  let mockContext: AgentContext;

  beforeAll(() => {
    tool = new CodeAgentApiTool();
    // @ts-expect-error - Post-Merge Reconciliation
    mockContext = {
      userId: 'test-user',
      sessionId: 'test-session',
      capabilities: [],
      metadata: {}
    } as AgentContext;
  });

  describe('Basic Execution', () => {
    test('should execute simple Python code', async () => {
      const result = await tool.execute({
        code: 'print("Hello from CodeAgent!")'
      }, mockContext);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Hello from CodeAgent!');
      expect(result.exitCode).toBe(0);
      expect(result.duration).toBeGreaterThan(0);
    });

    test('should handle Python errors gracefully', async () => {
      const result = await tool.execute({
        code: 'raise ValueError("Test error")'
      }, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('ValueError: Test error');
      expect(result.exitCode).toBe(1);
    });

    test('should respect timeout limits', async () => {
      const result = await tool.execute({
        code: 'import time; time.sleep(2)',
        timeout: 1
      }, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('timeout');
    }, 10000); // 10s test timeout
  });

  describe('HTTP Capabilities', () => {
    test('should have requests library available', async () => {
      const result = await tool.execute({
        code: `
import requests
print("requests module loaded successfully")
print(f"requests version: {requests.__version__}")
        `
      }, mockContext);

      expect(result.success).toBe(true);
      expect(result.output).toContain('requests module loaded successfully');
    });

    test('should have pre-configured HTTP session', async () => {
      const result = await tool.execute({
        code: `
print(f"HTTP session available: {http is not None}")
print(f"Rate limit: {http.requests_per_second} req/s")
        `
      }, mockContext);

      expect(result.success).toBe(true);
      expect(result.output).toContain('HTTP session available: True');
      expect(result.output).toContain('Rate limit: 10.0 req/s');
    });

    test('should make HTTP request with stats tracking', async () => {
      const result = await tool.execute({
        code: `
# Make a simple HTTP request
response = http.get('https://httpbin.org/json')
print(f"Status: {response.status_code}")

# Print basic response info
data = safe_json(response)
if data:
    print(f"JSON keys: {list(data.keys())}")
    
# Stats will be printed automatically
        `
      }, mockContext);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Status: 200');
      expect(result.output).toContain('Total requests: 1');
      expect(result.output).toContain('Successful: 1');
    }, 15000); // Allow time for HTTP request
  });

  describe('Authentication', () => {
    test('should inject auth tokens as environment variables', async () => {
      const result = await tool.execute({
        code: `
import os
print("Available API tokens:")
for key, value in os.environ.items():
    if key.startswith('API_'):
        print(f"{key}: {value[:10]}...")
        
print(f"AUTH_TOKENS: {AUTH_TOKENS}")
        `,
        auth: {
          GITHUB_TOKEN: 'ghp_test123456789',
          twitter_key: 'twitter_secret_key'
        }
      }, mockContext);

      expect(result.success).toBe(true);
      expect(result.output).toContain('API_GITHUB_TOKEN: ghp_test12...');
      expect(result.output).toContain('API_TWITTER_KEY: twitter_se...');
    });

    test('should have auth helper functions available', async () => {
      const result = await tool.execute({
        code: `
# Test auth helpers
bearer = AuthHelper.bearer_token('test123')
print(f"Bearer header: {bearer}")

api_key = AuthHelper.api_key_header('secret', 'X-Custom-Key')
print(f"API key header: {api_key}")

basic = AuthHelper.basic_auth('user', 'pass')
print(f"Basic auth header: {basic}")
        `
      }, mockContext);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Bearer header: {\'Authorization\': \'Bearer test123\'}');
      expect(result.output).toContain('API key header: {\'X-Custom-Key\': \'secret\'}');
      expect(result.output).toContain('Basic auth header:');
    });
  });

  describe('Rate Limiting & Retry Logic', () => {
    test('should allow rate limit configuration', async () => {
      const result = await tool.execute({
        code: `
print(f"Initial rate limit: {http.requests_per_second}")

# Change rate limit
set_rate_limit(5.0)
print(f"Updated rate limit: {http.requests_per_second}")
        `
      }, mockContext);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Initial rate limit: 10.0');
      expect(result.output).toContain('Updated rate limit: 5.0');
    });

    test('should handle multiple requests with rate limiting', async () => {
      const result = await tool.execute({
        code: `
import time

# Set a low rate limit to test timing
set_rate_limit(2.0)  # 2 requests per second

start_time = time.time()

# Make multiple requests
for i in range(3):
    response = http.get('https://httpbin.org/delay/0')
    print(f"Request {i+1}: {response.status_code}")

end_time = time.time()
duration = end_time - start_time

print(f"Total duration: {duration:.2f}s")
print("Should be at least 1s due to rate limiting")
        `,
        timeout: 10
      }, mockContext);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Request 1: 200');
      expect(result.output).toContain('Request 2: 200');
      expect(result.output).toContain('Request 3: 200');
      expect(result.output).toContain('Total requests: 3');
    }, 20000);
  });

  describe('Response Helpers', () => {
    test('should have JSON parsing helpers', async () => {
      const result = await tool.execute({
        code: `
# Test response helpers
response = http.get('https://httpbin.org/json')
data = safe_json(response)

print(f"JSON parsed: {data is not None}")
if data:
    print(f"Keys: {list(data.keys())}")

# Test data extraction
extracted = extract_data(response, 'slideshow.title')
print(f"Extracted title: {extracted}")
        `
      }, mockContext);

      expect(result.success).toBe(true);
      expect(result.output).toContain('JSON parsed: True');
    }, 10000);

    test('should create response summaries', async () => {
      const result = await tool.execute({
        code: `
response = http.get('https://httpbin.org/json')
summary = summarize_response(response, max_content=200)
print("Response Summary:")
print(summary)
        `
      }, mockContext);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Response Summary:');
      expect(result.output).toContain('Status: 200 OK');
    }, 10000);
  });

  describe('Environment & Configuration', () => {
    test('should support custom environment variables', async () => {
      const result = await tool.execute({
        code: `
import os
print(f"CUSTOM_VAR: {os.environ.get('CUSTOM_VAR')}")
print(f"DEBUG_MODE: {os.environ.get('DEBUG_MODE')}")
        `,
        env: {
          CUSTOM_VAR: 'test_value',
          DEBUG_MODE: 'true'
        }
      }, mockContext);

      expect(result.success).toBe(true);
      expect(result.output).toContain('CUSTOM_VAR: test_value');
      expect(result.output).toContain('DEBUG_MODE: true');
    });

    test('should support custom working directory', async () => {
      const result = await tool.execute({
        code: `
import os
import tempfile

# Create a test file
with open('test_file.txt', 'w') as f:
    f.write('Hello from custom workdir!')

# Read it back
with open('test_file.txt', 'r') as f:
    content = f.read()

print(f"File content: {content}")
print(f"Working directory: {os.getcwd()}")
        `,
        workdir: '/tmp/test-workdir'
      }, mockContext);

      expect(result.success).toBe(true);
      expect(result.output).toContain('File content: Hello from custom workdir!');
    });
  });

  describe('Error Handling', () => {
    test('should handle network errors gracefully', async () => {
      const result = await tool.execute({
        code: `
try:
    response = http.get('https://invalid-domain-that-does-not-exist.com')
    print(f"Unexpected success: {response.status_code}")
except Exception as e:
    print(f"Expected network error: {type(e).__name__}")
    print("Continuing execution...")

print("Script completed successfully")
        `
      }, mockContext);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Expected network error:');
      expect(result.output).toContain('Script completed successfully');
    }, 10000);

    test('should track failed requests in stats', async () => {
      const result = await tool.execute({
        code: `
# Make a request that will fail
try:
    response = http.get('https://httpbin.org/status/404')
    print(f"404 response: {response.status_code}")
except:
    pass

# Make a successful request
response = http.get('https://httpbin.org/status/200')
print(f"200 response: {response.status_code}")

# Stats will show both successful and failed
        `
      }, mockContext);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Total requests: 2');
      expect(result.output).toContain('Successful: 1');
      expect(result.output).toContain('Failed: 1');
    }, 15000);
  });

  describe('Complex API Workflows', () => {
    test('should handle multi-step API orchestration', async () => {
      const result = await tool.execute({
        code: `
# Multi-step API workflow example
print("=== Multi-step API Workflow ===")

# Step 1: Get user IP
response1 = http.get('https://httpbin.org/ip')
ip_data = safe_json(response1)
user_ip = ip_data['origin'] if ip_data else 'unknown'
print(f"Step 1 - User IP: {user_ip}")

# Step 2: Get current time
response2 = http.get('https://httpbin.org/json')
time_data = safe_json(response2)
print(f"Step 2 - Got slideshow data: {time_data is not None}")

# Step 3: Simulate API with auth
headers = AuthHelper.bearer_token('fake-token-123')
response3 = http.post('https://httpbin.org/post', 
                     json={'ip': user_ip, 'timestamp': 'now'},
                     headers=headers)

post_result = safe_json(response3)
print(f"Step 3 - POST success: {response3.status_code == 200}")
print(f"Step 3 - Auth header sent: {'Authorization' in post_result.get('headers', {})}")

print("\\n=== Workflow Complete ===")
        `
      }, mockContext);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Multi-step API Workflow');
      expect(result.output).toContain('Step 1 - User IP:');
      expect(result.output).toContain('Step 2 - Got slideshow data: True');
      expect(result.output).toContain('Step 3 - POST success: True');
      expect(result.output).toContain('Step 3 - Auth header sent: True');
      expect(result.output).toContain('Workflow Complete');
      expect(result.output).toContain('Total requests: 3');
    }, 20000);
  });
});