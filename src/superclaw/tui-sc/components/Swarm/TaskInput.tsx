import React from 'react';
import { Box, Text } from 'ink';
import { TextInput } from '@inkjs/ui';

interface TaskInputProps {
  task: string;
  focused: boolean;
  onTaskChange: (task: string) => void;
}

export const TaskInput: React.FC<TaskInputProps> = ({
  task,
  focused,
  onTaskChange
}) => {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box marginBottom={1}>
        <Text bold color={focused ? 'yellow' : 'white'}>
          TASK INPUT{focused ? ' (focused)' : ''}:
        </Text>
      </Box>
      
      <Box 
        borderStyle="single" 
        borderColor={focused ? 'yellow' : 'gray'}
        paddingX={1}
        height={4}
      >
        {focused ? (
          <TextInput
            defaultValue={task}
            onSubmit={onTaskChange}
            placeholder="Describe the task for the swarm to work on..."
          />
        ) : (
          <Box flexDirection="column">
            {task ? (
              <Text wrap="wrap">
                {task}
              </Text>
            ) : (
              <Text dimColor>
                Click here or press Tab to enter task description...
              </Text>
            )}
          </Box>
        )}
      </Box>
      
      <Box marginTop={1}>
        <Text dimColor>
          {focused ? 'Type your task description. Press Tab to move to next field.' : 'Task description for the swarm to work on'}
        </Text>
      </Box>
    </Box>
  );
};