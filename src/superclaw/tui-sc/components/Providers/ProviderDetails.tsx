import React from 'react';
import { Box, Text } from 'ink';
import { ProviderInfo } from './ProvidersView';

interface ProviderDetailsProps {
  provider: ProviderInfo;
  onBack: () => void;
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

const maskApiKey = (apiKey?: string): string => {
  if (!apiKey) {return 'Not configured';}
  if (apiKey.length <= 8) {return apiKey;}
  return `${apiKey.slice(0, 8)}...${apiKey.slice(-6)}`;
};

const formatUsage = (used?: number, limit?: number): string => {
  if (used === undefined) {return '-';}
  if (limit === undefined || limit === 0) {return `$${used.toFixed(2)}`;}
  return `$${used.toFixed(2)} / $${limit.toFixed(2)}`;
};

const formatRateLimit = (rateLimit?: { max: number; used: number }): string => {
  if (!rateLimit) {return 'Not configured';}
  return `${rateLimit.used} / ${rateLimit.max} req/min`;
};

export const ProviderDetails: React.FC<ProviderDetailsProps> = ({
  provider,
  onBack
}) => {
  const usagePercentage = provider.budgetLimit && provider.usageToday 
    ? (provider.usageToday / provider.budgetLimit) * 100 
    : 0;

  const rateLimitPercentage = provider.rateLimit 
    ? (provider.rateLimit.used / provider.rateLimit.max) * 100 
    : 0;

  return (
    <Box flexDirection="column" height="100%" padding={1}>
      {/* Header */}
      <Box padding={1} borderStyle="single" borderColor="blue">
        <Text bold color="blue">PROVIDER DETAILS - {provider.name.toUpperCase()}</Text>
        <Box marginLeft={20}>
          <Text dimColor>[Esc] Back</Text>
          <Text dimColor> | </Text>
          <Text dimColor>[e] Edit</Text>
          <Text dimColor> | </Text>
          <Text dimColor>[t] Test</Text>
        </Box>
      </Box>

      <Box flexDirection="column" paddingX={2} paddingY={1}>
        {/* Status */}
        <Box marginBottom={1}>
          <Box width={16}><Text bold>Status:</Text></Box>
          <Text color={getStatusColor(provider.status)}>
            {getStatusSymbol(provider.status)} {provider.status.toUpperCase()}
          </Text>
          {provider.lastError && (
            <Box marginLeft={2}>
              <Text color="red">({provider.lastError})</Text>
            </Box>
          )}
        </Box>

        {/* Configuration */}
        <Box marginBottom={1}>
          <Text bold color="yellow">CONFIGURATION</Text>
        </Box>
        
        <Box marginBottom={1}>
          <Box width={16}><Text>API Key:</Text></Box>
          <Text>{maskApiKey(provider.apiKey)}</Text>
        </Box>

        {provider.endpoint && (
          <Box marginBottom={1}>
            <Box width={16}><Text>Endpoint:</Text></Box>
            <Text>{provider.endpoint}</Text>
          </Box>
        )}

        {/* Performance */}
        <Box marginBottom={1} marginTop={1}>
          <Text bold color="yellow">PERFORMANCE</Text>
        </Box>

        {provider.latency !== undefined && (
          <Box marginBottom={1}>
            <Box width={16}><Text>Latency:</Text></Box>
            <Text color={provider.latency < 200 ? 'green' : provider.latency < 500 ? 'yellow' : 'red'}>
              {provider.latency}ms
            </Text>
          </Box>
        )}

        <Box marginBottom={1}>
          <Box width={16}><Text>Cost per 1K:</Text></Box>
          <Text color={(provider.costPer1K ?? 0) === 0 ? 'green' : 'yellow'}>
            {(provider.costPer1K ?? 0) === 0 ? 'FREE' : `$${(provider.costPer1K ?? 0).toFixed(3)}`}
          </Text>
        </Box>

        {/* Usage */}
        {(provider.usageToday !== undefined || provider.rateLimit) && (
          <>
            <Box marginBottom={1} marginTop={1}>
              <Text bold color="yellow">USAGE</Text>
            </Box>

            {provider.usageToday !== undefined && (
              <Box marginBottom={1}>
                <Box width={16}><Text>Today's Usage:</Text></Box>
                <Text color={usagePercentage > 80 ? 'red' : usagePercentage > 50 ? 'yellow' : 'green'}>
                  {formatUsage(provider.usageToday, provider.budgetLimit)}
                  {provider.budgetLimit && (
                    <Text dimColor> ({usagePercentage.toFixed(1)}%)</Text>
                  )}
                </Text>
              </Box>
            )}

            {provider.rateLimit && (
              <Box marginBottom={1}>
                <Box width={16}><Text>Rate Limit:</Text></Box>
                <Text color={rateLimitPercentage > 80 ? 'red' : rateLimitPercentage > 50 ? 'yellow' : 'green'}>
                  {formatRateLimit(provider.rateLimit)}
                  <Text dimColor> ({rateLimitPercentage.toFixed(1)}%)</Text>
                </Text>
              </Box>
            )}
          </>
        )}

        {/* Models */}
        <Box marginBottom={1} marginTop={1}>
          <Text bold color="yellow">AVAILABLE MODELS</Text>
        </Box>

        {provider.models.length > 0 ? (
          <Box flexDirection="column" marginLeft={2}>
            {provider.models.map(model => (
              <Box key={model} marginBottom={0}>
                <Text color="green">•</Text>
                <Box marginLeft={1}>
                  <Text>{model}</Text>
                </Box>
              </Box>
            ))}
          </Box>
        ) : (
          <Box marginLeft={2}>
            <Text dimColor>No models available</Text>
          </Box>
        )}

        {/* Actions hint */}
        <Box marginTop={2} paddingTop={1} borderStyle="single" borderTop borderColor="gray">
          <Text dimColor>
            Use [e] to edit configuration, [t] to test connection, [Esc] to go back
          </Text>
        </Box>
      </Box>
    </Box>
  );
};