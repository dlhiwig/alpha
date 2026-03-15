// @ts-nocheck
import React from 'react';
import { Box, Text } from 'ink';
import { ProviderInfo } from './ProvidersView';

interface ProviderListProps {
  providers: ProviderInfo[];
  selectedIndex: number;
}

const getStatusSymbol = (status: ProviderInfo['status']): string => {
  switch (status) {
    case 'online': return '●';
    case 'offline': return '○';
    case 'quota': return '⚠';
    case 'error': return '✗';
    default: return '?';
  }
};

const getStatusColor = (status: ProviderInfo['status']): string => {
  switch (status) {
    case 'online': return 'green';
    case 'offline': return 'gray';
    case 'quota': return 'yellow';
    case 'error': return 'red';
    default: return 'gray';
  }
};

const formatLatency = (latency?: number): string => {
  if (latency === undefined) {return '-';}
  return `${latency}ms`;
};

const formatCost = (cost?: number): string => {
  if (cost === undefined || cost === 0) {return 'FREE';}
  return `$${cost.toFixed(3)}`;
};

const formatModels = (models: string[]): string => {
  if (models.length === 0) {return '-';}
  if (models.length <= 2) {return models.join(', ');}
  return `${models.slice(0, 2).join(', ')} +${models.length - 2}`;
};

export const ProviderList: React.FC<ProviderListProps> = ({
  providers,
  selectedIndex
}) => {
  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Header */}
      <Box>
        <Box width={16}><Text bold dimColor>Provider</Text></Box>
        <Box width={12}><Text bold dimColor>Status</Text></Box>
        <Box width={20}><Text bold dimColor>Models</Text></Box>
        <Box width={10}><Text bold dimColor>Latency</Text></Box>
        <Box width={12}><Text bold dimColor>Cost/1K</Text></Box>
      </Box>
      
      {/* Divider */}
      <Box>
        <Text dimColor>{'─'.repeat(70)}</Text>
      </Box>
      
      {/* Provider rows */}
      {providers.map((provider, index) => {
        const isSelected = index === selectedIndex;
        const bgColor = isSelected ? 'blueBright' : undefined;
        const textColor = isSelected ? 'black' : undefined;
        
        return (
          <Box key={provider.name}>
            <Box width={16}>
              <Text color={textColor} bold={isSelected}>
                {provider.name}
              </Text>
            </Box>
            <Box width={12}>
              <Text 
                color={isSelected ? textColor : getStatusColor(provider.status)}
                bold={isSelected}
              >
                {getStatusSymbol(provider.status)} {provider.status}
              </Text>
            </Box>
            <Box width={20}>
              <Text color={textColor} bold={isSelected}>
                {formatModels(provider.models)}
              </Text>
            </Box>
            <Box width={10}>
              <Text color={textColor} bold={isSelected}>
                {formatLatency(provider.latency)}
              </Text>
            </Box>
            <Box width={12}>
              <Text color={textColor} bold={isSelected}>
                {formatCost(provider.costPer1K)}
              </Text>
            </Box>
          </Box>
        );
      })}
      
      {providers.length === 0 && (
        <Box justifyContent="center" marginY={2}>
          <Text dimColor>No providers configured</Text>
        </Box>
      )}
    </Box>
  );
};