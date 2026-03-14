/**
 * LLM-Powered Memory Extraction (ported from DeerFlow)
 *
 * After each conversation completes, this module:
 *   1. Formats the conversation for analysis
 *   2. Calls a local Ollama model to extract facts + profile updates
 *   3. Stores extracted facts in CORTEX (SQLite-backed)
 *   4. Maintains a structured memory profile (workContext, personalContext, topOfMind)
 *
 * Integration: called from afterModel middleware hook.
 * Cost: zero — uses local Ollama (dolphin-llama3:8b).
 */

import type { Cortex, MemoryKind } from "./skynet.js";

// ─── Types ───────────────────────────────────────────────────

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface ExtractedFact {
  content: string;
  category: "preference" | "knowledge" | "context" | "behavior" | "goal";
  confidence: number;
}

interface ProfileSection {
  summary: string;
  shouldUpdate: boolean;
}

interface MemoryUpdateResponse {
  user?: {
    workContext?: ProfileSection;
    personalContext?: ProfileSection;
    topOfMind?: ProfileSection;
  };
  newFacts?: ExtractedFact[];
  factsToRemove?: string[];
}

export interface MemoryProfile {
  workContext: string;
  personalContext: string;
  topOfMind: string;
  lastUpdated: number;
}

// ─── Prompt Template (adapted from DeerFlow) ──────────────────

const MEMORY_UPDATE_PROMPT = `You are a memory extraction system. Analyze this conversation and extract important facts about the user.

Current Memory Profile:
<current_profile>
{current_profile}
</current_profile>

Conversation:
<conversation>
{conversation}
</conversation>

Instructions:
1. Extract specific, actionable facts about the user (preferences, knowledge, context, goals)
2. Update the memory profile sections if there's meaningful new information
3. Only set shouldUpdate=true when there's genuinely new info

Profile Sections:
- workContext: Professional role, projects, technologies (2-3 sentences)
- personalContext: Communication preferences, interests, expertise (1-2 sentences)
- topOfMind: Current focus areas and priorities (3-5 sentences)

Fact Categories:
- preference: Tools, styles, approaches user prefers
- knowledge: Specific expertise, technologies mastered
- context: Background facts (role, projects, locations)
- behavior: Working patterns, communication habits
- goal: Stated objectives, project ambitions

Confidence: 0.9+ for explicit statements, 0.7-0.8 for strongly implied, skip anything below 0.7.

Output ONLY valid JSON:
{
  "user": {
    "workContext": { "summary": "...", "shouldUpdate": true/false },
    "personalContext": { "summary": "...", "shouldUpdate": true/false },
    "topOfMind": { "summary": "...", "shouldUpdate": true/false }
  },
  "newFacts": [
    { "content": "...", "category": "preference|knowledge|context|behavior|goal", "confidence": 0.7-1.0 }
  ],
  "factsToRemove": []
}

Return ONLY valid JSON, no explanation or markdown.`;

// ─── Profile Keys ─────────────────────────────────────────────

const PROFILE_TAG = "memory-profile";
const PROFILE_SECTIONS = ["workContext", "personalContext", "topOfMind"] as const;

// ─── Ollama Client ────────────────────────────────────────────

const OLLAMA_URL = "http://127.0.0.1:11434/api/generate";
const OLLAMA_MODEL = "dolphin-llama3:8b";

async function callOllama(prompt: string): Promise<string> {
  const resp = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      options: {
        temperature: 0.1,
        num_predict: 2048,
      },
    }),
  });

  if (!resp.ok) {
    throw new Error(`Ollama request failed: ${resp.status} ${resp.statusText}`);
  }

  const data = (await resp.json()) as { response: string };
  return data.response.trim();
}

// ─── Conversation Formatting ──────────────────────────────────

function formatConversation(messages: ConversationMessage[]): string {
  const lines: string[] = [];

  for (const msg of messages) {
    if (msg.role === "system") continue;

    let content = msg.content;
    // Truncate very long messages
    if (content.length > 1000) {
      content = content.slice(0, 1000) + "...";
    }

    const label = msg.role === "user" ? "User" : "Assistant";
    lines.push(`${label}: ${content}`);
  }

  return lines.join("\n\n");
}

// ─── Profile Management ──────────────────────────────────────

function loadProfile(cortex: Cortex): MemoryProfile {
  const profile: MemoryProfile = {
    workContext: "",
    personalContext: "",
    topOfMind: "",
    lastUpdated: 0,
  };

  const memories = cortex.recallByTag(PROFILE_TAG, 10);
  for (const mem of memories) {
    for (const section of PROFILE_SECTIONS) {
      if (mem.tags.includes(section)) {
        profile[section] = mem.content;
        if (mem.createdAt > profile.lastUpdated) {
          profile.lastUpdated = mem.createdAt;
        }
      }
    }
  }

  return profile;
}

