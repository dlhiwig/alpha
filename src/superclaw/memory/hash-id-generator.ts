import { createHash, randomBytes } from 'crypto'

/**
 * Generate deterministic, collision-resistant IDs for agent memories
 * Uses content hashing for deduplication
 */
export function generateMemoryId(content: {
  agentId: string
  title: string
  description: string
  type: string
  timestamp?: number
}): string {
  // Create deterministic content string for hashing
  const normalizedContent = {
    agentId: content.agentId.trim(),
    title: content.title.trim(),
    description: content.description.trim(),
    type: content.type.trim(),
    // Use provided timestamp or current time for uniqueness
    timestamp: content.timestamp || Date.now()
  }

  // Create stable hash input by sorting keys
  const hashInput = JSON.stringify(normalizedContent, Object.keys(normalizedContent).sort())
  
  // Generate SHA-256 hash and take first 16 characters for readability
  const hash = createHash('sha256').update(hashInput, 'utf8').digest('hex').substring(0, 16)
  
  // Format: mem-{hash}
  return `mem-${hash}`
}

/**
 * Generate a correlation ID for message tracking
 * Uses UUID v4 format for global uniqueness
 */
export function generateCorrelationId(): string {
  // Generate 16 random bytes
  const bytes = randomBytes(16)
  
  // Set version (4) and variant bits per UUID v4 spec
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // Version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // Variant 10
  
  // Format as UUID string
  const hex = bytes.toString('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32)
  ].join('-')
}

/**
 * Generate a session ID for agent sessions
 * Combines identity hash with timestamp for uniqueness
 */
export function generateSessionId(identity: {
  namespace: string
  name: string
  project: string
}): string {
  // Create deterministic identity hash
  const identityString = `${identity.namespace}:${identity.name}:${identity.project}`
  const identityHash = createHash('sha256')
    .update(identityString, 'utf8')
    .digest('hex')
    .substring(0, 8)
  
  // Add timestamp for uniqueness
  const timestamp = Date.now().toString(36) // Base-36 for compactness
  
  // Format: sess-{hash}-{timestamp}
  return `sess-${identityHash}-${timestamp}`
}

/**
 * Generate a sandbox ID
 * Format: sc-{agentId}-{timestamp}
 */
export function generateSandboxId(agentId: string): string {
  const timestamp = Date.now().toString(36) // Base-36 timestamp
  const sanitizedAgentId = agentId.replace(/[^a-zA-Z0-9-]/g, '') // Remove special chars
  
  return `sc-${sanitizedAgentId}-${timestamp}`
}

/**
 * Validate ID format
 * Checks if the ID matches expected patterns
 */
export function isValidMemoryId(id: string): boolean {
  // Check for valid memory ID format: mem-{16-char hex}
  if (/^mem-[a-f0-9]{16}$/.test(id)) {
    return true
  }
  
  // Check for valid correlation ID format: UUID v4
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
    return true
  }
  
  // Check for valid session ID format: sess-{8-char hex}-{base36 timestamp}
  if (/^sess-[a-f0-9]{8}-[a-z0-9]+$/.test(id)) {
    return true
  }
  
  // Check for valid sandbox ID format: sc-{agentId}-{base36 timestamp}
  if (/^sc-[a-zA-Z0-9-]+-[a-z0-9]+$/.test(id)) {
    return true
  }
  
  return false
}

/**
 * Parse an ID and return its type and components
 */
export function parseId(id: string): {
  type: 'memory' | 'correlation' | 'session' | 'sandbox' | 'unknown'
  components?: Record<string, string>
} {
  if (id.startsWith('mem-')) {
    return {
      type: 'memory',
      components: { hash: id.substring(4) }
    }
  }
  
  if (id.startsWith('sess-')) {
    const parts = id.split('-')
    if (parts.length >= 3) {
      return {
        type: 'session',
        components: {
          identityHash: parts[1],
          timestamp: parts.slice(2).join('-')
        }
      }
    }
  }
  
  if (id.startsWith('sc-')) {
    const match = id.match(/^sc-(.+)-([a-z0-9]+)$/)
    if (match) {
      return {
        type: 'sandbox',
        components: {
          agentId: match[1],
          timestamp: match[2]
        }
      }
    }
  }
  
  // Check if it's a UUID (correlation ID)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
    return { type: 'correlation' }
  }
  
  return { type: 'unknown' }
}

/**
 * Generate a short hash for display purposes
 */
export function generateShortHash(input: string, length: number = 8): string {
  return createHash('sha256')
    .update(input, 'utf8')
    .digest('hex')
    .substring(0, length)
}

/**
 * Check if two memory contents would generate the same ID (deduplication check)
 */
export function wouldDuplicate(
  content1: Parameters<typeof generateMemoryId>[0],
  content2: Parameters<typeof generateMemoryId>[0]
): boolean {
  // Generate IDs with same timestamp to check content similarity
  const timestamp = Date.now()
  const id1 = generateMemoryId({ ...content1, timestamp })
  const id2 = generateMemoryId({ ...content2, timestamp })
  
  return id1 === id2
}