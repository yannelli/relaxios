import { HttpError } from './error';
import type { FetchRequest, HttpResponse, RequestConfig, ResponseType } from './types';
import { buildURL, isObject } from './util';

/** Builds fetch Headers, skipping null, undefined and false values. */
export function toHeaders(source: RequestConfig['headers']): Headers {
  const headers = new Headers();
  if (source instanceof Headers) return new Headers(source);
  for (const key of Object.keys(source || {})) {
    const value = (source as Record<string, unknown>)[key];
    if (value != null && value !== false) headers.set(key, String(value));
  }
  return headers;
}

/** Plain objects and arrays become JSON; other values pass through to fetch. */
export function encodeBody(data: unknown, headers: Headers): BodyInit | undefined {
  if (data == null) return;
  if (isObject(data) || Array.isArray(data)) {
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    return JSON.stringify(data);
  }
  return data as BodyInit;
}

export async function parseBody(res: Response, type?: ResponseType): Promise<unknown> {
  if (type === 'stream') return res.body;
  if (type && type !== 'json' && type !== 'text') return res[type]();
  const text = await res.text();
  const json = type === 'json' || (!type && /json/i.test(res.headers.get('content-type') || ''));
  return json && text ? JSON.parse(text) : text;
}

const ok = (status: number) => status >= 200 && status < 300;

export async function fetchAdapter(config: RequestConfig): Promise<HttpResponse> {
  const { timeout, signal: user, validateStatus = ok } = config;
  const headers = toHeaders(config.headers);
  const body = encodeBody(config.data, headers);
  const timer = timeout ? AbortSignal.timeout(timeout) : undefined;
  const signal = user && timer ? AbortSignal.any([user, timer]) : user || timer;
  const request = {
    ...config.fetchOptions,
    url: buildURL(config),
    method: (config.method || 'get').toUpperCase(),
    headers,
    body,
    signal,
  } as FetchRequest;
  if (config.credentials) request.credentials = config.credentials;
  if (body instanceof ReadableStream) (request as { duplex?: string }).duplex = 'half';
  const fail = (message: string, code: string, response?: HttpResponse, cause?: unknown) =>
    new HttpError(message, code, config, request, response, cause);

  try {
    const res = await (config.fetch || fetch)(request.url, request);
    const response: HttpResponse = {
      data: undefined,
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
      config,
      request,
    };
    try {
      response.data = await parseBody(res, config.responseType);
    } catch (e) {
      if (e instanceof SyntaxError) throw fail(e.message, 'ERR_BAD_RESPONSE', response, e);
      throw e;
    }
    if (validateStatus && !validateStatus(res.status)) {
      const code = res.status >= 400 && res.status < 500 ? 'ERR_BAD_REQUEST' : 'ERR_BAD_RESPONSE';
      throw fail('Request failed with status code ' + res.status, code, response);
    }
    return response;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (timer?.aborted) throw fail(`timeout of ${timeout}ms exceeded`, 'ETIMEDOUT', undefined, e);
    if (user?.aborted) throw fail('canceled', 'ERR_CANCELED', undefined, user.reason);
    throw fail('Network Error', 'ERR_NETWORK', undefined, e);
  }
}
