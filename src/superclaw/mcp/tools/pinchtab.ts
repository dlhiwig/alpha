/**
 * PinchTab MCP Tool for SuperClaw
 * 
 * Provides browser automation capabilities to SuperClaw agents via PinchTab HTTP API.
 * Token-efficient (800 tokens/page vs 10K for screenshots), multi-instance, stealth mode.
 * 
 * @see https://pinchtab.com/docs
 */

// TODO: Align with ToolDefinition from registry.ts
// Simplified tool interface for PinchTab (pending full registry integration)
interface Tool {
  name: string;
  description: string;
  execute(...args: any[]): Promise<ToolResult>;
}

interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  tokens?: number;
  duration?: number;
}

interface PinchTabConfig {
  baseUrl: string;
  defaultProfile?: string;
  headless?: boolean;
  timeout?: number;
}

interface PinchTabInstance {
  id: string;
  profile: string;
  port: number;
  tabs: string[];
}

interface SnapshotOptions {
  interactive?: boolean;  // Only clickable elements
  compact?: boolean;      // Minimal output
  filter?: 'all' | 'interactive' | 'text';
}

interface ActionRequest {
  kind: 'click' | 'fill' | 'press' | 'scroll' | 'hover' | 'select';
  ref: string;
  text?: string;
  key?: string;
  direction?: 'up' | 'down';
  amount?: number;
}

const DEFAULT_CONFIG: PinchTabConfig = {
  baseUrl: 'http://localhost:9867',
  defaultProfile: 'superclaw',
  headless: true,
  timeout: 30000,
};

export class PinchTabTool implements Tool {
  name = 'pinchtab';
  description = 'Browser automation for AI agents. Navigate, click, fill forms, extract text. Token-efficient.';
  
  private config: PinchTabConfig;
  private instances: Map<string, PinchTabInstance> = new Map();
  private activeInstance: string | null = null;

