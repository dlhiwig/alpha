/**
 * SuperClaw Swarm Executor
 *
 * Real SuperClaw swarm integration using llm-run CLI
 * Implements fanout mode by executing multiple providers in parallel
 */

import { spawn } from "child_process";
import type { SwarmConfig, SwarmResult, SwarmHandle, SwarmProgress } from "./types.js";
import { escapeForShell } from "./sanitize.js";

export interface ProviderConfig {
  name: string;
  role: string;
  timeout?: number;
}

export interface ProviderResult {
  provider: string;
  role: string;
  output: string;
  success: boolean;
  latencyMs: number;
  error?: string;
}

export class SuperClawSwarmExecutor {
  private activeSwarms: Map<
    string,
    {
      startTime: number;
      config: SwarmConfig;
      providers: ProviderConfig[];
      cancelled: boolean;
    }
  > = new Map();

  /**
   * Execute a swarm task using SuperClaw's real providers via llm-run
   */
  async execute(config: SwarmConfig): Promise<SwarmResult> {
    const startTime = Date.now();
    const swarmId = `swarm_${startTime}_${Math.random().toString(36).slice(2, 8)}`;

    // Default fanout mode providers
    const providers: ProviderConfig[] = this.getProviders(config);

    // Store swarm state
    this.activeSwarms.set(swarmId, {
      startTime,
      config,
      providers,
      cancelled: false,
    });

    try {
      console.log(
        `[SuperClaw] Starting fanout swarm ${swarmId} with ${providers.length} providers: ${providers.map((p) => p.name).join(", ")}`,
      );

      // Execute providers in parallel
      const results = await this.executeProviders(config.task, providers, config.timeout || 60000);

      // Filter successful results
      const successful = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);

      console.log(
        `[SuperClaw] Swarm ${swarmId} completed: ${successful.length}/${results.length} providers successful`,
      );

      // Merge results (simple concatenation for fanout mode)
      const mergedOutput = this.mergeResults(successful);

      const totalLatencyMs = Date.now() - startTime;

      return {
        success: successful.length > 0,
        output: mergedOutput,
        agentsUsed: successful.length,
        consensusReached: successful.length >= Math.ceil(providers.length / 2), // Simple majority
        executionTimeMs: totalLatencyMs,
        tokensUsed: this.estimateTokens(config.task, mergedOutput),
        metadata: {
          swarmId,
          providers: results.map((r) => ({
            provider: r.provider,
            success: r.success,
            latencyMs: r.latencyMs,
          })),
          mode: "fanout",
        },
      };
    } catch (error) {
      console.error(`[SuperClaw] Swarm ${swarmId} failed:`, error);
      return {
        success: false,
        output: `Swarm execution failed: ${error instanceof Error ? error.message : String(error)}`,
        agentsUsed: 0,
        consensusReached: false,
        executionTimeMs: Date.now() - startTime,
      };
    } finally {
      this.activeSwarms.delete(swarmId);
    }
  }

  /**
   * Get provider configuration for fanout mode
   */
  private getProviders(config: SwarmConfig): ProviderConfig[] {
    // Check if specific providers are requested
    const maxAgents = config.maxAgents || 2;

    // Default fanout providers: claude and gemini (most reliable)
    const defaultProviders: ProviderConfig[] = [
      { name: "claude", role: "critic" },
      { name: "gemini", role: "researcher" },
    ];

    // Add more providers if requested and available
    if (maxAgents > 2) {
      defaultProviders.push({ name: "codex", role: "implementer" });
    }

    if (maxAgents > 3) {
      defaultProviders.push({ name: "deepseek", role: "simplifier" });
    }

    return defaultProviders.slice(0, maxAgents);
  }

  /**
   * Execute multiple providers in parallel using llm-run
   */
  private async executeProviders(
    task: string,
    providers: ProviderConfig[],
    timeoutMs: number,
  ): Promise<ProviderResult[]> {
    const promises = providers.map((provider) => this.executeProvider(task, provider, timeoutMs));

    // Use Promise.allSettled to collect all results, even if some fail
    const settled = await Promise.allSettled(promises);

    return settled.map((result, i) => {
      if (result.status === "fulfilled") {
        return result.value;
      } else {
        return {
          provider: providers[i].name,
          role: providers[i].role,
          output: "",
          success: false,
          latencyMs: timeoutMs,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        };
      }
    });
  }

  /**
   * Execute a single provider using llm-run CLI
   */
  private async executeProvider(
    task: string,
    provider: ProviderConfig,
    timeoutMs: number,
  ): Promise<ProviderResult> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      // Build role-specific prompt
      const rolePrompt = this.buildRolePrompt(task, provider.role);

      // CVE fix: sanitize LLM-derived prompt AND escape for shell safety
      // escapeForShell strips command substitution, ANSI, non-printable chars,
      // then properly escapes single quotes for bash -c '...' context
      const escapedPrompt = escapeForShell(rolePrompt);

      // Also sanitize provider.name (defense-in-depth: should be trusted, but verify)
      const safeProviderName = provider.name.replace(/[^a-zA-Z0-9_-]/g, "");

      // Execute llm-run via bash
      const child = spawn("/bin/bash", ["-c", `llm-run ${safeProviderName} '${escapedPrompt}'`], {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          PATH: [
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/home/linuxbrew/.linuxbrew/bin",
            process.env.PATH || "",
          ].join(":"),
        },
      });

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      // Set timeout
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        resolve({
          provider: provider.name,
          role: provider.role,
          output: stdout,
          success: false,
          latencyMs: Date.now() - startTime,
          error: `Timeout after ${timeoutMs}ms`,
        });
      }, timeoutMs);

      child.on("close", (code) => {
        clearTimeout(timer);

        const success = code === 0 && stdout.trim().length > 0;

        if (!success && stderr) {
          console.warn(`[SuperClaw] Provider ${provider.name} failed: ${stderr.slice(0, 100)}`);
        }

        resolve({
          provider: provider.name,
          role: provider.role,
          output: stdout.trim(),
          success,
          latencyMs: Date.now() - startTime,
          error: success ? undefined : stderr || `Exit code ${code}`,
        });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({
          provider: provider.name,
          role: provider.role,
          output: "",
          success: false,
          latencyMs: Date.now() - startTime,
          error: err.message,
        });
      });
    });
  }

  /**
   * Build role-specific prompts for each provider
   */
  private buildRolePrompt(task: string, role: string): string {
    const rolePrompts: Record<string, string> = {
      critic: `As a senior code reviewer and security expert, analyze this task and provide your critique:

${task}

Focus on potential issues, edge cases, security concerns, and implementation challenges. Be specific and thorough.`,

      researcher: `As a research analyst, investigate this task and provide background information and alternative approaches:

${task}

Research relevant technologies, patterns, and best practices. Consider different implementation strategies and their tradeoffs.`,

      implementer: `As a senior software engineer, provide a practical implementation approach for this task:

${task}

Focus on clean code, proper architecture, and working solutions. Include key code snippets if relevant.`,

      simplifier: `As an expert at simplifying complex problems, break down this task and identify the core requirements:

${task}

Remove unnecessary complexity and focus on the minimal viable solution. What's the simplest approach that could work?`,
    };

    return rolePrompts[role] || `Analyze and respond to this task: ${task}`;
  }

  /**
   * Merge results from successful providers
   */
  private mergeResults(results: ProviderResult[]): string {
    if (results.length === 0) {
      return "No successful responses from swarm providers.";
    }

    if (results.length === 1) {
      return results[0].output;
    }

    // For fanout mode, create a structured summary combining all perspectives
    let merged = "# Swarm Analysis Results\n\n";

    results.forEach((result, index) => {
      merged += `## ${result.role.charAt(0).toUpperCase() + result.role.slice(1)} Perspective (${result.provider})\n\n`;
      merged += result.output;
      merged += "\n\n";
    });

    merged += "\n---\n\n";
    merged += `*This analysis combined insights from ${results.length} AI agents: ${results.map((r) => r.provider).join(", ")}*`;

    return merged;
  }

  /**
   * Estimate tokens used (rough approximation)
   */
  private estimateTokens(input: string, output: string): number {
    // Rough approximation: 1 token ≈ 4 characters
    return Math.ceil((input.length + output.length) / 4);
  }

  /**
   * Get progress of active swarms
   */
  getProgress(swarmId: string): SwarmProgress | null {
    const swarm = this.activeSwarms.get(swarmId);
    if (!swarm) {
      return null;
    }

    return {
      phase: "running",
      agentsActive: swarm.providers.length,
      tasksCompleted: 0, // We don't track individual completion in fanout mode
      tasksTotal: swarm.providers.length,
      elapsedMs: Date.now() - swarm.startTime,
    };
  }

  /**
   * Cancel a running swarm
   */
  async cancel(swarmId: string): Promise<void> {
    const swarm = this.activeSwarms.get(swarmId);
    if (swarm) {
      swarm.cancelled = true;
      // In a full implementation, we'd track and kill child processes
      console.log(`[SuperClaw] Cancelled swarm ${swarmId}`);
    }
  }

  /**
   * Get list of active swarms
   */
  getActiveSwarms(): string[] {
    return Array.from(this.activeSwarms.keys());
  }

  /**
   * Health check - verify llm-run is available and providers work
   */
  async healthCheck(): Promise<{ provider: string; status: "ok" | "error"; error?: string }[]> {
    const providers = ["claude", "gemini"];
    const results = await Promise.all(
      providers.map(async (provider) => {
        try {
          const result = await this.executeProvider(
            'Reply with "OK"',
            { name: provider, role: "general" },
            10000,
          );
          return {
            provider,
            status:
              result.success && /ok/i.test(result.output) ? ("ok" as const) : ("error" as const),
            error: result.success ? undefined : result.error,
          };
        } catch (error) {
          return {
            provider,
            status: "error" as const,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );

    return results;
  }
}

/**
 * Create and configure a SuperClaw swarm executor
 */
export function createSuperClawSwarmExecutor(): SuperClawSwarmExecutor {
  return new SuperClawSwarmExecutor();
}
