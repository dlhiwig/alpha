import React from 'react';
import { Box, Text } from 'ink';

export const QuickActions: React.FC = () => {
  const actions = [
    { key: 'n', label: 'New Swarm Task' },
    { key: 'r', label: 'Recent Tasks' },
    { key: 'p', label: 'Provider Health' },
    { key: 's', label: 'Settings' },
    { key: '?', label: 'Help' }
  ];

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={2} paddingY={1}>
      <Text bold color="cyan">QUICK ACTIONS</Text>
      <Text color="gray">{'─'.repeat(20)}</Text>
      
      <Box marginTop={1} flexDirection="column">
        {actions.map((action) => (
          <Text key={action.key}>
            <Text color="yellow">[{action.key}]</Text> {action.label}
          </Text>
        ))}
      </Box>
    </Box>
  );
};