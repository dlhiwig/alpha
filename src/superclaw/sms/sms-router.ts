// @ts-nocheck
/**
 * SMS Message Router
 * 
 * Routes messages, manages conversations, and handles contact management
 * Integrates with OpenClaw for intelligent response generation
 */

import { SMSMessage, SMSProvider, SMSMessageStatus } from './sms-provider';
import { SMSCortex } from './sms-cortex';

export interface Contact {
  id: string;
  phoneNumber: string;
  name?: string;
  email?: string;
  priority: ContactPriority;
  preferences: ContactPreferences;
  tags: string[];
  lastContact: Date;
  conversationHistory: string[];
  metadata: Record<string, any>;
}

export interface ContactPreferences {
  responseStyle: 'formal' | 'casual' | 'brief' | 'detailed';
  timezone?: string;
  language?: string;
  preferredChannel?: 'sms' | 'whatsapp' | 'email';
  quietHours?: {
    start: string; // HH:MM format
    end: string;   // HH:MM format
  };
  emergencyKeywords?: string[];
}

export enum ContactPriority {
  EMERGENCY = 'emergency',     // Immediate response required
  HIGH = 'high',              // VIP contacts, fast response
  NORMAL = 'normal',          // Standard response time
  LOW = 'low',               // Non-urgent, slower response
  BLOCKED = 'blocked'        // No automatic responses
}

export interface Conversation {
  id: string;
  contactId: string;
  phoneNumber: string;
  startTime: Date;
  lastActivity: Date;
  status: ConversationStatus;
  context: ConversationContext;
  messages: SMSMessage[];
  metadata: Record<string, any>;
}

export enum ConversationStatus {
  ACTIVE = 'active',
  WAITING = 'waiting',
  CLOSED = 'closed',
  ESCALATED = 'escalated'
}

export interface ConversationContext {
  topic?: string;
  intent?: string;
  entities?: Record<string, any>;
  crossChannelContext?: {
    whatsappConversationId?: string;
    discordChannelId?: string;
    emailThreadId?: string;
  };
  urgency: 'low' | 'medium' | 'high' | 'critical';
  requiresHumanIntervention: boolean;
}

export interface SMSRouterConfig {
  maxConcurrentConversations: number;
  conversationTimeoutMinutes: number;
  emergencyResponseTimeSeconds: number;
  normalResponseTimeSeconds: number;
  enableCrossChannelContext: boolean;
  enableAutoResponse: boolean;
  autoResponseRules: AutoResponseRule[];
}

export interface AutoResponseRule {
  id: string;
  name: string;
  conditions: {
    keywords?: string[];
    phoneNumbers?: string[];
    priority?: ContactPriority;
    timeOfDay?: { start: string; end: string };
  };
  action: {
    type: 'respond' | 'forward' | 'escalate' | 'ignore';
    template?: string;
    forwardTo?: string;
    escalateTo?: string;
  };
  enabled: boolean;
}

export class SMSRouter {
  private provider: SMSProvider;
  private cortex: SMSCortex;
  private config: SMSRouterConfig;
  private contacts: Map<string, Contact> = new Map();
  private conversations: Map<string, Conversation> = new Map();
  private responseQueue: Array<{ conversation: Conversation; message: SMSMessage }> = [];

  constructor(
    provider: SMSProvider,
    cortex: SMSCortex,
    config: SMSRouterConfig
  ) {
    this.provider = provider;
    this.cortex = cortex;
    this.config = config;
    this.initializeResponseProcessor();
  }

  /**
   * Route incoming SMS message
   */
  async routeIncomingMessage(message: SMSMessage): Promise<void> {
    try {
      // Get or create contact
      const contact = await this.getOrCreateContact(message.from);
      
      // Check if contact is blocked
      if (contact.priority === ContactPriority.BLOCKED) {
        console.log(`Ignoring message from blocked contact: ${message.from}`);
        return;
      }

      // Get or create conversation
      const conversation = await this.getOrCreateConversation(contact, message);
      
      // Add message to conversation
      conversation.messages.push(message);
      conversation.lastActivity = new Date();
      
      // Archive message in CORTEX
      await this.cortex.archiveMessage(message, contact, conversation);
      
      // Analyze message context
      await this.analyzeMessageContext(message, conversation);
      
      // Check for emergency keywords
      if (this.isEmergencyMessage(message, contact)) {
        conversation.context.urgency = 'critical';
        await this.handleEmergencyMessage(message, contact, conversation);
        return;
      }
      
      // Check auto-response rules
      const autoResponse = this.checkAutoResponseRules(message, contact);
      if (autoResponse) {
        await this.executeAutoResponse(autoResponse, message, contact, conversation);
        return;
      }
      
      // Queue for intelligent response
      this.responseQueue.push({ conversation, message });
      
      // Update contact activity
      contact.lastContact = new Date();
      this.contacts.set(contact.phoneNumber, contact);
      
    } catch (error: unknown) {
      console.error('Failed to route incoming message:', error);
      throw error;
    }
  }

