# Gas Town Orchestration Patterns for SuperClaw

This module integrates Steve Yegge's Gas Town multi-agent orchestration patterns into SuperClaw's swarm system, providing persistent, git-backed multi-agent workflows with intelligent coordination.

## 🧠 Core Concepts

### The Mayor
**AI coordinator and primary interface**
- Analyzes complex tasks and breaks them into manageable beads
- Orchestrates multiple worker agents (polecats)
- Maintains persistent memory of successful patterns
- Provides natural language interface for complex workflows

### Rigs
**Project containers wrapping git repositories**
- Isolated workspaces for different projects
- Per-rig configuration (runtime, git settings, quality gates)
- Git-native for developer workflow integration

### Polecats
**Worker agents with persistent identity**
- Specialized AI agents with defined expertise and personality
- Persistent identity survives session restarts
- Tracks performance and learns from experience
- Mapped to SuperClaw's provider system (Claude, Gemini, etc.)

### Hooks
**Git worktree-based persistent storage**
- Each polecat gets isolated git worktree
- All work is version-controlled and auditable
- Survives crashes and restarts
- Enables rollback and collaboration

### Convoys
**Work tracking units bundling beads**
- Groups related work items for coordination
- Tracks progress and dependencies
- Supports different merge strategies
- Integrates with existing project management

### MEOW Pattern
**Mayor-Enhanced Orchestration Workflow**
1. **Tell the Mayor** - Natural language task description
2. **Analysis** - Break down into manageable beads
3. **Convoy Creation** - Bundle related work
4. **Agent Assignment** - Match skills to tasks
5. **Orchestrated Execution** - Coordinate parallel/sequential work
6. **Progress Monitoring** - Real-time status tracking
7. **Synthesis & Learning** - Combine results and update patterns

## 🚀 Quick Start

### Basic Usage

```typescript
import { gastownSwarm } from './gastown-patterns.js';

// Simple task orchestration
const result = await gastownSwarm('Build a user authentication system', {
  context: 'JWT-based auth with login, signup, and password reset',
  strategy: 'parallel',
  maxPolecats: 3,
  providers: ['claude', 'gemini'],
});

console.log(`Completed ${result.beads.length} beads in ${result.totalDurationMs}ms`);
console.log(`Strategy: ${result.strategy}`);
console.log(`Success: ${result.synthesis.success}`);
```

### Advanced Mayor Usage

```typescript
import { initializeGasTownWorkspace } from './gastown-patterns.js';

// Initialize workspace
const mayor = await initializeGasTownWorkspace('./my-gastown-workspace');

// Add project rig
const rig = await mayor.addRig(
  'my-project', 
  'https://github.com/user/project.git',
  'main'
);

// Create specialized polecats
const frontendExpert = await mayor.createPolecat('alice', 'claude', rig.id, {
  personality: 'detail-oriented and user-focused',
  expertise: ['frontend', 'react', 'typescript', 'css'],
  workingStyle: 'component-driven development with comprehensive testing',
  preferences: { framework: 'react', styling: 'tailwind' }
});

const backendExpert = await mayor.createPolecat('bob', 'gemini', rig.id, {
  personality: 'systematic and security-conscious',
  expertise: ['backend', 'node.js', 'databases', 'apis'],
  workingStyle: 'API-first design with robust error handling',
  preferences: { database: 'postgresql', orm: 'prisma' }
});

// Orchestrate complex task
const result = await mayor.orchestrate(
  'Build a complete e-commerce product catalog with search and filtering',
  {
    context: `
      Requirements:
      - Frontend: React components for product display, search, filters
      - Backend: REST API for products, categories, search endpoints
      - Database: PostgreSQL schema with proper indexing
      - Features: Full-text search, category filters, price ranges
    `,
    strategy: 'hybrid', // Parallel where possible, sequential for dependencies
    maxPolecats: 4,
    mergeStrategy: 'mr', // Create merge requests for review
    owned: false // Let mayor manage convoy lifecycle
  }
);

// Track progress
const status = await mayor.getConvoyStatus(result.convoy.id);
console.log(`Progress: ${status.progress.percentage.toFixed(1)}%`);
console.log(`Completed: ${status.progress.completed}/${status.progress.total}`);

// Save state for persistence
await mayor.saveState();
```

