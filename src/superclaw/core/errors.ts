/**
 * SuperClaw Error Handling
 * 
 * Centralized error types and utilities for robust error handling
 */

export type ErrorCode = 
  | 'PROVIDER_UNAVAILABLE'
  | 'API_KEY_MISSING'
  | 'API_CALL_FAILED'
  | 'CLI_NOT_FOUND'
  | 'CLI_EXECUTION_FAILED'
  | 'TASK_TIMEOUT'
  | 'TASK_FAILED'
  | 'VALIDATION_ERROR'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';

export class SuperClawError extends Error {
  public readonly timestamp: Date;
  
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly recoverable: boolean = true,
    public readonly context?: Record<string, any>,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'SuperClawError';
    this.timestamp = new Date();
    
    // Preserve stack trace
    if (cause?.stack) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }

  toJSON(): Record<string, any> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      recoverable: this.recoverable,
      context: this.context,
      timestamp: this.timestamp.toISOString(),
      stack: this.stack
    };
  }
}

/**
 * Result type for operations that can fail
 */
export type Result<T, E = SuperClawError> = 
  | { ok: true; data: T }
  | { ok: false; error: E };

/**
 * Wrap an async function with error handling
 */
export async function safeCall<T>(
  fn: () => Promise<T>,
  context: string,
  code: ErrorCode = 'UNKNOWN_ERROR'
): Promise<Result<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    return {
      ok: false,
      error: new SuperClawError(
        `${context}: ${(error as Error).message}`,
        code,
        true,
        { context },
        error
      )
    };
  }
}

/**
 * Wrap a sync function with error handling
 */
export function safeCallSync<T>(
  fn: () => T,
  context: string,
  code: ErrorCode = 'UNKNOWN_ERROR'
): Result<T> {
  try {
    const data = fn();
    return { ok: true, data };
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    return {
      ok: false,
      error: new SuperClawError(
        `${context}: ${(error as Error).message}`,
        code,
        true,
        { context },
        error
      )
    };
  }
}

/**
 * Retry an operation with exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    context?: string;
  } = {}
): Promise<Result<T>> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    context = 'operation'
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const data = await fn();
      return { ok: true, data };
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      
      if (attempt < maxRetries) {
        const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  return {
    ok: false,
    error: new SuperClawError(
      `${context} failed after ${maxRetries + 1} attempts: ${lastError?.message}`,
      'API_CALL_FAILED',
      false,
      { attempts: maxRetries + 1, context },
      lastError
    )
  };
}

/**
 * Timeout wrapper
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  context: string = 'operation'
): Promise<Result<T>> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({
        ok: false,
        error: new SuperClawError(
          `${context} timed out after ${timeoutMs}ms`,
          'TASK_TIMEOUT',
          true,
          { timeoutMs, context }
        )
      });
    }, timeoutMs);

    fn()
      .then(data => {
        clearTimeout(timer);
        resolve({ ok: true, data });
      })
      .catch(e => {
        clearTimeout(timer);
        const error = e instanceof Error ? e : new Error(String(e));
        resolve({
          ok: false,
          error: new SuperClawError(
            `${context}: ${(error as Error).message}`,
            'UNKNOWN_ERROR',
            true,
            { context },
            error
          )
        });
      });
  });
}
