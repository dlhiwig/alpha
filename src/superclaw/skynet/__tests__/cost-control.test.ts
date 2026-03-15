// @ts-nocheck
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CostController } from '../cost-control'

describe('CostController', () => {
  let controller: CostController

  beforeEach(() => {
    controller = new CostController({
      dailyLimit: 50,
      perAgentLimit: 5,
      warningThreshold: 0.8,
      pauseOnLimit: true
    })
  })

  describe('checkBudget', () => {
    it('should allow operations within budget', async () => {
      const result = await controller.checkBudget('agent-1', 'claude-sonnet-4-20250514', { input: 100000, output: 50000 })
      
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(5)  // Per-agent limit
    })

    it('should reject when daily limit exceeded', async () => {
      // Spend most of daily budget
      controller.recordCost({
        agentId: 'agent-1',
        model: 'claude-sonnet-4-20250514',
        inputTokens: 1000000,
        outputTokens: 1000000,
        costUSD: 49
      })
      
      const result = await controller.checkBudget('agent-2', 'claude-sonnet-4-20250514', { input: 1000000, output: 1000000 })
      
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('Daily limit')
    })

    it('should reject when agent limit exceeded', async () => {
      controller.recordCost({
        agentId: 'agent-1',
        model: 'claude-sonnet-4-20250514',
        inputTokens: 100000,
        outputTokens: 100000,
        costUSD: 4.5
      })
      
      const result = await controller.checkBudget('agent-1', 'claude-sonnet-4-20250514', { input: 500000, output: 500000 })
      
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('agent-1 limit')
    })

    it('should emit warning at threshold', async () => {
      const warningHandler = vi.fn()
      controller.on('warning', warningHandler)
      
      // Record costs for multiple agents to approach daily warning threshold
      controller.recordCost({
        agentId: 'agent-1',
        model: 'claude-sonnet-4-20250514',
        inputTokens: 100000,
        outputTokens: 100000,
        costUSD: 4  // Close to agent limit but not over
      })
      
      // Add costs from other agents to approach 80% of daily limit ($40)
      for (let i = 2; i <= 9; i++) {
        controller.recordCost({
          agentId: `agent-${i}`,
          model: 'claude-sonnet-4-20250514',
          inputTokens: 100000,
          outputTokens: 100000,
          costUSD: 4  // 8 agents × $4 = $32, total so far: $36
        })
      }
      
      // This call should push total over 80% threshold: $36 + estimated ~$2 = ~$38 > $40 threshold
      // Use agent-10 to avoid per-agent limit issues
      await controller.checkBudget('agent-10', 'claude-sonnet-4-20250514', { input: 200000, output: 200000 })
      
      expect(warningHandler).toHaveBeenCalled()
    })

    it('should pause when pauseOnLimit is true', async () => {
      controller.recordCost({
        agentId: 'agent-1',
        model: 'claude-opus-4-20250514',
        inputTokens: 1000000,
        outputTokens: 1000000,
        costUSD: 51  // Exceed limit
      })
      
      const result = await controller.checkBudget('agent-2', 'claude-sonnet-4-20250514', { input: 100000, output: 100000 })
      
      expect(result.allowed).toBe(false)
      expect(controller.getStatus().paused).toBe(true)
    })
  })

  describe('recordCost', () => {
    it('should track costs by agent', () => {
      controller.recordCost({
        agentId: 'agent-1',
        model: 'claude-sonnet-4-20250514',
        inputTokens: 1000,
        outputTokens: 1000,
        costUSD: 1
      })
      
      const status = controller.getStatus()
      expect(status.topAgents[0]).toEqual({ agentId: 'agent-1', spent: 1, percentage: 20 })
    })

    it('should track costs by model', () => {
      controller.recordCost({
        agentId: 'agent-1',
        model: 'claude-opus-4-20250514',
        inputTokens: 1000,
        outputTokens: 1000,
        costUSD: 2
      })
      
      const status = controller.getStatus()
      expect(status.topModels[0]).toEqual({ model: 'claude-opus-4-20250514', spent: 2, percentage: 100 })
    })

    it('should emit cost-recorded event', () => {
      const handler = vi.fn()
      controller.on('cost-recorded', handler)
      
      controller.recordCost({
        agentId: 'agent-1',
        model: 'claude-sonnet-4-20250514',
        inputTokens: 1000,
        outputTokens: 1000,
        costUSD: 1
      })
      
      expect(handler).toHaveBeenCalled()
    })
  })

  describe('estimateCost', () => {
    it('should estimate Opus costs correctly', () => {
      const cost = controller.estimateCost('claude-opus-4-20250514', 1000000, 500000)
      expect(cost).toBeCloseTo((15 + 37.5) * 1.1)  // (15 input + 37.5 output) * 1.1 buffer
    })

    it('should estimate Sonnet costs correctly', () => {
      const cost = controller.estimateCost('claude-sonnet-4-20250514', 1000000, 1000000)
      expect(cost).toBeCloseTo((3 + 15) * 1.1)  // (3 input + 15 output) * 1.1 buffer
    })

    it('should default to Sonnet for unknown models', () => {
      const cost = controller.estimateCost('unknown-model', 1000000, 1000000)
      expect(cost).toBeCloseTo(18 * 1.1)  // Sonnet rates * 1.1 buffer
    })
  })

  describe('getStatus', () => {
    it('should return accurate status', () => {
      controller.recordCost({
        agentId: 'agent-1',
        model: 'claude-sonnet-4-20250514',
        inputTokens: 1000,
        outputTokens: 1000,
        costUSD: 10
      })
      
      const status = controller.getStatus()
      
      expect(status.spent).toBe(10)
      expect(status.remaining).toBe(40)
      expect(status.percentage).toBe(20)
      expect(status.paused).toBe(false)
    })
  })

  describe('resetDaily', () => {
    it('should reset all counters', () => {
      controller.recordCost({
        agentId: 'agent-1',
        model: 'claude-sonnet-4-20250514',
        inputTokens: 1000,
        outputTokens: 1000,
        costUSD: 10
      })
      
      controller.resetDaily()
      
      const status = controller.getStatus()
      expect(status.spent).toBe(0)
      expect(status.paused).toBe(false)
    })
  })

  describe('resume', () => {
    it('should unpause controller', async () => {
      controller.recordCost({
        agentId: 'agent-1',
        model: 'claude-sonnet-4-20250514',
        inputTokens: 1000,
        outputTokens: 1000,
        costUSD: 51
      })
      
      await controller.checkBudget('agent-1', 'claude-sonnet-4-20250514', { input: 100000, output: 100000 })  // Will pause
      expect(controller.getStatus().paused).toBe(true)
      
      controller.resume('test-resume', 'test-admin')
      expect(controller.getStatus().paused).toBe(false)
    })
  })
})