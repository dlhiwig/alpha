/**
 * Maton SaaS Integration for SuperClaw
 * 
 * Provides natural language access to 100+ SaaS tools via Maton.ai's
 * managed OAuth gateway. Enables SuperClaw agents to interact with:
 * 
 * - Google Workspace (Gmail, Calendar, Drive, Sheets, Docs)
 * - Slack, HubSpot, Salesforce, Stripe
 * - Notion, Airtable, Jira, Asana
 * - And 50+ more platforms
 * 
 * @see https://github.com/maton-ai/agent-toolkit
 * @see https://maton.ai/docs/api-reference
 */

const MATON_API_BASE = 'https://api.maton.ai';
const MATON_GATEWAY_BASE = 'https://gateway.maton.ai';

export interface MatonConfig {
  apiKey: string;
}

export interface ActionResult {
  success: boolean;
  data?: any;
  error?: string;
  app: string;
  action: string;
}

export interface Connection {
  id: string;
  app: string;
  status: 'active' | 'pending' | 'expired';
  createdAt: string;
}

/**
 * Available SaaS Apps and their actions
 */
export const SUPPORTED_APPS = {
  // Google Workspace
  'google-mail': ['send-email', 'find-email', 'create-draft', 'list-labels', 'add-label-to-email', 'remove-label-from-email'],
  'google-calendar': ['list-events', 'create-event', 'update-event', 'delete-event', 'get-event', 'list-calendars'],
  'google-drive': ['list-files', 'create-file', 'create-folder', 'delete-file', 'find-file', 'get-file'],
  'google-sheets': ['get-spreadsheet', 'add-multiple-rows', 'update-row', 'find-row', 'create-spreadsheet'],
  'google-docs': ['get-document', 'create-document', 'append-text', 'find-document'],
  
  // CRM & Sales
  'hubspot': ['list-contacts', 'create-contact', 'update-contact', 'search-contacts', 'list-deals', 'create-deal'],
  'salesforce': ['list-contacts', 'create-contact', 'get-contact'],
  'pipedrive': ['search-people'],
  
  // Communication
  'slack': ['list-channels', 'send-message', 'list-messages', 'list-replies'],
  'outlook': ['send-email', 'find-email', 'create-draft'],
  
  // Project Management
  'jira': ['list-issues', 'get-issue', 'add-comment-to-issue', 'list-projects'],
  'asana': ['list-tasks', 'create-task', 'get-task', 'list-projects', 'list-workspaces'],
  'clickup': ['list-tasks', 'create-task', 'delete-task', 'list-spaces', 'list-folders'],
  'notion': ['get-page', 'create-page', 'find-page'],
  
  // Data & Analytics
  'airtable': ['list-bases', 'list-tables', 'list-records'],
  'stripe': ['list-customers', 'create-customer', 'list-invoices', 'create-invoice'],
  
  // E-commerce
  'shopify': ['list-orders', 'get-order', 'create-order'],
  
  // Marketing
  'mailchimp': ['get-campaign', 'search-campaign'],
  'klaviyo': ['get-campaigns', 'create-campaign', 'send-campaign', 'get-profiles', 'create-profile'],
  
  // Scheduling
  'calendly': ['list-events', 'get-event', 'list-event-types', 'list-event-invitees'],
  
  // Cloud
  'aws': ['list-s3-buckets', 'list-s3-objects', 'get-s3-object'],
  
  // Firebase (we already use this)
  'firebase': ['list-projects', 'create-web-app', 'get-app-config'],
  
  // Media
  'youtube': ['list-videos', 'search-videos'],
} as const;

export type AppName = keyof typeof SUPPORTED_APPS;

/**
 * MatonSaaS - SuperClaw's SaaS Integration Layer
 * 
 * Provides two modes:
 * 1. Action Mode: Call specific API actions with structured parameters
 * 2. Agent Mode: Natural language prompts handled by Maton's agent
 */
export class MatonSaaS {
  private apiKey: string;
  private headers: Record<string, string>;
  
  constructor(config: MatonConfig) {
    this.apiKey = config.apiKey;
    this.headers = {
      'x-api-key': this.apiKey,
      'Content-Type': 'application/json',
    };
  }
  
  // ==========================================
  // CONNECTION MANAGEMENT
  // ==========================================
  
