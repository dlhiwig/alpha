// @ts-nocheck
/**
 * OAuth Gateway Tests
 * 
 * Test suite for OAuth Gateway functionality including:
 * - OAuth flow initiation
 * - Token storage and encryption
 * - Token refresh logic
 * - Provider management
 * - Security measures
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { OAuthGateway, Token, AuthUrl } from '../OAuthGateway';
import fetch from 'node-fetch';

// Mock fetch for testing
vi.mock('node-fetch');
const mockFetch = vi.mocked(fetch);

describe('OAuthGateway', () => {
  let gateway: OAuthGateway;
  let testStorageDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    // Save original env
    originalEnv = { ...process.env };
    
    // Set up test environment variables
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-google-client-id';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-google-client-secret';
    process.env.GITHUB_OAUTH_CLIENT_ID = 'test-github-client-id';
    process.env.GITHUB_OAUTH_CLIENT_SECRET = 'test-github-client-secret';
    
    // Create temporary storage directory
    testStorageDir = join(tmpdir(), `superclaw-oauth-test-${Date.now()}`);
    await fs.mkdir(testStorageDir, { recursive: true });
    
    // Create gateway instance with test storage
    gateway = new OAuthGateway({
      storageDir: testStorageDir,
      encryptionKey: Buffer.from('test-encryption-key-exactly-32b!')
    });
  });

  afterEach(async () => {
    // Restore original env
    process.env = originalEnv;
    
    // Clean up test storage
    try {
      await fs.rm(testStorageDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    
    vi.clearAllMocks();
  });

  describe('Provider Management', () => {
    it('should list supported providers', async () => {
      const providers = await gateway.listProviders();
      
      expect(providers).toHaveLength(6); // google, github, slack, notion, discord, microsoft
      expect(providers.map(p => p.provider)).toContain('google');
      expect(providers.map(p => p.provider)).toContain('github');
      expect(providers.map(p => p.provider)).toContain('slack');
      expect(providers.map(p => p.provider)).toContain('notion');
      expect(providers.map(p => p.provider)).toContain('discord');
      expect(providers.map(p => p.provider)).toContain('microsoft');
      
      // All should start without tokens
      providers.forEach(provider => {
        expect(provider.hasToken).toBe(false);
      });
    });

    it('should detect missing client configuration', async () => {
      delete process.env.GOOGLE_OAUTH_CLIENT_ID;
      
      const newGateway = new OAuthGateway({
        storageDir: testStorageDir,
        encryptionKey: Buffer.from('test-encryption-key-exactly-32b!')
      });
      
      await expect(newGateway.initiateAuth('google')).rejects.toThrow(
        'Missing client ID for provider: google'
      );
    });
  });

  describe('OAuth Flow Initiation', () => {
    it('should create valid auth URL for Google', async () => {
      const authFlow = await gateway.initiateAuth('google');
      
      expect(authFlow).toHaveProperty('url');
      expect(authFlow).toHaveProperty('state');
      expect(authFlow.url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
      expect(authFlow.url).toContain('client_id=test-google-client-id');
      expect(authFlow.url).toContain('response_type=code');
      expect(authFlow.state).toHaveLength(43); // Base64URL encoded 32 bytes
    });

    it('should create PKCE auth URL for Notion', async () => {
      process.env.NOTION_OAUTH_CLIENT_ID = 'test-notion-client-id';
      
      const newGateway = new OAuthGateway({
        storageDir: testStorageDir,
        encryptionKey: Buffer.from('test-encryption-key-exactly-32b!')
      });
      
      const authFlow = await newGateway.initiateAuth('notion');
      
      expect(authFlow.url).toContain('code_challenge=');
      expect(authFlow.url).toContain('code_challenge_method=S256');
      expect(authFlow.codeVerifier).toBeDefined();
    });

    it('should reject unsupported provider', async () => {
      await expect(gateway.initiateAuth('unsupported')).rejects.toThrow(
        'Unsupported provider: unsupported'
      );
    });
  });

  describe('Token Callback Handling', () => {
    it('should handle successful Google OAuth callback', async () => {
      // Mock successful token response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'test-access-token',
          refresh_token: 'test-refresh-token',
          expires_in: 3600,
          token_type: 'bearer',
          scope: 'email profile'
        })
      } as any);

      // First initiate auth to store state
      const authFlow = await gateway.initiateAuth('google');
      
      // Then handle callback
      const token = await gateway.handleCallback('test-auth-code', authFlow.state);
      
      expect(token.provider).toBe('google');
      expect(token.accessToken).toBe('test-access-token');
      expect(token.refreshToken).toBe('test-refresh-token');
      expect(token.tokenType).toBe('Bearer');
      expect(token.scope).toEqual(['email', 'profile']);
      expect(token.expiresAt).toBeInstanceOf(Date);
    });

    it('should handle token exchange failure', async () => {
      // Mock failed token response
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: async () => 'invalid_request'
      } as any);

      const authFlow = await gateway.initiateAuth('google');
      
      await expect(
        gateway.handleCallback('invalid-code', authFlow.state)
      ).rejects.toThrow('Token exchange failed');
    });

    it('should reject invalid state', async () => {
      await expect(
        gateway.handleCallback('test-code', 'invalid-state')
      ).rejects.toThrow('Invalid OAuth state');
    });
  });

  describe('Token Storage and Retrieval', () => {
    let testToken: Token;

    beforeEach(() => {
      testToken = {
        provider: 'google',
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        tokenType: 'Bearer',
        expiresAt: new Date(Date.now() + 3600 * 1000),
        scope: ['email', 'profile']
      };
    });

    it('should store and retrieve token', async () => {
      // Mock successful token response for callback
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: testToken.accessToken,
          refresh_token: testToken.refreshToken,
          expires_in: 3600,
          token_type: 'bearer',
          scope: testToken.scope?.join(' ')
        })
      } as any);

      const authFlow = await gateway.initiateAuth('google');
      await gateway.handleCallback('test-code', authFlow.state);
      
      const retrievedToken = await gateway.getToken('google');
      
      expect(retrievedToken.provider).toBe(testToken.provider);
      expect(retrievedToken.accessToken).toBe(testToken.accessToken);
      expect(retrievedToken.refreshToken).toBe(testToken.refreshToken);
    });

    it('should throw error for missing token', async () => {
      await expect(gateway.getToken('github')).rejects.toThrow(
        'No token found for provider: github'
      );
    });

    it('should encrypt stored tokens', async () => {
      // Mock successful token response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: testToken.accessToken,
          refresh_token: testToken.refreshToken,
          expires_in: 3600,
          token_type: 'bearer',
          scope: testToken.scope?.join(' ')
        })
      } as any);

      const authFlow = await gateway.initiateAuth('google');
      await gateway.handleCallback('test-code', authFlow.state);
      
      // Check that the stored file doesn't contain plaintext tokens
      const tokenFile = join(testStorageDir, 'google.json');
      const fileContent = await fs.readFile(tokenFile, 'utf-8');
      
      expect(fileContent).not.toContain(testToken.accessToken);
      expect(fileContent).not.toContain(testToken.refreshToken);
      expect(fileContent).toContain('encrypted');
    });
  });

  describe('Token Refresh', () => {
    beforeEach(async () => {
      // Mock initial token response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'initial-access-token',
          refresh_token: 'test-refresh-token',
          expires_in: 3600,
          token_type: 'bearer',
          scope: 'email profile'
        })
      } as any);

      const authFlow = await gateway.initiateAuth('google');
      await gateway.handleCallback('test-code', authFlow.state);
    });

    it('should refresh expired token', async () => {
      // Mock refresh token response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
          token_type: 'bearer'
        })
      } as any);

      const refreshedToken = await gateway.refreshToken('google');
      
      expect(refreshedToken.accessToken).toBe('new-access-token');
      expect(refreshedToken.refreshToken).toBe('new-refresh-token');
      expect(refreshedToken.metadata?.lastRefreshed).toBeInstanceOf(Date);
    });

    it('should handle refresh failure', async () => {
      // Mock failed refresh response
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: async () => 'invalid_grant'
      } as any);

      await expect(gateway.refreshToken('google')).rejects.toThrow(
        'Token refresh failed'
      );
    });

    it('should auto-refresh near-expired token', async () => {
      // Create a token that expires in 1 minute (should trigger refresh)
      const nearExpiredToken: Token = {
        provider: 'google',
        accessToken: 'near-expired-token',
        refreshToken: 'test-refresh-token',
        tokenType: 'Bearer',
        expiresAt: new Date(Date.now() + 60 * 1000) // 1 minute
      };

      // Mock refresh response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'auto-refreshed-token',
          refresh_token: 'test-refresh-token',
          expires_in: 3600,
          token_type: 'bearer'
        })
      } as any);

      // Manually store the near-expired token (simulating storage)
      await fs.writeFile(
        join(testStorageDir, 'google.json'),
        JSON.stringify({
          encrypted: await (gateway as any).encryptToken(nearExpiredToken),
          provider: 'google',
          createdAt: new Date()
        }, null, 2)
      );

      const token = await gateway.getToken('google');
      
      expect(token.accessToken).toBe('auto-refreshed-token');
    });
  });

  describe('Token Revocation', () => {
    beforeEach(async () => {
      // Store a test token
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'test-access-token',
          refresh_token: 'test-refresh-token',
          expires_in: 3600,
          token_type: 'bearer',
          scope: 'email profile'
        })
      } as any);

      const authFlow = await gateway.initiateAuth('google');
      await gateway.handleCallback('test-code', authFlow.state);
    });

    it('should revoke token with provider', async () => {
      // Mock successful revocation response
      mockFetch.mockResolvedValueOnce({
        ok: true
      } as any);

      await gateway.revokeAccess('google');
      
      // Verify revocation was called
      expect(mockFetch).toHaveBeenLastCalledWith(
        'https://oauth2.googleapis.com/revoke',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-access-token'
          })
        })
      );

      // Verify local token was removed
      await expect(gateway.getToken('google')).rejects.toThrow(
        'No token found for provider: google'
      );
    });

    it('should remove local token even if revocation fails', async () => {
      // Mock failed revocation response
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await gateway.revokeAccess('google');
      
      // Local token should still be removed
      await expect(gateway.getToken('google')).rejects.toThrow(
        'No token found for provider: google'
      );
    });
  });

  describe('Security Features', () => {
    it('should use secure random state generation', async () => {
      const authFlow1 = await gateway.initiateAuth('google');
      const authFlow2 = await gateway.initiateAuth('google');
      
      expect(authFlow1.state).not.toBe(authFlow2.state);
      expect(authFlow1.state).toHaveLength(43); // 32 bytes base64url
    });

    it('should enforce state expiration', async () => {
      const authFlow = await gateway.initiateAuth('google');
      
      // Manually expire the state
      const stateFile = join(testStorageDir, 'states', `${authFlow.state}.json`);
      const stateData = JSON.parse(await fs.readFile(stateFile, 'utf-8'));
      stateData.expiresAt = Date.now() - 1000; // 1 second ago
      await fs.writeFile(stateFile, JSON.stringify(stateData));
      
      await expect(
        gateway.handleCallback('test-code', authFlow.state)
      ).rejects.toThrow('OAuth state expired');
    });

    it('should generate valid PKCE code challenge', async () => {
      process.env.NOTION_OAUTH_CLIENT_ID = 'test-notion-client-id';
      
      const newGateway = new OAuthGateway({
        storageDir: testStorageDir
      });
      
      const authFlow = await newGateway.initiateAuth('notion');
      
      expect(authFlow.codeVerifier).toBeDefined();
      expect(authFlow.url).toContain('code_challenge=');
      expect(authFlow.url).toContain('code_challenge_method=S256');
    });
  });

  describe('Provider Status', () => {
    it('should show correct provider status', async () => {
      // Add token for Google
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'test-token',
          expires_in: 3600,
          token_type: 'bearer'
        })
      } as any);

      const authFlow = await gateway.initiateAuth('google');
      await gateway.handleCallback('test-code', authFlow.state);
      
      const providers = await gateway.listProviders();
      const googleProvider = providers.find(p => p.provider === 'google');
      const githubProvider = providers.find(p => p.provider === 'github');
      
      expect(googleProvider?.hasToken).toBe(true);
      expect(googleProvider?.expiresAt).toBeInstanceOf(Date);
      expect(githubProvider?.hasToken).toBe(false);
    });
  });
});