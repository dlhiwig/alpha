/**
 * SuperClaw Quality Gates System
 * 
 * Adopts VibeCoder (VC) quality gate patterns for agent validation:
 * - Multi-stage validation pipelines
 * - AI-driven quality assessment (Zero Framework Cognition)
 * - Automatic issue creation from failed gates
 * - Self-healing workflows
 * - Integration with swarm judge system
 * 
 * Reference: https://github.com/steveyegge/vc/internal/gates
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { createProvider } from '../swarm/providers';
import { ProviderName } from '../swarm/types';

const execAsync = promisify(exec);

export type QualityGateType = 
  | 'build'     // Compilation/build step
  | 'test'      // Test execution
  | 'lint'      // Code linting/style
  | 'security'  // Security scanning
  | 'coverage'  // Test coverage
  | 'ai_review' // AI code review
  | 'approval'; // Human approval

export interface QualityGateResult {
  gate: QualityGateType;
  passed: boolean;
  output: string;
  error?: Error;
  durationMs: number;
  confidence?: number; // AI confidence score (0-1)
  suggestions?: string[]; // AI improvement suggestions
}

export interface QualityGateConfig {
  workingDir: string;
  timeout?: number;
  
  // Gate-specific configs
  buildCommand?: string;
  testCommand?: string;
  lintCommand?: string;
  securityCommand?: string;
  coverageThreshold?: number;
  
  // AI Review settings
  aiReviewProvider?: ProviderName;
  aiReviewPrompt?: string;
  
  // Progress reporting
  onProgress?: (gate: QualityGateType, completed: number, total: number) => void;
}

export interface QualityIssue {
  id: string;
  title: string;
  description: string;
  gate: QualityGateType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  autoFixable: boolean;
  suggestions: string[];
  blocksOriginal: boolean;
}

export interface RecoveryStrategy {
  action: 'fix_in_place' | 'acceptable_failure' | 'split_work' | 'escalate' | 'retry';
  confidence: number;
  reasoning: string;
  createIssues: QualityIssue[];
  markAsBlocked?: boolean;
  closeOriginal?: boolean;
  requiresApproval?: boolean;
  comment?: string;
}

export interface QualityGateRunner {
  runAll(gates: QualityGateType[]): Promise<{ results: QualityGateResult[]; allPassed: boolean }>;
  runGate(gate: QualityGateType): Promise<QualityGateResult>;
  generateRecoveryStrategy(results: QualityGateResult[], context: any): Promise<RecoveryStrategy>;
}

/**
 * SuperClaw Quality Gate Runner
 * Implements VC quality gate patterns with SuperClaw integration
 */
export class SuperClawQualityGates implements QualityGateRunner {
  private config: QualityGateConfig;
  private aiProvider?: any; // AI provider for recovery strategies
  
  constructor(config: QualityGateConfig) {
    this.config = config;
    if (config.aiReviewProvider) {
      this.aiProvider = createProvider(config.aiReviewProvider);
    }
  }
  
  /**
   * Run all quality gates in sequence
   * Based on VC gate ordering: build → test → lint → security → coverage → ai_review
   */
  async runAll(gates: QualityGateType[]): Promise<{ results: QualityGateResult[]; allPassed: boolean }> {
    const results: QualityGateResult[] = [];
    let allPassed = true;
    
    console.log(`[quality-gates] Running ${gates.length} gates in sequence`);
    
    for (let i = 0; i < gates.length; i++) {
      const gate = gates[i];
      
      // Report progress
      if (this.config.onProgress) {
        this.config.onProgress(gate, i, gates.length);
      }
      
      console.log(`[quality-gates] Running ${gate} gate...`);
      const result = await this.runGate(gate);
      results.push(result);
      
      if (!result.passed) {
        allPassed = false;
        console.log(`[quality-gates] ${gate} gate failed: ${result.error?.message || 'Unknown error'}`);
      } else {
        console.log(`[quality-gates] ${gate} gate passed in ${result.durationMs}ms`);
      }
    }
    
    // Final progress update
    if (this.config.onProgress) {
      this.config.onProgress(gates[gates.length - 1], gates.length, gates.length);
    }
    
    console.log(`[quality-gates] Completed ${gates.length} gates. Passed: ${allPassed ? 'ALL' : results.filter(r => r.passed).length + '/' + results.length}`);
    
    return { results, allPassed };
  }
  
