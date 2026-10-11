import { createHash } from 'node:crypto';
import { ietf, memoryStore, upload, type UploadProgress } from 'fetchwire/upload';
import { afterEach, describe, expect, it } from 'vitest';
import { startIetfServer, type IetfServerOptions } from './servers/ietf-server';

type Server = Awaited<ReturnType<typeof startIetfServer>>;
let server: Server;
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

async function start(options?: IetfServerOptions) {
  server = await startIetfServer(options);
  servers.push(server);
  return server;
}

const KiB = 1024;
const makeFile = (size: number, name = 'video.bin') => {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 7 + (i >> 8)) & 255;
  return new File([bytes], name, { type: 'application/octet-stream', lastModified: 1_700_000_000_000 });
};
const sha = async (file: Blob) => createHash('sha256').update(new Uint8Array(await file.arrayBuffer())).digest('hex');
const fast = { retryDelay: () => 5, store: false as const };
const until = async (check: () => boolean, ms = 5000) => {
  for (const end = Date.now() + ms; !check(); ) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 5));
  }
};
const patches = () => server.log.filter((e) => e.method === 'PATCH');

describe('ietf() against the draft -12 reference server', () => {
  it('creates carefully, appends in chunks and returns the final response', async () => {
    await start();
    const file = makeFile(1000 * KiB, 'my "file" é.bin');
    const job = upload(file, { protocol: ietf({ endpoint: server.url + '/uploads' }), chunkSize: 256 * KiB, ...fast });
    const result = await job;
    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({ size: file.size, sha256: await sha(file) });
    expect(server.log.every((e) => e.interop === '9')).toBe(true);
    const [create] = server.log;
    expect(create).toMatchObject({ method: 'POST', complete: '?0', length: file.size, stored: 0, status: 201 });
    expect(patches().map((e) => [e.offset, e.complete])).toEqual([
      [0, '?0'],
      [256 * KiB, '?0'],
      [512 * KiB, '?0'],
      [768 * KiB, '?1'],
    ]);
    expect(job.state).toBe('done');
  });

  it('resumes from the server offset after the connection drops mid-chunk', async () => {
    await start();
    server.faults.push({ method: 'PATCH', skip: 1, dropAfter: 100 * KiB + 123 });
    const file = makeFile(800 * KiB);
    const result = await upload(file, { protocol: ietf({ endpoint: server.url + '/uploads' }), chunkSize: 256 * KiB, ...fast });
    expect(result.data).toMatchObject({ sha256: await sha(file) });
    const log = server.log.map((e) => `${e.method} ${e.offset ?? ''} ${e.outcome}`);
    const dropped = log.indexOf(`PATCH ${256 * KiB} dropped`);
    expect(dropped).toBeGreaterThan(0);
    expect(log[dropped + 1]).toBe('HEAD  response');
    expect(patches().map((e) => e.offset)).toContain(256 * KiB + 100 * KiB + 123);
  });

  it('asks for the offset after a lost response and does not resend stored bytes', async () => {
    await start();
    server.faults.push({ method: 'PATCH', dropResponse: true });
    const file = makeFile(600 * KiB);
    await upload(file, { protocol: ietf({ endpoint: server.url + '/uploads' }), chunkSize: 256 * KiB, ...fast });
    expect(patches().map((e) => e.offset)).toEqual([0, 256 * KiB, 512 * KiB]);
    expect(server.log.filter((e) => e.method === 'HEAD')).toHaveLength(1);
  });

  it('keeps estimated within confirmed and confirmed plus the bytes in flight', async () => {
    await start({ readDelay: 40 });
    const file = makeFile(1024 * KiB);
    const chunkSize = 256 * KiB;
    const events: UploadProgress[] = [];
    const job = upload(file, { protocol: ietf({ endpoint: server.url + '/uploads' }), chunkSize, onProgress: (p) => events.push(p), ...fast });
    const seen: UploadProgress[] = [];
    for await (const p of job.progress) seen.push(p);
    await job;
    for (const p of events) {
      expect(p.estimated).toBeGreaterThanOrEqual(p.confirmed);
      expect(p.estimated).toBeLessThanOrEqual(p.confirmed + p.inflight);
      expect(p.inflight).toBeLessThanOrEqual(chunkSize);
    }
    expect(events.some((p) => p.estimated > p.confirmed)).toBe(true);
    for (let i = 1; i < events.length; i++) expect(events[i].confirmed).toBeGreaterThanOrEqual(events[i - 1].confirmed);
    expect(seen.at(-1)).toMatchObject({ state: 'done', confirmed: file.size, total: file.size, inflight: 0 });
  });

  it('abort() stops the transfer and sends DELETE', async () => {
    await start({ readDelay: 5 });
    const store = memoryStore(new Map());
    const job = upload(makeFile(2048 * KiB), { protocol: ietf({ endpoint: server.url + '/uploads' }), chunkSize: 512 * KiB, store });
    await until(() => server.bytesReceived > 64 * KiB);
    await job.abort();
    await expect(job).rejects.toMatchObject({ name: 'AbortError' });
    expect(job.state).toBe('aborted');
    expect(server.log.at(-1)).toMatchObject({ method: 'DELETE', status: 204 });
    expect([...server.uploads.values()][0].deleted).toBe(true);
    expect(await store.get(`ietf ${server.url}/uploads:video.bin:${2048 * KiB}:1700000000000`)).toBeUndefined();
  });

  it('pause() stops all traffic until resume()', async () => {
    await start({ readDelay: 5 });
    const file = makeFile(2048 * KiB);
    const job = upload(file, { protocol: ietf({ endpoint: server.url + '/uploads' }), chunkSize: 512 * KiB, ...fast });
    await until(() => server.bytesReceived > 600 * KiB);
    job.pause();
    expect(job.state).toBe('paused');
    await new Promise((r) => setTimeout(r, 100));
    const [bytes, requests] = [server.bytesReceived, server.log.length];
    await new Promise((r) => setTimeout(r, 400));
    expect(server.bytesReceived).toBe(bytes);
    expect(server.log.length).toBe(requests);
    expect(server.log.at(-1)!.outcome).toBe('aborted');
    job.resume();
    const result = await job;
    expect(result.data).toMatchObject({ sha256: await sha(file) });
    expect(server.log[requests].method).toBe('HEAD');
  });

  it('pause() before the first request sends nothing', async () => {
    await start();
    const job = upload(makeFile(10 * KiB), { protocol: ietf({ endpoint: server.url + '/uploads' }), ...fast });
    job.pause();
    await new Promise((r) => setTimeout(r, 100));
    expect(server.log).toHaveLength(0);
    job.resume();
    await job;
    expect(server.log.map((e) => e.method)).toEqual(['POST', 'PATCH']);
  });

  it('uses the offset from a 409 response without a HEAD request', async () => {
    await start();
    let tampered = false;
    const lying: typeof fetch = (input, init) => {
      const headers = new Headers(init?.headers);
      if (init?.method === 'PATCH' && headers.get('upload-offset') === String(256 * KiB) && !tampered) {
        tampered = true;
        headers.set('Upload-Offset', '1');
      }
      return fetch(input, { ...init, headers });
    };
    const file = makeFile(600 * KiB);
    const result = await upload(file, { protocol: ietf({ endpoint: server.url + '/uploads' }), chunkSize: 256 * KiB, fetch: lying, ...fast });
    expect(result.data).toMatchObject({ sha256: await sha(file) });
    expect(server.log.some((e) => e.status === 409)).toBe(true);
    expect(server.log.some((e) => e.method === 'HEAD')).toBe(false);
  });

  it('retries 503 with Retry-After and halves the chunk after 413', async () => {
    await start();
    server.faults.push({ method: 'PATCH', status: 503, retryAfter: 0 }, { method: 'PATCH', skip: 1, status: 413 });
    const file = makeFile(600 * KiB);
    const result = await upload(file, { protocol: ietf({ endpoint: server.url + '/uploads' }), chunkSize: 256 * KiB, ...fast });
    expect(result.data).toMatchObject({ sha256: await sha(file) });
    const sent = patches().filter((e) => e.status && e.status < 300);
    expect(sent.map((e) => e.stored)).toEqual([256 * KiB, 128 * KiB, 128 * KiB, 88 * KiB]);
  });

  it('respects max-append-size and min-append-size from Upload-Limit', async () => {
    await start({ limits: { 'max-append-size': 100 * KiB, 'min-append-size': 10 * KiB } });
    const file = makeFile(250 * KiB);
    await upload(file, { protocol: ietf({ endpoint: server.url + '/uploads' }), chunkSize: 1 * KiB, ...fast });
    expect(patches().map((e) => e.stored)).toEqual([10 * KiB, ...Array(24).fill(10 * KiB)]);
    patches().forEach((e) => expect(e.stored).toBeLessThanOrEqual(100 * KiB));
  });

  it('cancels and fails when the file exceeds max-size', async () => {
    await start({ limits: { 'max-size': 100 * KiB } });
    server.faults.length = 0;
    const job = upload(makeFile(50 * KiB), { protocol: ietf({ endpoint: server.url + '/uploads' }), ...fast });
    await expect(job).resolves.toMatchObject({ status: 200 });
    const big = upload(makeFile(200 * KiB), { protocol: ietf({ endpoint: server.url + '/uploads' }), ...fast });
    await expect(big).rejects.toMatchObject({ status: 413 });
  });

  it('resumes a failed job from the resume store with a new job', async () => {
    await start();
    const store = memoryStore(new Map());
    const file = makeFile(700 * KiB);
    const options = { protocol: ietf({ endpoint: server.url + '/uploads' }), chunkSize: 256 * KiB, store, retryDelay: () => 5 };
    server.faults.push({ method: 'PATCH', skip: 1, status: 400 });
    await expect(upload(file, options)).rejects.toMatchObject({ status: 400 });
    const result = await upload(file, options);
    expect(result.data).toMatchObject({ sha256: await sha(file) });
    expect(server.log.filter((e) => e.method === 'POST')).toHaveLength(1);
    expect(patches().map((e) => e.offset)).toEqual([0, 256 * KiB, 256 * KiB, 512 * KiB]);
  });

  it('starts over when the stored upload URL is gone', async () => {
    await start();
    const store = memoryStore(new Map());
    const file = makeFile(10 * KiB);
    const protocol = ietf({ endpoint: server.url + '/uploads' });
    await store.set(`${protocol.key}:${file.name}:${file.size}:${file.lastModified}`, server.url + '/uploads/missing');
    const result = await upload(file, { protocol, ...fast, store });
    expect(result.status).toBe(200);
    expect(server.log.map((e) => `${e.method} ${e.status}`)).toEqual(['HEAD 404', 'POST 201', 'PATCH 200']);
  });

  it('uploads an empty file with a single completing creation request', async () => {
    await start();
    const result = await upload(new File([], 'empty.txt'), { protocol: ietf({ endpoint: server.url + '/uploads' }), ...fast });
    expect(result.data).toMatchObject({ size: 0 });
    expect(server.log).toHaveLength(1);
    expect(server.log[0]).toMatchObject({ method: 'POST', complete: '?1', length: 0, status: 200 });
  });

  it('works when append responses include Upload-Offset', async () => {
    await start({ offsetInAppendResponse: true });
    const file = makeFile(300 * KiB);
    const result = await upload(file, { protocol: ietf({ endpoint: server.url + '/uploads' }), chunkSize: 100 * KiB, ...fast });
    expect(result.data).toMatchObject({ sha256: await sha(file) });
  });

  it('fails on non-retryable errors and after the retry limit', async () => {
    await start();
    server.faults.push({ method: 'POST', status: 403 });
    await expect(upload(makeFile(1 * KiB), { protocol: ietf({ endpoint: server.url + '/uploads' }), ...fast })).rejects.toMatchObject({ status: 403 });
    for (let i = 0; i < 4; i++) server.faults.push({ method: 'POST', status: 500 });
    const job = upload(makeFile(1 * KiB), { protocol: ietf({ endpoint: server.url + '/uploads' }), ...fast, retries: 3 });
    await expect(job).rejects.toMatchObject({ status: 500 });
    expect(job.state).toBe('failed');
  });

  it('sends file metadata on creation', async () => {
    await start();
    const seen: Headers[] = [];
    const spy: typeof fetch = (input, init) => (seen.push(new Headers(init?.headers)), fetch(input, init));
    const file = new File(['x'], 'naïve (1).txt', { type: 'text/plain' });
    await upload(file, { protocol: ietf({ endpoint: server.url + '/uploads', headers: () => ({ Authorization: 'Bearer t' }) }), fetch: spy, ...fast });
    expect(seen[0].get('content-type')).toBe('text/plain');
    expect(seen[0].get('content-disposition')).toBe(`inline; filename="na_ve (1).txt"; filename*=UTF-8''na%C3%AFve%20%281%29.txt`);
    expect(seen.every((h) => h.get('authorization') === 'Bearer t')).toBe(true);
  });
});

describe('ietf() timeouts', () => {
  it('retries a request that stalls past the timeout', async () => {
    await start();
    let stalled = false;
    const stalling: typeof fetch = (input, init) => {
      if (init?.method === 'PATCH' && !stalled) {
        stalled = true;
        return new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)));
      }
      return fetch(input, init);
    };
    const file = makeFile(10 * KiB);
    const result = await upload(file, { protocol: ietf({ endpoint: server.url + '/uploads' }), fetch: stalling, timeout: 100, ...fast });
    expect(result.data).toMatchObject({ sha256: await sha(file) });
    expect(stalled).toBe(true);
  });
});
