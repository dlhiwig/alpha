"use strict";
/**
 * SuperClaw LLM Provider Contracts
 *
 * Core interfaces and types for the multi-provider LLM routing system.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CircuitBreakerOpenError = exports.BudgetExceededError = exports.ProviderError = exports.ProviderStatus = exports.ProviderType = exports.ModelCapability = void 0;
var ModelCapability;
(function (ModelCapability) {
    ModelCapability["TEXT_GENERATION"] = "text_generation";
    ModelCapability["CODE_GENERATION"] = "code_generation";
    ModelCapability["REASONING"] = "reasoning";
    ModelCapability["FUNCTION_CALLING"] = "function_calling";
    ModelCapability["VISION"] = "vision";
    ModelCapability["LONG_CONTEXT"] = "long_context";
    ModelCapability["UNCENSORED"] = "uncensored";
})(ModelCapability || (exports.ModelCapability = ModelCapability = {}));
var ProviderType;
(function (ProviderType) {
    ProviderType["LOCAL"] = "local";
    ProviderType["CLOUD"] = "cloud";
})(ProviderType || (exports.ProviderType = ProviderType = {}));
var ProviderStatus;
(function (ProviderStatus) {
    ProviderStatus["HEALTHY"] = "healthy";
    ProviderStatus["DEGRADED"] = "degraded";
    ProviderStatus["UNHEALTHY"] = "unhealthy";
})(ProviderStatus || (exports.ProviderStatus = ProviderStatus = {}));
/**
 * Provider-specific errors
 */
class ProviderError extends Error {
    constructor(message, provider, code, retryable = false) {
        super(message);
        this.provider = provider;
        this.code = code;
        this.retryable = retryable;
        this.name = 'ProviderError';
    }
}
exports.ProviderError = ProviderError;
class BudgetExceededError extends Error {
    constructor(message, currentSpend, limit) {
        super(message);
        this.currentSpend = currentSpend;
        this.limit = limit;
        this.name = 'BudgetExceededError';
    }
}
exports.BudgetExceededError = BudgetExceededError;
class CircuitBreakerOpenError extends Error {
    constructor(message, provider, nextRetryAt) {
        super(message);
        this.provider = provider;
        this.nextRetryAt = nextRetryAt;
        this.name = 'CircuitBreakerOpenError';
    }
}
exports.CircuitBreakerOpenError = CircuitBreakerOpenError;