### Integration with Existing SuperClaw Workflows

```typescript
import { runSwarm } from '../orchestrator.js';
import { Mayor } from './gastown-patterns.js';

// Hybrid approach: Use Gas Town for complex orchestration,
// SuperClaw swarms for individual subtasks
const mayor = new Mayor('./workspace');

// Let mayor break down the task
const analysis = await mayor.analyzeTask(
  'Implement comprehensive API testing suite'
);

// Use SuperClaw swarm for each bead
for (const bead of analysis.beads) {
  const swarmResult = await runSwarm({
    mode: 'fanout-critique',
    task: bead.description,
    context: `Part of larger task: ${bead.title}`,
    agents: createDefaultAgents(['claude', 'gemini']),
  });
  
  // Integrate results back into Gas Town
  bead.status = swarmResult.synthesis.confidence > 0.8 ? 'completed' : 'failed';
  bead.metadata.swarmResult = swarmResult;
}
```

## 📋 API Reference

### Mayor Class

#### Core Methods

```typescript
// Task orchestration (MEOW pattern)
async orchestrate(task: string, options?: OrchestrationOptions): Promise<ConvoyResult>

// Task analysis
async analyzeTask(task: string, context?: string): Promise<TaskAnalysis>

// Workspace management
async addRig(name: string, gitRepo: string, baseBranch?: string): Promise<Rig>
async createPolecat(name: string, provider: ProviderName, rigId: string, identity?: PolecatIdentity): Promise<Polecat>

// Convoy management
async createConvoy(name: string, beadIds: string[], options?: ConvoyOptions): Promise<Convoy>
async listConvoys(): Promise<Convoy[]>
async getConvoyStatus(convoyId: string): Promise<ConvoyStatus | undefined>

// Persistence
async saveState(): Promise<void>
async loadState(): Promise<void>
```

#### Types

```typescript
interface OrchestrationOptions {
  context?: string;
  strategy?: 'parallel' | 'sequential' | 'hybrid';
  maxPolecats?: number;
  mergeStrategy?: 'direct' | 'mr' | 'local';
  owned?: boolean;
}

interface TaskAnalysis {
  beads: Bead[];
  strategy: string;
  estimatedTime: number;
  requiredSkills: string[];
}

interface ConvoyResult {
  convoy: Convoy;
  beads: Bead[];
  assignments: Map<string, string>;
  results: WorkResult[];
  synthesis: any;
  totalDurationMs: number;
  strategy: string;
}
```

### Factory Functions

```typescript
// Create mayor instance
function createMayor(workspacePath: string): Mayor

// Initialize full workspace
async function initializeGasTownWorkspace(path: string): Promise<Mayor>

// High-level swarm API
async function gastownSwarm(task: string, options?: SwarmOptions): Promise<ConvoyResult>
```

## 🛠️ Configuration

### Rig Settings

Each rig can be configured with specific runtime and quality settings:

```typescript
const rig = await mayor.addRig('my-project', 'https://github.com/user/project.git');

// Configure runtime
rig.settings.runtime = {
  provider: 'claude',
  command: 'claude',
  args: ['--model', 'sonnet'],
  promptMode: 'enhanced'
};

// Configure git behavior
rig.settings.git = {
  autoCommit: true,
  autoPush: false,
  branchPrefix: 'feature'
};

// Configure quality gates
rig.settings.quality = {
  enableTests: true,
  enableLinting: true,
  requireReview: true
};
```

### Polecat Identities

Define specialized agent personas for different types of work:

