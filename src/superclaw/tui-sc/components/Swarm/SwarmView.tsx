import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { TaskInput } from './TaskInput';
import { ModeSelector } from './ModeSelector';
import { ProviderSelector } from './ProviderSelector';
import { SwarmProgress } from './SwarmProgress';

export type SwarmMode = 'fanout' | 'consensus' | 'pipeline' | 'debate';
export type ContractLevel = 'loose' | 'standard' | 'strict';

export interface SwarmProvider {
  name: string;
  displayName: string;
  available: boolean;
  selected: boolean;
}

export interface SwarmState {
  task: string;
  mode: SwarmMode;
  contract: ContractLevel;
  providers: SwarmProvider[];
  running: boolean;
  progress?: SwarmProgressData;
}

export interface SwarmProgressData {
  startTime: Date;
  providers: {
    name: string;
    status: 'pending' | 'running' | 'done' | 'error';
    progress: number;
    duration?: number;
    output?: string;
  }[];
  consensusStatus?: string;
}

type FocusedField = 'task' | 'mode' | 'providers' | 'start';

export const SwarmView: React.FC = () => {
  const [swarmState, setSwarmState] = useState<SwarmState>({
    task: '',
    mode: 'consensus',
    contract: 'standard',
    providers: [
      { name: 'claude', displayName: 'Claude (Sonnet)', available: true, selected: true },
      { name: 'gemini', displayName: 'Gemini', available: true, selected: true },
      { name: 'deepseek', displayName: 'DeepSeek', available: false, selected: false },
      { name: 'ollama', displayName: 'Ollama (local)', available: true, selected: false },
      { name: 'codex', displayName: 'Codex', available: false, selected: false },
    ],
    running: false
  });

  const [focusedField, setFocusedField] = useState<FocusedField>('task');

  useInput((input, key) => {
    if (swarmState.running) {
      if (input === 'c') {
        // Cancel swarm
        setSwarmState(prev => ({
          ...prev,
          running: false,
          progress: undefined
        }));
      }
      return;
    }

    if (key.tab) {
      // Cycle through fields
      const fields: FocusedField[] = ['task', 'mode', 'providers', 'start'];
      const currentIndex = fields.indexOf(focusedField);
      const nextIndex = (currentIndex + 1) % fields.length;
      setFocusedField(fields[nextIndex]);
      return;
    }

    if (key.escape) {
      setFocusedField('task');
      return;
    }

    if (key.return && focusedField === 'start' && swarmState.task.trim()) {
      // Start swarm
      startSwarm();
      return;
    }
  });

  const startSwarm = () => {
    const selectedProviders = swarmState.providers.filter(p => p.selected);
    if (selectedProviders.length === 0 || !swarmState.task.trim()) return;

    const mockProgress: SwarmProgressData = {
      startTime: new Date(),
      providers: selectedProviders.map(p => ({
        name: p.name,
        status: 'pending' as const,
        progress: 0
      }))
    };

    setSwarmState(prev => ({
      ...prev,
      running: true,
      progress: mockProgress
    }));

    // Mock progress simulation
    simulateSwarmProgress(mockProgress);
  };

  const simulateSwarmProgress = (initialProgress: SwarmProgressData) => {
    const providers = [...initialProgress.providers];
    let completed = 0;

    const updateInterval = setInterval(() => {
      providers.forEach((provider, index) => {
        if (provider.status === 'pending') {
          provider.status = 'running';
          provider.progress = 10;
        } else if (provider.status === 'running' && provider.progress < 100) {
          provider.progress = Math.min(100, provider.progress + Math.random() * 20);
          if (provider.progress >= 100) {
            provider.status = 'done';
            provider.duration = Math.floor(Math.random() * 60) + 30; // 30-90 seconds
            completed++;
          }
        }
      });

      setSwarmState(prev => ({
        ...prev,
        progress: {
          ...initialProgress,
          providers,
          consensusStatus: completed === providers.length ? 'Complete' : `Awaiting ${providers.length - completed} providers...`
        }
      }));

      if (completed === providers.length) {
        clearInterval(updateInterval);
        setTimeout(() => {
          setSwarmState(prev => ({
            ...prev,
            running: false,
            progress: undefined
          }));
        }, 3000);
      }
    }, 1000);
  };

  const updateTask = (task: string) => {
    setSwarmState(prev => ({ ...prev, task }));
  };

  const updateMode = (mode: SwarmMode) => {
    setSwarmState(prev => ({ ...prev, mode }));
  };

  const updateContract = (contract: ContractLevel) => {
    setSwarmState(prev => ({ ...prev, contract }));
  };

  const toggleProvider = (providerName: string) => {
    setSwarmState(prev => ({
      ...prev,
      providers: prev.providers.map(p =>
        p.name === providerName ? { ...p, selected: !p.selected } : p
      )
    }));
  };

  if (swarmState.running && swarmState.progress) {
    return (
      <SwarmProgress 
        progress={swarmState.progress}
        task={swarmState.task}
        mode={swarmState.mode}
        onCancel={() => setSwarmState(prev => ({ ...prev, running: false, progress: undefined }))}
      />
    );
  }

  const canStart = swarmState.task.trim().length > 0 && 
                   swarmState.providers.some(p => p.selected);

  return (
    <Box flexDirection="column" height="100%">
      <Box padding={1} borderStyle="single" borderColor="blue">
        <Text bold color="blue">SWARM ORCHESTRATOR</Text>
        <Box marginLeft={20}>
          <Text dimColor>[Tab] Next Field</Text>
          <Text dimColor> | </Text>
          <Text dimColor>[Enter] Start</Text>
          <Text dimColor> | </Text>
          <Text dimColor>[Esc] Reset Focus</Text>
        </Box>
      </Box>

      <Box flexGrow={1} paddingX={2} paddingY={1}>
        {/* Mode Selection */}
        <Box marginBottom={1}>
          <ModeSelector
            mode={swarmState.mode}
            contract={swarmState.contract}
            focused={focusedField === 'mode'}
            onModeChange={updateMode}
            onContractChange={updateContract}
          />
        </Box>

        {/* Task Input */}
        <Box marginBottom={1}>
          <TaskInput
            task={swarmState.task}
            focused={focusedField === 'task'}
            onTaskChange={updateTask}
          />
        </Box>

        {/* Provider Selection */}
        <Box marginBottom={2}>
          <ProviderSelector
            providers={swarmState.providers}
            focused={focusedField === 'providers'}
            onToggleProvider={toggleProvider}
          />
        </Box>

        {/* Start Button */}
        <Box paddingTop={1} borderStyle="single" borderTop borderColor="gray">
          <Box 
            paddingX={2} 
            paddingY={1}
            borderStyle={focusedField === 'start' ? 'single' : undefined}
            borderColor={focusedField === 'start' ? 'green' : undefined}
          >
            <Text 
              bold 
              color={canStart ? (focusedField === 'start' ? 'black' : 'green') : 'gray'}
            >
              {canStart ? '🚀 START SWARM' : '⚠ Select task and providers to start'}
            </Text>
          </Box>
          
          {canStart && (
            <Box marginTop={1}>
              <Text dimColor>
                Task: "{swarmState.task.slice(0, 50)}{swarmState.task.length > 50 ? '...' : ''}" | 
                Mode: {swarmState.mode} | 
                Contract: {swarmState.contract} | 
                Providers: {swarmState.providers.filter(p => p.selected).length}
              </Text>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
};