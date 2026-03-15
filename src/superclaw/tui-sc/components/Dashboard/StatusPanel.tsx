import React from 'react';
import { Box, Text } from 'ink';

export const StatusPanel: React.FC = () => {
  // Mock system status for Phase 1
  const systemStatus = {
    gateway: { status: 'Running', port: 18800 },
    providers: { active: 3, total: 5 },
    queue: { pending: 0 },
    memory: { used: '847 MB' },
    uptime: '4h 32m'
  };

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={2} paddingY={1}>
      <Text bold color="cyan">SYSTEM STATUS</Text>
      <Text color="gray">{'─'.repeat(30)}</Text>
      
      <Box marginTop={1} flexDirection="column">
        <Text>
          <Text color="green">●</Text> Gateway:     {systemStatus.gateway.status} ({systemStatus.gateway.port})
        </Text>
        <Text>
          <Text color="green">●</Text> Providers:   {systemStatus.providers.active} active
        </Text>
        <Text>
          <Text color="green">●</Text> Queue:       {systemStatus.queue.pending} pending
        </Text>
        <Text>
          <Text color="green">●</Text> Memory:      {systemStatus.memory.used}
        </Text>
        <Text>
          <Text color="green">●</Text> Uptime:      {systemStatus.uptime}
        </Text>
      </Box>
    </Box>
  );
};