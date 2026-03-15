/**
 * @fileoverview Example usage of ConsensusJudge
 * @description Demonstrates how to use the multi-LLM consensus decision making system
 */

import { ConsensusJudge } from './ConsensusJudge'
import type { TaskResult } from './types'

// Example usage of the ConsensusJudge
async function example() {
  // Create a consensus judge with custom configuration
  const judge = new ConsensusJudge({
    minAgents: 3,
    maxRounds: 5,
    convergenceThreshold: 0.15, // Allow slightly more variance
    approvalThreshold: 75,      // Require 75% score for approval
    personalityMix: [
      { provider: 'claude-sonnet', personality: 'security-focus', weight: 1.2 },
      { provider: 'claude-sonnet', personality: 'performance-focus', weight: 1.0 },
      { provider: 'claude-sonnet', personality: 'code-quality-focus', weight: 1.0 },
      { provider: 'claude-sonnet', personality: 'stubborn', weight: 0.8 }
    ]
  })

  // Mock task results to evaluate
  const taskResults: TaskResult[] = [
    {
      taskId: 'implement-auth',
      agentId: 'coder-agent-1',
      output: `
// Authentication middleware implementation
import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'

export async function authenticateUser(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) {
    return res.status(401).json({ error: 'No token provided' })
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.user = decoded
    next()
  } catch (error: unknown) {
    return res.status(401).json({ error: 'Invalid token' })
  }
}

export async function hashPassword(password) {
  return await bcrypt.hash(password, 12)
}
      `,
      artifacts: ['src/auth/middleware.ts'],
      metadata: { 
        linesOfCode: 25,
        completionTime: '2.3s',
        model: 'claude-sonnet'
      }
    }
  ]

  // Run consensus evaluation
  console.log('🤖 Starting multi-LLM consensus evaluation...\n')
  
  try {
    const decision = await judge.judgeTaskCompletion('implement-auth', taskResults)
    
    console.log('📊 CONSENSUS DECISION')
    console.log('='.repeat(50))
    console.log(`Final Score: ${decision.decision.score}/100`)
    console.log(`Approved: ${decision.decision.approved ? '✅ YES' : '❌ NO'}`)
    console.log(`Confidence: ${decision.confidence}%`)
    console.log(`Rounds: ${decision.rounds}`)
    console.log(`Convergence: ${decision.convergenceReached ? '✅' : '❌'}`)
    console.log(`\nReasoning: ${decision.reasoning}`)
    
    if (decision.decision.concerns.length > 0) {
      console.log(`\n🔴 Key Concerns:`)
      decision.decision.concerns.forEach(concern => console.log(`  • ${concern}`))
    }
    
    if (decision.decision.recommendations.length > 0) {
      console.log(`\n🔵 Recommendations:`)
      decision.decision.recommendations.forEach(rec => console.log(`  • ${rec}`))
    }
    
    console.log(`\n📈 Convergence Metrics:`)
    console.log(`  Mean Score: ${decision.convergenceMetrics.meanScore.toFixed(1)}`)
    console.log(`  Std Deviation: ${decision.convergenceMetrics.standardDeviation.toFixed(2)}`)
    console.log(`  Score Range: ${decision.convergenceMetrics.scoreRange[0]}-${decision.convergenceMetrics.scoreRange[1]}`)
    
    console.log(`\n🤖 Individual Agent Evaluations:`)
    decision.evaluations.forEach(evaluation => {
      console.log(`  ${evaluation.personality}: ${evaluation.score}/100 (${evaluation.confidence}% confidence)`)
    })
    
  } catch (error: unknown) {
    console.error('❌ Consensus evaluation failed:', error)
  }
}

// Run the example
if (require.main === module) {
  example().catch(console.error)
}

export { example }