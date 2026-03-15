// @ts-nocheck
import React from 'react';
import { Box, Text } from 'ink';

export type ConfigFieldType = 'text' | 'dropdown' | 'number' | 'money' | 'percentage';

export interface ConfigOption {
  value: string;
  label: string;
}

interface ConfigFieldProps {
  label: string;
  value: string;
  type?: ConfigFieldType;
  options?: ConfigOption[];
  isSelected: boolean;
  isEditing: boolean;
  width?: number;
  prefix?: string;
  suffix?: string;
  placeholder?: string;
}

export const ConfigField: React.FC<ConfigFieldProps> = ({
  label,
  value,
  type = 'text',
  options = [],
  isSelected,
  isEditing,
  width = 20,
  prefix = '',
  suffix = '',
  placeholder = ''
}) => {
  const displayValue = () => {
    if (!value && placeholder) {
      return placeholder;
    }

    if (type === 'dropdown' && options.length > 0) {
      const option = options.find(opt => opt.value === value);
      return option ? option.label : value;
    }

    return `${prefix}${value}${suffix}`;
  };

  const getInputBoxStyle = () => {
    if (isEditing) {
      return {
        borderStyle: 'single' as const,
        borderColor: 'green'
      };
    }
    
    if (isSelected) {
      return {
        borderStyle: 'single' as const,
        borderColor: 'blue'
      };
    }
    
    return {
      borderStyle: 'single' as const,
      borderColor: 'gray'
    };
  };

  const renderValue = () => {
    const val = displayValue();
    const color = isEditing ? 'green' : isSelected ? 'blue' : 'white';
    const bgColor = isEditing ? undefined : undefined;

    if (type === 'dropdown' && !isEditing) {
      return (
        <Text color={color} backgroundColor={bgColor}>
          {val} {isSelected ? '▼' : ''}
        </Text>
      );
    }

    return (
      <Text color={color} backgroundColor={bgColor}>
        {val}
        {isEditing && <Text color="green">█</Text>}
      </Text>
    );
  };

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Box width={25}>
          <Text bold={isSelected} color={isSelected ? 'blue' : 'white'}>
            {label}:
          </Text>
        </Box>
        <Box {...getInputBoxStyle()} paddingX={1} width={width + 2}>
          {renderValue()}
        </Box>
      </Box>
      {isEditing && type === 'dropdown' && options.length > 0 && (
        <Box flexDirection="column" marginLeft={25} marginTop={1}>
          <Box borderStyle="single" borderColor="green" flexDirection="column" paddingX={1}>
            {options.map((option, index) => (
              <Text
                key={option.value}
                color={option.value === value ? 'green' : 'white'}
                bold={option.value === value}
              >
                {option.value === value ? '▶ ' : '  '}{option.label}
              </Text>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
};