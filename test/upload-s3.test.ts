import { createHash } from 'node:crypto';
import { MAX_PARTS, memoryStore, MIN_PART_SIZE, s3Multipart, upload, type S3MultipartOptions, type UploadProgress } from 'relaxios/upload';
import { afterEach, describe, expect, it } from 'vitest';
import { startS3Server } from './servers/s3-server';

type Server = Awaited<ReturnType<typeof startS3Server>>;
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

const MiB = 1024 * 1024;
const makeFile = (size: number) => {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 4096) bytes[i] = (i / 4096) & 255;
  return new File([bytes], 'big.bin', { lastModified: 1 });
};
const md5 = async (blob: Blob) => createHash('md5').update(new Uint8Array(await blob.arrayBuffer())).digest('hex');
const fast = { retryDelay: () => 5, store: false as const };
const until = async (check: () => boolean, ms = 5000) => {
  for (const end = Date.now() + ms; !check(); ) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 5));
  }
};

/** Callbacks the way an app would write them, talking to the fake S3 directly instead of a backend. */
function client(server: Server, extra: Partial<S3MultipartOptions<string>> = {}) {
  const calls = { create: 0, sign: [] as number[], complete: 0, abort: 0 };
  const options: S3MultipartOptions<string> = {
    async create(_file, signal) {
      calls.create++;
      const res = await fetch(server.url + '/bucket/big.bin?uploads', { method: 'POST', signal });
      return { uploadId: /<UploadId>(.+)<\/UploadId>/.exec(await res.text())![1], key: 'bucket/big.bin' };
    },
    async signPart(u, partNumber) {
      calls.sign.push(partNumber);
      return server.presign(u.key as string, u.uploadId, partNumber);
    },
    async complete(u, parts, signal) {
      calls.complete++;
      const body = `<CompleteMultipartUpload>${parts.map((p) => `<Part><PartNumber>${p.PartNumber}</PartNumber><ETag>${p.ETag}</ETag></Part>`).join('')}</CompleteMultipartUpload>`;
      const res = await fetch(`${server.url}/${u.key}?uploadId=${u.uploadId}`, { method: 'POST', body, signal });
      if (!res.ok) throw new Error('complete failed: ' + (await res.text()));
      return /<ETag>(.+)<\/ETag>/.exec(await res.text())![1];
    },
    async abort(u) {
      calls.abort++;
      await fetch(`${server.url}/${u.key}?uploadId=${u.uploadId}`, { method: 'DELETE' });
    },
    ...extra,
  };
  return { options, calls };
}

