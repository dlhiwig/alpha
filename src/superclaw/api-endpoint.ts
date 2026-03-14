/**
 * SuperClaw API Endpoints
 *
 * HTTP API endpoints for SuperClaw swarm functionality
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthRateLimiter } from "../gateway/auth-rate-limit.js";
import type { ResolvedGatewayAuth } from "../gateway/auth.js";
import { sendJson } from "../gateway/http-common.js";
import { handleGatewayPostJsonEndpoint } from "../gateway/http-endpoint-helpers.js";
import { SuperClawBridge } from "./bridge.js";
import { getOracleLearning } from "./oracle-learning.js";
import { getSelfEvolver } from "./self-evolve.js";
import { getSharedMemory } from "./shared-memory.js";
import { getSkynet } from "./skynet.js";
import { getSuperClawExecutor } from "./swarm-bridge.js";

// Global bridge instance (initialized when needed)
let bridgeInstance: SuperClawBridge | null = null;

async function getBridge(): Promise<SuperClawBridge> {
  if (!bridgeInstance) {
    bridgeInstance = new SuperClawBridge();
    await bridgeInstance.initialize();
  }
  return bridgeInstance;
}

/**
 * Handle /api/v1/skynet/swarm endpoint
 */
export async function handleSkynetSwarmRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    auth: ResolvedGatewayAuth;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
    rateLimiter?: AuthRateLimiter;
  },
): Promise<boolean> {
  const endpointResult = await handleGatewayPostJsonEndpoint(req, res, {
    pathname: "/api/v1/skynet/swarm",
    auth: opts.auth,
    maxBodyBytes: 1024 * 1024, // 1MB
    trustedProxies: opts.trustedProxies,
    allowRealIpFallback: opts.allowRealIpFallback,
    rateLimiter: opts.rateLimiter,
  });

  if (endpointResult === false) {
    return false; // Not our endpoint
  }

  if (endpointResult === undefined) {
    return true; // Error already handled
  }

  try {
    const body = endpointResult.body as any;

    // Validate request body
    if (!body || typeof body !== "object") {
      sendJson(res, 400, {
        error: "Invalid request body",
        message: "Request body must be JSON object",
      });
      return true;
    }

    if (!body.task || typeof body.task !== "string") {
      sendJson(res, 400, {
        error: "Missing or invalid task",
        message: "Request must include 'task' field with string value",
      });
      return true;
    }

    // Extract parameters
    const { task, mode = "fanout", maxAgents = 2, timeout = 60000, context } = body;

    console.log(
      `[SuperClaw API] Swarm request: task="${task.slice(0, 50)}...", mode=${mode}, maxAgents=${maxAgents}`,
    );

    // Get bridge and execute swarm
    const bridge = await getBridge();

    if (!bridge.isSwarmAvailable()) {
      sendJson(res, 503, {
        error: "Swarm not available",
        message: "SuperClaw swarm functionality is not currently available",
      });
      return true;
    }

    // For fanout mode, use the swarm directly
    if (mode === "fanout") {
      const executor = getSuperClawExecutor();
      if (!executor) {
        sendJson(res, 503, {
          error: "SuperClaw executor not available",
          message: "Real SuperClaw swarm executor is not available",
        });
        return true;
      }

      const swarmConfig = {
        task,
        maxAgents,
        timeout,
        context,
        mode: "fanout" as const,
      };

      const result = await executor.execute(swarmConfig);

      sendJson(res, 200, {
        success: result.success,
        output: result.output,
        agentsUsed: result.agentsUsed,
        consensusReached: result.consensusReached,
        executionTimeMs: result.executionTimeMs,
        tokensUsed: result.tokensUsed,
        metadata: result.metadata,
      });
    } else {
      // Use the bridge for other modes
      const result = await bridge.processMessage(task, {
        sessionKey: `api:swarm:${Date.now()}`,
        channel: "http-api",
      });

      if (!result.handled) {
        sendJson(res, 500, {
          error: "Task not handled",
          message: "SuperClaw bridge did not handle the task",
          classification: result.classification,
        });
        return true;
      }

      sendJson(res, 200, {
        success: true,
        output: result.response || "",
        agentsUsed: result.metadata?.agentsUsed || 1,
        consensusReached: true,
        executionTimeMs: result.metadata?.latencyMs || 0,
        tokensUsed: result.metadata?.tokensUsed,
        metadata: {
          ...result.metadata,
          usedSwarm: result.usedSwarm,
          classification: result.classification,
        },
      });
    }

    return true;
  } catch (error) {
    console.error("[SuperClaw API] Error handling swarm request:", error);

    sendJson(res, 500, {
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error occurred",
    });

    return true;
  }
}

