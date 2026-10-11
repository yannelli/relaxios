import realAxios from 'axios';
import http from 'node:http';
import https from 'node:https';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env, Runtime } from '../cases';
import { writeReport } from '../report';
import { caseNames, runCase, type Results, type RunHooks } from '../run';
import { startDiffServer, type DiffServer } from '../server';

// Vitest harness shared by the node and jsdom runs: one test per case, every adapter compared inside it.
// DIFF_SELF=1 compares real axios against itself (a stability check of the observer).
export function defineDiffSuite(runtime: Runtime, adapters: Array<string | undefined>) {
  let server: DiffServer;
  let env: Env;
  let compat: any;
  const results = { axios: {} as Results, compat: {} as Results };
  const hooks: RunHooks = {
    beforeCase: () => {
      http.globalAgent.destroy();
      https.globalAgent.destroy();
    },
  };

  beforeAll(async () => {
    server = await startDiffServer();
    env = { ...server.env, runtime };
    compat = process.env.DIFF_SELF ? realAxios : (await import('relaxios/axios')).default;
  }, 60_000);

  afterAll(async () => {
    await server.close();
    const path = writeReport(runtime, adapters, results.axios, results.compat);
    if (path) console.log(`diff report written to ${path}`);
  });

  describe(`differential: axios 1.20.0 vs relaxios/axios (${runtime}; adapters ${adapters.map((a) => a ?? 'default').join(', ')})`, () => {
    for (const name of caseNames()) {
      it(
        name,
        async () => {
          const a = (results.axios[name] = await runCase(realAxios, env, name, adapters, hooks));
          const c = (results.compat[name] = await runCase(compat, env, name, adapters, hooks));
          for (const label of Object.keys(a)) expect(c[label], `${name} [adapter: ${label}]`).toEqual(a[label]);
        },
        180_000,
      );
    }
  });
}
