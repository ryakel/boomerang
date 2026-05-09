import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  { ignores: ['dist'] },
  // Server-side files (Node.js)
  {
    files: ['server.js', 'db.js', 'vite.config.js'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.node,
      sourceType: 'module',
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  // Frontend files (browser)
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: { ...globals.browser, __APP_VERSION__: 'readonly' },
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  // v2-only: stricter check for the TDZ class of bug that took down v2 on
  // 2026-05-09. `useKeyboardShortcuts({ onComplete: handleComplete })`
  // referenced a `const handleComplete = useCallback(...)` defined later in
  // the component. const doesn't hoist, so every fresh mount threw a
  // ReferenceError before AppV2's useEffect could set data-ui="v2". Smoke
  // test parses the bundle but doesn't mount React, so it shipped.
  // `functions: false` keeps regular `function foo()` forward references OK
  // (those genuinely hoist); `variables: true` is the new gate.
  // Scoped to src/v2/** because v1 has 40 legitimate-at-runtime forward
  // references inside `.then()` / `setTimeout` callbacks (they only execute
  // after all consts are defined) and v1 is being deleted in the end-state
  // cleanup anyway.
  {
    files: ['src/v2/**/*.{js,jsx}'],
    rules: {
      'no-use-before-define': ['error', { functions: false, classes: false, variables: true }],
    },
  },
]
