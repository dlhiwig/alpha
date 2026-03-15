/**
 * Yegge Ecosystem Unified Configuration
 * 
 * Single configuration point for all Steve Yegge's multi-agent development tools:
 * - BEADS (memory & task management)
 * - Gas Town (orchestration)  
 * - MCP Agent Mail (communication)
 * - VC (quality gates)
 * - EFRIT (tool execution patterns)
 * 
 * Based on ecosystem analysis from /home/toba/superclaw/docs/intel/yegge-ecosystem-map.md
 */

export interface YeggeConfig {
  // Core Infrastructure
  beads: BeadsConfig;
  gastown: GastownConfig;
  mcpAgentMail: MCPAgentMailConfig;
  
  // Agent Runtimes
  vc: VCConfig;
  efrit: EfritConfig;
  
  // SuperClaw Integration
  superclaw: SuperClawYeggeConfig;
}

export interface BeadsConfig {
  // Git-backed graph issue tracker for persistent agent memory
  enabled: boolean;
  repositoryPath: string;
  databasePath: string;
  
  // Memory management
  memoryDecay: {
    enabled: boolean;
    compactionThresholdMB: number;
    semanticSummaryModel: string;
  };
  
  // Task management
  taskHierarchy: {
    enableEpics: boolean;
    enableSubtasks: boolean;
    autoReadyDetection: boolean;
  };
  
  // Hash-based IDs to prevent merge collisions
  hashIds: {
    prefix: string; // default: 'bd-'
    length: number;  // default: 6
  };
}

export interface GastownConfig {
  // Multi-agent workspace orchestration
  enabled: boolean;
  workspacePath: string;
  
  // The Mayor - AI coordinator
  mayor: {
    model: string;
    maxAgents: number;
    orchestrationStrategy: 'centralized' | 'distributed';
  };
  
  // Rigs - project containers
  rigs: {
    defaultRig: string;
    gitWorktreeBased: boolean;
    persistentHooks: boolean;
  };
  
  // Polecats - worker agents
  polecats: {
    maxConcurrent: number;
    persistentIdentity: boolean;
    toolExecutionSafety: 'strict' | 'permissive';
  };
  
  // Work tracking
  convoys: {
    beadsIntegration: boolean;
    progressTracking: boolean;
    autoCompletion: boolean;
  };
}

export interface MCPAgentMailConfig {
  // "Gmail for coding agents" - async coordination
  enabled: boolean;
  serverPort: number;
  
  // Persistence - dual storage
  persistence: {
    markdownPath: string;    // Human-readable in git
    sqlitePath: string;      // Searchable database
  };
  
  // Agent directory/LDAP
  directory: {
    autoDiscovery: boolean;
    contactPolicies: 'consent-lite' | 'strict';
    autoAllowHeuristics: boolean;
  };
  
  // File reservation system
  reservations: {
    enabled: boolean;
    advisoryLocks: boolean;
    preCommitGuards: boolean;
    maxReservationTime: number; // minutes
  };
  
  // Security
  security: {
    cryptographicSigning: boolean;
    ageEncryption: boolean;
    messageAuditTrail: boolean;
  };
  
  // Web UI for human oversight
  webUI: {
    enabled: boolean;
    port: number;
    authRequired: boolean;
  };
}

export interface VCConfig {
  // VC - VibeCoder v2: Production agent colony
  enabled: boolean;
  
  // AI Supervised Issue Loop
  issueLoop: {
    atomicClaiming: boolean;
    aiAssessment: {
      model: string;
      includeRiskAnalysis: boolean;
      includeStrategicSteps: boolean;
    };
    autoIssueCreation: boolean;
  };
  
  // Quality Gates (90.9% pass rate in production)
  qualityGates: {
    enabled: boolean;
    gates: Array<{
      name: string;
      command: string;
      required: boolean;
      timeout: number;
    }>;
    aiQualityAssessment: boolean;
    autoRetry: boolean;
    selfHealingWorkflows: boolean;
  };
  
  // Production metrics (from dogfooding)
  production: {
    targetSuccessRate: number; // 90.9%
    maxIssuesPerSession: number;
    enableSelfHosting: boolean;
  };
  
