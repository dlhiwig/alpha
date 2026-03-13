#!/usr/bin/env npx tsx
/**
 * SuperClaw Demo Script
 * Run with: npx tsx src/superclaw/demo.ts
 */

import { SuperClawBridge } from "./bridge.js";

async function demo() {
  console.log("🦊 SuperClaw Demo\n");

  // Initialize bridge
  const bridge = new SuperClawBridge();
  await bridge.initialize();

  console.log(`Swarm available: ${bridge.isSwarmAvailable()}\n`);

  // Test classifications
  const testCases = [
    "What time is it?",
    "Write a function to sort an array",
    "Build a complete REST API with authentication, rate limiting, caching, and comprehensive test coverage",
    "Use a swarm to design and implement a microservices architecture with 5 services",
  ];

  for (const task of testCases) {
    console.log(`📝 Task: "${task.slice(0, 60)}${task.length > 60 ? "..." : ""}"`);

    const result = await bridge.processMessage(task, { sessionKey: "demo:session" });

    console.log(`   Complexity: ${result.classification?.complexity}`);
    console.log(`   Confidence: ${(result.classification?.confidence || 0).toFixed(2)}`);
    console.log(`   Model: ${result.classification?.suggestedModel}`);
    console.log(`   Swarm: ${result.usedSwarm ? "Yes" : "No (not available or not needed)"}`);
    console.log(`   Handled: ${result.handled}`);
    console.log("");
  }

  // Show metrics
  const metrics = bridge.getMetrics();
  console.log("📊 Metrics:");
  console.log(`   Total requests: ${metrics.totalRequests}`);
  console.log(`   Success rate: ${(metrics.successRate * 100).toFixed(1)}%`);
  console.log(`   Avg latency: ${metrics.averageLatencyMs.toFixed(2)}ms`);

  await bridge.shutdown();
  console.log("\n✅ Demo complete");
}

demo().catch(console.error);
