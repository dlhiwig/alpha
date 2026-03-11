/**
 * SuperClaw Agent Tool
 * Provides SuperClaw capabilities as an agent tool
 */

import { Type } from "@sinclair/typebox";
import { getSuperclaw, classify, isInitialized } from "./init.js";
import type { TaskClassification } from "./types.js";

const SuperclawClassifySchema = Type.Object({
  message: Type.String({ description: "The message/task to classify" }),
});

const SuperclawStatusSchema = Type.Object({});

const SuperclawMetricsSchema = Type.Object({});

export interface SuperclawToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

function jsonResult(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Create the superclaw_classify tool
 */
export function createSuperclawClassifyTool() {
  return {
    label: "SuperClaw",
    name: "superclaw_classify",
    description:
      "Classify a task to determine complexity (simple/medium/complex) and get model suggestions. Use this to understand how a task should be routed.",
    parameters: SuperclawClassifySchema,
    execute: async (_toolCallId: string, args: Record<string, unknown>): Promise<string> => {
      try {
        const message = args.message as string;
        if (!message) {
          return jsonResult({ success: false, error: "Message is required" });
        }

        const classification = await classify(message);

        return jsonResult({
          success: true,
          classification: {
            complexity: classification.complexity,
            confidence: classification.confidence,
            suggestedModel: classification.suggestedModel,
            suggestedAgents: classification.suggestedAgents,
            reasoning: classification.reasoning,
          },
        });
      } catch (error) {
        return jsonResult({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

/**
 * Create the superclaw_status tool
 */
export function createSuperclawStatusTool() {
  return {
    label: "SuperClaw",
    name: "superclaw_status",
    description: "Get SuperClaw status including whether swarm functionality is available.",
    parameters: SuperclawStatusSchema,
    execute: async (_toolCallId: string, _args: Record<string, unknown>): Promise<string> => {
      try {
        if (!isInitialized()) {
          return jsonResult({
            success: true,
            status: {
              initialized: false,
              swarmAvailable: false,
              message: "SuperClaw not initialized",
            },
          });
        }

        const bridge = await getSuperclaw();

        return jsonResult({
          success: true,
          status: {
            initialized: true,
            swarmAvailable: bridge.isSwarmAvailable(),
            config: bridge.getConfig(),
          },
        });
      } catch (error) {
        return jsonResult({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

/**
 * Create the superclaw_metrics tool
 */
export function createSuperclawMetricsTool() {
  return {
    label: "SuperClaw",
    name: "superclaw_metrics",
    description: "Get SuperClaw metrics including request counts, success rates, and cost savings.",
    parameters: SuperclawMetricsSchema,
    execute: async (_toolCallId: string, _args: Record<string, unknown>): Promise<string> => {
      try {
        if (!isInitialized()) {
          return jsonResult({
            success: false,
            error: "SuperClaw not initialized",
          });
        }

        const bridge = await getSuperclaw();
        const metrics = bridge.getMetrics();

        return jsonResult({
          success: true,
          metrics,
        });
      } catch (error) {
        return jsonResult({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

/**
 * Get all SuperClaw tools
 */
export function getSuperclawTools() {
  return [createSuperclawClassifyTool(), createSuperclawStatusTool(), createSuperclawMetricsTool()];
}
