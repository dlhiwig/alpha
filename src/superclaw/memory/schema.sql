-- SuperClaw Agent Memory Schema
-- Dolt-compatible (MySQL dialect)
-- Version: 2.3.0 SINGULARITY

-- Main memory storage table
CREATE TABLE IF NOT EXISTS agent_memory (
    id VARCHAR(255) PRIMARY KEY COMMENT 'Hash-based collision-resistant ID',
    agent_id VARCHAR(255) NOT NULL COMMENT 'Owning agent identifier',
    title VARCHAR(500) NOT NULL COMMENT 'Memory title/concept name',
    description TEXT COMMENT 'Full memory content',
    memory_type VARCHAR(32) NOT NULL COMMENT 'learning|context|capability|relationship|decision',
    status VARCHAR(32) DEFAULT 'active' COMMENT 'active|archived|compacted',
    compaction_level INT DEFAULT 0 COMMENT '0=none, 1=summarized, 2=deep',
    original_size INT COMMENT 'Size before compaction',
    compacted_at DATETIME COMMENT 'When compaction occurred',
    metadata JSON DEFAULT (JSON_OBJECT()) COMMENT 'Additional metadata',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Indexes for efficient queries
    INDEX idx_agent_type (agent_id, memory_type) COMMENT 'Query memories by agent and type',
    INDEX idx_status_updated (status, updated_at) COMMENT 'Find active/stale memories',
    INDEX idx_compaction (compaction_level, updated_at) COMMENT 'Find compaction candidates',
    INDEX idx_agent_status (agent_id, status) COMMENT 'Filter by agent and status'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Memory relationships (graph structure)
CREATE TABLE IF NOT EXISTS memory_relationships (
    source_id VARCHAR(255) NOT NULL COMMENT 'Source memory ID',
    target_id VARCHAR(255) NOT NULL COMMENT 'Target memory ID',
    relationship_type VARCHAR(32) NOT NULL COMMENT 'builds-on|conflicts-with|validates|supercedes',
    strength FLOAT DEFAULT 1.0 COMMENT 'Relationship strength (0-1)',
    metadata JSON DEFAULT (JSON_OBJECT()) COMMENT 'Relationship metadata',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    PRIMARY KEY (source_id, target_id, relationship_type),
    FOREIGN KEY (source_id) REFERENCES agent_memory(id) ON DELETE CASCADE,
    FOREIGN KEY (target_id) REFERENCES agent_memory(id) ON DELETE CASCADE,
    INDEX idx_target (target_id) COMMENT 'Find relationships to a memory',
    INDEX idx_type (relationship_type) COMMENT 'Filter by relationship type'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Agent statistics and metadata
CREATE TABLE IF NOT EXISTS agent_stats (
    agent_id VARCHAR(255) PRIMARY KEY COMMENT 'Agent identifier',
    total_memories INT DEFAULT 0 COMMENT 'Total memory count',
    active_memories INT DEFAULT 0 COMMENT 'Active (non-archived) count',
    compacted_memories INT DEFAULT 0 COMMENT 'Compacted memory count',
    total_size_bytes BIGINT DEFAULT 0 COMMENT 'Total memory size',
    last_compaction DATETIME COMMENT 'Last compaction timestamp',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Compaction audit log
CREATE TABLE IF NOT EXISTS compaction_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    agent_id VARCHAR(255) NOT NULL COMMENT 'Agent identifier',
    memory_id VARCHAR(255) NOT NULL COMMENT 'Compacted memory ID',
    original_size INT NOT NULL COMMENT 'Size before compaction',
    compacted_size INT NOT NULL COMMENT 'Size after compaction',
    compaction_level INT NOT NULL COMMENT 'Compaction level applied',
    compression_ratio FLOAT COMMENT 'Achieved compression ratio',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_agent (agent_id) COMMENT 'Find compactions by agent',
    INDEX idx_memory (memory_id) COMMENT 'Find compactions for a memory'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Memory embeddings for semantic search (future)
CREATE TABLE IF NOT EXISTS memory_embeddings (
    memory_id VARCHAR(255) PRIMARY KEY COMMENT 'Associated memory ID',
    embedding BLOB COMMENT 'Vector embedding',
    embedding_model VARCHAR(100) COMMENT 'Model used for embedding',
    dimensions INT COMMENT 'Embedding dimensions',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (memory_id) REFERENCES agent_memory(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Session tracking for orchestration
CREATE TABLE IF NOT EXISTS agent_sessions (
    session_id VARCHAR(255) PRIMARY KEY COMMENT 'Session identifier',
    agent_id VARCHAR(255) NOT NULL COMMENT 'Agent identifier',
    project VARCHAR(255) NOT NULL COMMENT 'Project name',
    role VARCHAR(32) NOT NULL COMMENT 'Agent role',
    namespace VARCHAR(255) DEFAULT 'superclaw' COMMENT 'Agent namespace',
    status VARCHAR(32) DEFAULT 'active' COMMENT 'Session status',
    workspace_path VARCHAR(500) COMMENT 'Workspace directory path',
    pid INT COMMENT 'Process ID',
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    metrics JSON DEFAULT (JSON_OBJECT()) COMMENT 'Session metrics',
    
    INDEX idx_agent (agent_id) COMMENT 'Find sessions by agent',
    INDEX idx_project (project) COMMENT 'Find sessions by project',
    INDEX idx_status (status) COMMENT 'Find active sessions'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;