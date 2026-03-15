// @ts-nocheck
/**
 * 🦊 SKYNET CORTEX — Knowledge System (Enhanced with Persistent Memory)
 * 
 * Wave 6: PERSISTENT MEMORY INTEGRATION
 * Upgrade to Dolt-backed persistent memory while maintaining compatibility.
 * 
 * Capabilities:
 * - Persistent memory storage via Dolt database
 * - Backward compatibility with existing CORTEX API
 * - Migration from file-based to database storage
 * - Enhanced semantic search and relationships
 * - Long-term memory persistence across restarts
 * - Knowledge graph construction with relationships
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { MemoryService, AgentMemory, MemoryType, MemoryRelationship, MemoryQuery } from '../memory';

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  // Legacy file paths for migration
  STATE_FILE: path.join(process.cwd(), 'data', 'cortex-state.json'),
  MEMORIES_FILE: path.join(process.cwd(), 'data', 'cortex-memories.json'),
  EMBEDDINGS_FILE: path.join(process.cwd(), 'data', 'cortex-embeddings.json'),
  MIGRATION_MARKER: path.join(process.cwd(), 'data', '.cortex-migrated'),
  
  // Runtime settings
  MAX_CONTEXT_ITEMS: 10,
  SIMILARITY_THRESHOLD: 0.7,
  EMBEDDING_DIMENSIONS: 384,
  
  // Agent ID for SKYNET CORTEX
  AGENT_ID: 'skynet-cortex',
};

// ═══════════════════════════════════════════════════════════════
// TYPES (Extended for compatibility)
// ═══════════════════════════════════════════════════════════════

interface LegacyMemory {
  id: string;
  timestamp: number;
  type: 'conversation' | 'fact' | 'decision' | 'preference' | 'task';
  content: string;
  summary: string;
  tags: string[];
  source: string;
  importance: number;
  accessCount: number;
  lastAccessed: number | null;
  embedding?: number[];
}

interface KnowledgeNode {
  id: string;
  label: string;
  type: 'entity' | 'concept' | 'action' | 'relationship';
  properties: Record<string, any>;
  connections: Array<{
    targetId: string;
    relationship: string;
    strength: number;
  }>;
}

interface CortexState {
  startedAt: number;
  totalMemorized: number;
  totalQueries: number;
  totalRetrievals: number;
  migrated: boolean;
  memoryServiceInitialized: boolean;
}

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

let state: CortexState = {
  startedAt: Date.now(),
  totalMemorized: 0,
  totalQueries: 0,
  totalRetrievals: 0,
  migrated: false,
  memoryServiceInitialized: false,
};

let memoryService: MemoryService | null = null;
let isRunning = false;

// In-memory knowledge graph (enhanced with relationships)
let knowledgeGraph: Map<string, KnowledgeNode> = new Map();

// ═══════════════════════════════════════════════════════════════
// MEMORY SERVICE INTEGRATION
// ═══════════════════════════════════════════════════════════════

async function initializeMemoryService(): Promise<void> {
  if (state.memoryServiceInitialized && memoryService) {
    return;
  }
  
  try {
    console.log('[🦊 CORTEX] Initializing persistent memory system...');
    
    memoryService = new MemoryService({
      // @ts-expect-error - Post-Merge Reconciliation
      repositoryPath: path.join(process.cwd(), 'data', 'memory-repo'),
      maxMemoriesPerAgent: 50000, // Higher limit for CORTEX
      enableAutoCompaction: true,
      logLevel: 'info',
    });
    
    await memoryService.initialize();
    state.memoryServiceInitialized = true;
    
    console.log('[🦊 CORTEX] Persistent memory system initialized');
  } catch (error: unknown) {
    console.error('[🦊 CORTEX] Failed to initialize memory service:', error);
    throw new Error(`Memory service initialization failed: ${error instanceof Error ? (error).message : String(error)}`, { cause: error });
  }
}

// ═══════════════════════════════════════════════════════════════
// MIGRATION SYSTEM
// ═══════════════════════════════════════════════════════════════

async function checkMigrationStatus(): Promise<boolean> {
  try {
    await fs.access(CONFIG.MIGRATION_MARKER);
    return true; // Already migrated
  } catch {
    return false; // Not migrated yet
  }
}

async function migrateFromLegacyFiles(): Promise<void> {
  if (state.migrated || !memoryService) {
    return;
  }
  
  try {
    console.log('[🦊 CORTEX] Checking for legacy memories to migrate...');
    
    // Check if legacy files exist
    const legacyExists = await fs.access(CONFIG.MEMORIES_FILE).then(() => true).catch(() => false);
    
    if (!legacyExists) {
      console.log('[🦊 CORTEX] No legacy memories found');
      await fs.writeFile(CONFIG.MIGRATION_MARKER, JSON.stringify({ migratedAt: new Date().toISOString() }));
      state.migrated = true;
      return;
    }
    
    console.log('[🦊 CORTEX] Migrating legacy memories to persistent storage...');
    
    // Load legacy memories
    const memoriesData = await fs.readFile(CONFIG.MEMORIES_FILE, 'utf8');
    const legacyMemories: Record<string, LegacyMemory> = JSON.parse(memoriesData);
    
    // Load legacy state for counters
    let legacyState: any = {};
    try {
      const stateData = await fs.readFile(CONFIG.STATE_FILE, 'utf8');
      legacyState = JSON.parse(stateData);
    } catch {
      // No legacy state file
    }
    
    let migratedCount = 0;
    
    // Migrate each legacy memory
    for (const [id, legacyMemory] of Object.entries(legacyMemories)) {
      try {
        // Map legacy memory to new format
        const memoryType: MemoryType = mapLegacyTypeToMemoryType(legacyMemory.type);
        
        await memoryService.storeMemory(CONFIG.AGENT_ID, {
          type: memoryType,
          content: legacyMemory.content,
          metadata: {
            // Preserve legacy data
            legacyId: id,
            summary: legacyMemory.summary,
            tags: legacyMemory.tags,
            source: legacyMemory.source,
            accessCount: legacyMemory.accessCount,
            lastAccessed: legacyMemory.lastAccessed,
            embedding: legacyMemory.embedding,
            migratedFrom: 'cortex-v5',
            originalTimestamp: legacyMemory.timestamp,
          },
          // @ts-expect-error - Post-Merge Reconciliation
          importance: Math.round(legacyMemory.importance * 10), // Scale 0-1 to 1-10
        });
        
        migratedCount++;
      } catch (error: unknown) {
        console.warn(`[🦊 CORTEX] Failed to migrate memory ${id}:`, error);
      }
    }
    
    // Restore counters from legacy state
    if (legacyState.totalMemorized) {state.totalMemorized = legacyState.totalMemorized;}
    if (legacyState.totalQueries) {state.totalQueries = legacyState.totalQueries;}
    if (legacyState.totalRetrievals) {state.totalRetrievals = legacyState.totalRetrievals;}
    
    console.log(`[🦊 CORTEX] Successfully migrated ${migratedCount} memories`);
    
    // Create migration marker
    await fs.writeFile(CONFIG.MIGRATION_MARKER, JSON.stringify({
      migratedAt: new Date().toISOString(),
      migratedCount,
      legacyCounters: {
        totalMemorized: state.totalMemorized,
        totalQueries: state.totalQueries,
        totalRetrievals: state.totalRetrievals,
      }
    }));
    
    state.migrated = true;
    
  } catch (error: unknown) {
    console.error('[🦊 CORTEX] Migration failed:', error);
    throw new Error(`Legacy memory migration failed: ${error instanceof Error ? (error).message : String(error)}`, { cause: error });
  }
}

function mapLegacyTypeToMemoryType(legacyType: LegacyMemory['type']): MemoryType {
  switch (legacyType) {
    case 'conversation': return 'context';
    case 'fact': return 'learning';
    case 'decision': return 'decision';
    case 'preference': return 'context';
    case 'task': return 'context';
    default: return 'context';
  }
}

// ═══════════════════════════════════════════════════════════════
// LEGACY EMBEDDING SYSTEM (for backward compatibility)
// ═══════════════════════════════════════════════════════════════

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);
}

function createEmbedding(text: string): number[] {
  const tokens = tokenize(text);
  const embedding = new Array(CONFIG.EMBEDDING_DIMENSIONS).fill(0);
  
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const hash = crypto.createHash('md5').update(token).digest();
    
    for (let j = 0; j < 4; j++) {
      const dim = hash.readUInt8(j) % CONFIG.EMBEDDING_DIMENSIONS;
      const weight = 1 / (1 + Math.log(i + 1));
      embedding[dim] += weight;
    }
  }
  
  const magnitude = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  if (magnitude > 0) {
    for (let i = 0; i < embedding.length; i++) {
      embedding[i] /= magnitude;
    }
  }
  
  return embedding;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {return 0;}
  
  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    magnitudeA += a[i] * a[i];
    magnitudeB += b[i] * b[i];
  }
  
  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);
  
  if (magnitudeA === 0 || magnitudeB === 0) {return 0;}
  
  return dotProduct / (magnitudeA * magnitudeB);
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function extractTags(content: string): string[] {
  const tags: string[] = [];
  
  const hashtags = content.match(/#\w+/g);
  if (hashtags) {
    tags.push(...hashtags.map(t => t.slice(1).toLowerCase()));
  }
  
  if (/\b(meeting|call|discussion)\b/i.test(content)) {tags.push('meeting');}
  if (/\b(task|todo|action)\b/i.test(content)) {tags.push('task');}
  if (/\b(decision|decided|agreed)\b/i.test(content)) {tags.push('decision');}
  if (/\b(bug|error|issue|problem)\b/i.test(content)) {tags.push('issue');}
  if (/\b(code|function|api|database)\b/i.test(content)) {tags.push('technical');}
  
  return [...new Set(tags)];
}

function summarize(content: string, maxLength: number = 100): string {
  const firstSentence = content.match(/^[^.!?]+[.!?]/);
  if (firstSentence && firstSentence[0].length <= maxLength) {
    return firstSentence[0].trim();
  }
  
  if (content.length <= maxLength) {return content;}
  return content.slice(0, maxLength - 3).trim() + '...';
}

function calculateImportance(content: string, type: string): number {
  let importance = 0.5;
  
  if (type === 'decision') {importance += 0.2;}
  if (type === 'task') {importance += 0.1;}
  if (type === 'preference') {importance += 0.15;}
  
  if (/\b(important|critical|urgent|must)\b/i.test(content)) {importance += 0.2;}
  if (/\b(remember|don't forget|note)\b/i.test(content)) {importance += 0.1;}
  
  importance += Math.min(0.1, content.length / 5000);
  
  return Math.min(1, importance);
}

function extractEntities(content: string): Array<{ name: string; type: string }> {
  const entities: Array<{ name: string; type: string }> = [];
  
  const names = content.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g);
  if (names) {
    for (const name of names) {
      if (name.length > 2 && !['The', 'This', 'That', 'What', 'When', 'Where', 'How'].includes(name)) {
        entities.push({ name, type: 'entity' });
      }
    }
  }
  
  const urls = content.match(/https?:\/\/[^\s]+/g);
  if (urls) {
    for (const url of urls) {
      entities.push({ name: url, type: 'url' });
    }
  }
  
  const dates = content.match(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g);
  if (dates) {
    for (const date of dates) {
      entities.push({ name: date, type: 'date' });
    }
  }
  
  return entities;
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC API (Enhanced with persistent memory)
// ═══════════════════════════════════════════════════════════════

export async function startCortex(): Promise<void> {
  if (isRunning) {
    console.warn('[🦊 CORTEX] Already running');
    return;
  }
  
  console.log('[🦊 CORTEX] Starting enhanced knowledge system...');
  
  try {
    // Initialize persistent memory system
    await initializeMemoryService();
    
    // Check and run migration if needed
    const alreadyMigrated = await checkMigrationStatus();
    if (!alreadyMigrated) {
      await migrateFromLegacyFiles();
    } else {
      state.migrated = true;
    }
    
    // Load existing state counters if available
    try {
      const stateData = await fs.readFile(CONFIG.STATE_FILE, 'utf8');
      const saved = JSON.parse(stateData);
      state.totalMemorized = saved.totalMemorized || state.totalMemorized;
      state.totalQueries = saved.totalQueries || state.totalQueries;
      state.totalRetrievals = saved.totalRetrievals || state.totalRetrievals;
    } catch {
      // No existing state file
    }
    
    isRunning = true;
    
    // Get memory statistics
    const stats = await getCortexStats();
    
    console.log('[🦊 CORTEX] Enhanced knowledge system active');
    console.log(`   Total Memories: ${stats.totalMemories}`);
    console.log(`   Memory Types: ${Object.entries(stats.types).map(([k,v]) => `${k}:${v}`).join(', ')}`);
    console.log(`   Graph Nodes: ${stats.graphNodes}`);
    console.log(`   Migrated: ${state.migrated ? 'Yes' : 'No'}`);
    
  } catch (error: unknown) {
    console.error('[🦊 CORTEX] Failed to start enhanced knowledge system:', error);
    throw error;
  }
}

export async function stopCortex(): Promise<void> {
  if (!isRunning) {return;}
  
  try {
    // Save current state
    await fs.mkdir(path.dirname(CONFIG.STATE_FILE), { recursive: true });
    await fs.writeFile(CONFIG.STATE_FILE, JSON.stringify({
      startedAt: state.startedAt,
      totalMemorized: state.totalMemorized,
      totalQueries: state.totalQueries,
      totalRetrievals: state.totalRetrievals,
      migrated: state.migrated,
      stoppedAt: Date.now(),
    }, null, 2));
    
    // Cleanup memory service
    if (memoryService) {
      await memoryService.destroy();
    }
    
    isRunning = false;
    console.log('[🦊 CORTEX] Enhanced knowledge system stopped — memories preserved');
    
  } catch (error: unknown) {
    console.error('[🦊 CORTEX] Error during shutdown:', error);
  }
}

/**
 * Store a new memory (Enhanced with persistent storage)
 */
