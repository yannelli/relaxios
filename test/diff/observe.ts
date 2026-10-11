// Turns a case outcome (response, thrown error or custom value) into a JSON-able description
// that compares deeply across clients. Timing dependent values (rates, dates) are left out.
export type Outcome = { value: unknown } | { error: unknown };

export interface Origins {
  base: string;
  other: string;
  proxy: { host: string; port: number };
  h2?: string;
  socketPath?: string;
}

const DROP_HEADERS = new Set(['date', 'connection', 'keep-alive', 'transfer-encoding']);
const hasNode = () => typeof process === 'object' && !!(process as any)?.versions?.node;

let nodeStream: any = null;
let nodeHttp: any = null;
let loaded: Promise<void> | undefined;

function loadNode() {
  return (loaded ??= (async () => {
    if (!hasNode()) return;
    try {
      nodeStream = await import(/* @vite-ignore */ 'node:stream');
      nodeHttp = await import(/* @vite-ignore */ 'node:http');
    } catch {}
  })());
}

const safe = <T>(fn: () => T): T | { thrown: string } => {
  try {
    return fn();
  } catch (e: any) {
    return { thrown: e?.name ?? String(e) };
  }
};

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
  return btoa(binary);
}

const viewBytes = (v: ArrayBufferView) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
const isBlob = (v: any) => typeof Blob !== 'undefined' && v instanceof Blob;
const isWebStream = (v: any) => typeof ReadableStream !== 'undefined' && v instanceof ReadableStream;
const isNodeReadable = (v: any) => !!v && typeof v.pipe === 'function' && typeof v.on === 'function' && typeof v.read === 'function';
const isDocument = (v: any) => typeof Document !== 'undefined' && v instanceof Document;
const isFormData = (v: any) => typeof FormData !== 'undefined' && v instanceof FormData;
const isResponseLike = (v: any) => !!v && typeof v === 'object' && 'status' in v && 'headers' in v && 'config' in v && !(v instanceof Error);
const isHeadersLike = (v: any) => !!v && typeof v === 'object' && typeof v.get === 'function' && (typeof v.toJSON === 'function' || typeof v.entries === 'function');

function chunkBytes(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) return chunk;
  if (ArrayBuffer.isView(chunk)) return viewBytes(chunk);
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
  return new TextEncoder().encode(typeof chunk === 'string' ? chunk : JSON.stringify(chunk));
}

// Chunk counts are timing dependent, so only the concatenated bytes and a read error are kept.
async function readAll(iterate: () => AsyncIterable<unknown>): Promise<{ base64: string; readError?: unknown }> {
  const parts: Uint8Array[] = [];
  let readError: unknown;
  try {
    for await (const chunk of iterate()) parts.push(chunkBytes(chunk));
  } catch (e) {
    readError = shallowError(e);
  }
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) (all.set(p, offset), (offset += p.length));
  return { base64: toBase64(all), ...(readError !== undefined ? { readError } : {}) };
}

async function* webStreamChunks(stream: ReadableStream) {
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    yield value;
  }
}

const shallowError = (e: any) =>
  e && typeof e === 'object' ? { name: e.name, code: e.code, message: e.message, isAxiosError: e.isAxiosError } : { value: String(e) };

function instanceMap(v: any) {
  const map: Record<string, boolean> = {
    ArrayBuffer: v instanceof ArrayBuffer,
    Uint8Array: v instanceof Uint8Array,
    Blob: isBlob(v),
    ReadableStream: isWebStream(v),
    Document: isDocument(v),
  };
  if (typeof Buffer !== 'undefined') map.Buffer = v instanceof Buffer;
  if (nodeStream) map.Readable = v instanceof nodeStream.Readable;
  return map;
}

