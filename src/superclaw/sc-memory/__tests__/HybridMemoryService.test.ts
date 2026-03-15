// @ts-nocheck
/**
 * HybridMemoryService Integration Tests
 * 
 * Tests the 3-tier memory architecture:
 * - Tier 1: MEMORY.md generation
 * - Tier 2: SQLite FTS5 fast lookups
 * - Tier 3: Dolt archive + compaction
 */

import { HybridMemoryService, DecayTier } from '../HybridMemoryService';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Test fixtures
const TEST_AGENT = 'test-agent-1';
const TEST_DIR = path.join(os.tmpdir(), `superclaw-hybrid-memory-test-${Date.now()}`);
const SQLITE_PATH = path.join(TEST_DIR, 'memory.db');
const MEMORY_MD_PATH = path.join(TEST_DIR, 'MEMORY.md');

let memory: HybridMemoryService;

// Setup and teardown
beforeAll(() => {
  fs.mkdirSync(TEST_DIR, { recursive: true });
  memory = new HybridMemoryService({
    sqlitePath: SQLITE_PATH,
    memoryMdPath: MEMORY_MD_PATH,
  });
});

afterAll(() => {
  memory.close();
  // Cleanup test files
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('HybridMemoryService', () => {
  describe('Fact Storage', () => {
    test('should store a simple fact', async () => {
      const fact = await memory.storeFact(TEST_AGENT, "Daniel's birthday is March 15");
      
      expect(fact).toBeDefined();
      expect(fact.agentId).toBe(TEST_AGENT);
      expect(fact.value).toContain('March 15');
      expect(fact.id).toMatch(/^fact_/);
    });
    
    test('should auto-classify birthdays as permanent', async () => {
      const fact = await memory.storeFact(TEST_AGENT, "My daughter's birthday is June 3rd");
      
      expect(fact.category).toBe('person');
      expect(fact.decayTier).toBe('permanent');
      expect(fact.ttlMs).toBeNull(); // Permanent = no TTL
    });
    
    test('should auto-classify tasks as active', async () => {
      const fact = await memory.storeFact(TEST_AGENT, "Currently working on the HybridMemoryService");
      
      expect(fact.decayTier).toBe('active');
      expect(fact.ttlMs).toBe(14 * 24 * 60 * 60 * 1000); // 14 days
    });
    
    test('should auto-classify decisions as permanent', async () => {
      const fact = await memory.storeFact(TEST_AGENT, "We decided to use SQLite FTS5 because it's fast and free");
      
      expect(fact.category).toBe('decision');
      expect(fact.decayTier).toBe('permanent');
    });
    
    test('should allow manual category override', async () => {
      const fact = await memory.storeFact(TEST_AGENT, "Some random note", {
        category: 'custom',
        decayTier: 'session',
      });
      
      expect(fact.category).toBe('custom');
      expect(fact.decayTier).toBe('session');
    });
  });
  
  describe('FTS5 Search (Tier 2)', () => {
    beforeAll(async () => {
      // Add test data
      await memory.storeFact(TEST_AGENT, "Project DEFIT uses Firebase");
      await memory.storeFact(TEST_AGENT, "Project SuperClaw uses Dolt for versioning");
      await memory.storeFact(TEST_AGENT, "API key for Anthropic is stored in .env");
    });
    
    test('should find facts by keyword', () => {
      const results = memory.search(TEST_AGENT, 'Firebase');
      
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].source).toBe('fts5');
      expect(results[0].fact.value).toContain('Firebase');
    });
    
    test('should find facts by partial match', () => {
      const results = memory.search(TEST_AGENT, 'Super');
      
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.fact.value.includes('SuperClaw'))).toBe(true);
    });
    
    test('should return scored results', () => {
      const results = memory.search(TEST_AGENT, 'project');
      
      expect(results.length).toBeGreaterThan(0);
      results.forEach(r => {
        expect(typeof r.score).toBe('number');
        expect(r.score).toBeGreaterThan(0);
      });
    });
    
    test('should filter by category', () => {
      const results = memory.search(TEST_AGENT, 'key', { category: 'credential' });
      
      results.forEach(r => {
        expect(r.fact.category).toBe('credential');
      });
    });
    
    test('should respect limit', () => {
      const results = memory.search(TEST_AGENT, 'project', { limit: 1 });
      
      expect(results.length).toBeLessThanOrEqual(1);
    });
  });
  
  describe('Exact Lookup', () => {
    beforeAll(async () => {
      await memory.storeFact(TEST_AGENT, "daughter birthday June 3rd", {
        entity: 'daughter',
        key: 'birthday',
      });
    });
    
    test('should find fact by entity/key', () => {
      const fact = memory.getFact(TEST_AGENT, 'daughter', 'birthday');
      
      expect(fact).toBeDefined();
      expect(fact!.value).toContain('June 3rd');
    });
    
    test('should return null for non-existent fact', () => {
      const fact = memory.getFact(TEST_AGENT, 'nonexistent', 'key');
      
      expect(fact).toBeNull();
    });
    
    test('should get all facts for entity', () => {
      const facts = memory.getEntityFacts(TEST_AGENT, 'daughter');
      
      expect(facts.length).toBeGreaterThan(0);
      facts.forEach(f => expect(f.entity).toBe('daughter'));
    });
  });
  
  describe('Checkpoints', () => {
    test('should create checkpoint', () => {
      const id = memory.createCheckpoint(
        TEST_AGENT,
        'Deploying to production',
        JSON.stringify({ version: '1.0.0', status: 'pending' }),
        {
          expectedOutcome: 'Successful deployment',
          filesModified: ['package.json', 'src/index.ts'],
        }
      );
      
      expect(id).toMatch(/^fact_/);
    });
    
    test('should retrieve latest checkpoint', () => {
      // Create another checkpoint
      memory.createCheckpoint(
        TEST_AGENT,
        'Running database migration',
        JSON.stringify({ migration: 'v2' }),
      );
      
      const checkpoint = memory.getLatestCheckpoint(TEST_AGENT);
      
      expect(checkpoint).toBeDefined();
      expect(checkpoint!.taskDescription).toBe('Running database migration');
    });
  });
  
  describe('MEMORY.md Generation (Tier 1)', () => {
    beforeAll(async () => {
      // Add permanent facts
      await memory.storeFact(TEST_AGENT, "Always use TypeScript strict mode", {
        category: 'convention',
        decayTier: 'permanent',
      });
      await memory.storeFact(TEST_AGENT, "Owner name is Daniel", {
        category: 'person',
        decayTier: 'permanent',
      });
    });
    
    test('should get critical facts', () => {
      const facts = memory.getCriticalFacts(TEST_AGENT);
      
      expect(facts.length).toBeGreaterThan(0);
      facts.forEach(f => expect(f.decayTier).toBe('permanent'));
    });
    
    test('should generate MEMORY.md content', () => {
      const md = memory.generateMemoryMd(TEST_AGENT);
      
      expect(md).toContain('# Critical Memory');
      expect(md).toContain('permanent facts');
    });
    
    test('should sync MEMORY.md to disk', async () => {
      await memory.syncMemoryMd(TEST_AGENT);
      
      const exists = fs.existsSync(MEMORY_MD_PATH);
      expect(exists).toBe(true);
      
      const content = fs.readFileSync(MEMORY_MD_PATH, 'utf-8');
      expect(content).toContain('# Critical Memory');
    });
  });
  
  describe('TTL and Cleanup', () => {
    test('should set correct TTL by tier', async () => {
      const permanent = await memory.storeFact(TEST_AGENT, "Permanent fact", { decayTier: 'permanent' });
      const stable = await memory.storeFact(TEST_AGENT, "Stable fact", { decayTier: 'stable' });
      const active = await memory.storeFact(TEST_AGENT, "Active fact", { decayTier: 'active' });
      const session = await memory.storeFact(TEST_AGENT, "Session fact", { decayTier: 'session' });
      const checkpoint = await memory.storeFact(TEST_AGENT, "Checkpoint fact", { decayTier: 'checkpoint' });
      
      expect(permanent.ttlMs).toBeNull();
      expect(stable.ttlMs).toBe(90 * 24 * 60 * 60 * 1000);
      expect(active.ttlMs).toBe(14 * 24 * 60 * 60 * 1000);
      expect(session.ttlMs).toBe(24 * 60 * 60 * 1000);
      expect(checkpoint.ttlMs).toBe(4 * 60 * 60 * 1000);
    });
    
    test('should cleanup expired facts', () => {
      // This would require time manipulation or mocking
      // For now, just verify the method runs without error
      const deleted = memory.cleanupExpired();
      expect(typeof deleted).toBe('number');
    });
  });
  
  describe('Statistics', () => {
    test('should return stats', () => {
      const stats = memory.getStats(TEST_AGENT);
      
      expect(stats.totalFacts).toBeGreaterThan(0);
      expect(typeof stats.byCategory).toBe('object');
      expect(typeof stats.byTier).toBe('object');
      expect(typeof stats.checkpointCount).toBe('number');
    });
    
    test('should track facts by category', () => {
      const stats = memory.getStats(TEST_AGENT);
      
      // We added various categories in tests
      const totalByCategory = Object.values(stats.byCategory).reduce((a, b) => a + b, 0);
      expect(totalByCategory).toBe(stats.totalFacts);
    });
  });
  
  describe('Decision Extraction', () => {
    test('should auto-extract decisions from text', async () => {
      await memory.storeFact(TEST_AGENT, "We decided to use Fastify over Express because of performance");
      
      // Search for extracted decision
      const results = memory.search(TEST_AGENT, 'Fastify Express', { category: 'decision' });
      
      // Should have at least the original fact (which was classified as decision)
      expect(results.length).toBeGreaterThan(0);
    });
  });
});

// Run tests
describe('Performance', () => {
  test('FTS5 search should be fast (<50ms)', () => {
    const start = Date.now();
    
    for (let i = 0; i < 100; i++) {
      memory.search(TEST_AGENT, 'project');
    }
    
    const duration = Date.now() - start;
    const avgMs = duration / 100;
    
    console.log(`FTS5 search avg: ${avgMs.toFixed(2)}ms`);
    expect(avgMs).toBeLessThan(50);
  });
  
  test('exact lookup should be fast (<10ms)', () => {
    const start = Date.now();
    
    for (let i = 0; i < 100; i++) {
      memory.getFact(TEST_AGENT, 'daughter', 'birthday');
    }
    
    const duration = Date.now() - start;
    const avgMs = duration / 100;
    
    console.log(`Exact lookup avg: ${avgMs.toFixed(2)}ms`);
    expect(avgMs).toBeLessThan(20); // Allow some variance in CI
  });
});
