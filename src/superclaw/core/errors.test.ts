// @ts-nocheck
/**
 * Unit tests for SuperClaw error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SuperClawError,
  safeCall,
  safeCallSync,
  withRetry,
  withTimeout,
  Result
} from './errors';

describe('SuperClawError', () => {
  it('creates error with all fields', () => {
    const error = new SuperClawError(
      'Test error',
      'API_CALL_FAILED',
      true,
      { foo: 'bar' }
    );

    expect((error as Error).message).toBe('Test error');
    expect((error as any).code).toBe('API_CALL_FAILED');
    expect(error.recoverable).toBe(true);
    expect(error.context).toEqual({ foo: 'bar' });
    expect(error.timestamp).toBeInstanceOf(Date);
  });

  it('serializes to JSON', () => {
    const error = new SuperClawError('Test', 'UNKNOWN_ERROR', false);
    const json = error.toJSON();

    expect(json.name).toBe('SuperClawError');
    expect(json.code).toBe('UNKNOWN_ERROR');
    expect(json.message).toBe('Test');
    expect(json.recoverable).toBe(false);
  });

  it('preserves cause stack trace', () => {
    const cause = new Error('Original error');
    const error = new SuperClawError(
      'Wrapped',
      'UNKNOWN_ERROR',
      true,
      undefined,
      cause
    );

    expect(error.stack).toContain('Caused by:');
    expect(error.stack).toContain('Original error');
  });
});

describe('safeCall', () => {
  it('returns ok result on success', async () => {
    const result = await safeCall(
      async () => 'success',
      'test operation'
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe('success');
    }
  });

  it('returns error result on failure', async () => {
    const result = await safeCall(
      async () => { throw new Error('fail'); },
      'test operation'
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('test operation');
      expect(result.error.message).toContain('fail');
    }
  });

  it('uses provided error code', async () => {
    const result = await safeCall(
      async () => { throw new Error('fail'); },
      'test',
      'API_KEY_MISSING'
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('API_KEY_MISSING');
    }
  });
});

describe('safeCallSync', () => {
  it('returns ok result on success', () => {
    const result = safeCallSync(
      () => 42,
      'sync operation'
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe(42);
    }
  });

  it('returns error result on failure', () => {
    const result = safeCallSync(
      () => { throw new Error('sync fail'); },
      'sync operation'
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('sync fail');
    }
  });
});

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns success on first try', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    
    const resultPromise = withRetry(fn, { maxRetries: 3 });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('success');
    
    const resultPromise = withRetry(fn, { 
      maxRetries: 3,
      baseDelayMs: 100 
    });
    
    // Advance through retries
    await vi.advanceTimersByTimeAsync(100); // First retry
    await vi.advanceTimersByTimeAsync(200); // Second retry
    await vi.runAllTimersAsync();
    
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('gives up after max retries', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    
    const resultPromise = withRetry(fn, { 
      maxRetries: 2,
      baseDelayMs: 100 
    });
    
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.ok).toBe(false);
    expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    if (!result.ok) {
      expect(result.error.message).toContain('3 attempts');
      expect(result.error.recoverable).toBe(false);
    }
  });
});

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns result before timeout', async () => {
    const fn = vi.fn().mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve('fast'), 100))
    );
    
    const resultPromise = withTimeout(fn, 1000, 'fast op');
    await vi.advanceTimersByTimeAsync(100);
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe('fast');
    }
  });

  it('times out slow operations', async () => {
    const fn = vi.fn().mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve('slow'), 5000))
    );
    
    const resultPromise = withTimeout(fn, 1000, 'slow op');
    await vi.advanceTimersByTimeAsync(1000);
    const result = await resultPromise;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('TASK_TIMEOUT');
      expect(result.error.message).toContain('1000ms');
    }
  });
});

describe('Result type', () => {
  it('can narrow ok result', () => {
    const result: Result<number> = { ok: true, data: 42 };
    
    if (result.ok) {
      // TypeScript knows data exists here
      expect(result.data).toBe(42);
    }
  });

  it('can narrow error result', () => {
    const result: Result<number> = { 
      ok: false, 
      error: new SuperClawError('test', 'UNKNOWN_ERROR', true) 
    };
    
    if (!result.ok) {
      // TypeScript knows error exists here
      expect(result.error.code).toBe('UNKNOWN_ERROR');
    }
  });
});
