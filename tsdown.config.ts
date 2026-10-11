import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    axios: 'src/axios/index.ts',
    progress: 'src/progress/index.ts',
    upload: 'src/upload/index.ts',
    vue: 'src/vue/index.ts',
  },
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  dts: true,
  sourcemap: true,
  clean: true,
  // Subpaths import each other through the package name so every entry ships once.
  deps: { neverBundle: [/^fetchwire(\/|$)/, 'vue'] },
});