describe('s3Multipart() against a fake S3', () => {
  it('uploads 5 MiB parts in parallel and completes in order', async () => {
    const server = await startS3Server();
    servers.push(server);
    const file = makeFile(12 * MiB + 123);
    const { options, calls } = client(server, { concurrency: 3 });
    const events: UploadProgress[] = [];
    const etag = await upload(file, { protocol: s3Multipart(options), chunkSize: MiB, onProgress: (p) => events.push(p), ...fast });
    expect(etag).toMatch(/^"[0-9a-f]{32}-3"$/);
    expect(await md5(new Blob([new Uint8Array(server.objects.get('bucket/big.bin')!)]))).toBe(await md5(file));
    const parts = [...server.uploads.values()][0].parts;
    expect([...parts.values()].map((p) => p.data.length)).toEqual(expect.arrayContaining([5 * MiB, 5 * MiB, 2 * MiB + 123]));
    expect(calls).toMatchObject({ create: 1, complete: 1, abort: 0 });
    expect(server.maxActive).toBeGreaterThan(1);
    expect(server.maxActive).toBeLessThanOrEqual(3);
    for (const p of events) {
      expect(p.estimated).toBeGreaterThanOrEqual(p.confirmed);
      expect(p.estimated).toBeLessThanOrEqual(p.confirmed + p.inflight);
      expect(p.inflight).toBeLessThanOrEqual(3 * 5 * MiB);
    }
    expect(events.at(-1)).toMatchObject({ state: 'done', confirmed: file.size });
  });

  it('respects the concurrency limit', async () => {
    const server = await startS3Server({ readDelay: 1 });
    servers.push(server);
    const { options } = client(server, { concurrency: 2 });
    await upload(makeFile(20 * MiB), { protocol: s3Multipart(options), ...fast });
    expect(server.maxActive).toBe(2);
  });

  it('keeps parts under 10,000 for very large files', async () => {
    const size = 60 * 1024 * MiB;
    const huge = { size, name: 'huge', lastModified: 1, type: '', slice: () => new Blob([]) } as unknown as Blob;
    const numbers: number[] = [];
    let partSize = 0;
    const protocol = s3Multipart<number>({
      create: async () => ({ uploadId: 'u' }),
      signPart: async (_u, n) => `https://s3.invalid/part/${n}`,
      complete: async (_u, parts) => parts.length,
      abort: async () => {},
      concurrency: 16,
    });
    const fakeFetch = (async (url: string) => {
      numbers.push(+url.split('/').pop()!);
      return new Response(null, { headers: { ETag: '"x"' } });
    }) as typeof fetch;
    const count = await upload(huge, { protocol, fetch: fakeFetch, ...fast, onProgress: (p) => (partSize = Math.max(partSize, p.inflight)) });
    expect(count).toBe(MAX_PARTS);
    expect(Math.max(...numbers)).toBe(MAX_PARTS);
    expect(Math.ceil(size / MAX_PARTS)).toBeGreaterThan(MIN_PART_SIZE);
  });

  it('retries a part after the connection drops and re-signs after 403', async () => {
    const server = await startS3Server();
    servers.push(server);
    server.faults.push({ partNumber: 2, dropAfter: MiB }, { partNumber: 1, status: 403 });
    const file = makeFile(11 * MiB);
    const { options, calls } = client(server);
    await upload(file, { protocol: s3Multipart(options), ...fast });
    expect(await md5(new Blob([new Uint8Array(server.objects.get('bucket/big.bin')!)]))).toBe(await md5(file));
    expect(calls.sign.filter((n) => n === 1)).toHaveLength(2);
    expect(calls.sign.filter((n) => n === 2)).toHaveLength(2);
  });

  it('fails with a CORS hint when ETag is not readable', async () => {
    const server = await startS3Server();
    servers.push(server);
    server.faults.push({ partNumber: 1, noEtag: true });
    const { options } = client(server);
    await expect(upload(makeFile(6 * MiB), { protocol: s3Multipart(options), ...fast })).rejects.toThrow(/ExposeHeaders/);
  });

  it('abort() calls AbortMultipartUpload', async () => {
    const server = await startS3Server({ readDelay: 2 });
    servers.push(server);
    const { options, calls } = client(server);
    const job = upload(makeFile(16 * MiB), { protocol: s3Multipart(options), ...fast });
    await until(() => server.bytesReceived > MiB);
    await job.abort();
    await expect(job).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls.abort).toBe(1);
    const [u] = server.uploads.values();
    expect(u.aborted).toBe(true);
    expect(server.log.at(-1)).toMatchObject({ method: 'DELETE', status: 204 });
  });

  it('pause() stops all traffic and resume() finishes the upload', async () => {
    const server = await startS3Server({ readDelay: 2 });
    servers.push(server);
    const { options } = client(server, { concurrency: 2 });
    const file = makeFile(16 * MiB);
    const job = upload(file, { protocol: s3Multipart(options), ...fast });
    await until(() => server.bytesReceived > 2 * MiB);
    job.pause();
    await new Promise((r) => setTimeout(r, 100));
    const [bytes, requests] = [server.bytesReceived, server.log.length];
    await new Promise((r) => setTimeout(r, 400));
    expect(server.bytesReceived).toBe(bytes);
    expect(server.log.length).toBe(requests);
    job.resume();
    await job;
    expect(await md5(new Blob([new Uint8Array(server.objects.get('bucket/big.bin')!)]))).toBe(await md5(file));
  });

  it('resumes from stored parts with a new job', async () => {
    const server = await startS3Server();
    servers.push(server);
    const store = memoryStore(new Map());
    const file = makeFile(16 * MiB);
    const { options, calls } = client(server, { concurrency: 1 });
    server.faults.push({ partNumber: 3, status: 400 });
    await expect(upload(file, { protocol: s3Multipart(options), store, retryDelay: () => 5 })).rejects.toMatchObject({ status: 400 });
    await upload(file, { protocol: s3Multipart(options), store, retryDelay: () => 5 });
    expect(calls.create).toBe(1);
    expect(calls.sign).toEqual([1, 2, 3, 3, 4]);
    expect(await md5(new Blob([new Uint8Array(server.objects.get('bucket/big.bin')!)]))).toBe(await md5(file));
  });
});
