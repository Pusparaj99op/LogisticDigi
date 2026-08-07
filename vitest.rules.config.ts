import { defineConfig } from 'vitest/config';

/**
 * Security-rules tests only.
 *
 * Kept out of the default vitest project because they need the Firestore
 * emulator (and therefore a JDK). `pnpm test:rules` starts the emulator and
 * points vitest at this config.
 */
export default defineConfig({
  test: {
    include: ['firebase/**/*.test.ts'],
    environment: 'node',
    // Rules evaluation goes over the wire to the emulator; the default 5s
    // is tight for the first few round trips while it warms up.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
