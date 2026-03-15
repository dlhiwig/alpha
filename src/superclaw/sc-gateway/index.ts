/**
 * Gateway Module Entry Point
 * Exports the main gateway functionality
 */

export { createGatewayServer } from './server';
export { getGatewayRouter } from './router';
export { getSessionManager } from './session-manager';
export { getWebSocketManager, registerWebSocketRoutes } from './websocket';

// Alias for main index.ts compatibility
export { createGatewayServer as startGateway } from './server';

export type { GatewayOptions, GatewayServer } from './server';