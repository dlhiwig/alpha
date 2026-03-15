import React from 'react';
import { Box, Text } from 'ink';
import type { TabType } from '../../App';

interface TabsProps {
  activeTab: TabType;
}

const tabs = [
  { key: 'dashboard', label: '[1] Dashboard', number: 1 },
  { key: 'swarm', label: '[2] Swarm', number: 2 },
  { key: 'providers', label: '[3] Providers', number: 3 },
  { key: 'tasks', label: '[4] Tasks', number: 4 },
  { key: 'logs', label: '[5] Logs', number: 5 },
  { key: 'config', label: '[6] Config', number: 6 },
];

export const Tabs: React.FC<TabsProps> = ({ activeTab }) => {
  return (
    <Box borderStyle="single" borderTop={false} borderBottom={false} paddingX={1}>
      <Box>
        {tabs.map((tab, index) => (
          <React.Fragment key={tab.key}>
            <Text 
              color={activeTab === tab.key ? 'cyan' : 'gray'}
              bold={activeTab === tab.key}
              inverse={activeTab === tab.key}
            >
              {tab.label}
            </Text>
            {index < tabs.length - 1 && <Text color="gray">  </Text>}
          </React.Fragment>
        ))}
      </Box>
    </Box>
  );
};