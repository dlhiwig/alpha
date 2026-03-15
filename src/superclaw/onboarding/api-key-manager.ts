/**
 * API Key Manager for SuperClaw
 * 
 * Secure storage and retrieval of API keys with multiple backends:
 * 1. Environment variables (default)
 * 2. 1Password CLI (if available)
 * 3. Local encrypted file (fallback)
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { safeCall, Result, SuperClawError } from '../core/errors';

const execAsync = promisify(exec);

export interface APIKey {
  name: string;
  envVar: string;
  value?: string;
  source: 'env' | '1password' | 'local' | 'missing';
  masked?: string;
}

export interface APIKeyConfig {
  name: string;
  envVar: string;
  description: string;
  required: boolean;
  onePasswordItem?: string;
}

// Known API key configurations
export const API_KEY_CONFIGS: APIKeyConfig[] = [
  {
    name: 'Anthropic',
    envVar: 'ANTHROPIC_API_KEY',
    description: 'Claude API access',
    required: true,
    onePasswordItem: 'Anthropic API Key'
  },
  {
    name: 'OpenAI',
    envVar: 'OPENAI_API_KEY',
    description: 'GPT-4, Codex, DALL-E access',
    required: false,
    onePasswordItem: 'OpenAI API Key'
  },
  {
    name: 'DeepSeek',
    envVar: 'DEEPSEEK_API_KEY',
    description: 'DeepSeek chat and coder models',
    required: false,
    onePasswordItem: 'DeepSeek API Key'
  },
  {
    name: 'Gemini',
    envVar: 'GEMINI_API_KEY',
    description: 'Google Gemini models',
    required: false,
    onePasswordItem: 'Gemini API Key'
  },
  {
    name: 'Replit',
    envVar: 'REPLIT_API_KEY',
    description: 'Replit API for sandbox environments',
    required: false,
    onePasswordItem: 'Replit API Key'
  }
];

const SUPERCLAW_DIR = join(homedir(), '.superclaw');
const KEYS_FILE = join(SUPERCLAW_DIR, 'keys.enc');
const ENCRYPTION_ALGO = 'aes-256-gcm';

/**
 * Check if 1Password CLI is available
 */
async function has1Password(): Promise<boolean> {
  try {
    await execAsync('op --version');
    return true;
  } catch {
    return false;
  }
}

/**
 * Get key from 1Password
 */
async function getFrom1Password(itemName: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      `op item get "${itemName}" --fields password --format json 2>/dev/null`
    );
    const data = JSON.parse(stdout);
    return data.value || null;
  } catch {
    return null;
  }
}

/**
 * Encrypt data with a password
 */
function encrypt(data: string, password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ENCRYPTION_ALGO, key, iv);
  
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  
  return JSON.stringify({
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    data: encrypted
  });
}

/**
 * Decrypt data with a password
 */
function decrypt(encryptedJson: string, password: string): string {
  const { salt, iv, authTag, data } = JSON.parse(encryptedJson);
  
  const key = scryptSync(password, Buffer.from(salt, 'hex'), 32);
  const decipher = createDecipheriv(
    ENCRYPTION_ALGO,
    key,
    Buffer.from(iv, 'hex')
  );
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));
  
  let decrypted = decipher.update(data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Get encryption password from environment or prompt
 */
function getEncryptionPassword(): string {
  return process.env.SUPERCLAW_KEY_PASSWORD || 
         process.env.USER || 
         'superclaw-default-key';
}

/**
 * Load locally stored keys
 */
function loadLocalKeys(): Record<string, string> {
  if (!existsSync(KEYS_FILE)) {
    return {};
  }
  
  try {
    const encrypted = readFileSync(KEYS_FILE, 'utf8');
    const decrypted = decrypt(encrypted, getEncryptionPassword());
    return JSON.parse(decrypted);
  } catch {
    return {};
  }
}

/**
 * Save keys locally
 */
function saveLocalKeys(keys: Record<string, string>): void {
  if (!existsSync(SUPERCLAW_DIR)) {
    mkdirSync(SUPERCLAW_DIR, { recursive: true, mode: 0o700 });
  }
  
  const encrypted = encrypt(JSON.stringify(keys), getEncryptionPassword());
  writeFileSync(KEYS_FILE, encrypted, { mode: 0o600 });
}

/**
 * Mask an API key for display
 */
function maskKey(key: string): string {
  if (key.length <= 8) return '***';
  return key.slice(0, 4) + '...' + key.slice(-4);
}

/**
 * Get an API key from all available sources
 */
export async function getAPIKey(config: APIKeyConfig): Promise<APIKey> {
  // 1. Check environment variable
  const envValue = process.env[config.envVar];
  if (envValue) {
    return {
      name: config.name,
      envVar: config.envVar,
      value: envValue,
      source: 'env',
      masked: maskKey(envValue)
    };
  }

  // 2. Check 1Password
  if (config.onePasswordItem && await has1Password()) {
    const opValue = await getFrom1Password(config.onePasswordItem);
    if (opValue) {
      return {
        name: config.name,
        envVar: config.envVar,
        value: opValue,
        source: '1password',
        masked: maskKey(opValue)
      };
    }
  }

  // 3. Check local encrypted storage
  const localKeys = loadLocalKeys();
  const localValue = localKeys[config.envVar];
  if (localValue) {
    return {
      name: config.name,
      envVar: config.envVar,
      value: localValue,
      source: 'local',
      masked: maskKey(localValue)
    };
  }

  // Not found
  return {
    name: config.name,
    envVar: config.envVar,
    source: 'missing'
  };
}

/**
 * Store an API key
 */
export async function storeAPIKey(
  envVar: string, 
  value: string,
  destination: 'local' | 'env' = 'local'
): Promise<Result<void>> {
  if (destination === 'local') {
    try {
      const keys = loadLocalKeys();
      keys[envVar] = value;
      saveLocalKeys(keys);
      return { ok: true, data: undefined };
    } catch (e) {
      return {
        ok: false,
        error: new SuperClawError(
          `Failed to store key: ${e}`,
          'UNKNOWN_ERROR',
          true
        )
      };
    }
  }
  
  // For env, just set in current process
  process.env[envVar] = value;
  return { ok: true, data: undefined };
}

/**
 * Get all API keys and their status
 */
export async function getAllAPIKeys(): Promise<APIKey[]> {
  return Promise.all(API_KEY_CONFIGS.map(getAPIKey));
}

/**
 * Print API key status
 */
export async function printAPIKeyStatus(): Promise<void> {
  console.log('\n🔑 SuperClaw API Key Status');
  console.log('=' .repeat(50));

  const keys = await getAllAPIKeys();
  
  for (const key of keys) {
    const status = key.source === 'missing' ? '❌' : '✅';
    const source = key.source !== 'missing' ? `(${key.source})` : '';
    const masked = key.masked || 'not set';
    
    console.log(`${status} ${key.name}`);
    console.log(`   ${key.envVar}: ${masked} ${source}`);
  }
  
  const configured = keys.filter(k => k.source !== 'missing').length;
  console.log('\n' + '=' .repeat(50));
  console.log(`Summary: ${configured}/${keys.length} configured`);
}