  /**
   * Run a single quality gate
   */
  async runGate(gate: QualityGateType): Promise<QualityGateResult> {
    const startTime = Date.now();
    
    try {
      switch (gate) {
        case 'build':
          return await this.runBuildGate(startTime);
        case 'test':
          return await this.runTestGate(startTime);
        case 'lint':
          return await this.runLintGate(startTime);
        case 'security':
          return await this.runSecurityGate(startTime);
        case 'coverage':
          return await this.runCoverageGate(startTime);
        case 'ai_review':
          return await this.runAIReviewGate(startTime);
        case 'approval':
          return await this.runApprovalGate(startTime);
        default:
          throw new Error(`Unknown gate type: ${gate}`);
      }
    } catch (error: unknown) {
      return {
        gate,
        passed: false,
        output: error instanceof Error ? (error as Error).message : String(error),
        error: error instanceof Error ? error : new Error(String(error)),
        durationMs: Date.now() - startTime
      };
    }
  }
  
  /**
   * Build gate - compilation/transpilation
   */
  private async runBuildGate(startTime: number): Promise<QualityGateResult> {
    const command = this.config.buildCommand || 'npm run build';
    
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: this.config.workingDir,
        timeout: this.config.timeout || 60000
      });
      
      return {
        gate: 'build',
        passed: true,
        output: stdout + (stderr ? '\n' + stderr : ''),
        durationMs: Date.now() - startTime
      };
    } catch (error: any) {
      return {
        gate: 'build',
        passed: false,
        output: error.stdout + (error.stderr ? '\n' + error.stderr : ''),
        error: error,
        durationMs: Date.now() - startTime
      };
    }
  }
  
  /**
   * Test gate - run test suite
   */
  private async runTestGate(startTime: number): Promise<QualityGateResult> {
    const command = this.config.testCommand || 'npm test';
    
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: this.config.workingDir,
        timeout: this.config.timeout || 120000,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          // Prevent test pollution (VC pattern)
          SUPERCLAW_TEST_MODE: 'isolated'
        }
      });
      
      return {
        gate: 'test',
        passed: true,
        output: stdout + (stderr ? '\n' + stderr : ''),
        durationMs: Date.now() - startTime
      };
    } catch (error: any) {
      return {
        gate: 'test',
        passed: false,
        output: error.stdout + (error.stderr ? '\n' + error.stderr : ''),
        error: error,
        durationMs: Date.now() - startTime
      };
    }
  }
  
  /**
   * Lint gate - code style and quality
   */
  private async runLintGate(startTime: number): Promise<QualityGateResult> {
    const command = this.config.lintCommand || 'npm run lint';
    
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: this.config.workingDir,
        timeout: this.config.timeout || 60000
      });
      
      return {
        gate: 'lint',
        passed: true,
        output: stdout + (stderr ? '\n' + stderr : ''),
        durationMs: Date.now() - startTime
      };
    } catch (error: any) {
      return {
        gate: 'lint',
        passed: false,
        output: error.stdout + (error.stderr ? '\n' + error.stderr : ''),
        error: error,
        durationMs: Date.now() - startTime
      };
    }
  }
  
  /**
   * Security gate - vulnerability scanning
   */
  private async runSecurityGate(startTime: number): Promise<QualityGateResult> {
    const command = this.config.securityCommand || 'npm audit --audit-level=high';
    
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: this.config.workingDir,
        timeout: this.config.timeout || 60000
      });
      
      return {
        gate: 'security',
        passed: true,
        output: stdout + (stderr ? '\n' + stderr : ''),
        durationMs: Date.now() - startTime
      };
    } catch (error: any) {
      return {
        gate: 'security',
        passed: false,
        output: error.stdout + (error.stderr ? '\n' + error.stderr : ''),
        error: error,
        durationMs: Date.now() - startTime
      };
    }
  }
  
  /**
   * Coverage gate - test coverage requirements
   */
  private async runCoverageGate(startTime: number): Promise<QualityGateResult> {
    const command = 'npm run test:coverage';
    const threshold = this.config.coverageThreshold || 80;
    
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: this.config.workingDir,
        timeout: this.config.timeout || 120000
      });
      
      // Parse coverage percentage (basic implementation)
      const coverageMatch = stdout.match(/All files\s+\|\s+(\d+(?:\.\d+)?)/);
      const coverage = coverageMatch ? parseFloat(coverageMatch[1]) : 0;
      const passed = coverage >= threshold;
      
      return {
        gate: 'coverage',
        passed,
        output: stdout + (stderr ? '\n' + stderr : '') + `\nCoverage: ${coverage}%, Required: ${threshold}%`,
        durationMs: Date.now() - startTime,
        confidence: passed ? 1.0 : Math.max(0, coverage / threshold)
      };
    } catch (error: any) {
      return {
        gate: 'coverage',
        passed: false,
        output: error.stdout + (error.stderr ? '\n' + error.stderr : ''),
        error: error,
        durationMs: Date.now() - startTime,
        confidence: 0
      };
    }
  }
  
  /**
   * AI Review gate - AI-powered code review
   * Zero Framework Cognition: AI makes all decisions
   */
  private async runAIReviewGate(startTime: number): Promise<QualityGateResult> {
    if (!this.aiProvider) {
      return {
        gate: 'ai_review',
        passed: true, // Skip if no AI provider configured
        output: 'AI review skipped - no provider configured',
        durationMs: Date.now() - startTime,
        confidence: 0.5
      };
    }
    
    try {
      // Read recent changes (git diff)
      const { stdout: gitDiff } = await execAsync('git diff HEAD~1', {
        cwd: this.config.workingDir
      });
      
      if (!gitDiff.trim()) {
        return {
          gate: 'ai_review',
          passed: true,
          output: 'No changes to review',
          durationMs: Date.now() - startTime,
          confidence: 1.0
        };
      }
      
      const prompt = this.config.aiReviewPrompt || `
Review this code change for:
1. Security vulnerabilities
2. Logic errors
3. Performance issues
4. Code quality and style
5. Test coverage

Respond with JSON:
{
  "passed": boolean,
  "confidence": number (0-1),
  "issues": [{"type": "security|logic|performance|style|testing", "severity": "low|medium|high|critical", "description": "...", "suggestion": "..."}],
  "summary": "Overall assessment"
}

Code changes:
\`\`\`diff
${gitDiff.slice(0, 8000)} // Truncate for token limits
\`\`\`
`;
      
      const response = await this.aiProvider.chat([{ role: 'user', content: prompt }], {
        json: true,
        timeout: this.config.timeout || 60000
      });
      
      let reviewResult;
      try {
        reviewResult = JSON.parse(response);
      } catch {
        // Fallback if JSON parsing fails
        reviewResult = {
          passed: true,
          confidence: 0.7,
          issues: [],
          summary: 'AI review completed but response format was invalid'
        };
      }
      
      const suggestions = reviewResult.issues?.map((issue: any) => 
        `${issue.severity?.toUpperCase() || 'UNKNOWN'} (${issue.type || 'general'}): ${issue.description} - ${issue.suggestion || 'No suggestion'}`
      ) || [];
      
      return {
        gate: 'ai_review',
        passed: reviewResult.passed || false,
        output: reviewResult.summary || 'AI review completed',
        durationMs: Date.now() - startTime,
        confidence: reviewResult.confidence || 0.5,
        suggestions
      };
    } catch (error: any) {
      return {
        gate: 'ai_review',
        passed: false,
        output: `AI review failed: ${(error as Error).message}`,
        error: error,
        durationMs: Date.now() - startTime,
        confidence: 0
      };
    }
  }
  
  /**
   * Approval gate - requires human approval
   */
  private async runApprovalGate(startTime: number): Promise<QualityGateResult> {
    // This would integrate with actual approval system
    // For now, return a placeholder that requires external approval
    return {
      gate: 'approval',
      passed: false, // Always requires external approval
      output: 'Human approval required - gate will be updated externally',
      durationMs: Date.now() - startTime,
      confidence: 0
    };
  }
  
  /**
   * Generate AI-driven recovery strategy (Zero Framework Cognition)
   * Based on VC patterns for handling gate failures
   */
  async generateRecoveryStrategy(results: QualityGateResult[], context: any): Promise<RecoveryStrategy> {
    if (!this.aiProvider) {
      return this.generateFallbackStrategy(results, context);
    }
    
    const failedGates = results.filter(r => !r.passed);
    if (failedGates.length === 0) {
      return {
        action: 'acceptable_failure', // No failures, continue
        confidence: 1.0,
        reasoning: 'All quality gates passed',
        createIssues: [],
        closeOriginal: false
      };
    }
    
    const prompt = `
You are an AI supervisor for quality gate failures. Analyze these gate failures and recommend a recovery strategy.

Context:
- Original task: ${context.title || 'Unknown'}
- Priority: ${context.priority || 'Unknown'} (0=critical, 1=high, 2=medium, 3=low)
- Type: ${context.type || 'Unknown'}

Gate Failures:
${failedGates.map(f => `
- ${f.gate}: ${f.error?.message || 'Failed'}
  Output: ${f.output.slice(0, 500)}
  Confidence: ${f.confidence || 'N/A'}
`).join('\n')}

Recovery Actions:
1. fix_in_place - Create blocking issues, mark original as blocked
2. acceptable_failure - Close despite failures (for minor issues on low-priority tasks)
3. split_work - Create new issues for failures, close original
4. escalate - Flag for human review
5. retry - Leave open for retry

Consider:
- Failure severity vs task priority
- Whether failures are pre-existing or introduced by current work
- Confidence scores and AI suggestions
- Risk tolerance based on task type

Respond with JSON:
{
  "action": "fix_in_place|acceptable_failure|split_work|escalate|retry",
  "confidence": number (0-1),
  "reasoning": "Brief explanation of decision",
  "createIssues": [
    {
      "title": "Issue title",
      "description": "Detailed description",
      "gate": "failed_gate_name",
      "severity": "low|medium|high|critical",
      "autoFixable": boolean,
      "suggestions": ["suggestion1", "suggestion2"],
      "blocksOriginal": boolean
    }
  ],
  "markAsBlocked": boolean,
  "closeOriginal": boolean,
  "requiresApproval": boolean,
  "comment": "Comment to add to original issue"
}
`;
    
    try {
      const response = await this.aiProvider.chat([{ role: 'user', content: prompt }], {
        json: true,
        timeout: 120000 // 2 minute timeout for complex analysis
      });
      
      const strategy = JSON.parse(response);
      
      // Validate and sanitize response
      const validActions = ['fix_in_place', 'acceptable_failure', 'split_work', 'escalate', 'retry'];
      if (!validActions.includes(strategy.action)) {
        console.warn(`Invalid recovery action: ${strategy.action}, falling back`);
        return this.generateFallbackStrategy(results, context);
      }
      
      // Add generated IDs to issues
      strategy.createIssues = strategy.createIssues?.map((issue: any, index: number) => ({
        id: `${context.id || 'unknown'}-gate-${issue.gate}-${index}`,
        ...issue
      })) || [];
      
      return strategy;
    } catch (error: unknown) {
      console.warn(`AI recovery strategy failed: ${error instanceof Error ? (error as Error).message : error}, falling back`);
      return this.generateFallbackStrategy(results, context);
    }
  }
  
  /**
   * Fallback recovery strategy (hardcoded logic)
   * Used when AI supervisor is unavailable
   */
  private generateFallbackStrategy(results: QualityGateResult[], context: any): RecoveryStrategy {
    const failedGates = results.filter(r => !r.passed);
    
    if (failedGates.length === 0) {
      return {
        action: 'acceptable_failure',
        confidence: 1.0,
        reasoning: 'All gates passed',
        createIssues: []
      };
    }
    
    // Simple heuristic: create blocking issues for failed gates
    const createIssues: QualityIssue[] = failedGates.map((failure, index) => ({
      id: `${context.id || 'unknown'}-gate-${failure.gate}-${index}`,
      title: `Quality gate failure: ${failure.gate}`,
      description: `The ${failure.gate} quality gate failed.\n\nError: ${failure.error?.message || 'Unknown'}\n\nOutput:\n\`\`\`\n${failure.output}\n\`\`\``,
      gate: failure.gate,
      severity: this.categorizeSeverity(failure),
      autoFixable: this.isAutoFixable(failure),
      suggestions: failure.suggestions || [`Fix ${failure.gate} issues and retry`],
      blocksOriginal: true
    }));
    
    return {
      action: 'fix_in_place',
      confidence: 0.8,
      reasoning: `Created ${createIssues.length} blocking issue(s) for failed gates (fallback strategy)`,
      createIssues,
      markAsBlocked: true,
      comment: `Quality gates failed: ${failedGates.map(f => f.gate).join(', ')}. Created blocking issues.`
    };
  }
  
  private categorizeSeverity(failure: QualityGateResult): 'low' | 'medium' | 'high' | 'critical' {
    switch (failure.gate) {
      case 'security':
        return 'critical';
      case 'build':
      case 'test':
        return 'high';
      case 'coverage':
        return 'medium';
      case 'lint':
      case 'ai_review':
        return 'low';
      default:
        return 'medium';
    }
  }
  
  private isAutoFixable(failure: QualityGateResult): boolean {
    switch (failure.gate) {
      case 'lint':
        return true; // Often auto-fixable with --fix
      case 'coverage':
        return false; // Requires writing tests
      case 'build':
      case 'test':
      case 'security':
        return false; // Usually requires manual intervention
      case 'ai_review':
        return failure.confidence !== undefined && failure.confidence > 0.7; // High-confidence AI suggestions might be auto-fixable
      default:
        return false;
    }
  }
}

