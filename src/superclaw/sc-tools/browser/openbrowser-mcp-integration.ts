/**
 * OpenBrowser MCP Integration for SuperClaw
 * 
 * This integration provides browser automation using the "CodeAgent pattern" -
 * a single execute_code tool that runs Python code in a persistent namespace
 * with browser automation functions, achieving 3.2x-6x token efficiency
 * compared to traditional multi-tool approaches.
 * 
 * @see https://github.com/billy-enrizky/openbrowser-ai
 */

import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'

export interface OpenBrowserConfig {
  /** Run browser without GUI (default: true) */
  headless?: boolean
  /** Comma-separated domain whitelist (e.g., 'example.com,*.google.com') */
  allowedDomains?: string
  /** Browser viewport width */
  viewportWidth?: number
  /** Browser viewport height */
  viewportHeight?: number
  /** Enable stealth mode to avoid detection */
  stealth?: boolean
  /** Default timeout for operations (ms) */
  timeout?: number
}

export interface ExecuteCodeResult {
  success: boolean
  output?: string
  error?: string
  executionTime?: number
}

export interface MCPMessage {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: any
}

export interface MCPResponse {
  jsonrpc: '2.0'
  id: number
  result?: any
  error?: {
    code: number
    message: string
    data?: any
  }
}

/**
 * OpenBrowser MCP Client for SuperClaw
 * 
 * Manages communication with OpenBrowser MCP server via JSON-RPC over stdio.
 * Provides the single execute_code tool with persistent Python namespace.
 */
export class OpenBrowserMCP extends EventEmitter {
  private process: ChildProcess | null = null
  private messageId = 0
  private pendingRequests = new Map<number, {
    resolve: (value: any) => void
    reject: (error: any) => void
  }>()
  private isInitialized = false
  private config: Required<OpenBrowserConfig>

  constructor(config: OpenBrowserConfig = {}) {
    super()
    
    this.config = {
      headless: true,
      allowedDomains: '',
      viewportWidth: 1920,
      viewportHeight: 1080,
      stealth: false,
      timeout: 30000,
      ...config
    }
  }