export async function describeData(data: any): Promise<unknown> {
  if (data === undefined) return { kind: 'undefined' };
  if (data === null) return { kind: 'null' };
  if (typeof data !== 'object' && typeof data !== 'function') return { kind: typeof data, value: typeof data === 'bigint' ? String(data) : data };
  const base = { className: data?.constructor?.name ?? null, instanceOf: instanceMap(data) };
  if (data instanceof ArrayBuffer) return { kind: 'ArrayBuffer', ...base, base64: toBase64(new Uint8Array(data)) };
  if (ArrayBuffer.isView(data)) return { kind: 'ArrayBufferView', ...base, base64: toBase64(viewBytes(data)) };
  if (isBlob(data)) {
    const bytes = await safeAsync(async () => new Uint8Array(await data.arrayBuffer()));
    return { kind: 'Blob', ...base, type: data.type, size: data.size, name: (data as any).name, base64: bytes instanceof Uint8Array ? toBase64(bytes) : bytes };
  }
  if (isWebStream(data)) {
    if (data.locked) return { kind: 'ReadableStream', ...base, locked: true };
    return { kind: 'ReadableStream', ...base, ...(await readAll(() => webStreamChunks(data))) };
  }
  if (isNodeReadable(data)) return { kind: 'Readable', ...base, objectMode: data.readableObjectMode, ...(await readAll(() => data)) };
  if (isDocument(data)) {
    const html = safe(() => (typeof XMLSerializer !== 'undefined' ? new XMLSerializer().serializeToString(data) : data.documentElement?.outerHTML));
    return { kind: 'Document', ...base, contentType: data.contentType, html };
  }
  if (isFormData(data)) {
    const entries: unknown[] = [];
    for (const [name, value] of data as any) entries.push([name, typeof value === 'string' ? value : await describeData(value)]);
    return { kind: 'FormData', ...base, entries };
  }
  if (typeof Response !== 'undefined' && data instanceof Response) {
    return { kind: 'Response', ...base, status: data.status, body: data.bodyUsed ? 'used' : await describeData(data.body) };
  }
  if (data instanceof Error) return { kind: 'Error', ...base, error: shallowError(data) };
  return { kind: 'json', value: await toPlain(data) };
}

const safeAsync = async <T>(fn: () => Promise<T>): Promise<T | { thrown: string }> => {
  try {
    return await fn();
  } catch (e: any) {
    return { thrown: e?.name ?? String(e) };
  }
};

export async function toPlain(value: any, seen = new WeakSet<object>()): Promise<unknown> {
  if (value === undefined) return '<undefined>';
  if (value === null) return null;
  const type = typeof value;
  if (type === 'function') return `<function ${value.name || 'anonymous'}>`;
  if (type === 'symbol') return String(value);
  if (type === 'bigint') return String(value) + 'n';
  if (type !== 'object') return value;
  if (seen.has(value)) return '<circular>';
  seen.add(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value) || isBlob(value) || isWebStream(value) || isNodeReadable(value) || isFormData(value) || isDocument(value)) {
    return describeData(value);
  }
  if (value instanceof Error) return { $error: shallowError(value) };
  if (isResponseLike(value)) return describeResponse(value);
  if (isHeadersLike(value)) return describeHeaders(value);
  if (Array.isArray(value)) return Promise.all(value.map((v) => toPlain(v, seen)));
  if (value instanceof Map) return { $map: await toPlain([...value], seen) };
  if (value instanceof Set) return { $set: await toPlain([...value], seen) };
  if (typeof value.toJSON === 'function') return toPlain(value.toJSON(), seen);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) out[key] = await toPlain(value[key], seen);
  return out;
}

export function describeHeaders(headers: any): unknown {
  if (headers == null) return null;
  let entries: [string, unknown][];
  if (typeof headers.toJSON === 'function') entries = Object.entries(headers.toJSON());
  else if (typeof headers[Symbol.iterator] === 'function') entries = [...headers];
  else entries = Object.entries(headers);
  const out: Record<string, unknown> = {};
  for (const [key, value] of entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const name = key.toLowerCase();
    if (!DROP_HEADERS.has(name)) out[name] = value;
  }
  return out;
}

