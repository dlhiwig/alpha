import React from 'react';
import { Box, Text, useInput } from 'ink';
import { SwarmMode, ContractLevel } from './SwarmView';

interface ModeSelectorProps {
  mode: SwarmMode;
  contract: ContractLevel;
  focused: boolean;
  onModeChange: (mode: SwarmMode) => void;
  onContractChange: (contract: ContractLevel) => void;
}

const MODES: { value: SwarmMode; label: string; description: string }[] = [
  { 
    value: 'fanout', 
    label: 'Fanout', 
    description: 'Run all providers in parallel, merge results' 
  },
  { 
    value: 'consensus', 
    label: 'Consensus', 
    description: 'Run all providers, find agreement between responses' 
  },
  { 
    value: 'pipeline', 
    label: 'Pipeline', 
    description: 'Run providers sequentially, each builds on previous' 
  },
  { 
    value: 'debate', 
    label: 'Debate', 
    description: 'Providers critique each other\'s responses' 
  }
];

const CONTRACTS: { value: ContractLevel; label: string; description: string }[] = [
  { 
    value: 'loose', 
    label: 'Loose', 
    description: 'Any response format accepted' 
  },
  { 
    value: 'standard', 
    label: 'Standard', 
    description: 'Structured response expected' 
  },
  { 
    value: 'strict', 
    label: 'Strict', 
    description: 'Judge validates all responses' 
  }
];

export const ModeSelector: React.FC<ModeSelectorProps> = ({
  mode,
  contract,
  focused,
  onModeChange,
  onContractChange
}) => {
  const [focusedSection, setFocusedSection] = React.useState<'mode' | 'contract'>('mode');
  
  useInput((input, key) => {
    if (!focused) return;

    if (key.leftArrow || key.rightArrow) {
      setFocusedSection(prev => prev === 'mode' ? 'contract' : 'mode');
      return;
    }

    if (focusedSection === 'mode') {
      if (input === '1') onModeChange('fanout');
      else if (input === '2') onModeChange('consensus');
      else if (input === '3') onModeChange('pipeline');
      else if (input === '4') onModeChange('debate');
    } else {
      if (input === '1') onContractChange('loose');
      else if (input === '2') onContractChange('standard');
      else if (input === '3') onContractChange('strict');
    }
  }, { isActive: focused });

  return (
    <Box flexDirection="row" marginBottom={1}>
      {/* Mode Selection */}
      <Box flexDirection="column" marginRight={4}>
        <Box marginBottom={1}>
          <Text bold color={focused && focusedSection === 'mode' ? 'yellow' : 'white'}>
            MODE{focused && focusedSection === 'mode' ? ' (focused)' : ''}:
          </Text>
        </Box>
        
        <Box flexDirection="column">
          {MODES.map((modeOption, index) => {
            const isSelected = mode === modeOption.value;
            const isFocused = focused && focusedSection === 'mode';
            
            return (
              <Box key={modeOption.value} marginBottom={0}>
                <Text color={isFocused ? 'yellow' : 'white'}>
                  {index + 1}. {isSelected ? '●' : '○'} {modeOption.label}
                </Text>
                {isSelected && (
                  <Box marginLeft={1}>
                    <Text dimColor>
                      - {modeOption.description}
                    </Text>
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
        
        {focused && focusedSection === 'mode' && (
          <Box marginTop={1}>
            <Text dimColor>
              Press 1-4 to select mode, ← → to switch sections
            </Text>
          </Box>
        )}
      </Box>

      {/* Contract Level */}
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold color={focused && focusedSection === 'contract' ? 'yellow' : 'white'}>
            CONTRACT{focused && focusedSection === 'contract' ? ' (focused)' : ''}:
          </Text>
        </Box>
        
        <Box flexDirection="column">
          {CONTRACTS.map((contractOption, index) => {
            const isSelected = contract === contractOption.value;
            const isFocused = focused && focusedSection === 'contract';
            
            return (
              <Box key={contractOption.value} marginBottom={0}>
                <Text color={isFocused ? 'yellow' : 'white'}>
                  {index + 1}. {isSelected ? '●' : '○'} {contractOption.label}
                </Text>
                {isSelected && (
                  <Box marginLeft={1}>
                    <Text dimColor>
                      - {contractOption.description}
                    </Text>
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
        
        {focused && focusedSection === 'contract' && (
          <Box marginTop={1}>
            <Text dimColor>
              Press 1-3 to select contract level
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};