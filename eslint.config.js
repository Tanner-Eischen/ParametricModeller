import eslint from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    'coverage/**',
    'dist/**',
    'node_modules/**',
    'playwright-report/**',
    'test-results/**',
  ]),
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{js,ts}'],
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      'prefer-const': 'off',
    },
  },
  {
    files: ['tests/**/*.ts'],
    languageOptions: {
      globals: globals.vitest,
    },
  },
);
