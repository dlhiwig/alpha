// @ts-nocheck
// src/ui/TUI.tsx
import React from 'react';
import { Box, Text, Newline, useApp, useInput } from 'ink';
import { useSuperclaw } from './hooks/useSuperclaw';
import { SlashCommand } from './components/SlashCommand';
import { ThinkingBlock } from './components/ThinkingBlock';
import { ToolCard } from './components/ToolCard';

const TUI: React.FC = () => {
  const { exit } = useApp();
  const { messages, agents, synapse, lattice, status, memory } = useSuperclaw();

  useInput((input, key) => {
    if (key.ctrl && key.name === 'c') {
      exit();
    }
  });

  return (
    <Box flexDirection="column" height="100%">
      <Box borderStyle="single" borderColor="#9945FF" paddingX={2} paddingY={1}>
        <Text color="#00FF41">SuperClaw</Text>
        <Newline />
        <Text color="#0a0a0a">Gateway status: {status.online ? 'Online' : 'Offline'}</Text>
        <Text color="#0a0a0a">Providers: {status.providers}</Text>
        <Text color="#0a0a0a">Active Agents: {agents.length} / 75</Text>
        <Text color="#0a0a0a">Uptime: {status.uptime}</Text>
      </Box>

      <Box flexGrow={1} flexDirection="row">
        <Box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
          {messages.map((msg, i) => (
            <Box key={i}>
              <Text color={msg.type === 'input' ? '#FF073A' : '#00FF41'}>{msg.text}</Text>
              {msg.type === 'thinking' && <ThinkingBlock steps={msg.steps} />}
            </Box>
          ))}
        </Box>

        <Box borderStyle="single" borderColor="#9945FF" paddingX={2} paddingY={1}>
          <Text color="#9945FF">AgentBus Monitor</Text>
          <Newline />
          <Text color="#0a0a0a">Agents: {agents.length}</Text>
          <Text color="#0a0a0a">Synapse: {synapse} msg/sec</Text>
          <Text color="#0a0a0a">Lattice: {lattice.nodes} nodes, {lattice.edges} edges</Text>
        </Box>
      </Box>

      <Box borderStyle="single" borderColor="#9945FF" paddingX={2} paddingY={1}>
        <Text color="#0a0a0a">Myelin cache: {memory.myelin} MB</Text>
        <Text color="#0a0a0a">Substrate: {memory.substrate} MB</Text>
      </Box>

      <SlashCommand />
    </Box>
  );
};

export default TUI;