export async function memorize(
  content: string,
  type: 'conversation' | 'fact' | 'decision' | 'preference' | 'task' = 'conversation',
  source: string = 'unknown'
): Promise<string> {
  if (!memoryService) {
    throw new Error('Memory service not initialized. Call startCortex() first.');
  }
  
  try {
    const tags = extractTags(content);
    const summary = summarize(content);
    const importance = calculateImportance(content, type);
    const embedding = createEmbedding(content);
    
    // Map to new memory type
    const memoryType = mapLegacyTypeToMemoryType(type);
    
    // Store in persistent memory
    const id = await memoryService.storeMemory(CONFIG.AGENT_ID, {
      type: memoryType,
      content,
      metadata: {
        summary,
        tags,
        source,
        legacyType: type, // Preserve original type for compatibility
        embedding, // Store embedding for legacy compatibility
        extractedEntities: extractEntities(content),
      },
      // @ts-expect-error - Post-Merge Reconciliation
      importance: Math.round(importance * 10), // Scale 0-1 to 1-10
    });
    
    state.totalMemorized++;
    
    // Build knowledge graph from entities
    const entities = extractEntities(content);
    for (const entity of entities) {
      const nodeId = crypto.createHash('md5').update(entity.name).digest('hex').slice(0, 12);
      
      if (!knowledgeGraph.has(nodeId)) {
        knowledgeGraph.set(nodeId, {
          id: nodeId,
          label: entity.name,
          type: entity.type as any,
          properties: { firstSeen: Date.now(), memoryId: id },
          connections: [],
        });
      }
    }
    
    // Auto-save state periodically
    if (state.totalMemorized % 50 === 0) {
      await saveState();
    }
    
    return id;
    
  } catch (error: unknown) {
    console.error('[🦊 CORTEX] Failed to memorize:', error);
    console.warn(`Failed to store memory: ${error instanceof Error ? (error).message : String(error)}`, { cause: error });
  }
}