  constructor(config: Partial<PinchTabConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Tool schema for MCP registration
   */
  get schema() {
    return {
      name: this.name,
      description: this.description,
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['navigate', 'snapshot', 'click', 'fill', 'press', 'text', 'screenshot', 'create_instance', 'list_instances'],
            description: 'The browser action to perform',
          },
          url: {
            type: 'string',
            description: 'URL to navigate to (for navigate action)',
          },
          ref: {
            type: 'string',
            description: 'Element reference like "e5" (for click/fill/press actions)',
          },
          text: {
            type: 'string',
            description: 'Text to fill (for fill action)',
          },
          key: {
            type: 'string',
            description: 'Key to press like "Enter", "Tab" (for press action)',
          },
          profile: {
            type: 'string',
            description: 'Browser profile name for persistent sessions',
          },
          interactive: {
            type: 'boolean',
            description: 'Only return interactive elements in snapshot',
          },
        },
        required: ['action'],
      },
    };
  }

  /**
   * Execute a PinchTab action
   */
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const { action, ...options } = params;

    try {
      switch (action) {
        case 'navigate':
          return await this.navigate(options.url as string);
        case 'snapshot':
          return await this.snapshot(options as SnapshotOptions);
        case 'click':
          return await this.click(options.ref as string);
        case 'fill':
          return await this.fill(options.ref as string, options.text as string);
        case 'press':
          return await this.press(options.ref as string, options.key as string);
        case 'text':
          return await this.extractText();
        case 'screenshot':
          return await this.screenshot();
        case 'create_instance':
          return await this.createInstance(options.profile as string);
        case 'list_instances':
          return await this.listInstances();
        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  /**
   * Navigate to a URL
   */
  async navigate(url: string): Promise<ToolResult> {
    await this.ensureInstance();
    
    const response = await fetch(`${this.config.baseUrl}/instances/${this.activeInstance}/navigate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    if (!response.ok) {
      throw new Error(`Navigate failed: ${response.statusText}`);
    }

    const result = await response.json() as { tabId: string; title: string };
    return { 
      success: true, 
      data: { url, tabId: result.tabId, title: result.title } 
    };
  }

  /**
   * Get page snapshot (token-efficient DOM representation)
   */
  async snapshot(options: SnapshotOptions = {}): Promise<ToolResult> {
    await this.ensureInstance();
    
    const params = new URLSearchParams();
    if (options.interactive) params.append('filter', 'interactive');
    if (options.compact) params.append('compact', 'true');

    const response = await fetch(
      `${this.config.baseUrl}/instances/${this.activeInstance}/snapshot?${params}`
    );

    if (!response.ok) {
      throw new Error(`Snapshot failed: ${response.statusText}`);
    }

    const snapshot = await response.json();
    return { 
      success: true, 
      data: snapshot,
      tokens: this.estimateTokens(JSON.stringify(snapshot)),
    };
  }

  /**
   * Click an element by reference
   */
  async click(ref: string): Promise<ToolResult> {
    return this.performAction({ kind: 'click', ref });
  }

  /**
   * Fill an input element
   */
  async fill(ref: string, text: string): Promise<ToolResult> {
    return this.performAction({ kind: 'fill', ref, text });
  }

  /**
   * Press a key on an element
   */
  async press(ref: string, key: string): Promise<ToolResult> {
    return this.performAction({ kind: 'press', ref, key });
  }

  /**
   * Extract page text (most token-efficient)
   */
  async extractText(): Promise<ToolResult> {
    await this.ensureInstance();
    
    const response = await fetch(
      `${this.config.baseUrl}/instances/${this.activeInstance}/text`
    );

    if (!response.ok) {
      throw new Error(`Text extraction failed: ${response.statusText}`);
    }

    const text = await response.text();
    return { 
      success: true, 
      data: { text },
      tokens: this.estimateTokens(text),
    };
  }

  /**
   * Take a screenshot (use sparingly - high token cost)
   */
  async screenshot(): Promise<ToolResult> {
    await this.ensureInstance();
    
    const response = await fetch(
      `${this.config.baseUrl}/instances/${this.activeInstance}/screenshot`
    );

    if (!response.ok) {
      throw new Error(`Screenshot failed: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    
    return { 
      success: true, 
      data: { 
        image: `data:image/png;base64,${base64}`,
        warning: 'Screenshots use ~10K tokens. Use text extraction when possible.'
      },
    };
  }

  /**
   * Create a new browser instance with profile
   */
  async createInstance(profile?: string): Promise<ToolResult> {
    const instanceProfile = profile || this.config.defaultProfile || 'default';
    
    const response = await fetch(`${this.config.baseUrl}/instances`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        profile: instanceProfile,
        headless: this.config.headless,
      }),
    });

    if (!response.ok) {
      throw new Error(`Create instance failed: ${response.statusText}`);
    }

    const instance = await response.json() as PinchTabInstance;
    this.instances.set(instance.id, {
      id: instance.id,
      profile: instanceProfile,
      port: instance.port,
      tabs: [],
    });
    this.activeInstance = instance.id;

    return { 
      success: true, 
      data: { instanceId: instance.id, profile: instanceProfile } 
    };
  }

  /**
   * List all browser instances
   */
  async listInstances(): Promise<ToolResult> {
    const response = await fetch(`${this.config.baseUrl}/instances`);
    
    if (!response.ok) {
      throw new Error(`List instances failed: ${response.statusText}`);
    }

    const instances = await response.json();
    return { success: true, data: { instances } };
  }

  // --- Private Helpers ---

  private async ensureInstance(): Promise<void> {
    if (!this.activeInstance) {
      await this.createInstance();
    }
  }

  private async performAction(action: ActionRequest): Promise<ToolResult> {
    await this.ensureInstance();
    
    const response = await fetch(
      `${this.config.baseUrl}/instances/${this.activeInstance}/action`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action),
      }
    );

    if (!response.ok) {
      throw new Error(`Action ${action.kind} failed: ${response.statusText}`);
    }

    const result = await response.json();
    return { success: true, data: result };
  }

  private estimateTokens(text: string): number {
    // Rough estimate: ~4 chars per token
    return Math.ceil(text.length / 4);
  }
}

// Export factory function for MCP registration
export function createPinchTabTool(config?: Partial<PinchTabConfig>): PinchTabTool {
  return new PinchTabTool(config);
}

// Default export for direct import
export default PinchTabTool;
