// Minified+gzipped size of the Node build, measured with rolldown (Node built-ins stay external).
import { gzipSync } from 'node:zlib';
import { rolldown } from 'rolldown';

export async function nodeBuildSize(entry = 'dist/axios.node.js') {
  const bundle = await rolldown({ input: entry, platform: 'node', external: [/^node:/, /^relaxios/] });
  const { output } = await bundle.generate({ format: 'esm', minify: true });
  await bundle.close();
  return gzipSync(output[0].code, { level: 9 }).length;
}