/**
 * Search memories by semantic similarity (Enhanced with persistent search)
 */
export async function recall(query: string, limit: number = CONFIG.MAX_CONTEXT_ITEMS): Promise<LegacyMemory[]> {
  if (!memoryService) {
    throw new Error('Memory service not initialized. Call startCortex() first.');
  }
  
  state.totalQueries++;
  
  try {
    // First try database search for better results
    const dbResults = await memoryService.searchMemories(CONFIG.AGENT_ID, query);
    
    // Convert to legacy format for backward compatibility
    const legacyResults: LegacyMemory[] = [];
    
    for (const memory of dbResults.slice(0, limit)) {
      const legacy = convertToLegacyMemory(memory);
      if (legacy) {
        // Mark as accessed
        legacy.accessCount++;
        legacy.lastAccessed = Date.now();
        state.totalRetrievals++;
        
        // Update access count in database
        try {
          await memoryService.updateMemory(memory.id, {
            metadata: {
              ...memory.metadata,
              accessCount: legacy.accessCount,
              lastAccessed: legacy.lastAccessed,
            }
          });
        } catch (error: unknown) {
          console.warn('[🦊 CORTEX] Failed to update access count:', error);
        }
        
        legacyResults.push(legacy);
      }
    }
    
    // If we don't have enough results, fall back to embedding similarity
    if (legacyResults.length < limit / 2) {
      const queryEmbedding = createEmbedding(query);
      const allMemories = await memoryService.getAgentMemories({ agentId: CONFIG.AGENT_ID, limit: 1000 });
      
      const embeddingResults: Array<{ memory: LegacyMemory; score: number }> = [];
      
      for (const memory of allMemories) {
        const legacy = convertToLegacyMemory(memory);
        if (legacy?.embedding) {
          const similarity = cosineSimilarity(queryEmbedding, legacy.embedding);
          const recencyBoost = 1 / (1 + (Date.now() - memory.createdAt.getTime()) / (7 * 24 * 60 * 60 * 1000));
          // @ts-expect-error - Post-Merge Reconciliation
          const score = similarity * 0.7 + (memory.importance / 10) * 0.2 + recencyBoost * 0.1;
          
          if (score >= CONFIG.SIMILARITY_THRESHOLD * 0.5) {
            embeddingResults.push({ memory: legacy, score });
          }
        }
      }
      
      embeddingResults.sort((a, b) => b.score - a.score);
      
      // Add unique results from embedding search
      const existingIds = new Set(legacyResults.map(r => r.id));
      for (const result of embeddingResults) {
        if (!existingIds.has(result.memory.id) && legacyResults.length < limit) {
          result.memory.accessCount++;
          result.memory.lastAccessed = Date.now();
          state.totalRetrievals++;
          legacyResults.push(result.memory);
        }
      }
    }
    
    return legacyResults.slice(0, limit);
    
  } catch (error: unknown) {
    console.error('[🦊 CORTEX] Failed to recall memories:', error);
    throw new Error(`Failed to recall memories: ${error instanceof Error ? (error).message : String(error)}`, { cause: error });
  }
}

