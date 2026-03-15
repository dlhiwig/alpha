/**
 * Quality Assessment Module for SuperClaw
 * 
 * Evaluates task output quality using multiple heuristics.
 * Used by SONA to learn which agents perform best.
 */

export interface QualityAssessmentInput {
  task: {
    id: string;
    role: string;
    instructions: string;
    context?: string;
  };
  output: string;
  latencyMs: number;
  tokens: {
    input: number;
    output: number;
  };
  error?: string;
}

export interface QualityAssessmentResult {
  score: number;           // 0.0 - 1.0
  confidence: number;      // 0.0 - 1.0 (how confident we are in the score)
  factors: QualityFactor[];
}

export interface QualityFactor {
  name: string;
  score: number;
  weight: number;
  reason?: string;
}

// --- Configuration ---

const CONFIG = {
  // Minimum output length (characters) to consider valid
  minOutputLength: 50,
  
  // Expected output length per 100 chars of instructions
  expectedOutputRatio: 2.0,
  
  // Maximum acceptable latency for simple tasks (ms)
  simpleTaskLatencyThreshold: 5000,
  
  // Keywords that indicate errors or failures
  errorKeywords: [
    'i cannot', 'i can\'t', 'i\'m unable', 'i am unable',
    'error:', 'failed:', 'exception:', 'sorry, but',
    'i don\'t have access', 'i don\'t know',
    'as an ai', 'as a language model',
  ],
  
  // Keywords that indicate helpful/complete responses
  positiveKeywords: [
    'here is', 'here\'s', 'the answer is', 'to summarize',
    'in conclusion', 'the result', 'solution:',
    'step 1', 'first,', 'finally,',
  ],
  
  // Role-specific expectations
  roleExpectations: {
    researcher: { minLength: 200, expectsSources: true },
    coder: { minLength: 100, expectsCodeBlocks: true },
    reviewer: { minLength: 100, expectsCritique: true },
    writer: { minLength: 300, expectsStructure: true },
    planner: { minLength: 150, expectsSteps: true },
    default: { minLength: 50 },
  },
};

// --- Quality Assessor ---

export class QualityAssessor {
  
  /**
   * Assess the quality of a task output
   */
  assess(input: QualityAssessmentInput): QualityAssessmentResult {
    const factors: QualityFactor[] = [];
    
    // If there was an error, quality is very low
    if (input.error) {
      return {
        score: 0.1,
        confidence: 0.9,
        factors: [{
          name: 'error',
          score: 0.1,
          weight: 1.0,
          reason: `Task failed with error: ${input.error.slice(0, 100)}`,
        }],
      };
    }
    
    // Factor 1: Output length appropriateness
    factors.push(this.assessLength(input));
    
    // Factor 2: Error keyword detection
    factors.push(this.assessErrorKeywords(input));
    
    // Factor 3: Positive keyword detection
    factors.push(this.assessPositiveKeywords(input));
    
    // Factor 4: Role-specific expectations
    factors.push(this.assessRoleExpectations(input));
    
    // Factor 5: Latency reasonableness
    factors.push(this.assessLatency(input));
    
    // Factor 6: Token efficiency
    factors.push(this.assessTokenEfficiency(input));
    
    // Calculate weighted average
    const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
    const weightedSum = factors.reduce((sum, f) => sum + f.score * f.weight, 0);
    const score = Math.max(0, Math.min(1, weightedSum / totalWeight));
    
    // Confidence based on how consistent the factors are
    const variance = factors.reduce((sum, f) => {
      const diff = f.score - score;
      return sum + diff * diff * f.weight;
    }, 0) / totalWeight;
    const confidence = Math.max(0.3, 1 - Math.sqrt(variance));
    
    return { score, confidence, factors };
  }
  
  private assessLength(input: QualityAssessmentInput): QualityFactor {
    const output = input.output;
    const instructions = input.task.instructions;
    
    // Too short is bad
    if (output.length < CONFIG.minOutputLength) {
      return {
        name: 'length',
        score: 0.3,
        weight: 0.2,
        reason: `Output too short (${output.length} chars)`,
      };
    }
    
    // Calculate expected length based on instructions
    const expectedLength = instructions.length * CONFIG.expectedOutputRatio;
    const ratio = output.length / Math.max(expectedLength, 100);
    
    // Score: 1.0 if ratio is 0.5-2.0, decreasing outside that range
    let score: number;
    if (ratio >= 0.5 && ratio <= 2.0) {
      score = 1.0;
    } else if (ratio < 0.5) {
      score = 0.4 + ratio * 1.2; // 0.4 at 0, 1.0 at 0.5
    } else {
      score = Math.max(0.5, 1.0 - (ratio - 2.0) * 0.1); // Decreases slowly
    }
    
    return {
      name: 'length',
      score,
      weight: 0.15,
      reason: `Output length ${output.length} chars (ratio: ${ratio.toFixed(2)})`,
    };
  }
  
