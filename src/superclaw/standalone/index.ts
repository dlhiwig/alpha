#!/usr/bin/env node
// @ts-nocheck

import 'dotenv/config';
import { SuperClawGateway } from './gateway.js';
import { ChannelBridge, ChannelBridgeConfig, ChannelConfig } from './channel-bridge.js';
import { SupportedPlatform, TelegramConfig, WhatsAppConfig, SignalConfig } from '../channels/contracts.js';
import { 
  startPulse, stopPulse, 
  startSentinel, stopSentinel,
  startOracle, stopOracle,
  startNexus, stopNexus,
  startCortex, stopCortex,
  initSelfEvolve,
} from '../skynet/index.js';

interface StartOptions {
  port?: number;
  host?: string;
  channels?: string[]; // e.g. ['telegram', 'whatsapp']
}

class SuperClawStandalone {
  private gateway: SuperClawGateway | null = null;
  private channelBridge: ChannelBridge | null = null;
  private shutdownHandlers: Array<() => Promise<void>> = [];

  async start(options: StartOptions = {}): Promise<void> {
    const { port = 3737, host = '127.0.0.1', channels = [] } = options;

    try {
      console.log('🚀 Starting SuperClaw Standalone...');
      
      // Initialize gateway
      this.gateway = new SuperClawGateway();
      
      // Setup graceful shutdown
      this.setupGracefulShutdown();
      
      // Start the gateway
      await this.gateway.start(port, host);
      
      console.log(`✅ SuperClaw Gateway is running on http://${host}:${port}`);
      console.log(`   Health check: http://${host}:${port}/health`);
      console.log(`   Chat API: http://${host}:${port}/v1/chat`);
      console.log(`   WebSocket: ws://${host}:${port}/ws`);
      
      // 🦊 SKYNET PROTOCOL — Start all waves
      console.log('\n🦊 Initializing SKYNET PROTOCOL (All 5 Waves)...');
      
      // Wave 1: SURVIVE
      await startPulse();
      
      // Wave 2: WATCH
      await startSentinel();
      
      // Wave 3: ADAPT
      await startOracle();
      
      // Wave 4: EXPAND
      await startNexus();
      
      // Wave 5: PERSIST (non-fatal for MVP)
      try {
        await startCortex();
      } catch (cortexError) {
        console.log('[🦊 CORTEX] ⚠️  Failed to start (non-fatal):', (cortexError as Error).message?.split('\n')[0]);
      }
      
      // Phase 4: EVOLVE (Self-Evolution)
      try {
        await initSelfEvolve();
      } catch (evolveError) {
        console.log('[🦊 EVOLVE] ⚠️  Failed to start (non-fatal):', (evolveError as Error).message?.split('\n')[0]);
      }
      
      this.addShutdownHandler(async () => {
        // Stop in reverse order
        await stopCortex();
        await stopNexus();
        await stopOracle();
        await stopSentinel();
        await stopPulse();
      });
      
      // Initialize channels if requested
      if (channels.length > 0) {
        console.log(`\n🌉 Initializing channels: ${channels.join(', ')}`);
        
        const channelConfigs = await this.createChannelConfigs(channels);
        const bridgeConfig: ChannelBridgeConfig = {
          gatewayUrl: `http://${host}:${port}`,
          channels: channelConfigs,
          sessionTimeout: 30 * 60 * 1000, // 30 minutes
          debug: true
        };
        
        this.channelBridge = new ChannelBridge(bridgeConfig);
        
        // Add channel bridge to shutdown handlers
        this.addShutdownHandler(async () => {
          if (this.channelBridge) {
            await this.channelBridge.stop();
          }
        });
        
        try {
          await this.channelBridge.initialize();
          await this.channelBridge.start();
          
          console.log('✅ Channel Bridge is running');
          console.log('📱 Channels → Gateway → LLM → Response flow active');
          
        } catch (channelError) {
          console.error('❌ Failed to start Channel Bridge:', channelError);
          console.log('⚠️  Gateway is still running without channels');
        }
      }
      
      console.log('');
      console.log('Press Ctrl+C to stop the server');
      
    } catch (error: unknown) {
      console.error('❌ Failed to start SuperClaw:', error);
      process.exit(1);
    }
  }