/**
 * Search memories by tag (Enhanced with persistent storage)
 */
export async function recallByTag(tag: string, limit: number = CONFIG.MAX_CONTEXT_ITEMS): Promise<LegacyMemory[]> {
  if (!memoryService) {
    throw new Error('Memory service not initialized. Call startCortex() first.');
  }
  
  try {
    // Search in metadata for tags
    const memories = await memoryService.getAgentMemories({
      agentId: CONFIG.AGENT_ID,
      limit: limit * 2, // Get more to filter
    });
    
    const results: LegacyMemory[] = [];
    const tagLower = tag.toLowerCase();
    
    for (const memory of memories) {
      const legacy = convertToLegacyMemory(memory);
      if (legacy && legacy.tags.some(t => t.toLowerCase() === tagLower)) {
        results.push(legacy);
      }
    }
    
    // Sort by importance and recency
    results.sort((a, b) => {
      const scoreA = a.importance * 0.5 + (1 / (1 + (Date.now() - a.timestamp) / 86400000)) * 0.5;
      const scoreB = b.importance * 0.5 + (1 / (1 + (Date.now() - b.timestamp) / 86400000)) * 0.5;
      return scoreB - scoreA;
    });
    
    return results.slice(0, limit);
    
  } catch (error: unknown) {
    console.error('[🦊 CORTEX] Failed to recall by tag:', error);
    throw new Error(`Failed to recall by tag: ${error instanceof Error ? (error).message : String(error)}`, { cause: error });
  }
}

