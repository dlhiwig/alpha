/**
 * SuperClaw + SKYNET Initialization
 * Global singletons for the SuperClaw bridge and SKYNET governance
 */

import { SuperClawBridge } from "./bridge.js";
import { getSkynet, shutdownSkynet, type Skynet, type SkynetConfig } from "./skynet.js";
import { attachNemotronModule, type NemotronModule } from "./nemotron-integration.js";
import type { SuperClawConfig } from "./types.js";
import * as os from "node:os";
import * as path from "node:path";

let globalBridge: SuperClawBridge | null = null;
let initPromise: Promise<SuperClawBridge> | null = null;
let skynetInstance: Skynet | null = null;
let nemotronModule: NemotronModule | null = null;

/**
 * Get or create the global SuperClaw bridge instance + SKYNET
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

    // Initialize SKYNET governance layer
    try {
      const stateDir =
        globalThis.process.env.ALPHA_STATE_DIR ?? path.join(os.homedir(), ".alpha");
      const skynetConfig: SkynetConfig = {
        stateDir,
        dbPath: path.join(stateDir, "skynet-audit.db"),
        pulseIntervalMs: 30_000,
        sentinelEnabled: true,
        oracleEnabled: true,
      };
      skynetInstance = getSkynet(skynetConfig);
      await skynetInstance.initialize();
      console.log("[SKYNET] Governance layer active — Laws I/II/III enforced");

      // Attach Nemotron local LLM module (auditor + judge)
      try {
        nemotronModule = attachNemotronModule(skynetInstance, {
          baseUrl: globalThis.process.env.OLLAMA_URL ?? "http://127.0.0.1:11434",
          model: globalThis.process.env.NEMOTRON_MODEL ?? "nemotron-3-super",
          fallbackModel: globalThis.process.env.NEMOTRON_FALLBACK ?? "qwen3.5:27b",
        });
        console.log("[SKYNET:NEMOTRON] Local audit + judge module active");
      } catch (nemErr) {
        console.warn("[SKYNET:NEMOTRON] Failed to attach (non-fatal):", (nemErr as Error).message);
      }
    } catch (err) {
      console.warn("[SKYNET] Failed to initialize (non-fatal):", (err as Error).message);
    }

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
 * Get the SKYNET instance (if initialized)
 */
export function getSkynetInstance(): Skynet | null {
  return skynetInstance;
}

/**
 * Get the Nemotron module (if attached)
 */
export function getNemotronModule(): NemotronModule | null {
  return nemotronModule;
}

/**
 * Shutdown SuperClaw + SKYNET
 */
export async function shutdown(): Promise<void> {
  shutdownSkynet();
  skynetInstance = null;
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
