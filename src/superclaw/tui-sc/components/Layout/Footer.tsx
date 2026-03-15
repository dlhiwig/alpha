// @ts-nocheck
import React from 'react';
import { Box, Text } from 'ink';
import type { TabType } from '../../App';

interface FooterProps {
  activeTab: TabType;
}

export const Footer: React.FC<FooterProps> = ({ activeTab }) => {
  // Mock status data for now
  const status = {
    gateway: 'Ready',
    providers: '3/5',
    activeTasks: 2,
    queue: 0
  };

  return (
    <Box borderStyle="single" borderTop={false} paddingX={1}>
      <Box justifyContent="space-between" width="100%">
        <Text>
          Status: <Text color="green">●</Text> {status.gateway}
        </Text>
        <Text>
          Providers: <Text color="cyan">{status.providers}</Text>
        </Text>
        <Text>
          Active Tasks: <Text color="yellow">{status.activeTasks}</Text>
        </Text>
        <Text>
          Queue: <Text color="gray">{status.queue}</Text>
        </Text>
      </Box>
    </Box>
  );
};