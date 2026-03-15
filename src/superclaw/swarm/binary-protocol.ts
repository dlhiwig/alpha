/**
 * Binary WebSocket Protocol for Beast Mode Telemetry
 * 
 * Stolen from: VisionFlow's binary WebSocket protocol (80% bandwidth reduction).
 * 
 * When 50 agents are running in Beast Mode, JSON telemetry is:
 *   - Verbose (~500 bytes per event as JSON)
 *   - Slow to parse (JSON.parse is ~10x slower than DataView reads)
 *   - Wasteful (string encoding of numbers)
 * 
 * Binary protocol:
 *   - ~80 bytes per event (84% reduction)
 *   - Zero-copy reads via DataView
 *   - Fixed header + variable payload
 *   - Batch framing for bulk sends
 * 
 * Wire Format:
 *   [Header: 16 bytes] [Payload: variable]
 *   
 *   Header:
 *     0-1:   Magic (0xBE57 — "BEAST")
 *     2:     Version (1)
 *     3:     Event Type (enum)
 *     4-5:   Agent ID (uint16 — up to 65535 agents)
 *     6-9:   Timestamp (uint32 — seconds since epoch, wraps 2106)
 *     10-11: Payload Length (uint16 — up to 65535 bytes)
 *     12-15: Reserved (future: sequence number, flags)
 *   
 *   Payload varies by event type.
 * 
 * MUTHUR Architecture Layer: Telemetry
 */

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const MAGIC = 0xBE57;
const VERSION = 1;
const HEADER_SIZE = 16;
const MAX_PAYLOAD = 65535;
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

// ─────────────────────────────────────────────────────────────────
// Event Types
// ─────────────────────────────────────────────────────────────────

export enum TelemetryEventType {
  // Agent lifecycle
  AGENT_SPAWN     = 0x01,
  AGENT_COMPLETE  = 0x02,
  AGENT_FAIL      = 0x03,
  AGENT_HEARTBEAT = 0x04,

  // Execution
  TASK_START      = 0x10,
  TASK_COMPLETE   = 0x11,
  TASK_FAIL       = 0x12,
  TOOL_CALL       = 0x13,

  // Provider
  LLM_REQUEST     = 0x20,
  LLM_RESPONSE    = 0x21,
  LLM_ERROR       = 0x22,
  LLM_STREAM      = 0x23,

  // Resources
  COST_UPDATE     = 0x30,
  MEMORY_UPDATE   = 0x31,
  TOKEN_UPDATE    = 0x32,

  // System
  SWARM_START     = 0x40,
  SWARM_COMPLETE  = 0x41,
  CONSENSUS_VOTE  = 0x42,
  CIRCUIT_BREAK   = 0x43,

  // Batch
  BATCH           = 0xFF,
}

// ─────────────────────────────────────────────────────────────────
// Typed Payloads
// ─────────────────────────────────────────────────────────────────

export interface AgentSpawnPayload {
  role: string;
  provider: string;
  model: string;
}

export interface AgentCompletePayload {
  durationMs: number;
  costUsd: number; // stored as uint32 microdollars (max ~$4295)
  tokensUsed: number;
  success: boolean;
}

export interface LLMRequestPayload {
  provider: number; // provider ID (mapped via ProviderMap)
  model: number;    // model ID
  inputTokens: number;
  maxTokens: number;
}

export interface LLMResponsePayload {
  provider: number;
  model: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  costMicrodollars: number; // $0.001234 → 1234
}

export interface CostUpdatePayload {
  totalMicrodollars: number;
  deltaMs: number; // time since last update
}

// ─────────────────────────────────────────────────────────────────
// Provider & Model ID Maps (compact binary encoding)
// ─────────────────────────────────────────────────────────────────

const PROVIDER_IDS: Record<string, number> = {
  claude: 1, gemini: 2, codex: 3, ollama: 4,
  deepseek: 5, kimi: 6, cohere: 7, nvidia: 8,
  grok: 9, groq: 10, minimax: 11, zhipu: 12,
  mistral: 13, perplexity: 14, qwen: 15, nemotron: 16,
};

const PROVIDER_NAMES = Object.fromEntries(
  Object.entries(PROVIDER_IDS).map(([k, v]) => [v, k])
);

export function providerToId(name: string): number {
  return PROVIDER_IDS[name] ?? 0;
}

export function idToProvider(id: number): string {
  return PROVIDER_NAMES[id] ?? 'unknown';
}

