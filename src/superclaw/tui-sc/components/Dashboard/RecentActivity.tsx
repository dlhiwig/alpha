// @ts-nocheck
import React from 'react';
import { Box, Text } from 'ink';

export const RecentActivity: React.FC = () => {
  // Mock recent activity data
  const activities = [
    { time: '2m ago', status: '✓', message: 'Swarm completed: "Research React 19 hydration"', type: 'success' },
    { time: '15m ago', status: '✓', message: 'Task completed: "Fix DEFIT leaderboard" (Neo)', type: 'success' },
    { time: '1h ago', status: '○', message: 'Heartbeat check passed', type: 'info' },
    { time: '2h ago', status: '✓', message: 'Provider health check: all green', type: 'success' }
  ];

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={2} paddingY={1}>
      <Text bold color="cyan">RECENT ACTIVITY</Text>
      <Text color="gray">{'─'.repeat(50)}</Text>
      
      <Box marginTop={1} flexDirection="column">
        {activities.map((activity, index) => (
          <Text key={index}>
            <Text color="gray">• {activity.time}</Text>   
            <Text color={activity.type === 'success' ? 'green' : 'blue'}>{activity.status}</Text>
            <Text> {activity.message}</Text>
          </Text>
        ))}
      </Box>
    </Box>
  );
};