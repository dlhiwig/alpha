import { useInput } from 'ink';
import { useCallback } from 'react';

export interface KeyboardHandlers {
  onTabChange?: (tab: number) => void;
  onHelp?: () => void;
  onQuit?: () => void;
  onRefresh?: () => void;
  onSearch?: () => void;
  onCustomKey?: (input: string, key: any) => void;
}

export const useKeyboard = (handlers: KeyboardHandlers) => {
  useInput(useCallback((input: string, key: any) => {
    // Handle Ctrl+C for exit
    if (key.ctrl && input === 'c') {
      if (handlers.onQuit) {
        handlers.onQuit();
      } else {
        process.exit(0);
      }
      return;
    }

    // Handle 'q' for quit
    if (input === 'q') {
      if (handlers.onQuit) {
        handlers.onQuit();
      } else {
        process.exit(0);
      }
      return;
    }

    // Handle '?' for help
    if (input === '?' && handlers.onHelp) {
      handlers.onHelp();
      return;
    }

    // Handle 'r' for refresh
    if (input === 'r' && handlers.onRefresh) {
      handlers.onRefresh();
      return;
    }

    // Handle '/' for search
    if (input === '/' && handlers.onSearch) {
      handlers.onSearch();
      return;
    }

    // Handle tab navigation (1-6)
    const tabNumber = parseInt(input);
    if (tabNumber >= 1 && tabNumber <= 6 && handlers.onTabChange) {
      handlers.onTabChange(tabNumber);
      return;
    }

    // Handle custom keys
    if (handlers.onCustomKey) {
      handlers.onCustomKey(input, key);
    }
  }, [handlers]));
};

export default useKeyboard;