  // Zero Framework Cognition - all decisions to AI
  zeroFramework: {
    enabled: boolean;
    noHeuristics: boolean;
    aiDecisionModel: string;
  };
}

export interface EfritConfig {
  // Emacs-native agent runtime patterns
  enabled: boolean;
  
  // Tool execution safety (35+ tools)
  toolExecution: {
    safetyFirst: boolean;
    checkpointingEnabled: boolean;
    rollbackSupport: boolean;
  };
  
  // Natural language to action translation
  nlToAction: {
    model: string;
    confidenceThreshold: number;
    confirmationRequired: boolean;
  };
  
  // Session management
  sessions: {
    persistentState: boolean;
    realTimeProgress: boolean;
    multiTurnConversations: boolean;
  };
}

export interface SuperClawYeggeConfig {
  // SuperClaw-specific integration settings
  integration: {
    // Which components to enable in SuperClaw
    enabledComponents: Array<'beads' | 'gastown' | 'mcp-agent-mail' | 'vc' | 'efrit'>;
    
    // Event bridge settings
    eventBridge: {
      enabled: boolean;
      bufferSize: number;
      batchingEnabled: boolean;
    };
    
    // Health monitoring
    healthMonitoring: {
      enabled: boolean;
      checkInterval: number; // seconds
      alertThresholds: {
        responseTime: number;   // ms
        errorRate: number;      // percentage
        memoryUsage: number;    // MB
      };
    };
    
    // Cross-project coordination
    crossProject: {
      enabled: boolean;
      sharedMemoryPath: string;
      coordinationProtocol: 'mcp-agent-mail' | 'direct';
    };
  };
  
  // Adaptation of Yegge patterns to SuperClaw
  adaptation: {
    // Map Gas Town orchestration to SuperClaw swarms
    swarmOrchestration: {
      useMayorPattern: boolean;
      convoyBasedWorkTracking: boolean;
      gitBasedPersistence: boolean;
    };
    
    // Integrate Beads memory with SuperClaw context
    memoryIntegration: {
      replaceEphemeralQueues: boolean;
      crossSessionPersistence: boolean;
      dependencyAwareDistribution: boolean;
    };
    
    // Adopt VC quality gate patterns
    qualityIntegration: {
      multiStageValidation: boolean;
      aiDrivenAssessment: boolean;
      autoIssueCreation: boolean;
      selfHealingWorkflows: boolean;
    };
    
    // Use EFRIT tool execution safety patterns
    toolSafety: {
      safetyFirstExecution: boolean;
      realTimeProgressTracking: boolean;
      sessionStateManagement: boolean;
    };
  };
}

