// @ts-nocheck
/**
 * Tests for hash-id-generator functions
 * 
 * These tests verify the ID generation functions work correctly.
 * They are separate from MemoryService tests to avoid mock conflicts.
 */

import { describe, it, expect } from 'vitest'
import { generateMemoryId } from '../hash-id-generator'

describe('generateMemoryId', () => {
  it('should generate consistent IDs for same content', () => {
    const content = {
      agentId: 'test-agent',
      title: 'Test Memory',
      description: 'Test content',
      type: 'learning',
      timestamp: 1234567890 // Fixed timestamp for consistency
    }
    
    const id1 = generateMemoryId(content)
    const id2 = generateMemoryId(content)
    
    expect(id1).toBe(id2)
    expect(id1).toMatch(/^mem-[a-f0-9]{16}$/)
  })

  it('should generate different IDs for different content', () => {
    const baseTimestamp = 1234567890
    
    const id1 = generateMemoryId({
      agentId: 'agent1',
      title: 'Memory 1',
      description: 'Content 1',
      type: 'learning',
      timestamp: baseTimestamp
    })
    
    const id2 = generateMemoryId({
      agentId: 'agent1',
      title: 'Memory 2',
      description: 'Content 2',
      type: 'learning',
      timestamp: baseTimestamp
    })
    
    expect(id1).not.toBe(id2)
    expect(id1).toMatch(/^mem-[a-f0-9]{16}$/)
    expect(id2).toMatch(/^mem-[a-f0-9]{16}$/)
  })

  it('should generate different IDs for different agent IDs', () => {
    const baseTimestamp = 1234567890
    
    const id1 = generateMemoryId({
      agentId: 'agent1',
      title: 'Same Title',
      description: 'Same Content',
      type: 'learning',
      timestamp: baseTimestamp
    })
    
    const id2 = generateMemoryId({
      agentId: 'agent2',
      title: 'Same Title',
      description: 'Same Content',
      type: 'learning',
      timestamp: baseTimestamp
    })
    
    expect(id1).not.toBe(id2)
  })

  it('should use current timestamp if none provided', async () => {
    const content = {
      agentId: 'test-agent',
      title: 'Test Memory',
      description: 'Test content',
      type: 'learning'
    }
    
    const id1 = generateMemoryId(content)
    // Small delay to ensure different timestamp
    await new Promise(resolve => setTimeout(resolve, 2))
    const id2 = generateMemoryId(content)
    
    // Without fixed timestamp, IDs will be different due to timestamp
    expect(id1).not.toBe(id2)
    expect(id1).toMatch(/^mem-[a-f0-9]{16}$/)
    expect(id2).toMatch(/^mem-[a-f0-9]{16}$/)
  })

  it('should handle special characters in content', () => {
    const content = {
      agentId: 'test-agent',
      title: 'Test "Special" Memory!',
      description: 'Content with émoji 🤖 and ñúmbërs 123',
      type: 'learning',
      timestamp: 1234567890
    }
    
    const id = generateMemoryId(content)
    
    expect(id).toMatch(/^mem-[a-f0-9]{16}$/)
    expect(typeof id).toBe('string')
  })

  it('should normalize whitespace in content', () => {
    const baseTimestamp = 1234567890
    
    const id1 = generateMemoryId({
      agentId: ' test-agent ',
      title: ' Test Memory ',
      description: ' Test content ',
      type: ' learning ',
      timestamp: baseTimestamp
    })
    
    const id2 = generateMemoryId({
      agentId: 'test-agent',
      title: 'Test Memory',
      description: 'Test content',
      type: 'learning',
      timestamp: baseTimestamp
    })
    
    expect(id1).toBe(id2)
  })
})
