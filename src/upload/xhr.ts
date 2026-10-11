import { xhrFetch } from 'relaxios/progress';
import { headersOf, httpError, toResult, type HeadersOption } from './http';
import type { Protocol, UploadContext, UploadResult } from './types';

export interface XhrSingleOptions {
  url: string;
  /** Default POST. */
  method?: string;
  headers?: HeadersOption;
  /** Sends multipart/form-data with the file under this field name. Default: the raw file as the body. */
  field?: string;
  withCredentials?: boolean;
}

/** One request for servers without chunk support. `estimated` follows xhr.upload; retries resend the whole file. */
export function xhrSingle<T = unknown>(options: XhrSingleOptions): Protocol<UploadResult<T>> {
  const run = (ctx: UploadContext) =>
    ctx.task(async (t) => {
      const { file, size } = ctx;
      let body: Blob | FormData = file;
      if (options.field) {
        body = new FormData();
        body.append(options.field, file, ctx.name);
      }
      t.send(size);
      const send = xhrFetch({ onUpload: (e) => t.sent(e.ratio == null ? e.loaded : e.ratio * size), throttle: 0 });
      const res = await send(options.url, {
        method: options.method || 'POST',
        headers: await headersOf(options.headers),
        body,
        signal: t.signal,
        credentials: options.withCredentials ? 'include' : undefined,
      });
      if (!res.ok) throw httpError(res);
      ctx.confirm(size);
      return toResult<T>(res);
    });
  return Object.assign(run, { key: 'xhr ' + options.url });
}
