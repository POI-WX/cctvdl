import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'dist-electron/**',
      'node_modules/**',
      'resources/**',
      'tests/gui/screenshots/**',
      'test-results/**',
      'playwright-report/**'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Essential (bug-prevention) Vue rules only — template formatting is left to
  // the author's style, not the linter.
  ...vue.configs['flat/essential'],
  {
    files: ['**/*.{ts,vue}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
        // Injected by Vite (see electron.vite.config.ts `define`).
        __APP_VERSION__: 'readonly'
      },
      parserOptions: { parser: tseslint.parser }
    },
    rules: {
      // The codebase intentionally uses `any` at a few untyped boundaries
      // (Electron module, third-party JSON). Keep it allowed but discourage noise.
      '@typescript-eslint/no-explicit-any': 'off',
      // require() is used deliberately for lazy/conditional CJS loads
      // (electron, ffmpeg-static) and in a couple of tests.
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      // safeFilename strips ASCII control chars on purpose.
      'no-control-regex': 'off',
      // Allow underscore-prefixed unused vars (conventional throwaways).
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }
      ],
      // Single-word page/component names (HomePage, App) are fine here.
      'vue/multi-word-component-names': 'off'
    }
  }
)
