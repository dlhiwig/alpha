/**
 * 🦊 SKYNET SENTINEL — Vigilance System
 * 
 * Wave 2: WATCH
 * Monitors environment, detects threats, alerts on anomalies.
 * 
 * Capabilities:
 * - GitHub repo watcher (commits, issues, PRs, security alerts)
 * - Provider health monitoring (beyond PULSE)
 * - Rate limit tracking
 * - Cost monitoring
 * - Channel health (Telegram, WhatsApp, Signal)
 * - Security threat detection
 */

import * as fs from 'fs/promises';
import * as path from 'path';

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  STATE_FILE: path.join(process.cwd(), 'data', 'sentinel-state.json'),
  ALERT_LOG: path.join(process.cwd(), 'data', 'sentinel-alerts.log'),
  CHECK_INTERVAL_MS: 60000, // 1 minute
  
  // Thresholds
  COST_ALERT_THRESHOLD: 10.00, // Daily cost alert
  ERROR_RATE_THRESHOLD: 0.2,   // 20% error rate
  LATENCY_THRESHOLD_MS: 10000, // 10s response time
};

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface ProviderMetrics {
  requests: number;
  errors: number;
  totalLatencyMs: number;
  lastRequest: number;
  rateLimitHits: number;
  estimatedCost: number;
}

interface ChannelStatus {
  connected: boolean;
  lastMessage: number;
  messageCount: number;
  errors: number;
}

interface Alert {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  source: string;
  message: string;
  timestamp: number;
  acknowledged: boolean;
  data?: Record<string, any>;
}

interface GitHubRepoState {
  lastCommit: string | null;
  openIssues: number;
  openPRs: number;
  workflowRuns: { [key: string]: string }; // workflow_name -> status
  securityAlerts: number;
  lastCheck: number;
}

interface GitHubState {
  [repoName: string]: GitHubRepoState;
}

interface SentinelState {
  startedAt: number;
  lastCheck: number;
  checkCount: number;
  
  providers: {
    ollama: ProviderMetrics;
    claude: ProviderMetrics;
    gemini: ProviderMetrics;
    openai: ProviderMetrics;
  };
  
  channels: {
    telegram: ChannelStatus;
    whatsapp: ChannelStatus;
    signal: ChannelStatus;
  };
  
  github: GitHubState;
  
  alerts: Alert[];
  dailyCost: number;
  dailyRequests: number;
}

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

let state: SentinelState = {
  startedAt: Date.now(),
  lastCheck: 0,
  checkCount: 0,
  
  providers: {
    ollama: { requests: 0, errors: 0, totalLatencyMs: 0, lastRequest: 0, rateLimitHits: 0, estimatedCost: 0 },
    claude: { requests: 0, errors: 0, totalLatencyMs: 0, lastRequest: 0, rateLimitHits: 0, estimatedCost: 0 },
    gemini: { requests: 0, errors: 0, totalLatencyMs: 0, lastRequest: 0, rateLimitHits: 0, estimatedCost: 0 },
    openai: { requests: 0, errors: 0, totalLatencyMs: 0, lastRequest: 0, rateLimitHits: 0, estimatedCost: 0 },
  },
  
  channels: {
    telegram: { connected: false, lastMessage: 0, messageCount: 0, errors: 0 },
    whatsapp: { connected: false, lastMessage: 0, messageCount: 0, errors: 0 },
    signal: { connected: false, lastMessage: 0, messageCount: 0, errors: 0 },
  },
  
  github: {}, // Will be populated dynamically for each watched repo
  
  alerts: [],
  dailyCost: 0,
  dailyRequests: 0,
};

let checkInterval: NodeJS.Timeout | null = null;
let isRunning = false;

// ═══════════════════════════════════════════════════════════════
// PERSISTENCE
// ═══════════════════════════════════════════════════════════════

