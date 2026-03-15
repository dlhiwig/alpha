/**
 * SuperClaw State Machine
 * 
 * Improvement over OpenClaw: Explicit states, transitions, and guards
 * 
 * Features:
 * - Clear state definitions
 * - Explicit transitions with guards
 * - Event history for debugging
 * - Checkpoint/restore support
 * - Time-travel debugging ready
 */

// --- State Definitions ---

export const SwarmState = {
  IDLE: 'idle',
  PENDING: 'pending',
  DECOMPOSING: 'decomposing',
  PLANNING: 'planning',
  RUNNING: 'running',
  PAUSED: 'paused',
  AGGREGATING: 'aggregating',
  REVIEWING: 'reviewing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  TIMEOUT: 'timeout',
} as const;

export type SwarmStateType = typeof SwarmState[keyof typeof SwarmState];

// --- Event Definitions ---

export const SwarmEvent = {
  START: 'start',
  DECOMPOSE_COMPLETE: 'decompose_complete',
  PLAN_COMPLETE: 'plan_complete',
  TASK_START: 'task_start',
  TASK_COMPLETE: 'task_complete',
  TASK_FAIL: 'task_fail',
  ALL_TASKS_COMPLETE: 'all_tasks_complete',
  AGGREGATE_COMPLETE: 'aggregate_complete',
  REVIEW_PASS: 'review_pass',
  REVIEW_FAIL: 'review_fail',
  PAUSE: 'pause',
  RESUME: 'resume',
  CANCEL: 'cancel',
  ERROR: 'error',
  TIMEOUT: 'timeout',
  RETRY: 'retry',
} as const;

export type SwarmEventType = typeof SwarmEvent[keyof typeof SwarmEvent];

// --- Transition Definitions ---

interface Transition {
  from: SwarmStateType | SwarmStateType[];
  to: SwarmStateType;
  event: SwarmEventType;
  guard?: (context: SwarmContext) => boolean;
  action?: (context: SwarmContext) => void;
}

const transitions: Transition[] = [
  // Start flow
  { from: SwarmState.IDLE, to: SwarmState.PENDING, event: SwarmEvent.START },
  { from: SwarmState.PENDING, to: SwarmState.DECOMPOSING, event: SwarmEvent.START },
  
  // Decomposition
  { from: SwarmState.DECOMPOSING, to: SwarmState.PLANNING, event: SwarmEvent.DECOMPOSE_COMPLETE },
  { from: SwarmState.DECOMPOSING, to: SwarmState.FAILED, event: SwarmEvent.ERROR },
  
  // Planning
  { from: SwarmState.PLANNING, to: SwarmState.RUNNING, event: SwarmEvent.PLAN_COMPLETE },
  { from: SwarmState.PLANNING, to: SwarmState.FAILED, event: SwarmEvent.ERROR },
  
  // Running
  { from: SwarmState.RUNNING, to: SwarmState.AGGREGATING, event: SwarmEvent.ALL_TASKS_COMPLETE },
  { from: SwarmState.RUNNING, to: SwarmState.PAUSED, event: SwarmEvent.PAUSE },
  { from: SwarmState.RUNNING, to: SwarmState.FAILED, event: SwarmEvent.ERROR },
  { from: SwarmState.RUNNING, to: SwarmState.TIMEOUT, event: SwarmEvent.TIMEOUT },
  { from: SwarmState.RUNNING, to: SwarmState.CANCELLED, event: SwarmEvent.CANCEL },
  
  // Paused
  { from: SwarmState.PAUSED, to: SwarmState.RUNNING, event: SwarmEvent.RESUME },
  { from: SwarmState.PAUSED, to: SwarmState.CANCELLED, event: SwarmEvent.CANCEL },
  
  // Aggregating
  { from: SwarmState.AGGREGATING, to: SwarmState.REVIEWING, event: SwarmEvent.AGGREGATE_COMPLETE },
  { from: SwarmState.AGGREGATING, to: SwarmState.COMPLETED, event: SwarmEvent.AGGREGATE_COMPLETE,
    guard: (ctx) => !ctx.config.requiresReview },
  { from: SwarmState.AGGREGATING, to: SwarmState.FAILED, event: SwarmEvent.ERROR },
  
  // Reviewing
  { from: SwarmState.REVIEWING, to: SwarmState.COMPLETED, event: SwarmEvent.REVIEW_PASS },
  { from: SwarmState.REVIEWING, to: SwarmState.RUNNING, event: SwarmEvent.REVIEW_FAIL,
    guard: (ctx) => ctx.retryCount < ctx.config.maxRetries },
  { from: SwarmState.REVIEWING, to: SwarmState.FAILED, event: SwarmEvent.REVIEW_FAIL,
    guard: (ctx) => ctx.retryCount >= ctx.config.maxRetries },
  
  // Retry from failed (if allowed)
  { from: SwarmState.FAILED, to: SwarmState.PENDING, event: SwarmEvent.RETRY,
    guard: (ctx) => ctx.config.allowRetry && ctx.retryCount < ctx.config.maxRetries,
    action: (ctx) => { ctx.retryCount++; } },
  
  // Terminal states can be reset
  { from: [SwarmState.COMPLETED, SwarmState.FAILED, SwarmState.CANCELLED, SwarmState.TIMEOUT], 
    to: SwarmState.IDLE, event: SwarmEvent.START },
];

// --- Context ---

export interface SwarmConfig {
  requiresReview: boolean;
  allowRetry: boolean;
  maxRetries: number;
  timeoutMs: number;
  allowPause: boolean;
}

export interface SwarmContext {
  runId: string;
  state: SwarmStateType;
  config: SwarmConfig;
  retryCount: number;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
  taskProgress: {
    total: number;
    completed: number;
    failed: number;
    running: number;
  };
  history: StateHistoryEntry[];
}