function saveProfileSection(
  cortex: Cortex,
  section: (typeof PROFILE_SECTIONS)[number],
  summary: string,
): void {
  // Remove old profile entry for this section
  const existing = cortex.recallByTag(PROFILE_TAG, 50);
  for (const mem of existing) {
    if (mem.tags.includes(section)) {
      cortex.forget(mem.id);
    }
  }

  // Store new profile section
  cortex.memorize(summary, "fact", `profile:${section}`);
  // The memorize method auto-extracts tags from content, but we need the profile tag.
  // Re-store with explicit tags by using the lower-level approach:
  // Actually, Cortex.memorize only takes (content, kind, source) — tags are auto-extracted.
  // We'll store with a content prefix so recallByTag can find it.

  // Better approach: store with identifiable content that extractTags won't miss
  const taggedContent = `#${PROFILE_TAG} #${section} ${summary}`;
  // Remove the one we just stored without tags
  const recent = cortex.recent(1);
  if (recent.length > 0 && recent[0].content === summary) {
    cortex.forget(recent[0].id);
  }
  cortex.memorize(taggedContent, "fact", `profile:${section}`);
}

// ─── JSON Parsing Helper ──────────────────────────────────────

function parseJsonResponse(text: string): MemoryUpdateResponse {
  let cleaned = text.trim();

  // Strip markdown code fences
  if (cleaned.startsWith("```")) {
    const lines = cleaned.split("\n");
    // Remove first line (```json or ```)
    lines.shift();
    // Remove last line if it's ```
    if (lines.length > 0 && lines[lines.length - 1].trim() === "```") {
      lines.pop();
    }
    cleaned = lines.join("\n");
  }

  return JSON.parse(cleaned) as MemoryUpdateResponse;
}

// ─── Main Extraction ──────────────────────────────────────────

/**
 * Extract facts from a completed conversation and store them in CORTEX.
 *
 * @param cortex  - CORTEX instance (from Skynet)
 * @param messages - The conversation messages
 * @param source  - Source identifier (e.g. channel/thread ID)
 * @returns Number of facts stored, or -1 on error
 */
export async function extractAndStoreMemories(
  cortex: Cortex,
  messages: ConversationMessage[],
  source = "conversation",
): Promise<number> {
  if (messages.length < 2) return 0;

  try {
    // Load current profile
    const profile = loadProfile(cortex);
    const profileText = [
      `Work: ${profile.workContext || "(empty)"}`,
      `Personal: ${profile.personalContext || "(empty)"}`,
      `Focus: ${profile.topOfMind || "(empty)"}`,
    ].join("\n");

    // Format conversation
    const conversationText = formatConversation(messages);
    if (!conversationText.trim()) return 0;

    // Build prompt
    const prompt = MEMORY_UPDATE_PROMPT.replace("{current_profile}", profileText).replace(
      "{conversation}",
      conversationText,
    );

    // Call Ollama
    const rawResponse = await callOllama(prompt);

    // Parse response
    const update = parseJsonResponse(rawResponse);

    let stored = 0;

    // Update profile sections
    if (update.user) {
      for (const section of PROFILE_SECTIONS) {
        const sectionData = update.user[section];
        if (sectionData?.shouldUpdate && sectionData.summary) {
          saveProfileSection(cortex, section, sectionData.summary);
          stored++;
        }
      }
    }

    // Remove outdated facts
    if (update.factsToRemove && update.factsToRemove.length > 0) {
      for (const factId of update.factsToRemove) {
        cortex.forget(factId);
      }
    }

    // Store new facts
    if (update.newFacts) {
      for (const fact of update.newFacts) {
        if (fact.confidence < 0.7) continue;
        if (!fact.content?.trim()) continue;

        // Tag with category for retrieval
        const taggedContent = `#${fact.category} ${fact.content}`;
        cortex.memorize(taggedContent, "fact", source);
        stored++;
      }
    }

    console.log(`[MEMORY-UPDATER] Extracted ${stored} memories from conversation`);
    return stored;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[MEMORY-UPDATER] Extraction failed: ${msg}`);
    return -1;
  }
}

/**
 * afterModel middleware hook integration point.
 *
 * Call this after a model response completes to extract and store facts.
 * Non-blocking — fires and forgets so it doesn't slow down the response.
 *
 * @param cortex   - CORTEX instance
 * @param messages - Conversation messages (including the latest response)
 * @param source   - Source identifier
 */
export function afterModelMemoryHook(
  cortex: Cortex,
  messages: ConversationMessage[],
  source = "conversation",
): void {
  // Fire and forget — don't block the response pipeline
  extractAndStoreMemories(cortex, messages, source).catch((err) => {
    console.error("[MEMORY-UPDATER] Background extraction error:", err);
  });
}

/**
 * Get the current memory profile from CORTEX.
 */
export function getMemoryProfile(cortex: Cortex): MemoryProfile {
  return loadProfile(cortex);
}

/**
 * Build a context string from the memory profile for injection into prompts.
 */
export function buildMemoryContext(cortex: Cortex): string {
  const profile = loadProfile(cortex);

  const sections: string[] = [];
  if (profile.workContext) sections.push(`Work: ${profile.workContext}`);
  if (profile.personalContext) sections.push(`Personal: ${profile.personalContext}`);
  if (profile.topOfMind) sections.push(`Current Focus: ${profile.topOfMind}`);

  if (sections.length === 0) return "";

  return `## User Memory Profile\n\n${sections.map((s) => `- ${s}`).join("\n")}\n`;
}
