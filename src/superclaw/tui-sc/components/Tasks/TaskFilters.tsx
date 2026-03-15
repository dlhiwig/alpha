import React from 'react';
import { Box, Text } from 'ink';
import { TaskFilter } from './TasksView';

interface TaskFiltersProps {
  currentFilter: TaskFilter;
  taskCounts: {
    all: number;
    running: number;
    completed: number;
    failed: number;
  };
}

export const TaskFilters: React.FC<TaskFiltersProps> = ({
  currentFilter,
  taskCounts
}) => {
  const filters: { key: TaskFilter; label: string; color: string }[] = [
    { key: 'all', label: 'All', color: 'white' },
    { key: 'running', label: 'Running', color: 'yellow' },
    { key: 'completed', label: 'Completed', color: 'green' },
    { key: 'failed', label: 'Failed', color: 'red' }
  ];

  return (
    <Box paddingX={1} paddingY={1} borderStyle="single" borderBottom borderColor="gray">
      <Box>
        <Text bold dimColor>Filter: </Text>
        {filters.map((filter, index) => {
          const isActive = currentFilter === filter.key;
          const count = taskCounts[filter.key];
          
          return (
            <React.Fragment key={filter.key}>
              {index > 0 && <Text dimColor> | </Text>}
              <Text 
                color={isActive ? filter.color : 'gray'}
                bold={isActive}
              >
                [{filter.label}] ({count})
              </Text>
            </React.Fragment>
          );
        })}
      </Box>
      
      <Box marginLeft={20}>
        <Text bold dimColor>Sort: </Text>
        <Text>[Newest First]</Text>
      </Box>
    </Box>
  );
};