  /**
   * List all connected apps
   */
  async listConnections(app?: string): Promise<Connection[]> {
    const res = await fetch(`${MATON_API_BASE}/list-connections`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ app }),
    });
    const data: any = await res.json();
    return data.connections || [];
  }
  
  /**
   * Start OAuth flow for an app
   */
  async createConnection(app: AppName): Promise<{ authUrl: string; connectionId: string }> {
    const res = await fetch(`${MATON_API_BASE}/create-connection`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ app }),
    });
    return (await res.json()) as { authUrl: string; connectionId: string };
  }
  
  /**
   * Check connection status
   */
  async getConnection(connectionId: string): Promise<Connection> {
    const res = await fetch(`${MATON_API_BASE}/get-connection`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ connection_id: connectionId }),
    });
    return (await res.json()) as Connection;
  }
  
  // ==========================================
  // ACTION MODE - Structured API calls
  // ==========================================
  
  /**
   * Invoke a specific action on an app
   * 
   * @example
   * await maton.invokeAction('google-mail', 'send-email', {
   *   to: 'user@example.com',
   *   subject: 'Hello',
   *   body: 'World'
   * });
   */
  async invokeAction(app: AppName, action: string, args: Record<string, any>): Promise<ActionResult> {
    try {
      const res = await fetch(`${MATON_API_BASE}/invoke-action`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ app, action, args }),
      });
      
      const data: any = await res.json();
      
      return {
        success: !data.error,
        data: data.result || data,
        error: data.error || data.message,
        app,
        action,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message,
        app,
        action,
      };
    }
  }
  
  // ==========================================
  // AGENT MODE - Natural language
  // ==========================================
  
  /**
   * Send a natural language prompt to app-specific agent
   * 
   * @example
   * await maton.invokeAgent('hubspot', 'Find all contacts from Acme Corp');
   */
  async invokeAgent(app: AppName, prompt: string): Promise<ActionResult> {
    try {
      const res = await fetch(`${MATON_API_BASE}/invoke-agent`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ app, user_prompt: prompt }),
      });
      
      const data: any = await res.json();
      
      return {
        success: !data.error,
        data: data.result || data,
        error: data.error,
        app,
        action: 'agent',
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message,
        app,
        action: 'agent',
      };
    }
  }
  
  // ==========================================
  // GATEWAY MODE - Direct API proxy
  // ==========================================
  
  /**
   * Call any native API endpoint through Maton gateway
   * Maton handles OAuth token injection
   * 
   * @example
   * // Firebase
   * await maton.gateway('firebase', '/v1beta1/projects');
   * 
   * // Gmail
   * await maton.gateway('google-mail', '/gmail/v1/users/me/messages');
   */
  async gateway(app: string, path: string, options: RequestInit = {}): Promise<any> {
    const url = `${MATON_GATEWAY_BASE}/${app}${path}`;
    
    const res = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        ...options.headers,
      },
    });
    
    return res.json();
  }
  
  // ==========================================
  // SUPERCLAW TOOL DEFINITIONS
  // ==========================================
  
  /**
   * Generate tool definitions for SuperClaw swarm agents
   * These can be passed to LLMs as available functions
   */
  getToolDefinitions(): Array<{
    name: string;
    description: string;
    parameters: Record<string, any>;
  }> {
    const tools: Array<{ name: string; description: string; parameters: Record<string, any> }> = [];
    
    for (const [app, actions] of Object.entries(SUPPORTED_APPS)) {
      for (const action of actions) {
        tools.push({
          name: `maton_${app.replace(/-/g, '_')}_${action.replace(/-/g, '_')}`,
          description: `${action.replace(/-/g, ' ')} in ${app.replace(/-/g, ' ')}`,
          parameters: {
            type: 'object',
            properties: {
              args: {
                type: 'object',
                description: `Arguments for ${app}.${action}`,
              },
            },
            required: ['args'],
          },
        });
      }
    }
    
    // Add agent mode tool
    tools.push({
      name: 'maton_agent',
      description: 'Send a natural language prompt to any connected SaaS app',
      parameters: {
        type: 'object',
        properties: {
          app: {
            type: 'string',
            enum: Object.keys(SUPPORTED_APPS),
            description: 'The app to interact with',
          },
          prompt: {
            type: 'string',
            description: 'Natural language instruction',
          },
        },
        required: ['app', 'prompt'],
      },
    });
    
    return tools;
  }
  
  /**
   * Execute a tool call from an LLM
   */
  async executeTool(toolName: string, args: Record<string, any>): Promise<ActionResult> {
    if (toolName === 'maton_agent') {
      return this.invokeAgent(args.app, args.prompt);
    }
    
    // Parse tool name: maton_google_mail_send_email -> google-mail, send-email
    const parts = toolName.replace('maton_', '').split('_');
    
    // Reconstruct app name (handle multi-word apps like google_mail)
    let app = '';
    let actionParts: string[] = [];
    let foundApp = false;
    
    for (const part of parts) {
      if (!foundApp) {
        const testApp = app ? `${app}-${part}` : part;
        if (SUPPORTED_APPS[testApp as AppName]) {
          app = testApp;
          foundApp = true;
        } else if (!app) {
          app = part;
        } else {
          app = testApp;
        }
      } else {
        actionParts.push(part);
      }
    }
    
    const action = actionParts.join('-');
    
    return this.invokeAction(app as AppName, action, args.args || args);
  }
}

// ==========================================
// CONVENIENCE EXPORTS
// ==========================================

/**
 * Pre-configured instance using environment variable
 */
export function createMatonClient(): MatonSaaS {
  const apiKey = process.env.MATON_API_KEY;
  if (!apiKey) {
    throw new Error('MATON_API_KEY environment variable is required');
  }
  return new MatonSaaS({ apiKey });
}

// CLI test
if (require.main === module) {
  (async () => {
    const maton = createMatonClient();
    
    console.log('Testing Maton SaaS integration...\n');
    
    // List connections
    console.log('1. Listing connections:');
    const connections = await maton.listConnections();
    console.log(connections);
    
    // Test Firebase (we know this works)
    console.log('\n2. Testing Firebase gateway:');
    const projects = await maton.gateway('firebase', '/v1beta1/projects');
    console.log(projects);
    
    // Generate tool definitions
    console.log('\n3. Tool definitions count:', maton.getToolDefinitions().length);
  })();
}
