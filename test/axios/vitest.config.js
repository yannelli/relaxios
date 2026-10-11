import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

const here = fileURLToPath(new URL('./', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const port = (p) => fileURLToPath(new URL(`../../src/axios/${p}`, import.meta.url));
const src = (p) => fileURLToPath(new URL(`../../src/${p}`, import.meta.url));
const adaptersDir = fileURLToPath(new URL('./unit/adapters', import.meta.url));
const libES2018 = fileURLToPath(new URL('./.lib-es2018/', import.meta.url));

// axios's tests read fixtures from <repo>/tests/unit/adapters; here that directory is
// unit/adapters, so these two expressions are rewritten at load time (files stay verbatim).
const fixturePathRewrites = [
  ["path.join(process.cwd(), 'tests/unit/adapters')", JSON.stringify(adaptersDir)],
  ["path.resolve(__dirname, '../../../tests/unit/adapters/')", JSON.stringify(adaptersDir)],
  // syntaxCompat walks axios's lib/; the port is TypeScript, so it gets an ES2018 build of it (setup/lib-es2018.js).
  ["fileURLToPath(new URL('../../lib/', import.meta.url))", JSON.stringify(libES2018)],
];

const fixturePaths = {
  name: 'axios-suite-fixture-paths',
  transform(code, id) {
    if (!id.startsWith(here) || !id.endsWith('.test.js')) return null;
    let out = code;
    for (const [from, to] of fixturePathRewrites) out = out.split(from).join(to);
    return out === code ? null : { code: out, map: null };
  },
};


// The browser project applies the same module swaps as the package's browser build
// (axios's `browser` field): no Node transport, browser platform, no Buffer/form-data classes.
const browserSwaps = {
  [port('adapters/http.ts')]: port('helpers/null.ts'),
  [port('platform/node/index.ts')]: port('platform/browser/index.ts'),
  [port('platform/node/classes/Buffer.ts')]: port('helpers/null.ts'),
  [port('platform/node/classes/FormData.ts')]: port('helpers/null.ts'),
};
const browserField = {
  name: 'axios-suite-browser-field',
  enforce: 'pre',
  async resolveId(source, importer, options) {
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    return resolved && browserSwaps[resolved.id] ? browserSwaps[resolved.id] : null;
  },
};

// Inline projects inherit this file's vite config (plugins, alias, server) in Vitest 5.
const shared = {
  plugins: [fixturePaths],
  resolve: {
    alias: [
      { find: /^(?:\.\.\/)+index\.js$/, replacement: port('index.ts') },
      { find: /^(?:\.\.\/)+lib\/(.+)\.js$/, replacement: port('$1.ts') },
      // The port ships its own CONNECT tunnelling agent; the tests' `https-proxy-agent` import gets that class.
      { find: /^https-proxy-agent$/, replacement: port('adapters/http/HttpsProxyAgent.ts') },
      { find: /^fetchwire$/, replacement: src('index.ts') },
      { find: /^fetchwire\/(.*)$/, replacement: src('$1/index.ts') },
    ],
  },
  server: {
    fs: { allow: [repoRoot] },
  },
};

export default defineConfig({
  ...shared,
  test: {
    testTimeout: 10000,
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['unit/**/*.test.js'],
          globalSetup: ['setup/lib-es2018.js'],
          setupFiles: [],
        },
      },
      {
        plugins: [browserField],
        test: {
          name: 'browser',
          include: ['browser/**/*.browser.test.js'],
          browser: {
            enabled: true,
            provider: playwright(),
            instances: [
              { browser: 'chromium', headless: true },
              { browser: 'firefox', headless: true },
              { browser: 'webkit', headless: true },
            ],
          },
          setupFiles: ['setup/browser.setup.js'],
        },
      },
    ],
  },
});
