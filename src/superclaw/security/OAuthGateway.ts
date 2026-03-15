/**
 * OAuth Gateway for SuperClaw
 * 
 * Provides TrustClaw-style OAuth management for tool integrations.
 * Features:
 * - Encrypted token storage
 * - Auto-refresh before expiry
 * - Support for major providers
 * - One-click revocation
 * 
 * @author SuperClaw OAuth Team
 * @version 1.0.0
 */

import { createHash, randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import fetch from 'node-fetch';

export interface AuthUrl {
  url: string;
  state: string;
  codeVerifier?: string; // For PKCE
}

export interface Token {
  provider: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scope?: string[];
  tokenType: 'Bearer' | 'Basic';
  metadata?: Record<string, any>;
}

export interface OAuthProvider {
  name: string;
  clientId: string;
  clientSecret?: string; // Optional for PKCE flows
  redirectUri: string;
  authUrl: string;
  tokenUrl: string;
  revokeUrl?: string;
  scopes: string[];
  usePKCE: boolean;
}

export interface StoredToken {
  encrypted: string;
  provider: string;
  createdAt: Date;
  lastRefreshed?: Date;
  metadata?: Record<string, any>;
}

/**
 * OAuth Gateway - Central OAuth management for SuperClaw
 */
export class OAuthGateway {
  private readonly storageDir: string;
  private readonly encryptionKey: Buffer;
  private providers: Map<string, OAuthProvider> = new Map();
  
  constructor(options?: {
    storageDir?: string;
    encryptionKey?: Buffer;
  }) {
    this.storageDir = options?.storageDir || join(homedir(), '.superclaw', 'oauth');
    this.encryptionKey = options?.encryptionKey || this.deriveEncryptionKey();
    this.initializeProviders();
  }

  /**
   * Initialize built-in OAuth providers
   */
  private initializeProviders(): void {
    const providers: OAuthProvider[] = [
      {
        name: 'google',
        clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
        clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
        redirectUri: 'http://localhost:8080/oauth/callback/google',
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        revokeUrl: 'https://oauth2.googleapis.com/revoke',
        scopes: [
          'https://www.googleapis.com/auth/userinfo.profile',
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/gmail.readonly',
          'https://www.googleapis.com/auth/calendar.readonly'
        ],
        usePKCE: false
      },
      {
        name: 'github',
        clientId: process.env.GITHUB_OAUTH_CLIENT_ID || '',
        clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET || '',
        redirectUri: 'http://localhost:8080/oauth/callback/github',
        authUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        scopes: ['read:user', 'user:email', 'repo'],
        usePKCE: false
      },
      {
        name: 'slack',
        clientId: process.env.SLACK_OAUTH_CLIENT_ID || '',
        clientSecret: process.env.SLACK_OAUTH_CLIENT_SECRET || '',
        redirectUri: 'http://localhost:8080/oauth/callback/slack',
        authUrl: 'https://slack.com/oauth/v2/authorize',
        tokenUrl: 'https://slack.com/api/oauth.v2.access',
        revokeUrl: 'https://slack.com/api/auth.revoke',
        scopes: ['channels:read', 'chat:write', 'users:read'],
        usePKCE: false
      },
      {
        name: 'notion',
        clientId: process.env.NOTION_OAUTH_CLIENT_ID || '',
        clientSecret: process.env.NOTION_OAUTH_CLIENT_SECRET || '',
        redirectUri: 'http://localhost:8080/oauth/callback/notion',
        authUrl: 'https://api.notion.com/v1/oauth/authorize',
        tokenUrl: 'https://api.notion.com/v1/oauth/token',
        scopes: ['read_content', 'update_content'],
        usePKCE: true // Notion recommends PKCE
      },
      {
        name: 'discord',
        clientId: process.env.DISCORD_OAUTH_CLIENT_ID || '',
        clientSecret: process.env.DISCORD_OAUTH_CLIENT_SECRET || '',
        redirectUri: 'http://localhost:8080/oauth/callback/discord',
        authUrl: 'https://discord.com/api/oauth2/authorize',
        tokenUrl: 'https://discord.com/api/oauth2/token',
        revokeUrl: 'https://discord.com/api/oauth2/token/revoke',
        scopes: ['identify', 'guilds', 'messages.read'],
        usePKCE: false
      },
      {
        name: 'microsoft',
        clientId: process.env.MICROSOFT_OAUTH_CLIENT_ID || '',
        clientSecret: process.env.MICROSOFT_OAUTH_CLIENT_SECRET || '',
        redirectUri: 'http://localhost:8080/oauth/callback/microsoft',
        authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        revokeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/logout',
        scopes: ['User.Read', 'Mail.Read', 'Calendars.Read'],
        usePKCE: true
      }
    ];

    providers.forEach(provider => {
      this.providers.set(provider.name, provider);
    });
  }

  /**
   * Initiate OAuth flow for a provider
   */
  async initiateAuth(provider: string): Promise<AuthUrl> {
    const providerConfig = this.providers.get(provider);
    if (!providerConfig) {
      throw new Error(`Unsupported provider: ${provider}`);
    }

    if (!providerConfig.clientId) {
      throw new Error(`Missing client ID for provider: ${provider}. Set ${provider.toUpperCase()}_OAUTH_CLIENT_ID environment variable.`);
    }

    const state = this.generateState();
    const params = new URLSearchParams({
      client_id: providerConfig.clientId,
      redirect_uri: providerConfig.redirectUri,
      response_type: 'code',
      state,
      scope: providerConfig.scopes.join(' ')
    });

    let codeVerifier: string | undefined;
    if (providerConfig.usePKCE) {
      codeVerifier = this.generateCodeVerifier();
      const codeChallenge = this.generateCodeChallenge(codeVerifier);
      params.set('code_challenge', codeChallenge);
      params.set('code_challenge_method', 'S256');
    }

    // Store state for verification
    await this.storeState(state, {
      provider,
      codeVerifier,
      timestamp: Date.now()
    });

    return {
      url: `${providerConfig.authUrl}?${params.toString()}`,
      state,
      codeVerifier
    };
  }

  /**
   * Handle OAuth callback and exchange code for token
   */
  async handleCallback(code: string, state: string): Promise<Token> {
    const stateData = await this.verifyState(state);
    const provider = this.providers.get(stateData.provider);
    
    if (!provider) {
      throw new Error(`Invalid provider: ${stateData.provider}`);
    }

    const tokenParams = new URLSearchParams({
      client_id: provider.clientId,
      client_secret: provider.clientSecret || '',
      code,
      grant_type: 'authorization_code',
      redirect_uri: provider.redirectUri
    });

    if (provider.usePKCE && stateData.codeVerifier) {
      tokenParams.set('code_verifier', stateData.codeVerifier);
      // Remove client_secret for PKCE flows
      tokenParams.delete('client_secret');
    }

    const response = await fetch(provider.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: tokenParams
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    const tokenData = await response.json() as any;

    const token: Token = {
      provider: stateData.provider,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      tokenType: tokenData.token_type === 'bearer' ? 'Bearer' : 'Basic',
      scope: tokenData.scope?.split(' '),
      expiresAt: tokenData.expires_in 
        ? new Date(Date.now() + tokenData.expires_in * 1000)
        : undefined,
      metadata: {
        // Store safe metadata only (no sensitive tokens)
        tokenType: tokenData.token_type,
        scope: tokenData.scope,
        expiresIn: tokenData.expires_in
      }
    };

    // Store encrypted token
    await this.storeToken(token);

    // Clean up state
    await this.deleteState(state);

    return token;
  }

  /**
   * Get stored token for provider (auto-refresh if needed)
   */
  async getToken(provider: string): Promise<Token> {
    const token = await this.loadToken(provider);
    
    if (!token) {
      throw new Error(`No token found for provider: ${provider}. Run 'superclaw auth add ${provider}' first.`);
    }

    // Check if token needs refresh
    if (this.needsRefresh(token)) {
      return await this.refreshToken(provider);
    }

    return token;
  }

  /**
   * Refresh token for provider
   */
  async refreshToken(provider: string): Promise<Token> {
    const token = await this.loadToken(provider);
    
    if (!token || !token.refreshToken) {
      throw new Error(`Cannot refresh token for ${provider}: no refresh token available`);
    }

    const providerConfig = this.providers.get(provider);
    if (!providerConfig) {
      throw new Error(`Unsupported provider: ${provider}`);
    }

    const refreshParams = new URLSearchParams({
      client_id: providerConfig.clientId,
      client_secret: providerConfig.clientSecret || '',
      refresh_token: token.refreshToken,
      grant_type: 'refresh_token'
    });

    const response = await fetch(providerConfig.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: refreshParams
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token refresh failed: ${error}`);
    }

    const tokenData = await response.json() as any;

    const refreshedToken: Token = {
      ...token,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || token.refreshToken, // Some providers don't return new refresh token
      expiresAt: tokenData.expires_in 
        ? new Date(Date.now() + tokenData.expires_in * 1000)
        : undefined,
      metadata: {
        ...token.metadata,
        lastRefreshed: new Date(),
        // Store safe metadata only (no sensitive tokens)
        tokenType: tokenData.token_type,
        scope: tokenData.scope,
        expiresIn: tokenData.expires_in
      }
    };

    await this.storeToken(refreshedToken);
    return refreshedToken;
  }

  /**
   * Revoke access for provider
   */
  async revokeAccess(provider: string): Promise<void> {
    const token = await this.loadToken(provider);
    const providerConfig = this.providers.get(provider);
    
    if (!providerConfig) {
      throw new Error(`Unsupported provider: ${provider}`);
    }

    // Revoke with provider if revoke URL is available
    if (providerConfig.revokeUrl && token) {
      try {
        const revokeParams = new URLSearchParams({
          token: token.accessToken
        });

        await fetch(providerConfig.revokeUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Bearer ${token.accessToken}`
          },
          body: revokeParams
        });
      } catch (error: unknown) {
        console.warn(`Failed to revoke token with provider: ${error}`);
      }
    }

    // Always remove local token
    await this.deleteToken(provider);
  }

  /**
   * List all stored providers with their status
   */
  async listProviders(): Promise<Array<{
    provider: string;
    hasToken: boolean;
    expiresAt?: Date;
    scopes?: string[];
  }>> {
    const results = [];
    
    for (const providerName of Array.from(this.providers.keys())) {
      try {
        const token = await this.loadToken(providerName);
        results.push({
          provider: providerName,
          hasToken: !!token,
          expiresAt: token?.expiresAt,
          scopes: token?.scope
        });
      } catch {
        results.push({
          provider: providerName,
          hasToken: false
        });
      }
    }

    return results;
  }

  /**
   * Check if token needs refresh (refresh 5 minutes before expiry)
   */
  private needsRefresh(token: Token): boolean {
    if (!token.expiresAt) {return false;}
    const refreshThreshold = 5 * 60 * 1000; // 5 minutes
    return token.expiresAt.getTime() - Date.now() < refreshThreshold;
  }

  /**
   * Generate secure random state for OAuth flow
   */
  private generateState(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * Generate PKCE code verifier
   */
  private generateCodeVerifier(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * Generate PKCE code challenge from verifier
   */
  private generateCodeChallenge(verifier: string): string {
    return createHash('sha256')
      .update(verifier)
      .digest('base64url');
  }

  /**
   * Derive encryption key from system info (or use provided key)
   */
  private deriveEncryptionKey(): Buffer {
    // In production, this should use a proper key derivation function
    // For now, we'll use a simple approach
    const keyMaterial = process.env.SUPERCLAW_OAUTH_KEY || 
                       `superclaw-oauth-${homedir()}-${process.platform}`;
    return createHash('sha256').update(keyMaterial).digest();
  }

  /**
   * Encrypt token for storage
   */
  private async encryptToken(token: Token): Promise<string> {
    const crypto = await import('crypto');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', this.encryptionKey, iv);
    
    let encrypted = cipher.update(JSON.stringify(token), 'utf8', 'base64');
    encrypted += cipher.final('base64');
    
    return Buffer.concat([iv, Buffer.from(encrypted, 'base64')]).toString('base64');
  }

  /**
   * Decrypt token from storage
   */
  private async decryptToken(encryptedData: string): Promise<Token> {
    const crypto = await import('crypto');
    const data = Buffer.from(encryptedData, 'base64');
    const iv = data.subarray(0, 16);
    const encryptedBuffer = data.subarray(16);
    
    const decipher = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
    let decrypted = decipher.update(encryptedBuffer, undefined, 'utf8');
    decrypted += decipher.final('utf8');
    
    const parsed = JSON.parse(decrypted);
    
    // Convert expiresAt string back to Date object
    if (parsed.expiresAt) {
      parsed.expiresAt = new Date(parsed.expiresAt);
    }
    
    return parsed;
  }

  /**
   * Store encrypted token to disk
   */
  private async storeToken(token: Token): Promise<void> {
    await fs.mkdir(this.storageDir, { recursive: true });
    
    const encrypted = await this.encryptToken(token);
    const storedToken: StoredToken = {
      encrypted,
      provider: token.provider,
      createdAt: new Date(),
      lastRefreshed: token.metadata?.lastRefreshed,
      metadata: token.metadata
    };

    const tokenFile = join(this.storageDir, `${token.provider}.json`);
    await fs.writeFile(tokenFile, JSON.stringify(storedToken, null, 2));
  }

  /**
   * Load and decrypt token from disk
   */
  private async loadToken(provider: string): Promise<Token | null> {
    try {
      const tokenFile = join(this.storageDir, `${provider}.json`);
      const data = await fs.readFile(tokenFile, 'utf-8');
      const storedToken: StoredToken = JSON.parse(data);
      
      return await this.decryptToken(storedToken.encrypted);
    } catch (error: unknown) {
      if ((error as any).code === 'ENOENT') {
        return null; // Token doesn't exist
      }
      throw error;
    }
  }

  /**
   * Delete token from disk
   */
  private async deleteToken(provider: string): Promise<void> {
    try {
      const tokenFile = join(this.storageDir, `${provider}.json`);
      await fs.unlink(tokenFile);
    } catch (error: unknown) {
      if ((error as any).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Store OAuth state temporarily
   */
  private async storeState(state: string, data: any): Promise<void> {
    await fs.mkdir(join(this.storageDir, 'states'), { recursive: true });
    const stateFile = join(this.storageDir, 'states', `${state}.json`);
    await fs.writeFile(stateFile, JSON.stringify({
      ...data,
      expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes
    }));
  }

  /**
   * Verify and retrieve OAuth state
   */
  private async verifyState(state: string): Promise<any> {
    try {
      const stateFile = join(this.storageDir, 'states', `${state}.json`);
      const data = await fs.readFile(stateFile, 'utf-8');
      const stateData = JSON.parse(data);
      
      if (Date.now() > stateData.expiresAt) {
        throw new Error('OAuth state expired');
      }
      
      return stateData;
    } catch (error: unknown) {
      throw new Error(`Invalid OAuth state: ${error}`, { cause: error });
    }
  }

  /**
   * Delete OAuth state
   */
  private async deleteState(state: string): Promise<void> {
    try {
      const stateFile = join(this.storageDir, 'states', `${state}.json`);
      await fs.unlink(stateFile);
    } catch {
      // Ignore errors
    }
  }
}

/**
 * Default OAuth gateway instance
 */
export const oauthGateway = new OAuthGateway();