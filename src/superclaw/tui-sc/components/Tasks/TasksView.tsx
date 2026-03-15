import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { TaskList } from './TaskList';
import { TaskDetails } from './TaskDetails';
import { TaskFilters } from './TaskFilters';

export type TaskStatus = 'running' | 'completed' | 'failed' | 'cancelled';
export type TaskType = 'swarm' | 'single';

export interface Task {
  id: string;
  type: TaskType;
  description: string;
  status: TaskStatus;
  startTime: Date;
  endTime?: Date;
  duration?: number; // milliseconds
  cost?: number;
  mode?: string; // For swarm tasks
  providers?: string[];
  error?: string;
  result?: string;
}

export type TaskFilter = 'all' | 'running' | 'completed' | 'failed';

export const TasksView: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showDetails, setShowDetails] = useState(false);
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [isLoading, setIsLoading] = useState(true);

  // Mock data for now - will be replaced with real task history
  useEffect(() => {
    const loadTasks = async () => {
      setIsLoading(true);
      // Simulate loading
      await new Promise(resolve => setTimeout(resolve, 300));
      
      const mockTasks: Task[] = [
        {
          id: 'sw-042',
          type: 'swarm',
          description: 'Research React 19 hydration best practices',
          status: 'running',
          startTime: new Date(Date.now() - 2 * 60 * 1000),
          mode: 'consensus',
          providers: ['claude', 'gemini', 'deepseek']
        },
        {
          id: 'tk-041',
          type: 'single',
          description: 'Fix DEFIT leaderboard component (Neo)',
          status: 'completed',
          startTime: new Date(Date.now() - 15 * 60 * 1000),
          endTime: new Date(Date.now() - 13 * 60 * 1000),
          duration: 1 * 60 * 1000 + 47 * 1000,
          cost: 0.12,
          providers: ['claude'],
          result: 'Fixed React key prop issue in leaderboard mapping'
        },
        {
          id: 'sw-040',
          type: 'swarm',
          description: 'Compare authentication strategies for React server components',
          status: 'completed',
          startTime: new Date(Date.now() - 60 * 60 * 1000),
          endTime: new Date(Date.now() - 57 * 60 * 1000),
          duration: 3 * 60 * 1000 + 21 * 1000,
          cost: 0.45,
          mode: 'consensus',
          providers: ['claude', 'gemini', 'deepseek'],
          result: 'Server-only auth with middleware validation recommended'
        },
        {
          id: 'tk-039',
          type: 'single',
          description: 'Generate weekly development report',
          status: 'completed',
          startTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
          endTime: new Date(Date.now() - 2 * 60 * 60 * 1000 + 45 * 1000),
          duration: 45 * 1000,
          cost: 0.08,
          providers: ['claude'],
          result: 'Report generated with 12 completed tasks, 3 active issues'
        },
        {
          id: 'sw-038',
          type: 'swarm',
          description: 'Code review for PR #142 - database migration',
          status: 'failed',
          startTime: new Date(Date.now() - 3 * 60 * 60 * 1000),
          endTime: new Date(Date.now() - 3 * 60 * 60 * 1000 + 12 * 1000),
          duration: 12 * 1000,
          cost: 0.02,
          mode: 'critique',
          providers: ['claude', 'gemini'],
          error: 'Repository access denied - invalid GitHub token'
        }
      ];
      
      setTasks(mockTasks);
      setIsLoading(false);
    };

    loadTasks();
  }, []);

  const filteredTasks = tasks.filter(task => {
    if (filter === 'all') {return true;}
    return task.status === filter;
  });

  useInput((input, key) => {
    if (showDetails) {
      if (input === 'q' || key.escape) {
        setShowDetails(false);
        return;
      }
      if (input === 'r') {
        // Retry task
        // TODO: Implement task retry
        setShowDetails(false);
      }
      if (input === 'x') {
        // Delete task
        // TODO: Implement task deletion
        setShowDetails(false);
      }
      return;
    }

    if (key.upArrow && selectedIndex > 0) {
      setSelectedIndex(selectedIndex - 1);
    }
    
    if (key.downArrow && selectedIndex < filteredTasks.length - 1) {
      setSelectedIndex(selectedIndex + 1);
    }

    if (key.return) {
      if (filteredTasks[selectedIndex]) {
        setShowDetails(true);
      }
    }

    if (input === 'f') {
      // Toggle filter
      const filters: TaskFilter[] = ['all', 'running', 'completed', 'failed'];
      const currentIndex = filters.indexOf(filter);
      const nextIndex = (currentIndex + 1) % filters.length;
      setFilter(filters[nextIndex]);
      setSelectedIndex(0);
    }

    if (input === 'r') {
      // Refresh tasks
      const loadTasks = async () => {
        setIsLoading(true);
        await new Promise(resolve => setTimeout(resolve, 300));
        setIsLoading(false);
      };
      loadTasks();
    }

    if (input === 'x' && filteredTasks[selectedIndex]) {
      // Quick delete
      const taskToDelete = filteredTasks[selectedIndex];
      setTasks(prev => prev.filter(task => task.id !== taskToDelete.id));
      if (selectedIndex >= filteredTasks.length - 1 && selectedIndex > 0) {
        setSelectedIndex(selectedIndex - 1);
      }
    }
  });

  if (isLoading) {
    return (
      <Box flexDirection="column" padding={2}>
        <Text>Loading tasks...</Text>
      </Box>
    );
  }

  if (showDetails && filteredTasks[selectedIndex]) {
    return (
      <TaskDetails 
        task={filteredTasks[selectedIndex]}
        onBack={() => setShowDetails(false)}
      />
    );
  }

  return (
    <Box flexDirection="column" height="100%">
      <Box padding={1} borderStyle="single" borderColor="blue">
        <Text bold color="blue">TASK HISTORY</Text>
        <Box marginLeft={20}>
          <Text dimColor>[f] Filter</Text>
          <Text dimColor> | </Text>
          <Text dimColor>[r] Refresh</Text>
          <Text dimColor> | </Text>
          <Text dimColor>[Enter] Details</Text>
          <Text dimColor> | </Text>
          <Text dimColor>[x] Delete</Text>
        </Box>
      </Box>
      
      <Box flexDirection="column" flexGrow={1}>
        <TaskFilters
          currentFilter={filter}
          taskCounts={{
            all: tasks.length,
            running: tasks.filter(t => t.status === 'running').length,
            completed: tasks.filter(t => t.status === 'completed').length,
            failed: tasks.filter(t => t.status === 'failed').length
          }}
        />
        
        <TaskList 
          tasks={filteredTasks} 
          selectedIndex={selectedIndex}
        />
        
        <Box padding={1} borderStyle="single" borderTop={false} borderColor="gray">
          <Text dimColor>
            Showing {filteredTasks.length} of {tasks.length} tasks
            {filteredTasks.length > 0 && ` | Selected: ${filteredTasks[selectedIndex]?.id}`}
          </Text>
        </Box>
      </Box>
    </Box>
  );
};