import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (p: string) => fileURLToPath(new URL(`./src/${p}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^relaxios$/, replacement: src('index.ts') },
      { find: /^relaxios\/(.*)$/, replacement: src('$1/index.ts') },
    ],
  },
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 20_000,
  },
});