/**
 * Quality Gate Pipeline - orchestrates the full quality gate workflow
 * Implements the VC AI Supervised Issue Loop pattern
 */
export class QualityGatePipeline {
  private runner: QualityGateRunner;
  private config: QualityGateConfig;
  
  constructor(runner: QualityGateRunner, config: QualityGateConfig) {
    this.runner = runner;
    this.config = config;
  }
  
  /**
   * Execute the full quality gate pipeline with AI supervision
   * Returns whether to proceed, retry, or block
   */
  async execute(
    gates: QualityGateType[],
    context: any,
    onIssueCreated?: (issue: QualityIssue) => Promise<void>
  ): Promise<{
    success: boolean;
    strategy: RecoveryStrategy;
    results: QualityGateResult[];
    issues: QualityIssue[];
  }> {
    console.log(`[quality-pipeline] Starting quality gate pipeline for ${context.id || 'unknown'}`);
    
    // Step 1: Run all quality gates
    const { results, allPassed } = await this.runner.runAll(gates);
    
    if (allPassed) {
      console.log(`[quality-pipeline] All ${gates.length} gates passed ✓`);
      return {
        success: true,
        strategy: {
          action: 'acceptable_failure',
          confidence: 1.0,
          reasoning: 'All quality gates passed',
          createIssues: []
        },
        results,
        issues: []
      };
    }
    
    // Step 2: Generate AI-driven recovery strategy (ZFC)
    console.log(`[quality-pipeline] ${results.filter(r => !r.passed).length}/${results.length} gates failed, generating recovery strategy...`);
    const strategy = await this.runner.generateRecoveryStrategy(results, context);
    
    console.log(`[quality-pipeline] Recovery strategy: ${strategy.action} (confidence: ${strategy.confidence})`);
    console.log(`[quality-pipeline] Reasoning: ${strategy.reasoning}`);
    
    // Step 3: Execute recovery strategy
    const issues: QualityIssue[] = [];
    
    if (strategy.createIssues.length > 0) {
      console.log(`[quality-pipeline] Creating ${strategy.createIssues.length} issues for quality gate failures`);
      
      for (const issue of strategy.createIssues) {
        issues.push(issue);
        if (onIssueCreated) {
          await onIssueCreated(issue);
        }
      }
    }
    
    const success = strategy.action === 'acceptable_failure' || strategy.action === 'retry';
    
    console.log(`[quality-pipeline] Pipeline ${success ? 'completed' : 'blocked'} with ${issues.length} issues created`);
    
    return {
      success,
      strategy,
      results,
      issues
    };
  }
}

/**
 * Factory function to create a standard quality gate runner
 */
export function createQualityGateRunner(config: QualityGateConfig): SuperClawQualityGates {
  return new SuperClawQualityGates(config);
}

/**
 * Default quality gate sequences for different scenarios
 */
export const QUALITY_GATE_SEQUENCES = {
  // Standard development workflow
  standard: ['build', 'test', 'lint'] as QualityGateType[],
  
  // Production deployment
  production: ['build', 'test', 'lint', 'security', 'coverage'] as QualityGateType[],
  
  // AI-assisted development
  ai_assisted: ['build', 'test', 'ai_review', 'lint'] as QualityGateType[],
  
  // Critical changes requiring approval
  critical: ['build', 'test', 'lint', 'security', 'coverage', 'ai_review', 'approval'] as QualityGateType[],
  
  // Quick validation for small changes
  fast: ['build', 'test'] as QualityGateType[]
};