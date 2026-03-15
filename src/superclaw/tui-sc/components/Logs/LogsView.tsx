import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { LogLine, LogLevel, LogEntry } from './LogLine';

export type LogFilter = 'all' | 'info' | 'warn' | 'error' | 'debug';

export const LogsView: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<LogFilter>('all');
  const [isPaused, setIsPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isStreaming, setIsStreaming] = useState(true);
  const intervalRef = useRef<NodeJS.Timeout>();

  // Mock log sources
  const sources = ['swarm', 'claude', 'gemini', 'deepseek', 'gateway', 'ollama', 'judge'];
  const sampleMessages = {
    info: [
      'Starting consensus task {id}',
      'Sending request to {provider}',
      'Response complete ({duration}s, {tokens} tokens)',
      'All providers complete, starting consensus',
      'Provider health check: all green',
      'Gateway server listening on port {port}',
      'Task queue processed: {count} tasks'
    ],
    warn: [
      'Provider response slower than expected ({duration}s)',
      'Rate limit approaching for {provider}',
      'Disk space warning: {percent}% used',
      'Memory usage high: {memory}MB',
      'Queue backup detected: {count} pending'
    ],
    error: [
      'Rate limit exceeded, retrying...',
      'Provider {provider} connection failed',
      'Task {id} failed with error: {error}',
      'Authentication error for {provider}',
      'Network timeout after {duration}s',
      'Out of memory error'
    ],
    debug: [
      'First token received',
      'Still streaming... ({duration}s)',
      'Comparing responses for agreement',
      'Cache hit for provider {provider}',
      'WebSocket connection established',
      'Garbage collection triggered'
    ]
  };

  // Generate mock log entry
  const generateMockLog = useCallback((): LogEntry => {
    const levels: LogLevel[] = ['info', 'warn', 'error', 'debug'];
    const weights = [0.6, 0.2, 0.1, 0.1]; // More info logs
    
    let level: LogLevel = 'info';
    const rand = Math.random();
    let cumulative = 0;
    for (let i = 0; i < levels.length; i++) {
      cumulative += weights[i];
      if (rand <= cumulative) {
        level = levels[i];
        break;
      }
    }

    const source = sources[Math.floor(Math.random() * sources.length)];
    const messages = sampleMessages[level];
    let message = messages[Math.floor(Math.random() * messages.length)];

    // Replace placeholders
    message = message
      .replace('{id}', `sw-${String(Math.floor(Math.random() * 999)).padStart(3, '0')}`)
      .replace('{provider}', sources[Math.floor(Math.random() * sources.length)])
      .replace('{duration}', (Math.random() * 60 + 1).toFixed(1))
      .replace('{tokens}', String(Math.floor(Math.random() * 3000 + 500)))
      .replace('{port}', '18800')
      .replace('{count}', String(Math.floor(Math.random() * 10 + 1)))
      .replace('{percent}', String(Math.floor(Math.random() * 30 + 70)))
      .replace('{memory}', String(Math.floor(Math.random() * 512 + 256)))
      .replace('{error}', 'timeout');

    return {
      timestamp: new Date(),
      level,
      source,
      message
    };
  }, []);

  // Start mock log streaming
  useEffect(() => {
    if (!isPaused && isStreaming) {
      intervalRef.current = setInterval(() => {
        const newLog = generateMockLog();
        setLogs(prev => [...prev.slice(-99), newLog]); // Keep last 100 logs
      }, Math.random() * 3000 + 1000); // Random interval 1-4 seconds
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isPaused, isStreaming, generateMockLog]);

  const filteredLogs = logs.filter(log => {
    if (filter === 'all') return true;
    return log.level === filter;
  });

  const getFilterCounts = () => {
    const counts = {
      all: logs.length,
      info: logs.filter(l => l.level === 'info').length,
      warn: logs.filter(l => l.level === 'warn').length,
      error: logs.filter(l => l.level === 'error').length,
      debug: logs.filter(l => l.level === 'debug').length
    };
    return counts;
  };

  useInput((input, key) => {
    if (input === 'p') {
      setIsPaused(!isPaused);
    }

    if (input === 'c') {
      setLogs([]);
    }

    if (input === 'f') {
      const filters: LogFilter[] = ['all', 'info', 'warn', 'error', 'debug'];
      const currentIndex = filters.indexOf(filter);
      const nextIndex = (currentIndex + 1) % filters.length;
      setFilter(filters[nextIndex]);
    }

    if (input === 's') {
      setAutoScroll(!autoScroll);
    }

    if (input === 'q' && key.ctrl) {
      setIsStreaming(false);
    }
  });

  const counts = getFilterCounts();

  return (
    <Box flexDirection="column" height="100%">
      {/* Header */}
      <Box padding={1} borderStyle="single" borderColor="green">
        <Text bold color="green">LOGS</Text>
        <Box marginLeft={15}>
          <Text dimColor>[p] {isPaused ? 'Resume' : 'Pause'}</Text>
          <Text dimColor> | </Text>
          <Text dimColor>[c] Clear</Text>
          <Text dimColor> | </Text>
          <Text dimColor>[f] Filter</Text>
          <Text dimColor> | </Text>
          <Text dimColor>[s] Auto-scroll</Text>
        </Box>
      </Box>

      {/* Filter bar */}
      <Box paddingX={1} paddingY={0}>
        <Text>Level: </Text>
        <Text color={filter === 'all' ? 'green' : 'gray'} bold={filter === 'all'}>
          [All:{counts.all}]
        </Text>
        <Text> </Text>
        <Text color={filter === 'info' ? 'blue' : 'gray'} bold={filter === 'info'}>
          [Info:{counts.info}]
        </Text>
        <Text> </Text>
        <Text color={filter === 'warn' ? 'yellow' : 'gray'} bold={filter === 'warn'}>
          [Warn:{counts.warn}]
        </Text>
        <Text> </Text>
        <Text color={filter === 'error' ? 'red' : 'gray'} bold={filter === 'error'}>
          [Error:{counts.error}]
        </Text>
        <Text> </Text>
        <Text color={filter === 'debug' ? 'gray' : 'dimColor'} bold={filter === 'debug'}>
          [Debug:{counts.debug}]
        </Text>
        
        <Box marginLeft={10}>
          <Text dimColor>Auto-scroll: </Text>
          <Text color={autoScroll ? 'green' : 'red'} bold>
            [{autoScroll ? 'ON' : 'OFF'}]
          </Text>
          <Text> </Text>
          <Text color={isPaused ? 'yellow' : 'green'}>
            {isPaused ? '⏸ PAUSED' : '▶ STREAMING'}
          </Text>
        </Box>
      </Box>

      {/* Log content */}
      <Box flexDirection="column" flexGrow={1} paddingX={1} marginTop={1}>
        {filteredLogs.length === 0 ? (
          <Box justifyContent="center" alignItems="center" height={10}>
            <Text dimColor>
              {logs.length === 0 ? 'No logs yet...' : `No ${filter} logs found`}
            </Text>
          </Box>
        ) : (
          <Box flexDirection="column">
            {filteredLogs.slice(-20).map((log, index) => (
              <LogLine key={index} entry={log} />
            ))}
            {autoScroll && !isPaused && (
              <Text dimColor>▼</Text>
            )}
          </Box>
        )}
      </Box>

      {/* Status bar */}
      <Box paddingX={1} paddingY={0} borderTop borderStyle="single" borderColor="gray">
        <Text dimColor>
          Total: {logs.length} | Filtered: {filteredLogs.length} | Status: {isPaused ? 'Paused' : 'Streaming'}
        </Text>
        {filteredLogs.length > 20 && (
          <Text dimColor> | Showing last 20 entries</Text>
        )}
      </Box>
    </Box>
  );
};