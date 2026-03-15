// @ts-nocheck
/**
 * OAuth Tool Integration
 * 
 * Integrates OAuth Gateway with SuperClaw's tool system to provide
 * authenticated API access for tool executions.
 * 
 * Features:
 * - Automatic token injection for authenticated tools
 * - Token refresh during tool execution
 * - Tool-specific OAuth scopes
 * - Secure credential handling
 */

import { oauthGateway, Token } from '../security/OAuthGateway';

export interface AuthenticatedTool {
  name: string;
  provider: string;
  requiredScopes: string[];
  execute(params: any, token: Token): Promise<any>;
}

export interface ToolAuthConfig {
  [toolName: string]: {
    provider: string;
    scopes: string[];
    required: boolean;
  };
}

/**
 * Tool authentication configurations
 */
export const TOOL_AUTH_CONFIG: ToolAuthConfig = {
  'gmail-send': {
    provider: 'google',
    scopes: ['https://www.googleapis.com/auth/gmail.send'],
    required: true
  },
  'gmail-read': {
    provider: 'google',
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    required: true
  },
  'google-calendar': {
    provider: 'google',
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    required: true
  },
  'github-repo': {
    provider: 'github',
    scopes: ['repo'],
    required: true
  },
  'github-user': {
    provider: 'github',
    scopes: ['read:user', 'user:email'],
    required: true
  },
  'slack-message': {
    provider: 'slack',
    scopes: ['chat:write', 'channels:read'],
    required: true
  },
  'slack-files': {
    provider: 'slack',
    scopes: ['files:write', 'files:read'],
    required: true
  },
  'notion-pages': {
    provider: 'notion',
    scopes: ['read_content', 'update_content'],
    required: true
  },
  'discord-webhook': {
    provider: 'discord',
    scopes: ['webhook.incoming'],
    required: false // Can work with webhook URLs
  },
  'microsoft-outlook': {
    provider: 'microsoft',
    scopes: ['Mail.Send', 'Mail.Read'],
    required: true
  },
  'microsoft-calendar': {
    provider: 'microsoft',
    scopes: ['Calendars.ReadWrite'],
    required: true
  }
};

/**
 * OAuth Tool Middleware
 * Handles token injection and refresh for authenticated tools
 */
export class OAuthToolMiddleware {
  /**
   * Execute tool with OAuth authentication
   */
  async executeWithAuth(
    toolName: string,
    params: any,
    toolFunction: (params: any, token?: Token) => Promise<any>
  ): Promise<any> {
    const authConfig = TOOL_AUTH_CONFIG[toolName];
    
    if (!authConfig) {
      // Tool doesn't require OAuth, execute normally
      return await toolFunction(params);
    }
    
    try {
      // Get OAuth token for the provider
      const token = await oauthGateway.getToken(authConfig.provider);
      
      // Validate token has required scopes
      if (authConfig.scopes.length > 0) {
        const hasRequiredScopes = authConfig.scopes.every(scope => 
          token.scope?.includes(scope)
        );
        
        if (!hasRequiredScopes) {
          throw new Error(
            `Token for ${authConfig.provider} missing required scopes: ${authConfig.scopes.join(', ')}`
          );
        }
      }
      
      // Execute tool with authenticated token
      return await toolFunction(params, token);
      
    } catch (error: unknown) {
      if (authConfig.required) {
        throw new Error(
          `Authentication required for tool '${toolName}': ${error}. ` +
          `Run 'superclaw auth add ${authConfig.provider}' to authenticate.`, { cause: error }
        );
      }
      
      // Optional auth failed, execute without token
      console.warn(`Optional OAuth for ${toolName} failed: ${error}`);
      return await toolFunction(params);
    }
  }
  
  /**
   * Check if tool has valid authentication
   */
  async checkToolAuth(toolName: string): Promise<{
    hasAuth: boolean;
    provider?: string;
    scopes?: string[];
    expiresAt?: Date;
    required: boolean;
  }> {
    const authConfig = TOOL_AUTH_CONFIG[toolName];
    
    if (!authConfig) {
      return { hasAuth: false, required: false };
    }
    
    try {
      const token = await oauthGateway.getToken(authConfig.provider);
      return {
        hasAuth: true,
        provider: authConfig.provider,
        scopes: token.scope,
        expiresAt: token.expiresAt,
        required: authConfig.required
      };
    } catch {
      return {
        hasAuth: false,
        provider: authConfig.provider,
        required: authConfig.required
      };
    }
  }
  