  /**
   * Initialize the OpenBrowser MCP server
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {return}

    return new Promise((resolve, reject) => {
      try {
        // Spawn OpenBrowser MCP server
        this.process = spawn('uvx', ['openbrowser-ai[mcp]', '--mcp'], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            OPENBROWSER_HEADLESS: this.config.headless.toString(),
            OPENBROWSER_ALLOWED_DOMAINS: this.config.allowedDomains,
            OPENBROWSER_VIEWPORT_WIDTH: this.config.viewportWidth.toString(),
            OPENBROWSER_VIEWPORT_HEIGHT: this.config.viewportHeight.toString(),
            OPENBROWSER_STEALTH: this.config.stealth.toString(),
            OPENBROWSER_TIMEOUT: this.config.timeout.toString(),
          }
        })

        if (!this.process.stdout || !this.process.stdin || !this.process.stderr) {
          throw new Error('Failed to create MCP server process streams')
        }

        // Handle stdout (JSON-RPC responses)
        let buffer = ''
        this.process.stdout.on('data', (chunk: Buffer) => {
          buffer += chunk.toString()
          
          // Process complete JSON messages
          const lines = buffer.split('\n')
          buffer = lines.pop() || '' // Keep incomplete line in buffer
          
          for (const line of lines) {
            if (line.trim()) {
              try {
                const response: MCPResponse = JSON.parse(line)
                this.handleResponse(response)
              } catch (err) {
                console.error('Failed to parse MCP response:', line, err)
              }
            }
          }
        })

        // Handle stderr (logs, errors)
        this.process.stderr.on('data', (chunk: Buffer) => {
          const message = chunk.toString().trim()
          if (message) {
            console.warn('[OpenBrowser MCP]', message)
          }
        })

        // Handle process exit
        this.process.on('exit', (code) => {
          console.log(`OpenBrowser MCP process exited with code ${code}`)
          this.isInitialized = false
          this.process = null
        })

        // Send initialization request
        this.sendMessage({
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {
              roots: { listChanged: false },
              sampling: {}
            },
            clientInfo: {
              name: 'SuperClaw',
              version: '1.0.0'
            }
          }
        }).then(() => {
          this.isInitialized = true
          resolve()
        }).catch(reject)

      } catch (error: unknown) {
        reject(error)
      }
    })
  }

  /**
   * Execute Python code in the persistent browser automation namespace
   * 
   * Available functions in the namespace:
   * - Navigation: navigate(url), go_back(), wait(seconds)
   * - Interaction: click(index), input_text(index, text), scroll(), send_keys()
   * - JavaScript: evaluate(js_code) - returns Python objects
   * - Data: json, csv, re, datetime, requests, numpy, pandas, matplotlib, BeautifulSoup
   * - Completion: done(text, success=True)
   * 
   * @param code Python code to execute (async functions require await)
   * @returns Execution result with output/error
   */
  async executeCode(code: string): Promise<ExecuteCodeResult> {
    if (!this.isInitialized) {
      await this.initialize()
    }

    const startTime = Date.now()

    try {
      const response = await this.sendMessage({
        method: 'tools/call',
        params: {
          name: 'execute_code',
          arguments: { code }
        }
      })

      const executionTime = Date.now() - startTime

      if (response.isError === false) {
        return {
          success: true,
          output: response.content?.[0]?.text || '',
          executionTime
        }
      } else {
        return {
          success: false,
          error: response.content?.[0]?.text || 'Unknown error',
          executionTime
        }
      }
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error ? (error).message : String(error),
        executionTime: Date.now() - startTime
      }
    }
  }

  /**
   * Get browser state summary (page title, URL, interactive elements)
   */
  async getBrowserState(): Promise<ExecuteCodeResult> {
    return this.executeCode('browser.get_browser_state_summary()')
  }

  /**
   * Navigate to a URL
   */
  async navigate(url: string, newTab = false): Promise<ExecuteCodeResult> {
    return this.executeCode(`await navigate('${url}', new_tab=${newTab})`)
  }

  /**
   * Click an element by index from browser state
   */
  async click(index: number): Promise<ExecuteCodeResult> {
    return this.executeCode(`await click(${index})`)
  }

  /**
   * Type text into an input field
   */
  async inputText(index: number, text: string, clear = true): Promise<ExecuteCodeResult> {
    const escapedText = text.replace(/'/g, "\\'")
    return this.executeCode(`await input_text(${index}, '${escapedText}', clear=${clear})`)
  }

  /**
   * Evaluate JavaScript in the page context
   */
  async evaluate(jsCode: string): Promise<ExecuteCodeResult> {
    const escapedCode = jsCode.replace(/'/g, "\\'").replace(/\n/g, '\\n')
    return this.executeCode(`result = await evaluate('${escapedCode}')\\nprint(result)`)
  }

  /**
   * Extract structured data using JavaScript DOM queries
   */
  async extractData(jsCode: string): Promise<ExecuteCodeResult> {
    return this.executeCode(`
data = await evaluate('''${jsCode}''')
import json
print(json.dumps(data, indent=2))
`)
  }

  /**
   * Mark task as complete
   */
  async complete(message: string, success = true): Promise<ExecuteCodeResult> {
    const escapedMessage = message.replace(/'/g, "\\'")
    return this.executeCode(`await done('${escapedMessage}', success=${success})`)
  }

  /**
   * Shutdown the MCP server
   */
  async shutdown(): Promise<void> {
    if (this.process) {
      this.process.kill()
      this.process = null
      this.isInitialized = false
    }
  }

  private async sendMessage(message: Omit<MCPMessage, 'jsonrpc' | 'id'>): Promise<any> {
    if (!this.process?.stdin) {
      throw new Error('MCP server not initialized')
    }

    const id = ++this.messageId
    const fullMessage: MCPMessage = {
      jsonrpc: '2.0',
      id,
      ...message
    }

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject })
      
      const messageStr = JSON.stringify(fullMessage) + '\n'
      this.process!.stdin!.write(messageStr)
    })
  }

  private handleResponse(response: MCPResponse): void {
    const request = this.pendingRequests.get(response.id)
    if (!request) {return}

    this.pendingRequests.delete(response.id)

    if (response.error) {
      // @ts-expect-error - Post-Merge Reconciliation
      request.reject(new Error(response.error));
    } else {
      request.resolve(response.result);
    }
  }
}

/**
 * SuperClaw Browser Tool using OpenBrowser MCP
 * 
 * This tool demonstrates the "CodeAgent pattern" - instead of multiple
 * granular tools (navigate, click, type, extract), it provides a single
 * execute_code tool that runs Python in a persistent namespace.
 * 
 * Benefits:
 * - 3.2x-6x fewer tokens (returns only extracted data, not full DOM)
 * - More powerful (full programming language vs predefined actions)
 * - Persistent state (variables and browser session persist)
 * - Pre-imported data science libraries (numpy, pandas, matplotlib)
 */
export class SuperClawBrowserTool {
  private mcp: OpenBrowserMCP

  constructor(config?: OpenBrowserConfig) {
    this.mcp = new OpenBrowserMCP(config)
  }

  /**
   * Initialize the browser automation tool
   */
  async initialize(): Promise<void> {
    await this.mcp.initialize()
  }

