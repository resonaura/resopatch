// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  // Ignore generated / vendor dirs
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.next/**', '**/*.js.map'] },

  // ── Base JS rules ─────────────────────────────────────────────────────────
  js.configs.recommended,

  // ── TypeScript rules (all TS / TSX files) ─────────────────────────────────
  ...tseslint.configs.recommended,

  // ── React-specific rules (web app only) ───────────────────────────────────
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // ── Custom overrides ──────────────────────────────────────────────────────
  {
    rules: {
      // Allow `any` sparingly — flag only explicit `any` casts that look accidental
      '@typescript-eslint/no-explicit-any': 'warn',
      // Unused vars: ignore leading underscore convention (_foo)
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Allow empty catch blocks (we have a few intentional ones)
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // ── Disable style rules Prettier handles ──────────────────────────────────
  prettierConfig,
);