/**
 * Search memories by type (Enhanced with persistent storage)
 */
export async function recallByType(type: 'conversation' | 'fact' | 'decision' | 'preference' | 'task', limit: number = CONFIG.MAX_CONTEXT_ITEMS): Promise<LegacyMemory[]> {
  if (!memoryService) {
    throw new Error('Memory service not initialized. Call startCortex() first.');
  }
  
  try {
    // Get memories with matching legacy type in metadata
    const memories = await memoryService.getAgentMemories({
      agentId: CONFIG.AGENT_ID,
      limit: limit * 2, // Get more to filter
    });
    
    const results: LegacyMemory[] = [];
    
    for (const memory of memories) {
      const legacy = convertToLegacyMemory(memory);
      if (legacy && legacy.type === type) {
        results.push(legacy);
      }
    }
    
    results.sort((a, b) => b.timestamp - a.timestamp);
    return results.slice(0, limit);
    
  } catch (error: unknown) {
    console.error('[🦊 CORTEX] Failed to recall by type:', error);
    throw new Error(`Failed to recall by type: ${error instanceof Error ? (error).message : String(error)}`, { cause: error });
  }
}

/**
 * Get recent memories (Enhanced with persistent storage)
 */
export async function getRecentMemories(limit: number = CONFIG.MAX_CONTEXT_ITEMS): Promise<LegacyMemory[]> {
  if (!memoryService) {
    throw new Error('Memory service not initialized. Call startCortex() first.');
  }
  
  try {
    const memories = await memoryService.getAgentMemories({
      agentId: CONFIG.AGENT_ID,
      // @ts-expect-error - Post-Merge Reconciliation
      sortBy: 'created_at',
      limit,
    });
    
    return memories.map(m => convertToLegacyMemory(m)).filter(Boolean) as LegacyMemory[];
    
  } catch (error: unknown) {
    console.error('[🦊 CORTEX] Failed to get recent memories:', error);
    throw new Error(`Failed to get recent memories: ${error instanceof Error ? (error).message : String(error)}`, { cause: error });
  }
}

