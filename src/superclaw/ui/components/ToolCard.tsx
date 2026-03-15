// src/ui/components/ToolCard.tsx
import React, { useState } from 'react';
import { Box, Text, Newline } from 'ink';

interface ToolCardProps {
  title: string;
  result: string;
}

export const ToolCard: React.FC<ToolCardProps> = ({ title, result }) => {
  const [expanded, setExpanded] = useState<boolean>(false);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="#9945FF" paddingX={2} paddingY={1}>
      <Box>
        <Text color="#9945FF">{title}</Text>
        <Text color="#0a0a0a" onPress={() => setExpanded(!expanded)}>
          {expanded ? '[-]' : '[+]'}
        </Text>
      </Box>
      {expanded && (
        <Box flexDirection="column" marginLeft={2}>
          <Newline />
          <Text color="#0a0a0a">{result}</Text>
        </Box>
      )}
    </Box>
  );
};
