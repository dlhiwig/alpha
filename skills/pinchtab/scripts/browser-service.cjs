#!/usr/bin/env node

/**
 * Alpha PinchTab Browser Service
 * HTTP client for PinchTab browser automation
 */

const http = require('http');

class PinchTabClient {
  constructor(baseUrl = 'http://localhost:9867') {
    this.baseUrl = baseUrl;
  }

  async request(method, path, data = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.baseUrl);
      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: method.toUpperCase(),
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Alpha-PinchTab-Client/1.0'
        }
      };

      if (data) {
        const jsonData = JSON.stringify(data);
        options.headers['Content-Length'] = Buffer.byteLength(jsonData);
      }

      const req = http.request(options, (res) => {
        let responseData = '';
        res.on('data', chunk => responseData += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(responseData);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(result);
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${result.error || responseData}`));
            }
          } catch (e) {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(responseData);
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
            }
          }
        });
      });

      req.on('error', reject);

      if (data) {
        req.write(JSON.stringify(data));
      }
      
      req.end();
    });
  }

  async health() {
    return this.request('GET', '/health');
  }

  async launchInstance(options = {}) {
    const config = {
      mode: 'headless',
      name: 'alpha-browser',
      ...options
    };
    return this.request('POST', '/instances/launch', config);
  }

  async listInstances() {
    return this.request('GET', '/instances');
  }

  async openTab(instanceId, url) {
    return this.request('POST', `/instances/${instanceId}/tabs/open`, { url });
  }

  async navigate(tabId, url) {
    return this.request('POST', `/tabs/${tabId}/navigate`, { url });
  }

  async snapshot(tabId, options = {}) {
    const params = new URLSearchParams();
    if (options.interactive) params.append('filter', 'interactive');
    if (options.text) params.append('format', 'text');
    
    const path = `/tabs/${tabId}/snapshot${params.toString() ? '?' + params : ''}`;
    return this.request('GET', path);
  }

  async action(tabId, actionConfig) {
    return this.request('POST', `/tabs/${tabId}/action`, actionConfig);
  }

  async click(tabId, ref) {
    return this.action(tabId, { kind: 'click', ref });
  }

  async fill(tabId, ref, text) {
    return this.action(tabId, { kind: 'fill', ref, text });
  }

  async type(tabId, ref, text) {
    return this.action(tabId, { kind: 'type', ref, text });
  }

  async press(tabId, ref, key) {
    return this.action(tabId, { kind: 'press', ref, key });
  }

  async screenshot(tabId, options = {}) {
    const params = new URLSearchParams();
    if (options.fullPage) params.append('full', 'true');
    
    const path = `/tabs/${tabId}/screenshot${params.toString() ? '?' + params : ''}`;
    return this.request('GET', path);
  }

  async getText(tabId) {
    return this.request('GET', `/tabs/${tabId}/text`);
  }

  async closeTab(tabId) {
    return this.request('DELETE', `/tabs/${tabId}`);
  }

  async closeInstance(instanceId) {
    return this.request('DELETE', `/instances/${instanceId}`);
  }
}

// CLI interface
if (require.main === module) {
  const client = new PinchTabClient();
  
  async function main() {
    const [,, command, ...args] = process.argv;
    
    try {
      switch (command) {
        case 'health':
          const health = await client.health();
          console.log(JSON.stringify(health, null, 2));
          break;
          
        case 'launch':
          const profile = args[0] || 'default';
          const mode = args[1] || 'headless';
          const instance = await client.launchInstance({ name: profile, mode });
          console.log(`Instance launched: ${instance.id}`);
          break;
          
        case 'instances':
          const instances = await client.listInstances();
          console.log(JSON.stringify(instances, null, 2));
          break;
          
        case 'nav':
          if (args.length < 2) {
            console.error('Usage: nav <instanceId> <url>');
            process.exit(1);
          }
          const [instanceId, url] = args;
          const tab = await client.openTab(instanceId, url);
          console.log(`Tab opened: ${tab.tabId}`);
          break;
          
        case 'snap':
          if (args.length < 1) {
            console.error('Usage: snap <tabId> [--interactive]');
            process.exit(1);
          }
          const tabId = args[0];
          const interactive = args.includes('--interactive');
          const snapshot = await client.snapshot(tabId, { interactive });
          console.log(JSON.stringify(snapshot, null, 2));
          break;
          
        case 'click':
          if (args.length < 2) {
            console.error('Usage: click <tabId> <elementRef>');
            process.exit(1);
          }
          await client.click(args[0], args[1]);
          console.log('Click successful');
          break;
          
        case 'fill':
          if (args.length < 3) {
            console.error('Usage: fill <tabId> <elementRef> <text>');
            process.exit(1);
          }
          await client.fill(args[0], args[1], args[2]);
          console.log('Fill successful');
          break;
          
        case 'text':
          if (args.length < 1) {
            console.error('Usage: text <tabId>');
            process.exit(1);
          }
          const text = await client.getText(args[0]);
          console.log(text);
          break;
          
        default:
          console.log('Alpha PinchTab Browser Service');
          console.log('Commands:');
          console.log('  health                    - Check service status');
          console.log('  launch <profile> <mode>   - Launch browser instance');
          console.log('  instances                 - List active instances');
          console.log('  nav <instanceId> <url>    - Navigate to URL');
          console.log('  snap <tabId> [--interactive] - Take page snapshot');
          console.log('  click <tabId> <ref>       - Click element');
          console.log('  fill <tabId> <ref> <text> - Fill form field');
          console.log('  text <tabId>              - Extract page text');
      }
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  }
  
  main();
}

module.exports = { PinchTabClient };