/**
 * Handle /api/v1/skynet/health endpoint
 */
export async function handleSkynetHealthRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    auth: ResolvedGatewayAuth;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
    rateLimiter?: AuthRateLimiter;
  },
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname !== "/api/v1/skynet/health") {
    return false;
  }

  if (req.method !== "GET") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return true;
  }

  try {
    const bridge = await getBridge();
    const executor = getSuperClawExecutor();

    let health: { provider: string; status: "ok" | "error"; error?: string }[] = [];

    if (executor) {
      health = await executor.healthCheck();
    } else {
      health = [{ provider: "lightweight", status: "ok" }];
    }

    const response = {
      swarmAvailable: bridge.isSwarmAvailable(),
      realSwarmAvailable: executor !== null,
      providers: health,
      metrics: bridge.getMetrics(),
    };

    sendJson(res, 200, response);
    return true;
  } catch (error) {
    console.error("[SuperClaw API] Error handling health request:", error);

    sendJson(res, 500, {
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error occurred",
    });

    return true;
  }
}

/**
 * Handle /api/v1/memory/shared/search endpoint
 */
export async function handleSharedMemorySearchRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    auth: ResolvedGatewayAuth;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
    rateLimiter?: AuthRateLimiter;
  },
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname !== "/api/v1/memory/shared/search") {
    return false;
  }

  if (req.method !== "GET") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return true;
  }

  try {
    const query = url.searchParams.get("q") || "";
    const limit = parseInt(url.searchParams.get("limit") || "10");
    const types = url.searchParams.get("types")?.split(",");
    const minImportance = url.searchParams.get("minImportance")
      ? parseFloat(url.searchParams.get("minImportance")!)
      : undefined;
    const agentId = url.searchParams.get("agentId") || undefined;

    const sharedMemory = await getSharedMemory();
    const results = await sharedMemory.search(query, {
      limit,
      types,
      minImportance,
      agentId,
    });

    sendJson(res, 200, {
      success: true,
      results,
      count: results.length,
      query,
    });

    return true;
  } catch (error) {
    console.error("[SharedMemory API] Error handling search request:", error);

    sendJson(res, 500, {
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error occurred",
    });

    return true;
  }
}

/**
 * Handle /api/v1/memory/shared/store endpoint
 */
export async function handleSharedMemoryStoreRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    auth: ResolvedGatewayAuth;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
    rateLimiter?: AuthRateLimiter;
  },
): Promise<boolean> {
  const endpointResult = await handleGatewayPostJsonEndpoint(req, res, {
    pathname: "/api/v1/memory/shared/store",
    auth: opts.auth,
    maxBodyBytes: 1024 * 1024, // 1MB
    trustedProxies: opts.trustedProxies,
    allowRealIpFallback: opts.allowRealIpFallback,
    rateLimiter: opts.rateLimiter,
  });

  if (endpointResult === false) {
    return false; // Not our endpoint
  }

  if (endpointResult === undefined) {
    return true; // Error already handled
  }

  try {
    const body = endpointResult.body as any;

    // Validate request body
    if (!body || typeof body !== "object") {
      sendJson(res, 400, {
        error: "Invalid request body",
        message: "Request body must be JSON object",
      });
      return true;
    }

    const { agentId, content, type, tags, importance, source } = body;

    if (!agentId || !content || !type) {
      sendJson(res, 400, {
        error: "Missing required fields",
        message: "agentId, content, and type are required",
      });
      return true;
    }

    if (!["fact", "decision", "lesson", "task", "observation"].includes(type)) {
      sendJson(res, 400, {
        error: "Invalid type",
        message: "type must be one of: fact, decision, lesson, task, observation",
      });
      return true;
    }

    const sharedMemory = await getSharedMemory();
    const memoryId = await sharedMemory.store({
      agentId,
      content,
      type,
      tags: tags || [],
      importance: importance ?? 0.5,
      source,
    });

    sendJson(res, 201, {
      success: true,
      id: memoryId,
      message: "Memory stored successfully",
    });

    return true;
  } catch (error) {
    console.error("[SharedMemory API] Error handling store request:", error);

    sendJson(res, 500, {
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error occurred",
    });

    return true;
  }
}

/**
 * Handle /api/v1/memory/shared/stats endpoint
 */
export async function handleSharedMemoryStatsRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    auth: ResolvedGatewayAuth;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
    rateLimiter?: AuthRateLimiter;
  },
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname !== "/api/v1/memory/shared/stats") {
    return false;
  }

  if (req.method !== "GET") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return true;
  }

  try {
    const sharedMemory = await getSharedMemory();
    const stats = await sharedMemory.getStats();

    sendJson(res, 200, {
      success: true,
      ...stats,
    });

    return true;
  } catch (error) {
    console.error("[SharedMemory API] Error handling stats request:", error);

    sendJson(res, 500, {
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error occurred",
    });

    return true;
  }
}

/**
 * Handle /api/v1/skynet/oracle/stats endpoint
 */
export async function handleOracleStatsRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    auth: ResolvedGatewayAuth;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
    rateLimiter?: AuthRateLimiter;
  },
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname !== "/api/v1/skynet/oracle/stats") {
    return false;
  }

  if (req.method !== "GET") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return true;
  }

  try {
    const oracle = await getOracleLearning();
    const stats = oracle.getStats();

    sendJson(res, 200, {
      success: true,
      ...stats,
    });

    return true;
  } catch (error) {
    console.error("[Oracle API] Error handling stats request:", error);

    sendJson(res, 500, {
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error occurred",
    });

    return true;
  }
}

/**
 * Handle /api/v1/skynet/oracle/recommend endpoint
 */
