import { fileURLToPath } from 'node:url';
import { defineConfig, type UserConfig } from 'tsdown';

const src = (p: string) => fileURLToPath(new URL(`./src/${p}`, import.meta.url));

// Same module swaps as the `browser` field of axios's package.json.
const browserSwaps: Record<string, string> = {
  [src('axios/adapters/http.ts')]: src('axios/helpers/null.ts'),
  [src('axios/platform/node/index.ts')]: src('axios/platform/browser/index.ts'),
  [src('axios/platform/node/classes/Buffer.ts')]: src('axios/helpers/null.ts'),
  [src('axios/platform/node/classes/FormData.ts')]: src('axios/helpers/null.ts'),
};

const browserField = {
  name: 'browser-field',
  async resolveId(source: string, importer: string | undefined, options: any) {
    const resolved = await (this as any).resolve(source, importer, { ...options, skipSelf: true });
    return resolved && browserSwaps[resolved.id] ? browserSwaps[resolved.id] : null;
  },
};

const shared: UserConfig = {
  target: 'es2022',
  dts: true,
  sourcemap: true,
  clean: false,
  outExtensions: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js', dts: format === 'cjs' ? '.d.cts' : '.d.ts' }),
  // Subpaths import each other through the package name so every entry ships once.
  deps: { neverBundle: [/^fetchwire(\/|$)/, 'vue'] },
};

export default defineConfig([
  {
    ...shared,
    entry: {
      index: 'src/index.ts',
      'axios.node': 'src/axios/index.ts',
      progress: 'src/progress/index.ts',
      upload: 'src/upload/index.ts',
      vue: 'src/vue/index.ts',
    },
    format: 'esm',
    platform: 'node',
  },
  {
    ...shared,
    entry: { 'axios.node': 'src/axios/cjs.ts' },
    format: 'cjs',
    platform: 'node',
    dts: false,
  },
  {
    ...shared,
    entry: { 'axios.browser': 'src/axios/index.ts' },
    format: 'esm',
    platform: 'browser',
    dts: false,
    plugins: [browserField],
  },
  {
    ...shared,
    entry: { 'axios.browser': 'src/axios/cjs.ts' },
    format: 'cjs',
    platform: 'browser',
    dts: false,
    plugins: [browserField],
  },
]);
