import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Rules tests are excluded from the default run: they need the Firestore
    // emulator. Run them with `pnpm test:rules`, which starts it first.
    include: ['packages/**/*.test.ts', 'services/**/*.test.ts', 'eval/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      reporter: ['text', 'json-summary'],
    },
  },
});