export async function handleOracleRecommendRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    auth: ResolvedGatewayAuth;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
    rateLimiter?: AuthRateLimiter;
  },
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host || "localhost"}`);
  if (url.pathname !== "/api/v1/skynet/oracle/recommend") {
    return false;
  }

  if (req.method !== "GET") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return true;
  }

  try {
    const taskType = url.searchParams.get("task");
    if (!taskType) {
      sendJson(res, 400, {
        error: "Missing task parameter",
        message: "Task type is required for recommendations",
      });
      return true;
    }

    const oracle = await getOracleLearning();
    const recommendation = await oracle.getRecommendation(taskType);

    sendJson(res, 200, {
      success: true,
      recommendation,
    });

    return true;
  } catch (error) {
    console.error("[Oracle API] Error handling recommendation request:", error);

    sendJson(res, 500, {
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error occurred",
    });

    return true;
  }
}

/**
 * Handle /api/v1/skynet/oracle/feedback endpoint
 */
export async function handleOracleFeedbackRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    auth: ResolvedGatewayAuth;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
    rateLimiter?: AuthRateLimiter;
  },
): Promise<boolean> {
  const endpointResult = await handleGatewayPostJsonEndpoint(req, res, {
    pathname: "/api/v1/skynet/oracle/feedback",
    auth: opts.auth,
    maxBodyBytes: 1024 * 10, // 10KB
    trustedProxies: opts.trustedProxies,
    allowRealIpFallback: opts.allowRealIpFallback,
    rateLimiter: opts.rateLimiter,
  });

  if (endpointResult === false) {
    return false; // Not our endpoint
  }

  if (endpointResult === undefined) {
    return true; // Error already handled
  }

  try {
    const body = endpointResult.body as any;

    if (!body || typeof body !== "object") {
      sendJson(res, 400, {
        error: "Invalid request body",
        message: "Request body must be JSON object",
      });
      return true;
    }

    if (!body.provider || !body.taskType || !body.prompt || typeof body.success !== "boolean") {
      sendJson(res, 400, {
        error: "Missing required fields",
        message: "Required: provider, taskType, prompt, success",
      });
      return true;
    }

    const oracle = await getOracleLearning();
    const interactionId = await oracle.recordInteraction({
      provider: body.provider,
      taskType: body.taskType,
      prompt: body.prompt,
      success: body.success,
      latencyMs: body.latencyMs || 0,
      cost: body.cost,
      userFeedback: body.userFeedback,
      responseLength: body.responseLength,
    });

    sendJson(res, 200, {
      success: true,
      interactionId,
    });

    return true;
  } catch (error) {
    console.error("[Oracle API] Error handling feedback request:", error);

    sendJson(res, 500, {
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error occurred",
    });

    return true;
  }
}

/**
 * Handle /api/v1/skynet/oracle/reflect endpoint
 */
export async function handleOracleReflectRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    auth: ResolvedGatewayAuth;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
    rateLimiter?: AuthRateLimiter;
  },
): Promise<boolean> {
  const endpointResult = await handleGatewayPostJsonEndpoint(req, res, {
    pathname: "/api/v1/skynet/oracle/reflect",
    auth: opts.auth,
    maxBodyBytes: 1024, // 1KB
    trustedProxies: opts.trustedProxies,
    allowRealIpFallback: opts.allowRealIpFallback,
    rateLimiter: opts.rateLimiter,
  });

  if (endpointResult === false) {
    return false; // Not our endpoint
  }

  if (endpointResult === undefined) {
    return true; // Error already handled
  }

  try {
    const oracle = await getOracleLearning();
    const reflection = await oracle.reflect();

    sendJson(res, 200, {
      success: true,
      reflection,
    });

    return true;
  } catch (error) {
    console.error("[Oracle API] Error handling reflection request:", error);

    sendJson(res, 500, {
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error occurred",
    });

    return true;
  }
}

/**
 * Handle POST /api/v1/skynet/evolve — trigger self-evolution cycle
 */
export async function handleSelfEvolveRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    auth: ResolvedGatewayAuth;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
    rateLimiter?: AuthRateLimiter;
  },
): Promise<boolean> {
  const endpointResult = await handleGatewayPostJsonEndpoint(req, res, {
    pathname: "/api/v1/skynet/evolve",
    auth: opts.auth,
    maxBodyBytes: 1024 * 10,
    trustedProxies: opts.trustedProxies,
    allowRealIpFallback: opts.allowRealIpFallback,
    rateLimiter: opts.rateLimiter,
  });

  if (endpointResult === false) {
    return false;
  }
  if (endpointResult === undefined) {
    return true;
  }

  try {
    const body = endpointResult.body as any;
    const action = body?.action ?? "detect";

    // Get Skynet instance for the trigger-cycle path
    let skynet;
    try {
      skynet = getSkynet();
    } catch {
      sendJson(res, 503, {
        error: "SKYNET not initialized",
        message: "Skynet governance layer is not active",
      });
      return true;
    }

    if (action === "detect") {
      // Trigger opportunity detection from Oracle data
      const result = await skynet.triggerSelfEvolution();
      sendJson(res, 200, {
        success: true,
        opportunitiesFound: result.opportunities.length,
        opportunities: result.opportunities,
        stats: result.stats,
      });
      return true;
    }

    if (action === "plan") {
      // Create a plan from an opportunity
      const { opportunityId, title, description, patches } = body;
      if (!opportunityId || !title) {
        sendJson(res, 400, {
          error: "Missing required fields",
          message: "opportunityId and title are required",
        });
        return true;
      }

      const evolver = getSelfEvolver();
      const plan = evolver.createPlan(opportunityId, title, description ?? "", patches ?? []);
      sendJson(res, 201, { success: true, plan });
      return true;
    }

    if (action === "execute") {
      // Execute a plan (auto-commit or PR based on governance)
      const { planId } = body;
      if (!planId) {
        sendJson(res, 400, { error: "Missing planId" });
        return true;
      }

      const evolver = getSelfEvolver();
      const plan = await evolver.executePlan(planId);
      sendJson(res, 200, { success: true, plan });
      return true;
    }

    if (action === "add-opportunity") {
      // Manually add an opportunity
      const { description: desc, priority, impact, suggestedFix, filePaths } = body;
      if (!desc) {
        sendJson(res, 400, { error: "Missing description" });
        return true;
      }

      const evolver = getSelfEvolver();
      const opp = evolver.addOpportunity(desc, { priority, impact, suggestedFix, filePaths });
      sendJson(res, 201, { success: true, opportunity: opp });
      return true;
    }

    if (action === "status") {
      const evolver = getSelfEvolver();
      sendJson(res, 200, {
        success: true,
        stats: evolver.getStats(),
        pendingPlans: evolver.getPendingPlans(),
        opportunities: evolver.getOpportunities().slice(-20),
      });
      return true;
    }

    sendJson(res, 400, {
      error: "Unknown action",
      message: "action must be one of: detect, plan, execute, add-opportunity, status",
    });
    return true;
  } catch (error) {
    console.error("[Self-Evolve API] Error:", error);
    sendJson(res, 500, {
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return true;
  }
}

/**
 * Handle all SuperClaw API requests
 */
export async function handleSuperClawApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    auth: ResolvedGatewayAuth;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
    rateLimiter?: AuthRateLimiter;
  },
): Promise<boolean> {
  // Try swarm endpoint first
  const swarmHandled = await handleSkynetSwarmRequest(req, res, opts);
  if (swarmHandled) {
    return true;
  }

  // Try health endpoint
  const healthHandled = await handleSkynetHealthRequest(req, res, opts);
  if (healthHandled) {
    return true;
  }

  // Try shared memory search endpoint
  const searchHandled = await handleSharedMemorySearchRequest(req, res, opts);
  if (searchHandled) {
    return true;
  }

  // Try shared memory store endpoint
  const storeHandled = await handleSharedMemoryStoreRequest(req, res, opts);
  if (storeHandled) {
    return true;
  }

  // Try shared memory stats endpoint
  const statsHandled = await handleSharedMemoryStatsRequest(req, res, opts);
  if (statsHandled) {
    return true;
  }

  // Try ORACLE stats endpoint
  const oracleStatsHandled = await handleOracleStatsRequest(req, res, opts);
  if (oracleStatsHandled) {
    return true;
  }

  // Try ORACLE recommend endpoint
  const oracleRecommendHandled = await handleOracleRecommendRequest(req, res, opts);
  if (oracleRecommendHandled) {
    return true;
  }

  // Try ORACLE feedback endpoint
  const oracleFeedbackHandled = await handleOracleFeedbackRequest(req, res, opts);
  if (oracleFeedbackHandled) {
    return true;
  }

  // Try ORACLE reflect endpoint
  const oracleReflectHandled = await handleOracleReflectRequest(req, res, opts);
  if (oracleReflectHandled) {
    return true;
  }

  // Try self-evolve endpoint
  const evolveHandled = await handleSelfEvolveRequest(req, res, opts);
  if (evolveHandled) {
    return true;
  }

  // Not our endpoint
  return false;
}

/**
 * Shutdown the bridge (cleanup)
 */
export async function shutdownSuperClawApi(): Promise<void> {
  if (bridgeInstance) {
    await bridgeInstance.shutdown();
    bridgeInstance = null;
  }
}