function protoProps(target: any): Record<string, string> {
  const map: Record<string, string> = {};
  for (let proto = Object.getPrototypeOf(target); proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor' || name in map) continue;
      try {
        void target[name];
        map[name] = 'ok';
      } catch (e: any) {
        map[name] = e?.name ?? 'throw';
      }
    }
  }
  return Object.fromEntries(Object.entries(map).sort());
}

const xhrHeaders = (raw: unknown) =>
  typeof raw === 'string'
    ? raw
        .split(/\r?\n/)
        .filter((line) => line && !DROP_HEADERS.has(line.split(':')[0].trim().toLowerCase()))
        .map((line) => line.replace(/^([^:]+):/, (_, n) => n.toLowerCase() + ':'))
        .sort()
    : raw;

export async function describeRequest(req: any): Promise<unknown> {
  await loadNode();
  if (req == null) return { present: false };
  const className = req.constructor?.name ?? null;
  const instanceOf = {
    XMLHttpRequest: typeof XMLHttpRequest !== 'undefined' && req instanceof XMLHttpRequest,
    Request: typeof Request !== 'undefined' && req instanceof Request,
    ClientRequest: !!nodeHttp && req instanceof nodeHttp.ClientRequest,
  };
  let props: unknown;
  if (typeof req.getAllResponseHeaders === 'function' && 'readyState' in req) {
    props = {
      readyState: safe(() => req.readyState),
      status: safe(() => req.status),
      statusText: safe(() => req.statusText),
      responseURL: safe(() => req.responseURL),
      responseType: safe(() => req.responseType),
      timeout: safe(() => req.timeout),
      withCredentials: safe(() => req.withCredentials),
      upload: safe(() => !!req.upload),
      headers: safe(() => xhrHeaders(req.getAllResponseHeaders())),
      contentType: safe(() => req.getResponseHeader('content-type')),
      proto: protoProps(req),
    };
  } else if (instanceOf.Request || (typeof req.clone === 'function' && 'bodyUsed' in req)) {
    props = Object.fromEntries(
      ['url', 'method', 'credentials', 'redirect', 'mode', 'cache', 'keepalive', 'referrer', 'referrerPolicy', 'integrity', 'bodyUsed'].map((k) => [k, safe(() => req[k])]),
    );
    (props as any).signalAborted = safe(() => req.signal?.aborted);
    (props as any).headers = safe(() => describeHeaders(req.headers));
  } else if (instanceOf.ClientRequest || typeof req.getHeaderNames === 'function') {
    const res = safe(() => req.res);
    props = {
      method: safe(() => req.method),
      path: safe(() => req.path),
      host: safe(() => req.host),
      protocol: safe(() => req.protocol),
      headers: safe(() => describeHeaders(req.getHeaders())),
      headerNames: safe(() => [...req.getHeaderNames()].sort()),
      finished: safe(() => req.finished),
      writableEnded: safe(() => req.writableEnded),
      destroyed: safe(() => req.destroyed),
      reusedSocket: safe(() => req.reusedSocket),
      res:
        res && typeof res === 'object' && !('thrown' in res)
          ? { statusCode: (res as any).statusCode, statusMessage: (res as any).statusMessage, headers: describeHeaders((res as any).headers), httpVersion: (res as any).httpVersion }
          : null,
    };
  } else {
    props = Object.fromEntries(
      ['method', 'path', 'destroyed', 'writableEnded', 'closed', 'aborted', 'rstCode'].filter((k) => k in req && typeof req[k] !== 'function').map((k) => [k, safe(() => req[k])]),
    );
  }
  return { present: true, className, instanceOf, props };
}

export async function describeResponse(r: any): Promise<unknown> {
  return {
    kind: 'response',
    status: r.status,
    statusText: r.statusText,
    headers: describeHeaders(r.headers),
    data: await describeData(r.data),
    request: await describeRequest(r.request),
    config: { method: r.config?.method, url: r.config?.url },
  };
}

