import type { AxiosHeaderValue, RawAxiosHeaders } from './types';

type Source = RawAxiosHeaders | AxiosHeaders | Headers | Iterable<[string, AxiosHeaderValue]> | null | undefined;
type Parser = RegExp | ((this: AxiosHeaders, value: AxiosHeaderValue, header: string) => any);
type Rewrite = boolean | undefined;

const find = (target: object, name: string) => {
  const lower = name.trim().toLowerCase();
  return Object.keys(target).find((key) => key.toLowerCase() === lower);
};

const normalize = (value: any): any =>
  value === false || value == null ? value : Array.isArray(value) ? value.map(normalize) : String(value).replace(/[\r\n]+$/, '');

/** Header names are own properties, so `headers['content-type']` works next to `headers.get()`. */
export class AxiosHeaders {
  [key: string]: any;

  constructor(headers?: Source) {
    this.set(headers);
  }

  set(header?: string | Source, valueOrRewrite?: any, rewrite?: Rewrite): this {
    if (typeof header == 'string') {
      const key = find(this, header);
      if (!key || this[key] === undefined || rewrite || (rewrite === undefined && this[key] !== false)) {
        this[key || header.trim()] = normalize(valueOrRewrite);
      }
    } else if (header instanceof AxiosHeaders || !(header as any)?.[Symbol.iterator]) {
      for (const key of Object.keys(header || {})) this.set(key, (header as any)[key], valueOrRewrite);
    } else {
      for (const [key, value] of header as Iterable<[string, any]>) {
        if (key.toLowerCase() === 'set-cookie') this[key] = (this[key] || []).concat(value);
        else this.set(key, value, valueOrRewrite);
      }
    }
    return this;
  }

  get(header: string, parser?: Parser): any {
    const key = find(this, header);
    if (!key) return;
    const value = this[key];
    return !parser ? value : parser instanceof RegExp ? parser.exec(value) : parser.call(this, value, key);
  }

  has(header: string): boolean {
    const key = find(this, header);
    return !!key && this[key] !== undefined;
  }

  delete(header: string | string[]): boolean {
    let deleted = false;
    for (const name of ([] as string[]).concat(header)) {
      const key = find(this, name);
      if (key) deleted = delete this[key];
    }
    return deleted;
  }

  clear(): boolean {
    return Object.keys(this).filter((key) => delete this[key]).length > 0;
  }

  /** Merges keys that differ only in case. With `format`, names become Title-Case. */
  normalize(format?: boolean): this {
    for (const key of Object.keys(this)) {
      const value = this[key];
      delete this[key];
      this.set(format ? key.trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : key, value, true);
    }
    return this;
  }

  concat(...targets: Source[]): AxiosHeaders {
    return AxiosHeaders.concat(this, ...targets);
  }

  toJSON(asStrings?: boolean): Record<string, any> {
    const out: Record<string, any> = {};
    for (const key of Object.keys(this)) {
      const value = this[key];
      if (value != null && value !== false) out[key] = asStrings && Array.isArray(value) ? value.join(', ') : value;
    }
    return out;
  }

  getSetCookie(): string[] {
    return [].concat(this.get('set-cookie') || []);
  }

  toString(): string {
    return Object.entries(this.toJSON())
      .map((entry) => entry.join(': '))
      .join('\n');
  }

  [Symbol.iterator](): IterableIterator<[string, AxiosHeaderValue]> {
    return Object.entries(this.toJSON())[Symbol.iterator]();
  }

  static from(thing?: Source): AxiosHeaders {
    return thing instanceof AxiosHeaders ? thing : new AxiosHeaders(thing);
  }

  static concat(first?: Source, ...targets: Source[]): AxiosHeaders {
    const out = new AxiosHeaders(first);
    targets.forEach((target) => out.set(target));
    return out;
  }

  declare getContentType: (parser?: Parser) => any;
  declare setContentType: (value: AxiosHeaderValue | undefined, rewrite?: boolean) => AxiosHeaders;
  declare hasContentType: () => boolean;
  declare getContentLength: (parser?: Parser) => any;
  declare setContentLength: (value: AxiosHeaderValue | undefined, rewrite?: boolean) => AxiosHeaders;
  declare hasContentLength: () => boolean;
  declare getAccept: (parser?: Parser) => any;
  declare setAccept: (value: AxiosHeaderValue | undefined, rewrite?: boolean) => AxiosHeaders;
  declare hasAccept: () => boolean;
  declare getUserAgent: (parser?: Parser) => any;
  declare setUserAgent: (value: AxiosHeaderValue | undefined, rewrite?: boolean) => AxiosHeaders;
  declare hasUserAgent: () => boolean;
  declare getContentEncoding: (parser?: Parser) => any;
  declare setContentEncoding: (value: AxiosHeaderValue | undefined, rewrite?: boolean) => AxiosHeaders;
  declare hasContentEncoding: () => boolean;
  declare getAuthorization: (parser?: Parser) => any;
  declare setAuthorization: (value: AxiosHeaderValue | undefined, rewrite?: boolean) => AxiosHeaders;
  declare hasAuthorization: () => boolean;
}

for (const header of ['Content-Type', 'Content-Length', 'Accept', 'User-Agent', 'Content-Encoding', 'Authorization']) {
  for (const method of ['get', 'set', 'has'] as const) {
    Object.defineProperty(AxiosHeaders.prototype, method + header.replace('-', ''), {
      value(this: AxiosHeaders, a?: any, b?: any) {
        return (this[method] as Function)(header, a, b);
      },
    });
  }
}