  /**
   * Send outgoing SMS message
   */
  async sendMessage(
    to: string, 
    message: string, 
    conversationId?: string
  ): Promise<SMSMessage> {
    try {
      const sentMessage = await this.provider.sendSMS(to, message);
      
      // Find conversation and contact
      const contact = this.contacts.get(to);
      let conversation: Conversation | undefined;
      
      if (conversationId) {
        conversation = this.conversations.get(conversationId);
      } else if (contact) {
        conversation = Array.from(this.conversations.values())
          .find(c => c.contactId === contact.id && c.status === ConversationStatus.ACTIVE);
      }
      
      // Add to conversation if exists
      if (conversation) {
        conversation.messages.push(sentMessage);
        conversation.lastActivity = new Date();
      }
      
      // Archive in CORTEX
      if (contact && conversation) {
        await this.cortex.archiveMessage(sentMessage, contact, conversation);
      }
      
      return sentMessage;
      
    } catch (error: unknown) {
      console.error('Failed to send message:', error);
      throw error;
    }
  }

  /**
   * Get or create contact from phone number
   */
  private async getOrCreateContact(phoneNumber: string): Promise<Contact> {
    let contact = this.contacts.get(phoneNumber);
    
    if (!contact) {
      // Try to load from CORTEX first
      // @ts-expect-error - Post-Merge Reconciliation
      contact = await this.cortex.getContact(phoneNumber);
      
      if (!contact) {
        // Create new contact
        contact = {
          id: this.generateContactId(phoneNumber),
          phoneNumber,
          priority: ContactPriority.NORMAL,
          preferences: {
            responseStyle: 'casual',
            timezone: 'America/New_York',
            language: 'en',
          },
          tags: [],
          lastContact: new Date(),
          conversationHistory: [],
          metadata: {},
        };
        
        // Save to CORTEX
        await this.cortex.saveContact(contact);
      }
      
      this.contacts.set(phoneNumber, contact);
    }
    
    return contact;
  }

  /**
   * Get or create conversation
   */
  private async getOrCreateConversation(
    contact: Contact, 
    message: SMSMessage
  ): Promise<Conversation> {
    // Find active conversation for this contact
    let conversation = Array.from(this.conversations.values())
      .find(c => c.contactId === contact.id && c.status === ConversationStatus.ACTIVE);
    
    if (!conversation) {
      conversation = {
        id: this.generateConversationId(contact.phoneNumber),
        contactId: contact.id,
        phoneNumber: contact.phoneNumber,
        startTime: new Date(),
        lastActivity: new Date(),
        status: ConversationStatus.ACTIVE,
        context: {
          urgency: 'low',
          requiresHumanIntervention: false,
        },
        messages: [],
        metadata: {},
      };
      
      this.conversations.set(conversation.id, conversation);
    }
    
    return conversation;
  }

  /**
   * Analyze message context and intent
   */
  private async analyzeMessageContext(
    message: SMSMessage, 
    conversation: Conversation
  ): Promise<void> {
    try {
      // Simple keyword-based analysis (can be enhanced with NLP)
      const text = message.body.toLowerCase();
      
      // Detect urgency
      const urgentKeywords = ['urgent', 'asap', 'emergency', 'help', 'problem', 'issue'];
      if (urgentKeywords.some(keyword => text.includes(keyword))) {
        conversation.context.urgency = 'high';
      }
      
      // Detect intent categories
      if (text.includes('schedule') || text.includes('meeting') || text.includes('appointment')) {
        conversation.context.intent = 'scheduling';
      } else if (text.includes('question') || text.includes('?')) {
        conversation.context.intent = 'inquiry';
      } else if (text.includes('thank') || text.includes('thanks')) {
        conversation.context.intent = 'acknowledgment';
      }
      
      // Extract entities (simple regex-based)
      const dateMatches = text.match(/\d{1,2}\/\d{1,2}(?:\/\d{2,4})?/g);
      const timeMatches = text.match(/\d{1,2}:\d{2}(?:\s*(?:am|pm))?/gi);
      
      if (dateMatches || timeMatches) {
        conversation.context.entities = {
          ...conversation.context.entities,
          dates: dateMatches,
          times: timeMatches,
        };
      }
      
    } catch (error: unknown) {
      console.error('Failed to analyze message context:', error);
    }
  }

