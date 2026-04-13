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
);
