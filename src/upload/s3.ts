import { headersOf, httpError } from './http';
import { UploadError } from './job';
import type { Protocol, UploadContext } from './types';

export interface S3Part {
  PartNumber: number;
  ETag: string;
}

/** What `create` returns: the UploadId plus anything your signer needs (Key, Bucket, ...). */
export interface S3Upload {
  uploadId: string;
  [key: string]: unknown;
}

export interface S3MultipartOptions<R> {
  /** Calls CreateMultipartUpload (usually through your backend). */
  create(file: Blob, signal: AbortSignal): Promise<S3Upload>;
  /** Returns a presigned UploadPart URL. Called again for every retry, so expired URLs are replaced. */
  signPart(upload: S3Upload, partNumber: number, signal: AbortSignal): Promise<string | { url: string; headers?: HeadersInit }>;
  /** Calls CompleteMultipartUpload with the parts in order. */
  complete(upload: S3Upload, parts: S3Part[], signal: AbortSignal): Promise<R>;
  /** Calls AbortMultipartUpload. Runs when the job is aborted. */
  abort(upload: S3Upload): Promise<unknown>;
  /** Parallel part uploads. Default 4. */
  concurrency?: number;
}

const MiB = 1024 * 1024;
export const MIN_PART_SIZE = 5 * MiB;
export const MAX_PARTS = 10_000;
const MAX_PART_SIZE = 5 * 1024 * MiB;

interface State {
  upload: S3Upload;
  partSize: number;
  parts: Record<number, string>;
}

/** S3 multipart upload. The bucket CORS rules must list ETag in ExposeHeaders, or browsers cannot read it. */
export function s3Multipart<R>(options: S3MultipartOptions<R>): Protocol<R> {
  const run = async (ctx: UploadContext): Promise<R> => {
    const size = ctx.size;
    let state: State | undefined = ctx.stored ? JSON.parse(ctx.stored) : undefined;
    if (!state) {
      const partSize = Math.max(ctx.chunkSize, MIN_PART_SIZE, Math.ceil(size / MAX_PARTS));
      if (partSize > MAX_PART_SIZE) throw new UploadError('File is too large for S3 multipart upload', { retry: false });
      state = { upload: await ctx.task((t) => options.create(ctx.file, t.signal)), partSize, parts: {} };
      ctx.save(JSON.stringify(state));
    }
    const { upload, partSize, parts } = state;
    ctx.onAbort(() => options.abort(upload));
    const count = Math.max(1, Math.ceil(size / partSize));
    const range = (n: number) => [(n - 1) * partSize, Math.min(size, n * partSize)];
    const confirm = () => ctx.confirm(Object.keys(parts).reduce((sum, n) => sum + range(+n)[1] - range(+n)[0], 0));
    confirm();

    const queue = Array.from({ length: count }, (_, i) => i + 1).filter((n) => !parts[n]);
    let failure: unknown;
    const worker = async () => {
      for (let n; (n = queue.shift()); ) {
        const part = n;
        parts[part] = await ctx.task(async (t) => {
          const signed = await options.signPart(upload, part, t.signal);
          const { url, headers } = typeof signed == 'string' ? { url: signed, headers: undefined } : signed;
          const [start, end] = range(part);
          t.send(end - start);
          const res = await ctx.fetch(url, { method: 'PUT', headers: await headersOf(headers), body: ctx.file.slice(start, end), signal: t.signal });
          // 403 usually means an expired presigned URL; the retry signs again.
          if (!res.ok) throw httpError(res, res.status === 403 || undefined);
          const etag = res.headers.get('etag');
          if (!etag) throw new UploadError('ETag is not readable. Add ETag to ExposeHeaders in the bucket CORS rules.', { retry: false });
          return etag;
        });
        ctx.save(JSON.stringify(state));
        confirm();
      }
    };
    // Wait for every worker so no part keeps uploading after a failure.
    await Promise.all(
      Array.from({ length: Math.min(options.concurrency || 4, queue.length) }, () =>
        worker().catch((e) => {
          failure ??= e;
          queue.length = 0;
        }),
      ),
    );
    if (failure) throw failure;
    const list = Object.keys(parts)
      .map((n) => ({ PartNumber: +n, ETag: parts[+n] }))
      .sort((a, b) => a.PartNumber - b.PartNumber);
    return ctx.task((t) => options.complete(upload, list, t.signal));
  };
  return Object.assign(run, { key: 's3' });
}