  /**
   * Check if message contains emergency keywords
   */
  private isEmergencyMessage(message: SMSMessage, contact: Contact): boolean {
    const text = message.body.toLowerCase();
    
    // Global emergency keywords
    const globalEmergencyKeywords = [
      'emergency', '911', 'urgent', 'help', 'crisis',
      'medical', 'accident', 'fire', 'police'
    ];
    
    // Contact-specific emergency keywords
    const contactEmergencyKeywords = contact.preferences.emergencyKeywords || [];
    
    const allKeywords = [...globalEmergencyKeywords, ...contactEmergencyKeywords];
    
    return allKeywords.some(keyword => text.includes(keyword));
  }

  /**
   * Handle emergency messages with immediate response
   */
  private async handleEmergencyMessage(
    message: SMSMessage,
    contact: Contact,
    conversation: Conversation
  ): Promise<void> {
    console.log(`EMERGENCY MESSAGE from ${contact.phoneNumber}: ${message.body}`);
    
    // Mark conversation as escalated
    conversation.status = ConversationStatus.ESCALATED;
    conversation.context.requiresHumanIntervention = true;
    
    // Send immediate acknowledgment
    const emergencyResponse = `I've received your urgent message and Daniel has been notified immediately. If this is a medical emergency, please call 911. I'll respond as quickly as possible.`;
    
    await this.sendMessage(contact.phoneNumber, emergencyResponse, conversation.id);
    
    // Alert all channels (WhatsApp, Discord, etc.)
    await this.alertEmergencyContact(message, contact);
    
    // Log to emergency log
    console.error('EMERGENCY CONTACT:', {
      contact: contact.phoneNumber,
      name: contact.name,
      message: message.body,
      timestamp: message.timestamp,
    });
  }

  /**
   * Alert emergency contact across all channels
   */
  private async alertEmergencyContact(message: SMSMessage, contact: Contact): Promise<void> {
    // This would integrate with other OpenClaw channels
    // For now, log the alert
    console.log(`Emergency alert sent for ${contact.phoneNumber}`);
    
    // TODO: Send to WhatsApp, Discord, email, etc.
    // TODO: Trigger phone call if configured
    // TODO: Send to emergency contacts list
  }

  /**
   * Check auto-response rules
   */
  private checkAutoResponseRules(
    message: SMSMessage, 
    contact: Contact
  ): AutoResponseRule | null {
    if (!this.config.enableAutoResponse) {
      return null;
    }
    
    for (const rule of this.config.autoResponseRules) {
      if (!rule.enabled) {continue;}
      
      if (this.ruleMatches(rule, message, contact)) {
        return rule;
      }
    }
    
    return null;
  }

