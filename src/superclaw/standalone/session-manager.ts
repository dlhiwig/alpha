// @ts-nocheck
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export interface SessionData {
  messages: Message[];
  userId?: string;
  metadata?: Record<string, any>;
}

export interface Session {
  id: string;
  data: SessionData;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export class SessionManager {
  private db: Database.Database | null = null;
  private dbPath: string;

  constructor(dbPath = '/home/toba/superclaw/data/sessions.db') {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    try {
      // Ensure data directory exists
      const dataDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      // Open database connection
      this.db = new Database(this.dbPath);
      
      // Create tables if they don't exist
      await this.createTables();
      
      // Enable WAL mode for better concurrent access
      this.db.pragma('journal_mode = WAL');
      
      console.log(`Session database initialized at: ${this.dbPath}`);
      
    } catch (error: unknown) {
      console.error('Failed to initialize session manager:', error);
      throw error;
    }
  }

  private createTables(): void {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const createSessionsTable = `
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT
      )
    `;

    const createIndexes = `
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
    `;

    this.db.exec(createSessionsTable);
    this.db.exec(createIndexes);
  }

  async createSession(data: SessionData, userId?: string, expiresIn?: number): Promise<Session> {
    if (!this.db) {
      throw new Error('Session manager not initialized');
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn).toISOString() : null;

    const sessionData = {
      ...data,
      userId: userId || data.userId
    };

    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, user_id, data, created_at, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    try {
      stmt.run(id, sessionData.userId || null, JSON.stringify(sessionData), now, now, expiresAt);
      
      return {
        id,
        data: sessionData,
        createdAt: now,
        updatedAt: now,
        expiresAt: expiresAt || undefined
      };
    } catch (error: unknown) {
      console.error('Failed to create session:', error);
      throw error;
    }
  }

  async getSession(id: string): Promise<Session | null> {
    if (!this.db) {
      throw new Error('Session manager not initialized');
    }

    const stmt = this.db.prepare(`
      SELECT id, user_id, data, created_at, updated_at, expires_at
      FROM sessions 
      WHERE id = ?
    `);

    try {
      const row = stmt.get(id) as any;
      
      if (!row) {
        return null;
      }

      // Check if session has expired
      if (row.expires_at && new Date(row.expires_at) < new Date()) {
        await this.deleteSession(id);
        return null;
      }

      return {
        id: row.id,
        data: JSON.parse(row.data),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        expiresAt: row.expires_at || undefined
      };
    } catch (error: unknown) {
      console.error('Failed to get session:', error);
      throw error;
    }
  }

  async updateSession(id: string, data: SessionData): Promise<Session | null> {
    if (!this.db) {
      throw new Error('Session manager not initialized');
    }

    const now = new Date().toISOString();
    
    const stmt = this.db.prepare(`
      UPDATE sessions 
      SET data = ?, updated_at = ?
      WHERE id = ?
    `);

    try {
      const result = stmt.run(JSON.stringify(data), now, id);
      
      if (result.changes === 0) {
        return null;
      }

      return await this.getSession(id);
    } catch (error: unknown) {
      console.error('Failed to update session:', error);
      throw error;
    }
  }

  async deleteSession(id: string): Promise<boolean> {
    if (!this.db) {
      throw new Error('Session manager not initialized');
    }

    const stmt = this.db.prepare(`DELETE FROM sessions WHERE id = ?`);

    try {
      const result = stmt.run(id);
      return result.changes > 0;
    } catch (error: unknown) {
      console.error('Failed to delete session:', error);
      throw error;
    }
  }

  async listSessions(userId?: string, limit = 50, offset = 0): Promise<Session[]> {
    if (!this.db) {
      throw new Error('Session manager not initialized');
    }

    let query = `
      SELECT id, user_id, data, created_at, updated_at, expires_at
      FROM sessions
    `;
    const params: any[] = [];

    if (userId) {
      query += ` WHERE user_id = ?`;
      params.push(userId);
    }

    query += ` ORDER BY updated_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const stmt = this.db.prepare(query);

    try {
      const rows = stmt.all(...params) as any[];
      
      return rows.map(row => ({
        id: row.id,
        data: JSON.parse(row.data),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        expiresAt: row.expires_at || undefined
      }));
    } catch (error: unknown) {
      console.error('Failed to list sessions:', error);
      throw error;
    }
  }

  async cleanExpiredSessions(): Promise<number> {
    if (!this.db) {
      throw new Error('Session manager not initialized');
    }

    const stmt = this.db.prepare(`
      DELETE FROM sessions 
      WHERE expires_at IS NOT NULL AND expires_at < ?
    `);

    try {
      const result = stmt.run(new Date().toISOString());
      console.log(`Cleaned ${result.changes} expired sessions`);
      return result.changes;
    } catch (error: unknown) {
      console.error('Failed to clean expired sessions:', error);
      throw error;
    }
  }

  async getSessionCount(userId?: string): Promise<number> {
    if (!this.db) {
      throw new Error('Session manager not initialized');
    }

    let query = `SELECT COUNT(*) as count FROM sessions`;
    const params: any[] = [];

    if (userId) {
      query += ` WHERE user_id = ?`;
      params.push(userId);
    }

    const stmt = this.db.prepare(query);

    try {
      const result = stmt.get(...params) as any;
      return result.count;
    } catch (error: unknown) {
      console.error('Failed to get session count:', error);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      try {
        this.db.close();
        this.db = null;
        console.log('Session database connection closed');
      } catch (error: unknown) {
        console.error('Error closing database:', error);
        throw error;
      }
    }
  }
}