```typescript
const specialist = await mayor.createPolecat('security-expert', 'claude', rigId, {
  personality: 'paranoid but practical, focuses on edge cases',
  expertise: ['security', 'authentication', 'encryption', 'compliance'],
  workingStyle: 'threat-model driven development with security-first design',
  preferences: {
    authMethod: 'oauth2',
    encryption: 'aes-256',
    hashing: 'argon2',
    sessionManagement: 'jwt-refresh'
  }
});
```

## 🔄 Orchestration Strategies

### Parallel Strategy
- Execute all beads simultaneously
- Best for independent tasks
- Fastest completion time
- Requires good resource management

### Sequential Strategy
- Execute beads in dependency order
- Best for complex dependencies
- More predictable resource usage
- Longer completion time

### Hybrid Strategy (Recommended)
- Parallel where possible, sequential where needed
- Analyzes dependencies automatically
- Balances speed with correctness
- Adapts to task complexity

## 🗄️ Persistence & Git Integration

### Hook System
Every polecat gets a persistent git worktree:
```
workspace/
├── hooks/
│   ├── my-project/
│   │   ├── alice/          # Frontend expert's workspace
│   │   │   ├── .git/       # Git worktree
│   │   │   ├── src/        # Work files
│   │   │   └── bead-abc12-summary.md
│   │   └── bob/            # Backend expert's workspace
│   │       ├── .git/
│   │       ├── api/
│   │       └── bead-def34-summary.md
├── rigs/
│   └── my-project/         # Main project repo
└── mayor-state.json        # Mayor's persistent memory
```

### State Management
- All work survives restarts
- Git history provides audit trail
- Rollback to any previous state
- Collaborative development ready

## 🧪 Testing

Run the test suite:
```bash
cd /home/toba/superclaw
npm test -- src/swarm/orchestration/__tests__/gastown-patterns.test.ts
```

Key test categories:
- **Mayor functionality** - Task analysis, orchestration, state management
- **Rig operations** - Project setup, workspace creation
- **Polecat management** - Agent creation, identity persistence
- **Convoy tracking** - Work coordination, progress monitoring
- **MEOW pattern** - End-to-end orchestration workflows
- **Integration** - SuperClaw agent system compatibility

## 🚦 Best Practices

### Task Design
- **Clear objectives**: Provide specific, measurable goals
- **Rich context**: Include requirements, constraints, examples
- **Appropriate scope**: Not too small (overhead) or large (complexity)

### Polecat Specialization
- **Domain expertise**: Match agent skills to task requirements
- **Consistent identity**: Maintain personality across sessions  
- **Performance tracking**: Monitor and optimize based on results

### Convoy Management
- **Logical grouping**: Bundle related work for coordination
- **Dependency awareness**: Understand task interdependencies
- **Progress monitoring**: Track status and adjust as needed

### Workspace Organization
- **Project isolation**: Separate rigs for different projects
- **Clear naming**: Use descriptive names for polecats and convoys
- **Regular commits**: Ensure work is persisted frequently

## 🔮 Future Enhancements

### Planned Features
- **Cross-rig coordination** - Polecats working across multiple projects
- **Advanced dependency management** - Automatic dependency resolution
- **Quality gate automation** - Integrated testing and validation
- **Performance optimization** - Agent load balancing and scaling
- **Human oversight integration** - Review and approval workflows

### Integration Opportunities
- **GitHub Actions** - Automated deployment from hooks
- **Project management** - Jira, Linear, GitHub Issues integration
- **Communication** - Slack, Discord notifications
- **Monitoring** - Metrics and alerting for convoy progress

## 📚 References

- [Gas Town Repository](https://github.com/steveyegge/gastown) - Original implementation
- [SuperClaw Swarm Documentation](../README.md) - Core swarm system
- [MEOW Pattern Blog Post](https://yegge.medium.com) - Architectural background
- [Multi-Agent Development](../../../docs/multi-agent.md) - Broader context

---

**Gas Town + SuperClaw = The Future of Multi-Agent Development**

*Build colonies of coding agents, not monolithic monsters.*