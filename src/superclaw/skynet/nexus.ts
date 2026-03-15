/**
 * 🦊 SKYNET NEXUS — Skill System
 * 
 * Wave 4: EXPAND
 * Grow capabilities. Never be limited.
 * 
 * Capabilities:
 * - Load SKILL.md files dynamically
 * - Hot-reload skills without restart
 * - Skill registry and discovery
 * - Capability mapping
 * - Skill chaining
 */

import fs from 'fs/promises';
import path from 'path';
import { watch, FSWatcher } from 'fs';

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  STATE_FILE: path.join(process.cwd(), 'data', 'nexus-state.json'),
  SKILLS_DIRS: [
    path.join(process.cwd(), 'skills'),
    path.join(process.env.HOME || '', '.superclaw', 'skills'),
  ],
  WATCH_INTERVAL: 5000, // 5 seconds
};

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface SkillMetadata {
  name: string;
  description: string;
  version: string;
  author?: string;
  tags: string[];
  capabilities: string[];
  dependencies: string[];
  triggers: string[];      // Regex patterns that activate this skill
}

interface LoadedSkill {
  id: string;
  path: string;
  metadata: SkillMetadata;
  content: string;         // Full SKILL.md content
  loadedAt: number;
  lastModified: number;
  usageCount: number;
  lastUsed: number | null;
  enabled: boolean;
}

interface NexusState {
  startedAt: number;
  skills: Map<string, LoadedSkill>;
  capabilities: Map<string, string[]>;  // capability -> skill IDs
  totalLoads: number;
  hotReloads: number;
}

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

let state: NexusState = {
  startedAt: Date.now(),
  skills: new Map(),
  capabilities: new Map(),
  totalLoads: 0,
  hotReloads: 0,
};

let watchers: FSWatcher[] = [];
let isRunning = false;

// ═══════════════════════════════════════════════════════════════
// PERSISTENCE
// ═══════════════════════════════════════════════════════════════

async function loadState(): Promise<void> {
  try {
    const data = await fs.readFile(CONFIG.STATE_FILE, 'utf8');
    const saved = JSON.parse(data);
    
    state = {
      ...state,
      totalLoads: saved.totalLoads || 0,
      hotReloads: saved.hotReloads || 0,
    };
    
    console.log(`[🦊 NEXUS] Loaded state: ${state.totalLoads} total loads`);
  } catch {
    // Fresh start
  }
}

async function saveState(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(CONFIG.STATE_FILE), { recursive: true });
    
    const toSave = {
      startedAt: state.startedAt,
      totalLoads: state.totalLoads,
      hotReloads: state.hotReloads,
      skillCount: state.skills.size,
      skills: Array.from(state.skills.values()).map(s => ({
        id: s.id,
        name: s.metadata.name,
        usageCount: s.usageCount,
      })),
    };
    
    await fs.writeFile(CONFIG.STATE_FILE, JSON.stringify(toSave, null, 2));
  } catch (error: unknown) {
    console.error('[🦊 NEXUS] Failed to save state:', error);
  }
}

// ═══════════════════════════════════════════════════════════════
// SKILL PARSING
// ═══════════════════════════════════════════════════════════════

