/**
 * SMS Provider Abstraction
 * 
 * Provides a unified interface for SMS operations across different providers
 * Currently supports Twilio with extensibility for other providers
 */


import { Request } from 'express';
import crypto from 'crypto';
import axios from 'axios';

export interface SMSMessage {
  id?: string;
  to: string;
  from: string;
  body: string;
  timestamp: Date;
  status: SMSMessageStatus;
  direction: 'inbound' | 'outbound';
  metadata?: Record<string, any>;
}

export interface SMSWebhookPayload {
  messageId: string;
  from: string;
  to: string;
  body: string;
  timestamp: string;
  accountSid?: string;
  messageSid?: string;
  numSegments?: string;
  status?: string;
}

export enum SMSMessageStatus {
  QUEUED = 'queued',
  SENDING = 'sending', 
  SENT = 'sent',
  RECEIVED = 'received',
  DELIVERED = 'delivered',
  UNDELIVERED = 'undelivered',
  FAILED = 'failed',
  READ = 'read'
}

export interface SMSSendOptions {
  statusCallback?: string;
  statusCallbackMethod?: 'POST' | 'GET';
  maxPrice?: string;
  provideFeedback?: boolean;
  validityPeriod?: number;
  forceDelivery?: boolean;
  smartEncoded?: boolean;
  persistentAction?: string[];
}

export interface SMSProviderConfig {
  provider: 'twilio' | 'aws-sns' | 'messagebird' | 'plivo';
  credentials: {
    accountSid?: string;
    authToken?: string;
    apiKey?: string;
    secretKey?: string;
  };
  fromNumber: string;
  webhookSecret?: string;
  baseUrl?: string;
}

export abstract class SMSProvider {
  protected config: SMSProviderConfig;

  constructor(config: SMSProviderConfig) {
    this.config = config;
  }

  /**
   * Send an SMS message
   */
  abstract sendSMS(to: string, message: string, options?: SMSSendOptions): Promise<SMSMessage>;

  /**
   * Process incoming webhook payload
   */
  abstract processWebhook(request: Request): Promise<SMSMessage>;

  /**
   * Validate webhook signature for security
   */
  abstract validateWebhookSignature(request: Request): boolean;

  /**
   * Get message status by ID
   */
  abstract getMessageStatus(messageId: string): Promise<SMSMessageStatus>;

  /**
   * Get message delivery details
   */
  abstract getMessageDetails(messageId: string): Promise<SMSMessage>;
}

export class TwilioProvider extends SMSProvider {
  private baseUrl = 'https://api.twilio.com/2010-04-01';

  constructor(config: SMSProviderConfig) {
    super(config);
    if (!config.credentials.accountSid || !config.credentials.authToken) {
      throw new Error('Twilio requires accountSid and authToken');
    }
  }

