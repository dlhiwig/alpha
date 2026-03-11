/**
 * SuperClaw Initialization
 * Global singleton for the SuperClaw bridge
 */

import { SuperClawBridge } from "./bridge.js";
import type { SuperClawConfig } from "./types.js";

let globalBridge: SuperClawBridge | null = null;
let initPromise: Promise<SuperClawBridge> | null = null;

/**
 * Get or create the global SuperClaw bridge instance
 */
export async function getSuperclaw(config?: Partial<SuperClawConfig>): Promise<SuperClawBridge> {
  if (globalBridge) {
    return globalBridge;
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    const bridge = new SuperClawBridge(config);
    await bridge.initialize();
    globalBridge = bridge;
    return bridge;
  })();

  return initPromise;
}

/**
 * Check if SuperClaw is initialized
 */
export function isInitialized(): boolean {
  return globalBridge !== null;
}

/**
 * Get the bridge if initialized, otherwise null
 */
export function getBridge(): SuperClawBridge | null {
  return globalBridge;
}

/**
 * Shutdown SuperClaw
 */
export async function shutdown(): Promise<void> {
  if (globalBridge) {
    await globalBridge.shutdown();
    globalBridge = null;
    initPromise = null;
  }
}

/**
 * Quick classification without full processing
 */
export async function classify(message: string) {
  const bridge = await getSuperclaw();
  return bridge.forceClassify(message);
}

/**
 * Process a message through SuperClaw
 */
export async function process(message: string, sessionKey: string, channel?: string) {
  const bridge = await getSuperclaw();
  return bridge.processMessage(message, { sessionKey, channel });
}
