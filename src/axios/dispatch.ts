import { buildURL, fetchAdapter, HttpError, isObject, mergeConfig } from 'fetchwire';
import { trackResponse, xhrFetch, type ProgressEvent } from 'fetchwire/progress';
import { AxiosError, CanceledError, isCancel } from './error';
import { AxiosHeaders } from './headers';
import { serialize, toFormData, toURLEncodedForm } from './params';
import type { AxiosProgressEvent } from './types';

// Request flow follows axios 1.20.0 lib/core (dispatchRequest, Axios._request) and lib/defaults (MIT).
const METHODS = ['delete', 'get', 'head', 'options', 'post', 'put', 'patch', 'purge', 'link', 'unlink', 'query'];
const FORM = 'application/x-www-form-urlencoded';

function stringifySafely(raw: unknown): string {
  if (typeof raw == 'string') {
    try {
      JSON.parse(raw);
      return raw.trim();
    } catch {}
  }
  return JSON.stringify(raw);
}

function transformRequest(this: any, data: any, headers: AxiosHeaders) {
  const type: string = headers.getContentType() || '';
  const files = typeof FileList != 'undefined' && data instanceof FileList;
  const json = type.includes('application/json');
  if (typeof HTMLFormElement != 'undefined' && data instanceof HTMLFormElement) data = new FormData(data);
  if (data instanceof FormData && json) return JSON.stringify(Object.fromEntries(data));
  if (data instanceof URLSearchParams) {
    headers.setContentType(FORM + ';charset=utf-8', false);
    return data + '';
  }
  if (files || isObject(data) || Array.isArray(data)) {
    if (type.includes(FORM)) return toURLEncodedForm(data, this.formSerializer);
    if (files || type.includes('multipart/form-data')) return toFormData(files ? { 'files[]': data } : data, undefined, this.formSerializer);
    headers.setContentType('application/json', false);
    return JSON.stringify(data);
  }
  return json && (data === null || typeof data != 'object') ? stringifySafely(data) : data;
}

function transformResponse(this: any, data: any) {
  const { transitional = {}, responseType: type } = this;
  if (data && typeof data == 'string' && ((transitional.forcedJSONParsing && !type) || type === 'json')) {
    try {
      return JSON.parse(data, this.parseReviver);
    } catch (e) {
      if (!transitional.silentJSONParsing && type === 'json') throw AxiosError.from(e, 'ERR_BAD_RESPONSE', this, null, this.response);
    }
  }
  return data;
}

export const defaults = {
  transitional: { silentJSONParsing: true, forcedJSONParsing: true, clarifyTimeoutError: false },
  transformRequest: [transformRequest],
  transformResponse: [transformResponse],
  timeout: 0,
  xsrfCookieName: 'XSRF-TOKEN',
  xsrfHeaderName: 'X-XSRF-TOKEN',
  maxContentLength: -1,
  maxBodyLength: -1,
  validateStatus: (status: number) => status >= 200 && status < 300,
  headers: Object.fromEntries(
    METHODS.map((m): [string, object] => [m, {}]).concat([['common', { Accept: 'application/json, text/plain, */*', 'Content-Type': undefined }]]),
  ),
};

/** Flattens `headers.common` and `headers[method]` into one AxiosHeaders before interceptors run. */
export function prepare(config: any) {
  const headers = config.headers || {};
  const context = { ...headers.common, ...headers[config.method] };
  for (const m of METHODS.concat('common')) delete headers[m];
  config.headers = AxiosHeaders.concat(context, headers);
  return config;
}

const transform = (config: any, fns: any, response?: any) => {
  const context = response || config;
  const headers = AxiosHeaders.from(context.headers);
  let data = context.data;
  for (const fn of [].concat(fns || [])) data = (fn as Function).call(config, data, headers.normalize(), response?.status);
  headers.normalize();
  return data;
};

const throwIfCanceled = (config: any) => {
  if (config.signal?.aborted) throw new CanceledError(null, config);
};

export async function dispatch(config: any) {
  throwIfCanceled(config);
  config.headers = AxiosHeaders.from(config.headers);
  config.data = transform(config, config.transformRequest);
  if (['post', 'put', 'patch'].includes(config.method)) config.headers.setContentType(FORM, false);
  const finish = (response: any) => {
    config.response = response;
    try {
      response.data = transform(config, config.transformResponse, response);
    } finally {
      delete config.response;
    }
    response.headers = AxiosHeaders.from(response.headers);
  };
  try {
    const response = await (typeof config.adapter == 'function' ? config.adapter : send)(config);
    throwIfCanceled(config);
    finish(response);
    return response;
  } catch (reason: any) {
    if (!isCancel(reason)) {
      throwIfCanceled(config);
      if (reason?.response) finish(reason.response);
    }
    throw reason;
  }
}

