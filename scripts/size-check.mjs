// Runs size-limit, prints a size table, and checks the per-adapter budgets that
// size-limit cannot express: each adapter may add at most 1 kB to the upload core.
import { execFileSync } from 'node:child_process';

const ADAPTER_BUDGET = 1000;
let raw;
try {
  raw = execFileSync('npx', ['size-limit', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
} catch (e) {
  raw = e.stdout; // size-limit exits non-zero when a limit fails; the JSON is still printed
}
const results = JSON.parse(raw);
const size = (name) => results.find((r) => r.name === name).size;
const kb = (n) => (n / 1000).toFixed(2) + ' kB';

const rows = results.map((r) => ({ name: r.name, size: r.size, limit: r.sizeLimit, ok: r.passed !== false }));
for (const adapter of ['ietf', 's3Multipart', 'xhrSingle']) {
  const delta = size(`upload + ${adapter}`) - size('upload core');
  rows.push({ name: `${adapter} adapter (added to upload core)`, size: delta, limit: ADAPTER_BUDGET, ok: delta <= ADAPTER_BUDGET });
}

console.log('| Module | min+gzip | Budget | |');
console.log('| --- | ---: | ---: | --- |');
for (const r of rows) console.log(`| ${r.name} | ${kb(r.size)} | ${r.limit ? kb(r.limit) : '-'} | ${r.ok ? 'pass' : 'over'} |`);

const failed = rows.filter((r) => !r.ok);
if (failed.length) {
  console.error(`\n${failed.length} size budget(s) exceeded: ${failed.map((r) => r.name).join(', ')}`);
  process.exit(1);
}
