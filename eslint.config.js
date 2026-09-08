import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Agent worktrees under .claude/ carry their own tsconfig; without the
  // ignore + explicit root, typescript-eslint sees "multiple candidate
  // TSConfigRootDirs" and every file fails to parse.
  globalIgnores(['dist', '.claude/worktrees']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/core/ui/Overlay.tsx'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/useModalDialog'],
          message:
            'Do not call useModalDialog directly — render the surface through <Overlay> ' +
            '(src/core/ui/Overlay.tsx), which owns focus, Escape, Back and scroll lock and ' +
            'requires a non-optional onClose. Transient layers with no exit use <BlockingOverlay>.',
        }],
      }],
    },
  },
])
