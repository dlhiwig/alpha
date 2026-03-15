import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import { EfficiencyOverview } from './EfficiencyOverview'
import { CategoryBreakdown } from './CategoryBreakdown'
import { RealtimeMetrics } from './RealtimeMetrics'
import { ComparisonChart } from './ComparisonChart'
// @ts-expect-error - Post-Merge Reconciliation
import { tokenTracker, EfficiencyMetrics } from '../../dashboard/token-efficiency'

interface TokenEfficiencyProps {
  refreshInterval?: number
}

export const TokenEfficiency: React.FC<TokenEfficiencyProps> = ({ 
  refreshInterval = 5000 
}) => {
  const [metrics, setMetrics] = useState<EfficiencyMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date())

  useEffect(() => {
    const updateMetrics = async () => {
      try {
        const newMetrics = tokenTracker.getMetrics()
        setMetrics(newMetrics)
        setLastUpdate(new Date())
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    // Initial load
    updateMetrics()

    // Set up interval for updates
    const interval = setInterval(updateMetrics, refreshInterval)

    // Listen for real-time updates
    const handleUsageRecorded = () => {
      updateMetrics()
    }
    
    tokenTracker.on('usage-recorded', handleUsageRecorded)

    return () => {
      clearInterval(interval)
      tokenTracker.off('usage-recorded', handleUsageRecorded)
    }
  }, [refreshInterval])

  if (loading) {
    return (
      <Box flexDirection="column" alignItems="center" justifyContent="center" minHeight={10}>
        <Text color="yellow">Loading token efficiency metrics...</Text>
      </Box>
    )
  }

  if (error) {
    return (
      <Box flexDirection="column" alignItems="center" justifyContent="center" minHeight={10}>
        <Text color="red">Error loading metrics: {error}</Text>
      </Box>
    )
  }

  if (!metrics) {
    return (
      <Box flexDirection="column" alignItems="center" justifyContent="center" minHeight={10}>
        <Text color="gray">No metrics data available</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          🎯 SuperClaw Token Efficiency Dashboard
        </Text>
        <Box marginLeft={2}>
          <Text color="gray" dimColor>
            Last updated: {lastUpdate.toLocaleTimeString()}
          </Text>
        </Box>
      </Box>

      {/* Top Row: Overview + Real-time */}
      <Box marginBottom={2}>
        <Box flexGrow={1} marginRight={2}>
          <EfficiencyOverview metrics={metrics} />
        </Box>
        <Box width={40}>
          <RealtimeMetrics realtime={metrics.realtime} />
        </Box>
      </Box>

      {/* Middle Row: Category Breakdown */}
      <Box marginBottom={2}>
        <CategoryBreakdown categories={metrics.byCategory} />
      </Box>

      {/* Bottom Row: Comparison Chart */}
      <Box>
        <ComparisonChart />
      </Box>
    </Box>
  )
}