  /**
   * Execute a browser automation workflow using Python code
   * 
   * Example workflows:
   * 
   * Simple navigation:
   * ```python
   * await navigate('https://example.com')
   * title = await evaluate('document.title')
   * print(f'Page title: {title}')
   * ```
   * 
   * Data extraction:
   * ```python
   * await navigate('https://news.ycombinator.com')
   * stories = await evaluate('''
   *   Array.from(document.querySelectorAll('.titleline > a')).map(a => ({
   *     title: a.textContent,
   *     url: a.href
   *   }))
   * ''')
   * print(f'Found {len(stories)} stories')
   * for story in stories[:5]:
   *     print(f'- {story["title"]}')
   * ```
   * 
   * Form filling:
   * ```python
   * await navigate('https://httpbin.org/forms/post')
   * await input_text(0, 'John Doe')  # Customer name
   * await click(1)  # Medium pizza radio button  
   * await click(4)  # Mushroom checkbox
   * await click(6)  # Submit button
   * print('Form submitted successfully')
   * ```
   */
  async executeWorkflow(pythonCode: string): Promise<{
    success: boolean
    output?: string
    error?: string
    executionTime?: number
  }> {
    return this.mcp.executeCode(pythonCode)
  }

  /**
   * Get current browser state (page info + interactive elements)
   */
  async getBrowserState(): Promise<any> {
    const result = await this.mcp.getBrowserState()
    return result
  }

  /**
   * Simple navigation helper
   */
  async navigate(url: string): Promise<any> {
    return this.mcp.navigate(url)
  }

  /**
   * Extract structured data using JavaScript
   */
  async extractData(jsCode: string): Promise<any> {
    return this.mcp.extractData(jsCode)
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    await this.mcp.shutdown()
  }
}

// Example usage patterns
export const OPENBROWSER_EXAMPLES = {
  // Web scraping with data processing
  scrapeHackerNews: `
await navigate('https://news.ycombinator.com')

# Extract top stories using JavaScript
stories = await evaluate('''
  Array.from(document.querySelectorAll('.titleline > a')).map(a => ({
    title: a.textContent.trim(),
    url: a.href,
    domain: new URL(a.href).hostname
  }))
''')

# Process with Python
import pandas as pd
df = pd.DataFrame(stories[:10])
domain_counts = df['domain'].value_counts()

print(f"Top 10 stories:")
for i, story in enumerate(stories[:10], 1):
    print(f"{i}. {story['title']} ({story['domain']})")

print(f"\\nTop domains: {dict(domain_counts.head(3))}")
`,

  // Form automation
  fillForm: `
await navigate('https://httpbin.org/forms/post')

# Get form state to understand structure
state = browser.get_browser_state_summary()
print("Form elements found:")
for i, elem in enumerate(state.get('interactive_elements', [])):
    print(f"  {i}: {elem.get('tag')} - {elem.get('placeholder', elem.get('text', ''))}")

# Fill form fields
await input_text(0, 'John Doe')  # Customer name
await click(1)  # Medium pizza
await click(4)  # Mushroom topping
await click(6)  # Submit

# Verify submission
result = await evaluate('document.body.textContent')
if 'John Doe' in result and 'medium' in result:
    print("✅ Form submitted successfully!")
else:
    print("❌ Form submission may have failed")
`,

  // Multi-page workflow
  researchWorkflow: `
import json

research_results = []

# Search multiple sources
sources = [
    'https://en.wikipedia.org/wiki/Artificial_intelligence',
    'https://news.ycombinator.com/item?id=1',  # Example
]

for source in sources:
    try:
        await navigate(source)
        await wait(2)  # Let page load
        
        # Extract key information
        if 'wikipedia' in source:
            content = await evaluate('''
              {
                title: document.querySelector('h1').textContent,
                summary: document.querySelector('.mw-parser-output > p').textContent.slice(0, 500),
                sections: Array.from(document.querySelectorAll('h2 .mw-headline')).map(h => h.textContent).slice(0, 5)
              }
            ''')
        else:
            content = await evaluate('''
              {
                title: document.title,
                text: document.body.textContent.slice(0, 500)
              }
            ''')
        
        research_results.append({
            'source': source,
            'content': content,
            'timestamp': datetime.datetime.now().isoformat()
        })
        
        print(f"✅ Processed: {content.get('title', 'Unknown')}")
        
    except Exception as e:
        print(f"❌ Error processing {source}: {e}")

# Save results
with open('research_results.json', 'w') as f:
    json.dump(research_results, f, indent=2)

print(f"\\n📊 Research complete! Processed {len(research_results)} sources")
print("Results saved to research_results.json")
`
}

export default SuperClawBrowserTool