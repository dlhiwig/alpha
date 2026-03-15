// @ts-nocheck
import { Anthropic } from '@anthropic-ai/sdk'
import type { DoltService } from './DoltService'
import type { AgentMemory, CompactionConfig } from './types'

export class MemoryCompactor {
  private llm: Anthropic
  private dolt: DoltService
  private config: CompactionConfig
  
  constructor(dolt: DoltService, config?: Partial<CompactionConfig>) {
    this.llm = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    })
    this.dolt = dolt
    this.config = {
      olderThan: '7 days',
      minSize: 500,
      maxCompactionLevel: 2,
      compressionTarget: 0.5,
      ...config
    }
  }
  
  async compactStaleMemories(agentId: string): Promise<CompactionResult> {
    const result: CompactionResult = {
      memoriesProcessed: 0,
      memoriesCompacted: 0,
      bytesRecovered: 0,
      errors: []
    }
    
    try {
      // 1. Find stale memories older than threshold
      const cutoffDate = this.calculateCutoffDate(this.config.olderThan)
      const staleMemories = await this.dolt.query(`
        SELECT * FROM agent_memories 
        WHERE agent_id = ? 
        AND created_at < ? 
        AND compaction_level < ? 
        AND LENGTH(description) >= ?
        ORDER BY created_at ASC
      `, [agentId, cutoffDate, this.config.maxCompactionLevel, this.config.minSize])
      
      result.memoriesProcessed = staleMemories.length
      
      // 2. Process each stale memory
      for (const memory of staleMemories) {
        try {
          const originalSize = memory.description.length
          
          // 3. Summarize with Claude Haiku
          const summary = await this.summarizeMemory(memory)
          const newSize = summary.length
          
          // 4. Only apply if summary is actually smaller
          if (newSize < originalSize * this.config.compressionTarget) {
            const bytesRecovered = originalSize - newSize
            
            // 5. Apply compaction and log to audit
            await this.applyCompaction(memory.id, summary, memory.compaction_level + 1)
            
            result.memoriesCompacted++
            result.bytesRecovered += bytesRecovered
            
            // Log compaction to audit table
            await this.logCompaction(agentId, memory.id, originalSize, newSize, memory.compaction_level + 1)
            
            console.log(`Compacted memory ${memory.id}: ${originalSize}→${newSize} bytes (${Math.round((1 - newSize/originalSize) * 100)}% reduction)`)
          } else {
            console.log(`Skipped memory ${memory.id}: summary not smaller (${newSize}/${originalSize})`)
          }
        } catch (error: unknown) {
          const errorMsg = `Failed to compact memory ${memory.id}: ${(error as Error).message}`
          result.errors.push(errorMsg)
          console.error(errorMsg)
        }
      }
      
      // Commit all changes
      await this.dolt.commit(`Memory compaction for agent ${agentId}: ${result.memoriesCompacted}/${result.memoriesProcessed} compacted`)
      
    } catch (error: unknown) {
      const errorMsg = `Compaction failed for agent ${agentId}: ${(error as Error).message}`
      result.errors.push(errorMsg)
      console.error(errorMsg)
    }
    
    return result
  }
  
  async summarizeMemory(memory: AgentMemory): Promise<string> {
    const targetLength = Math.floor(memory.description.length * this.config.compressionTarget)
    
    const prompt = `Summarize this agent memory concisely while preserving key facts:

Title: ${memory.title}
Content: ${memory.description}
Created: ${memory.createdAt}
Tags: ${(memory as any).tags || 'none'}

Provide a condensed summary that captures:
- Core concept or decision
- Key details that matter  
- Any critical metadata
- Essential context for future reference

Keep it under ${targetLength} characters while preserving the most important information.`

    const response = await this.llm.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 500,
      temperature: 0.1, // Low temperature for consistent, focused summaries
      messages: [{ role: 'user', content: prompt }]
    })
    
    const summary = response.content[0].type === 'text' ? response.content[0].text.trim() : ''
    
    if (!summary) {
      throw new Error('Empty summary returned from Claude Haiku')
    }
    
    return summary
  }
  
  async applyCompaction(memoryId: string, summary: string, level: number): Promise<void> {
    // @ts-expect-error - Post-Merge Reconciliation
    const originalMemory = await this.dolt.queryOne(
      'SELECT description FROM agent_memories WHERE id = ?',
      [memoryId]
    )
    
    if (!originalMemory) {
      throw new Error(`Memory ${memoryId} not found`)
    }
    
    const originalSize = originalMemory.description.length
    const compactedSize = summary.length
    
    // Update memory with compacted content
    await this.dolt.query(`
      UPDATE agent_memories 
      SET 
        description = ?,
        compaction_level = ?,
        original_size = COALESCE(original_size, ?),
        compacted_at = NOW(),
        compression_ratio = ?
      WHERE id = ?
    `, [
      summary,
      level,
      originalSize,
      compactedSize / originalSize,
      memoryId
    ])
  }
  
  async logCompaction(agentId: string, memoryId: string, originalSize: number, compactedSize: number, level: number): Promise<void> {
    await this.dolt.query(`
      INSERT INTO memory_compaction_audit (
        agent_id,
        memory_id,
        original_size,
        compacted_size,
        compaction_level,
        compression_ratio,
        compacted_at
      ) VALUES (?, ?, ?, ?, ?, ?, NOW())
    `, [
      agentId,
      memoryId,
      originalSize,
      compactedSize,
      level,
      compactedSize / originalSize
    ])
  }
  
  async getCompactionStats(agentId: string): Promise<CompactionStats> {
    // @ts-expect-error - Post-Merge Reconciliation
    const stats = await this.dolt.queryOne(`
      SELECT 
        COUNT(*) as total_compactions,
        AVG(compression_ratio) as average_compression_ratio,
        SUM(original_size - compacted_size) as bytes_recovered,
        MAX(compacted_at) as last_compaction
      FROM memory_compaction_audit 
      WHERE agent_id = ?
    `, [agentId])
    
    return {
      totalCompactions: stats?.total_compactions || 0,
      averageCompressionRatio: stats?.average_compression_ratio || 0,
      bytesRecovered: stats?.bytes_recovered || 0,
      lastCompaction: stats?.last_compaction ? new Date(stats.last_compaction) : null
    }
  }
  
  async deepCompact(agentId: string): Promise<void> {
    console.log(`Starting deep compaction (level 2) for agent ${agentId}`)
    
    // Find memories that can be merged - similar topics, same time period
    const candidateGroups = await this.findMergeCandidates(agentId)
    
    for (const group of candidateGroups) {
      try {
        const mergedMemory = await this.mergeMemories(group)
        
        // Replace the group with a single merged memory
        await this.replaceMergedMemories(group, mergedMemory)
        
        console.log(`Merged ${group.length} memories into one for agent ${agentId}`)
      } catch (error: unknown) {
        console.error(`Failed to merge memory group for agent ${agentId}:`, error)
      }
    }
    
    await this.dolt.commit(`Deep compaction (level 2) for agent ${agentId}`)
  }
  
  private async findMergeCandidates(agentId: string): Promise<AgentMemory[][]> {
    // Find memories that are similar and can be merged
    const memories = await this.dolt.query(`
      SELECT * FROM agent_memories 
      WHERE agent_id = ? 
      AND compaction_level >= 1 
      AND compaction_level < 2
      ORDER BY created_at ASC
    `, [agentId])
    
    // Group memories by similarity (simple time-based grouping for now)
    const groups: AgentMemory[][] = []
    const timeWindow = 24 * 60 * 60 * 1000 // 24 hours in ms
    
    let currentGroup: AgentMemory[] = []
    let lastTime: Date | null = null
    
    for (const memory of memories) {
      const memoryTime = new Date(memory.created_at)
      
      if (!lastTime || memoryTime.getTime() - lastTime.getTime() > timeWindow) {
        if (currentGroup.length >= 2) {
          groups.push([...currentGroup])
        }
        currentGroup = [memory]
      } else {
        currentGroup.push(memory)
      }
      
      lastTime = memoryTime
    }
    
    if (currentGroup.length >= 2) {
      groups.push(currentGroup)
    }
    
    return groups
  }
  
  private async mergeMemories(memories: AgentMemory[]): Promise<string> {
    const combinedContent = memories.map(m => 
      // @ts-expect-error - Post-Merge Reconciliation
      `[${m.created_at}] ${m.title}: ${m.description}`
    ).join('\n\n')
    
    const prompt = `Merge these related agent memories into a single comprehensive summary:

${combinedContent}

Create a unified memory that:
- Captures the essential information from all entries
- Maintains chronological context where important
- Eliminates redundancy while preserving unique details
- Results in a coherent, searchable summary

The merged memory should be significantly shorter than the combined originals while retaining all critical information.`

    const response = await this.llm.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 1000,
      temperature: 0.1,
      messages: [{ role: 'user', content: prompt }]
    })
    
    return response.content[0].type === 'text' ? response.content[0].text.trim() : ''
  }
  
  private async replaceMergedMemories(originalMemories: AgentMemory[], mergedContent: string): Promise<void> {
    const primaryMemory = originalMemories[0]
    const memoryIds = originalMemories.map(m => m.id)
    
    // Update the first memory with merged content
    await this.dolt.query(`
      UPDATE agent_memories 
      SET 
        description = ?,
        title = ?,
        compaction_level = 2,
        compacted_at = NOW(),
        merged_from_count = ?
      WHERE id = ?
    `, [
      mergedContent,
      `Merged: ${primaryMemory.title} (+${originalMemories.length - 1} others)`,
      originalMemories.length,
      primaryMemory.id
    ])
    
    // Remove the other memories
    if (memoryIds.length > 1) {
      const idsToRemove = memoryIds.slice(1)
      await this.dolt.query(`
        DELETE FROM agent_memories 
        WHERE id IN (${idsToRemove.map(() => '?').join(',')})
      `, idsToRemove)
    }
    
    // Log the merge operation
    await this.dolt.query(`
      INSERT INTO memory_compaction_audit (
        agent_id,
        memory_id,
        original_size,
        compacted_size,
        compaction_level,
        compression_ratio,
        compacted_at,
        operation_type
      ) VALUES (?, ?, ?, ?, 2, ?, NOW(), 'merge')
    `, [
      // @ts-expect-error - Post-Merge Reconciliation
      primaryMemory.agent_id,
      primaryMemory.id,
      originalMemories.reduce((sum, m) => sum + m.description.length, 0),
      mergedContent.length,
      mergedContent.length / originalMemories.reduce((sum, m) => sum + m.description.length, 0)
    ])
  }
  
  private calculateCutoffDate(olderThan: string): string {
    const now = new Date()
    const match = olderThan.match(/(\d+)\s+(days?|hours?|weeks?)/)
    
    if (!match) {
      throw new Error(`Invalid olderThan format: ${olderThan}`)
    }
    
    const [, amount, unit] = match
    const num = parseInt(amount)
    
    switch (unit.toLowerCase()) {
      case 'day':
      case 'days':
        now.setDate(now.getDate() - num)
        break
      case 'hour':
      case 'hours':
        now.setHours(now.getHours() - num)
        break
      case 'week':
      case 'weeks':
        now.setDate(now.getDate() - (num * 7))
        break
      default:
        throw new Error(`Unsupported time unit: ${unit}`)
    }
    
    return now.toISOString()
  }
}

export interface CompactionResult {
  memoriesProcessed: number
  memoriesCompacted: number
  bytesRecovered: number
  errors: string[]
}

export interface CompactionStats {
  totalCompactions: number
  averageCompressionRatio: number
  bytesRecovered: number
  lastCompaction: Date | null
}