// @ts-nocheck
import { describe, it, expect } from 'vitest'
import { NegotiationEngine } from '../NegotiationEngine'
import type { AgentEvaluation } from '../types'

describe('NegotiationEngine', () => {
  let engine: NegotiationEngine

  beforeEach(() => {
    engine = new NegotiationEngine({
      convergenceThreshold: 0.1,
      maxRounds: 8
    })
  })

  const createEvaluation = (score: number, personality: string = 'balanced'): AgentEvaluation => ({
    agentId: `agent-${personality}`,
    personality: personality as any,
    score,
    confidence: 80,
    reasoning: 'Test reasoning',
    concerns: [],
    recommendations: [],
    timestamp: new Date(),
    round: 0
  })

  describe('hasConverged', () => {
    it('should return true for similar scores', () => {
      const evaluations = [
        createEvaluation(80),
        createEvaluation(82),
        createEvaluation(79),
        createEvaluation(81)
      ]
      
      expect(engine.hasConverged(evaluations)).toBe(true)
    })

    it('should return false for divergent scores', () => {
      const evaluations = [
        createEvaluation(90),
        createEvaluation(50),
        createEvaluation(70),
        createEvaluation(30)
      ]
      
      expect(engine.hasConverged(evaluations)).toBe(false)
    })

    it('should return true for single evaluation', () => {
      expect(engine.hasConverged([createEvaluation(80)])).toBe(true)
    })

    it('should return true for empty array', () => {
      expect(engine.hasConverged([])).toBe(true)
    })
  })

  describe('calculateWeightedConsensus', () => {
    it('should weight by confidence', () => {
      const evaluations = [
        { ...createEvaluation(100), confidence: 100 },  // High confidence
        { ...createEvaluation(0), confidence: 0 }       // No confidence
      ]
      
      const consensus = engine.calculateWeightedConsensus(evaluations)
      expect(consensus).toBe(100)  // Only high confidence counts
    })

    it('should average equal confidences', () => {
      const evaluations = [
        { ...createEvaluation(80), confidence: 80 },
        { ...createEvaluation(60), confidence: 80 }
      ]
      
      const consensus = engine.calculateWeightedConsensus(evaluations)
      expect(consensus).toBe(70)
    })
  })

  describe('identifyOutliers', () => {
    it('should identify outlier scores', () => {
      const evaluations = [
        createEvaluation(50),
        createEvaluation(50),
        createEvaluation(50),
        createEvaluation(50),
        createEvaluation(50),
        createEvaluation(0)  // Much more extreme with consistent other values
      ]
      
      const outliers = engine.identifyOutliers(evaluations)
      expect(outliers.length).toBe(1)
      expect(outliers[0].score).toBe(0)
    })

    it('should return empty for no outliers', () => {
      const evaluations = [
        createEvaluation(80),
        createEvaluation(82),
        createEvaluation(79)
      ]
      
      expect(engine.identifyOutliers(evaluations)).toHaveLength(0)
    })
  })

  describe('aggregateConcerns', () => {
    it('should deduplicate and count concerns', () => {
      const evaluations = [
        { ...createEvaluation(80), concerns: ['security risk', 'performance'] },
        { ...createEvaluation(75), concerns: ['Security Risk', 'maintainability'] },
        { ...createEvaluation(82), concerns: ['security risk'] }
      ]
      
      const concerns = engine.aggregateConcerns(evaluations)
      expect(concerns[0]).toBe('security risk')  // Most common
    })
  })

  describe('calculateConvergenceMetrics', () => {
    it('should calculate metrics correctly', () => {
      const evaluations = [
        createEvaluation(80),
        createEvaluation(70),
        createEvaluation(90)
      ]
      
      const metrics = engine.calculateConvergenceMetrics(evaluations)
      
      expect(metrics.meanScore).toBe(80)
      expect(metrics.scoreRange).toEqual([70, 90])
      expect(metrics.standardDeviation).toBeGreaterThan(0)
    })
  })

  describe('synthesizeReasoning', () => {
    it('should group agreeing and dissenting views', () => {
      const evaluations = [
        { ...createEvaluation(85), personality: 'security-focus' as any },
        { ...createEvaluation(82), personality: 'performance-focus' as any },
        { ...createEvaluation(50), personality: 'stubborn' as any }
      ]
      
      const synthesis = engine.synthesizeReasoning(evaluations)
      
      expect(synthesis).toContain('Consensus View')
      expect(synthesis).toContain('Dissenting Views')
    })
  })
})