  /**
   * Get authentication status for all tools
   */
  async getToolAuthStatus(): Promise<Array<{
    toolName: string;
    hasAuth: boolean;
    provider?: string;
    required: boolean;
    expiresAt?: Date;
    scopes?: string[];
  }>> {
    const results = [];
    
    for (const [toolName, authConfig] of Object.entries(TOOL_AUTH_CONFIG)) {
      const status = await this.checkToolAuth(toolName);
      results.push({
        toolName,
        ...status
      });
    }
    
    return results;
  }
  
  /**
   * Ensure all required tool authentications are available
   */
  async validateRequiredAuth(): Promise<{
    valid: boolean;
    missingAuth: string[];
    expiringSoon: string[];
  }> {
    const missingAuth: string[] = [];
    const expiringSoon: string[] = [];
    const now = Date.now();
    const warningThreshold = 24 * 60 * 60 * 1000; // 24 hours
    
    for (const [toolName, authConfig] of Object.entries(TOOL_AUTH_CONFIG)) {
      if (!authConfig.required) {continue;}
      
      try {
        const token = await oauthGateway.getToken(authConfig.provider);
        
        if (token.expiresAt) {
          const timeUntilExpiry = token.expiresAt.getTime() - now;
          if (timeUntilExpiry < warningThreshold) {
            expiringSoon.push(`${toolName} (${authConfig.provider})`);
          }
        }
      } catch {
        missingAuth.push(`${toolName} (${authConfig.provider})`);
      }
    }
    
    return {
      valid: missingAuth.length === 0,
      missingAuth,
      expiringSoon
    };
  }
}

/**
 * Example authenticated tool implementations
 */
export class AuthenticatedTools {
  private middleware = new OAuthToolMiddleware();
  
  /**
   * Send email via Gmail API
   */
  async sendGmail(params: {
    to: string;
    subject: string;
    body: string;
    html?: boolean;
  }): Promise<any> {
    return this.middleware.executeWithAuth(
      'gmail-send',
      params,
      async (params, token) => {
        if (!token) {
          throw new Error('OAuth token required for Gmail');
        }
        
        const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token.accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            raw: this.createEmailMessage(params)
          })
        });
        
        if (!response.ok) {
          throw new Error(`Gmail API error: ${response.status}`);
        }
        
        return await response.json();
      }
    );
  }
  
  /**
   * Read GitHub repository information
   */
  async getGitHubRepo(params: {
    owner: string;
    repo: string;
  }): Promise<any> {
    return this.middleware.executeWithAuth(
      'github-repo',
      params,
      async (params, token) => {
        if (!token) {
          throw new Error('OAuth token required for GitHub');
        }
        
        const response = await fetch(
          `https://api.github.com/repos/${params.owner}/${params.repo}`,
          {
            headers: {
              'Authorization': `Bearer ${token.accessToken}`,
              'Accept': 'application/vnd.github.v3+json'
            }
          }
        );
        
        if (!response.ok) {
          throw new Error(`GitHub API error: ${response.status}`);
        }
        
        return await response.json();
      }
    );
  }
  
  /**
   * Send Slack message
   */
  async sendSlackMessage(params: {
    channel: string;
    text: string;
    blocks?: any[];
  }): Promise<any> {
    return this.middleware.executeWithAuth(
      'slack-message',
      params,
      async (params, token) => {
        if (!token) {
          throw new Error('OAuth token required for Slack');
        }
        
        const response = await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token.accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(params)
        });
        
        if (!response.ok) {
          throw new Error(`Slack API error: ${response.status}`);
        }
        
        return await response.json();
      }
    );
  }
  
  /**
   * Create email message in RFC2822 format
   */
  private createEmailMessage(params: {
    to: string;
    subject: string;
    body: string;
    html?: boolean;
  }): string {
    const message = [
      `To: ${params.to}`,
      `Subject: ${params.subject}`,
      `Content-Type: ${params.html ? 'text/html' : 'text/plain'}; charset=utf-8`,
      '',
      params.body
    ].join('\n');
    
    return Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  }
}

/**
 * Global OAuth tool middleware instance
 */
export const oauthToolMiddleware = new OAuthToolMiddleware();

/**
 * Global authenticated tools instance
 */
export const authenticatedTools = new AuthenticatedTools();

/**
 * Utility function to check if a tool requires OAuth
 */
export function requiresOAuth(toolName: string): boolean {
  return toolName in TOOL_AUTH_CONFIG;
}

/**
 * Utility function to get OAuth provider for a tool
 */
export function getToolProvider(toolName: string): string | null {
  const config = TOOL_AUTH_CONFIG[toolName];
  return config?.provider || null;
}

/**
 * Utility function to get required scopes for a tool
 */
export function getToolScopes(toolName: string): string[] {
  const config = TOOL_AUTH_CONFIG[toolName];
  return config?.scopes || [];
}