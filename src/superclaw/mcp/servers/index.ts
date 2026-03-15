/**
 * SuperClaw MCP Server Registry
 * 
 * This file exports all available MCP server configurations for SuperClaw.
 * Each server provides specialized capabilities through the Model Context Protocol.
 */

import openBrowserServerConfig from './openbrowser'

// Export all MCP server configurations
export const MCP_SERVERS = {
  openbrowser: openBrowserServerConfig,
  // Add other MCP servers here as they're implemented
  // filesystem: fileSystemServerConfig,
  // database: databaseServerConfig,
  // api: apiServerConfig,
} as const

// Export individual server configs for direct import
export { openBrowserServerConfig }

// Type definitions
export type MCPServerName = keyof typeof MCP_SERVERS
export type MCPServerConfigs = typeof MCP_SERVERS

/**
 * Get MCP server configuration by name
 */
export function getMCPServerConfig(name: MCPServerName) {
  return MCP_SERVERS[name]
}

/**
 * Get all available MCP server names
 */
export function getAvailableMCPServers(): MCPServerName[] {
  return Object.keys(MCP_SERVERS) as MCPServerName[]
}

/**
 * Get MCP servers by capability tag
 */
export function getMCPServersByTag(tag: string) {
  return Object.entries(MCP_SERVERS)
    .filter(([_, config]) => config.tags?.includes(tag))
    .map(([name, config]) => ({ name: name as MCPServerName, config }))
}

/**
 * Get high-efficiency MCP servers (token optimized)
 */
export function getHighEfficiencyMCPServers() {
  return Object.entries(MCP_SERVERS)
    .filter(([_, config]) => config.performance?.tokenEfficiency === 'extreme')
    .map(([name, config]) => ({ name: name as MCPServerName, config }))
}

export default MCP_SERVERS