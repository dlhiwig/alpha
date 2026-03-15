import React from 'react';
import { Box, Text } from 'ink';
import { SwarmProgressData, SwarmMode } from './SwarmView';

interface SwarmProgressProps {
  progress: SwarmProgressData;
  task: string;
  mode: SwarmMode;
  onCancel: () => void;
}

const getStatusSymbol = (status: string): string => {
  switch (status) {
    case 'pending': return '○';
    case 'running': return '◐';
    case 'done': return '●';
    case 'error': return '✗';
    default: return '?';
  }
};

const getStatusColor = (status: string): string => {
  switch (status) {
    case 'pending': return 'gray';
    case 'running': return 'yellow';
    case 'done': return 'green';
    case 'error': return 'red';
    default: return 'gray';
  }
};

const formatDuration = (ms?: number): string => {
  if (!ms) {return '-';}
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${remainingSeconds}s`;
};

const formatElapsedTime = (startTime: Date): string => {
  const elapsed = Date.now() - startTime.getTime();
  return formatDuration(elapsed);
};

const createProgressBar = (progress: number, width: number = 20): string => {
  const filled = Math.round((progress / 100) * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
};

export const SwarmProgress: React.FC<SwarmProgressProps> = ({
  progress,
  task,
  mode,
  onCancel
}) => {
  const runningProviders = progress.providers.filter(p => p.status === 'running');
  const completedProviders = progress.providers.filter(p => p.status === 'done');
  const errorProviders = progress.providers.filter(p => p.status === 'error');

  return (
    <Box flexDirection="column" height="100%">
      <Box padding={1} borderStyle="single" borderColor="yellow">
        <Text bold color="yellow">SWARM IN PROGRESS</Text>
        <Box marginLeft={20}>
          <Text dimColor>[c] Cancel Swarm</Text>
        </Box>
      </Box>

      <Box flexDirection="column" paddingX={2} paddingY={1}>
        {/* Task Info */}
        <Box marginBottom={1}>
          <Text bold>Task:</Text>
          <Box marginLeft={1}>
            <Text wrap="wrap">
              "{task.length > 80 ? task.slice(0, 80) + '...' : task}"
            </Text>
          </Box>
        </Box>

        <Box marginBottom={2}>
          <Text bold>Mode:</Text>
          <Box marginLeft={1}><Text color="blue">{mode}</Text></Box>
          <Box marginLeft={2}><Text bold>Started:</Text></Box>
          <Box marginLeft={1}><Text>{progress.startTime.toLocaleTimeString()}</Text></Box>
          <Box marginLeft={2}><Text bold>Elapsed:</Text></Box>
          <Box marginLeft={1}><Text>{formatElapsedTime(progress.startTime)}</Text></Box>
        </Box>

        {/* Agent Status Table */}
        <Box marginBottom={1}>
          <Text bold color="yellow">AGENT STATUS:</Text>
        </Box>

        <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
          {/* Header */}
          <Box>
            <Box width={14}><Text bold dimColor>Provider</Text></Box>
            <Box width={12}><Text bold dimColor>Status</Text></Box>
            <Box width={10}><Text bold dimColor>Time</Text></Box>
            <Box width={24}><Text bold dimColor>Progress</Text></Box>
          </Box>
          
          {/* Divider */}
          <Box>
            <Text dimColor>{'─'.repeat(60)}</Text>
          </Box>

          {/* Provider rows */}
          {progress.providers.map(provider => (
            <Box key={provider.name}>
              <Box width={14}>
                <Text>{provider.name}</Text>
              </Box>
              <Box width={12}>
                <Text color={getStatusColor(provider.status)}>
                  {getStatusSymbol(provider.status)} {provider.status}
                </Text>
              </Box>
              <Box width={10}>
                <Text>{formatDuration(provider.duration)}</Text>
              </Box>
              <Box width={24}>
                <Text>
                  {createProgressBar(provider.progress)} {provider.progress}%
                </Text>
              </Box>
            </Box>
          ))}
        </Box>

        {/* Consensus/Summary Status */}
        {progress.consensusStatus && (
          <Box marginTop={1} marginBottom={1}>
            <Text bold color="blue">STATUS:</Text>
            <Box marginLeft={1}>
              <Text>{progress.consensusStatus}</Text>
            </Box>
          </Box>
        )}

        {/* Statistics */}
        <Box marginTop={1} flexDirection="row" gap={2}>
          <Box>
            <Text color="green">✓ Completed: {completedProviders.length}</Text>
          </Box>
          <Box marginLeft={2}>
            <Text color="yellow">◐ Running: {runningProviders.length}</Text>
          </Box>
          {errorProviders.length > 0 && (
            <Box marginLeft={2}>
              <Text color="red">✗ Errors: {errorProviders.length}</Text>
            </Box>
          )}
        </Box>

        {/* Live Output Preview */}
        {runningProviders.length > 0 && (
          <Box marginTop={2} flexDirection="column">
            <Box marginBottom={1}>
              <Text bold color="yellow">LIVE OUTPUT ({runningProviders[0].name}):</Text>
            </Box>
            
            <Box 
              borderStyle="single" 
              borderColor="yellow" 
              paddingX={1} 
              height={6}
              flexDirection="column"
            >
              {runningProviders[0].output ? (
                <Text wrap="wrap">{runningProviders[0].output}</Text>
              ) : (
                <Box>
                  <Text dimColor>● Analyzing task...</Text>
                  <Text dimColor>● Generating response...</Text>
                  <Text dimColor>● Processing...</Text>
                </Box>
              )}
            </Box>
          </Box>
        )}

        {/* Completion Message */}
        {completedProviders.length === progress.providers.length && (
          <Box marginTop={2} padding={1} borderStyle="single" borderColor="green">
            <Text bold color="green">
              ✓ All providers completed! Results will be synthesized and displayed shortly.
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};