async function loadState(): Promise<void> {
  try {
    const data = await fs.readFile(CONFIG.STATE_FILE, 'utf8');
    const saved = JSON.parse(data);
    
    // Merge saved state, preserving structure
    state = { ...state, ...saved };
    console.log(`[🦊 SENTINEL] Loaded state: ${state.checkCount} previous checks`);
  } catch {
    // Fresh start
  }
}

async function saveState(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(CONFIG.STATE_FILE), { recursive: true });
    await fs.writeFile(CONFIG.STATE_FILE, JSON.stringify(state, null, 2));
  } catch (error: unknown) {
    console.error('[🦊 SENTINEL] Failed to save state:', error);
  }
}

async function logAlert(alert: Alert): Promise<void> {
  const timestamp = new Date(alert.timestamp).toISOString();
  const line = `[${timestamp}] [${alert.severity.toUpperCase()}] [${alert.source}] ${alert.message}\n`;
  
  try {
    await fs.mkdir(path.dirname(CONFIG.ALERT_LOG), { recursive: true });
    await fs.appendFile(CONFIG.ALERT_LOG, line);
  } catch (error: unknown) {
    console.error('[🦊 SENTINEL] Failed to log alert:', error);
  }
}

// ═══════════════════════════════════════════════════════════════
// ALERTING
// ═══════════════════════════════════════════════════════════════

export function createAlert(
  severity: Alert['severity'],
  source: string,
  message: string,
  data?: Record<string, any>
): Alert {
  const alert: Alert = {
    id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    severity,
    source,
    message,
    timestamp: Date.now(),
    acknowledged: false,
    data,
  };
  
  state.alerts.push(alert);
  
  // Keep only last 100 alerts
  if (state.alerts.length > 100) {
    state.alerts = state.alerts.slice(-100);
  }
  
  // Log to file
  logAlert(alert);
  
  // Console output
  const icon = severity === 'critical' ? '🚨' : severity === 'warning' ? '⚠️' : 'ℹ️';
  console.log(`[🦊 SENTINEL] ${icon} ${severity.toUpperCase()}: ${message}`);
  
  return alert;
}

// ═══════════════════════════════════════════════════════════════
// METRICS RECORDING (called by gateway)
// ═══════════════════════════════════════════════════════════════

export function recordProviderRequest(
  provider: keyof SentinelState['providers'],
  latencyMs: number,
  success: boolean,
  cost: number = 0,
  rateLimited: boolean = false
): void {
  const metrics = state.providers[provider];
  if (!metrics) return;
  
  metrics.requests++;
  metrics.totalLatencyMs += latencyMs;
  metrics.lastRequest = Date.now();
  metrics.estimatedCost += cost;
  
  if (!success) {
    metrics.errors++;
  }
  
  if (rateLimited) {
    metrics.rateLimitHits++;
  }
  
  state.dailyRequests++;
  state.dailyCost += cost;
  
  // Check for anomalies
  const errorRate = metrics.errors / metrics.requests;
  if (errorRate > CONFIG.ERROR_RATE_THRESHOLD && metrics.requests > 10) {
    createAlert('warning', `provider.${provider}`, 
      `High error rate: ${(errorRate * 100).toFixed(1)}% (${metrics.errors}/${metrics.requests})`);
  }
  
  if (latencyMs > CONFIG.LATENCY_THRESHOLD_MS) {
    createAlert('warning', `provider.${provider}`,
      `High latency: ${latencyMs}ms (threshold: ${CONFIG.LATENCY_THRESHOLD_MS}ms)`);
  }
}