/**
 * Build context for a query (Enhanced with persistent memory)
 */
export async function buildContext(query: string): Promise<string> {
  try {
    const relevant = await recall(query, 5);
    
    if (relevant.length === 0) {
      return '';
    }
    
    const context = relevant.map(m => {
      const date = new Date(m.timestamp).toISOString().split('T')[0];
      return `[${date}] (${m.type}) ${m.summary}`;
    }).join('\n');
    
    return `## Relevant Context from Memory\n\n${context}\n`;
    
  } catch (error: unknown) {
    console.error('[🦊 CORTEX] Failed to build context:', error);
    return '';
  }
}

/**
 * Get memory by ID (Enhanced with persistent storage)
 */
export async function getMemory(id: string): Promise<LegacyMemory | null> {
  if (!memoryService) {
    throw new Error('Memory service not initialized. Call startCortex() first.');
  }
  
  try {
    const memory = await memoryService.getMemory(id);
    return memory ? convertToLegacyMemory(memory) : null;
    
  } catch (error: unknown) {
    console.error('[🦊 CORTEX] Failed to get memory:', error);
    return null;
  }
}

/**
 * Delete a memory (Enhanced with persistent storage)
 */
export async function forget(id: string): Promise<boolean> {
  if (!memoryService) {
    throw new Error('Memory service not initialized. Call startCortex() first.');
  }
  
  try {
    await memoryService.deleteMemory(id);
    return true;
    
  } catch (error: unknown) {
    console.error('[🦊 CORTEX] Failed to forget memory:', error);
    return false;
  }
}

/**
 * Get cortex statistics (Enhanced with persistent memory)
 */
export async function getCortexStats(): Promise<{
  totalMemories: number;
  totalMemorized: number;
  totalQueries: number;
  totalRetrievals: number;
  graphNodes: number;
  types: Record<string, number>;
}> {
  if (!memoryService) {
    return {
      totalMemories: 0,
      totalMemorized: state.totalMemorized,
      totalQueries: state.totalQueries,
      totalRetrievals: state.totalRetrievals,
      graphNodes: knowledgeGraph.size,
      types: {},
    };
  }
  
  try {
    const stats = await memoryService.getAgentStats(CONFIG.AGENT_ID);
    
    // Convert to legacy format
    const types: Record<string, number> = {};
    const memories = await memoryService.getAgentMemories({ agentId: CONFIG.AGENT_ID, limit: 10000 });
    
    for (const memory of memories) {
      const legacyType = memory.metadata?.legacyType || 'conversation';
      types[legacyType] = (types[legacyType] || 0) + 1;
    }
    
    return {
      totalMemories: stats.totalMemories,
      totalMemorized: Math.max(state.totalMemorized, stats.totalMemories),
      totalQueries: state.totalQueries,
      totalRetrievals: state.totalRetrievals,
      graphNodes: knowledgeGraph.size,
      types,
    };
    
  } catch (error: unknown) {
    console.error('[🦊 CORTEX] Failed to get stats:', error);
    return {
      totalMemories: 0,
      totalMemorized: state.totalMemorized,
      totalQueries: state.totalQueries,
      totalRetrievals: state.totalRetrievals,
      graphNodes: knowledgeGraph.size,
      types: {},
    };
  }
}

