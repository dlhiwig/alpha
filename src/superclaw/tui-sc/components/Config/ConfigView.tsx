// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { ConfigField, ConfigOption } from './ConfigField';

export interface ConfigData {
  // General
  gatewayPort: string;
  logLevel: string;
  defaultSwarmMode: string;
  maxConcurrent: string;
  
  // Costs & Limits
  dailyBudget: string;
  perTaskLimit: string;
  rateLimitBuffer: string;
  
  // Model Preferences
  primaryModel: string;
  fallbackModel: string;
  localModel: string;
}

interface ConfigSection {
  name: string;
  fields: string[];
}

const LOG_LEVEL_OPTIONS: ConfigOption[] = [
  { value: 'debug', label: 'Debug' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warn' },
  { value: 'error', label: 'Error' }
];

const SWARM_MODE_OPTIONS: ConfigOption[] = [
  { value: 'consensus', label: 'Consensus' },
  { value: 'fanout', label: 'Fanout' },
  { value: 'pipeline', label: 'Pipeline' },
  { value: 'debate', label: 'Debate' }
];

const MODEL_OPTIONS: ConfigOption[] = [
  { value: 'claude-sonnet-4', label: 'Claude Sonnet 4' },
  { value: 'claude-opus-4', label: 'Claude Opus 4' },
  { value: 'gemini-pro', label: 'Gemini Pro' },
  { value: 'gemini-flash', label: 'Gemini Flash' },
  { value: 'deepseek-chat', label: 'DeepSeek Chat' },
  { value: 'gpt-4', label: 'GPT-4' }
];

const LOCAL_MODEL_OPTIONS: ConfigOption[] = [
  { value: 'dolphin-llama3:8b', label: 'Dolphin Llama 3 8B' },
  { value: 'dolphin-llama3:70b', label: 'Dolphin Llama 3 70B' },
  { value: 'llama3:8b', label: 'Llama 3 8B' },
  { value: 'llama3:70b', label: 'Llama 3 70B' },
  { value: 'codellama:13b', label: 'Code Llama 13B' }
];

const CONFIG_SECTIONS: ConfigSection[] = [
  {
    name: 'GENERAL',
    fields: ['gatewayPort', 'logLevel', 'defaultSwarmMode', 'maxConcurrent']
  },
  {
    name: 'COSTS & LIMITS',
    fields: ['dailyBudget', 'perTaskLimit', 'rateLimitBuffer']
  },
  {
    name: 'MODEL PREFERENCES',
    fields: ['primaryModel', 'fallbackModel', 'localModel']
  }
];

export const ConfigView: React.FC = () => {
  const [config, setConfig] = useState<ConfigData>({
    gatewayPort: '18800',
    logLevel: 'info',
    defaultSwarmMode: 'consensus',
    maxConcurrent: '4',
    dailyBudget: '50.00',
    perTaskLimit: '5.00',
    rateLimitBuffer: '20',
    primaryModel: 'claude-sonnet-4',
    fallbackModel: 'gemini-pro',
    localModel: 'dolphin-llama3:8b'
  });

  const [originalConfig, setOriginalConfig] = useState<ConfigData>({ ...config });
  const [selectedFieldIndex, setSelectedFieldIndex] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [dropdownIndex, setDropdownIndex] = useState(0);

  const allFields = CONFIG_SECTIONS.flatMap(section => section.fields);
  const currentField = allFields[selectedFieldIndex];

  useEffect(() => {
    // Load config from file or API
    // For now, using defaults
    setOriginalConfig({ ...config });
  }, []);

  useEffect(() => {
    // Check if config has changes
    const changed = JSON.stringify(config) !== JSON.stringify(originalConfig);
    setHasChanges(changed);
  }, [config, originalConfig]);

  const getFieldOptions = (fieldName: string): ConfigOption[] => {
    switch (fieldName) {
      case 'logLevel':
        return LOG_LEVEL_OPTIONS;
      case 'defaultSwarmMode':
        return SWARM_MODE_OPTIONS;
      case 'primaryModel':
      case 'fallbackModel':
        return MODEL_OPTIONS;
      case 'localModel':
        return LOCAL_MODEL_OPTIONS;
      default:
        return [];
    }
  };

  const getFieldType = (fieldName: string) => {
    if (['logLevel', 'defaultSwarmMode', 'primaryModel', 'fallbackModel', 'localModel'].includes(fieldName)) {
      return 'dropdown';
    }
    if (fieldName === 'dailyBudget' || fieldName === 'perTaskLimit') {
      return 'money';
    }
    if (fieldName === 'rateLimitBuffer') {
      return 'percentage';
    }
    return 'text';
  };

  const getFieldPrefix = (fieldName: string): string => {
    if (fieldName === 'dailyBudget' || fieldName === 'perTaskLimit') {
      return '$';
    }
    return '';
  };

  const getFieldSuffix = (fieldName: string): string => {
    if (fieldName === 'rateLimitBuffer') {
      return '%';
    }
    return '';
  };

  const saveConfig = async () => {
    // TODO: Save to file or API
    setOriginalConfig({ ...config });
    setHasChanges(false);
    setShowSaved(true);
    setTimeout(() => setShowSaved(false), 2000);
  };

  const discardChanges = () => {
    setConfig({ ...originalConfig });
    setHasChanges(false);
    setIsEditing(false);
  };

  useInput((input, key) => {
    if (showSaved) {return;} // Ignore input while showing saved message

    if (isEditing) {
      const fieldType = getFieldType(currentField);
      const options = getFieldOptions(currentField);

      if (fieldType === 'dropdown') {
        if (key.upArrow && dropdownIndex > 0) {
          setDropdownIndex(dropdownIndex - 1);
        }
        if (key.downArrow && dropdownIndex < options.length - 1) {
          setDropdownIndex(dropdownIndex + 1);
        }
        if (key.return) {
          const selectedOption = options[dropdownIndex];
          setConfig(prev => ({ ...prev, [currentField]: selectedOption.value }));
          setIsEditing(false);
          setDropdownIndex(0);
        }
      } else {
        if (key.backspace || key.delete) {
          setEditValue(editValue.slice(0, -1));
        } else if (input && /^[a-zA-Z0-9.\-_$%]$/.test(input)) {
          setEditValue(editValue + input);
        }

        if (key.return) {
          setConfig(prev => ({ ...prev, [currentField]: editValue }));
          setIsEditing(false);
          setEditValue('');
        }
      }

      if (key.escape) {
        setIsEditing(false);
        setEditValue('');
        setDropdownIndex(0);
      }
      return;
    }

    // Navigation
    if (key.tab || key.downArrow) {
      setSelectedFieldIndex((prev) => (prev + 1) % allFields.length);
    }

    if (key.upArrow || (key.shift && key.tab)) {
      setSelectedFieldIndex((prev) => (prev - 1 + allFields.length) % allFields.length);
    }

    // Edit field
    if (key.return) {
      const fieldType = getFieldType(currentField);
      if (fieldType === 'dropdown') {
        const options = getFieldOptions(currentField);
        const currentIndex = options.findIndex(opt => opt.value === config[currentField as keyof ConfigData]);
        setDropdownIndex(Math.max(0, currentIndex));
      } else {
        setEditValue(config[currentField as keyof ConfigData]);
      }
      setIsEditing(true);
    }

    // Save changes
    if (input === 's' && hasChanges) {
      saveConfig();
    }

    // Discard changes
    if (key.escape && hasChanges) {
      discardChanges();
    }
  });

  const renderSection = (section: ConfigSection) => {
    return (
      <Box key={section.name} flexDirection="column" marginBottom={2}>
        <Box marginBottom={1}>
          <Text bold color="cyan">
            {section.name}
          </Text>
        </Box>
        <Box flexDirection="column" marginLeft={2}>
          {section.fields.map((fieldName) => {
            const fieldIndex = allFields.indexOf(fieldName);
            const isSelected = selectedFieldIndex === fieldIndex;
            const isCurrentlyEditing = isEditing && isSelected;

            return (
              <ConfigField
                key={fieldName}
                label={fieldName.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                value={config[fieldName as keyof ConfigData]}
                type={getFieldType(fieldName)}
                options={getFieldOptions(fieldName)}
                isSelected={isSelected}
                isEditing={isCurrentlyEditing}
                width={20}
                prefix={getFieldPrefix(fieldName)}
                suffix={getFieldSuffix(fieldName)}
                placeholder="Not set"
              />
            );
          })}
        </Box>
      </Box>
    );
  };

  if (showSaved) {
    return (
      <Box flexDirection="column" height="100%" justifyContent="center" alignItems="center">
        <Box borderStyle="single" borderColor="green" paddingX={2} paddingY={1}>
          <Text color="green" bold>✓ Configuration Saved Successfully!</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height="100%">
      {/* Header */}
      <Box padding={1} borderStyle="single" borderColor="cyan">
        <Text bold color="cyan">CONFIGURATION</Text>
        <Box marginLeft={20}>
          {hasChanges && (
            <>
              <Text color="yellow" bold>[s] Save Changes</Text>
              <Text dimColor> | </Text>
              <Text color="red">[Esc] Discard</Text>
              <Text dimColor> | </Text>
            </>
          )}
          <Text dimColor>[Tab] Navigate</Text>
          <Text dimColor> | </Text>
          <Text dimColor>[Enter] Edit</Text>
        </Box>
      </Box>

      {/* Content */}
      <Box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
        {CONFIG_SECTIONS.map(renderSection)}
      </Box>

      {/* Status bar */}
      <Box paddingX={1} paddingY={0} borderTop borderStyle="single" borderColor="gray">
        <Text>
          Field: {currentField.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
          {hasChanges && (
            <>
              <Text color="yellow"> | </Text>
              <Text color="yellow" bold>UNSAVED CHANGES</Text>
            </>
          )}
        </Text>
        <Box marginLeft={10}>
          <Text dimColor>
            [Tab] Next | [Enter] Edit | [s] Save
            {hasChanges && <Text color="red"> | [Esc] Discard</Text>}
          </Text>
        </Box>
      </Box>
    </Box>
  );
};