  async sendSMS(to: string, message: string, options: SMSSendOptions = {}): Promise<SMSMessage> {
    try {
      const auth = Buffer.from(
        `${this.config.credentials.accountSid}:${this.config.credentials.authToken}`
      ).toString('base64');

      const payload = new URLSearchParams({
        To: to,
        From: this.config.fromNumber,
        Body: message,
        ...(options.statusCallback && { StatusCallback: options.statusCallback }),
        ...(options.statusCallbackMethod && { StatusCallbackMethod: options.statusCallbackMethod }),
        ...(options.maxPrice && { MaxPrice: options.maxPrice }),
        ...(options.provideFeedback && { ProvideFeedback: 'true' }),
        ...(options.validityPeriod && { ValidityPeriod: options.validityPeriod.toString() }),
        ...(options.forceDelivery && { ForceDelivery: 'true' }),
        ...(options.smartEncoded && { SmartEncoded: 'true' }),
      });

      const response = await axios.post(
        `${this.baseUrl}/Accounts/${this.config.credentials.accountSid}/Messages.json`,
        payload,
        {
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      const twilioMessage = response.data;
      
      return {
        id: twilioMessage.sid,
        to: twilioMessage.to,
        from: twilioMessage.from,
        body: twilioMessage.body,
        timestamp: new Date(twilioMessage.date_created),
        status: this.mapTwilioStatus(twilioMessage.status),
        direction: 'outbound',
        metadata: {
          accountSid: twilioMessage.account_sid,
          numSegments: twilioMessage.num_segments,
          price: twilioMessage.price,
          priceUnit: twilioMessage.price_unit,
          uri: twilioMessage.uri,
        },
      };
    } catch (error: unknown) {
      console.error('Failed to send SMS via Twilio:', error);
      
      throw new Error(`SMS send failed: ${(error as Error).message}`);
    }
  }

  async processWebhook(request: Request): Promise<SMSMessage> {
    const payload = request.body as SMSWebhookPayload;
    
    return {
      id: payload.messageSid,
      to: payload.to,
      from: payload.from,
      body: payload.body,
      timestamp: new Date(payload.timestamp),
      status: SMSMessageStatus.RECEIVED,
      direction: 'inbound',
      metadata: {
        accountSid: payload.accountSid,
        numSegments: payload.numSegments,
      },
    };
  }

  validateWebhookSignature(request: Request): boolean {
    if (!this.config.webhookSecret) {
      console.warn('No webhook secret configured, skipping validation');
      return true;
    }

    const signature = request.headers['x-twilio-signature'] as string;
    if (!signature) {
      return false;
    }

    // Reconstruct the URL
    const protocol = request.headers['x-forwarded-proto'] || 'https';
    const host = request.headers.host;
    const url = `${protocol}://${host}${request.originalUrl}`;

    // Create the expected signature
    const params = new URLSearchParams();
    Object.keys(request.body).sort().forEach(key => {
      params.append(key, request.body[key]);
    });

    const data = url + params.toString();
    const expectedSignature = crypto
      .createHmac('sha1', this.config.credentials.authToken!)
      .update(data, 'utf8')
      .digest('base64');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(`sha1=${expectedSignature}`)
    );
  }

  async getMessageStatus(messageId: string): Promise<SMSMessageStatus> {
    try {
      const auth = Buffer.from(
        `${this.config.credentials.accountSid}:${this.config.credentials.authToken}`
      ).toString('base64');

      const response = await axios.get(
        `${this.baseUrl}/Accounts/${this.config.credentials.accountSid}/Messages/${messageId}.json`,
        {
          headers: {
            'Authorization': `Basic ${auth}`,
          },
        }
      );

      return this.mapTwilioStatus(response.data.status);
    } catch (error: unknown) {
      console.error(`Failed to get message status for ${messageId}:`, error);
      
      throw new Error(`Status check failed: ${(error as Error).message}`);
    }
  }

  async getMessageDetails(messageId: string): Promise<SMSMessage> {
    try {
      const auth = Buffer.from(
        `${this.config.credentials.accountSid}:${this.config.credentials.authToken}`
      ).toString('base64');

      const response = await axios.get(
        `${this.baseUrl}/Accounts/${this.config.credentials.accountSid}/Messages/${messageId}.json`,
        {
          headers: {
            'Authorization': `Basic ${auth}`,
          },
        }
      );

      const twilioMessage = response.data;
      
      return {
        id: twilioMessage.sid,
        to: twilioMessage.to,
        from: twilioMessage.from,
        body: twilioMessage.body,
        timestamp: new Date(twilioMessage.date_created),
        status: this.mapTwilioStatus(twilioMessage.status),
        direction: twilioMessage.direction === 'inbound' ? 'inbound' : 'outbound',
        metadata: {
          accountSid: twilioMessage.account_sid,
          numSegments: twilioMessage.num_segments,
          price: twilioMessage.price,
          priceUnit: twilioMessage.price_unit,
          uri: twilioMessage.uri,
          errorCode: twilioMessage.error_code,
          errorMessage: twilioMessage.error_message,
        },
      };
    } catch (error: unknown) {
      console.error(`Failed to get message details for ${messageId}:`, error);
      
      throw new Error(`Message details failed: ${(error as Error).message}`);
    }
  }

  private mapTwilioStatus(twilioStatus: string): SMSMessageStatus {
    const statusMap: Record<string, SMSMessageStatus> = {
      'queued': SMSMessageStatus.QUEUED,
      'sending': SMSMessageStatus.SENDING,
      'sent': SMSMessageStatus.SENT,
      'received': SMSMessageStatus.RECEIVED,
      'delivered': SMSMessageStatus.DELIVERED,
      'undelivered': SMSMessageStatus.UNDELIVERED,
      'failed': SMSMessageStatus.FAILED,
      'read': SMSMessageStatus.READ,
    };

    return statusMap[twilioStatus] || SMSMessageStatus.FAILED;
  }
}

/**
 * Factory function to create SMS provider instances
 */
export function createSMSProvider(config: SMSProviderConfig): SMSProvider {
  switch (config.provider) {
    case 'twilio':
      return new TwilioProvider(config);
    case 'aws-sns':
      throw new Error('AWS SNS provider not implemented yet');
    case 'messagebird':
      throw new Error('MessageBird provider not implemented yet');
    case 'plivo':
      throw new Error('Plivo provider not implemented yet');
    default:
      throw new Error(`Unsupported SMS provider: ${config.provider}`);
  }
}

/**
 * Default configuration for Twilio (to be loaded from environment)
 */
export function getDefaultSMSConfig(): SMSProviderConfig {
  return {
    provider: 'twilio',
    credentials: {
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
    },
    fromNumber: process.env.TWILIO_PHONE_NUMBER || '+15023531880', // From TOOLS.md
    webhookSecret: process.env.TWILIO_WEBHOOK_SECRET,
  };
}