import React from 'react'
import { Box, Text } from 'ink'
// @ts-expect-error - Post-Merge Reconciliation
import { EfficiencyMetrics } from '../../dashboard/token-efficiency'

interface CategoryBreakdownProps {
  categories: EfficiencyMetrics['byCategory']
}

export const CategoryBreakdown: React.FC<CategoryBreakdownProps> = ({ categories }) => {
  const formatNumber = (num: number): string => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
    return num.toFixed(0)
  }

  const formatCurrency = (amount: number): string => {
    return `$${amount.toFixed(3)}`
  }

  const getEfficiencyColor = (ratio: number): string => {
    if (ratio < 0.5) return 'green'
    if (ratio < 0.8) return 'yellow'
    return 'red'
  }

  const getEfficiencyIcon = (ratio: number): string => {
    if (ratio < 0.5) return '🟢'
    if (ratio < 0.8) return '🟡'
    return '🔴'
  }

  const getCategoryIcon = (category: string): string => {
    const icons: Record<string, string> = {
      browser: '🌐',
      filesystem: '📁',
      database: '🗄️',
      api: '🔌',
      communication: '💬',
      analysis: '📊',
      other: '⚙️'
    }
    return icons[category] || '⚙️'
  }

  const renderProgressBar = (value: number, max: number, width: number = 20): string => {
    const percentage = Math.min(value / max, 1)
    const filled = Math.floor(percentage * width)
    const bar = '█'.repeat(filled) + '░'.repeat(width - filled)
    return bar
  }

  const sortedCategories = Object.entries(categories).sort(([, a], [, b]) => {
    // @ts-expect-error - Post-Merge Reconciliation
    return a.efficiency - b.efficiency // Sort by efficiency (best first)
  })

  if (sortedCategories.length === 0) {
    return (
      <Box borderStyle="round" paddingX={2} paddingY={1}>
        <Text color="gray">No category data available</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={2} paddingY={1}>
      <Text color="white" bold>
        🏷️ Efficiency by Tool Category
      </Text>
      
      <Box marginTop={1} flexDirection="column">
        {/* Header */}
        <Box marginBottom={1}>
          <Box width={18}>
            <Text color="gray" bold>Category</Text>
          </Box>
          <Box width={12}>
            <Text color="gray" bold>CodeAgent</Text>
          </Box>
          <Box width={12}>
            <Text color="gray" bold>Traditional</Text>
          </Box>
          <Box width={12}>
            <Text color="gray" bold>Efficiency</Text>
          </Box>
          <Box width={20}>
            <Text color="gray" bold>Progress</Text>
          </Box>
        </Box>
        
        {/* Category rows */}
        {sortedCategories.map(([category, data]) => {
          // @ts-expect-error - Post-Merge Reconciliation
          const maxTokens = Math.max(data.codeagent.avgTokens, data.traditional.avgTokens)
          
          return (
            <Box key={category} marginBottom={0}>
              {/* Category name */}
              <Box width={18}>
                <Text color="cyan">
                  {getCategoryIcon(category)} {category}
                </Text>
              </Box>
              
              {/* CodeAgent stats */}
              <Box width={12} flexDirection="column">
                <Text color="green">
                  {/* @ts-expect-error - Post-Merge Reconciliation */}
                  // @ts-expect-error - Post-Merge Reconciliation
                  {formatNumber(data.codeagent.avgTokens)}
                </Text>
                <Text color="gray" dimColor>
                  {/* @ts-expect-error - Post-Merge Reconciliation */}
                  // @ts-expect-error - Post-Merge Reconciliation
                  {formatCurrency(data.codeagent.avgCost)}
                </Text>
              </Box>
              
              {/* Traditional stats */}
              <Box width={12} flexDirection="column">
                <Text color="blue">
                  {formatNumber((data as any).traditional?.avgTokens ?? 0)}
                </Text>
                <Text color="gray" dimColor>
                  {formatCurrency((data as any).traditional?.avgCost ?? 0)}
                </Text>
              </Box>
              
              {/* Efficiency ratio */}
              <Box width={12}>
                <Text color={getEfficiencyColor((data as any).efficiency ?? 0)}>
                  {getEfficiencyIcon((data as any).efficiency ?? 0)} {(((data as any).efficiency ?? 0) * 100).toFixed(0)}%
                </Text>
              </Box>
              
              {/* Progress bar */}
              <Box width={20}>
                <Text color={getEfficiencyColor((data as any).efficiency ?? 0)}>
                  {renderProgressBar(1 - ((data as any).efficiency ?? 0), 1)}
                </Text>
              </Box>
            </Box>
          )
        })}
      </Box>

      {/* Summary stats */}
      <Box marginTop={1} paddingTop={1} borderStyle="single" borderColor="gray">
        <Box flexDirection="column">
          <Text color="gray" dimColor>
            📈 Best: {sortedCategories[0]?.[0]} ({((1 - ((sortedCategories[0]?.[1] as any)?.efficiency ?? 0)) * 100).toFixed(0)}% savings)
          </Text>
          <Text color="gray" dimColor>
            📉 Needs work: {sortedCategories[sortedCategories.length - 1]?.[0]} 
            ({((1 - ((sortedCategories[sortedCategories.length - 1]?.[1] as any)?.efficiency ?? 0)) * 100).toFixed(0)}% savings)
          </Text>
        </Box>
      </Box>
    </Box>
  )
}