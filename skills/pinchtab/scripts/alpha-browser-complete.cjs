#!/usr/bin/env node

/**
 * Alpha Browser Integration - Complete Solution
 * Combines PinchTab (when available) with fallback browser automation
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

class AlphaBrowserService {
  constructor() {
    this.pinchtabUrl = 'http://localhost:9867';
    this.fallbackInstances = new Map();
    this.tabCounter = 0;
  }

  async checkPinchTabAvailable() {
    try {
      const health = await this.pinchtabRequest('GET', '/health');
      return health.status === 'ok';
    } catch {
      return false;
    }
  }

  async pinchtabRequest(method, path, data = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.pinchtabUrl);
      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: method.toUpperCase(),
        headers: { 'Content-Type': 'application/json' }
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

  async fetchPage(url) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === 'https:' ? https : http;
      
      const req = client.get(url, {
        headers: {
          'User-Agent': 'Alpha-Browser/1.0'
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data
        }));
      });
      
      req.on('error', reject);
      req.setTimeout(10000, () => {
        req.abort();
        reject(new Error('Request timeout'));
      });
    });
  }

  extractTextFromHtml(html) {
    return html
      .replace(/<script[^>]*>.*?<\/script>/gis, '')
      .replace(/<style[^>]*>.*?<\/style>/gis, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&[a-zA-Z]+;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  extractInteractiveElements(html) {
    const elements = [];
    
    // Extract links
    const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      elements.push({
        ref: `e${elements.length + 1}`,
        type: 'link',
        href: match[1],
        text: match[2].trim(),
        role: 'link'
      });
    }
    
    // Extract buttons
    const buttonRegex = /<button[^>]*>([^<]*)<\/button>/gi;
    while ((match = buttonRegex.exec(html)) !== null) {
      elements.push({
        ref: `e${elements.length + 1}`,
        type: 'button',
        text: match[1].trim(),
        role: 'button'
      });
    }
    
    // Extract inputs
    const inputRegex = /<input[^>]*type=["']([^"']*)["'][^>]*>/gi;
    while ((match = inputRegex.exec(html)) !== null) {
      elements.push({
        ref: `e${elements.length + 1}`,
        type: 'input',
        inputType: match[1],
        role: 'textbox'
      });
    }

    return elements;
  }

  async navigate(url, options = {}) {
    const isPinchTabAvailable = await this.checkPinchTabAvailable();
    
    if (isPinchTabAvailable) {
      try {
        // Try PinchTab first
        const result = await this.pinchtabRequest('POST', '/navigate', { url });
        return {
          success: true,
          method: 'pinchtab',
          result: result
        };
      } catch (error) {
        console.warn('PinchTab navigation failed, falling back:', error.message);
      }
    }
    
    // Fallback to direct HTTP fetch
    try {
      const response = await this.fetchPage(url);
      const instanceId = `fallback_${Date.now()}`;
      const tabId = `tab_${++this.tabCounter}`;
      
      this.fallbackInstances.set(instanceId, {
        id: instanceId,
        tabs: new Map([[tabId, {
          id: tabId,
          url: url,
          response: response,
          content: response.body,
          title: this.extractTitle(response.body)
        }]])
      });
      
      return {
        success: true,
        method: 'fallback',
        instanceId: instanceId,
        tabId: tabId,
        statusCode: response.statusCode
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async snapshot(instanceId = null, tabId = null, options = {}) {
    const isPinchTabAvailable = await this.checkPinchTabAvailable();
    
    if (isPinchTabAvailable && !instanceId) {
      try {
        const result = await this.pinchtabRequest('GET', '/snapshot');
        return {
          success: true,
          method: 'pinchtab',
          ...result
        };
      } catch (error) {
        console.warn('PinchTab snapshot failed, falling back:', error.message);
      }
    }
    
    // Fallback snapshot
    if (instanceId && tabId) {
      const instance = this.fallbackInstances.get(instanceId);
      if (!instance) throw new Error('Instance not found');
      
      const tab = instance.tabs.get(tabId);
      if (!tab) throw new Error('Tab not found');
      
      const elements = this.extractInteractiveElements(tab.content);
      
      return {
        success: true,
        method: 'fallback',
        url: tab.url,
        title: tab.title,
        count: elements.length,
        elements: options.interactive ? elements : undefined,
        text: options.textOnly ? this.extractTextFromHtml(tab.content) : undefined
      };
    }
    
    throw new Error('No active tab for snapshot');
  }

  async getText(instanceId = null, tabId = null) {
    const isPinchTabAvailable = await this.checkPinchTabAvailable();
    
    if (isPinchTabAvailable && !instanceId) {
      try {
        const result = await this.pinchtabRequest('GET', '/text');
        return {
          success: true,
          method: 'pinchtab',
          text: result
        };
      } catch (error) {
        console.warn('PinchTab text extraction failed, falling back:', error.message);
      }
    }
    
    // Fallback text extraction
    if (instanceId && tabId) {
      const instance = this.fallbackInstances.get(instanceId);
      if (!instance) throw new Error('Instance not found');
      
      const tab = instance.tabs.get(tabId);
      if (!tab) throw new Error('Tab not found');
      
      return {
        success: true,
        method: 'fallback',
        text: this.extractTextFromHtml(tab.content)
      };
    }
    
    throw new Error('No active tab for text extraction');
  }

  extractTitle(html) {
    const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    return match ? match[1].trim() : 'Untitled';
  }

  async status() {
    const isPinchTabAvailable = await this.checkPinchTabAvailable();
    
    if (isPinchTabAvailable) {
      try {
        const health = await this.pinchtabRequest('GET', '/health');
        return {
          browser: 'pinchtab',
          available: true,
          version: health.version,
          uptime: health.uptime,
          instances: health.instances
        };
      } catch (error) {
        return {
          browser: 'pinchtab',
          available: false,
          error: error.message
        };
      }
    }
    
    return {
      browser: 'fallback',
      available: true,
      instances: this.fallbackInstances.size,
      method: 'http-fetch'
    };
  }

  async instances() {
    const isPinchTabAvailable = await this.checkPinchTabAvailable();
    
    if (isPinchTabAvailable) {
      try {
        return await this.pinchtabRequest('GET', '/instances');
      } catch (error) {
        console.warn('PinchTab instances failed:', error.message);
      }
    }
    
    return Array.from(this.fallbackInstances.values()).map(instance => ({
      id: instance.id,
      status: 'ready',
      tabCount: instance.tabs.size,
      method: 'fallback'
    }));
  }
}

// CLI interface
if (require.main === module) {
  const browser = new AlphaBrowserService();
  
  async function main() {
    const [,, command, ...args] = process.argv;
    
    try {
      switch (command) {
        case 'nav':
        case 'navigate':
          if (args.length < 1) {
            console.error('Usage: nav <url>');
            process.exit(1);
          }
          const navResult = await browser.navigate(args[0]);
          console.log(JSON.stringify(navResult, null, 2));
          break;
          
        case 'snap':
        case 'snapshot':
          const interactive = args.includes('--interactive');
          const textOnly = args.includes('--text-only');
          
          let snapResult;
          if (args.length >= 2 && !args[0].startsWith('--') && !args[1].startsWith('--')) {
            snapResult = await browser.snapshot(args[0], args[1], { interactive, textOnly });
          } else {
            snapResult = await browser.snapshot(null, null, { interactive, textOnly });
          }
          console.log(JSON.stringify(snapResult, null, 2));
          break;
          
        case 'text':
          let textResult;
          if (args.length >= 2) {
            textResult = await browser.getText(args[0], args[1]);
          } else {
            textResult = await browser.getText();
          }
          
          if (textResult.success) {
            console.log(textResult.text);
          } else {
            console.error('Failed to extract text:', textResult.error);
          }
          break;
          
        case 'status':
        case 'health':
          const status = await browser.status();
          console.log(JSON.stringify(status, null, 2));
          break;
          
        case 'instances':
          const instances = await browser.instances();
          console.log(JSON.stringify(instances, null, 2));
          break;
          
        case 'test':
          console.log('🦊 Alpha Browser Integration Test');
          console.log('=================================');
          
          const testStatus = await browser.status();
          console.log(`Browser: ${testStatus.browser} (${testStatus.available ? 'available' : 'unavailable'})`);
          
          console.log('\nTesting navigation to httpbin.org...');
          const testNav = await browser.navigate('https://httpbin.org/html');
          console.log(`Navigation: ${testNav.success ? 'SUCCESS' : 'FAILED'} (${testNav.method})`);
          
          if (testNav.success && testNav.method === 'fallback') {
            console.log('\nTesting snapshot...');
            const testSnap = await browser.snapshot(testNav.instanceId, testNav.tabId, { interactive: true });
            console.log(`Snapshot: ${testSnap.success ? 'SUCCESS' : 'FAILED'} (${testSnap.count} elements)`);
            
            console.log('\nTesting text extraction...');
            const testText = await browser.getText(testNav.instanceId, testNav.tabId);
            const textLength = testText.success ? testText.text.length : 0;
            console.log(`Text extraction: ${testText.success ? 'SUCCESS' : 'FAILED'} (${textLength} chars)`);
          }
          break;
          
        default:
          console.log('🦊 Alpha Browser Integration - Complete Solution');
          console.log('================================================');
          console.log('');
          console.log('Commands:');
          console.log('  nav <url>                 Navigate to URL');
          console.log('  snap [--interactive]      Take page snapshot');
          console.log('  text                      Extract page text');
          console.log('  status                    Check browser status');
          console.log('  instances                 List browser instances');
          console.log('  test                      Run integration test');
          console.log('');
          console.log('Features:');
          console.log('  • Auto-detects PinchTab availability');
          console.log('  • Falls back to HTTP fetch when needed');
          console.log('  • Token-efficient text extraction');
          console.log('  • Interactive element detection');
          console.log('  • Works in any environment');
      }
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  }
  
  main();
}

module.exports = { AlphaBrowserService };