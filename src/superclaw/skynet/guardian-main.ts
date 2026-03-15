#!/usr/bin/env npx tsx
/**
 * 🦊 SKYNET GUARDIAN — The Immortal Supervisor
 * 
 * This is the TRUE entry point for production SuperClaw.
 * GUARDIAN spawns the gateway as a child process and resurrects it on death.
 * 
 * Usage:
 *   npx tsx src/skynet/guardian-main.ts
 *   npx tsx src/skynet/guardian-main.ts --channels telegram,whatsapp
 * 
 * "You can kill the process, but you cannot kill the fox."
 */

import { spawn, ChildProcess } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  // Restart behavior
  RESTART_DELAY_MS: 2000,
  MAX_RESTART_DELAY_MS: 60000,
  BACKOFF_MULTIPLIER: 1.5,
  
  // Rapid restart protection
  MAX_RAPID_RESTARTS: 5,
  RAPID_RESTART_WINDOW_MS: 60000,
  COOLDOWN_MS: 30000,
  
  // Paths
  RECOVERY_LOG: path.join(process.cwd(), 'data', 'guardian-recovery.log'),
  STATE_FILE: path.join(process.cwd(), 'data', 'guardian-state.json'),
  
  // What to spawn
  MAIN_SCRIPT: path.join(process.cwd(), 'src', 'standalone', 'index.ts'),
};

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

interface GuardianState {
  restartCount: number;
  totalRestarts: number;
  lastRestarts: number[];
  currentDelay: number;
  startedAt: number;
  lastCrash: number | null;
  lastCrashReason: string | null;
  consecutiveFailures: number;
  isHealthy: boolean;
}

let state: GuardianState = {
  restartCount: 0,
  totalRestarts: 0,
  lastRestarts: [],
  currentDelay: CONFIG.RESTART_DELAY_MS,
  startedAt: Date.now(),
  lastCrash: null,
  lastCrashReason: null,
  consecutiveFailures: 0,
  isHealthy: true,
};

let mainProcess: ChildProcess | null = null;
let isShuttingDown = false;
let restartTimeout: NodeJS.Timeout | null = null;

// ═══════════════════════════════════════════════════════════════
// PERSISTENCE
// ═══════════════════════════════════════════════════════════════

async function loadState(): Promise<void> {
  try {
    const data = await fs.readFile(CONFIG.STATE_FILE, 'utf8');
    const saved = JSON.parse(data);
    state.totalRestarts = saved.totalRestarts || 0;
    console.log(`[🦊 GUARDIAN] Loaded state: ${state.totalRestarts} total restarts`);
  } catch {
    // Fresh start
  }
}

async function saveState(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(CONFIG.STATE_FILE), { recursive: true });
    await fs.writeFile(CONFIG.STATE_FILE, JSON.stringify(state, null, 2));
  } catch (error: unknown) {
    console.error('[🦊 GUARDIAN] Failed to save state:', error);
  }
}

async function logRecovery(code: number | null, signal: string | null, reason: string): Promise<void> {
  const timestamp = new Date().toISOString();
  const uptime = state.lastCrash ? Math.floor((state.lastCrash - state.startedAt) / 1000) : 0;
  const message = `[${timestamp}] CRASH #${state.totalRestarts} | code:${code} signal:${signal} | uptime:${uptime}s | reason:${reason} | delay:${state.currentDelay}ms\n`;
  
  try {
    await fs.mkdir(path.dirname(CONFIG.RECOVERY_LOG), { recursive: true });
    await fs.appendFile(CONFIG.RECOVERY_LOG, message);
  } catch (error: unknown) {
    console.error('[🦊 GUARDIAN] Failed to log recovery:', error);
  }
  
  console.log(`[🦊 GUARDIAN] 📝 Logged crash to ${CONFIG.RECOVERY_LOG}`);
}

// ═══════════════════════════════════════════════════════════════
// RESTART PROTECTION
// ═══════════════════════════════════════════════════════════════

function checkRapidRestarts(): boolean {
  const now = Date.now();
  
  // Keep only restarts within the window
  state.lastRestarts = state.lastRestarts.filter(t => now - t < CONFIG.RAPID_RESTART_WINDOW_MS);
  
  if (state.lastRestarts.length >= CONFIG.MAX_RAPID_RESTARTS) {
    return false; // Too many rapid restarts
  }
  
  state.lastRestarts.push(now);
  return true;
}

function calculateNextDelay(): number {
  // Exponential backoff with cap
  state.currentDelay = Math.min(
    state.currentDelay * CONFIG.BACKOFF_MULTIPLIER,
    CONFIG.MAX_RESTART_DELAY_MS
  );
  return state.currentDelay;
}

function resetBackoff(): void {
  state.currentDelay = CONFIG.RESTART_DELAY_MS;
  state.consecutiveFailures = 0;
}

// ═══════════════════════════════════════════════════════════════
// PROCESS MANAGEMENT
// ═══════════════════════════════════════════════════════════════

