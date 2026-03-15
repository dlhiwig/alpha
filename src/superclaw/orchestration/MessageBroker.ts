import { EventEmitter } from 'events'
import { generateCorrelationId } from '../memory/hash-id-generator'
import type {
  InterAgentMessage,
  MessageType,
  MessageFilter,
  MessageHandler
} from './types'

/**
 * Message acknowledgment status
 */
interface MessageAck {
  messageId: string
  acknowledgedAt: Date
  agentId: string
}

/**
 * Pending reply tracking for sendAndWait operations
 */
interface PendingReply {
  resolve: (msg: InterAgentMessage) => void
  reject: (error: Error) => void
  timeoutId: NodeJS.Timeout
  correlationId: string
}

/**
 * Subscription entry for message handlers
 */
interface Subscription {
  agentId: string
  handler: MessageHandler
  messageType?: MessageType // undefined means subscribe to all types
}

/**
 * High-performance inter-agent messaging system with reliable delivery.
 * 
 * Features:
 * - Async message passing with correlation tracking
 * - Request/reply patterns with timeout handling
 * - Message filtering and history
 * - Event-driven real-time updates
 * - Automatic cleanup and memory management
 */
export class MessageBroker extends EventEmitter {
  private inboxes: Map<string, InterAgentMessage[]> = new Map()
  private subscriptions: Map<string, Subscription[]> = new Map()
  private pendingReplies: Map<string, PendingReply> = new Map()
  private messageLog: InterAgentMessage[] = []
  private acknowledgments: Map<string, MessageAck> = new Map()
  private maxLogSize: number = 10000
  private defaultTimeoutMs: number = 30000 // 30 seconds
  private cleanupInterval?: NodeJS.Timeout
  private isInitialized = false
  
  constructor(options?: { maxLogSize?: number; defaultTimeoutMs?: number }) {
    super()
    this.maxLogSize = options?.maxLogSize || 10000
    this.defaultTimeoutMs = options?.defaultTimeoutMs || 30000
  }
  
