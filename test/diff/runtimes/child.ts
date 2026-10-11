// Child script for Bun and Deno: `bun test/diff/runtimes/child.ts`, `deno run -A --node-modules-dir=manual test/diff/runtimes/child.ts`.
// Needs `npm run build` first: both import the published entry points by name through node_modules/fetchwire -> ..
import realAxios from 'axios';
import http from 'node:http';
import https from 'node:https';
import process from 'node:process';
import type { Env, Runtime } from '../cases';
import { runAll, type RunHooks } from '../run';

const runtime: Runtime = (globalThis as any).Bun ? 'bun' : (globalThis as any).Deno ? 'deno' : 'node';
const env: Env = { ...JSON.parse(process.env.DIFF_ENV || '{}'), runtime };
const adapters: Array<string | undefined> = JSON.parse(process.env.DIFF_ADAPTERS || '[null,"http","fetch"]').map((a: string | null) => a ?? undefined);
const hooks: RunHooks = {
  beforeCase: () => {
    http.globalAgent?.destroy?.();
    https.globalAgent?.destroy?.();
  },
};

// DIFF_SELF=1 compares real axios against itself (observer stability check); it needs no dist/.
const compat = process.env.DIFF_SELF ? realAxios : (await import('fetchwire/axios')).default;
const axiosResults = await runAll(realAxios, env, adapters, hooks);
const compatResults = await runAll(compat, env, adapters, hooks);
// Bun drops buffered stdout on process.exit, so wait for the write to flush first.
const out = JSON.stringify({ runtime, adapters: adapters.map((a) => a ?? 'default'), axios: axiosResults, compat: compatResults }) + '\n';
await new Promise<void>((resolve) => process.stdout.write(out, () => resolve()));
process.exit(0);