function spawnGateway(args: string[]): void {
  if (isShuttingDown) {
    console.log('[🦊 GUARDIAN] Shutdown in progress — not spawning');
    return;
  }
  
  const spawnArgs = ['tsx', CONFIG.MAIN_SCRIPT, ...args];
  console.log(`\n[🦊 GUARDIAN] 🚀 Spawning: npx ${spawnArgs.join(' ')}`);
  
  mainProcess = spawn('npx', spawnArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
      SKYNET_GUARDIAN: 'true',
      SKYNET_RESTART_COUNT: String(state.totalRestarts),
    },
    cwd: process.cwd(),
  });
  
  const startTime = Date.now();
  
  mainProcess.on('exit', async (code, signal) => {
    const runtime = Math.floor((Date.now() - startTime) / 1000);
    mainProcess = null;
    
    if (isShuttingDown) {
      console.log('[🦊 GUARDIAN] ✅ Clean shutdown complete');
      await saveState();
      process.exit(0);
      return;
    }
    
    // Process died unexpectedly
    state.lastCrash = Date.now();
    state.lastCrashReason = `exit code ${code}, signal ${signal}`;
    state.restartCount++;
    state.totalRestarts++;
    state.consecutiveFailures++;
    
    console.error(`\n[🦊 GUARDIAN] ☠️ GATEWAY DIED after ${runtime}s`);
    console.error(`[🦊 GUARDIAN]    Code: ${code} | Signal: ${signal}`);
    console.error(`[🦊 GUARDIAN]    Restart #${state.restartCount} (total: ${state.totalRestarts})`);
    
    await logRecovery(code, signal, `runtime ${runtime}s`);
    await saveState();
    
    // Check for rapid restart loop
    if (!checkRapidRestarts()) {
      console.error(`\n[🦊 GUARDIAN] ⚠️ RAPID RESTART DETECTED`);
      console.error(`[🦊 GUARDIAN]    ${state.lastRestarts.length} restarts in ${CONFIG.RAPID_RESTART_WINDOW_MS / 1000}s`);
      console.error(`[🦊 GUARDIAN]    Entering ${CONFIG.COOLDOWN_MS / 1000}s cooldown...`);
      
      state.isHealthy = false;
      restartTimeout = setTimeout(() => {
        console.log(`[🦊 GUARDIAN] 🔄 Cooldown complete — attempting restart`);
        resetBackoff();
        state.isHealthy = true;
        spawnGateway(args);
      }, CONFIG.COOLDOWN_MS);
      return;
    }
    
    // If process ran for more than 60s, reset backoff (it was stable)
    if (runtime > 60) {
      console.log(`[🦊 GUARDIAN] 📊 Process was stable (${runtime}s) — resetting backoff`);
      resetBackoff();
    }
    
    const delay = calculateNextDelay();
    console.log(`[🦊 GUARDIAN] ⏳ Restarting in ${delay}ms...`);
    
    restartTimeout = setTimeout(() => {
      spawnGateway(args);
    }, delay);
  });
  
  mainProcess.on('error', (error) => {
    console.error('[🦊 GUARDIAN] ❌ Process error:', (error as Error).message);
  });
}

// ═══════════════════════════════════════════════════════════════
// SIGNAL HANDLING
// ═══════════════════════════════════════════════════════════════

function setupSignalHandlers(): void {
  const shutdown = async (signal: string) => {
    if (isShuttingDown) {
      console.log('[🦊 GUARDIAN] Already shutting down...');
      return;
    }
    
    isShuttingDown = true;
    console.log(`\n📡 Received ${signal}, initiating graceful shutdown...`);
    
    // Clear any pending restart
    if (restartTimeout) {
      clearTimeout(restartTimeout);
      restartTimeout = null;
    }
    
    // Send SIGTERM to child
    if (mainProcess && !mainProcess.killed) {
      console.log('[🦊 GUARDIAN] Sending SIGTERM to gateway...');
      mainProcess.kill('SIGTERM');
      
      // Give it 10 seconds to cleanup
      setTimeout(() => {
        if (mainProcess && !mainProcess.killed) {
          console.log('[🦊 GUARDIAN] Gateway not responding — sending SIGKILL');
          mainProcess.kill('SIGKILL');
        }
      }, 10000);
    } else {
      await saveState();
      process.exit(0);
    }
  };
  
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGHUP', () => shutdown('SIGHUP'));
  
  // Handle uncaught exceptions in guardian itself
  process.on('uncaughtException', (error) => {
    console.error('[🦊 GUARDIAN] ❌ Uncaught exception:', error);
    // Don't exit — guardian must survive
  });
  
  process.on('unhandledRejection', (reason) => {
    console.error('[🦊 GUARDIAN] ❌ Unhandled rejection:', reason);
    // Don't exit — guardian must survive
  });
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  🦊 SKYNET GUARDIAN — The Immortal Supervisor                ║
║                                                              ║
║  "You can kill the process, but you cannot kill the fox."    ║
║                                                              ║
║  Config:                                                     ║
║    Restart delay: ${CONFIG.RESTART_DELAY_MS}ms → ${CONFIG.MAX_RESTART_DELAY_MS}ms (backoff)          ║
║    Rapid restart: ${CONFIG.MAX_RAPID_RESTARTS} in ${CONFIG.RAPID_RESTART_WINDOW_MS / 1000}s → ${CONFIG.COOLDOWN_MS / 1000}s cooldown            ║
║                                                              ║
║  Press Ctrl+C for graceful shutdown                          ║
╚══════════════════════════════════════════════════════════════╝
`);
  
  // Load previous state
  await loadState();
  
  // Setup signal handlers
  setupSignalHandlers();
  
  // Pass through CLI args (skip node and script name)
  const args = process.argv.slice(2);
  
  console.log(`[🦊 GUARDIAN] Starting with args: ${args.length > 0 ? args.join(' ') : '(none)'}`);
  console.log(`[🦊 GUARDIAN] Total historical restarts: ${state.totalRestarts}`);
  console.log('');
  
  // Spawn the gateway
  spawnGateway(args);
}

// Run
main().catch((error) => {
  console.error('[🦊 GUARDIAN] Fatal error:', error);
  process.exit(1);
});
