/**
 * SuperClaw Gateway Hook
 * Integrates SuperClaw bridge into the OpenClaw gateway agent handler
 */

import type { SuperClawBridge, ProcessResult, SessionContext } from "./bridge.js";
import type { Skynet } from "./skynet.js";
import {
  type MiddlewareChain,
  type MiddlewareContext,
  createDefaultMiddlewareChain,
  createMiddlewareContext,
  createMiddlewareResult,
} from "./middleware.js";

export interface GatewayHookConfig {
  /** Enable SuperClaw routing */
  enabled: boolean;
  /** Log classification decisions */
  logDecisions: boolean;
  /** Always use swarm for explicit /swarm commands */
  honorSwarmCommand: boolean;
}

const DEFAULT_HOOK_CONFIG: GatewayHookConfig = {
  enabled: true,
  logDecisions: false,
  honorSwarmCommand: true,
};

/**
 * Create a gateway hook that intercepts agent requests
 * and routes through SuperClaw when appropriate
 */
export function createGatewayHook(
  bridge: SuperClawBridge,
  config: Partial<GatewayHookConfig> = {},
) {
  const hookConfig = { ...DEFAULT_HOOK_CONFIG, ...config };

  return {
    /**
     * Pre-process hook - runs before the agent handler
     * Returns a suggested model override if SuperClaw classified the task
     */
    async preProcess(params: {
      message: string;
      sessionKey: string;
      channel?: string;
      userId?: string;
    }): Promise<{
      suggestedModel?: string;
      shouldUseSwarm?: boolean;
      classification?: ProcessResult["classification"];
    } | null> {
      if (!hookConfig.enabled) {return null;}

      try {
        // Check for explicit /swarm command
        const isSwarmCommand =
          hookConfig.honorSwarmCommand && params.message.trim().toLowerCase().startsWith("/swarm");

        const context: SessionContext = {
          sessionKey: params.sessionKey,
          channel: params.channel,
          userId: params.userId,
        };

        // Process through bridge
        const result = await bridge.processMessage(
          isSwarmCommand ? params.message.replace(/^\/swarm\s*/i, "") : params.message,
          context,
        );

        if (hookConfig.logDecisions && result.classification) {
          console.log(`[SuperClaw] Classified: ${result.classification.complexity}`, {
            model: result.classification.suggestedModel,
            confidence: result.classification.confidence,
          });
        }

        // If swarm handled it, we'll need special handling
        if (result.handled) {
          return {
            suggestedModel: result.classification?.suggestedModel,
            shouldUseSwarm: true,
            classification: result.classification,
          };
        }

        // Return model suggestion for normal agent processing
        return {
          suggestedModel: result.classification?.suggestedModel,
          shouldUseSwarm: false,
          classification: result.classification,
        };
      } catch (error) {
        console.error("[SuperClaw] Pre-process error:", error);
        return null;
      }
    },

    /**
     * Post-process hook - runs after the agent completes
     * Records outcome for learning
     */
    async postProcess(params: {
      message: string;
      response: string;
      sessionKey: string;
      success: boolean;
      latencyMs: number;
      tokensUsed?: number;
      model?: string;
    }): Promise<void> {
      if (!hookConfig.enabled) {return;}

      try {
        // Bridge handles learning internally through recordOutcome
        // This hook is for any additional post-processing needed

        if (hookConfig.logDecisions) {
          console.log(`[SuperClaw] Completed: ${params.success ? "success" : "failure"}`, {
            latencyMs: params.latencyMs,
            tokensUsed: params.tokensUsed,
          });
        }
      } catch (error) {
        console.error("[SuperClaw] Post-process error:", error);
      }
    },

    /**
     * Get current metrics
     */
    getMetrics() {
      return bridge.getMetrics();
    },

    /**
     * Check if swarm is available
     */
    isSwarmAvailable() {
      return bridge.isSwarmAvailable();
    },
  };
}

/**
 * Middleware-style wrapper for the agent handler
 * Wraps the existing handler and adds SuperClaw routing + middleware chain
 */
export function wrapAgentHandler(
  bridge: SuperClawBridge,
  originalHandler: (params: any) => Promise<any>,
  config: Partial<GatewayHookConfig> = {},
  skynet?: Skynet,
) {
  const hook = createGatewayHook(bridge, config);
  const middlewareChain: MiddlewareChain | null = skynet
    ? createDefaultMiddlewareChain(skynet)
    : null;

  return async (params: any) => {
    // Pre-process (SuperClaw classification)
    const preResult = await hook.preProcess({
      message: params.message,
      sessionKey: params.sessionKey || params.sessionId,
      channel: params.channel,
      userId: params.userId,
    });

    // If SuperClaw suggests a model, apply it
    if (preResult?.suggestedModel && !params.model) {
      params.model = preResult.suggestedModel;
    }

    // If swarm should handle, we need special logic
    if (preResult?.shouldUseSwarm) {
      params._superclawSwarm = true;
    }

    // Run middleware chain beforeModel hooks
    let mwContext: MiddlewareContext | null = null;
    if (middlewareChain) {
      mwContext = createMiddlewareContext({
        message: params.message,
        sessionKey: params.sessionKey || params.sessionId,
        channel: params.channel,
        userId: params.userId,
        model: params.model,
        activeSubagents: params._activeSubagents ?? 0,
      });

      mwContext = await middlewareChain.runBeforeModel(mwContext);

      // If middleware blocked the request, return early
      if (mwContext.blocked) {
        console.warn(`[SuperClaw] Request blocked by middleware: ${mwContext.blockReason}`);
        return {
          response: `Request blocked: ${mwContext.blockReason}`,
          blocked: true,
        };
      }

      // Inject memory context into the message if available
      if (mwContext.memoryContext) {
        params._memoryContext = mwContext.memoryContext;
      }
    }

    const startTime = Date.now();
    let result: any;
    let success = true;

    try {
      result = await originalHandler(params);
    } catch (error) {
      success = false;
      throw error;
    } finally {
      const latencyMs = Date.now() - startTime;

      // Run middleware chain afterModel hooks
      if (middlewareChain && mwContext) {
        const mwResult = createMiddlewareResult({
          response: result?.response || "",
          success,
          latencyMs,
          tokensUsed: result?.tokensUsed,
          model: params.model,
          subagentCallCount: result?.subagentCallCount ?? 0,
        });

        await middlewareChain.runAfterModel(mwContext, mwResult);
      }

      // Post-process (SuperClaw recording)
      await hook.postProcess({
        message: params.message,
        response: result?.response || "",
        sessionKey: params.sessionKey || params.sessionId,
        success,
        latencyMs,
        tokensUsed: result?.tokensUsed,
        model: params.model,
      });
    }

    return result;
  };
}
