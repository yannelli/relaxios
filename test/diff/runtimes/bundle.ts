import { build } from 'rolldown';

export const BROWSER_CONDITIONS = ['browser', 'import', 'default'];
export const WORKERD_CONDITIONS = ['workerd', 'worker', 'browser', 'import', 'default'];

// node: imports in the shared modules only run on Node (guarded by hasNode() and the skip list).
// They are rewritten to rejections: workerd rejects a string script that still contains imports.
const NODE_IMPORT = /import\(\s*(?:\/\*[^*]*\*\/\s*)?(['"])node:[a-z_]+\1\s*\)/g;
const nodeStubs = {
  name: 'node-stubs',
  transform: (code: string) =>
    code.includes('node:') ? { code: code.replace(NODE_IMPORT, 'Promise.reject(new Error("node: modules are not available in this runtime"))'), map: null } : null,
};

/** Bundles an entry for a web runtime with rolldown into one self-contained ES module. */
export async function bundle(entry: string, conditionNames: string[], alias: Record<string, string> = {}): Promise<string> {
  const result = await build({
    input: entry,
    platform: 'browser',
    // tsconfig paths would map relaxios/* to src/; the published entry points in dist/ are wanted.
    tsconfig: false,
    resolve: { conditionNames, aliasFields: [['browser']], alias },
    plugins: [nodeStubs],
    write: false,
    logLevel: 'silent',
    output: { format: 'esm', sourcemap: false, minify: false, codeSplitting: false },
  });
  const chunk = result.output.find((o) => o.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('rolldown produced no chunk for ' + entry);
  return chunk.code;
}