  private assessErrorKeywords(input: QualityAssessmentInput): QualityFactor {
    const outputLower = input.output.toLowerCase();
    const foundErrors = CONFIG.errorKeywords.filter(kw => outputLower.includes(kw));
    
    if (foundErrors.length === 0) {
      return {
        name: 'error_keywords',
        score: 1.0,
        weight: 0.25,
        reason: 'No error indicators found',
      };
    }
    
    // Each error keyword reduces score
    const score = Math.max(0.2, 1.0 - foundErrors.length * 0.2);
    
    return {
      name: 'error_keywords',
      score,
      weight: 0.25,
      reason: `Found error indicators: ${foundErrors.slice(0, 3).join(', ')}`,
    };
  }
  
  private assessPositiveKeywords(input: QualityAssessmentInput): QualityFactor {
    const outputLower = input.output.toLowerCase();
    const foundPositive = CONFIG.positiveKeywords.filter(kw => outputLower.includes(kw));
    
    // More positive keywords = better
    const score = Math.min(1.0, 0.5 + foundPositive.length * 0.1);
    
    return {
      name: 'positive_keywords',
      score,
      weight: 0.15,
      reason: foundPositive.length > 0 
        ? `Found helpful indicators: ${foundPositive.slice(0, 3).join(', ')}`
        : 'No clear completion indicators',
    };
  }
  
  private assessRoleExpectations(input: QualityAssessmentInput): QualityFactor {
    const role = input.task.role.toLowerCase();
    const output = input.output;
    const outputLower = output.toLowerCase();
    
    const expectations = (CONFIG.roleExpectations as any)[role] || CONFIG.roleExpectations.default;
    let score = 1.0;
    const reasons: string[] = [];
    
    // Check minimum length
    if (output.length < expectations.minLength) {
      score -= 0.3;
      reasons.push(`Below min length for ${role}`);
    }
    
    // Check for code blocks if expected
    if (expectations.expectsCodeBlocks) {
      const hasCode = output.includes('```') || output.includes('    ') || /\bfunction\b|\bclass\b|\bdef\b/.test(output);
      if (!hasCode) {
        score -= 0.2;
        reasons.push('Missing expected code blocks');
      }
    }
    
    // Check for sources/references if expected
    if (expectations.expectsSources) {
      const hasSources = /http|www\.|source:|reference:|according to/i.test(output);
      if (!hasSources) {
        score -= 0.15;
        reasons.push('Missing expected sources');
      }
    }
    
    // Check for critique indicators if expected
    if (expectations.expectsCritique) {
      const hasCritique = /however|but|issue|problem|consider|suggest|improve/i.test(outputLower);
      if (!hasCritique) {
        score -= 0.15;
        reasons.push('Missing expected critique');
      }
    }
    
    // Check for steps/structure if expected
    if (expectations.expectsSteps) {
      const hasSteps = /step \d|first|second|third|finally|\d\./i.test(outputLower);
      if (!hasSteps) {
        score -= 0.15;
        reasons.push('Missing expected structure');
      }
    }
    
    return {
      name: 'role_expectations',
      score: Math.max(0.3, score),
      weight: 0.2,
      reason: reasons.length > 0 ? reasons.join('; ') : `Meets ${role} expectations`,
    };
  }
  
  private assessLatency(input: QualityAssessmentInput): QualityFactor {
    const latency = input.latencyMs;
    const instructionLength = input.task.instructions.length;
    
    // Simple tasks (short instructions) should be fast
    const isSimpleTask = instructionLength < 200;
    
    if (isSimpleTask) {
      if (latency < CONFIG.simpleTaskLatencyThreshold) {
        return {
          name: 'latency',
          score: 1.0,
          weight: 0.1,
          reason: 'Good response time for simple task',
        };
      } else {
        return {
          name: 'latency',
          score: 0.7,
          weight: 0.1,
          reason: 'Slow for a simple task',
        };
      }
    }
    
    // Complex tasks: latency is less important
    return {
      name: 'latency',
      score: 0.9,
      weight: 0.05,
      reason: `Complex task completed in ${(latency / 1000).toFixed(1)}s`,
    };
  }
  
  private assessTokenEfficiency(input: QualityAssessmentInput): QualityFactor {
    const { input: inputTokens, output: outputTokens } = input.tokens;
    const outputLength = input.output.length;
    
    // Approximate chars per token (typically ~4)
    const expectedTokens = outputLength / 4;
    const efficiency = expectedTokens / Math.max(outputTokens, 1);
    
    // Good efficiency is close to 1.0
    let score: number;
    if (efficiency >= 0.8 && efficiency <= 1.2) {
      score = 1.0;
    } else if (efficiency < 0.8) {
      score = 0.6 + efficiency * 0.5;
    } else {
      score = Math.max(0.7, 1.0 - (efficiency - 1.2) * 0.2);
    }
    
    return {
      name: 'token_efficiency',
      score,
      weight: 0.1,
      reason: `Token efficiency: ${efficiency.toFixed(2)}`,
    };
  }
}

// --- Singleton ---

let defaultAssessor: QualityAssessor | null = null;

export function getQualityAssessor(): QualityAssessor {
  if (!defaultAssessor) {
    defaultAssessor = new QualityAssessor();
  }
  return defaultAssessor;
}
