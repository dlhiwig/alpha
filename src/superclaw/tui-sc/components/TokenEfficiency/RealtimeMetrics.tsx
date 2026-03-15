import React from 'react'
import { Box, Text } from 'ink'
// @ts-expect-error - Post-Merge Reconciliation
import { EfficiencyMetrics } from '../../dashboard/token-efficiency'

interface RealtimeMetricsProps {
  realtime: EfficiencyMetrics['realtime']
}

export const RealtimeMetrics: React.FC<RealtimeMetricsProps> = ({ realtime }) => {
  const formatNumber = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
    return num.toFixed(0)
  }

  const formatCurrency = (amount: number): string => {
    return `$${amount.toFixed(3)}`
  }

  const getActivityColor = (agents: number): string => {
    if (agents === 0) return 'red'
    if (agents < 10) return 'yellow'
    if (agents < 25) return 'green'
    return 'cyan'
  }

  const getActivityStatus = (agents: number): string => {
    if (agents === 0) return 'Idle'
    if (agents < 10) return 'Light'
    if (agents < 25) return 'Active'
    return 'Heavy Load'
  }

  const getThroughputColor = (tokensPerMin: number): string => {
    if (tokensPerMin < 100) return 'red'
    if (tokensPerMin < 500) return 'yellow'
    if (tokensPerMin < 2000) return 'green'
    return 'cyan'
  }

  const getEfficiencyColor = (efficiency: number): string => {
    if (efficiency < 0.5) return 'green'
    if (efficiency < 0.8) return 'yellow'
    return 'red'
  }

  const renderSparkline = (value: number, max: number, width: number = 20): string => {
    const bars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
    const percentage = Math.min(value / max, 1)
    const filled = Math.floor(percentage * width)
    const remainder = (percentage * width) % 1
    
    let sparkline = ''
    for (let i = 0; i < filled; i++) {
      sparkline += bars[bars.length - 1]
    }
    if (filled < width && remainder > 0) {
      sparkline += bars[Math.floor(remainder * bars.length)]
    }
    while (sparkline.length < width) {
      sparkline += bars[0]
    }
    
    return sparkline
  }

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={2} paddingY={1}>
      <Text color="white" bold>
        ⚡ Real-time Metrics
      </Text>
      
      {/* Active Agents */}
      <Box marginTop={1} marginBottom={1}>
        <Box flexDirection="column">
          <Box>
            <Text color="white">Active Agents: </Text>
            <Text color={getActivityColor(realtime.activeAgents)} bold>
              {realtime.activeAgents}
            </Text>
            <Text color="gray" dimColor> ({getActivityStatus(realtime.activeAgents)})</Text>
          </Box>
          <Box>
            <Text color="gray" dimColor>
              {renderSparkline(realtime.activeAgents, 75)}
            </Text>
          </Box>
        </Box>
      </Box>

      {/* Token Throughput */}
      <Box marginBottom={1}>
        <Box flexDirection="column">
          <Box>
            <Text color="white">Tokens/min: </Text>
            <Text color={getThroughputColor(realtime.tokensPerMinute)} bold>
              {formatNumber(realtime.tokensPerMinute)}
            </Text>
          </Box>
          <Box>
            <Text color="gray" dimColor>
              {renderSparkline(realtime.tokensPerMinute, 10000)}
            </Text>
          </Box>
        </Box>
      </Box>

      {/* Cost per minute */}
      <Box marginBottom={1}>
        <Box flexDirection="column">
          <Box>
            <Text color="white">Cost/min: </Text>
            <Text color="yellow" bold>
              {formatCurrency(realtime.costPerMinute)}
            </Text>
          </Box>
          <Box>
            <Text color="gray" dimColor>
              {renderSparkline(realtime.costPerMinute, 1)}
            </Text>
          </Box>
        </Box>
      </Box>

      {/* Current Efficiency */}
      <Box>
        <Box flexDirection="column">
          <Box>
            <Text color="white">Efficiency: </Text>
            <Text color={getEfficiencyColor(realtime.currentEfficiency)} bold>
              {(realtime.currentEfficiency * 100).toFixed(1)}%
            </Text>
          </Box>
          <Box>
            <Text color="gray" dimColor>
              {renderSparkline(1 - realtime.currentEfficiency, 1)} {/* Inverted for efficiency */}
            </Text>
          </Box>
        </Box>
      </Box>

      {/* Status indicator */}
      <Box marginTop={1} paddingTop={1} borderStyle="single" borderColor="gray">
        <Text color="gray" dimColor>
          🔄 Updating every 5s
        </Text>
      </Box>
    </Box>
  )
}