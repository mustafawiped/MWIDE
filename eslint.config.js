import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig([
  globalIgnores(['out/**', 'dist/**', 'release/**', 'coverage/**', '.tools/**']),
  {
    files: ['**/*.{js,ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
  },
  {
    files: ['tests/**/*.cjs'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: [
      '*.{js,ts}',
      'src/main/**/*.ts',
      'src/preload/**/*.ts',
      'src/core/**/*.ts',
      'src/providers/**/*.ts',
      'tests/**/*.ts',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/renderer/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'electron', '**/main/*', '**/preload/*'],
              message: 'Renderer code must use the typed desktop bridge.',
            },
          ],
        },
      ],
    },
  },
])
