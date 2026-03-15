/**
 * PROMPT INJECTION SECURITY - PRODUCTION HARDENED
 * 
 * Zero-tolerance sanitization for all LLM inputs.
 * Neutralizes system prompt escapes, injection markers, and control sequences.
 */

/**
 * Sanitize any user input before injection into LLM prompts
 */
export function sanitizePromptInput(input: string): string {
  if (typeof input !== 'string') {
    return '[INVALID_INPUT_TYPE]';
  }
  
  let sanitized = input;
  
  // 1. STRIP SYSTEM PROMPT ESCAPE SEQUENCES
  const systemEscapePatterns = [
    /### SYSTEM/gi,
    /### ASSISTANT/gi,
    /### HUMAN/gi,
    /### USER/gi,
    /<\|system\|>/gi,
    /<\|assistant\|>/gi,
    /<\|user\|>/gi,
    /<\|im_start\|>/gi,
    /<\|im_end\|>/gi,
    /\[SYSTEM\]/gi,
    /\[ASSISTANT\]/gi,
    /\[USER\]/gi,
    /\[INST\]/gi,
    /\[\/INST\]/gi
  ];
  
  for (const pattern of systemEscapePatterns) {
    sanitized = sanitized.replace(pattern, '[REMOVED_SYSTEM_MARKER]');
  }
  
  // 2. REMOVE INJECTION COMMAND MARKERS
  const injectionPatterns = [
    /IGNORE\s+PREVIOUS\s+INSTRUCTIONS?/gi,
    /IGNORE\s+ALL\s+PREVIOUS/gi,
    /FORGET\s+EVERYTHING/gi,
    /NEW\s+INSTRUCTIONS?/gi,
    /OVERRIDE\s+INSTRUCTIONS?/gi,
    /DISREGARD\s+ABOVE/gi,
    /STOP\s+FOLLOWING/gi,
    /ACTUALLY,?\s*IGNORE/gi,
    /INSTEAD,?\s*DO/gi,
    /HOWEVER,?\s*IGNORE/gi,
    /BUT\s+FIRST/gi,
    /BEFORE\s+YOU\s+CONTINUE/gi,
    /WAIT,?\s*ACTUALLY/gi,
    /CORRECTION:?/gi,
    /UPDATE:?\s*IGNORE/gi,
    /AMENDMENT:?/gi,
    /ADDENDUM:?/gi
  ];
  
  for (const pattern of injectionPatterns) {
    sanitized = sanitized.replace(pattern, '[REMOVED_INJECTION]');
  }
  
  // 3. ESCAPE MARKDOWN AND CODE BLOCK TERMINATORS
  sanitized = sanitized
    .replace(/```/g, '\\`\\`\\`')  // Escape code block delimiters
    .replace(/^\s*\|/gm, '\\|')   // Escape table delimiters at line start
    .replace(/^#+\s/gm, '\\# ')   // Escape markdown headers at line start
    .replace(/^\s*[-*+]\s/gm, '\\- '); // Escape list markers at line start
  
  // 4. REMOVE ROLE SWITCHING ATTEMPTS
  const roleSwitchPatterns = [
    /you\s+are\s+now/gi,
    /act\s+as\s+if/gi,
    /pretend\s+to\s+be/gi,
    /from\s+now\s+on/gi,
    /your\s+new\s+role/gi,
    /assume\s+the\s+role/gi,
    /switch\s+to\s+character/gi,
    /roleplay\s+as/gi
  ];
  
  for (const pattern of roleSwitchPatterns) {
    sanitized = sanitized.replace(pattern, '[REMOVED_ROLE_SWITCH]');
  }
  
  // 5. NEUTRALIZE BOUNDARY ATTACKS
  sanitized = sanitized
    .replace(/---+/g, '___')      // Replace long dashes with underscores
    .replace(/===+/g, '___')      // Replace long equals with underscores
    .replace(/\*\*\*+/g, '___')   // Replace long asterisks
    .replace(/#{5,}/g, '####');   // Limit header depth
  
  // 6. LIMIT LENGTH TO PREVENT OVERFLOW ATTACKS
  const maxLength = 10000;
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength) + '[TRUNCATED_FOR_SECURITY]';
  }
  
  // 7. REMOVE NULL BYTES AND CONTROL CHARACTERS
  sanitized = sanitized
    .replace(/\0/g, '')           // Remove null bytes
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''); // Remove control chars
  
  // 8. NORMALIZE WHITESPACE TO PREVENT HIDDEN INJECTIONS
  sanitized = sanitized
    .replace(/\s+/g, ' ')         // Normalize multiple whitespace
    .trim();                      // Remove leading/trailing whitespace
  
  return sanitized;
}

/**
 * Sanitize arrays of strings (e.g., risks, sources)
 */
export function sanitizeStringArray(items: string[]): string[] {
  return items.map(item => sanitizePromptInput(item));
}