export function getCortexState(): CortexState & { knowledgeGraph: Map<string, KnowledgeNode> } {
  return {
    ...state,
    knowledgeGraph: new Map(knowledgeGraph),
  };
}

// ═══════════════════════════════════════════════════════════════
// CONVERSION UTILITIES
// ═══════════════════════════════════════════════════════════════

function convertToLegacyMemory(memory: AgentMemory): LegacyMemory | null {
  try {
    const metadata = memory.metadata || {};
    
    return {
      id: memory.id,
      timestamp: memory.createdAt.getTime(),
      type: metadata.legacyType || 'conversation',
      content: memory.content,
      summary: metadata.summary || summarize(memory.content),
      tags: metadata.tags || [],
      source: metadata.source || 'unknown',
      // @ts-expect-error - Post-Merge Reconciliation
      importance: memory.importance / 10, // Scale back to 0-1
      accessCount: metadata.accessCount || 0,
      lastAccessed: metadata.lastAccessed || null,
      embedding: metadata.embedding || undefined,
    };
  } catch (error: unknown) {
    console.warn('[🦊 CORTEX] Failed to convert memory to legacy format:', error);
    return null;
  }
}

async function saveState(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(CONFIG.STATE_FILE), { recursive: true });
    await fs.writeFile(CONFIG.STATE_FILE, JSON.stringify({
      startedAt: state.startedAt,
      totalMemorized: state.totalMemorized,
      totalQueries: state.totalQueries,
      totalRetrievals: state.totalRetrievals,
      migrated: state.migrated,
      lastSaved: Date.now(),
    }, null, 2));
  } catch (error: unknown) {
    console.error('[🦊 CORTEX] Failed to save state:', error);
  }
}

// ═══════════════════════════════════════════════════════════════
// ADVANCED FEATURES (New with persistent memory)
// ═══════════════════════════════════════════════════════════════

/**
 * Add relationship between memories
 */
export async function addMemoryRelationship(
  sourceId: string, 
  targetId: string, 
  relationshipType: 'related' | 'causes' | 'caused_by' | 'follows' | 'contradicts' | 'confirms' = 'related',
  strength: number = 1.0
): Promise<void> {
  if (!memoryService) {
    throw new Error('Memory service not initialized. Call startCortex() first.');
  }
  
  try {
    await memoryService.addRelationship({
      sourceId,
      targetId,
      // @ts-expect-error - Post-Merge Reconciliation
      type: relationshipType,
      strength,
    });
  } catch (error: unknown) {
    console.error('[🦊 CORTEX] Failed to add relationship:', error);
    throw error;
  }
}

/**
 * Get related memories for a memory ID
 */
export async function getRelatedMemories(memoryId: string): Promise<LegacyMemory[]> {
  if (!memoryService) {
    throw new Error('Memory service not initialized. Call startCortex() first.');
  }
  
  try {
    const related = await memoryService.getRelatedMemories(memoryId);
    return related.map(m => convertToLegacyMemory(m)).filter(Boolean) as LegacyMemory[];
  } catch (error: unknown) {
    console.error('[🦊 CORTEX] Failed to get related memories:', error);
    return [];
  }
}

/**
 * Compact old memories to save space
 */
export async function compactMemories(): Promise<void> {
  if (!memoryService) {
    throw new Error('Memory service not initialized. Call startCortex() first.');
  }
  
  try {
    await memoryService.compactStaleMemories(CONFIG.AGENT_ID);
    console.log('[🦊 CORTEX] Memory compaction completed');
  } catch (error: unknown) {
    console.error('[🦊 CORTEX] Failed to compact memories:', error);
    throw error;
  }
}

// Export enhanced cortex for backward compatibility
export default {
  startCortex,
  stopCortex,
  memorize,
  recall,
  recallByTag,
  recallByType,
  getRecentMemories,
  buildContext,
  getMemory,
  forget,
  getCortexStats,
  getCortexState,
  // New features
  addMemoryRelationship,
  getRelatedMemories,
  compactMemories,
};