// @ts-nocheck
/**
 * SuperClaw Tools - Complete Integration
 * 
 * This file exports all tool-related functionality including
 * the new EFRIT execution patterns.
 */

// Core tool system
export * from './registry';
// @ts-expect-error - Post-Merge Reconciliation
export * from './contracts';
export * from './executor';

// EFRIT Patterns
export * from './efrit-patterns';
export * from './efrit-examples';

// Specific tool implementations
export * from './shell';
export * from './web-search';
export * from './web-fetch';
export * from './file-ops';

// API integrations
export * from './api';

// Browser tools
export * from './browser';

// Database tools
export * from './database';

// Filesystem tools
export * from './filesystem';

// OAuth integration
export * from './oauth-integration';

/**
 * Quick setup function for EFRIT-enhanced SuperClaw
 */
export function setupEfritSuperClaw(options: {
  dataDirectory?: string;
  safetyLevel?: 'paranoid' | 'safe' | 'permissive';
  maxToolCalls?: number;
  circuitBreakerThreshold?: number;
} = {}) {
  const { getToolRegistry } = require('./registry');
  const { createEfritEngine } = require('./efrit-patterns');
  
  const registry = getToolRegistry();
  const efrit = createEfritEngine(registry, options.dataDirectory);
  
  // Configure EFRIT engine with options
  if (options.circuitBreakerThreshold) {
    (efrit).circuitBreakerThreshold = options.circuitBreakerThreshold;
  }
  
  return {
    registry,
    efrit,
    
    // Convenience methods
    async createSession(command: string, context: any = {}) {
      return efrit.createSession(command, {
        safetyLevel: options.safetyLevel || 'safe',
        maxToolCalls: options.maxToolCalls || 50,
        ...context
      });
    },
    
    async execute(sessionId: string, command: string, guidance?: string) {
      return efrit.executeNaturalLanguage(sessionId, command, guidance);
    },
    
    getStatus(sessionId: string) {
      return efrit.getSessionStatus(sessionId);
    }
  };
}