import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts', 'src/**/index.ts', 'src/types/**'],
      // Same-source Vitest 5 reporter baseline; see release/COVERAGE_MIGRATION.md.
      // These floors do not mean the legacy reporter's 78/74 targets were reached.
      thresholds: {
        branches: 51.8,
        functions: 63.5,
        lines: 63.6,
        statements: 62.5,
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
