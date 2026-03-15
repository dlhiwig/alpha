// @ts-nocheck
import React from 'react';
import { Box, Text } from 'ink';
import { Task } from './TasksView';

interface TaskListProps {
  tasks: Task[];
  selectedIndex: number;
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
  if (!duration) {return '-';}
  const seconds = Math.floor(duration / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  
  if (minutes > 0) {
    return `${minutes}m${remainingSeconds}s`;
  }
  return `${remainingSeconds}s`;
};

const formatCost = (cost?: number): string => {
  if (cost === undefined) {return '-';}
  return `$${cost.toFixed(2)}`;
};

const formatTime = (date: Date): string => {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) {return 'now';}
  if (diffMins < 60) {return `${diffMins}m ago`;}
  if (diffHours < 24) {return `${diffHours}h ago`;}
  return `${diffDays}d ago`;
};

const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) {return text;}
  return text.slice(0, maxLength - 3) + '...';
};

export const TaskList: React.FC<TaskListProps> = ({
  tasks,
  selectedIndex
}) => {
  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      {/* Header */}
      <Box>
        <Box width={10}><Text bold dimColor>ID</Text></Box>
        <Box width={36}><Text bold dimColor>Task</Text></Box>
        <Box width={8}><Text bold dimColor>Status</Text></Box>
        <Box width={8}><Text bold dimColor>Time</Text></Box>
        <Box width={8}><Text bold dimColor>Cost</Text></Box>
      </Box>
      
      {/* Divider */}
      <Box>
        <Text dimColor>{'─'.repeat(70)}</Text>
      </Box>
      
      {/* Task rows */}
      <Box flexDirection="column" flexGrow={1}>
        {tasks.map((task, index) => {
          const isSelected = index === selectedIndex;
          const bgColor = isSelected ? 'blueBright' : undefined;
          const textColor = isSelected ? 'black' : undefined;
          
          return (
            <Box key={task.id}>
              <Box width={10}>
                <Text color={textColor} bold={isSelected}>
                  {getTypeSymbol(task.type)} {task.id}
                </Text>
              </Box>
              <Box width={36}>
                <Text color={textColor} bold={isSelected}>
                  {truncateText(task.description, 34)}
                </Text>
              </Box>
              <Box width={8}>
                <Text 
                  color={isSelected ? textColor : getStatusColor(task.status)}
                  bold={isSelected}
                >
                  {getStatusSymbol(task.status)} {task.status.slice(0, 4)}
                </Text>
              </Box>
              <Box width={8}>
                <Text color={textColor} bold={isSelected}>
                  {task.status === 'running' ? formatTime(task.startTime) : formatDuration(task.duration)}
                </Text>
              </Box>
              <Box width={8}>
                <Text color={textColor} bold={isSelected}>
                  {formatCost(task.cost)}
                </Text>
              </Box>
            </Box>
          );
        })}
      </Box>
      
      {tasks.length === 0 && (
        <Box justifyContent="center" alignItems="center" flexGrow={1}>
          <Text dimColor>No tasks found</Text>
        </Box>
      )}
    </Box>
  );
};