// @ts-nocheck
// src/ui/components/ThinkingBlock.tsx
import React, { useState } from 'react';
import { Box, Text, Newline } from 'ink';

interface ThinkingBlockProps {
  steps: string[];
}

export const ThinkingBlock: React.FC<ThinkingBlockProps> = ({ steps }) => {
  const [expanded, setExpanded] = useState<boolean>(false);

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="#9945FF">Thinking</Text>
        <Text color="#0a0a0a" onPress={() => setExpanded(!expanded)}>
          {expanded ? '[-]' : '[+]'}
        </Text>
      </Box>
      {expanded && (
        <Box flexDirection="column" marginLeft={2}>
          {steps.map((step, i) => (
            <Box key={i}>
              <Text color="#00FF41">{i + 1}.</Text>
              <Text color="#0a0a0a">{step}</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};