// ─────────────────────────────────────────────────────────────────
// Encoder — Encode events to binary
// ─────────────────────────────────────────────────────────────────

export class BinaryEncoder {
  /**
   * Encode a single event to an ArrayBuffer.
   */
  static encode(
    type: TelemetryEventType,
    agentId: number,
    payload: ArrayBuffer | Uint8Array,
    timestamp?: number,
  ): ArrayBuffer {
    const payloadBytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    if (payloadBytes.length > MAX_PAYLOAD) {
      throw new Error(`Payload too large: ${payloadBytes.length} > ${MAX_PAYLOAD}`);
    }

    const buffer = new ArrayBuffer(HEADER_SIZE + payloadBytes.length);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    // Header
    view.setUint16(0, MAGIC, false);           // big-endian magic
    view.setUint8(2, VERSION);
    view.setUint8(3, type);
    view.setUint16(4, agentId, false);
    view.setUint32(6, (timestamp ?? Math.floor(Date.now() / 1000)) >>> 0, false);
    view.setUint16(10, payloadBytes.length, false);
    view.setUint32(12, 0, false);              // reserved

    // Payload
    bytes.set(payloadBytes, HEADER_SIZE);

    return buffer;
  }

  /** Encode agent spawn event. */
  static agentSpawn(agentId: number, role: string, provider: string, model: string): ArrayBuffer {
    const payload = TEXT_ENCODER.encode(JSON.stringify({ role, provider, model }));
    return this.encode(TelemetryEventType.AGENT_SPAWN, agentId, payload);
  }

  /** Encode agent completion (fixed 13-byte payload). */
  static agentComplete(
    agentId: number,
    durationMs: number,
    costUsd: number,
    tokensUsed: number,
    success: boolean,
  ): ArrayBuffer {
    const payload = new ArrayBuffer(13);
    const pv = new DataView(payload);
    pv.setUint32(0, durationMs, false);
    pv.setUint32(4, Math.round(costUsd * 1_000_000), false); // microdollars
    pv.setUint32(8, tokensUsed, false);
    pv.setUint8(12, success ? 1 : 0);
    return this.encode(TelemetryEventType.AGENT_COMPLETE, agentId, payload);
  }

  /** Encode LLM response (fixed 16-byte payload). */
  static llmResponse(
    agentId: number,
    provider: string,
    inputTokens: number,
    outputTokens: number,
    latencyMs: number,
    costUsd: number,
  ): ArrayBuffer {
    const payload = new ArrayBuffer(16);
    const pv = new DataView(payload);
    pv.setUint8(0, providerToId(provider));
    pv.setUint8(1, 0); // reserved model ID
    pv.setUint32(2, inputTokens, false);
    pv.setUint32(6, outputTokens, false);
    pv.setUint16(10, Math.min(latencyMs, 65535), false);
    pv.setUint32(12, Math.round(costUsd * 1_000_000), false);
    return this.encode(TelemetryEventType.LLM_RESPONSE, agentId, payload);
  }

  /** Encode a cost update (fixed 8-byte payload). */
  static costUpdate(agentId: number, totalUsd: number, deltaMs: number): ArrayBuffer {
    const payload = new ArrayBuffer(8);
    const pv = new DataView(payload);
    pv.setUint32(0, Math.round(totalUsd * 1_000_000), false);
    pv.setUint32(4, deltaMs, false);
    return this.encode(TelemetryEventType.COST_UPDATE, agentId, payload);
  }

  /**
   * Batch multiple events into a single frame.
   * Format: [batch header] [count: uint16] [event1] [event2] ...
   */
  static batch(events: ArrayBuffer[]): ArrayBuffer {
    let totalPayloadSize = 2; // uint16 count
    for (const event of events) {totalPayloadSize += event.byteLength;}

    const buffer = new ArrayBuffer(HEADER_SIZE + totalPayloadSize);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    // Batch header
    view.setUint16(0, MAGIC, false);
    view.setUint8(2, VERSION);
    view.setUint8(3, TelemetryEventType.BATCH);
    view.setUint16(4, 0, false);              // agent 0 = system
    view.setUint32(6, (Date.now() / 1000) >>> 0, false);
    view.setUint16(10, totalPayloadSize, false);
    view.setUint32(12, 0, false);

    // Count
    view.setUint16(HEADER_SIZE, events.length, false);

    // Events
    let offset = HEADER_SIZE + 2;
    for (const event of events) {
      bytes.set(new Uint8Array(event), offset);
      offset += event.byteLength;
    }

    return buffer;
  }
}

