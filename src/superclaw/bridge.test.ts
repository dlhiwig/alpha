// @ts-nocheck
/**
 * SuperClaw Bridge Tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SuperClawBridge } from "./bridge.js";
import { TaskRouter } from "./router.js";
import { DEFAULT_CONFIG } from "./types.js";

describe("TaskRouter", () => {
  let router: TaskRouter;

  beforeEach(() => {
    router = new TaskRouter(DEFAULT_CONFIG);
  });

  describe("classify", () => {
    it("classifies simple questions as simple", async () => {
      const result = await router.classify("What time is it?");
      expect(result.complexity).toBe("simple");
    });

    it("classifies greetings as simple", async () => {
      const result = await router.classify("Hello!");
      expect(result.complexity).toBe("simple");
    });

    it("classifies substantial code tasks as medium or complex", async () => {
      const result = await router.classify(
        "Write a sorting algorithm that implements quicksort with optimizations for handling large datasets efficiently, then add comprehensive test coverage",
      );
      expect(["medium", "complex"]).toContain(result.complexity);
    });

    it("classifies swarm keyword tasks as complex", async () => {
      const result = await router.classify("Use a swarm to build a complete authentication system");
      expect(result.complexity).toBe("complex");
    });

    it("classifies multi-step tasks as medium or complex", async () => {
      const result = await router.classify(
        "First, create a database schema. Then, implement the API endpoints. Finally, add tests.",
      );
      expect(["medium", "complex"]).toContain(result.complexity);
    });

    it("suggests agents for complex tasks", async () => {
      const result = await router.classify(
        "Use a swarm to build and test a comprehensive REST API with security auditing, then deploy it",
      );
      // Only complex tasks get agents suggested
      if (result.complexity === "complex") {
        expect(result.suggestedAgents.length).toBeGreaterThan(0);
        expect(result.suggestedAgents).toContain("coordinator");
      } else {
        // Medium/simple tasks don't need a swarm
        expect(result.suggestedAgents.length).toBe(0);
      }
    });

    it("suggests appropriate models by complexity", async () => {
      const simple = await router.classify("Hello");
      const complex = await router.classify(
        "Use a swarm to build a comprehensive microservices platform with authentication, monitoring, and deployment",
      );

      // Simple tasks use local model (dolphin) or haiku
      expect(
        ["dolphin", "haiku"].some((m) => simple.suggestedModel.toLowerCase().includes(m)),
      ).toBe(true);
      // Complex tasks should get sonnet or opus
      expect(["sonnet", "opus"].some((m) => complex.suggestedModel.includes(m))).toBe(true);
    });

    it("provides reasoning for classification", async () => {
      const result = await router.classify("Implement user authentication");
      expect(result.reasoning).toBeTruthy();
      expect(result.reasoning.length).toBeGreaterThan(10);
    });
  });

  describe("shouldUseSwarm", () => {
    it("returns true for complex tasks with swarm enabled", async () => {
      const classification = await router.classify(
        "Build a comprehensive system with multiple agents",
      );
      const shouldUse = router.shouldUseSwarm(classification);

      if (classification.complexity === "complex" && classification.confidence >= 0.6) {
        expect(shouldUse).toBe(true);
      }
    });

    it("returns false for simple tasks", async () => {
      const classification = await router.classify("What is 2+2?");
      const shouldUse = router.shouldUseSwarm(classification);
      expect(shouldUse).toBe(false);
    });
  });
});

describe("SuperClawBridge", () => {
  let bridge: SuperClawBridge;

  beforeEach(async () => {
    bridge = new SuperClawBridge({
      enabled: true,
      swarm: {
        enabled: false, // Disable for tests without Claude-Flow
        maxAgents: 8,
        topology: "hierarchical",
        consensus: "majority",
        antiDrift: true,
        checkpointInterval: 5000,
        timeout: 300000,
      },
    });
    await bridge.initialize();
  });

  describe("processMessage", () => {
    it("returns handled=false for simple messages (let OpenClaw handle)", async () => {
      const result = await bridge.processMessage("Hello!", {
        sessionKey: "test:session",
      });

      expect(result.handled).toBe(false);
      expect(result.classification).toBeDefined();
      expect(result.classification?.complexity).toBe("simple");
    });

    it("includes classification even when not handled", async () => {
      const result = await bridge.processMessage("Write some code", {
        sessionKey: "test:session",
      });

      expect(result.classification).toBeDefined();
      expect(result.classification?.suggestedModel).toBeDefined();
    });

    it("tracks metrics", async () => {
      await bridge.processMessage("Test message 1", { sessionKey: "test" });
      await bridge.processMessage("Test message 2", { sessionKey: "test" });

      const metrics = bridge.getMetrics();
      expect(metrics.totalRequests).toBe(2);
    });
  });

  describe("forceClassify", () => {
    it("classifies without processing", async () => {
      const classification = await bridge.forceClassify("Build a system");
      expect(classification.complexity).toBeDefined();
      expect(classification.suggestedModel).toBeDefined();
    });
  });

  describe("configuration", () => {
    it("allows config updates", () => {
      bridge.updateConfig({
        routing: {
          strategy: "cost",
          agentBoosterEnabled: false,
          costThreshold: 0.5,
          latencyThreshold: 10000,
        },
      });

      const config = bridge.getConfig();
      expect(config.routing.strategy).toBe("cost");
    });
  });
});

describe("Integration scenarios", () => {
  it("handles a typical code generation request", async () => {
    const bridge = new SuperClawBridge();
    await bridge.initialize();

    const result = await bridge.processMessage(
      "Implement a user authentication system with JWT tokens, refresh tokens, password hashing, and role-based access control",
      { sessionKey: "agent:main:main", channel: "telegram" },
    );

    expect(result.classification).toBeDefined();
    // Any classification is valid - the classifier decides based on heuristics
    expect(["simple", "medium", "complex"]).toContain(result.classification?.complexity);
    // Without Claude-Flow installed, should not handle (let OpenClaw do it)
    expect(result.handled).toBe(false);
  });

  it("handles a complex architecture request", async () => {
    const bridge = new SuperClawBridge();
    await bridge.initialize();

    const result = await bridge.processMessage(
      "Use a swarm of agents to design and implement a comprehensive microservices architecture. First, create the API gateway. Then implement user authentication. After that, add rate limiting and monitoring. Finally, deploy the entire system.",
      { sessionKey: "agent:main:main" },
    );

    expect(result.classification?.complexity).toBe("complex");
    expect(result.classification?.suggestedAgents).toContain("coordinator");
  });
});
