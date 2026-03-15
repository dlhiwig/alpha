-- SuperClaw SQLite Schema
-- Persistence layer for swarm runs, patterns, costs, and trajectories

-- Swarm runs table
CREATE TABLE IF NOT EXISTS swarm_runs (
    id TEXT PRIMARY KEY,
    task TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    config_json TEXT,
    result_json TEXT,
    error TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    started_at INTEGER,
    completed_at INTEGER,
    duration_ms INTEGER
);

-- Agent executions within a run
CREATE TABLE IF NOT EXISTS agent_executions (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES swarm_runs(id) ON DELETE CASCADE,
    agent_type TEXT NOT NULL,
    task TEXT NOT NULL,
    model TEXT,
    tier INTEGER,
    status TEXT NOT NULL DEFAULT 'pending',
    result_json TEXT,
    error TEXT,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cost_usd REAL DEFAULT 0,
    latency_ms INTEGER,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    completed_at INTEGER
);

-- SONA learned patterns
CREATE TABLE IF NOT EXISTS sona_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern_hash TEXT UNIQUE NOT NULL,
    pattern_type TEXT NOT NULL,
    pattern_name TEXT NOT NULL,
    embedding_json TEXT,
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    avg_quality REAL DEFAULT 0,
    last_used_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- Cost tracking aggregates
CREATE TABLE IF NOT EXISTS cost_daily (
    date TEXT PRIMARY KEY,
    tier1_count INTEGER DEFAULT 0,
    tier2_count INTEGER DEFAULT 0,
    tier3_count INTEGER DEFAULT 0,
    total_input_tokens INTEGER DEFAULT 0,
    total_output_tokens INTEGER DEFAULT 0,
    total_cost_usd REAL DEFAULT 0,
    estimated_savings_usd REAL DEFAULT 0
);

-- Trajectories for SONA learning
CREATE TABLE IF NOT EXISTS trajectories (
    id TEXT PRIMARY KEY,
    run_id TEXT REFERENCES swarm_runs(id) ON DELETE SET NULL,
    task_hash TEXT NOT NULL,
    embedding_json TEXT,
    steps_json TEXT,
    outcome TEXT,
    quality_score REAL,
    learned INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- Model routing decisions
CREATE TABLE IF NOT EXISTS routing_decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT REFERENCES swarm_runs(id) ON DELETE SET NULL,
    task_preview TEXT,
    complexity_score REAL,
    selected_tier INTEGER,
    reason TEXT,
    was_correct INTEGER,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_swarm_runs_status ON swarm_runs(status);
CREATE INDEX IF NOT EXISTS idx_swarm_runs_created ON swarm_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_executions_run ON agent_executions(run_id);
CREATE INDEX IF NOT EXISTS idx_trajectories_run ON trajectories(run_id);
CREATE INDEX IF NOT EXISTS idx_trajectories_learned ON trajectories(learned);
CREATE INDEX IF NOT EXISTS idx_routing_decisions_run ON routing_decisions(run_id);
CREATE INDEX IF NOT EXISTS idx_sona_patterns_type ON sona_patterns(pattern_type);
