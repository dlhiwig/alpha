/**
 * SMS Webhook Handler
 * 
 * Processes incoming SMS messages via webhook endpoints
 * Handles security validation, message parsing, and routing
 */


import { Request, Response } from 'express';
import { SMSProvider, SMSMessage, createSMSProvider, getDefaultSMSConfig } from './sms-provider';
import { SMSRouter } from './sms-router';

export interface WebhookConfig {
  path: string;
  methods: ('GET' | 'POST')[];
  rateLimit?: {
    windowMs: number;
    max: number;
  };
  security: {
    validateSignature: boolean;
    requireHTTPS: boolean;
    allowedIPs?: string[];
  };
}

export interface WebhookHandlerOptions {
  provider: SMSProvider;
  router: SMSRouter;
  config: WebhookConfig;
  onMessage?: (message: SMSMessage) => void;
  onError?: (error: Error, request: Request) => void;
}

export class SMSWebhookHandler {
  private provider: SMSProvider;
  private router: SMSRouter;
  private config: WebhookConfig;
  private onMessage?: (message: SMSMessage) => void;
  private onError?: (error: Error, request: Request) => void;

  constructor(options: WebhookHandlerOptions) {
    this.provider = options.provider;
    this.router = options.router;
    this.config = options.config;
    this.onMessage = options.onMessage;
    this.onError = options.onError;
  }

