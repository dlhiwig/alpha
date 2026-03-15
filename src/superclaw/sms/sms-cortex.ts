/**
 * SMS CORTEX Integration
 * 
 * Handles SKYNET memory integration for SMS conversations
 * Provides persistent storage, context retrieval, and cross-channel awareness
 */

import { SMSMessage } from './sms-provider';
import { Contact, Conversation } from './sms-router';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface CortexConfig {
  memoryPath: string;
  archiveFormat: 'json' | 'markdown' | 'both';
  retentionPolicy: {
    conversationDays: number;
    contactDays: number;
    messageDays: number;
  };
  indexing: {
    enableFullText: boolean;
    enableEntityExtraction: boolean;
    enableSentimentAnalysis: boolean;
  };
  crossChannel: {
    enableWhatsAppSync: boolean;
    enableDiscordSync: boolean;
    enableEmailSync: boolean;
  };
}

export interface MessageArchive {
  id: string;
  messageId: string;
  conversationId: string;
  contactId: string;
  phoneNumber: string;
  direction: 'inbound' | 'outbound';
  content: string;
  timestamp: Date;
  metadata: {
    provider: string;
    status: string;
    segments: number;
    cost?: number;
    deliveryTime?: number;
  };
  context: {
    intent?: string;
    entities?: Record<string, any>;
    sentiment?: 'positive' | 'negative' | 'neutral';
    urgency?: 'low' | 'medium' | 'high' | 'critical';
    tags?: string[];
  };
  crossChannelRefs?: {
    whatsappMessageId?: string;
    discordMessageId?: string;
    emailMessageId?: string;
  };
}

export interface ConversationSummary {
  conversationId: string;
  contactId: string;
  phoneNumber: string;
  startTime: Date;
  endTime?: Date;
  duration: number; // in minutes
  messageCount: number;
  topics: string[];
  outcomes: string[];
  sentiment: 'positive' | 'negative' | 'neutral' | 'mixed';
  requiresFollowUp: boolean;
  summary: string;
}

export class SMSCortex {
  private config: CortexConfig;
  private memoryBasePath: string;
  private messageIndex: Map<string, MessageArchive> = new Map();
  private contactIndex: Map<string, Contact> = new Map();
  private conversationIndex: Map<string, ConversationSummary> = new Map();

  constructor(config: CortexConfig) {
    this.config = config;
    this.memoryBasePath = config.memoryPath;
    this.initializeMemoryStructure();
    this.loadExistingData();
  }

  /**
   * Archive SMS message to CORTEX memory
   */
  async archiveMessage(
    message: SMSMessage,
    contact: Contact,
    conversation: Conversation
  ): Promise<void> {
    try {
      const archive: MessageArchive = {
        id: this.generateArchiveId(),
        messageId: message.id || 'unknown',
        conversationId: conversation.id,
        contactId: contact.id,
        phoneNumber: contact.phoneNumber,
        direction: message.direction,
        content: message.body,
        timestamp: message.timestamp,
        metadata: {
          provider: 'twilio', // Could be dynamic
          status: message.status.toString(),
          segments: 1, // Could be extracted from metadata
          cost: message.metadata?.price ? parseFloat(message.metadata.price) : undefined,
        },
        context: {
          intent: conversation.context.intent,
          entities: conversation.context.entities,
          urgency: conversation.context.urgency,
          tags: contact.tags,
        },
      };

      // Add to index
      this.messageIndex.set(archive.id, archive);

      // Save to file system
      await this.saveMessageArchive(archive);

      // Update conversation summary
      await this.updateConversationSummary(conversation, archive);

      console.log(`Message archived: ${archive.id} from ${contact.phoneNumber}`);

    } catch (error: unknown) {
      console.error('Failed to archive message:', error);
      throw error;
    }
  }

  /**
   * Save or update contact in CORTEX
   */
  async saveContact(contact: Contact): Promise<void> {
    try {
      this.contactIndex.set(contact.phoneNumber, contact);
      
      const contactPath = path.join(
        this.memoryBasePath,
        'contacts',
        `${this.sanitizePhoneNumber(contact.phoneNumber)}.json`
      );
      
      await fs.writeFile(contactPath, JSON.stringify(contact, null, 2));
      
      console.log(`Contact saved: ${contact.phoneNumber}`);
      
    } catch (error: unknown) {
      console.error('Failed to save contact:', error);
      throw error;
    }
  }

