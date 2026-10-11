import { expect, OTHER_ORIGIN, test } from './fixtures';

// Each case runs with real axios (XHR adapter) and fetchwire/axios in the same page and compares.
const run = (page: any, code: string) =>
  page.evaluate(async (code: string) => {
    const w = window as any;
    const fn = new Function('ax', 'other', `return (async () => { ${code} })()`);
    const out: Record<string, unknown> = {};
    for (const name of ['axios', 'compat']) {
      const r = await fn(w[name], 'http://127.0.0.1:4173');
      out[name] = r;
    }
    return out;
  }, code);

test.beforeEach(async ({ page }) => {
  await page.evaluate(() => fetch('/xsrf/set?value=tok%20en'));
});

test('sends X-XSRF-TOKEN on same-origin requests', async ({ page }) => {
  const out = await run(page, `return (await ax.get('/echo')).data.headers['x-xsrf-token'];`);
  expect(out.compat).toBe('tok en');
  expect(out.compat).toEqual(out.axios);
});

test('does not send the token cross-origin unless withXSRFToken is true', async ({ page }) => {
  const out = await run(
    page,
    `const a = (await ax.get(other + '/echo', { withCredentials: true })).data.headers['x-xsrf-token'];
     const b = (await ax.get(other + '/echo', { withXSRFToken: true })).data.headers['x-xsrf-token'];
     const c = (await ax.get('/echo', { withXSRFToken: false })).data.headers['x-xsrf-token'];
     return [a ?? null, b ?? null, c ?? null];`,
  );
  expect(out.compat).toEqual([null, 'tok en', null]);
  expect(out.compat).toEqual(out.axios);
  expect(OTHER_ORIGIN).toContain('127.0.0.1');
});

test('supports custom cookie and header names', async ({ page }) => {
  await page.evaluate(() => fetch('/xsrf/set?name=csrftoken&value=django'));
  const out = await run(
    page,
    `const r = await ax.get('/echo', { xsrfCookieName: 'csrftoken', xsrfHeaderName: 'X-CSRFToken' });
     return [r.data.headers['x-csrftoken'], r.data.headers['x-xsrf-token'] ?? null];`,
  );
  expect(out.compat).toEqual(['django', null]);
  expect(out.compat).toEqual(out.axios);
});

test('withCredentials sends cookies cross-origin', async ({ page }) => {
  await page.evaluate(() => fetch('http://127.0.0.1:4173/xsrf/set?name=other&value=1', { credentials: 'include' }));
  const out = await run(
    page,
    `const a = (await ax.get(other + '/echo')).data.headers.cookie ?? null;
     const b = (await ax.get(other + '/echo', { withCredentials: true })).data.headers.cookie ?? null;
     return [a, b];`,
  );
  expect(out.compat).toEqual(out.axios);
});
