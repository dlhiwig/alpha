// @ts-nocheck
/**
 * Filesystem Code Agent - Export Module
 * 
 * Single entry point for the Filesystem Code Agent tool
 */

export { default as FilesystemCodeAgent, FILESYSTEM_EXAMPLES } from './code-agent-fs'
export { runFilesystemDemo } from './demo'

// Re-export types for convenience
export type {
  FilesystemCodeAgentConfig,
  ExecutionStats
} from './code-agent-fs'