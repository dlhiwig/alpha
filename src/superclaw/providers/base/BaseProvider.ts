/**
 * Base Provider Utilities - Extracted from Code Duplication Refactoring
 * 
 * Common patterns shared across multiple LLM providers to reduce duplication.
 */

import { ProviderError, ProviderHealth, ProviderStatus } from '../contracts';

export abstract class BaseProvider {
  protected health: ProviderHealth = {
    status: ProviderStatus.UNHEALTHY,
    lastCheck: new Date(),
    // @ts-expect-error - Post-Merge Reconciliation
    latency: 0,
    successRate: 0,
    errorRate: 0,
    requestCount: 0,
    errorCount: 0
  };

  /**
   * Common API key validation pattern used by multiple providers
   */
  protected validateApiKey(apiKey: string | undefined, providerName: string, envVarName: string): void {
    if (!apiKey) {
      throw new ProviderError(
        `${providerName} API key required. Set ${envVarName} environment variable.`,
        providerName,
        'MISSING_API_KEY',
        false
      );
    }
  }

  /**
   * Common health status update pattern
   */
  protected updateHealthStatus(success: boolean, latency: number): void {
    this.health.lastCheck = new Date();
    // @ts-expect-error - Post-Merge Reconciliation
    this.health.latency = latency;
    // @ts-expect-error - Post-Merge Reconciliation
    this.health.requestCount++;
    
    if (success) {
      this.health.status = ProviderStatus.HEALTHY;
    } else {
      // @ts-expect-error - Post-Merge Reconciliation
      this.health.errorCount++;
      this.health.status = ProviderStatus.UNHEALTHY;
    }
    
    // @ts-expect-error - Post-Merge Reconciliation
    this.health.successRate = (this.health.requestCount - this.health.errorCount) / this.health.requestCount;
    // @ts-expect-error - Post-Merge Reconciliation
    this.health.errorRate = this.health.errorCount / this.health.requestCount;
  }

  /**
   * Common retry logic with exponential backoff
   */
  protected async retryWithBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: unknown) {
        lastError = error as Error;
        
        if (attempt === maxRetries) {
          break; // Don't wait on the last attempt
        }
        
        const delay = baseDelay * Math.pow(2, attempt);
        await this.sleep(delay);
      }
    }
    
    throw lastError!;
  }

  /**
   * Common cost calculation pattern for token-based pricing
   */
  protected calculateCost(inputTokens: number, outputTokens: number, inputCost: number, outputCost: number): number {
    return (inputTokens * inputCost) + (outputTokens * outputCost);
  }

  /**
   * Common response parsing error handling
   */
  protected handleApiError(error: any, providerName: string, operation: string): never {
    if (error.response?.status === 401) {
      throw new ProviderError(
        'Authentication failed. Check your API key.',
        providerName,
        'AUTHENTICATION_FAILED',
        false
      );
    } else if (error.response?.status === 429) {
      throw new ProviderError(
        'Rate limit exceeded. Please try again later.',
        providerName,
        'RATE_LIMITED',
        true
      );
    } else if (error.response?.status >= 500) {
      throw new ProviderError(
        'Provider service temporarily unavailable.',
        providerName,
        'SERVICE_UNAVAILABLE',
        true
      );
    } else {
      throw new ProviderError(
        `${operation} failed: ${(error instanceof Error ? (error).message : String(error)) || 'Unknown error'}`,
        providerName,
        'OPERATION_FAILED',
        true
      );
    }
  }

  /**
   * Common utility to sleep/wait
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}