/**
 * Vitest configuration for Task Decomposer Narrative UI tests
 *
 * This configuration file sets up vitest for running unit, integration,
 * and property-based tests for the task decomposer feature.
 */

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    // Use jsdom environment for DOM testing
    environment: 'jsdom',

    // Setup files to run before tests
    setupFiles: ['./setup.ts'],

    // Global test timeout
    testTimeout: 10000,

    // Property-based test configuration
    // Minimum iterations for property tests
    globals: true,

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/app/chat/components/TaskDecomposer/__tests__/',
      ],
    },

    // Include patterns
    include: ['**/*.test.ts', '**/*.test.tsx', '**/*.property.test.ts', '**/*.property.test.tsx'],

    // Exclude patterns
    exclude: ['node_modules', 'dist', '.idea', '.git', '.cache'],
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../../../..'),
    },
  },
});