// Default configuration following Yegge's production patterns
export const defaultYeggeConfig: YeggeConfig = {
  beads: {
    enabled: true,
    repositoryPath: './yegge-memory',
    databasePath: './yegge-memory/.beads/beads.db',
    memoryDecay: {
      enabled: true,
      compactionThresholdMB: 100,
      semanticSummaryModel: 'claude-3-5-sonnet-20241022',
    },
    taskHierarchy: {
      enableEpics: true,
      enableSubtasks: true,
      autoReadyDetection: true,
    },
    hashIds: {
      prefix: 'bd-',
      length: 6,
    },
  },
  
  gastown: {
    enabled: true,
    workspacePath: './gastown-workspace',
    mayor: {
      model: 'claude-3-5-sonnet-20241022',
      maxAgents: 20, // Yegge's target: 20-30 agent workflows
      orchestrationStrategy: 'centralized',
    },
    rigs: {
      defaultRig: 'superclaw-rig',
      gitWorktreeBased: true,
      persistentHooks: true,
    },
    polecats: {
      maxConcurrent: 10,
      persistentIdentity: true,
      toolExecutionSafety: 'strict',
    },
    convoys: {
      beadsIntegration: true,
      progressTracking: true,
      autoCompletion: true,
    },
  },
  
  mcpAgentMail: {
    enabled: true,
    serverPort: 3001,
    persistence: {
      markdownPath: './agent-mail/messages',
      sqlitePath: './agent-mail/search.db',
    },
    directory: {
      autoDiscovery: true,
      contactPolicies: 'consent-lite',
      autoAllowHeuristics: true,
    },
    reservations: {
      enabled: true,
      advisoryLocks: true,
      preCommitGuards: true,
      maxReservationTime: 60, // 1 hour
    },
    security: {
      cryptographicSigning: true,
      ageEncryption: true,
      messageAuditTrail: true,
    },
    webUI: {
      enabled: true,
      port: 3002,
      authRequired: false, // Internal use
    },
  },
  
  vc: {
    enabled: true,
    issueLoop: {
      atomicClaiming: true,
      aiAssessment: {
        model: 'claude-3-5-sonnet-20241022',
        includeRiskAnalysis: true,
        includeStrategicSteps: true,
      },
      autoIssueCreation: true,
    },
    qualityGates: {
      enabled: true,
      gates: [
        { name: 'lint', command: 'npm run lint', required: true, timeout: 30 },
        { name: 'test', command: 'npm test', required: true, timeout: 120 },
        { name: 'build', command: 'npm run build', required: true, timeout: 300 },
      ],
      aiQualityAssessment: true,
      autoRetry: true,
      selfHealingWorkflows: true,
    },
    production: {
      targetSuccessRate: 90.9, // Proven in VC production
      maxIssuesPerSession: 50,
      enableSelfHosting: true,
    },
    zeroFramework: {
      enabled: true,
      noHeuristics: true,
      aiDecisionModel: 'claude-3-5-sonnet-20241022',
    },
  },
  
  efrit: {
    enabled: true,
    toolExecution: {
      safetyFirst: true,
      checkpointingEnabled: true,
      rollbackSupport: true,
    },
    nlToAction: {
      model: 'claude-3-5-sonnet-20241022',
      confidenceThreshold: 0.8,
      confirmationRequired: true,
    },
    sessions: {
      persistentState: true,
      realTimeProgress: true,
      multiTurnConversations: true,
    },
  },
  
  superclaw: {
    integration: {
      enabledComponents: ['beads', 'gastown', 'mcp-agent-mail', 'vc', 'efrit'],
      eventBridge: {
        enabled: true,
        bufferSize: 1000,
        batchingEnabled: true,
      },
      healthMonitoring: {
        enabled: true,
        checkInterval: 30, // 30 seconds
        alertThresholds: {
          responseTime: 5000,  // 5 seconds
          errorRate: 5,        // 5%
          memoryUsage: 512,    // 512MB per component
        },
      },
      crossProject: {
        enabled: true,
        sharedMemoryPath: './shared-yegge-memory',
        coordinationProtocol: 'mcp-agent-mail',
      },
    },
    adaptation: {
      swarmOrchestration: {
        useMayorPattern: true,
        convoyBasedWorkTracking: true,
        gitBasedPersistence: true,
      },
      memoryIntegration: {
        replaceEphemeralQueues: true,
        crossSessionPersistence: true,
        dependencyAwareDistribution: true,
      },
      qualityIntegration: {
        multiStageValidation: true,
        aiDrivenAssessment: true,
        autoIssueCreation: true,
        selfHealingWorkflows: true,
      },
      toolSafety: {
        safetyFirstExecution: true,
        realTimeProgressTracking: true,
        sessionStateManagement: true,
      },
    },
  },
};

// Environment-based configuration loading
export function loadYeggeConfig(): YeggeConfig {
  // In production, this would load from environment variables,
  // config files, or external configuration management
  return {
    ...defaultYeggeConfig,
    // Override with environment-specific settings
    beads: {
      ...defaultYeggeConfig.beads,
      repositoryPath: process.env.YEGGE_BEADS_REPO || defaultYeggeConfig.beads.repositoryPath,
    },
    gastown: {
      ...defaultYeggeConfig.gastown,
      workspacePath: process.env.YEGGE_GASTOWN_WORKSPACE || defaultYeggeConfig.gastown.workspacePath,
    },
    mcpAgentMail: {
      ...defaultYeggeConfig.mcpAgentMail,
      serverPort: parseInt(process.env.YEGGE_MCP_PORT || '3001'),
    },
  };
}

export const YEGGE_CONFIG = loadYeggeConfig();