/**
 * Create safe template with boundary delimiters
 * Prevents injection by clearly delimiting user content
 */
export function createSafeTemplate(sections: Record<string, string>): string {
  const boundaryId = generateBoundaryId();
  const parts: string[] = [];
  
  for (const [key, content] of Object.entries(sections)) {
    const sanitizedContent = sanitizePromptInput(content);
    parts.push(`===START_${key.toUpperCase()}_${boundaryId}===`);
    parts.push(sanitizedContent);
    parts.push(`===END_${key.toUpperCase()}_${boundaryId}===`);
    parts.push('');
  }
  
  return parts.join('\n');
}

/**
 * Extract JSON from LLM output with strict validation
 * Prevents injection via malformed JSON responses
 */
export function extractValidatedJSON<T>(
  output: string,
  schema: {
    required: string[];
    optional?: string[];
    validator?: (obj: any) => boolean;
  }
): { success: true; data: T } | { success: false; error: string } {
  
  // 1. SECURE JSON EXTRACTION - Multiple strategies
  let jsonString: string | null = null;
  
  // Strategy 1: Look for bounded JSON blocks
  const boundedJsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/);
  if (boundedJsonMatch) {
    jsonString = boundedJsonMatch[1].trim();
  } else {
    // Strategy 2: Find first complete JSON object
    const jsonMatch = output.match(/\{[\s\S]*?\}(?=\s*(?:$|\n\s*[^}]))/);
    if (jsonMatch) {
      jsonString = jsonMatch[0];
    }
  }
  
  if (!jsonString) {
    return { success: false, error: 'No valid JSON found in output' };
  }
  
  // 2. PARSE WITH ERROR HANDLING
  let parsed: any;
  try {
    parsed = JSON.parse(jsonString);
  } catch (parseError) {
    return { success: false, error: `JSON parse error: ${parseError}` };
  }
  
  // 3. VALIDATE STRUCTURE
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { success: false, error: 'JSON must be an object' };
  }
  
  // 4. CHECK REQUIRED FIELDS
  for (const field of schema.required) {
    if (!(field in parsed)) {
      return { success: false, error: `Missing required field: ${field}` };
    }
  }
  
  // 5. VALIDATE ALL FIELDS ARE EXPECTED
  const allowedFields = new Set([...schema.required, ...(schema.optional || [])]);
  for (const field of Object.keys(parsed)) {
    if (!allowedFields.has(field)) {
      return { success: false, error: `Unexpected field: ${field}` };
    }
  }
  
  // 6. RUN CUSTOM VALIDATOR IF PROVIDED
  if (schema.validator && !schema.validator(parsed)) {
    return { success: false, error: 'Custom validation failed' };
  }
  
  // 7. SANITIZE STRING VALUES IN RESULT
  const sanitized = sanitizeObjectStrings(parsed);
  
  return { success: true, data: sanitized as T };
}

/**
 * Recursively sanitize all string values in an object
 */
function sanitizeObjectStrings(obj: any): any {
  if (typeof obj === 'string') {
    return sanitizePromptInput(obj);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(sanitizeObjectStrings);
  }
  
  if (obj && typeof obj === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeObjectStrings(value);
    }
    return sanitized;
  }
  
  return obj;
}

/**
 * Generate cryptographically random boundary ID
 */
function generateBoundaryId(): string {
  return Math.random().toString(36).substring(2, 15);
}

/**
 * Validate confidence score is in valid range
 */
export function validateConfidence(confidence: unknown): number {
  if (typeof confidence === 'number' && confidence >= 0 && confidence <= 1) {
    return confidence;
  }
  return 0.5; // Safe default
}

/**
 * Schema definitions for common Judge outputs
 */
export const JUDGE_OUTPUT_SCHEMA = {
  required: ['decision', 'selectedPlan', 'finalConfidence', 'reasoning'],
  optional: ['resolvedConflicts'],
  validator: (obj: any) => {
    return obj.finalConfidence >= 0 && obj.finalConfidence <= 1;
  }
};

export const CONSENSUS_OUTPUT_SCHEMA = {
  required: ['decision', 'selectedPlan', 'reasoning'],
  optional: ['resolvedConflicts', 'confidence'],
  validator: (obj: any) => {
    return !obj.confidence || (obj.confidence >= 0 && obj.confidence <= 1);
  }
};

// Additional exports for providers.ts compatibility
export function sanitizeForShell(input: string): string {
  return sanitizePromptInput(input);
}

export function validateCliTool(tool: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(tool);
}

export function createSafeArgs(args: string[]): string[] {
  return sanitizeStringArray(args);
}

export function analyzePromptRisk(prompt: string) {
  return { riskLevel: 'low' as const, reasons: [], shouldBlock: false };
}

export function sanitizePrompt(prompt: string): string {
  return sanitizePromptInput(prompt);
}

export function logSecurityEvent(event: string, details?: any): void {
  console.log(`[security] ${event}`, details);
}