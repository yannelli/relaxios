// Runs the differential matrix in Bun, Deno and workerd (through miniflare).
// Precondition: `npm run build`, since every child imports fetchwire/axios from dist/ by package name.
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, symlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../cases';
import { writeReport } from '../report';
import { caseNames, type Results } from '../run';
import { startDiffServer, type DiffServer } from '../server';
import { bundle, WORKERD_CONDITIONS } from './bundle';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const child = fileURLToPath(new URL('./child.ts', import.meta.url));
const DEFAULT_DENO = '/tmp/claude-1000/-home-ubuntu-workspace-axios-new/f35e4b28-70b2-4b03-b9ef-dff10aecbe34/scratchpad/deno/bin/deno';
const DENO = process.env.DENO || (existsSync(DEFAULT_DENO) ? DEFAULT_DENO : 'deno');
const BUN = process.env.BUN || 'bun';
const BUILD_HINT = 'dist/ is missing or stale: run `npm run build` before the external differential tests';

const available = (bin: string) => {
  try {
    execFileSync(bin, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

function ensureSelfLink() {
  const link = root + 'node_modules/fetchwire';
  if (!existsSync(link)) symlinkSync('..', link, 'dir');
}

type ChildOutput = { axios: Results; compat: Results };

function runChild(bin: string, args: string[], env: Env, adapters: Array<string | undefined>): Promise<ChildOutput> {
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env, DIFF_ENV: JSON.stringify(env), DIFF_ADAPTERS: JSON.stringify(adapters.map((a) => a ?? null)) };
    execFile(bin, args, { cwd: root, env: childEnv, maxBuffer: 1 << 30, timeout: 900_000 }, (error, stdout, stderr) => {
      const line = stdout.trim().split('\n').at(-1) || '';
      try {
        resolve(JSON.parse(line));
      } catch {
        reject(new Error(`${bin} ${args.join(' ')} produced no result JSON (${BUILD_HINT}?)\n${error?.message ?? ''}\n${stderr.slice(-4000)}`));
      }
    });
  });
}

let server: DiffServer;
let env: Env;
beforeAll(async () => {
  const built = existsSync(root + 'dist/axios.node.js') && existsSync(root + 'dist/axios.browser.js');
  if (!built && !process.env.DIFF_SELF) throw new Error(BUILD_HINT);
  ensureSelfLink();
  server = await startDiffServer();
  env = { ...server.env, runtime: 'node' };
}, 60_000);
afterAll(() => server?.close());

function compareAll(runtime: string, adapters: Array<string | undefined>, get: () => ChildOutput | undefined) {
  for (const name of caseNames()) {
    it(name, () => {
      const out = get();
      if (!out) throw new Error(`${runtime} run produced no results`);
      for (const label of Object.keys(out.axios[name] ?? {})) expect(out.compat[name]?.[label], `${name} [adapter: ${label}]`).toEqual(out.axios[name][label]);
    });
  }
}

const CHILD_ADAPTERS = [undefined, 'http', 'fetch'];

describe.skipIf(!available(BUN))('differential: axios 1.20.0 vs fetchwire/axios (bun)', () => {
  let out: ChildOutput | undefined;
  beforeAll(async () => {
    out = await runChild(BUN, [child], { ...env, runtime: 'bun' }, CHILD_ADAPTERS);
    writeReport('bun', CHILD_ADAPTERS, out.axios, out.compat);
  }, 900_000);
  compareAll('bun', CHILD_ADAPTERS, () => out);
});

describe.skipIf(!available(DENO))('differential: axios 1.20.0 vs fetchwire/axios (deno)', () => {
  let out: ChildOutput | undefined;
  beforeAll(async () => {
    out = await runChild(DENO, ['run', '-A', '--node-modules-dir=manual', '--unstable-sloppy-imports', child], { ...env, runtime: 'deno' }, CHILD_ADAPTERS);
    writeReport('deno', CHILD_ADAPTERS, out.axios, out.compat);
  }, 900_000);
  compareAll('deno', CHILD_ADAPTERS, () => out);
});

const WORKERD_ADAPTERS = [undefined, 'fetch'];

describe('differential: axios 1.20.0 vs fetchwire/axios (workerd)', () => {
  let mf: any;
  const results = { axios: {} as Results, compat: {} as Results };
  beforeAll(async () => {
    const { Miniflare } = await import('miniflare');
    // DIFF_SELF=1 aliases fetchwire/axios to axios so the observer can be checked before dist/ exists.
    const script = await bundle(fileURLToPath(new URL('./worker.ts', import.meta.url)), WORKERD_CONDITIONS, process.env.DIFF_SELF ? { 'fetchwire/axios': 'axios' } : {});
    mf = new Miniflare({ modules: true, script, compatibilityDate: '2025-01-01' });
    await mf.ready;
  }, 120_000);
  afterAll(async () => {
    await mf?.dispose();
    writeReport('workerd', WORKERD_ADAPTERS, results.axios, results.compat);
  });
  for (const name of caseNames()) {
    it(
      name,
      async () => {
        const params = new URLSearchParams({ env: JSON.stringify(env), case: name, adapters: JSON.stringify(WORKERD_ADAPTERS.map((a) => a ?? null)) });
        if (process.env.DIFF_SELF) params.set('self', '1');
        const res = await mf.dispatchFetch('http://diff.local/?' + params);
        const out = await res.json();
        if (!res.ok) throw new Error(`workerd case failed: ${out.failed}`);
        results.axios[name] = out.axios;
        results.compat[name] = out.compat;
        for (const label of Object.keys(out.axios)) expect(out.compat[label], `${name} [adapter: ${label}]`).toEqual(out.axios[label]);
      },
      120_000,
    );
  }
});
