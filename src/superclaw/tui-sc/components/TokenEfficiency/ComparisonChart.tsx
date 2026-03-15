import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
// @ts-expect-error - Post-Merge Reconciliation
import { tokenTracker, ComparisonData } from '../../dashboard/token-efficiency'

export const ComparisonChart: React.FC = () => {
  const [data, setData] = useState<ComparisonData[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadData = async () => {
      try {
        const comparisonData = tokenTracker.getComparisonData(7) // Last 7 days
        setData(comparisonData)
      } catch (error) {
        console.error('Error loading comparison data:', error)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [])

  const formatNumber = (num: number): string => {
    if (num >= 1000000) {return `${(num / 1000000).toFixed(1)}M`}
    if (num >= 1000) {return `${(num / 1000).toFixed(1)}K`}
    return num.toFixed(0)
  }

  const renderMiniChart = (values: number[], width: number = 40, height: number = 10): string[] => {
    if (values.length === 0) {return Array(height).fill(' '.repeat(width))}
    
    const max = Math.max(...values)
    const min = Math.min(...values)
    const range = max - min || 1
    
    const chart: string[] = []
    const bars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
    
    // Create each row of the chart
    for (let y = height - 1; y >= 0; y--) {
      let row = ''
      for (let x = 0; x < Math.min(values.length, width); x++) {
        const value = values[x]
        const normalized = (value - min) / range
        const barHeight = normalized * height
        
        if (barHeight >= y && barHeight < y + 1) {
          const barIndex = Math.floor((barHeight - y) * bars.length)
          row += bars[Math.min(barIndex, bars.length - 1)]
        } else if (barHeight > y) {
          row += bars[bars.length - 1]
        } else {
          row += ' '
        }
      }
      while (row.length < width) {row += ' '}
      chart.push(row)
    }
    
    return chart
  }

  const getColorForSavings = (savings: number): string => {
    if (savings > 1000) {return 'green'}
    if (savings > 0) {return 'yellow'}
    return 'red'
  }

  if (loading) {
    return (
      <Box borderStyle="round" paddingX={2} paddingY={1}>
        <Text color="yellow">Loading comparison chart...</Text>
      </Box>
    )
  }

  // Group data by day and aggregate
  const dailyData = data.reduce((acc, item) => {
    const day = item.timestamp.toISOString().split('T')[0]
    if (!acc[day]) {
      acc[day] = {
        date: day,
        codeagentTotal: 0,
        traditionalTotal: 0,
        totalSavings: 0
      }
    }
    acc[day].codeagentTotal += item.codeagentTokens
    acc[day].traditionalTotal += item.traditionalTokens
    acc[day].totalSavings += item.savings
    return acc
  }, {} as Record<string, any>)

  const sortedDays = Object.values(dailyData).toSorted((a: any, b: any) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  )

  const savingsValues = sortedDays.map((day: any) => day.totalSavings)
  const efficiencyValues = sortedDays.map((day: any) => 
    day.traditionalTotal > 0 ? (day.codeagentTotal / day.traditionalTotal) * 100 : 100
  )

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={2} paddingY={1}>
      <Text color="white" bold>
        📈 7-Day Token Efficiency Comparison
      </Text>
      
      {sortedDays.length === 0 ? (
        <Box marginTop={1}>
          <Text color="gray">No comparison data available for the last 7 days</Text>
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column">
          {/* Savings Chart */}
          <Box marginBottom={1}>
            <Text color="green" bold>Token Savings (CodeAgent vs Traditional):</Text>
            <Box marginTop={1} flexDirection="column">
              {renderMiniChart(savingsValues, 50, 6).map((row, idx) => (
                <Text key={idx} color="green">{row}</Text>
              ))}
            </Box>
            <Box marginTop={1}>
              <Text color="gray" dimColor>
                Min: {formatNumber(Math.min(...savingsValues))} | 
                Max: {formatNumber(Math.max(...savingsValues))} | 
                Avg: {formatNumber(savingsValues.reduce((a, b) => a + b, 0) / savingsValues.length)}
              </Text>
            </Box>
          </Box>

          {/* Efficiency Chart */}
          <Box marginBottom={1}>
            <Text color="cyan" bold>Efficiency Percentage (Lower is Better):</Text>
            <Box marginTop={1} flexDirection="column">
              {renderMiniChart(efficiencyValues, 50, 6).map((row, idx) => (
                <Text key={idx} color="cyan">{row}</Text>
              ))}
            </Box>
            <Box marginTop={1}>
              <Text color="gray" dimColor>
                Best: {Math.min(...efficiencyValues).toFixed(1)}% | 
                Worst: {Math.max(...efficiencyValues).toFixed(1)}% | 
                Avg: {(efficiencyValues.reduce((a, b) => a + b, 0) / efficiencyValues.length).toFixed(1)}%
              </Text>
            </Box>
          </Box>

          {/* Recent Performance */}
          <Box paddingTop={1} borderStyle="single" borderColor="gray">
            <Box flexDirection="column">
              <Text color="white" bold>Recent Performance:</Text>
              {sortedDays.slice(-3).map((day: any, idx) => {
                const efficiency = day.traditionalTotal > 0 
                  ? (day.codeagentTotal / day.traditionalTotal) * 100 
                  : 100
                  
                return (
                  <Box key={idx} marginLeft={2}>
                    <Text color="gray">
                      {new Date(day.date).toLocaleDateString()}: 
                    </Text>
                    <Text color={getColorForSavings(day.totalSavings)} bold>
                      {' '}{formatNumber(day.totalSavings)} tokens saved
                    </Text>
                    <Text color="gray">
                      {' '}({efficiency.toFixed(1)}% efficiency)
                    </Text>
                  </Box>
                )
              })}
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  )
}