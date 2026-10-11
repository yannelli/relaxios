import type { RequestConfig } from './types';

type Obj = Record<string, any>;

/** Plain objects and simple class instances; not Blob, Headers, Date, arrays, etc. */
export const isObject = (value: unknown): value is Obj =>
  Object.prototype.toString.call(value) === '[object Object]';

const clone = (value: unknown, caseless?: boolean): any =>
  isObject(value) ? deepMerge({}, value, caseless) : Array.isArray(value) ? value.slice() : value;

/** Merges b into a copy of a. Plain objects merge deeply, everything else is replaced. */
export function deepMerge(a: Obj, b: Obj, caseless?: boolean): Obj {
  const out: Obj = {};
  for (const key of Object.keys(a)) if (key !== '__proto__') out[key] = clone(a[key], caseless);
  for (const key of Object.keys(b)) {
    if (key === '__proto__') continue;
    if (caseless) {
      for (const k of Object.keys(out)) if (k !== key && k.toLowerCase() === key.toLowerCase()) delete out[k];
    }
    out[key] = isObject(out[key]) && isObject(b[key]) ? deepMerge(out[key], b[key], caseless) : clone(b[key], caseless);
  }
  return out;
}

const toObject = (headers: unknown): unknown =>
  headers instanceof Headers ? Object.fromEntries(headers) : headers;

/** Merges config over defaults. Undefined never overrides; `url` and `data` are not inherited. */
export function mergeConfig<C extends Obj = RequestConfig>(defaults: Obj = {}, config: Obj = {}): C {
  const out: Obj = {};
  const add = (source: Obj, own?: boolean) => {
    for (const key of Object.keys(source)) {
      let value = source[key];
      if (key === '__proto__' || value === undefined || (!own && (key === 'url' || key === 'data'))) continue;
      if (key === 'headers') value = toObject(value);
      out[key] =
        key === 'data'
          ? value
          : isObject(out[key]) && isObject(value)
            ? deepMerge(out[key], value, key === 'headers')
            : clone(value, key === 'headers');
    }
  };
  add(defaults);
  add(config, true);
  return out as C;
}

export const isAbsoluteURL = (url: string): boolean => /^([a-z][a-z\d+\-.]*:)?\/\//i.test(url);

/** Arrays repeat the key (`a=1&a=2`), Dates become ISO strings, objects become JSON. */
export function serializeParams(params: Obj): string {
  const search = new URLSearchParams();
  for (const key of Object.keys(params)) {
    for (const v of [params[key]].flat()) {
      if (v != null) search.append(key, v instanceof Date ? v.toISOString() : isObject(v) ? JSON.stringify(v) : String(v));
    }
  }
  return search.toString();
}

/** Joins baseURL and url, then appends serialized params. */
export function buildURL(config: RequestConfig): string {
  let url = config.url || '';
  const base = config.baseURL;
  if (base && (config.allowAbsoluteUrls === false || !isAbsoluteURL(url))) {
    url = url ? base.replace(/\/+$/, '') + '/' + url.replace(/^\/+/, '') : base;
  }
  const params = config.params;
  const query = !params
    ? ''
    : params instanceof URLSearchParams
      ? params.toString()
      : (config.paramsSerializer || serializeParams)(params);
  if (!query) return url;
  url = url.split('#')[0];
  return url + (url.includes('?') ? '&' : '?') + query;
}
