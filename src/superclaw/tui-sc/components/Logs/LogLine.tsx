import React from 'react';
import { Text } from 'ink';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  source: string;
  message: string;
}

interface LogLineProps {
  entry: LogEntry;
}

const getLevelColor = (level: LogLevel): string => {
  switch (level) {
    case 'info':
      return 'blue';
    case 'warn':
      return 'yellow';
    case 'error':
      return 'red';
    case 'debug':
      return 'gray';
    default:
      return 'white';
  }
};

const formatTimestamp = (timestamp: Date): string => {
  return timestamp.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }) + '.' + timestamp.getMilliseconds().toString().padStart(3, '0');
};

export const LogLine: React.FC<LogLineProps> = ({ entry }) => {
  const levelColor = getLevelColor(entry.level);
  const timestamp = formatTimestamp(entry.timestamp);
  const levelText = entry.level.toUpperCase().padEnd(5);

  return (
    <Text>
      <Text dimColor>{timestamp}</Text>
      <Text> </Text>
      <Text color={levelColor} bold>{levelText}</Text>
      <Text> </Text>
      <Text color="magenta">[{entry.source}]</Text>
      <Text> </Text>
      <Text>{entry.message}</Text>
    </Text>
  );
};