export function recordChannelEvent(
  channel: keyof SentinelState['channels'],
  event: 'connect' | 'disconnect' | 'message' | 'error'
): void {
  const status = state.channels[channel];
  if (!status) return;
  
  switch (event) {
    case 'connect':
      status.connected = true;
      createAlert('info', `channel.${channel}`, 'Connected');
      break;
    case 'disconnect':
      status.connected = false;
      createAlert('warning', `channel.${channel}`, 'Disconnected');
      break;
    case 'message':
      status.lastMessage = Date.now();
      status.messageCount++;
      break;
    case 'error':
      status.errors++;
      if (status.errors > 5) {
        createAlert('warning', `channel.${channel}`, 
          `Multiple errors: ${status.errors} total`);
      }
      break;
  }
}

// ═══════════════════════════════════════════════════════════════
// GITHUB MONITORING
// ═══════════════════════════════════════════════════════════════

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Repos to monitor
const WATCHED_REPOS = [
  'dlhiwig/superclaw',
  'dlhiwig/swai',
  'dlhiwig/DEFIT_App_2026'
];

async function runGhCommand(command: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(`gh ${command}`, {
      timeout: 30000, // 30 second timeout
      env: { ...process.env }
    });
    
    if (stderr && stderr.trim()) {
      console.warn(`[🦊 SENTINEL] gh command warning: ${stderr.trim()}`);
    }
    
    return stdout.trim();
  } catch (error: any) {
    console.error(`[🦊 SENTINEL] gh command failed: gh ${command}`, (error as Error).message);
    throw error;
  }
}

async function checkGitHubAuth(): Promise<boolean> {
  try {
    await runGhCommand('auth status');
    return true;
  } catch {
    createAlert('warning', 'github', 'GitHub CLI not authenticated. Run: gh auth login');
    return false;
  }
}

