import React from 'react'
import { Box, Text } from 'ink'
// @ts-expect-error - Post-Merge Reconciliation
import { EfficiencyMetrics } from '../../dashboard/token-efficiency'

interface EfficiencyOverviewProps {
  metrics: EfficiencyMetrics
}

export const EfficiencyOverview: React.FC<EfficiencyOverviewProps> = ({ metrics }) => {
  const formatNumber = (num: number): string => {
    if (num >= 1000000) {return `${(num / 1000000).toFixed(1)}M`}
    if (num >= 1000) {return `${(num / 1000).toFixed(1)}K`}
    return num.toFixed(0)
  }

  const formatCurrency = (amount: number): string => {
    return `$${amount.toFixed(2)}`
  }

  const formatRatio = (ratio: number): string => {
    return `${(ratio * 100).toFixed(1)}%`
  }

  const getEfficiencyColor = (ratio: number): string => {
    if (ratio < 0.5) {return 'green'}  // CodeAgent uses < 50% of traditional tokens
    if (ratio < 0.8) {return 'yellow'} // CodeAgent uses < 80% of traditional tokens
    return 'red' // CodeAgent uses >= 80% of traditional tokens
  }

  const getEfficiencyLabel = (ratio: number): string => {
    if (ratio < 0.5) {return 'Excellent'}
    if (ratio < 0.8) {return 'Good'}
    return 'Needs Improvement'
  }

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={2} paddingY={1}>
      <Text color="white" bold>
        📊 Efficiency Overview
      </Text>
      
      {/* Today's Stats */}
      <Box marginTop={1} marginBottom={1}>
        <Text color="cyan" bold>Today:</Text>
        <Box marginLeft={2} flexDirection="column">
          <Box>
            <Text color="green">Tokens Saved: </Text>
            <Text color="white" bold>{formatNumber(metrics.today.tokensSaved)}</Text>
          </Box>
          <Box>
            <Text color="green">Cost Saved: </Text>
            <Text color="white" bold>{formatCurrency(metrics.today.costSaved)}</Text>
          </Box>
          <Box>
            <Text color="white">Efficiency: </Text>
            <Text color={getEfficiencyColor(metrics.today.efficiencyRatio)} bold>
              {formatRatio(metrics.today.efficiencyRatio)} ({getEfficiencyLabel(metrics.today.efficiencyRatio)})
            </Text>
          </Box>
        </Box>
      </Box>

      {/* Week's Stats */}
      <Box marginBottom={1}>
        <Text color="magenta" bold>This Week:</Text>
        <Box marginLeft={2} flexDirection="column">
          <Box>
            <Text color="green">Tokens Saved: </Text>
            <Text color="white" bold>{formatNumber(metrics.week.tokensSaved)}</Text>
          </Box>
          <Box>
            <Text color="green">Cost Saved: </Text>
            <Text color="white" bold>{formatCurrency(metrics.week.costSaved)}</Text>
          </Box>
          <Box>
            <Text color="white">Efficiency: </Text>
            <Text color={getEfficiencyColor(metrics.week.efficiencyRatio)} bold>
              {formatRatio(metrics.week.efficiencyRatio)} ({getEfficiencyLabel(metrics.week.efficiencyRatio)})
            </Text>
          </Box>
        </Box>
      </Box>

      {/* Month's Stats */}
      <Box>
        <Text color="blue" bold>This Month:</Text>
        <Box marginLeft={2} flexDirection="column">
          <Box>
            <Text color="green">Tokens Saved: </Text>
            <Text color="white" bold>{formatNumber(metrics.month.tokensSaved)}</Text>
          </Box>
          <Box>
            <Text color="green">Cost Saved: </Text>
            <Text color="white" bold>{formatCurrency(metrics.month.costSaved)}</Text>
          </Box>
          <Box>
            <Text color="white">Efficiency: </Text>
            <Text color={getEfficiencyColor(metrics.month.efficiencyRatio)} bold>
              {formatRatio(metrics.month.efficiencyRatio)} ({getEfficiencyLabel(metrics.month.efficiencyRatio)})
            </Text>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}