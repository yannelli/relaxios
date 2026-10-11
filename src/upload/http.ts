import { UploadError } from './job';
import type { UploadResult } from './types';

export type HeadersOption = HeadersInit | (() => HeadersInit | Promise<HeadersInit>);

export const headersOf = async (headers?: HeadersOption): Promise<Headers> =>
  new Headers(typeof headers == 'function' ? await headers() : headers);

/** UploadError for a response, with Retry-After converted to ms. */
export function httpError(res: Response, retry?: boolean): UploadError {
  const after = res.headers.get('retry-after');
  const ms = after ? (+after >= 0 ? +after * 1000 : Date.parse(after) - Date.now()) : NaN;
  return new UploadError('Upload request failed with status ' + res.status, {
    status: res.status,
    response: res,
    retry,
    retryAfter: ms >= 0 ? ms : undefined,
  });
}

/** Reads the final response: JSON when the Content-Type says so, else text. */
export async function toResult<T>(res: Response): Promise<UploadResult<T>> {
  const text = await res.text();
  let data: any = text;
  if (text && /json/i.test(res.headers.get('content-type') || '')) {
    try {
      data = JSON.parse(text);
    } catch {}
  }
  return { status: res.status, headers: res.headers, data };
}
