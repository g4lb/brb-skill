import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['plugin/dist/**', 'build/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { project: './tsconfig.test.json', tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-restricted-imports': ['error', { paths: [
        { name: 'node:http', message: 'BRB makes no network calls.' },
        { name: 'node:https', message: 'BRB makes no network calls.' },
        { name: 'node:net', message: 'BRB makes no network calls.' },
        { name: 'node:dgram', message: 'BRB makes no network calls.' },
      ] }],
      'no-restricted-properties': ['error',
        { object: 'child_process', property: 'exec', message: 'Use execFile without a shell.' },
        { object: 'child_process', property: 'execSync', message: 'Use execFileSync without a shell.' },
      ],
    },
  },
  {
    // node:test's test() returns a promise the runner tracks; awaiting it is unnecessary.
    files: ['tests/**/*.ts'],
    rules: { '@typescript-eslint/no-floating-promises': 'off' },
  },
  {
    files: ['scripts/**/*.mjs', 'eslint.config.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { parserOptions: { project: false, projectService: false }, globals: { process: 'readonly', console: 'readonly' } },
  },
);
