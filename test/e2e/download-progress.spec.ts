import { expect, test } from './fixtures';

const SIZE = 1 << 20;

test('progress() reports monotonic download progress up to Content-Length', async ({ page }) => {
  const events = await page.evaluate(async (size) => {
    const { progress } = (window as any).progress;
    const res = await fetch(`/download?size=${size}&chunk=65536&delay=5`);
    const events: any[] = [];
    const body = res.body!.pipeThrough(progress((e: any) => events.push(e), res));
    const bytes = (await new Response(body).arrayBuffer()).byteLength;
    return { events, bytes };
  }, SIZE);
  expect(events.bytes).toBe(SIZE);
  expect(events.events.length).toBeGreaterThan(1);
  const loaded = events.events.map((e: any) => e.loaded);
  expect(loaded).toEqual([...loaded].sort((a, b) => a - b));
  expect(events.events.at(-1)).toMatchObject({ loaded: SIZE, total: SIZE, ratio: 1, lengthComputable: true });
  expect(events.events.every((e: any) => e.loaded <= SIZE)).toBe(true);
});

test('content-encoded downloads are not length-computable', async ({ page }) => {
  const last = await page.evaluate(async (size) => {
    const { trackResponse } = (window as any).progress;
    const events: any[] = [];
    const res = trackResponse(await fetch(`/download?size=${size}&gzip=1`), (e: any) => events.push(e));
    await res.arrayBuffer();
    return events.at(-1);
  }, SIZE);
  expect(last).toMatchObject({ loaded: SIZE, lengthComputable: false });
  expect(last.total).toBeUndefined();
});

test('compat onDownloadProgress uses fetch streams and axios event fields', async ({ page }) => {
  const result = await page.evaluate(async (size) => {
    const w = window as any;
    let xhrOpened = 0;
    const open = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, ...args: any[]) {
      xhrOpened++;
      return (open as any).apply(this, args);
    };
    const events: any[] = [];
    const res = await w.compat.get(`/download?size=${size}&chunk=65536&delay=5`, {
      responseType: 'arraybuffer',
      onDownloadProgress: (e: any) => events.push(e),
    });
    XMLHttpRequest.prototype.send = open;
    return { xhrOpened, bytes: res.data.byteLength, last: { ...events.at(-1), event: undefined }, count: events.length };
  }, SIZE);
  expect(result.xhrOpened).toBe(0);
  expect(result.bytes).toBe(SIZE);
  expect(result.count).toBeGreaterThan(1);
  expect(result.last).toMatchObject({ loaded: SIZE, total: SIZE, progress: 1, download: true, lengthComputable: true });
});