  /**
   * Check if auto-response rule matches
   */
  private ruleMatches(
    rule: AutoResponseRule, 
    message: SMSMessage, 
    contact: Contact
  ): boolean {
    const conditions = rule.conditions;
    const messageText = message.body.toLowerCase();
    
    // Check keywords
    if (conditions.keywords && conditions.keywords.length > 0) {
      const hasKeyword = conditions.keywords.some(keyword => 
        messageText.includes(keyword.toLowerCase())
      );
      if (!hasKeyword) {return false;}
    }
    
    // Check phone numbers
    if (conditions.phoneNumbers && conditions.phoneNumbers.length > 0) {
      if (!conditions.phoneNumbers.includes(contact.phoneNumber)) {
        return false;
      }
    }
    
    // Check priority
    if (conditions.priority && contact.priority !== conditions.priority) {
      return false;
    }
    
    // Check time of day
    if (conditions.timeOfDay) {
      const now = new Date();
      const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      if (currentTime < conditions.timeOfDay.start || currentTime > conditions.timeOfDay.end) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Execute auto-response rule
   */
  private async executeAutoResponse(
    rule: AutoResponseRule,
    message: SMSMessage,
    contact: Contact,
    conversation: Conversation
  ): Promise<void> {
    try {
      switch (rule.action.type) {
        case 'respond':
          if (rule.action.template) {
            const response = this.renderTemplate(rule.action.template, { contact, message });
            await this.sendMessage(contact.phoneNumber, response, conversation.id);
          }
          break;
          
        case 'forward':
          if (rule.action.forwardTo) {
            const forwardMessage = `Forwarded from ${contact.phoneNumber}: ${message.body}`;
            await this.sendMessage(rule.action.forwardTo, forwardMessage);
          }
          break;
          
        case 'escalate':
          conversation.status = ConversationStatus.ESCALATED;
          conversation.context.requiresHumanIntervention = true;
          if (rule.action.escalateTo) {
            const escalateMessage = `Escalated conversation from ${contact.phoneNumber}: ${message.body}`;
            await this.sendMessage(rule.action.escalateTo, escalateMessage);
          }
          break;
          
        case 'ignore':
          console.log(`Ignoring message from ${contact.phoneNumber} due to rule: ${rule.name}`);
          break;
      }
      
    } catch (error: unknown) {
      console.error('Failed to execute auto-response:', error);
    }
  }

  /**
   * Simple template renderer
   */
  private renderTemplate(
    template: string, 
    data: { contact: Contact; message: SMSMessage }
  ): string {
    let rendered = template;
    
    // Replace variables
    rendered = rendered.replace(/\{contact\.name\}/g, data.contact.name || 'there');
    rendered = rendered.replace(/\{contact\.phoneNumber\}/g, data.contact.phoneNumber);
    rendered = rendered.replace(/\{message\.body\}/g, data.message.body);
    rendered = rendered.replace(/\{timestamp\}/g, new Date().toLocaleString());
    
    return rendered;
  }

  /**
   * Initialize response processor for intelligent responses
   */
  private initializeResponseProcessor(): void {
    setInterval(async () => {
      if (this.responseQueue.length > 0) {
        const item = this.responseQueue.shift();
        if (item) {
          await this.processIntelligentResponse(item.conversation, item.message);
        }
      }
    }, 1000); // Process queue every second
  }

  /**
   * Process intelligent response using OpenClaw
   */
  private async processIntelligentResponse(
    conversation: Conversation,
    message: SMSMessage
  ): Promise<void> {
    try {
      const contact = this.contacts.get(conversation.phoneNumber);
      if (!contact) {return;}
      
      // Get conversation context
      const context = await this.cortex.getConversationContext(conversation.id);
      
      // Generate response using OpenClaw (mock implementation)
      const response = await this.generateIntelligentResponse(message, context, contact);
      
      if (response) {
        await this.sendMessage(contact.phoneNumber, response, conversation.id);
      }
      
    } catch (error: unknown) {
      console.error('Failed to process intelligent response:', error);
    }
  }

  /**
   * Generate intelligent response (placeholder for OpenClaw integration)
   */
  private async generateIntelligentResponse(
    message: SMSMessage,
    context: any,
    contact: Contact
  ): Promise<string | null> {
    // This would integrate with OpenClaw's agent system
    // For now, return a simple acknowledgment
    
    const responses = [
      `Thanks for your message! I'm processing it and will get back to you soon.`,
      `Got your message. Let me think about this and respond shortly.`,
      `I received your message and I'm working on a response.`,
    ];
    
    return responses[Math.floor(Math.random() * responses.length)];
  }

  /**
   * Generate unique contact ID
   */
  private generateContactId(phoneNumber: string): string {
    return `contact_${phoneNumber.replace(/\D/g, '')}_${Date.now()}`;
  }

  /**
   * Generate unique conversation ID
   */
  private generateConversationId(phoneNumber: string): string {
    return `conv_${phoneNumber.replace(/\D/g, '')}_${Date.now()}`;
  }

  /**
   * Get conversation statistics
   */
  public getStats(): {
    totalContacts: number;
    activeConversations: number;
    queuedResponses: number;
    totalMessages: number;
  } {
    const totalMessages = Array.from(this.conversations.values())
      .reduce((sum, conv) => sum + conv.messages.length, 0);
    
    return {
      totalContacts: this.contacts.size,
      activeConversations: Array.from(this.conversations.values())
        .filter(c => c.status === ConversationStatus.ACTIVE).length,
      queuedResponses: this.responseQueue.length,
      totalMessages,
    };
  }

  /**
   * Clean up old conversations
   */
  public cleanupOldConversations(): void {
    const now = new Date();
    const timeoutMs = this.config.conversationTimeoutMinutes * 60 * 1000;
    
    for (const [id, conversation] of this.conversations.entries()) {
      if (now.getTime() - conversation.lastActivity.getTime() > timeoutMs) {
        if (conversation.status === ConversationStatus.ACTIVE) {
          conversation.status = ConversationStatus.CLOSED;
        }
        this.conversations.delete(id);
      }
    }
  }
}