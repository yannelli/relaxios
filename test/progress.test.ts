import { gzipSync } from 'node:zlib';
import { contentLength, progress, reducer, throttle, trackResponse, type ProgressEvent } from 'relaxios/progress';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { serve, type TestServer } from './helpers/server';

const SIZE = 256 * 1024;
let server: TestServer;

beforeAll(async () => {
  server = await serve(async (req, res) => {
    const payload = Buffer.alloc(SIZE, 'a');
    if (req.url === '/gzip') {
      const zipped = gzipSync(payload);
      res.writeHead(200, { 'content-encoding': 'gzip', 'content-length': zipped.length });
      return void res.end(zipped);
    }
    if (req.url === '/lying') {
      res.writeHead(200, { 'content-length': SIZE });
      res.write(payload.subarray(0, SIZE / 2));
      return void setTimeout(() => res.destroy(), 20);
    }
    res.writeHead(200, { 'content-length': SIZE });
    for (let i = 0; i < SIZE; i += 16384) {
      res.write(payload.subarray(i, i + 16384));
      await new Promise((r) => setTimeout(r, 2));
    }
    res.end();
  });
});
afterAll(() => server.close());

async function download(path: string, throttleMs = 0) {
  const events: ProgressEvent[] = [];
  const res = await fetch(server.url + path);
  const body = res.body!.pipeThrough(progress((e) => events.push(e), { total: contentLength(res.headers), throttle: throttleMs }));
  const bytes = (await new Response(body).arrayBuffer()).byteLength;
  return { events, bytes };
}

describe('progress', () => {
  it('reports monotonic progress up to the Content-Length', async () => {
    const { events, bytes } = await download('/plain');
    expect(bytes).toBe(SIZE);
    expect(events.length).toBeGreaterThan(2);
    for (let i = 1; i < events.length; i++) expect(events[i].loaded).toBeGreaterThanOrEqual(events[i - 1].loaded);
    const last = events.at(-1)!;
    expect(last).toMatchObject({ loaded: SIZE, total: SIZE, ratio: 1, lengthComputable: true });
    expect(events.reduce((n, e) => n + e.bytes, 0)).toBe(SIZE);
  });

  it('marks content-encoded bodies as not length-computable', async () => {
    const { events, bytes } = await download('/gzip');
    expect(bytes).toBe(SIZE);
    const last = events.at(-1)!;
    expect(last).toMatchObject({ loaded: SIZE, lengthComputable: false });
    expect(last.total).toBeUndefined();
    expect(last.ratio).toBeUndefined();
  });

  it('clamps loaded to total', () => {
    const reduce = reducer(100);
    expect(reduce(150)).toMatchObject({ loaded: 100, ratio: 1, bytes: 100 });
    expect(contentLength(new Headers({ 'content-length': '10', 'content-encoding': 'identity' }))).toBe(10);
    expect(contentLength(new Headers({ 'content-length': '10', 'content-encoding': 'br' }))).toBeUndefined();
    expect(contentLength(new Headers())).toBeUndefined();
  });

  it('reports the rate and time remaining', () => {
    vi.useFakeTimers();
    try {
      const reduce = reducer(10_000);
      reduce(0);
      vi.advanceTimersByTime(500);
      const e = reduce(1000);
      expect(e.rate).toBe(2000);
      expect(e.estimated).toBe(4.5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('throttles to the latest value and flushes on demand', () => {
    vi.useFakeTimers();
    try {
      const calls: number[] = [];
      const [fn, flush] = throttle((n: number) => calls.push(n), 100);
      fn(1);
      fn(2);
      expect(calls).toEqual([]);
      vi.advanceTimersByTime(100);
      expect(calls).toEqual([2]);
      fn(3);
      flush();
      expect(calls).toEqual([2, 3]);
      vi.advanceTimersByTime(200);
      expect(calls).toEqual([2, 3]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('trackResponse keeps status and headers and emits a final event', async () => {
    const events: ProgressEvent[] = [];
    const res = trackResponse(await fetch(server.url + '/plain'), (e) => events.push(e), { throttle: 50 });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe(String(SIZE));
    expect((await res.arrayBuffer()).byteLength).toBe(SIZE);
    expect(events.at(-1)).toMatchObject({ loaded: SIZE, ratio: 1 });
  });

  it('does not report completion when the body ends early', async () => {
    const events: ProgressEvent[] = [];
    const res = await fetch(server.url + '/lying');
    const body = res.body!.pipeThrough(progress((e) => events.push(e), { total: SIZE, throttle: 0 }));
    await expect(new Response(body).arrayBuffer()).rejects.toThrow();
    expect(events.at(-1)).toMatchObject({ loaded: SIZE / 2, ratio: 0.5 });
  });
});
