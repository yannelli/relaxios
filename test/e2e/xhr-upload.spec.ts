import { expect, test } from './fixtures';

const SIZE = 16 << 20;

test('compat onUploadProgress uses XHR and reports real byte counts', async ({ page }) => {
  const out = await page.evaluate(async (size) => {
    const w = window as any;
    const results: Record<string, any> = {};
    for (const name of ['axios', 'compat']) {
      let xhrOpened = 0;
      const open = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, ...args: any[]) {
        xhrOpened++;
        return (open as any).apply(this, args);
      };
      const events: any[] = [];
      const res = await w[name].post('/upload?delay=2', new Blob([new Uint8Array(size)]), {
        onUploadProgress: (e: any) => events.push({ ...e, event: e.event?.type }),
      });
      XMLHttpRequest.prototype.send = open;
      results[name] = { xhrOpened, data: res.data, events };
    }
    return results;
  }, SIZE);
  const { compat, axios } = out;
  expect(compat.xhrOpened).toBe(1);
  expect(compat.data.size).toBe(SIZE);
  expect(compat.events.length).toBeGreaterThan(1);
  const loaded = compat.events.map((e: any) => e.loaded);
  expect(loaded).toEqual([...loaded].sort((a: number, b: number) => a - b));
  expect(compat.events.at(-1)).toMatchObject({ loaded: SIZE, total: SIZE, progress: 1, upload: true, lengthComputable: true, event: 'progress' });
  expect(Object.keys(compat.events[0]).sort()).toEqual(Object.keys(axios.events[0]).sort());
  expect(compat.data.size).toBe(axios.data.size);
  // Browser axios labels Blob bodies x-www-form-urlencoded (the POST default header wins); the port does the same.
  expect(compat.data.type).toBe(axios.data.type);
});

test('requests without upload progress use fetch', async ({ page }) => {
  const opened = await page.evaluate(async () => {
    let xhrOpened = 0;
    const open = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, ...args: any[]) {
      xhrOpened++;
      return (open as any).apply(this, args);
    };
    await (window as any).compat.post('/upload', new Blob(['x']));
    XMLHttpRequest.prototype.send = open;
    return xhrOpened;
  });
  expect(opened).toBe(0);
});

test('XHR transport maps errors, timeouts and aborts like axios', async ({ page }) => {
  const out = await page.evaluate(async () => {
    const w = window as any;
    const up = () => {};
    const shape = (e: any) => ({ name: e.name, code: e.code, message: e.message, status: e.status ?? null, data: e.response?.data ?? null });
    const results: Record<string, any> = {};
    for (const name of ['axios', 'compat']) {
      const ax = w[name];
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 50);
      results[name] = await Promise.all([
        ax.post('/upload?status=422', 'x', { onUploadProgress: up }).catch(shape),
        ax.post('/upload?delay=500', new Blob([new Uint8Array(1 << 20)]), { onUploadProgress: up, timeout: 100 }).catch(shape),
        ax.post('/upload?delay=500', new Blob([new Uint8Array(1 << 20)]), { onUploadProgress: up, signal: controller.signal }).catch(shape),
      ]);
    }
    return results;
  });
  expect(out.compat).toEqual(out.axios);
});

test('xhrSingle upload adapter: estimated follows bytes sent, confirmed follows the response', async ({ page }) => {
  const out = await page.evaluate(async (size) => {
    const { upload, xhrSingle } = (window as any).upload;
    const events: any[] = [];
    const job = upload(new Blob([new Uint8Array(size)]), {
      protocol: xhrSingle({ url: '/upload?delay=2', field: 'file' }),
      store: false,
      onProgress: (p: any) => events.push(p),
    });
    const result = await job;
    return { result: result.data, events };
  }, SIZE);
  expect(out.result.size).toBeGreaterThan(SIZE);
  expect(out.result.type).toMatch(/^multipart\/form-data/);
  for (const p of out.events) {
    expect(p.estimated).toBeGreaterThanOrEqual(p.confirmed);
    expect(p.estimated).toBeLessThanOrEqual(p.confirmed + p.inflight);
  }
  expect(out.events.some((p: any) => p.confirmed === 0 && p.estimated > 0)).toBe(true);
  expect(out.events.at(-1)).toMatchObject({ state: 'done', confirmed: SIZE });
});

test('xhrFetch from fetchwire/progress gives core users upload progress', async ({ page }) => {
  const out = await page.evaluate(async (size) => {
    const w = window as any;
    const events: any[] = [];
    const res = await w.core.default.post('/upload?delay=2', new Blob([new Uint8Array(size)]), {
      fetch: w.progress.xhrFetch({ onUpload: (e: any) => events.push(e) }),
    });
    return { data: res.data, last: events.at(-1), count: events.length };
  }, SIZE);
  expect(out.data.size).toBe(SIZE);
  expect(out.count).toBeGreaterThan(1);
  expect(out.last).toMatchObject({ loaded: SIZE, total: SIZE, ratio: 1 });
});