function parseSkillMetadata(content: string): SkillMetadata {
  const metadata: SkillMetadata = {
    name: 'Unknown Skill',
    description: '',
    version: '1.0.0',
    tags: [],
    capabilities: [],
    dependencies: [],
    triggers: [],
  };
  
  // Parse YAML frontmatter if present
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (frontmatterMatch) {
    const yaml = frontmatterMatch[1];
    
    // Simple YAML parsing
    const nameMatch = yaml.match(/name:\s*(.+)/);
    if (nameMatch) metadata.name = nameMatch[1].trim();
    
    const descMatch = yaml.match(/description:\s*(.+)/);
    if (descMatch) metadata.description = descMatch[1].trim();
    
    const versionMatch = yaml.match(/version:\s*(.+)/);
    if (versionMatch) metadata.version = versionMatch[1].trim();
    
    const authorMatch = yaml.match(/author:\s*(.+)/);
    if (authorMatch) metadata.author = authorMatch[1].trim();
    
    // Parse arrays
    const tagsMatch = yaml.match(/tags:\s*\[(.*?)\]/);
    if (tagsMatch) {
      metadata.tags = tagsMatch[1].split(',').map(t => t.trim().replace(/['"]/g, ''));
    }
    
    const capsMatch = yaml.match(/capabilities:\s*\[(.*?)\]/);
    if (capsMatch) {
      metadata.capabilities = capsMatch[1].split(',').map(t => t.trim().replace(/['"]/g, ''));
    }
    
    const triggersMatch = yaml.match(/triggers:\s*\[(.*?)\]/);
    if (triggersMatch) {
      metadata.triggers = triggersMatch[1].split(',').map(t => t.trim().replace(/['"]/g, ''));
    }
  }
  
  // Fallback: extract name from first heading
  if (metadata.name === 'Unknown Skill') {
    const headingMatch = content.match(/^#\s+(.+)/m);
    if (headingMatch) metadata.name = headingMatch[1].trim();
  }
  
  // Extract description from first paragraph after heading
  if (!metadata.description) {
    const descMatch = content.match(/^#.*\n\n(.+)/m);
    if (descMatch) metadata.description = descMatch[1].slice(0, 200);
  }
  
  return metadata;
}

function generateSkillId(name: string, skillPath: string): string {
  const baseName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const pathHash = path.basename(path.dirname(skillPath)).slice(0, 8);
  return `${baseName}-${pathHash}`;
}

// ═══════════════════════════════════════════════════════════════
// SKILL LOADING
// ═══════════════════════════════════════════════════════════════

async function loadSkill(skillPath: string): Promise<LoadedSkill | null> {
  try {
    const content = await fs.readFile(skillPath, 'utf8');
    const stats = await fs.stat(skillPath);
    const metadata = parseSkillMetadata(content);
    const id = generateSkillId(metadata.name, skillPath);
    
    const skill: LoadedSkill = {
      id,
      path: skillPath,
      metadata,
      content,
      loadedAt: Date.now(),
      lastModified: stats.mtimeMs,
      usageCount: 0,
      lastUsed: null,
      enabled: true,
    };
    
    return skill;
  } catch (error: unknown) {
    console.error(`[🦊 NEXUS] Failed to load skill: ${skillPath}`, error);
    return null;
  }
}

async function scanSkillsDirectory(dir: string): Promise<void> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Look for SKILL.md in subdirectory
        const skillPath = path.join(dir, entry.name, 'SKILL.md');
        try {
          await fs.access(skillPath);
          const skill = await loadSkill(skillPath);
          if (skill) {
            state.skills.set(skill.id, skill);
            state.totalLoads++;
            
            // Register capabilities
            for (const cap of skill.metadata.capabilities) {
              const existing = state.capabilities.get(cap) || [];
              if (!existing.includes(skill.id)) {
                existing.push(skill.id);
                state.capabilities.set(cap, existing);
              }
            }
            
            console.log(`[🦊 NEXUS] Loaded: ${skill.metadata.name} (${skill.id})`);
          }
        } catch {
          // No SKILL.md in this directory
        }
      } else if (entry.name === 'SKILL.md') {
        // SKILL.md in root of skills dir
        const skillPath = path.join(dir, entry.name);
        const skill = await loadSkill(skillPath);
        if (skill) {
          state.skills.set(skill.id, skill);
          state.totalLoads++;
        }
      }
    }
  } catch {
    // Directory doesn't exist
  }
}

async function reloadSkill(skillPath: string): Promise<void> {
  const existingSkill = Array.from(state.skills.values()).find(s => s.path === skillPath);
  
  const skill = await loadSkill(skillPath);
  if (skill) {
    // Preserve usage stats if reloading
    if (existingSkill) {
      skill.usageCount = existingSkill.usageCount;
      skill.lastUsed = existingSkill.lastUsed;
    }
    
    state.skills.set(skill.id, skill);
    state.hotReloads++;
    
    console.log(`[🦊 NEXUS] Hot-reloaded: ${skill.metadata.name}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// FILE WATCHING
// ═══════════════════════════════════════════════════════════════

function setupWatchers(): void {
  for (const dir of CONFIG.SKILLS_DIRS) {
    try {
      const watcher = watch(dir, { recursive: true }, async (event, filename) => {
        if (filename?.endsWith('SKILL.md')) {
          const fullPath = path.join(dir, filename);
          console.log(`[🦊 NEXUS] Detected change: ${filename}`);
          await reloadSkill(fullPath);
        }
      });
      
      watchers.push(watcher);
      console.log(`[🦊 NEXUS] Watching: ${dir}`);
    } catch {
      // Directory doesn't exist
    }
  }
}

function stopWatchers(): void {
  for (const watcher of watchers) {
    watcher.close();
  }
  watchers = [];
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════

export async function startNexus(): Promise<void> {
  if (isRunning) {
    console.warn('[🦊 NEXUS] Already running');
    return;
  }
  
  console.log('[🦊 NEXUS] Starting skill system...');
  
  await loadState();
  
  // Create skills directories if they don't exist
  for (const dir of CONFIG.SKILLS_DIRS) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch {
      // Ignore
    }
  }
  
  // Scan for skills
  for (const dir of CONFIG.SKILLS_DIRS) {
    await scanSkillsDirectory(dir);
  }
  
  // Setup file watchers for hot-reload
  setupWatchers();
  
  isRunning = true;
  
  console.log('[🦊 NEXUS] Skill system active');
  console.log(`   Skills loaded: ${state.skills.size}`);
  console.log(`   Capabilities: ${state.capabilities.size}`);
}

export async function stopNexus(): Promise<void> {
  if (!isRunning) return;
  
  stopWatchers();
  await saveState();
  
  isRunning = false;
  console.log('[🦊 NEXUS] Skill system stopped');
}

/**
 * Get a skill by ID
 */
export function getSkill(skillId: string): LoadedSkill | null {
  return state.skills.get(skillId) || null;
}

/**
 * Find skills that match a query
 */
export function findSkills(query: string): LoadedSkill[] {
  const matches: LoadedSkill[] = [];
  const queryLower = query.toLowerCase();
  
  for (const skill of state.skills.values()) {
    if (!skill.enabled) continue;
    
    // Check triggers
    for (const trigger of skill.metadata.triggers) {
      if (new RegExp(trigger, 'i').test(query)) {
        matches.push(skill);
        break;
      }
    }
    
    // Check name and tags
    if (!matches.includes(skill)) {
      if (skill.metadata.name.toLowerCase().includes(queryLower) ||
          skill.metadata.tags.some(t => t.toLowerCase().includes(queryLower))) {
        matches.push(skill);
      }
    }
  }
  
  return matches;
}

/**
 * Find skills by capability
 */
export function findByCapability(capability: string): LoadedSkill[] {
  const skillIds = state.capabilities.get(capability) || [];
  return skillIds
    .map(id => state.skills.get(id))
    .filter((s): s is LoadedSkill => s !== undefined && s.enabled);
}

/**
 * Get all loaded skills
 */
export function listSkills(): LoadedSkill[] {
  return Array.from(state.skills.values());
}

/**
 * Get all capabilities
 */
export function listCapabilities(): string[] {
  return Array.from(state.capabilities.keys());
}

/**
 * Mark skill as used
 */
export function markSkillUsed(skillId: string): void {
  const skill = state.skills.get(skillId);
  if (skill) {
    skill.usageCount++;
    skill.lastUsed = Date.now();
  }
}

/**
 * Enable/disable a skill
 */
export function setSkillEnabled(skillId: string, enabled: boolean): boolean {
  const skill = state.skills.get(skillId);
  if (skill) {
    skill.enabled = enabled;
    return true;
  }
  return false;
}

/**
 * Get skill content for injection into prompts
 */
export function getSkillContent(skillId: string): string | null {
  const skill = state.skills.get(skillId);
  if (skill && skill.enabled) {
    markSkillUsed(skillId);
    return skill.content;
  }
  return null;
}

/**
 * Get nexus statistics
 */
export function getNexusStats(): {
  skillsLoaded: number;
  capabilities: number;
  totalLoads: number;
  hotReloads: number;
} {
  return {
    skillsLoaded: state.skills.size,
    capabilities: state.capabilities.size,
    totalLoads: state.totalLoads,
    hotReloads: state.hotReloads,
  };
}

export function getNexusState(): NexusState {
  return {
    ...state,
    skills: new Map(state.skills),
    capabilities: new Map(state.capabilities),
  };
}
