/**
 * SuperClaw Standalone Session Manager
 * SQLite-based replacement for OpenClaw file-based sessions
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs/promises';

export interface SessionData {
  id: string;
  userId: string;
  data: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}

export interface CreateSessionOptions {
  userId: string;
  data?: Record<string, any>;
  expiresIn?: number; // seconds
}

export class SessionManager {
  private db: Database.Database;
  
  constructor(private dbPath: string = './data/sessions.db') {
    // Ensure data directory exists
    this.ensureDataDir();
    
    this.db = new Database(dbPath);
    this.createTables();
    this.setupCleanup();
  }
  
  private async ensureDataDir(): Promise<void> {
    const dir = path.dirname(this.dbPath);
    await fs.mkdir(dir, { recursive: true });
  }
  
  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME
      );
      
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
    `);
  }
  
  private setupCleanup(): void {
    // Clean expired sessions every hour
    setInterval(() => {
      this.cleanupExpiredSessions();
    }, 60 * 60 * 1000);
  }
  
  createSession(options: CreateSessionOptions): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    const expiresAt = options.expiresIn 
      ? new Date(Date.now() + options.expiresIn * 1000).toISOString()
      : null;
    
    this.db.prepare(`
      INSERT INTO sessions (id, user_id, data, created_at, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      options.userId,
      JSON.stringify(options.data || {}),
      now,
      now,
      expiresAt
    );
    
    return id;
  }
  
  getSession(id: string): SessionData | null {
    const row = this.db.prepare(`
      SELECT * FROM sessions 
      WHERE id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
    `).get(id) as any;
    
    if (!row) {return null;}
    
    return {
      id: row.id,
      userId: row.user_id,
      data: JSON.parse(row.data),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      expiresAt: row.expires_at ? new Date(row.expires_at) : undefined
    };
  }
  
  updateSession(id: string, data: Record<string, any>): boolean {
    const result = this.db.prepare(`
      UPDATE sessions 
      SET data = ?, updated_at = datetime('now')
      WHERE id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
    `).run(JSON.stringify(data), id);
    
    return result.changes > 0;
  }
  
  deleteSession(id: string): boolean {
    const result = this.db.prepare(`
      DELETE FROM sessions WHERE id = ?
    `).run(id);
    
    return result.changes > 0;
  }
  
  listUserSessions(userId: string, limit: number = 10): SessionData[] {
    const rows = this.db.prepare(`
      SELECT * FROM sessions 
      WHERE user_id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(userId, limit) as any[];
    
    return rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      data: JSON.parse(row.data),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      expiresAt: row.expires_at ? new Date(row.expires_at) : undefined
    }));
  }
  
  private cleanupExpiredSessions(): void {
    const result = this.db.prepare(`
      DELETE FROM sessions WHERE expires_at <= datetime('now')
    `).run();
    
    if (result.changes > 0) {
      console.log(`🧹 Cleaned up ${result.changes} expired sessions`);
    }
  }
  
  close(): void {
    this.db.close();
  }
  
  // Migration helper for OpenClaw file-based sessions
  async migrateFromOpenClaw(openClawSessionsDir: string): Promise<number> {
    // TODO: Implement migration from OpenClaw file-based sessions
    throw new Error('Migration not implemented yet');
  }
}