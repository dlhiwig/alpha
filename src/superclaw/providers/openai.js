"use strict";
/**
 * OpenAI Provider for SuperClaw
 *
 * Full-featured OpenAI API integration with GPT models
 * Supports streaming, function calling, and comprehensive cost tracking
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAIProvider = void 0;
exports.createOpenAIProvider = createOpenAIProvider;
const contracts_1 = require("./contracts");
class OpenAIProvider {
    constructor(config) {
        this.name = 'openai';
        this.type = contracts_1.ProviderType.CLOUD;
        this.priority = 3;
        this.defaultModel = 'gpt-4o';
        // Comprehensive model definitions with latest GPT models
        this.availableModels = [
            {
                name: 'gpt-4o',
                displayName: 'GPT-4o',
                contextLength: 128000,
                capabilities: [
                    contracts_1.ModelCapability.TEXT_GENERATION,
                    contracts_1.ModelCapability.CODE_GENERATION,
                    contracts_1.ModelCapability.REASONING,
                    contracts_1.ModelCapability.FUNCTION_CALLING,
                    contracts_1.ModelCapability.VISION,
                    contracts_1.ModelCapability.LONG_CONTEXT
                ],
                costPerInputToken: 2.50 / 1000000,
                costPerOutputToken: 10.00 / 1000000
            },
            {
                name: 'gpt-4o-mini',
                displayName: 'GPT-4o Mini',
                contextLength: 128000,
                capabilities: [
                    contracts_1.ModelCapability.TEXT_GENERATION,
                    contracts_1.ModelCapability.CODE_GENERATION,
                    contracts_1.ModelCapability.REASONING,
                    contracts_1.ModelCapability.FUNCTION_CALLING,
                    contracts_1.ModelCapability.VISION,
                    contracts_1.ModelCapability.LONG_CONTEXT
                ],
                costPerInputToken: 0.15 / 1000000,
                costPerOutputToken: 0.60 / 1000000
            },
            {
                name: 'gpt-4-turbo',
                displayName: 'GPT-4 Turbo',
                contextLength: 128000,
                capabilities: [
                    contracts_1.ModelCapability.TEXT_GENERATION,
                    contracts_1.ModelCapability.CODE_GENERATION,
                    contracts_1.ModelCapability.REASONING,
                    contracts_1.ModelCapability.FUNCTION_CALLING,
                    contracts_1.ModelCapability.VISION,
                    contracts_1.ModelCapability.LONG_CONTEXT
                ],
                costPerInputToken: 10.00 / 1000000,
                costPerOutputToken: 30.00 / 1000000
            },
            {
                name: 'gpt-4',
                displayName: 'GPT-4',
                contextLength: 8192,
                capabilities: [
                    contracts_1.ModelCapability.TEXT_GENERATION,
                    contracts_1.ModelCapability.CODE_GENERATION,
                    contracts_1.ModelCapability.REASONING,
                    contracts_1.ModelCapability.FUNCTION_CALLING
                ],
                costPerInputToken: 30.00 / 1000000,
                costPerOutputToken: 60.00 / 1000000
            },
            {
                name: 'gpt-3.5-turbo',
                displayName: 'GPT-3.5 Turbo',
                contextLength: 16385,
                capabilities: [
                    contracts_1.ModelCapability.TEXT_GENERATION,
                    contracts_1.ModelCapability.CODE_GENERATION,
                    contracts_1.ModelCapability.FUNCTION_CALLING
                ],
                costPerInputToken: 0.50 / 1000000,
                costPerOutputToken: 1.50 / 1000000
            },
            {
                name: 'o1',
                displayName: 'o1',
                contextLength: 200000,
                capabilities: [
                    contracts_1.ModelCapability.TEXT_GENERATION,
                    contracts_1.ModelCapability.CODE_GENERATION,
                    contracts_1.ModelCapability.REASONING,
                    contracts_1.ModelCapability.LONG_CONTEXT
                ],
                costPerInputToken: 15.00 / 1000000,
                costPerOutputToken: 60.00 / 1000000
            },
            {
                name: 'o1-mini',
                displayName: 'o1 Mini',
                contextLength: 200000,
                capabilities: [
                    contracts_1.ModelCapability.TEXT_GENERATION,
                    contracts_1.ModelCapability.CODE_GENERATION,
                    contracts_1.ModelCapability.REASONING,
                    contracts_1.ModelCapability.LONG_CONTEXT
                ],
                costPerInputToken: 3.00 / 1000000,
                costPerOutputToken: 12.00 / 1000000
            }
        ];
        this.config = {
            apiKey: config.apiKey,
            baseUrl: config.baseUrl || 'https://api.openai.com/v1',
            organization: config.organization || '',
            defaultModel: config.defaultModel || 'gpt-4o',
            maxRetries: config.maxRetries || 3,
            retryDelay: config.retryDelay || 1000,
            timeout: config.timeout || 60000
        };
        if (!this.config.apiKey) {
            throw new contracts_1.ProviderError('OpenAI API key is required', this.name, 'MISSING_API_KEY', false);
        }
        this.health = {
            status: contracts_1.ProviderStatus.HEALTHY,
            lastCheck: new Date(),
            consecutiveFailures: 0,
            avgResponseTime: 0,
            errorRate: 0,
            uptime: 100
        };
    }
    async initialize() {
        try {
            // Test connection by listing models
            const response = await this.makeRequest('GET', '/models');
            if (!response.ok) {
                throw new contracts_1.ProviderError(`OpenAI API authentication failed: ${response.status}`, this.name, 'AUTH_FAILED', false);
            }
            this.updateHealthStatus(true, 0);
        }
        catch (error) {
            this.updateHealthStatus(false, 0);
            if (error instanceof contracts_1.ProviderError) {
                throw error;
            }
            throw new contracts_1.ProviderError(`Failed to initialize OpenAI provider: ${error instanceof Error ? error.message : 'Unknown error'}`, this.name, 'INIT_FAILED', true);
        }
    }
    async isHealthy() {
        try {
            const startTime = Date.now();
            const response = await this.makeRequest('GET', '/models');
            const responseTime = Date.now() - startTime;
            const healthy = response.ok;
            this.updateHealthStatus(healthy, responseTime);
            return healthy;
        }
        catch {
            this.updateHealthStatus(false, 0);
            return false;
        }
    }
    async getHealth() {
        await this.isHealthy();
        return { ...this.health };
    }
    async getModels() {
        return [...this.availableModels];
    }
    async generate(request) {
        const startTime = Date.now();
        const model = request.model || this.defaultModel;
        let lastError = null;
        // Retry logic with exponential backoff
        for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
            try {
                const openaiRequest = await this.buildOpenAIRequest(request, model, false);
                const response = await this.makeRequest('POST', '/chat/completions', openaiRequest);
                if (!response.ok) {
                    const errorText = await response.text();
                    const isRetryable = response.status >= 500 || response.status === 429;
                    if (!isRetryable || attempt === this.config.maxRetries) {
                        throw new contracts_1.ProviderError(`OpenAI API error: ${response.status} - ${errorText}`, this.name, response.status.toString(), isRetryable);
                    }
                    lastError = new Error(`HTTP ${response.status}: ${errorText}`);
                    await this.delay(this.config.retryDelay * Math.pow(2, attempt - 1));
                    continue;
                }
                const data = await response.json();
                const responseTime = Date.now() - startTime;
                this.updateHealthStatus(true, responseTime);
                const choice = data.choices[0];
                if (!choice) {
                    throw new contracts_1.ProviderError('No response choices returned from OpenAI', this.name, 'NO_CHOICES', true);
                }
                // Handle function calls
                let responseText = choice.message.content || '';
                if (choice.message.function_call || choice.message.tool_calls) {
                    responseText = JSON.stringify({
                        function_call: choice.message.function_call,
                        tool_calls: choice.message.tool_calls
                    });
                }
                return {
                    text: responseText,
                    model: data.model,
                    tokens: {
                        input: data.usage.prompt_tokens,
                        output: data.usage.completion_tokens
                    },
                    cost: this.calculateCost(data.usage.prompt_tokens, data.usage.completion_tokens, data.model),
                    latency: responseTime,
                    provider: this.name
                };
            }
            catch (error) {
                lastError = error instanceof Error ? error : new Error('Unknown error');
                if (error instanceof contracts_1.ProviderError && !error.retryable) {
                    throw error;
                }
                if (attempt === this.config.maxRetries) {
                    break;
                }
                await this.delay(this.config.retryDelay * Math.pow(2, attempt - 1));
            }
        }
        this.updateHealthStatus(false, Date.now() - startTime);
        throw new contracts_1.ProviderError(`OpenAI request failed after ${this.config.maxRetries} attempts: ${lastError?.message}`, this.name, 'MAX_RETRIES_EXCEEDED', true);
    }
    async *stream(request) {
        const model = request.model || this.defaultModel;
        try {
            const openaiRequest = await this.buildOpenAIRequest(request, model, true);
            const response = await this.makeRequest('POST', '/chat/completions', openaiRequest);
            if (!response.ok) {
                const errorText = await response.text();
                throw new contracts_1.ProviderError(`OpenAI streaming error: ${response.status} - ${errorText}`, this.name, response.status.toString(), response.status >= 500 || response.status === 429);
            }
            const reader = response.body?.getReader();
            if (!reader) {
                throw new contracts_1.ProviderError('No response body available for streaming', this.name, 'NO_STREAM_BODY', true);
            }
            const decoder = new TextDecoder();
            let buffer = '';
            let accumulatedContent = '';
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done)
                        {break;}
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    for (const line of lines) {
                        const trimmedLine = line.trim();
                        if (!trimmedLine || trimmedLine === 'data: [DONE]') {
                            continue;
                        }
                        if (trimmedLine.startsWith('data: ')) {
                            try {
                                const jsonData = trimmedLine.substring(6);
                                const chunk = JSON.parse(jsonData);
                                const delta = chunk.choices[0]?.delta;
                                if (delta?.content) {
                                    accumulatedContent += delta.content;
                                    yield {
                                        text: delta.content,
                                        isComplete: false,
                                        model: chunk.model,
                                        provider: this.name
                                    };
                                }
                                // Handle function calls in streaming
                                if (delta?.function_call || delta?.tool_calls) {
                                    const functionData = {
                                        function_call: delta.function_call,
                                        tool_calls: delta.tool_calls
                                    };
                                    yield {
                                        text: JSON.stringify(functionData),
                                        isComplete: false,
                                        model: chunk.model,
                                        provider: this.name
                                    };
                                }
                                if (chunk.choices[0]?.finish_reason) {
                                    yield {
                                        text: '',
                                        isComplete: true,
                                        model: chunk.model,
                                        provider: this.name
                                    };
                                    break;
                                }
                            }
                            catch (parseError) {
                                // Ignore malformed JSON in stream
                                continue;
                            }
                        }
                    }
                }
                this.updateHealthStatus(true, 0);
            }
            finally {
                reader.releaseLock();
            }
        }
        catch (error) {
            this.updateHealthStatus(false, 0);
            if (error instanceof contracts_1.ProviderError) {
                throw error;
            }
            throw new contracts_1.ProviderError(`OpenAI streaming failed: ${error instanceof Error ? error.message : 'Unknown error'}`, this.name, 'STREAM_FAILED', true);
        }
    }
    canHandle(request, context) {
        // Check API key availability
        if (!this.config.apiKey) {
            return false;
        }
        // Check if model exists
        const model = request.model || this.defaultModel;
        if (!this.availableModels.some(m => m.name === model)) {
            return false;
        }
        // Check budget constraints
        if (context?.maxCost) {
            const estimatedCost = this.estimateRequestCost(request);
            if (estimatedCost > context.maxCost) {
                return false;
            }
        }
        // Check capabilities
        if (context?.requiredCapabilities) {
            const modelInfo = this.availableModels.find(m => m.name === model);
            if (!modelInfo)
                {return false;}
            return context.requiredCapabilities.every(cap => modelInfo.capabilities.includes(cap));
        }
        // Check health status
        if (this.health.status === contracts_1.ProviderStatus.UNHEALTHY) {
            return false;
        }
        return true;
    }
    async estimateCost(request) {
        return this.estimateRequestCost(request);
    }
    async shutdown() {
        // No persistent connections to close
    }
    async buildOpenAIRequest(request, model, stream) {
        const messages = [];
        // Add system prompt
        if (request.systemPrompt) {
            messages.push({
                role: 'system',
                content: request.systemPrompt
            });
        }
        // Add conversation context
        if (request.context?.messages) {
            messages.push(...request.context.messages.map(msg => ({
                role: msg.role,
                content: msg.content
            })));
        }
        // Add current prompt
        messages.push({
            role: 'user',
            content: request.prompt
        });
        const openaiRequest = {
            model,
            messages,
            max_tokens: request.maxTokens || 4096,
            temperature: request.temperature ?? 0.7,
            stream
        };
        // Add function calling support if available in context
        if (request.context?.metadata?.functions) {
            openaiRequest.functions = request.context.metadata.functions;
            openaiRequest.function_call = request.context.metadata.function_call || 'auto';
        }
        if (request.context?.metadata?.tools) {
            openaiRequest.tools = request.context.metadata.tools;
            openaiRequest.tool_choice = request.context.metadata.tool_choice || 'auto';
        }
        return openaiRequest;
    }
    async makeRequest(method, endpoint, body) {
        const headers = {
            'Authorization': `Bearer ${this.config.apiKey}`,
            'User-Agent': 'SuperClaw/1.0'
        };
        if (this.config.organization) {
            headers['OpenAI-Organization'] = this.config.organization;
        }
        if (method === 'POST') {
            headers['Content-Type'] = 'application/json';
        }
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
        try {
            const response = await fetch(`${this.config.baseUrl}${endpoint}`, {
                method,
                headers,
                body: body ? JSON.stringify(body) : undefined,
                signal: controller.signal
            });
            return response;
        }
        finally {
            clearTimeout(timeoutId);
        }
    }
    calculateCost(inputTokens, outputTokens, model) {
        const modelInfo = this.availableModels.find(m => m.name === model);
        if (!modelInfo) {
            // Fallback to GPT-4o pricing
            return (inputTokens * 2.50 + outputTokens * 10.00) / 1000000;
        }
        return (inputTokens * (modelInfo.costPerInputToken || 0) +
            outputTokens * (modelInfo.costPerOutputToken || 0));
    }
    estimateRequestCost(request) {
        // Rough token estimation: 1 token ≈ 4 characters
        const inputTokens = Math.ceil((request.prompt.length + (request.systemPrompt?.length || 0)) / 4);
        const outputTokens = request.maxTokens || 1000;
        const model = request.model || this.defaultModel;
        return this.calculateCost(inputTokens, outputTokens, model);
    }
    updateHealthStatus(success, responseTime) {
        this.health.lastCheck = new Date();
        if (success) {
            this.health.consecutiveFailures = 0;
            this.health.status = contracts_1.ProviderStatus.HEALTHY;
            if (responseTime > 0) {
                // Update running average of response time (exponential moving average)
                this.health.avgResponseTime =
                    this.health.avgResponseTime === 0
                        ? responseTime
                        : (this.health.avgResponseTime * 0.9) + (responseTime * 0.1);
            }
        }
        else {
            this.health.consecutiveFailures++;
            if (this.health.consecutiveFailures >= 5) {
                this.health.status = contracts_1.ProviderStatus.UNHEALTHY;
            }
            else if (this.health.consecutiveFailures >= 3) {
                this.health.status = contracts_1.ProviderStatus.DEGRADED;
            }
        }
    }
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
exports.OpenAIProvider = OpenAIProvider;
/**
 * Factory function to create OpenAI provider with environment variables
 */
function createOpenAIProvider(config) {
    const apiKey = config?.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new contracts_1.ProviderError('OpenAI API key required. Set OPENAI_API_KEY environment variable or pass apiKey in config.', 'openai', 'MISSING_API_KEY', false);
    }
    return new OpenAIProvider({
        apiKey,
        ...config
    });
}
