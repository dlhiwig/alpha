// @ts-nocheck
import React, { useState } from 'react';
import { Box, useInput } from 'ink';
import { Header } from './components/Layout/Header.js';
import { Tabs } from './components/Layout/Tabs.js';
import { Footer } from './components/Layout/Footer.js';
import { Dashboard } from './components/Dashboard/Dashboard.js';
import { ProvidersView } from './components/Providers/ProvidersView.js';
import { SwarmView } from './components/Swarm/SwarmView.js';
import { TasksView } from './components/Tasks/TasksView.js';
import { LogsView } from './components/Logs/LogsView.js';
import { ConfigView } from './components/Config/ConfigView.js';

export type TabType = 'dashboard' | 'swarm' | 'providers' | 'tasks' | 'logs' | 'config';

const tabNames: TabType[] = ['dashboard', 'swarm', 'providers', 'tasks', 'logs', 'config'];

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [showHelp, setShowHelp] = useState(false);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      process.exit(0);
    }

    if (input === 'q') {
      process.exit(0);
    }

    if (input === '?') {
      setShowHelp(!showHelp);
      return;
    }

    // Tab navigation with number keys
    const tabNumber = parseInt(input);
    if (tabNumber >= 1 && tabNumber <= 6) {
      setActiveTab(tabNames[tabNumber - 1]);
    }
  });

  const renderActiveView = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard />;
      case 'swarm':
        return <SwarmView />;
      case 'providers':
        return <ProvidersView />;
      case 'tasks':
        return <TasksView />;
      case 'logs':
        return <LogsView />;
      case 'config':
        return <ConfigView />;
      default:
        return <Dashboard />;
    }
  };

  if (showHelp) {
    return (
      <Box flexDirection="column" height="100%">
        <Header />
        <Box flexDirection="column" padding={2}>
          <text>🦞 SuperClaw TUI Help</text>
          <text></text>
          <text>Navigation:</text>
          <text>  1-6    Switch between tabs</text>
          <text>  ?      Toggle this help</text>
          <text>  q      Quit</text>
          <text>  Ctrl+C Exit</text>
          <text></text>
          <text>Tabs:</text>
          <text>  [1] Dashboard  - System overview</text>
          <text>  [2] Swarm      - Multi-agent tasks</text>
          <text>  [3] Providers  - LLM providers</text>
          <text>  [4] Tasks      - Task history</text>
          <text>  [5] Logs       - Live logs</text>
          <text>  [6] Config     - Settings</text>
          <text></text>
          <text>Press ? again to close help.</text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height="100%">
      <Header />
      <Tabs activeTab={activeTab} />
      <Box flexGrow={1}>
        {renderActiveView()}
      </Box>
      <Footer activeTab={activeTab} />
    </Box>
  );
};