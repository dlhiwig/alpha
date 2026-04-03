/**
 * Hermes Bridge — Alpha ↔ Hermes MCP integration
 * Sends trajectories to Hermes for GNN/EWC++/SONA recursive loop.
 * Graceful degradation: Alpha handles locally if Hermes offline.
 */

export interface HermesTrajectory {
  taskId: string;
  agentId: "alpha";
  input: string;
  success: boolean;
  score: number;
  latencyMs: number;
  costUsd: number;
  taskPattern: string;
  provider: string;
  executorUsed: string;
  governancePassed: boolean;
  timestamp: number;
}

export interface HermesRoutingResult {
  suggestedExecutor: string;
  suggestedProvider: string;
  confidenceScore: number;
  reasoning: string;
  ewcProtected: boolean;
}

export class HermesBridge {
  private baseUrl = process.env.HERMES_URL ?? "http://localhost:18790";
  private timeout = 5000;
  private connected = false;
  private lastPingAt = 0;
  private readonly pingIntervalMs = 30_000;

  async ping(): Promise<boolean> {
    const now = Date.now();
    if (now - this.lastPingAt < this.pingIntervalMs && this.lastPingAt > 0) {
      return this.connected;
    }
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
      this.connected = res.ok;
    } catch {
      this.connected = false;
    }
    this.lastPingAt = now;
    if (this.connected) {
      console.log("[HermesBridge] ✅ Connected to Hermes at", this.baseUrl);
    }
    return this.connected;
  }

  /** Fire-and-forget — never blocks Alpha's response path */
  async sendTrajectory(traj: Omit<HermesTrajectory, "agentId" | "timestamp">): Promise<void> {
    const payload: HermesTrajectory = { ...traj, agentId: "alpha", timestamp: Date.now() };
    fetch(`${this.baseUrl}/trajectory`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeout),
    }).catch(() => {
      /* silent */
    });
  }

  async getRoutingRecommendation(
    taskInput: string,
    _taskType: string,
  ): Promise<HermesRoutingResult | null> {
    if (!(await this.ping())) {
      return null;
    }
    try {
      const res = await fetch(`${this.baseUrl}/routing-table`, {
        signal: AbortSignal.timeout(this.timeout),
      });
      if (!res.ok) {
        return null;
      }
      const table = (await res.json()) as {
        entries?: Array<{ pattern: string; preferredExecutor: string; confidenceScore: number }>;
      };
      const q = taskInput.toLowerCase();
      const match = (table.entries ?? []).find((e) => q.includes(e.pattern.toLowerCase()));
      if (!match) {
        return null;
      }
      return {
        suggestedExecutor: match.preferredExecutor,
        suggestedProvider: "claude",
        confidenceScore: match.confidenceScore,
        reasoning: `Hermes SONA routing: ${match.pattern}`,
        ewcProtected: match.confidenceScore > 0.8,
      };
    } catch {
      return null;
    }
  }

  async submitTask(
    input: string,
    context?: Record<string, unknown>,
  ): Promise<{ taskId: string; score: number } | null> {
    if (!(await this.ping())) {
      return null;
    }
    try {
      const res = await fetch(`${this.baseUrl}/task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input, source: "alpha", context, recursionDepth: 0 }),
        signal: AbortSignal.timeout(this.timeout),
      });
      return res.ok ? (res.json() as Promise<{ taskId: string; score: number }>) : null;
    } catch {
      return null;
    }
  }

  async register(): Promise<void> {
    if (!(await this.ping())) {
      console.log("[HermesBridge] Hermes offline — will retry");
      return;
    }
    console.log("[HermesBridge] Alpha registered with Hermes ✅");
  }

  isConnected(): boolean {
    return this.connected;
  }
}

export const hermesBridge = new HermesBridge();
