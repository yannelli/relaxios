import { isObject } from 'fetchwire';
import type { CustomParamsSerializer, GenericFormData, ParamsSerializerOptions, SerializerOptions } from './types';

// Bracket serialization follows axios 1.20.0 lib/helpers/toFormData.js and buildURL.js (MIT).
type Key = string | number;

const isVisitable = (value: unknown) => isObject(value) || Array.isArray(value);
const strip = (key: string) => (key.endsWith('[]') ? key.slice(0, -2) : key);
const render = (path: Key[] | undefined, key: Key, dots?: boolean) =>
  path
    ? path
        .concat(key)
        .map((token, i) => ((token = strip(String(token))), !dots && i ? '[' + token + ']' : token))
        .join(dots ? '.' : '')
    : String(key);
const toArray = (value: any): any[] | null =>
  Array.isArray(value) ? value : typeof value?.length == 'number' ? Array.from(value) : null;

/** Walks a value like axios: `a[]=1` for flat arrays, `a[b][c]=1` for nesting, `key{}` for JSON. */
export function flatten(
  obj: object,
  append: (key: string, value: any) => void,
  options: SerializerOptions = {},
  blobs?: boolean,
): void {
  const { dots, indexes, metaTokens = true } = options;
  const convert = (v: any) =>
    v === null
      ? ''
      : v instanceof Date
        ? v.toISOString()
        : typeof v == 'boolean'
          ? String(v)
          : blobs && (v instanceof ArrayBuffer || ArrayBuffer.isView(v))
            ? new Blob([v as BlobPart])
            : v;
  const visit = (value: any, key: string, path?: Key[]) => {
    let list: any[] | null = value;
    if (!path && typeof value == 'object') {
      if (key.endsWith('{}')) return append(metaTokens ? key : key.slice(0, -2), JSON.stringify(value));
      const files = typeof FileList != 'undefined' && value instanceof FileList;
      if ((Array.isArray(value) && !value.some(isVisitable)) || ((files || key.endsWith('[]')) && (list = toArray(value)))) {
        key = strip(key);
        list!.forEach(
          (el, i) =>
            el != null && append(indexes === true ? render([key], i, dots) : indexes === null ? key : key + '[]', convert(el)),
        );
        return;
      }
    }
    if (isVisitable(value)) build(value, path ? path.concat(key) : [key]);
    else append(render(path, key, dots), convert(value));
  };
  const build = (value: object, path?: Key[]) => {
    for (const [key, el] of Object.entries(value)) if (el != null) visit(el, key.trim(), path);
  };
  build(obj);
}

export const encode = (value: any): string =>
  encodeURIComponent(value).replace(/%3A/gi, ':').replace(/%24/g, '$').replace(/%2C/gi, ',').replace(/%20/g, '+');

export function serialize(params: any, options?: ParamsSerializerOptions | CustomParamsSerializer): string {
  const opts: ParamsSerializerOptions = typeof options == 'function' ? { serialize: options } : options || {};
  if (opts.serialize) return opts.serialize(params, opts);
  if (params instanceof URLSearchParams) return params.toString();
  const enc = opts.encode ? (v: any) => opts.encode!(v, encode) : encode;
  const pairs: string[] = [];
  flatten(params, (k, v) => pairs.push(enc(k) + '=' + enc(v)), opts);
  return pairs.join('&');
}

export function toFormData(obj: object, formData?: GenericFormData, options?: SerializerOptions): GenericFormData {
  const target = formData || new FormData();
  flatten(obj, (k, v) => target.append(k, v), options, true);
  return target;
}

export function toURLEncodedForm(obj: object, options?: SerializerOptions): string {
  const search = new URLSearchParams();
  flatten(obj, (k, v) => search.append(k, v), options);
  return search.toString();
}
