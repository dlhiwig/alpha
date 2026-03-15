import React from 'react';
import { Box } from 'ink';
import { StatusPanel } from './StatusPanel';
import { QuickActions } from './QuickActions';
import { RecentActivity } from './RecentActivity';

export const Dashboard: React.FC = () => {
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box>
        <Box flexDirection="column" flexGrow={1} marginRight={2}>
          <StatusPanel />
        </Box>
        <Box flexDirection="column" width={30}>
          <QuickActions />
        </Box>
      </Box>
      <Box marginTop={2}>
        <RecentActivity />
      </Box>
    </Box>
  );
};