export interface StateHistoryEntry {
  timestamp: Date;
  fromState: SwarmStateType;
  toState: SwarmStateType;
  event: SwarmEventType;
  context?: Partial<SwarmContext>;
}

// --- State Machine ---

export class SwarmStateMachine {
  private context: SwarmContext;
  private listeners: Map<string, Set<(event: StateHistoryEntry) => void>> = new Map();

  constructor(runId: string, config?: Partial<SwarmConfig>) {
    this.context = {
      runId,
      state: SwarmState.IDLE,
      config: {
        requiresReview: false,
        allowRetry: true,
        maxRetries: 2,
        timeoutMs: 300000, // 5 minutes
        allowPause: true,
        ...config,
      },
      retryCount: 0,
      startedAt: null,
      completedAt: null,
      error: null,
      taskProgress: { total: 0, completed: 0, failed: 0, running: 0 },
      history: [],
    };
  }

  // --- State Access ---

  getState(): SwarmStateType {
    return this.context.state;
  }

  getContext(): Readonly<SwarmContext> {
    return { ...this.context };
  }

  getHistory(): readonly StateHistoryEntry[] {
    return [...this.context.history];
  }

  // --- State Transitions ---

  can(event: SwarmEventType): boolean {
    return this.findTransition(event) !== undefined;
  }

  dispatch(event: SwarmEventType, payload?: Partial<SwarmContext>): boolean {
    const transition = this.findTransition(event);
    
    if (!transition) {
      console.warn(
        `[StateMachine] Invalid transition: ${this.context.state} + ${event}`
      );
      return false;
    }

    // Check guard
    if (transition.guard && !transition.guard(this.context)) {
      console.warn(
        `[StateMachine] Guard blocked transition: ${this.context.state} + ${event}`
      );
      return false;
    }

    // Record history
    const historyEntry: StateHistoryEntry = {
      timestamp: new Date(),
      fromState: this.context.state,
      toState: transition.to,
      event,
      context: payload,
    };
    this.context.history.push(historyEntry);

    // Execute action
    if (transition.action) {
      transition.action(this.context);
    }

    // Apply payload
    if (payload) {
      Object.assign(this.context, payload);
    }

    // Update state
    const fromState = this.context.state;
    this.context.state = transition.to;

    // Update timestamps
    if (transition.to === SwarmState.PENDING && !this.context.startedAt) {
      this.context.startedAt = new Date();
    }
    if (this.isTerminal(transition.to)) {
      this.context.completedAt = new Date();
    }

    // Notify listeners
    this.notifyListeners(historyEntry);

    console.log(
      `[StateMachine] ${fromState} -> ${transition.to} (${event})`
    );

    return true;
  }

  // --- Event Listeners ---

  on(event: 'transition', callback: (entry: StateHistoryEntry) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    
    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  private notifyListeners(entry: StateHistoryEntry): void {
    const callbacks = this.listeners.get('transition');
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(entry);
        } catch (error: unknown) {
          console.error('[StateMachine] Listener error:', error);
        }
      }
    }
  }

  // --- Helpers ---

  private findTransition(event: SwarmEventType): Transition | undefined {
    return transitions.find(t => {
      const fromMatch = Array.isArray(t.from) 
        ? t.from.includes(this.context.state)
        : t.from === this.context.state;
      return fromMatch && t.event === event;
    });
  }

  isTerminal(state?: SwarmStateType): boolean {
    const s = state || this.context.state;
    const terminalStates: SwarmStateType[] = [
      SwarmState.COMPLETED,
      SwarmState.FAILED,
      SwarmState.CANCELLED,
      SwarmState.TIMEOUT,
    ];
    return terminalStates.includes(s);
  }

  isRunning(state?: SwarmStateType): boolean {
    const s = state || this.context.state;
    const runningStates: SwarmStateType[] = [
      SwarmState.PENDING,
      SwarmState.DECOMPOSING,
      SwarmState.PLANNING,
      SwarmState.RUNNING,
      SwarmState.AGGREGATING,
      SwarmState.REVIEWING,
    ];
    return runningStates.includes(s);
  }

  // --- Task Progress ---

  updateTaskProgress(progress: Partial<SwarmContext['taskProgress']>): void {
    Object.assign(this.context.taskProgress, progress);
  }

  setError(error: string): void {
    this.context.error = error;
  }

  // --- Checkpoint/Restore ---

  checkpoint(): string {
    return JSON.stringify(this.context);
  }

  restore(checkpoint: string): void {
    const restored = JSON.parse(checkpoint) as SwarmContext;
    // Restore dates
    restored.startedAt = restored.startedAt ? new Date(restored.startedAt) : null;
    restored.completedAt = restored.completedAt ? new Date(restored.completedAt) : null;
    restored.history = restored.history.map(h => ({
      ...h,
      timestamp: new Date(h.timestamp),
    }));
    this.context = restored;
  }

  // --- Time Travel (for debugging) ---

  replayTo(index: number): SwarmContext {
    if (index < 0 || index >= this.context.history.length) {
      throw new Error(`Invalid history index: ${index}`);
    }

    // Create a new machine and replay events
    const replay = new SwarmStateMachine(this.context.runId, this.context.config);
    
    for (let i = 0; i <= index; i++) {
      const entry = this.context.history[i];
      replay.dispatch(entry.event, entry.context);
    }

    return replay.getContext();
  }
}

// --- Factory ---

export function createSwarmStateMachine(
  runId: string,
  options?: {
    requiresReview?: boolean;
    allowRetry?: boolean;
    maxRetries?: number;
    timeoutMs?: number;
  }
): SwarmStateMachine {
  return new SwarmStateMachine(runId, options);
}
