# ⚡ COMPLETE ORGAN TRANSPLANT: SuperClaw → Alpha

## Overview
Transplanting ALL 411 TypeScript organs from SuperClaw into Alpha to create the ultimate AI creature.

## Organ Systems (10 workstreams)

### 🧠 WS-1: SKYNET Brain (63 files)
Source: `/home/toba/superclaw/src/skynet/`
Target: `/home/toba/alpha/src/superclaw/skynet/`
- Full SKYNET intelligence: PULSE, GUARDIAN, SENTINEL, ORACLE, NEXUS, CORTEX
- Consensus algorithms: Byzantine, CRDT, Gossip, Raft, Quorum
- Moltbook agent communication bus
- Self-evolution engine
- Formal verification
- Cost control & credit system
- Sub-agent spawning with safety boundaries
- Proof engine (3-tier)

### 🌊 WS-2: SWARM Consciousness (22 files)
Source: `/home/toba/superclaw/src/swarm/`
Target: `/home/toba/alpha/src/superclaw/swarm/`
- Circuit breaker, contracts, convoy
- Judge, orchestrator, synthesizer
- Model router, provider management
- Gastown integration (Mayor/Rigs/Polecats)
- Binary protocol, telemetry

### 🗣️ WS-3: VOICE & TUI (7 files)
Source: `/home/toba/superclaw/src/voice/` + `/home/toba/superclaw/src/tui/`
Target: `/home/toba/alpha/src/superclaw/voice/` + enhanced TUI
- STT/TTS providers
- Voice router & config
- Token efficiency dashboard

### 🔌 WS-4: MCP Nervous System (15 files)
Source: `/home/toba/superclaw/src/mcp/`
Target: `/home/toba/alpha/src/superclaw/mcp/`
- Federation controller
- Tool registry, server wrapper
- PinchTab, OpenBrowser, AgentChattr bridges
- MCP CLI

### 📚 WS-5: ORACLE Learning + CORTEX Memory (12 files)
Source: `/home/toba/superclaw/src/oracle/` + `/home/toba/superclaw/src/cortex/`
Target: `/home/toba/alpha/src/superclaw/oracle/` + `/home/toba/alpha/src/superclaw/cortex/`
- DSPy modules, reflexion loop, memory tiers
- Prompt compressor, SynthLang optimizer
- Cognitive containers, GNN learner, RuVector backend

### 🔐 WS-6: SECURITY + CONSENSUS (21 files)
Source: `/home/toba/superclaw/src/security/` + `/home/toba/superclaw/src/consensus/`
Target: `/home/toba/alpha/src/superclaw/security/` + `/home/toba/alpha/src/superclaw/consensus/`
- Audit logger, sandbox manager, OAuth gateway
- Prompt sanitizer, security policies
- Consensus agents, judge, negotiation engine
- Personality prompts

### ⚡ WS-7: PROVIDERS (22 files)
Source: `/home/toba/superclaw/src/providers/`
Target: `/home/toba/alpha/src/superclaw/providers/`
- All providers: Anthropic, Cerebras, Claude, Cohere, DeepSeek, Gemini, Groq, Mistral, NVIDIA NIM, Ollama, OpenAI, Perplexity
- Provider registry, router, contracts, base class

### 🐝 WS-8: HIVEMIND + Coordination (12 files)
Source: `/home/toba/superclaw/src/hivemind/` + `/home/toba/superclaw/src/coordination/`
Target: `/home/toba/alpha/src/superclaw/hivemind/`
- CLI agent, coordinator, consensus, router
- Multi-agent coordination

### 🔧 WS-9: Integration Layer
- Wire all organs into Alpha's existing `src/superclaw/index.ts`
- Update `src/superclaw/bridge.ts` to connect real implementations
- Hook into Alpha's gateway, daemon, and session systems
- Update TypeScript imports and barrel exports

### 🧪 WS-10: Verification & Tests
- Run `tsc --noEmit` to verify no type errors
- Run existing SuperClaw tests in new location
- Verify Alpha still builds and starts
