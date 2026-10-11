import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import type { Env } from './cases';
import { writeReport } from './report';
import { caseNames, type Results } from './run';
import { bundle, BROWSER_CONDITIONS } from './runtimes/bundle';
import { startDiffServer, type DiffServer } from './server';

// Runs the matrix inside chromium, firefox and webkit on the e2e page (test/e2e/server.ts), which loads
// real axios (/vendor/axios.js) and relaxios/axios (/dist/axios.browser.js). Needs `npm run build` first.
// WebKit locally needs LD_PRELOAD=<scratchpad>/debs/root/usr/lib/aarch64-linux-gnu/libgstcodecparsers-1.0.so.0.
const ADAPTERS: Array<string | undefined> = [undefined, 'xhr', 'fetch', 'http'];

let server: DiffServer;
let env: Env;
let page: Page;
let runtime = 'browser';
const results = { axios: {} as Results, compat: {} as Results };

test.beforeAll(async ({ browser, browserName }) => {
  runtime = 'browser-' + browserName;
  server = await startDiffServer();
  env = { ...server.env, runtime: 'browser' };
  const script = await bundle(fileURLToPath(new URL('./runtimes/browser-entry.ts', import.meta.url)), BROWSER_CONDITIONS);
  page = await browser.newPage();
  await page.goto('/');
  await page.waitForFunction(() => (window as any).ready === true);
  await page.addScriptTag({ content: script, type: 'module' });
  await page.waitForFunction(() => typeof (window as any).__diff?.run === 'function');
  // DIFF_SELF=1 compares real axios against itself (observer stability check).
  if (process.env.DIFF_SELF) await page.evaluate(() => void ((window as any).compat = (window as any).axios));
});

// Playwright restarts the worker after a failure, so each worker merges its cases into the report.
test.afterAll(async () => {
  await page?.close();
  await server?.close();
  writeReport(runtime, ADAPTERS, results.axios, results.compat, true);
});

test.describe('differential: axios 1.20.0 vs relaxios/axios (browser)', () => {
  for (const name of caseNames()) {
    test(name, async () => {
      test.setTimeout(120_000);
      const out = await page.evaluate(
        ([name, env, adapters]) => (window as any).__diff.run(name, env, adapters.map((a: string | null) => a ?? undefined)),
        [name, env, ADAPTERS.map((a) => a ?? null)] as const,
      );
      results.axios[name] = out.axios;
      results.compat[name] = out.compat;
      for (const label of Object.keys(out.axios)) expect(out.compat[label], `${name} [adapter: ${label}]`).toEqual(out.axios[label]);
    });
  }
});
