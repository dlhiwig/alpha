import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { SwarmProvider } from './SwarmView';

interface ProviderSelectorProps {
  providers: SwarmProvider[];
  focused: boolean;
  onToggleProvider: (providerName: string) => void;
}

export const ProviderSelector: React.FC<ProviderSelectorProps> = ({
  providers,
  focused,
  onToggleProvider
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (!focused) {return;}

    if (key.upArrow && selectedIndex > 0) {
      setSelectedIndex(selectedIndex - 1);
    } else if (key.downArrow && selectedIndex < providers.length - 1) {
      setSelectedIndex(selectedIndex + 1);
    } else if (key.return || input === ' ') {
      const provider = providers[selectedIndex];
      if (provider.available) {
        onToggleProvider(provider.name);
      }
    }
  }, { isActive: focused });

  const availableProviders = providers.filter(p => p.available);
  const selectedProviders = providers.filter(p => p.selected);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box marginBottom={1}>
        <Text bold color={focused ? 'yellow' : 'white'}>
          PROVIDERS TO USE{focused ? ' (focused)' : ''}:
        </Text>
        <Box marginLeft={2}>
          <Text dimColor>
            ({selectedProviders.length} selected, {availableProviders.length} available)
          </Text>
        </Box>
      </Box>
      
      <Box flexDirection="row" flexWrap="wrap">
        {providers.map((provider, index) => {
          const isCurrentlySelected = index === selectedIndex && focused;
          const isChecked = provider.selected;
          const isAvailable = provider.available;
          
          let textColor: string = 'white';
          let backgroundColor: string | undefined = undefined;
          
          if (!isAvailable) {
            textColor = 'gray';
          } else if (isCurrentlySelected) {
            backgroundColor = 'yellow';
            textColor = 'black';
          } else if (isChecked) {
            textColor = 'green';
          }
          
          return (
            <Box 
              key={provider.name} 
              marginRight={3}
              marginBottom={1}
              paddingX={isCurrentlySelected ? 1 : 0}
            >
              <Text color={textColor} bold={isCurrentlySelected}>
                {isChecked ? '[✓]' : '[ ]'} {provider.displayName}
                {!isAvailable && ' (offline)'}
              </Text>
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        {selectedProviders.length === 0 ? (
          <Text color="red">
            ⚠ No providers selected - swarm cannot start
          </Text>
        ) : (
          <Text color="green">
            ✓ {selectedProviders.length} provider{selectedProviders.length === 1 ? '' : 's'} selected
          </Text>
        )}
      </Box>

      {focused && (
        <Box marginTop={1}>
          <Text dimColor>
            Use ↑↓ to navigate, Space/Enter to toggle selection
          </Text>
        </Box>
      )}
    </Box>
  );
};