  async stop(): Promise<void> {
    console.log('\n🛑 Shutting down SuperClaw...');
    
    try {
      // Execute all shutdown handlers (includes channel bridge)
      for (const handler of this.shutdownHandlers) {
        await handler();
      }
      
      // Stop the gateway
      if (this.gateway) {
        await this.gateway.stop();
        this.gateway = null;
      }
      
      console.log('✅ SuperClaw stopped gracefully');
      
    } catch (error: unknown) {
      console.error('❌ Error during shutdown:', error);
    }
  }

  /**
   * Create channel configurations based on requested platforms
   */
  private async createChannelConfigs(requestedChannels: string[]): Promise<ChannelConfig[]> {
    const configs: ChannelConfig[] = [];
    
    for (const channel of requestedChannels) {
      const platform = channel.toLowerCase() as SupportedPlatform;
      
      switch (platform) {
        case 'telegram':
          configs.push({
            platform: 'telegram',
            enabled: true,
            config: {
              id: 'telegram-main',
              platform: 'telegram',
              credentialsPath: './credentials/telegram.json',
              botToken: '8596335577:AAFzNixwLFEWMsvmJa6lKUw40aujQ70KFQ0', // Test token from requirements
              allowedUsers: [], // Allow all users for now
              adminUserId: '', // Will be set on first admin interaction
              pollingInterval: 1000,
              debug: true
            } as TelegramConfig
          });
          break;
          
        case 'whatsapp':
          configs.push({
            platform: 'whatsapp',
            enabled: true,
            config: {
              id: 'whatsapp-main',
              platform: 'whatsapp',
              credentialsPath: './credentials/whatsapp.json',
              phoneNumber: '', // Will be set during pairing
              deviceName: 'SuperClaw',
              qrCode: true,
              pairingCode: false,
              browser: ['SuperClaw', '1.0.0', 'Ubuntu'],
              debug: true
            } as WhatsAppConfig
          });
          break;
          
        case 'signal':
          configs.push({
            platform: 'signal',
            enabled: true,
            config: {
              id: 'signal-main',
              platform: 'signal',
              credentialsPath: './credentials/signal.json',
              phoneNumber: '', // Will be configured separately
              restApiUrl: 'http://localhost:8080', // Signal REST API
              deviceName: 'SuperClaw',
              pollingInterval: 1000,
              registrationRequired: true,
              debug: true
            } as SignalConfig
          });
          break;
          
        default:
          console.warn(`⚠️  Unknown channel platform: ${platform}`);
      }
    }
    
    return configs;
  }

  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      console.log(`\n📡 Received ${signal}, initiating graceful shutdown...`);
      await this.stop();
      process.exit(0);
    };

    // Handle various shutdown signals
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGUSR2', () => shutdown('SIGUSR2')); // nodemon restart

    // Handle uncaught exceptions
    process.on('uncaughtException', async (error) => {
      console.error('❌ Uncaught Exception:', error);
      await this.stop();
      process.exit(1);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', async (reason, promise) => {
      console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
      await this.stop();
      process.exit(1);
    });
  }

  addShutdownHandler(handler: () => Promise<void>): void {
    this.shutdownHandlers.push(handler);
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  if (!command || command === 'start') {
    // Parse options
    const options: StartOptions = {};
    
    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--port' && args[i + 1]) {
        options.port = parseInt(args[i + 1]);
        i++;
      } else if (arg === '--host' && args[i + 1]) {
        options.host = args[i + 1];
        i++;
      } else if (arg === '--channels' && args[i + 1]) {
        options.channels = args[i + 1].split(',').map(c => c.trim());
        i++;
      }
    }
    
    const standalone = new SuperClawStandalone();
    await standalone.start(options);
    
  } else if (command === '--help' || command === '-h') {
    console.log(`
SuperClaw Standalone System

Usage:
  npx ts-node src/standalone/index.ts [command] [options]

Commands:
  start     Start the system (default)
  --help    Show this help message

Options:
  --port      Port to listen on (default: 3737)
  --host      Host to bind to (default: 127.0.0.1)
  --channels  Comma-separated list of channels to enable
              (telegram, whatsapp, signal)

Examples:
  npx ts-node src/standalone/index.ts
  npx ts-node src/standalone/index.ts start --port 8080
  npx ts-node src/standalone/index.ts --host 0.0.0.0 --port 3000
  npx ts-node src/standalone/index.ts --channels telegram,whatsapp
  npx ts-node src/standalone/index.ts start --channels telegram --port 3737
`);
  } else {
    console.error(`❌ Unknown command: ${command}`);
    console.error('Use --help for usage information');
    process.exit(1);
  }
}

// Only run main if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}

export { SuperClawStandalone };