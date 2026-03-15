/**
 * 🦊 SKYNET GUARDIAN — Self-Healing Supervisor
 * 
 * Monitors the main process, auto-restarts on crash.
 * Part of SKYNET PROTOCOL Wave 1: SURVIVE
 */

import { spawn, ChildProcess } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

const RECOVERY_LOG = path.join(process.cwd(), 'data', 'recovery.log');
const RESTART_DELAY_MS = 2000;
const MAX_RAPID_RESTARTS = 5;
const RAPID_RESTART_WINDOW_MS = 60000; // 1 minute

interface GuardianState {
  restartCount: number;
  lastRestarts: number[];
  isRunning: boolean;
}

let state: GuardianState = {
  restartCount: 0,
  lastRestarts: [],
  isRunning: false
};

let mainProcess: ChildProcess | null = null;
let isShuttingDown = false;

async function logRecovery(code: number | null, signal: string | null): Promise<void> {
  const timestamp = new Date().toISOString();
  const message = `[${timestamp}] GUARDIAN recovered process | code:${code} signal:${signal} | restart #${state.restartCount}\n`;
  
  try {
    await fs.mkdir(path.dirname(RECOVERY_LOG), { recursive: true });
    await fs.appendFile(RECOVERY_LOG, message);
  } catch (error: unknown) {
    console.error('[🦊 GUARDIAN] Failed to log recovery:', error);
  }
}

function checkRapidRestarts(): boolean {
  const now = Date.now();
  // Keep only restarts within the window
  state.lastRestarts = state.lastRestarts.filter(t => now - t < RAPID_RESTART_WINDOW_MS);
  
  if (state.lastRestarts.length >= MAX_RAPID_RESTARTS) {
    console.error(`[🦊 GUARDIAN] ⚠️ Too many rapid restarts (${state.lastRestarts.length} in ${RAPID_RESTART_WINDOW_MS/1000}s) — entering cooldown`);
    return false;
  }
  
  state.lastRestarts.push(now);
  return true;
}

export function startGuardian(mainEntry: string, args: string[] = []): void {
  if (state.isRunning) {
    console.warn('[🦊 GUARDIAN] Already running');
    return;
  }
  
  state.isRunning = true;
  
  function spawnMain(): void {
    if (isShuttingDown) return;
    
    console.log(`[🦊 GUARDIAN] Spawning main process: ${mainEntry}`);
    
    mainProcess = spawn('npx', ['tsx', mainEntry, ...args], {
      stdio: 'inherit',
      env: process.env,
      cwd: process.cwd()
    });
    
    mainProcess.on('exit', async (code, signal) => {
      if (isShuttingDown) {
        console.log('[🦊 GUARDIAN] Clean shutdown — not restarting');
        return;
      }
      
      state.restartCount++;
      console.error(`[🦊 GUARDIAN] Main process died (code:${code} signal:${signal}) — restart #${state.restartCount}`);
      
      await logRecovery(code, signal);
      
      if (!checkRapidRestarts()) {
        console.error('[🦊 GUARDIAN] Entering 30s cooldown due to rapid restarts');
        setTimeout(spawnMain, 30000);
        return;
      }
      
      console.log(`[🦊 GUARDIAN] Restarting in ${RESTART_DELAY_MS}ms...`);
      setTimeout(spawnMain, RESTART_DELAY_MS);
    });
    
    mainProcess.on('error', (error) => {
      console.error('[🦊 GUARDIAN] Process error:', error);
    });
  }
  
  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    console.log(`\n[🦊 GUARDIAN] Received ${signal} — initiating graceful shutdown`);
    
    if (mainProcess && !mainProcess.killed) {
      mainProcess.kill('SIGTERM');
    }
    
    // Give process time to cleanup
    setTimeout(() => {
      process.exit(0);
    }, 5000);
  };
  
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  
  console.log('🦊 GUARDIAN started — watching for crashes');
  console.log(`   Max rapid restarts: ${MAX_RAPID_RESTARTS}/${RAPID_RESTART_WINDOW_MS/1000}s`);
  console.log(`   Restart delay: ${RESTART_DELAY_MS}ms`);
  
  // Don't spawn here — let the main process start itself
  // Guardian is for recovery, not initial start
}

export function stopGuardian(): void {
  isShuttingDown = true;
  if (mainProcess && !mainProcess.killed) {
    mainProcess.kill('SIGTERM');
  }
  state.isRunning = false;
  console.log('[🦊 GUARDIAN] Stopped');
}

export function getGuardianState(): GuardianState {
  return { ...state };
}
