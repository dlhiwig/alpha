// @ts-nocheck
import React from 'react';
import { Box, Text } from 'ink';

export const Header: React.FC = () => {
  return (
    <Box flexDirection="column" borderStyle="single" borderBottom={false}>
      <Box justifyContent="space-between" paddingX={1}>
        <Text color="cyan" bold>
          🦊 SUPERCLAW v2.3.0 SINGULARITY
        </Text>
        <Text color="gray">
          [?] Help  [q] Quit
        </Text>
      </Box>
      <Box paddingX={1} paddingY={1} justifyContent="center">
        <Box flexDirection="column">
          <Text color="magenta">
            ███████╗██╗   ██╗██████╗ ███████╗██████╗  ██████╗██╗      █████╗
          </Text>
          <Text color="magenta">
            ██╔════╝██║   ██║██╔══██╗██╔════╝██╔══██╗██╔════╝██║     ██╔══██╗
          </Text>
          <Text color="magenta">
            ███████╗██║   ██║██████╔╝█████╗  ██████╔╝██║     ██║     ███████║
          </Text>
          <Text color="magenta">
            ╚════██║██║   ██║██╔═══╝ ██╔══╝  ██╔══██╗██║     ██║     ██╔══██║
          </Text>
          <Text color="magenta">
            ███████║╚██████╔╝██║     ███████╗██║  ██║╚██████╗███████╗██║  ██║
          </Text>
          <Text color="magenta">
            ╚══════╝ ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═╝ ╚═════╝╚══════╝╚═╝  ╚═╝
          </Text>
          <Text color="gray" dimColor>
                    🧠 Kubernetes of Agents • SKYNET SINGULARITY
          </Text>
        </Box>
      </Box>
    </Box>
  );
};