import { headersOf, httpError, toResult, type HeadersOption } from './http';
import { UploadError } from './job';
import type { Protocol, UploadContext, UploadResult } from './types';

// Client for draft-ietf-httpbis-resumable-upload-12. Section numbers below refer to that draft.
/** Appendix B: interop version for draft -12. */
export const INTEROP_VERSION = '9';

export interface IetfOptions {
  /** The resource that creates uploads (Section 4.2). */
  endpoint: string;
  /** Creation method. Default POST. */
  method?: string;
  /** Extra headers for every request, such as Authorization. */
  headers?: HeadersOption;
  credentials?: RequestCredentials;
}

export interface UploadLimits {
  'max-size'?: number;
  'min-size'?: number;
  'max-append-size'?: number;
  'min-append-size'?: number;
  'max-age'?: number;
}


/** Bare item of a Structured Field Item (RFC 9651); parameters are dropped. */
const item = (headers: Headers, name: string) => headers.get(name)?.split(';')[0].trim();
const integer = (value?: string) => (value && /^\d{1,15}$/.test(value) ? +value : undefined);

/** Section 4.1.4: a known key with a non-integer value invalidates the whole field. */
export function parseLimits(value: string | null): UploadLimits | undefined {
  if (!value) return;
  const limits: Record<string, number> = {};
  for (const member of value.split(',')) {
    const [key, raw = '?1'] = member.split(';')[0].trim().split('=');
    if (!/^(max|min)-(append-)?size$|^max-age$/.test(key)) continue;
    const n = integer(raw);
    if (n === undefined) return;
    limits[key] = n;
  }
  return limits;
}

/** Section 4.2.1 recommends the inline disposition type for the file name. */
const disposition = (name: string) =>
  `inline; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  )}`;

export function ietf<T = unknown>(options: IetfOptions): Protocol<UploadResult<T>> {
  const run = async (ctx: UploadContext): Promise<UploadResult<T>> => {
    const { file, size } = ctx;
    let url = ctx.stored;
    let limits: UploadLimits = {};
    let chunk = ctx.chunkSize;
    let known: number | undefined;

    const send = async (target: string, method: string, fields: Record<string, string>, signal?: AbortSignal, body?: Blob) => {
      const headers = await headersOf(options.headers);
      for (const name in fields) headers.set(name, fields[name]);
      headers.set('Upload-Draft-Interop-Version', INTEROP_VERSION);
      const res = await ctx.fetch(target, { method, headers, body, signal, ...(options.credentials && { credentials: options.credentials }) });
      limits = { ...limits, ...parseLimits(res.headers.get('upload-limit')) };
      return res;
    };
    const fail = async (message: string): Promise<never> => {
      await send(url!, 'DELETE', {}).catch(() => {});
      throw new UploadError(message, { retry: false });
    };
    // Section 4.1.4: stop and cancel when the file exceeds max-size.
    const check = () => (limits['max-size'] ?? Infinity) < size && fail('File exceeds max-size');
    const isFinal = (res: Response) => item(res.headers, 'upload-complete') === '?1';
    const finish = (res: Response) => (res.ok ? toResult<T>(res) : Promise.reject(httpError(res, false)));

    // Section 4.3: offset retrieval.
    const offset = async (signal: AbortSignal) => {
      const res = await send(url!, 'HEAD', {}, signal);
      if (!res.ok) throw httpError(res);
      const value = integer(item(res.headers, 'upload-offset'));
      if (value === undefined) throw new UploadError('Missing Upload-Offset', { retry: false, response: res });
      if (value > size) await fail('Offset past end of file');
      await check();
      return value;
    };

    if (url) {
      try {
        known = await ctx.task((t) => offset(t.signal));
      } catch (e) {
        if (![404, 410].includes((e as UploadError).status!)) throw e;
        url = undefined;
      }
    }
    if (!url) {
      // Section 10.2, careful creation: fetch cannot read 104 responses, so take the URL from the final response.
      const res = await ctx.task(async (t) => {
        const fields: Record<string, string> = { 'Upload-Complete': size ? '?0' : '?1', 'Upload-Length': '' + size };
        if (file.type) fields['Content-Type'] = file.type;
        if (ctx.name) fields['Content-Disposition'] = disposition(ctx.name);
        const res = await send(options.endpoint, options.method || 'POST', fields, t.signal);
        if (!res.ok && !isFinal(res)) throw httpError(res);
        return res;
      });
      if (isFinal(res)) return finish(res);
      const location = res.headers.get('location');
      if (!location) throw new UploadError('No upload resource created', { retry: false, response: res });
      url = new URL(location, res.url || options.endpoint).href;
      known = integer(item(res.headers, 'upload-offset')) ?? 0;
      ctx.save(url);
      await check();
    }
    ctx.onAbort(() => send(url!, 'DELETE', {}));
    ctx.confirm(known!);

    // Section 4.4: append one chunk per task; 4.7: retry heuristics.
    for (;;) {
      const res = await ctx.task(async (t) => {
        if (known === undefined) ctx.confirm((known = await offset(t.signal)));
        const start = known;
        const min = limits['min-append-size'] ?? 0;
        const end = Math.min(size, start + Math.max(min, Math.min(chunk, limits['max-append-size'] ?? Infinity)));
        const last = end === size;
        known = undefined;
        t.send(end - start);
        const res = await send(
          url!,
          'PATCH',
          { 'Upload-Offset': '' + start, 'Upload-Complete': last ? '?1' : '?0', 'Content-Type': 'application/partial-upload' },
          t.signal,
          file.slice(start, end),
        );
        const complete = item(res.headers, 'upload-complete');
        if (complete === '?1' || (last && res.ok && complete !== '?0')) return res;
        if (res.ok) {
          known = integer(item(res.headers, 'upload-offset')) ?? end;
          return;
        }
        const error = httpError(res);
        if (res.status === 409) known = integer(item(res.headers, 'upload-offset'));
        if (res.status === 413) {
          if (end - start <= Math.max(min, 1)) throw httpError(res, false);
          chunk = Math.max(min, Math.floor((end - start) / 2));
        }
        if (res.status === 409 || res.status === 413) Object.assign(error, { retry: true, retryAfter: 0 });
        throw error;
      });
      if (res) return finish(res);
      ctx.confirm(known!);
    }
  };
  return Object.assign(run, { key: 'ietf ' + options.endpoint });
}
