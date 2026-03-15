// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { ProviderList } from './ProviderList';
import { ProviderDetails } from './ProviderDetails';

export interface ProviderInfo {
  name: string;
  status: 'online' | 'offline' | 'quota' | 'error';
  models: string[];
  latency?: number;
  costPer1K?: number;
  apiKey?: string;
  endpoint?: string;
  usageToday?: number;
  budgetLimit?: number;
  rateLimit?: {
    max: number;
    used: number;
  };
  lastError?: string;
}

export const ProvidersView: React.FC = () => {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showDetails, setShowDetails] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Mock data for now - will be replaced with real provider data
  useEffect(() => {
    const loadProviders = async () => {
      setIsLoading(true);
      // Simulate loading
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const mockProviders: ProviderInfo[] = [
        {
          name: 'anthropic',
          status: 'online',
          models: ['claude-opus-4-5', 'claude-sonnet-4'],
          latency: 342,
          costPer1K: 0.015,
          apiKey: 'sk-ant-...8U6gAA',
          endpoint: 'https://api.anthropic.com/v1',
          usageToday: 2.34,
          budgetLimit: 50.00,
          rateLimit: { max: 60, used: 40 }
        },
        {
          name: 'gemini',
          status: 'online',
          models: ['gemini-pro', 'gemini-flash'],
          latency: 287,
          costPer1K: 0.007,
          apiKey: 'AIza...configured',
          endpoint: 'https://generativelanguage.googleapis.com',
          usageToday: 1.23,
          budgetLimit: 25.00,
          rateLimit: { max: 60, used: 15 }
        },
        {
          name: 'ollama',
          status: 'online',
          models: ['llama3:8b', 'llama3:70b', 'dolphin-llama3:8b'],
          latency: 89,
          costPer1K: 0,
          endpoint: 'http://127.0.0.1:11434',
          usageToday: 0,
          budgetLimit: 0
        },
        {
          name: 'deepseek',
          status: 'offline',
          models: ['deepseek-chat', 'deepseek-coder'],
          latency: undefined,
          costPer1K: 0.002,
          lastError: 'Connection timeout'
        },
        {
          name: 'codex',
          status: 'quota',
          models: ['gpt-4o', 'o1-preview'],
          latency: undefined,
          costPer1K: 0.010,
          lastError: 'Quota exceeded'
        }
      ];
      
      setProviders(mockProviders);
      setIsLoading(false);
    };

    loadProviders();
  }, []);

  useInput((input, key) => {
    if (showDetails) {
      if (input === 'q' || key.escape) {
        setShowDetails(false);
        return;
      }
      return;
    }

    if (key.upArrow && selectedIndex > 0) {
      setSelectedIndex(selectedIndex - 1);
    }
    
    if (key.downArrow && selectedIndex < providers.length - 1) {
      setSelectedIndex(selectedIndex + 1);
    }

    if (key.return) {
      setShowDetails(true);
    }

    if (input === 't') {
      // Test all providers
      // TODO: Implement real provider testing
    }

    if (input === 'r') {
      // Refresh providers
      const loadProviders = async () => {
        setIsLoading(true);
        await new Promise(resolve => setTimeout(resolve, 300));
        setIsLoading(false);
      };
      loadProviders();
    }
  });

  if (isLoading) {
    return (
      <Box flexDirection="column" padding={2}>
        <Text>Loading providers...</Text>
      </Box>
    );
  }

  if (showDetails && providers[selectedIndex]) {
    return (
      <ProviderDetails 
        provider={providers[selectedIndex]} 
        onBack={() => setShowDetails(false)}
      />
    );
  }

  return (
    <Box flexDirection="column" height="100%">
      <Box padding={1} borderStyle="single" borderColor="blue">
        <Text bold color="blue">PROVIDER MANAGEMENT</Text>
        <Box marginLeft={20}>
          <Text dimColor>[t] Test All</Text>
          <Text dimColor> | </Text>
          <Text dimColor>[r] Refresh</Text>
          <Text dimColor> | </Text>
          <Text dimColor>[Enter] Details</Text>
        </Box>
      </Box>
      
      <Box flexGrow={1} flexDirection="column">
        <ProviderList 
          providers={providers} 
          selectedIndex={selectedIndex}
        />
        
        <Box padding={1} borderStyle="single" borderTop={false} borderColor="gray">
          <Text dimColor>
            {providers.filter(p => p.status === 'online').length} online, {' '}
            {providers.filter(p => p.status === 'offline').length} offline, {' '}
            {providers.filter(p => p.status === 'quota').length} quota issues
          </Text>
        </Box>
      </Box>
    </Box>
  );
};