#!/usr/bin/env node

/**
 * Alpha Browser Automation - Puppeteer Fallback
 * Simple browser automation when PinchTab Chrome config fails
 */

const { spawn } = require('child_process');
const http = require('http');
const { URL } = require('url');

class SimpleBrowserClient {
  constructor() {
    this.instances = new Map();
    this.tabCounter = 0;
  }

  async launchSimpleHeadless() {
    // Try to use node puppeteer-like functionality
    const instanceId = 'simple_' + Date.now();
    
    // For now, create a mock instance that can do basic operations
    this.instances.set(instanceId, {
      id: instanceId,
      status: 'ready',
      tabs: new Map()
    });
    
    return { id: instanceId };
  }

  async mockNavigate(instanceId, url) {
    const tabId = 'tab_' + (++this.tabCounter);
    
    // Simulate navigation with web fetch
    try {
      const response = await this.fetchPage(url);
      const instance = this.instances.get(instanceId);
      
      if (instance) {
        instance.tabs.set(tabId, {
          id: tabId,
          url: url,
          content: response,
          title: this.extractTitle(response),
          ready: true
        });
      }
      
      return { tabId, status: 'ready' };
    } catch (error) {
      throw new Error(`Navigation failed: ${error.message}`);
    }
  }

  async fetchPage(url) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === 'https:' ? require('https') : require('http');
      
      const req = client.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      });
      
      req.on('error', reject);
      req.setTimeout(10000, () => {
        req.abort();
        reject(new Error('Request timeout'));
      });
    });
  }

  extractTitle(html) {
    const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    return match ? match[1].trim() : 'Untitled';
  }

  extractText(html) {
    // Simple HTML to text conversion
    return html
      .replace(/<script[^>]*>.*?<\/script>/gis, '')
      .replace(/<style[^>]*>.*?<\/style>/gis, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async getTabText(instanceId, tabId) {
    const instance = this.instances.get(instanceId);
    if (!instance) throw new Error('Instance not found');
    
    const tab = instance.tabs.get(tabId);
    if (!tab) throw new Error('Tab not found');
    
    return this.extractText(tab.content);
  }

  async getTabSnapshot(instanceId, tabId) {
    const instance = this.instances.get(instanceId);
    if (!instance) throw new Error('Instance not found');
    
    const tab = instance.tabs.get(tabId);
    if (!tab) throw new Error('Tab not found');
    
    // Mock interactive elements detection
    const interactiveElements = [];
    const content = tab.content;
    
    // Find links
    const linkMatches = content.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi);
    for (const match of linkMatches) {
      interactiveElements.push({
        ref: `e${interactiveElements.length + 1}`,
        type: 'link',
        href: match[1],
        text: match[2].trim(),
        role: 'link'
      });
    }
    
    // Find buttons
    const buttonMatches = content.matchAll(/<button[^>]*>([^<]*)<\/button>/gi);
    for (const match of buttonMatches) {
      interactiveElements.push({
        ref: `e${interactiveElements.length + 1}`,
        type: 'button', 
        text: match[1].trim(),
        role: 'button'
      });
    }
    
    return {
      url: tab.url,
      title: tab.title,
      count: interactiveElements.length,
      elements: interactiveElements
    };
  }

  listInstances() {
    return Array.from(this.instances.values()).map(instance => ({
      id: instance.id,
      status: instance.status,
      tabCount: instance.tabs.size
    }));
  }
}

// CLI interface
if (require.main === module) {
  const client = new SimpleBrowserClient();
  
  async function main() {
    const [,, command, ...args] = process.argv;
    
    try {
      switch (command) {
        case 'launch':
          const instance = await client.launchSimpleHeadless();
          console.log(`Simple browser instance: ${instance.id}`);
          break;
          
        case 'nav':
          if (args.length < 2) {
            console.error('Usage: nav <instanceId> <url>');
            process.exit(1);
          }
          const result = await client.mockNavigate(args[0], args[1]);
          console.log(`Navigation complete: ${result.tabId}`);
          break;
          
        case 'text':
          if (args.length < 2) {
            console.error('Usage: text <instanceId> <tabId>');
            process.exit(1);
          }
          const text = await client.getTabText(args[0], args[1]);
          console.log(text.substring(0, 1000) + '...');
          break;
          
        case 'snap':
          if (args.length < 2) {
            console.error('Usage: snap <instanceId> <tabId>');
            process.exit(1);
          }
          const snapshot = await client.getTabSnapshot(args[0], args[1]);
          console.log(JSON.stringify(snapshot, null, 2));
          break;
          
        case 'instances':
          const instances = client.listInstances();
          console.log(JSON.stringify(instances, null, 2));
          break;
          
        case 'test':
          console.log('🦊 Alpha Simple Browser Test');
          const testInstance = await client.launchSimpleHeadless();
          console.log(`Instance: ${testInstance.id}`);
          
          const navResult = await client.mockNavigate(testInstance.id, 'https://httpbin.org/html');
          console.log(`Tab: ${navResult.tabId}`);
          
          const textContent = await client.getTabText(testInstance.id, navResult.tabId);
          console.log(`Text length: ${textContent.length} characters`);
          
          const snapshotData = await client.getTabSnapshot(testInstance.id, navResult.tabId);
          console.log(`Interactive elements: ${snapshotData.count}`);
          break;
          
        default:
          console.log('Alpha Simple Browser - Fallback Mode');
          console.log('Commands:');
          console.log('  launch                    - Create browser instance');
          console.log('  nav <instance> <url>      - Navigate to URL');  
          console.log('  text <instance> <tab>     - Extract page text');
          console.log('  snap <instance> <tab>     - Get page structure');
          console.log('  instances                 - List instances');
          console.log('  test                      - Run integration test');
      }
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  }
  
  main();
}

module.exports = { SimpleBrowserClient };