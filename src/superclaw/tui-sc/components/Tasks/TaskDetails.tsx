// @ts-nocheck
import React from 'react';
import { Box, Text } from 'ink';
import { Task } from './TasksView';

interface TaskDetailsProps {
  task: Task;
  onBack: () => void;
}

const getStatusSymbol = (status: Task['status']): string => {
  switch (status) {
    case 'running': return '●';
    case 'completed': return '✓';
    case 'failed': return '✗';
    case 'cancelled': return '○';
    default: return '?';
  }
};

const getStatusColor = (status: Task['status']): string => {
  switch (status) {
    case 'running': return 'yellow';
    case 'completed': return 'green';
    case 'failed': return 'red';
    case 'cancelled': return 'gray';
    default: return 'gray';
  }
};

const getTypeSymbol = (type: Task['type']): string => {
  switch (type) {
    case 'swarm': return '🦂';
    case 'single': return '🤖';
    default: return '?';
  }
};

const formatDuration = (duration?: number): string => {
  if (!duration) {return 'Unknown';}
  const seconds = Math.floor(duration / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${remainingSeconds}s`;
};

const formatDateTime = (date: Date): string => {
  return date.toLocaleString();
};

export const TaskDetails: React.FC<TaskDetailsProps> = ({ task, onBack }) => {
  const canRetry = task.status === 'failed' || task.status === 'cancelled';
  const canDelete = task.status !== 'running';
  
  return (
    <Box flexDirection="column" height="100%" padding={1}>
      {/* Header */}
      <Box padding={1} borderStyle="single" borderColor="blue">
        <Text bold color="blue">TASK DETAILS - {task.id.toUpperCase()}</Text>
        <Box marginLeft={20}>
          <Text dimColor>[Esc] Back</Text>
          {canRetry && (
            <>
              <Text dimColor> | </Text>
              <Text dimColor>[r] Retry</Text>
            </>
          )}
          {canDelete && (
            <>
              <Text dimColor> | </Text>
              <Text dimColor>[x] Delete</Text>
            </>
          )}
        </Box>
      </Box>

      <Box flexDirection="column" paddingX={2} paddingY={1}>
        {/* Basic Info */}
        <Box marginBottom={1}>
          <Box width={16}><Text bold>Type:</Text></Box>
          <Text>
            {getTypeSymbol(task.type)} {task.type.toUpperCase()}
            {task.mode && <Text dimColor> ({task.mode})</Text>}
          </Text>
        </Box>

        <Box marginBottom={1}>
          <Box width={16}><Text bold>Status:</Text></Box>
          <Text color={getStatusColor(task.status)}>
            {getStatusSymbol(task.status)} {task.status.toUpperCase()}
          </Text>
        </Box>

        <Box marginBottom={2}>
          <Box width={16}><Text bold>Description:</Text></Box>
          <Text wrap="wrap">
            {task.description}
          </Text>
        </Box>

        {/* Timing */}
        <Box marginBottom={1}>
          <Text bold color="yellow">TIMING</Text>
        </Box>

        <Box marginBottom={1}>
          <Box width={16}><Text>Started:</Text></Box>
          <Text>{formatDateTime(task.startTime)}</Text>
        </Box>

        {task.endTime && (
          <Box marginBottom={1}>
            <Box width={16}><Text>Completed:</Text></Box>
            <Text>{formatDateTime(task.endTime)}</Text>
          </Box>
        )}

        <Box marginBottom={2}>
          <Box width={16}><Text>Duration:</Text></Box>
          <Text>
            {task.status === 'running' 
              ? `${formatDuration(Date.now() - task.startTime.getTime())} (ongoing)`
              : formatDuration(task.duration)
            }
          </Text>
        </Box>

        {/* Providers */}
        {task.providers && task.providers.length > 0 && (
          <>
            <Box marginBottom={1}>
              <Text bold color="yellow">PROVIDERS USED</Text>
            </Box>

            <Box marginBottom={2} flexDirection="column" marginLeft={2}>
              {task.providers.map(provider => (
                <Box key={provider}>
                  <Text color="green">•</Text>
                  <Box marginLeft={1}>
                  <Text>{provider}</Text>
                </Box>
                </Box>
              ))}
            </Box>
          </>
        )}

        {/* Cost */}
        {task.cost !== undefined && (
          <>
            <Box marginBottom={1}>
              <Text bold color="yellow">COST</Text>
            </Box>

            <Box marginBottom={2}>
              <Box width={16}><Text>Total Cost:</Text></Box>
              <Text color={task.cost === 0 ? 'green' : 'yellow'}>
                ${task.cost.toFixed(3)}
              </Text>
            </Box>
          </>
        )}

        {/* Result/Error */}
        {task.result && (
          <>
            <Box marginBottom={1}>
              <Text bold color="green">RESULT</Text>
            </Box>

            <Box 
              marginBottom={2}
              borderStyle="single" 
              borderColor="green" 
              paddingX={1} 
              flexDirection="column"
            >
              <Text wrap="wrap">{task.result}</Text>
            </Box>
          </>
        )}

        {task.error && (
          <>
            <Box marginBottom={1}>
              <Text bold color="red">ERROR</Text>
            </Box>

            <Box 
              marginBottom={2}
              borderStyle="single" 
              borderColor="red" 
              paddingX={1} 
              flexDirection="column"
            >
              <Text wrap="wrap" color="red">{task.error}</Text>
            </Box>
          </>
        )}

        {/* Actions hint */}
        <Box marginTop={2} paddingTop={1} borderStyle="single" borderTop borderColor="gray">
          <Text dimColor>
            Press [Esc] to go back
            {canRetry && ', [r] to retry this task'}
            {canDelete && ', [x] to delete this task'}
          </Text>
        </Box>
      </Box>
    </Box>
  );
};