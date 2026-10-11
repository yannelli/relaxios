// Points `require('axios')` at the CommonJS node build, then runs the upstream mocha suite.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const dist = new URL('../../dist/axios.node.cjs', import.meta.url);
if (!existsSync(dist)) {
  console.error('dist/axios.node.cjs is missing: run `npm run build` at the repo root first');
  process.exit(1);
}
mkdirSync(here + 'node_modules/axios', { recursive: true });
writeFileSync(here + 'node_modules/axios/package.json', JSON.stringify({ name: 'axios', main: 'index.cjs' }));
writeFileSync(here + 'node_modules/axios/index.cjs', `module.exports = require(${JSON.stringify(fileURLToPath(dist))});\n`);

const result = spawnSync('npx', ['mocha', ...process.argv.slice(2)], { cwd: here, stdio: 'inherit' });
process.exit(result.status ?? 1);