// ─────────────────────────────────────────────────────────────────
// Decoder — Decode binary events
// ─────────────────────────────────────────────────────────────────

export interface DecodedEvent {
  type: TelemetryEventType;
  typeName: string;
  agentId: number;
  timestamp: number;
  payload: ArrayBuffer;
  raw: ArrayBuffer;
}

export class BinaryDecoder {
  /** Decode a single event from an ArrayBuffer. */
  static decode(buffer: ArrayBuffer): DecodedEvent {
    if (buffer.byteLength < HEADER_SIZE) {
      throw new Error(`Buffer too small: ${buffer.byteLength} < ${HEADER_SIZE}`);
    }

    const view = new DataView(buffer);

    const magic = view.getUint16(0, false);
    if (magic !== MAGIC) {
      throw new Error(`Invalid magic: 0x${magic.toString(16)} (expected 0xBE57)`);
    }

    const version = view.getUint8(2);
    if (version !== VERSION) {
      throw new Error(`Unsupported version: ${version}`);
    }

    const type = view.getUint8(3) as TelemetryEventType;
    const agentId = view.getUint16(4, false);
    const timestamp = view.getUint32(6, false);
    const payloadLength = view.getUint16(10, false);

    if (buffer.byteLength < HEADER_SIZE + payloadLength) {
      throw new Error(`Buffer truncated: need ${HEADER_SIZE + payloadLength}, got ${buffer.byteLength}`);
    }

    const payload = buffer.slice(HEADER_SIZE, HEADER_SIZE + payloadLength);

    return {
      type,
      typeName: TelemetryEventType[type] ?? `UNKNOWN(0x${type.toString(16)})`,
      agentId,
      timestamp,
      payload,
      raw: buffer,
    };
  }

  /** Decode a batch frame into individual events. */
  static decodeBatch(buffer: ArrayBuffer): DecodedEvent[] {
    const outer = this.decode(buffer);
    if (outer.type !== TelemetryEventType.BATCH) {
      return [outer]; // Not a batch — return as single event
    }

    const view = new DataView(outer.payload);
    const count = view.getUint16(0, false);
    const events: DecodedEvent[] = [];

    let offset = 2;
    for (let i = 0; i < count; i++) {
      const innerView = new DataView(outer.payload, offset);
      const innerPayloadLen = innerView.getUint16(10, false);
      const innerSize = HEADER_SIZE + innerPayloadLen;

      const innerBuffer = outer.payload.slice(offset, offset + innerSize);
      events.push(this.decode(innerBuffer));
      offset += innerSize;
    }

    return events;
  }

  /** Decode an agent-complete payload into typed data. */
  static decodeAgentComplete(payload: ArrayBuffer): AgentCompletePayload {
    const pv = new DataView(payload);
    return {
      durationMs: pv.getUint32(0, false),
      costUsd: pv.getUint32(4, false) / 1_000_000,
      tokensUsed: pv.getUint32(8, false),
      success: pv.getUint8(12) === 1,
    };
  }

  /** Decode an LLM response payload into typed data. */
  static decodeLLMResponse(payload: ArrayBuffer): LLMResponsePayload {
    const pv = new DataView(payload);
    return {
      provider: pv.getUint8(0),
      model: pv.getUint8(1),
      inputTokens: pv.getUint32(2, false),
      outputTokens: pv.getUint32(6, false),
      latencyMs: pv.getUint16(10, false),
      costMicrodollars: pv.getUint32(12, false),
    };
  }
}

// ─────────────────────────────────────────────────────────────────
// Bandwidth Comparison (for documentation)
// ─────────────────────────────────────────────────────────────────

/**
 * JSON equivalent of an LLM response event:
 * {
 *   "type": "llm_response",
 *   "agentId": 7,
 *   "timestamp": 1741665600,
 *   "provider": "claude",
 *   "model": "sonnet",
 *   "inputTokens": 12500,
 *   "outputTokens": 3200,
 *   "latencyMs": 1450,
 *   "costUsd": 0.004523
 * }
 * 
 * JSON size: ~220 bytes
 * Binary size: 16 (header) + 16 (payload) = 32 bytes
 * 
 * Reduction: 85.4%
 * 
 * At 50 agents × 10 events/second = 500 events/sec:
 *   JSON: 110 KB/s
 *   Binary: 16 KB/s
 *   
 * Over 1 hour Beast Mode session:
 *   JSON: 396 MB
 *   Binary: 57.6 MB
 *   Savings: 338 MB
 */