  /**
   * Get contact by phone number
   */
  async getContact(phoneNumber: string): Promise<Contact | null> {
    try {
      // Check memory index first
      const contact = this.contactIndex.get(phoneNumber);
      if (contact) {
        return contact;
      }

      // Load from file system
      const contactPath = path.join(
        this.memoryBasePath,
        'contacts',
        `${this.sanitizePhoneNumber(phoneNumber)}.json`
      );

      try {
        const contactData = await fs.readFile(contactPath, 'utf-8');
        const loadedContact = JSON.parse(contactData) as Contact;
        
        // Convert date strings back to Date objects
        loadedContact.lastContact = new Date(loadedContact.lastContact);
        
        this.contactIndex.set(phoneNumber, loadedContact);
        return loadedContact;
      } catch (fileError) {
        // Contact doesn't exist
        return null;
      }

    } catch (error: unknown) {
      console.error('Failed to get contact:', error);
      return null;
    }
  }

  /**
   * Get conversation context for intelligent responses
   */
  async getConversationContext(conversationId: string): Promise<{
    recentMessages: MessageArchive[];
    contactHistory: MessageArchive[];
    relatedConversations: ConversationSummary[];
    crossChannelContext: any;
  }> {
    try {
      const recentMessages = await this.getRecentMessages(conversationId, 10);
      const contactHistory = await this.getContactMessageHistory(
        recentMessages[0]?.phoneNumber || '',
        50
      );
      const relatedConversations = await this.getRelatedConversations(conversationId);
      const crossChannelContext = await this.getCrossChannelContext(conversationId);

      return {
        recentMessages,
        contactHistory,
        relatedConversations,
        crossChannelContext,
      };

    } catch (error: unknown) {
      console.error('Failed to get conversation context:', error);
      return {
        recentMessages: [],
        contactHistory: [],
        relatedConversations: [],
        crossChannelContext: {},
      };
    }
  }

  /**
   * Search messages by text content
   */
  async searchMessages(query: string, options: {
    phoneNumber?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  } = {}): Promise<MessageArchive[]> {
    try {
      const results: MessageArchive[] = [];
      const queryLower = query.toLowerCase();

      for (const archive of this.messageIndex.values()) {
        // Text search
        if (!archive.content.toLowerCase().includes(queryLower)) {
          continue;
        }

        // Phone number filter
        if (options.phoneNumber && archive.phoneNumber !== options.phoneNumber) {
          continue;
        }

        // Date filters
        if (options.startDate && archive.timestamp < options.startDate) {
          continue;
        }
        if (options.endDate && archive.timestamp > options.endDate) {
          continue;
        }

        results.push(archive);
      }

      // Sort by timestamp (newest first)
      results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

      // Apply limit
      if (options.limit && results.length > options.limit) {
        return results.slice(0, options.limit);
      }

      return results;

    } catch (error: unknown) {
      console.error('Failed to search messages:', error);
      return [];
    }
  }

  /**
   * Generate conversation analytics
   */
  async generateAnalytics(timeRange: {
    start: Date;
    end: Date;
  }): Promise<{
    totalMessages: number;
    totalConversations: number;
    avgResponseTime: number;
    contactActivity: { phoneNumber: string; messageCount: number }[];
    sentimentDistribution: Record<string, number>;
    topKeywords: string[];
    urgencyDistribution: Record<string, number>;
  }> {
    try {
      const messages = Array.from(this.messageIndex.values())
        .filter(m => m.timestamp >= timeRange.start && m.timestamp <= timeRange.end);

      const conversations = new Set(messages.map(m => m.conversationId));
      
      const contactActivity = this.calculateContactActivity(messages);
      const sentimentDistribution = this.calculateSentimentDistribution(messages);
      const urgencyDistribution = this.calculateUrgencyDistribution(messages);
      const topKeywords = this.extractTopKeywords(messages);
      const avgResponseTime = this.calculateAverageResponseTime(messages);

      return {
        totalMessages: messages.length,
        totalConversations: conversations.size,
        avgResponseTime,
        contactActivity,
        sentimentDistribution,
        topKeywords,
        urgencyDistribution,
      };

    } catch (error: unknown) {
      console.error('Failed to generate analytics:', error);
      throw error;
    }
  }

