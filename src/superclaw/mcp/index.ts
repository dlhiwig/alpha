/**
 * SuperClaw MCP Federation
 * 
 * Main entry point for the Model Context Protocol (MCP) federation system
 * that enables tool sharing across SuperClaw agents and external systems.
 */

export * from './types';
export * from './tool-registry';
export * from './federation-controller';
export * from './server-wrapper';

// Re-export commonly used functions
export {
  getFederatedToolRegistry,
  FederatedToolRegistry,
} from './tool-registry';

export {
  createMCPFederationController,
  MCPFederationController,
} from './federation-controller';

export {
  wrapSuperClawToolsAsMCPServer,
  createStandaloneMCPServer,
} from './server-wrapper';

// Convenience functions for common use cases

import { createMCPFederationController } from './federation-controller';
import { MCPFederationConfig } from './types';

/**
 * Create a basic MCP federation setup with sensible defaults
 */
export function createBasicMCPFederation(config?: Partial<MCPFederationConfig>) {
  return createMCPFederationController({
    server: {
      port: 8080,
      host: '127.0.0.1',
      name: 'SuperClaw MCP',
      version: '1.0.0',
      maxConnections: 100,
      ...config?.server,
    },
    federation: {
      enableToolSharing: true,
      enableResourceSharing: false,
      shareLocalTools: true,
      maxConcurrentCalls: 25,
      ...config?.federation,
    },
    security: {
      allowedOrigins: ['http://localhost:*', 'ws://localhost:*'],
      requireAuth: false,
      maxRequestsPerMinute: 500,
      allowedTools: [],
      blockedTools: ['shell', 'exec'], // Block dangerous tools by default
      ...config?.security,
    },
    logging: {
      level: 'info',
      enableMetrics: true,
      logRequests: true,
      ...config?.logging,
    },
    ...config,
  });
}

/**
 * Create a secure MCP federation setup for production
 */
export function createSecureMCPFederation(config?: Partial<MCPFederationConfig>) {
  return createMCPFederationController({
    server: {
      port: parseInt(process.env.MCP_PORT || '8443'),
      host: process.env.MCP_HOST || '0.0.0.0',
      name: 'SuperClaw MCP Federation',
      version: '1.0.0',
      maxConnections: 1000,
      ...config?.server,
    },
    auth: {
      type: 'jwt',
      secret: process.env.MCP_JWT_SECRET || (() => {
        throw new Error('MCP_JWT_SECRET environment variable is required for secure mode');
      })(),
      issuer: 'superclaw',
      audience: 'mcp-federation',
      ...config?.auth,
    },
    security: {
      allowedOrigins: process.env.MCP_ALLOWED_ORIGINS?.split(',') || [],
      requireAuth: true,
      maxRequestsPerMinute: 100,
      allowedTools: [], // Explicit allowlist required
      blockedTools: ['shell', 'exec', 'file-write'], // Block dangerous operations
      ...config?.security,
    },
    federation: {
      enableToolSharing: true,
      enableResourceSharing: false,
      shareLocalTools: false, // Require explicit sharing in production
      maxConcurrentCalls: 50,
      ...config?.federation,
    },
    discovery: {
      enabled: true,
      endpoints: process.env.MCP_DISCOVERY_ENDPOINTS?.split(',') || [],
      pollIntervalMs: 300000, // 5 minutes
      timeoutMs: 10000,
      retryCount: 3,
      ...config?.discovery,
    },
    logging: {
      level: 'warn',
      enableMetrics: true,
      logRequests: false, // Don't log requests in production for privacy
      ...config?.logging,
    },
    ...config,
  });
}

/**
 * Quick setup for development/testing
 */
export function createDevelopmentMCPFederation() {
  return createBasicMCPFederation({
    server: {
      port: 8080,
      host: '127.0.0.1',
      name: 'SuperClaw MCP Dev',
      version: '1.0.0',
      maxConnections: 100,
    },
    logging: {
      level: 'debug',
      enableMetrics: true,
      logRequests: true,
    },
    security: {
      allowedOrigins: ['*'],
      requireAuth: false,
      maxRequestsPerMinute: 10000,
      allowedTools: [],
      blockedTools: [],
    },
  });
}