  async initialize(): Promise<void> {
    // Set up periodic cleanup
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000) // Cleanup every minute
    this.isInitialized = true
  }
  
  get initialized(): boolean {
    return this.isInitialized
  }
  
  /**
   * Send a message to another agent
   */
  async sendMessage<T = any>(
    from: string,
    to: string,
    type: MessageType,
    payload: T,
    options?: { correlationId?: string; replyTo?: string }
  ): Promise<string> {
    const message: InterAgentMessage<T> = {
      id: generateCorrelationId(),
      type,
      from,
      senderId: from, // Add required senderId field
      to,
      payload,
      timestamp: new Date(),
      correlationId: options?.correlationId || generateCorrelationId(),
      replyTo: options?.replyTo
    }
    
    // Store in recipient's inbox
    if (!this.inboxes.has(to)) {
      this.inboxes.set(to, [])
    }
    this.inboxes.get(to)!.push(message)
    
    // Log the message
    this.messageLog.push(message)
    this.trimLog()
    
    // Check for pending reply handlers - match by correlationId for sendAndWait
    if (message.correlationId && this.pendingReplies.has(message.correlationId)) {
      const pending = this.pendingReplies.get(message.correlationId)!
      clearTimeout(pending.timeoutId)
      this.pendingReplies.delete(message.correlationId)
      pending.resolve(message)
    }
    
    // Trigger subscriptions
    await this.triggerHandlers(message)
    
    // Emit event for real-time listeners
    this.emit('message', message)
    this.emit(`message:${to}`, message)
    this.emit(`message:${type}`, message)
    
    return message.id
  }
  
  /**
   * Send a message and wait for a reply
   */
  async sendAndWait<T = any, R = any>(
    from: string,
    to: string,
    type: MessageType,
    payload: T,
    timeoutMs?: number
  ): Promise<R> {
    const timeout = timeoutMs || this.defaultTimeoutMs
    const correlationId = generateCorrelationId()
    
    return new Promise<R>((resolve, reject) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        this.pendingReplies.delete(correlationId)
        reject(new Error(`Message timeout after ${timeout}ms waiting for reply from ${to}`))
      }, timeout)
      
      // Track pending reply
      this.pendingReplies.set(correlationId, {
        resolve: (msg: InterAgentMessage) => resolve(msg.payload as R),
        reject,
        timeoutId,
        correlationId
      })
      
      // Send the message
      this.sendMessage(from, to, type, payload, { correlationId })
        .catch((error) => {
          clearTimeout(timeoutId)
          this.pendingReplies.delete(correlationId)
          reject(error)
        })
    })
  }
  
  /**
   * Subscribe to all messages for an agent
   */
  subscribe(agentId: string, handler: MessageHandler): () => void {
    if (!this.subscriptions.has(agentId)) {
      this.subscriptions.set(agentId, [])
    }
    
    const subscription: Subscription = { agentId, handler }
    this.subscriptions.get(agentId)!.push(subscription)
    
    // Return unsubscribe function
    return () => {
      const subscriptions = this.subscriptions.get(agentId)
      if (subscriptions) {
        const index = subscriptions.indexOf(subscription)
        if (index !== -1) {
          subscriptions.splice(index, 1)
        }
        if (subscriptions.length === 0) {
          this.subscriptions.delete(agentId)
        }
      }
    }
  }
  
  /**
   * Subscribe to specific message type for an agent
   */
  subscribeToType(agentId: string, type: MessageType, handler: MessageHandler): () => void {
    if (!this.subscriptions.has(agentId)) {
      this.subscriptions.set(agentId, [])
    }
    
    const subscription: Subscription = { agentId, handler, messageType: type }
    this.subscriptions.get(agentId)!.push(subscription)
    
    // Return unsubscribe function
    return () => {
      const subscriptions = this.subscriptions.get(agentId)
      if (subscriptions) {
        const index = subscriptions.indexOf(subscription)
        if (index !== -1) {
          subscriptions.splice(index, 1)
        }
        if (subscriptions.length === 0) {
          this.subscriptions.delete(agentId)
        }
      }
    }
  }
  
  /**
   * Get messages from an agent's inbox with optional filtering
   */
  async getMessages(agentId: string, filter?: MessageFilter): Promise<InterAgentMessage[]> {
    const inbox = this.inboxes.get(agentId) || []
    
    if (!filter) {
      return [...inbox] // Return copy to prevent external modification
    }
    
    return inbox.filter(msg => {
      if (filter.type && msg.type !== filter.type) {return false}
      if (filter.from && msg.from !== filter.from) {return false}
      if (filter.since && msg.timestamp < filter.since) {return false}
      if (filter.correlationId && msg.correlationId !== filter.correlationId) {return false}
      return true
    })
  }
  
  /**
   * Mark a message as acknowledged/processed
   */
  async acknowledgeMessage(messageId: string): Promise<void> {
    // Find the message in any inbox to get the recipient
    let agentId: string | undefined
    for (const [agent, inbox] of this.inboxes) {
      if (inbox.some(msg => msg.id === messageId)) {
        agentId = agent
        break
      }
    }
    
    if (!agentId) {
      throw new Error(`Message ${messageId} not found in any inbox`)
    }
    
    const ack: MessageAck = {
      messageId,
      acknowledgedAt: new Date(),
      agentId
    }
    
    this.acknowledgments.set(messageId, ack)
    this.emit('acknowledged', ack)
  }
  
  /**
   * Send a message to multiple agents
   */
  async broadcast(from: string, type: MessageType, payload: any, targets: string[]): Promise<void> {
    const promises = targets.map(target => 
      this.sendMessage(from, target, type, payload)
    )
    
    await Promise.all(promises)
  }
  
  /**
   * Get filtered message history
   */
  getMessageHistory(filter?: { from?: string; to?: string; type?: MessageType }): InterAgentMessage[] {
    if (!filter) {
      return [...this.messageLog] // Return copy
    }
    
    return this.messageLog.filter(msg => {
      if (filter.from && msg.from !== filter.from) {return false}
      if (filter.to && msg.to !== filter.to) {return false}
      if (filter.type && msg.type !== filter.type) {return false}
      return true
    })
  }
  
  /**
   * Clear an agent's inbox
   */
  clearInbox(agentId: string): void {
    this.inboxes.delete(agentId)
    this.emit('inbox_cleared', { agentId })
  }
  
  /**
   * Get statistics about the message broker
   */
  getStats(): {
    totalMessages: number
    totalInboxes: number
    totalSubscriptions: number
    pendingReplies: number
    acknowledgments: number
  } {
    return {
      totalMessages: this.messageLog.length,
      totalInboxes: this.inboxes.size,
      totalSubscriptions: Array.from(this.subscriptions.values()).reduce((sum, subs) => sum + subs.length, 0),
      pendingReplies: this.pendingReplies.size,
      acknowledgments: this.acknowledgments.size
    }
  }
  
  /**
   * Check if a message has been acknowledged
   */
  isAcknowledged(messageId: string): boolean {
    return this.acknowledgments.has(messageId)
  }
  
  /**
   * Get unacknowledged messages for an agent
   */
  getUnacknowledgedMessages(agentId: string): InterAgentMessage[] {
    const inbox = this.inboxes.get(agentId) || []
    return inbox.filter(msg => !this.acknowledgments.has(msg.id))
  }
  
  /**
   * Remove all data for an agent (cleanup on agent shutdown)
   */
  removeAgent(agentId: string): void {
    // Clear inbox
    this.inboxes.delete(agentId)
    
    // Remove subscriptions
    this.subscriptions.delete(agentId)
    
    // Cancel any pending replies from this agent
    for (const [correlationId, pending] of this.pendingReplies) {
      // Find messages this agent sent that are awaiting replies
      const relatedMessage = this.messageLog.find(msg => 
        msg.from === agentId && msg.correlationId === correlationId
      )
      if (relatedMessage) {
        clearTimeout(pending.timeoutId)
        this.pendingReplies.delete(correlationId)
        pending.reject(new Error(`Agent ${agentId} disconnected before reply received`))
      }
    }
    
    this.emit('agent_removed', { agentId })
  }
  
  /**
   * Trigger message handlers for subscribed agents
   */
  private async triggerHandlers(message: InterAgentMessage): Promise<void> {
    const agentSubscriptions = this.subscriptions.get(message.to) || []
    
    // Process all matching subscriptions
    const handlerPromises = agentSubscriptions
      .filter(sub => !sub.messageType || sub.messageType === message.type)
      .map(async (sub) => {
        try {
          await sub.handler(message)
        } catch (error: unknown) {
          this.emit('handler_error', { 
            agentId: sub.agentId, 
            messageId: message.id, 
            error 
          })
        }
      })
    
    await Promise.all(handlerPromises)
  }
  
  /**
   * Trim message log to prevent memory leaks
   */
  private trimLog(): void {
    if (this.messageLog.length > this.maxLogSize) {
      this.messageLog = this.messageLog.slice(-this.maxLogSize)
    }
  }
  
  /**
   * Periodic cleanup of old data
   */
  private cleanup(): void {
    const now = Date.now()
    const cleanupAgeMs = 24 * 60 * 60 * 1000 // 24 hours
    
    // Clean up old acknowledgments
    for (const [messageId, ack] of this.acknowledgments) {
      if (now - ack.acknowledgedAt.getTime() > cleanupAgeMs) {
        this.acknowledgments.delete(messageId)
      }
    }
    
    // Clean up old messages from inboxes (keep only recent ones)
    for (const [agentId, inbox] of this.inboxes) {
      const recentMessages = inbox.filter(msg => 
        now - msg.timestamp.getTime() < cleanupAgeMs
      )
      if (recentMessages.length < inbox.length) {
        this.inboxes.set(agentId, recentMessages)
      }
    }
    
    this.emit('cleanup_complete', { 
      acknowledgementsRemoved: this.acknowledgments.size,
      timestamp: new Date()
    })
  }
  
  /**
   * Graceful shutdown - clean up all resources
   */
  async shutdown(): Promise<void> {
    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = undefined
    }
    
    // Clear all timeouts
    for (const [correlationId, pending] of this.pendingReplies) {
      clearTimeout(pending.timeoutId)
      pending.reject(new Error('MessageBroker shutting down'))
    }
    
    // Clear all data
    this.inboxes.clear()
    this.subscriptions.clear()
    this.pendingReplies.clear()
    this.messageLog.length = 0
    this.acknowledgments.clear()
    
    // Remove all listeners
    this.removeAllListeners()
    
    this.isInitialized = false
    this.emit('shutdown_complete')
  }
}