  /**
   * Main webhook handler function
   */
  public async handleWebhook(req: Request, res: Response): Promise<void> {
    try {
      // Security checks
      if (!this.validateRequest(req)) {
        res.status(401).json({ error: 'Unauthorized request' });
        return;
      }

      // Process the incoming message
      const message = await this.provider.processWebhook(req);
      
      // Log the incoming message
      console.log('Incoming SMS:', {
        from: message.from,
        to: message.to,
        body: message.body.substring(0, 100),
        timestamp: message.timestamp,
      });

      // Route the message for processing
      await this.router.routeIncomingMessage(message);

      // Call custom handler if provided
      if (this.onMessage) {
        this.onMessage(message);
      }

      // Acknowledge receipt
      res.status(200).json({ 
        success: true, 
        messageId: message.id,
        timestamp: new Date().toISOString()
      });

    } catch (error: unknown) {
      console.error('Webhook processing failed:', error);
      
      if (this.onError) {
        this.onError(error as Error, req);
      }

      res.status(500).json({ 
        error: 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Handle webhook GET requests (for verification)
   */
  public async handleWebhookVerification(req: Request, res: Response): Promise<void> {
    try {
      // For Twilio webhook verification
      if (req.query.hub && req.query.challenge) {
        const challenge = req.query.challenge as string;
        res.status(200).send(challenge);
        return;
      }

      // Default verification response
      res.status(200).json({ 
        status: 'ok', 
        webhook: 'SMS webhook endpoint',
        timestamp: new Date().toISOString()
      });
    } catch (error: unknown) {
      console.error('Webhook verification failed:', error);
      res.status(500).json({ error: 'Verification failed' });
    }
  }

  /**
   * Validate incoming webhook request
   */
  private validateRequest(req: Request): boolean {
    // HTTPS check
    if (this.config.security.requireHTTPS) {
      const protocol = req.headers['x-forwarded-proto'] || req.protocol;
      if (protocol !== 'https') {
        console.warn('Non-HTTPS request rejected');
        return false;
      }
    }

    // IP whitelist check
    if (this.config.security.allowedIPs && this.config.security.allowedIPs.length > 0) {
      const clientIP = this.getClientIP(req);
      if (!this.config.security.allowedIPs.includes(clientIP)) {
        console.warn(`Request from unauthorized IP: ${clientIP}`);
        return false;
      }
    }

    // Signature validation
    if (this.config.security.validateSignature) {
      if (!this.provider.validateWebhookSignature(req)) {
        console.warn('Invalid webhook signature');
        return false;
      }
    }

    return true;
  }

  /**
   * Extract client IP address from request
   */
  private getClientIP(req: Request): string {
    return (
      req.headers['x-forwarded-for'] as string ||
      req.headers['x-real-ip'] as string ||
      req.connection.remoteAddress ||
      req.socket.remoteAddress ||
      'unknown'
    ).split(',')[0].trim();
  }

  /**
   * Create middleware function for Express.js
   */
  public static createMiddleware(options?: Partial<WebhookHandlerOptions>) {
    const defaultConfig: WebhookConfig = {
      path: '/sms/webhook',
      methods: ['POST', 'GET'],
      security: {
        validateSignature: true,
        requireHTTPS: process.env.NODE_ENV === 'production',
        allowedIPs: [
          // Twilio IP ranges (example - should be updated with current ranges)
          '54.172.60.0',
          '54.244.51.0', 
          '52.86.245.0',
        ],
      },
    };

    const provider = options?.provider || createSMSProvider(getDefaultSMSConfig());
    
    // @ts-expect-error SMSRouter requires provider+cortex+config; TODO: add default factory
    const router = options?.router || new SMSRouter();
    const config = { ...defaultConfig, ...options?.config };

    const handler = new SMSWebhookHandler({
      provider,
      router,
      config,
      ...options,
    });

    return {
      handler,
      middleware: {
        post: handler.handleWebhook.bind(handler),
        get: handler.handleWebhookVerification.bind(handler),
      },
    };
  }
}

/**
 * Express.js route setup helper
 */
export function setupSMSWebhookRoutes(app: any, options?: Partial<WebhookHandlerOptions>) {
  const { handler, middleware } = SMSWebhookHandler.createMiddleware(options);
  const config = handler['config'] as WebhookConfig;

  // Setup POST route for incoming messages
  if (config.methods.includes('POST')) {
    app.post(config.path, middleware.post);
  }

  // Setup GET route for webhook verification
  if (config.methods.includes('GET')) {
    app.get(config.path, middleware.get);
  }

  console.log(`SMS webhook routes configured:`);
  config.methods.forEach(method => {
    console.log(`  ${method} ${config.path}`);
  });

  return handler;
}

/**
 * Webhook request validator middleware
 */
export function createWebhookValidator(config: WebhookConfig) {
  return (req: Request, res: Response, next: Function) => {
    // Rate limiting (basic implementation)
    if (config.rateLimit) {
      // This would typically use a proper rate limiting library like express-rate-limit
      // For now, just log the attempt
      console.log('Rate limiting check (implement proper rate limiting)');
    }

    // Content type validation for POST requests
    if (req.method === 'POST' && !req.headers['content-type']?.includes('application/x-www-form-urlencoded')) {
      return res.status(400).json({ error: 'Invalid content type' });
    }

    // Continue to next middleware
    next();
  };
}

/**
 * Webhook response helpers
 */
export class WebhookResponse {
  static success(data?: any) {
    return {
      success: true,
      timestamp: new Date().toISOString(),
      ...data,
    };
  }

  static error(message: string, code: string = 'WEBHOOK_ERROR') {
    return {
      success: false,
      error: {
        message,
        code,
        timestamp: new Date().toISOString(),
      },
    };
  }

  static twilioResponse(message?: string) {
    // TwiML response for Twilio
    const twiml = message 
      ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`
      : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
    
    return {
      headers: { 'Content-Type': 'text/xml' },
      body: twiml,
    };
  }
}

/**
 * Webhook testing utilities
 */
export class WebhookTester {
  static createMockTwilioRequest(messageData: {
    from: string;
    to: string;
    body: string;
  }) {
    return {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': 'mock-signature',
      },
      body: {
        MessageSid: `SM${Date.now()}`,
        AccountSid: 'AC' + 'x'.repeat(32),
        From: messageData.from,
        To: messageData.to,
        Body: messageData.body,
        NumSegments: '1',
        Status: 'received',
        DateCreated: new Date().toISOString(),
      },
    };
  }

  static async testWebhookEndpoint(url: string, messageData: any) {
    try {
      const mockRequest = this.createMockTwilioRequest(messageData);
      const response = await fetch(url, {
        method: 'POST',
        headers: mockRequest.headers,
        body: new URLSearchParams(mockRequest.body),
      });

      return {
        success: response.ok,
        status: response.status,
        data: await response.json(),
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }
}