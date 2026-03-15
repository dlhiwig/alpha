// src/ui/components/SlashCommand.tsx
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { useSuperclaw } from '../hooks/useSuperclaw';

export const SlashCommand: React.FC = () => {
  const [command, setCommand] = useState<string>('');
  const { handleCommand } = useSuperclaw();

  useInput((input, key) => {
    if (key.return) {
      handleCommand(command);
      setCommand('');
    } else {
      setCommand(input);
    }
  });

  return (
    <Box borderStyle="single" borderColor="#9945FF" paddingX={2} paddingY={1}>
      <Text color="#9945FF">/ {command}</Text>
    </Box>
  );
};
