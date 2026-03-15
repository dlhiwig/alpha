/**
 * Agent memory types for Dolt-backed persistent memory system
 * 
 * This module defines the core types for SuperClaw's memory management system,
 * enabling agents to store, retrieve, and maintain persistent memories with
 * automatic compaction and relationship tracking.
 * 
 * @fileoverview TypeScript definitions for agent memory system
 * @version 1.0.0
 */

/**
 * Core agent memory record representing a single memory entry
 */
export interface AgentMemory {
  /** Unique identifier for this memory */
  id: string
  
  /** ID of the agent that owns this memory */
  agentId: string
  
  /** Human-readable title/summary of the memory */
  title: string
  
  /** Detailed description or content of the memory */
  description: string
  
  /** Alias for description (for backward compatibility) */
  content: string
  
  /** Category/type of memory for organization and querying */
  type: MemoryType
  
  /** Current lifecycle status of the memory */
  status: MemoryStatus
  
  /** Number of times this memory has been compacted (0 = original) */
  compactionLevel: number
  
  /** Original size in characters before any compaction (optional) */
  originalSize?: number
  
  /** Timestamp when this memory was last compacted (optional) */
  compactedAt?: Date
  
  /** Flexible key-value store for additional memory attributes */
  metadata: Record<string, any>
  
  /** Timestamp when this memory was first created */
  createdAt: Date
  
  /** Timestamp when this memory was last modified */
  updatedAt: Date
}

/**
 * Classification of memory types for organization and retrieval
 * 
 * - `learning`: Knowledge gained from experiences or training
 * - `context`: Situational information and environmental state
 * - `capability`: Skills, tools, or abilities the agent has acquired
 * - `relationship`: Information about connections to other agents/entities
 * - `decision`: Past decisions and their outcomes for learning
 */
export type MemoryType = 'learning' | 'context' | 'capability' | 'relationship' | 'decision'

/**
 * Lifecycle status of memories for management and cleanup
 * 
 * - `active`: Currently relevant and frequently accessed
 * - `archived`: Older but preserved memories
 * - `compacted`: Compressed memories to save storage space
 */
export type MemoryStatus = 'active' | 'archived' | 'compacted'

/**
 * Relationship between two memories, enabling knowledge graphs
 */
export interface MemoryRelationship {
  /** ID of the source memory in the relationship */
  sourceId: string
  
  /** ID of the target memory in the relationship */
  targetId: string
  
  /** Type/nature of the relationship between memories */
  type: RelationshipType
  
  /** Additional context about this specific relationship */
  metadata: Record<string, any>
  
  /** Timestamp when this relationship was established */
  createdAt: Date
}

/**
 * Types of relationships between memories for knowledge graphs
 * 
 * - `builds-on`: Target memory extends or builds upon source memory
 * - `conflicts-with`: Target memory contradicts or conflicts with source
 * - `validates`: Target memory confirms or validates source memory
 * - `supercedes`: Target memory replaces or supersedes source memory
 * - `relates-to`: General relationship between memories
 * - `contradicts`: Memory contradicts or conflicts with another
 */
export type RelationshipType = 'builds-on' | 'conflicts-with' | 'validates' | 'supercedes' | 'relates-to' | 'contradicts'

/**
 * Query parameters for searching and filtering memories
 */
export interface MemoryQuery {
  /** Filter memories by agent ID */
  agentId: string
  
  /** Filter by specific memory types (optional) */
  types?: MemoryType[]
  
  /** Filter by memory status (optional) */
  status?: MemoryStatus[]
  
  /** Maximum number of results to return (optional) */
  limit?: number
  
  /** Only return memories created after this date (optional) */
  since?: Date
  
  /** Full-text search within memory content (optional) */
  searchText?: string
}

/**
 * Configuration for automatic memory compaction to manage storage
 */
export interface CompactionConfig {
  /** Time threshold for compaction eligibility (e.g., '7 days', '1 month') */
  olderThan: string
  
  /** Minimum character count required before compaction is applied */
  minSize: number
  
  /** Maximum number of compaction iterations allowed per memory */
  maxCompactionLevel: number
  
  /** Target compression ratio for compacted memories (0.0-1.0) */
  compressionTarget: number
}

/**
 * Overall configuration for the memory service
 */
export interface MemoryServiceConfig {
  /** File system path to the Dolt database directory */
  doltPath: string
  
  /** Configuration for automatic memory compaction */
  compaction: CompactionConfig
  
  /** Maximum number of memories allowed per agent */
  maxMemoriesPerAgent: number
  
  /** Whether to track and maintain memory relationships */
  enableRelationships: boolean
}

/**
 * Statistics about memory usage for monitoring and optimization
 */
export interface MemoryStats {
  /** Total number of memories in the system */
  totalMemories: number
  
  /** Number of active memories */
  activeMemories: number
  
  /** Number of archived memories */
  archivedMemories: number
  
  /** Number of compacted memories */
  compactedMemories: number
  
  /** Total storage used by all memories (bytes) */
  totalStorageBytes: number
  
  /** Storage saved through compaction (bytes) */
  savedBytes: number
  
  /** Number of memory relationships */
  totalRelationships: number
}

/**
 * Result of a compaction operation
 */
export interface CompactionResult {
  /** ID of the compacted memory */
  memoryId: string
  
  /** Whether the compaction was successful */
  success: boolean
  
  /** Original size before compaction */
  originalSize: number
  
  /** New size after compaction */
  compactedSize: number
  
  /** Compression ratio achieved */
  compressionRatio: number
  
  /** Any error message if compaction failed */
  error?: string
}

/**
 * Batch operation result for multiple memory operations
 */
export interface BatchResult<T> {
  /** Successfully processed items */
  successful: T[]
  
  /** Failed items with error details */
  failed: Array<{
    item: T
    error: string
  }>
  
  /** Total number of items processed */
  totalProcessed: number
  
  /** Number of successful operations */
  successCount: number
  
  /** Number of failed operations */
  failureCount: number
}