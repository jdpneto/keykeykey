import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    ignores: [
      '**/dist/**',
      '**/dist-chrome/**',
      '**/dist-firefox/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      'apps/desktop/src-tauri/**',
    ],
  },
  {
    files: ['apps/extension/src/**/*.ts', 'apps/extension/src/**/*.tsx'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'chrome',
          message:
            'Use the `browser` namespace from webextension-polyfill instead. chrome.* references break Firefox.',
        },
      ],
    },
  },
  {
    files: ['apps/desktop/src/**/*.ts', 'apps/desktop/src/**/*.tsx'],
    ignores: ['apps/desktop/src/**/__tests__/**'],
    rules: {
      // The Tauri webview shows nothing for these and confirm() returns true.
      'no-restricted-properties': [
        'error',
        ...['confirm', 'alert', 'prompt'].map((property) => ({
          object: 'window',
          property,
          message: 'Use confirmAction/showError from lib/native-dialog instead.',
        })),
      ],
      'no-restricted-globals': [
        'error',
        ...['confirm', 'alert', 'prompt'].map((name) => ({
          name,
          message: 'Use confirmAction/showError from lib/native-dialog instead.',
        })),
      ],
    },
  },
);