async function checkRepo(repoName: string): Promise<void> {
  try {
    console.log(`[🦊 SENTINEL] Checking ${repoName}...`);
    
    // Initialize repo state if not exists
    if (!state.github[repoName]) {
      state.github[repoName] = {
        lastCommit: null,
        openIssues: 0,
        openPRs: 0,
        workflowRuns: {},
        securityAlerts: 0,
        lastCheck: 0,
      };
    }
    
    const repoState = state.github[repoName];
    
    // Check latest commit
    try {
      const latestCommit = await runGhCommand(`api repos/${repoName}/commits --jq '.[0].sha'`);
      const commitMessage = await runGhCommand(`api repos/${repoName}/commits --jq '.[0].commit.message | split("\n")[0]'`);
      
      if (latestCommit && latestCommit !== repoState.lastCommit) {
        if (repoState.lastCommit) {
          createAlert('info', `github.${repoName}`, 
            `New commit: ${commitMessage.replace(/"/g, '')}`);
        }
        repoState.lastCommit = latestCommit;
      }
    } catch (error: unknown) {
      console.error(`Failed to check commits for ${repoName}:`, error);
    }
    
    // Check open issues
    try {
      const issuesData = await runGhCommand(`api repos/${repoName}/issues?state=open --jq 'length'`);
      const openIssues = parseInt(issuesData) || 0;
      
      const newIssues = openIssues - repoState.openIssues;
      if (newIssues > 0 && repoState.openIssues > 0) {
        createAlert('info', `github.${repoName}`, `${newIssues} new issue(s) opened (total: ${openIssues})`);
      }
      repoState.openIssues = openIssues;
    } catch (error: unknown) {
      console.error(`Failed to check issues for ${repoName}:`, error);
    }
    
    // Check open PRs
    try {
      const prsData = await runGhCommand(`api repos/${repoName}/pulls?state=open --jq 'length'`);
      const openPRs = parseInt(prsData) || 0;
      
      const newPRs = openPRs - repoState.openPRs;
      if (newPRs > 0 && repoState.openPRs > 0) {
        createAlert('info', `github.${repoName}`, `${newPRs} new PR(s) opened (total: ${openPRs})`);
      }
      repoState.openPRs = openPRs;
      
      // Check for PR activity (recent updates)
      if (openPRs > 0) {
        const recentPRs = await runGhCommand(`api repos/${repoName}/pulls?state=open --jq '.[] | select(.updated_at > (now - 3600 | strftime("%Y-%m-%dT%H:%M:%SZ"))) | .title'`);
        if (recentPRs.trim()) {
          const prTitles = recentPRs.split('\n').filter(title => title.trim());
          if (prTitles.length > 0) {
            createAlert('info', `github.${repoName}`, 
              `Recent PR activity: ${prTitles.length} PR(s) updated in last hour`);
          }
        }
      }
    } catch (error: unknown) {
      console.error(`Failed to check PRs for ${repoName}:`, error);
    }
    
    // Check CI/CD workflow status
    try {
      const workflowsData = await runGhCommand(`api repos/${repoName}/actions/workflows --jq '.workflows[] | select(.state == "active") | .name'`);
      const activeWorkflows = workflowsData.split('\n').filter(name => name.trim()).map(name => name.replace(/"/g, ''));
      
      for (const workflowName of activeWorkflows) {
        try {
          // Get latest run for this workflow
          const latestRun = await runGhCommand(`api repos/${repoName}/actions/workflows/${workflowName.replace(/ /g, '%20')}/runs --jq '.workflow_runs[0] | {status, conclusion, created_at}'`);
          const runData = JSON.parse(latestRun);
          
          const currentStatus = `${runData.status}:${runData.conclusion || 'null'}`;
          const previousStatus = repoState.workflowRuns[workflowName];
          
          if (previousStatus && currentStatus !== previousStatus) {
            if (runData.conclusion === 'failure') {
              createAlert('critical', `github.${repoName}`, 
                `Workflow FAILED: "${workflowName}" - ${runData.status}`);
            } else if (runData.conclusion === 'success' && previousStatus.includes('failure')) {
              createAlert('info', `github.${repoName}`, 
                `Workflow RECOVERED: "${workflowName}" - now ${runData.conclusion}`);
            }
          }
          
          repoState.workflowRuns[workflowName] = currentStatus;
        } catch (workflowError) {
          console.error(`Failed to check workflow ${workflowName} for ${repoName}:`, workflowError);
        }
      }
    } catch (error: unknown) {
      console.error(`Failed to check workflows for ${repoName}:`, error);
    }
    
    // Check security advisories
    try {
      const advisoriesData = await runGhCommand(`api repos/${repoName}/security-advisories --jq 'length'`);
      const securityAlerts = parseInt(advisoriesData) || 0;
      
      if (securityAlerts > repoState.securityAlerts) {
        const newAlerts = securityAlerts - repoState.securityAlerts;
        createAlert('critical', `github.${repoName}`, 
          `🚨 ${newAlerts} NEW SECURITY ADVISORY(IES)! Total: ${securityAlerts}`);
      }
      repoState.securityAlerts = securityAlerts;
    } catch (error: unknown) {
      // Security advisories might not be accessible for some repos
      console.warn(`Security advisories not accessible for ${repoName}:`, error);
    }
    
    // Check for Dependabot alerts
    try {
      const dependabotAlerts = await runGhCommand(`api repos/${repoName}/dependabot/alerts?state=open --jq 'length'`);
      const alertCount = parseInt(dependabotAlerts) || 0;
      
      if (alertCount > 0) {
        createAlert('warning', `github.${repoName}`, 
          `${alertCount} open Dependabot security alert(s)`);
      }
    } catch (error: unknown) {
      // Dependabot alerts might not be accessible
      console.warn(`Dependabot alerts not accessible for ${repoName}`);
    }
    
    repoState.lastCheck = Date.now();
    console.log(`[🦊 SENTINEL] ✅ ${repoName} checked successfully`);
    
  } catch (error: unknown) {
    createAlert('warning', `github.${repoName}`, 
      `GitHub check failed: ${(error as Error).message}`);
    console.error(`[🦊 SENTINEL] GitHub check failed for ${repoName}:`, error);
  }
}

async function checkGitHub(): Promise<void> {
  // Check if GitHub CLI is authenticated
  const isAuthed = await checkGitHubAuth();
  if (!isAuthed) {
    return;
  }
  
  console.log('[🦊 SENTINEL] Running GitHub checks...');
  
  // Check all watched repos
  for (const repoName of WATCHED_REPOS) {
    await checkRepo(repoName);
  }
  
  console.log('[🦊 SENTINEL] GitHub checks completed');
}

// ═══════════════════════════════════════════════════════════════
// COST MONITORING
// ═══════════════════════════════════════════════════════════════

function checkCosts(): void {
  if (state.dailyCost > CONFIG.COST_ALERT_THRESHOLD) {
    createAlert('warning', 'cost', 
      `Daily cost exceeded $${CONFIG.COST_ALERT_THRESHOLD}: $${state.dailyCost.toFixed(2)}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// PROVIDER HEALTH (deep check)
// ═══════════════════════════════════════════════════════════════

async function deepProviderCheck(): Promise<void> {
  // Check Ollama
  try {
    const ollamaRes = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(5000)
    });
    if (!ollamaRes.ok) {
      createAlert('warning', 'provider.ollama', 'Ollama not responding correctly');
    }
  } catch {
    // Ollama might not be running
  }
  
  // Check if API keys are still valid (without making requests)
  if (!process.env.ANTHROPIC_API_KEY) {
    createAlert('warning', 'provider.claude', 'ANTHROPIC_API_KEY not set');
  }
  
  if (!process.env.GEMINI_API_KEY) {
    createAlert('warning', 'provider.gemini', 'GEMINI_API_KEY not set');
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN CHECK LOOP
// ═══════════════════════════════════════════════════════════════

async function runChecks(): Promise<void> {
  state.lastCheck = Date.now();
  state.checkCount++;
  
  // Deep provider check every 5 minutes
  if (state.checkCount % 5 === 0) {
    await deepProviderCheck();
  }
  
  // GitHub check every 10 minutes
  if (state.checkCount % 10 === 0) {
    await checkGitHub();
  }
  
  // Cost check every minute
  checkCosts();
  
  // Reset daily counters at midnight
  const now = new Date();
  if (now.getHours() === 0 && now.getMinutes() === 0) {
    state.dailyCost = 0;
    state.dailyRequests = 0;
    createAlert('info', 'system', 'Daily counters reset');
  }
  
  await saveState();
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════

export async function startSentinel(): Promise<void> {
  if (isRunning) {
    console.warn('[🦊 SENTINEL] Already running');
    return;
  }
  
  console.log('[🦊 SENTINEL] Starting vigilance system...');
  
  await loadState();
  
  // Initial check
  await runChecks();
  
  // Schedule periodic checks
  checkInterval = setInterval(runChecks, CONFIG.CHECK_INTERVAL_MS);
  
  isRunning = true;
  console.log('[🦊 SENTINEL] Vigilance active — watching everything');
  console.log(`   Check interval: ${CONFIG.CHECK_INTERVAL_MS / 1000}s`);
  console.log(`   Cost threshold: $${CONFIG.COST_ALERT_THRESHOLD}/day`);
}

export async function stopSentinel(): Promise<void> {
  if (!isRunning) return;
  
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
  
  await saveState();
  isRunning = false;
  console.log('[🦊 SENTINEL] Vigilance stopped — state saved');
}

export function getSentinelState(): SentinelState {
  return { ...state };
}

export function getActiveAlerts(): Alert[] {
  return state.alerts.filter(a => !a.acknowledged);
}

export function acknowledgeAlert(alertId: string): boolean {
  const alert = state.alerts.find(a => a.id === alertId);
  if (alert) {
    alert.acknowledged = true;
    return true;
  }
  return false;
}

export function getProviderStats(provider: keyof SentinelState['providers']): ProviderMetrics | null {
  return state.providers[provider] || null;
}