  /**
   * Export conversation data for backup
   */
  async exportConversations(options: {
    format: 'json' | 'csv' | 'markdown';
    phoneNumber?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<string> {
    try {
      const messages = await this.searchMessages('', {
        phoneNumber: options.phoneNumber,
        startDate: options.startDate,
        endDate: options.endDate,
      });

      switch (options.format) {
        case 'json':
          return JSON.stringify(messages, null, 2);
        
        case 'csv':
          return this.convertToCSV(messages);
        
        case 'markdown':
          return this.convertToMarkdown(messages);
        
        default:
          throw new Error(`Unsupported export format: ${options.format}`);
      }

    } catch (error: unknown) {
      console.error('Failed to export conversations:', error);
      throw error;
    }
  }

  /**
   * Initialize memory directory structure
   */
  private async initializeMemoryStructure(): Promise<void> {
    const directories = [
      this.memoryBasePath,
      path.join(this.memoryBasePath, 'messages'),
      path.join(this.memoryBasePath, 'conversations'),
      path.join(this.memoryBasePath, 'contacts'),
      path.join(this.memoryBasePath, 'daily'),
      path.join(this.memoryBasePath, 'analytics'),
      path.join(this.memoryBasePath, 'backups'),
    ];

    for (const dir of directories) {
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch (error: unknown) {
        console.error(`Failed to create directory ${dir}:`, error);
      }
    }
  }

  /**
   * Load existing data from file system
   */
  private async loadExistingData(): Promise<void> {
    try {
      // Load contacts
      await this.loadContacts();
      
      // Load recent messages (last 30 days)
      await this.loadRecentMessages();
      
      console.log(`Loaded ${this.contactIndex.size} contacts and ${this.messageIndex.size} messages from CORTEX`);
      
    } catch (error: unknown) {
      console.error('Failed to load existing data:', error);
    }
  }

  /**
   * Load contacts from file system
   */
  private async loadContacts(): Promise<void> {
    try {
      const contactsDir = path.join(this.memoryBasePath, 'contacts');
      const files = await fs.readdir(contactsDir);

      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const filePath = path.join(contactsDir, file);
            const contactData = await fs.readFile(filePath, 'utf-8');
            const contact = JSON.parse(contactData) as Contact;
            
            // Convert date strings back to Date objects
            contact.lastContact = new Date(contact.lastContact);
            
            this.contactIndex.set(contact.phoneNumber, contact);
          } catch (error: unknown) {
            console.error(`Failed to load contact from ${file}:`, error);
          }
        }
      }
    } catch (error: unknown) {
      // Directory doesn't exist yet
    }
  }

  /**
   * Load recent messages from file system
   */
  private async loadRecentMessages(): Promise<void> {
    try {
      const messagesDir = path.join(this.memoryBasePath, 'messages');
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      // Load messages from the last 30 days
      for (let i = 0; i < 30; i++) {
        const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const dateStr = date.toISOString().split('T')[0];
        const dayFile = path.join(messagesDir, `${dateStr}.json`);

        try {
          const dayData = await fs.readFile(dayFile, 'utf-8');
          const messages = JSON.parse(dayData) as MessageArchive[];
          
          messages.forEach(msg => {
            msg.timestamp = new Date(msg.timestamp);
            this.messageIndex.set(msg.id, msg);
          });
        } catch (error: unknown) {
          // File doesn't exist for this day
        }
      }
    } catch (error: unknown) {
      // Directory doesn't exist yet
    }
  }

  /**
   * Save message archive to file system
   */
  private async saveMessageArchive(archive: MessageArchive): Promise<void> {
    const dateStr = archive.timestamp.toISOString().split('T')[0];
    const dayFile = path.join(this.memoryBasePath, 'messages', `${dateStr}.json`);

    try {
      let dayMessages: MessageArchive[] = [];
      
      try {
        const existingData = await fs.readFile(dayFile, 'utf-8');
        dayMessages = JSON.parse(existingData);
      } catch (error: unknown) {
        // File doesn't exist yet
      }

      dayMessages.push(archive);
      await fs.writeFile(dayFile, JSON.stringify(dayMessages, null, 2));

      // Also save to markdown if enabled
      if (this.config.archiveFormat === 'markdown' || this.config.archiveFormat === 'both') {
        await this.saveMessageAsMarkdown(archive);
      }

    } catch (error: unknown) {
      console.error('Failed to save message archive:', error);
      throw error;
    }
  }

  /**
   * Save message as markdown for human readability
   */
  private async saveMessageAsMarkdown(archive: MessageArchive): Promise<void> {
    const dateStr = archive.timestamp.toISOString().split('T')[0];
    const markdownFile = path.join(this.memoryBasePath, 'daily', `${dateStr}.md`);

    const messageMarkdown = `
## ${archive.direction === 'inbound' ? '📱' : '📤'} ${archive.phoneNumber} - ${archive.timestamp.toLocaleTimeString()}

**Message ID:** ${archive.messageId}  
**Conversation ID:** ${archive.conversationId}  
**Status:** ${archive.metadata.status}  
**Intent:** ${archive.context.intent || 'Unknown'}  
**Urgency:** ${archive.context.urgency || 'Low'}

${archive.content}

---
`;

    try {
      await fs.appendFile(markdownFile, messageMarkdown);
    } catch (error: unknown) {
      console.error('Failed to save markdown:', error);
    }
  }

  /**
   * Update conversation summary
   */
  private async updateConversationSummary(
    conversation: Conversation,
    newMessage: MessageArchive
  ): Promise<void> {
    let summary = this.conversationIndex.get(conversation.id);

    if (!summary) {
      summary = {
        conversationId: conversation.id,
        contactId: conversation.contactId,
        phoneNumber: conversation.phoneNumber,
        startTime: conversation.startTime,
        duration: 0,
        messageCount: 0,
        topics: [],
        outcomes: [],
        sentiment: 'neutral',
        requiresFollowUp: false,
        summary: '',
      };
    }

    // Update statistics
    summary.messageCount++;
    summary.duration = Math.round((newMessage.timestamp.getTime() - summary.startTime.getTime()) / (1000 * 60));

    // Extract topics from message content
    const topics = this.extractTopics(newMessage.content);
    summary.topics = [...new Set([...summary.topics, ...topics])];

    // Update sentiment
    if (newMessage.context.sentiment) {
      summary.sentiment = newMessage.context.sentiment;
    }

    this.conversationIndex.set(conversation.id, summary);
  }

  /**
   * Get recent messages for a conversation
   */
  private async getRecentMessages(conversationId: string, limit: number): Promise<MessageArchive[]> {
    return Array.from(this.messageIndex.values())
      .filter(m => m.conversationId === conversationId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * Get message history for a contact
   */
  private async getContactMessageHistory(phoneNumber: string, limit: number): Promise<MessageArchive[]> {
    return Array.from(this.messageIndex.values())
      .filter(m => m.phoneNumber === phoneNumber)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * Get related conversations
   */
  private async getRelatedConversations(conversationId: string): Promise<ConversationSummary[]> {
    const currentConv = this.conversationIndex.get(conversationId);
    if (!currentConv) return [];

    return Array.from(this.conversationIndex.values())
      .filter(c => c.phoneNumber === currentConv.phoneNumber && c.conversationId !== conversationId)
      .sort((a, b) => b.startTime.getTime() - a.startTime.getTime())
      .slice(0, 5);
  }

  /**
   * Get cross-channel context (placeholder for future implementation)
   */
  private async getCrossChannelContext(conversationId: string): Promise<any> {
    // This would integrate with WhatsApp, Discord, etc.
    return {
      whatsappMessages: [],
      discordMessages: [],
      emailMessages: [],
    };
  }

  /**
   * Helper methods for analytics
   */
  private calculateContactActivity(messages: MessageArchive[]): { phoneNumber: string; messageCount: number }[] {
    const activity = new Map<string, number>();
    
    messages.forEach(msg => {
      const current = activity.get(msg.phoneNumber) || 0;
      activity.set(msg.phoneNumber, current + 1);
    });

    return Array.from(activity.entries())
      .map(([phoneNumber, messageCount]) => ({ phoneNumber, messageCount }))
      .sort((a, b) => b.messageCount - a.messageCount);
  }

  private calculateSentimentDistribution(messages: MessageArchive[]): Record<string, number> {
    const distribution = { positive: 0, negative: 0, neutral: 0 };
    
    messages.forEach(msg => {
      const sentiment = msg.context.sentiment || 'neutral';
      distribution[sentiment]++;
    });

    return distribution;
  }

  private calculateUrgencyDistribution(messages: MessageArchive[]): Record<string, number> {
    const distribution = { low: 0, medium: 0, high: 0, critical: 0 };
    
    messages.forEach(msg => {
      const urgency = msg.context.urgency || 'low';
      distribution[urgency]++;
    });

    return distribution;
  }

  private extractTopKeywords(messages: MessageArchive[]): string[] {
    const wordCounts = new Map<string, number>();
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those']);

    messages.forEach(msg => {
      const words = msg.content.toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(word => word.length > 2 && !stopWords.has(word));

      words.forEach(word => {
        const current = wordCounts.get(word) || 0;
        wordCounts.set(word, current + 1);
      });
    });

    return Array.from(wordCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word]) => word);
  }

  private calculateAverageResponseTime(messages: MessageArchive[]): number {
    // Simple implementation - would need more sophisticated logic for actual response time calculation
    return 120; // seconds
  }

  private extractTopics(content: string): string[] {
    const topicKeywords = {
      'scheduling': ['schedule', 'meeting', 'appointment', 'calendar', 'time', 'date'],
      'support': ['help', 'issue', 'problem', 'question', 'support'],
      'urgent': ['urgent', 'asap', 'emergency', 'important', 'critical'],
      'personal': ['family', 'personal', 'private', 'home'],
      'work': ['work', 'business', 'office', 'project', 'client'],
    };

    const foundTopics: string[] = [];
    const contentLower = content.toLowerCase();

    Object.entries(topicKeywords).forEach(([topic, keywords]) => {
      if (keywords.some(keyword => contentLower.includes(keyword))) {
        foundTopics.push(topic);
      }
    });

    return foundTopics;
  }

  private convertToCSV(messages: MessageArchive[]): string {
    const headers = ['Timestamp', 'Phone Number', 'Direction', 'Content', 'Status', 'Intent', 'Urgency'];
    const rows = messages.map(msg => [
      msg.timestamp.toISOString(),
      msg.phoneNumber,
      msg.direction,
      `"${msg.content.replace(/"/g, '""')}"`,
      msg.metadata.status,
      msg.context.intent || '',
      msg.context.urgency || '',
    ]);

    return [headers, ...rows].map(row => row.join(',')).join('\n');
  }

  private convertToMarkdown(messages: MessageArchive[]): string {
    let markdown = `# SMS Conversation Export\n\nExported on ${new Date().toISOString()}\n\n`;

    const groupedByContact = messages.reduce((groups, msg) => {
      if (!groups[msg.phoneNumber]) {
        groups[msg.phoneNumber] = [];
      }
      groups[msg.phoneNumber].push(msg);
      return groups;
    }, {} as Record<string, MessageArchive[]>);

    Object.entries(groupedByContact).forEach(([phoneNumber, msgs]) => {
      markdown += `## ${phoneNumber}\n\n`;
      
      msgs.forEach(msg => {
        const icon = msg.direction === 'inbound' ? '📱' : '📤';
        markdown += `**${icon} ${msg.timestamp.toLocaleString()}** (${msg.metadata.status})\n`;
        markdown += `${msg.content}\n\n`;
      });

      markdown += '---\n\n';
    });

    return markdown;
  }

  private generateArchiveId(): string {
    return `archive_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private sanitizePhoneNumber(phoneNumber: string): string {
    return phoneNumber.replace(/[^\d]/g, '');
  }

  /**
   * Cleanup old data based on retention policy
   */
  public async cleanup(): Promise<void> {
    const now = new Date();
    const policy = this.config.retentionPolicy;

    // Clean up old messages
    const messageThreshold = new Date(now.getTime() - policy.messageDays * 24 * 60 * 60 * 1000);
    for (const [id, archive] of this.messageIndex.entries()) {
      if (archive.timestamp < messageThreshold) {
        this.messageIndex.delete(id);
      }
    }

    // Clean up old conversations
    const conversationThreshold = new Date(now.getTime() - policy.conversationDays * 24 * 60 * 60 * 1000);
    for (const [id, summary] of this.conversationIndex.entries()) {
      if (summary.startTime < conversationThreshold) {
        this.conversationIndex.delete(id);
      }
    }

    console.log('CORTEX cleanup completed');
  }
}