export async function describeError(ax: any, e: any): Promise<unknown> {
  if (e === null || typeof e !== 'object') return { kind: 'thrown', value: await toPlain(e) };
  return {
    kind: 'error',
    name: e.name,
    code: e.code,
    message: e.message,
    status: e.status,
    isAxiosError: e.isAxiosError,
    isCancel: safe(() => ax.isCancel(e)),
    instanceOfError: e instanceof Error,
    instanceOfAxiosError: safe(() => e instanceof ax.AxiosError),
    instanceOfCanceledError: safe(() => e instanceof ax.CanceledError),
    request: await describeRequest(e.request),
    response: e.response ? await describeResponse(e.response) : null,
    cause: e.cause == null ? undefined : typeof e.cause === 'object' ? { name: e.cause.name, code: e.cause.code } : { value: String(e.cause) },
    toJSONKeys: safe(() => Object.keys(typeof e.toJSON === 'function' ? e.toJSON() : {}).sort()),
    eventType: e.event != null ? (e.event.type ?? typeof e.event) : undefined,
  };
}

export async function describeValue(ax: any, value: any): Promise<unknown> {
  if (value && typeof value === 'object' && '__custom' in value) return { kind: 'custom', value: await toPlain(value.__custom) };
  if (Array.isArray(value)) return { kind: 'array', items: await Promise.all(value.map((v) => describeValue(ax, v))) };
  if (isResponseLike(value)) return describeResponse(value);
  return { kind: 'value', value: await toPlain(value) };
}

function replacements(env: Origins): Array<[string, string]> {
  const host = (url: string) => new URL(url).host;
  const list: Array<[string, string]> = [
    [env.base, '<base>'],
    [env.other, '<other>'],
    [host(env.base), '<base-host>'],
    [host(env.other), '<other-host>'],
    [`${env.proxy.host}:${env.proxy.port}`, '<proxy-host>'],
    [':' + new URL(env.base).port, ':<base-port>'],
    [':' + new URL(env.other).port, ':<other-port>'],
    [':' + env.proxy.port, ':<proxy-port>'],
  ];
  if (env.h2) list.push([env.h2, '<h2>'], [host(env.h2), '<h2-host>'], [':' + new URL(env.h2).port, ':<h2-port>']);
  if (env.socketPath) list.push([env.socketPath, '<socket>']);
  return list;
}

// Multipart boundaries are random per request: the header form and the raw forms of every
// implementation (undici, WebKit, Gecko, the form-data package, axios's own) become <b>.
const BOUNDARIES = [/boundary=[^;,\s"]+/gi, /-{2,}[A-Za-z0-9_.-]*boundary[A-Za-z0-9_.-]*/gi, /-{2,}formdata-[a-z]+-[0-9]+/g, /-{2,}[0-9]{16,}/g, /-{20,}[0-9A-Za-z]{10,}/g];

export function normalizeString(s: string, env?: Origins): string {
  let out = s;
  if (env) for (const [from, to] of replacements(env)) out = out.split(from).join(to);
  out = out.replace(BOUNDARIES[0], 'boundary=<b>');
  for (const re of BOUNDARIES.slice(1)) out = out.replace(re, '<b>');
  return out;
}

function normalizeDeep(value: unknown, env?: Origins): unknown {
  if (typeof value === 'string') return normalizeString(value, env);
  if (Array.isArray(value)) return value.map((v) => normalizeDeep(v, env));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[normalizeString(k, env)] = normalizeDeep(v, env);
    return out;
  }
  return value;
}

/** Describes a case outcome. `env` supplies the origins to normalize in strings. */
export async function observe(ax: any, outcome: Outcome, env?: Origins): Promise<unknown> {
  await loadNode();
  const described = 'error' in outcome ? await describeError(ax, outcome.error) : await describeValue(ax, outcome.value);
  return normalizeDeep(described, env);
}
