// @ts-nocheck
/**
 * Yegge Ecosystem Integration - Main Export
 * 
 * Single entry point for all Steve Yegge ecosystem integrations.
 * 
 * This module provides a unified interface to connect SuperClaw with the complete
 * Yegge multi-agent development ecosystem:
 * 
 * - BEADS: Git-backed graph issue tracker for persistent agent memory
 * - Gas Town: Multi-agent workspace orchestration with Mayor pattern
 * - MCP Agent Mail: Inter-agent communication system ("Gmail for coding agents")
 * - VC: Agent colony system with proven 90.9% quality gate success rate
 * - EFRIT: Emacs-native agent runtime with 35+ safety-first tools
 */

// Core components
export {
  YeggeConfig,
  BeadsConfig,
  GastownConfig,
  MCPAgentMailConfig,
  VCConfig,
  EfritConfig,
  SuperClawYeggeConfig,
  defaultYeggeConfig,
  loadYeggeConfig,
  YEGGE_CONFIG
} from './config';

export {
  YeggeEventBridge,
  createYeggeEventBridge,
  getGlobalYeggeEventBridge,
  YeggeEvent,
  BeadsEvent,
  GastownEvent,
  MCPAgentMailEvent,
  VCEvent,
  EfritEvent,
  SuperClawYeggeEvent,
  EventFilter,
  EventSubscription,
  YeggeEventHelpers
} from './event-bridge';

export {
  YeggeHealthMonitor,
  createYeggeHealthMonitor,
  HealthStatus,
  ComponentHealth,
  SystemHealth,
  HealthAlert,
  HealthCheckResult
} from './health-monitor';

export {
  YeggeEcosystemConnector,
  createYeggeEcosystemConnector,
  getGlobalYeggeConnector,
  ConnectorStatus,
  YeggeConnectorOptions,
  CoordinatedWorkflow,
  WorkflowTask,
  WorkflowDependency,
  WorkflowResult
} from './connector';

// CLI command (for internal use)
// @ts-expect-error - Post-Merge Reconciliation
export { yeggeCommand } from '../cli/commands/yegge';

/**
 * Quick Start Guide:
 * 
 * ```typescript
 * import { createYeggeEcosystemConnector } from '@/integrations/yegge';
 * 
 * // Create and start the ecosystem connector
 * const connector = createYeggeEcosystemConnector({ autoStart: true });
 * 
 * // Subscribe to events
 * connector.subscribeToEvents(
 *   { source: ['vc'], type: ['quality-gate-passed'] },
 *   (event) => console.log('Quality gate passed:', event)
 * );
 * 
 * // Execute coordinated workflow
 * const result = await connector.executeCoordinatedWorkflow({
 *   id: 'my-workflow',
 *   name: 'Build Pipeline',
 *   tasks: [...],
 *   dependencies: [...]
 * });
 * ```
 * 
 * CLI Usage:
 * ```bash
 * superclaw yegge status          # Show ecosystem health
 * superclaw yegge start           # Initialize and start all components
 * superclaw yegge events --watch  # Monitor real-time events
 * superclaw yegge workflow demo   # Run demonstration workflow
 * ```
 */

/**
 * Integration Architecture:
 * 
 * ┌─────────────────────────────────────────────────────────────┐
 * │                        SuperClaw                            │
 * │  ┌─────────────────────────────────────────────────────┐    │
 * │  │              Yegge Ecosystem Connector              │    │
 * │  │                                                     │    │
 * │  │  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐ │    │
 * │  │  │ Event Bridge│  │Health Monitor│  │Config Manager│ │    │
 * │  │  └─────────────┘  └─────────────┘  └──────────────┘ │    │
 * │  │                                                     │    │
 * │  │  ┌─────┐ ┌────────┐ ┌──────┐ ┌──┐ ┌─────────────┐  │    │
 * │  │  │BEADS│ │Gas Town│ │MCP   │ │VC│ │EFRIT        │  │    │
 * │  │  │     │ │        │ │Agent │ │  │ │Patterns     │  │    │
 * │  │  │     │ │        │ │Mail  │ │  │ │             │  │    │
 * │  │  └─────┘ └────────┘ └──────┘ └──┘ └─────────────┘  │    │
 * │  └─────────────────────────────────────────────────────┘    │
 * └─────────────────────────────────────────────────────────────┘
 * 
 * Key Benefits:
 * 
 * 1. **Unified Interface**: Single integration point for all Yegge tools
 * 2. **Event Coordination**: Real-time communication between components
 * 3. **Health Monitoring**: Comprehensive system health tracking
 * 4. **Production Proven**: Based on Yegge's battle-tested patterns
 * 5. **Safety First**: EFRIT-inspired tool execution safety
 * 6. **Memory Persistence**: BEADS-powered cross-session memory
 * 7. **Quality Assurance**: VC's 90.9% success rate quality gates
 * 8. **Multi-Agent Orchestration**: Gas Town's Mayor pattern
 * 9. **Agent Communication**: MCP Agent Mail coordination protocols
 */