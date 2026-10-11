// Global setup for the unit project: axios's syntaxCompat test parses every file under lib/
// as ES2018. The port is TypeScript, so this builds an ES2018-lowered copy of it for that test.
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'tsdown';

export const LIB_ES2018 = fileURLToPath(new URL('../.lib-es2018/', import.meta.url));

export default async function setup() {
  rmSync(LIB_ES2018, { recursive: true, force: true });
  await build({
    entry: { index: fileURLToPath(new URL('../../../src/axios/index.ts', import.meta.url)) },
    outDir: LIB_ES2018,
    format: 'esm',
    platform: 'node',
    target: 'es2018',
    dts: false,
    sourcemap: false,
    clean: false,
    outExtensions: () => ({ js: '.js' }),
    logLevel: 'silent',
    config: false,
  });
}