export const buildFullURL = (config: any) => buildURL({ ...config, paramsSerializer: (p) => serialize(p, config.paramsSerializer) });

const readCookie = (name: string) => {
  for (const cookie of document.cookie.split(';')) {
    const pair = cookie.trimStart();
    const i = pair.indexOf('=');
    if (i > 0 && pair.slice(0, i) === name) {
      try {
        return decodeURIComponent(pair.slice(i + 1));
      } catch {
        return pair.slice(i + 1);
      }
    }
  }
};

const toAxiosEvent = (e: ProgressEvent, kind: string, event?: unknown): AxiosProgressEvent => ({
  loaded: e.loaded,
  total: e.total,
  progress: e.ratio,
  bytes: e.bytes,
  rate: e.rate,
  estimated: e.estimated,
  event,
  lengthComputable: e.lengthComputable,
  [kind]: true,
});
const listener = (handler: ((e: AxiosProgressEvent) => void) | undefined, kind: string) =>
  handler && ((e: ProgressEvent, raw?: unknown) => handler(toAxiosEvent(e, kind, raw)));

/** Built-in transport: fetch by default, XMLHttpRequest for upload progress or `adapter: 'xhr'`. */
async function send(config: any) {
  const { headers, data, auth, onUploadProgress: up, onDownloadProgress: down, responseType: type } = config;
  const url = buildFullURL(config);
  const adapter = [].concat(config.adapter)[0];
  if (auth) headers.set('Authorization', 'Basic ' + btoa(String.fromCharCode(...new TextEncoder().encode(`${auth.username || ''}:${auth.password || ''}`))));
  if (data instanceof FormData) headers.setContentType(undefined);
  if (data instanceof Blob && data.size) headers.setContentType(data.type || 'application/octet-stream');
  if (typeof window != 'undefined' && typeof document != 'undefined') {
    let withToken = config.withXSRFToken;
    if (typeof withToken == 'function') withToken = withToken(config);
    if (withToken === true || (withToken == null && new URL(url, location.href).origin === location.origin)) {
      const value = config.xsrfHeaderName && config.xsrfCookieName && readCookie(config.xsrfCookieName);
      if (value) headers.set(config.xsrfHeaderName, value);
    }
  }
  let res;
  try {
    res = await fetchAdapter({
      url,
      method: config.method,
      headers: headers.toJSON(true),
      // XMLHttpRequest drops GET and HEAD bodies; fetch would throw.
      data: /^(get|head)$/.test(config.method) ? undefined : data,
      timeout: config.timeout,
      signal: config.signal,
      responseType: type === 'arraybuffer' ? 'arrayBuffer' : type === 'formdata' ? 'formData' : type === 'blob' || type === 'stream' ? type : 'text',
      validateStatus: null,
      credentials: config.withCredentials ? 'include' : undefined,
      fetchOptions: config.maxRedirects === 0 ? { ...config.fetchOptions, redirect: 'manual' } : config.fetchOptions,
      fetch:
        typeof XMLHttpRequest != 'undefined' && !(data instanceof ReadableStream) && (adapter === 'xhr' || (up && adapter !== 'fetch'))
          ? xhrFetch({ onUpload: listener(up, 'upload'), onDownload: listener(down, 'download') })
          : down && (async (u, init) => trackResponse(await fetch(u, init), listener(down, 'download')!)),
    });
  } catch (e) {
    if (!(e instanceof HttpError)) throw e;
    const { code, request } = e;
    if (code === 'ERR_CANCELED') throw new CanceledError(null, config, request);
    const timeout = code === 'ETIMEDOUT';
    const message = (timeout && config.timeoutErrorMessage) || e.message;
    throw new AxiosError(message, timeout && !config.transitional?.clarifyTimeoutError ? 'ECONNABORTED' : code, config, request, undefined, e.cause);
  }
  const { status, request } = res;
  const response = { data: res.data, status, statusText: res.statusText, headers: AxiosHeaders.from(res.headers), config, request };
  const validate = config.validateStatus;
  if (!status || !validate || validate(status)) return response;
  const code = status >= 400 && status < 500 ? 'ERR_BAD_REQUEST' : 'ERR_BAD_RESPONSE';
  throw new AxiosError('Request failed with status code ' + status, code, config, request, response);
}

/** mergeConfig, plus axios's rule that an explicit `validateStatus: undefined` resolves every status. */
export const merge = (a: any, b: any = {}) => {
  const config = mergeConfig<any>(a, b);
  if (Object.hasOwn(b, 'validateStatus') && b.validateStatus === undefined) config.validateStatus = undefined;
  return config;
};
