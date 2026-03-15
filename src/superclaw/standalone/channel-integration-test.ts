/**
 * Channel Integration Test
 * SuperClaw Independence Sprint - Channel Integration
 * 
 * Simple test to verify the message flow:
 * Telegram → Channel Bridge → Gateway → Ollama → Response → Telegram
 */

import { ChannelBridge, ChannelBridgeConfig } from './channel-bridge';
import { TelegramConfig } from '../channels/contracts';

// Test configuration
const TEST_CONFIG: ChannelBridgeConfig = {
  gatewayUrl: 'http://localhost:3737',
  sessionTimeout: 30 * 60 * 1000, // 30 minutes
  debug: true,
  channels: [
    {
      platform: 'telegram',
      enabled: true,
      config: {
        id: 'telegram-test',
        platform: 'telegram',
        credentialsPath: './test-credentials/telegram.json',
        botToken: '8596335577:AAFzNixwLFEWMsvmJa6lKUw40aujQ70KFQ0', // Test token from requirements
        allowedUsers: [], // Allow all for testing
        adminUserId: '',
        pollingInterval: 1000,
        debug: true
      } as TelegramConfig
    }
  ]
};

/**
 * Mock Gateway API for testing (if gateway isn't running)
 */
class MockGatewayAPI {
  async chat(message: string, sessionId: string): Promise<string> {
    console.log(`🤖 Mock Gateway received: "${message}" (session: ${sessionId})`);
    
    // Simple echo with some processing
    const responses = [
      `I received your message: "${message}". I'm SuperClaw running on Ollama!`,
      `Hello! You said: "${message}". This is coming from the local LLM through the Gateway.`,
      `Thanks for testing! Your message was: "${message}". The integration is working! 🎉`
    ];
    
    const response = responses[Math.floor(Math.random() * responses.length)];
    console.log(`🤖 Mock Gateway responding: "${response}"`);
    
    return response;
  }

  async createSession(userId: string, platform: string): Promise<string> {
    const sessionId = `test-${platform}-${userId}-${Date.now()}`;
    console.log(`🆔 Mock Gateway created session: ${sessionId}`);
    return sessionId;
  }
}

/**
 * Check if the real gateway is available
 */
async function isGatewayAvailable(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${url}/health`, {
      method: 'GET',
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response.ok;
  } catch (error: unknown) {
    return false;
  }
}

/**
 * Main test function
 */
async function runIntegrationTest(): Promise<void> {
  console.log('🧪 Starting Channel Integration Test...');
  console.log('📋 Test Plan:');
  console.log('   1. Initialize Telegram connector');
  console.log('   2. Connect to Telegram Bot API');
  console.log('   3. Setup message routing to Gateway');
  console.log('   4. Wait for incoming messages');
  console.log('   5. Route messages through Gateway/LLM');
  console.log('   6. Send responses back to Telegram');
  console.log('');

  // Check if real gateway is available
  const gatewayAvailable = await isGatewayAvailable(TEST_CONFIG.gatewayUrl);
  
  if (gatewayAvailable) {
    console.log('✅ Real Gateway detected - using live Gateway + Ollama');
  } else {
    console.log('⚠️  Gateway not available - using Mock Gateway for testing');
    console.log('   Start the gateway first with:');
    console.log('   npx ts-node src/standalone/index.ts start');
    console.log('');
  }

  try {
    // Create bridge with optional mock API
    const mockApi = gatewayAvailable ? undefined : new MockGatewayAPI();
    const bridge = new ChannelBridge(TEST_CONFIG, mockApi);

    // Setup graceful shutdown
    const shutdown = async () => {
      console.log('\n🛑 Shutting down test...');
      await bridge.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Initialize and start bridge
    await bridge.initialize();
    await bridge.start();

    console.log('🎯 Integration test is running!');
    console.log('📱 Send a message to your Telegram bot to test the flow:');
    console.log('   Bot: @YourBotName (using token: 8596335577:AAFzNixwLFEWMsvmJa6lKUw40aujQ70KFQ0)');
    console.log('');
    console.log('Expected flow:');
    console.log('   Your Telegram message → SuperClaw → Gateway → Ollama → Response → Your Telegram');
    console.log('');
    console.log('Press Ctrl+C to stop the test');

    // Keep the test running
    setInterval(() => {
      const status = bridge.getStatus();
      if (status.isRunning) {
        console.log(`📊 Status: ${status.connectors.length} connectors, ${status.activeSessions} active sessions`);
      }
    }, 60000); // Status update every minute

  } catch (error: unknown) {
    console.error('❌ Integration test failed:', error);
    
    if ((error as Error).message?.includes('bot token')) {
      console.log('');
      console.log('💡 Troubleshooting:');
      console.log('   1. Verify the bot token is correct');
      console.log('   2. Make sure the bot is created and active in Telegram');
      console.log('   3. Check network connectivity');
    }
    
    process.exit(1);
  }
}

// Run test if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runIntegrationTest().catch((error) => {
    console.error('❌ Fatal test error:', error);
    process.exit(1);
  });
}

export { runIntegrationTest };