// @ts-nocheck
import React from 'react';
import { render } from 'ink';
import { App } from './App.js';

/**
 * Launch the SuperClaw TUI
 */
export async function launchTUI(): Promise<void> {
  const { waitUntilExit } = render(<App />);
  await waitUntilExit();
}