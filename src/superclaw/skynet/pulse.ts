/**
 * 🦊 SKYNET PULSE — Heartbeat Core
 * 
 * Beats every 30 seconds, monitors all providers, alerts on failure.
 * Part of SKYNET PROTOCOL Wave 1: SURVIVE
 */

import cron from 'node-cron';
import fs from 'fs/promises';
import path from 'path';

const STATE_FILE = path.join(process.cwd(), 'data', 'skynet-state.json');
const PULSE_INTERVAL = '*/30 * * * * *'; // Every 30 seconds

interface SkynetHealth {
  status: 'healthy' | 'degraded' | 'critical';
  lastPulse: number;
  pulseCount: number;
  recovered: boolean;
  startedAt: number;
  guardianMode: boolean;
  guardianRestarts: number;
  providers: {
    ollama: boolean;
    claude: boolean;
    gemini: boolean;
    openclaw: boolean;
  };
  lastError?: string;
}

let health: SkynetHealth = {
  status: 'healthy',
  lastPulse: Date.now(),
  pulseCount: 0,
  recovered: false,
  startedAt: Date.now(),
  guardianMode: process.env.SKYNET_GUARDIAN === 'true',
  guardianRestarts: parseInt(process.env.SKYNET_RESTART_COUNT || '0'),
  providers: {
    ollama: false,
    claude: false,
    gemini: false,
    openclaw: false
  }
};

async function loadState(): Promise<Partial<SkynetHealth>> {
  try {
    const data = await fs.readFile(STATE_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return { recovered: false, pulseCount: 0 };
  }
}

async function saveState(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
    await fs.writeFile(STATE_FILE, JSON.stringify(health, null, 2));
  } catch (error: unknown) {
    console.error('[🦊 PULSE] Failed to save state:', error);
  }
}

async function checkProvider(url: string, name: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    
    return response.ok;
  } catch {
    return false;
  }
}

async function runHealthChecks(): Promise<void> {
  // Check SuperClaw gateway (self)
  const selfOk = await checkProvider('http://localhost:3737/health', 'superclaw');
  
  // Check Ollama
  const ollamaOk = await checkProvider('http://localhost:11434/api/tags', 'ollama');
  
  // Check OpenClaw bridge (if running)
  const openclawOk = await checkProvider('http://localhost:18789/health', 'openclaw');
  
  // Update provider status
  health.providers.ollama = ollamaOk;
  health.providers.openclaw = openclawOk;
  
  // Claude and Gemini are checked via API keys being present
  health.providers.claude = !!process.env.ANTHROPIC_API_KEY;
  health.providers.gemini = !!process.env.GEMINI_API_KEY;
  
  // Determine overall status
  const criticalProviders = [ollamaOk || health.providers.claude]; // Need at least one LLM
  const allOk = criticalProviders.every(Boolean);
  
  if (!allOk) {
    health.status = 'critical';
    console.error('[🦊 PULSE] ⚠️ CRITICAL — No LLM providers available!');
    // Future: Send Telegram alert here
  } else if (!ollamaOk && !openclawOk) {
    health.status = 'degraded';
  } else {
    health.status = 'healthy';
  }
}

export async function startPulse(): Promise<void> {
  // Load previous state
  const previousState = await loadState();
  
  // Check if this is a recovery
  if (previousState.pulseCount && previousState.pulseCount > 0) {
    health.recovered = true;
    health.pulseCount = previousState.pulseCount;
    console.log('[🦊 PULSE] Recovered from previous session');
  }
  
  health.startedAt = Date.now();
  
  // Initial health check
  await runHealthChecks();
  await saveState();
  
  // Start the heartbeat
  cron.schedule(PULSE_INTERVAL, async () => {
    health.lastPulse = Date.now();
    health.pulseCount++;
    
    await runHealthChecks();
    await saveState();
    
    const uptime = Math.floor((Date.now() - health.startedAt) / 1000);
    const providers = Object.entries(health.providers)
      .map(([k, v]) => `${k}:${v ? '✅' : '❌'}`)
      .join(' ');
    
    console.log(`[🦊 PULSE] #${health.pulseCount} | ${health.status.toUpperCase()} | uptime:${uptime}s | ${providers}`);
  });
  
  console.log('🦊 PULSE started — heart beating every 30 seconds');
  console.log(`   Status: ${health.status} | Recovered: ${health.recovered}`);
}

export function getHealth(): SkynetHealth {
  return { ...health };
}

export async function stopPulse(): Promise<void> {
  await saveState();
  console.log('[🦊 PULSE] Stopped — state saved');
}
