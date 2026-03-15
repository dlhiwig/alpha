/**
 * Claude-Flow v3 Core
 * Extracted from ruvnet/claude-flow for SuperClaw integration
 * 
 * Zero npm dependencies - just Node's EventEmitter
 */

export * from './types';
export { Agent } from './Agent';
export { Task } from './Task';
export { SwarmCoordinator, type SwarmCoordinatorOptions } from './SwarmCoordinator';
