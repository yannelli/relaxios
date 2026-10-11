export interface ProgressEvent {
  /** Bytes seen so far. Clamped to `total` when the length is known. */
  loaded: number;
  /** Expected bytes, when known and not content-encoded. */
  total?: number;
  /** loaded / total, from 0 to 1. */
  ratio?: number;
  /** Bytes per second over the last 2 seconds. */
  rate?: number;
  /** Seconds remaining at the current rate. */
  estimated?: number;
  lengthComputable: boolean;
  /** Bytes since the last event. */
  bytes: number;
}

export type ProgressListener = (event: ProgressEvent) => void;

export interface ProgressOptions {
  total?: number;
  /** Timer interval in ms when requestAnimationFrame is not used. 0 emits every chunk. Default 100. */
  throttle?: number;
}

/** Length of the decoded body, or undefined when unknown or when Content-Encoding is not identity. */
export function contentLength(headers: Headers): number | undefined {
  const encoding = headers.get('content-encoding');
  const length = headers.get('content-length');
  if ((encoding && encoding.trim().toLowerCase() !== 'identity') || !length) return;
  const n = +length;
  return n >= 0 && n <= Number.MAX_SAFE_INTEGER ? n : undefined;
}

/** Turns byte counts into progress events with rate and time remaining. */
export function reducer(total?: number): (loaded: number) => ProgressEvent {
  const computable = total != null && total >= 0;
  const samples: [time: number, loaded: number][] = [];
  let last = 0;
  return (raw) => {
    const loaded = computable ? Math.min(raw, total) : raw;
    const now = Date.now();
    samples.push([now, loaded]);
    while (now - samples[0][0] > 2000) samples.shift();
    const [t0, l0] = samples[0];
    const rate = now - t0 >= 250 ? ((loaded - l0) * 1000) / (now - t0) : undefined;
    const bytes = loaded - last;
    last = loaded;
    return {
      loaded,
      total: computable ? total : undefined,
      ratio: computable ? (total ? loaded / total : 1) : undefined,
      rate,
      estimated: computable && rate ? (total - loaded) / rate : undefined,
      lengthComputable: computable,
      bytes,
    };
  };
}

const useFrame = () =>
  typeof requestAnimationFrame == 'function' && !(globalThis as { document?: Document }).document?.hidden;

/** Calls fn with the latest arguments once per animation frame in visible pages, else once per `ms`. */
export function throttle<A extends unknown[]>(fn: (...args: A) => void, ms = 100): [(...args: A) => void, () => void] {
  let pending: A | undefined;
  let frame: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    clearTimeout(timer);
    frame = timer = undefined;
    const args = pending;
    pending = undefined;
    if (args) fn(...args);
  };
  const throttled = (...args: A) => {
    pending = args;
    if (!ms) run();
    else if (frame === undefined && timer === undefined) {
      if (useFrame()) frame = requestAnimationFrame(run);
      else timer = setTimeout(run, ms);
    }
  };
  return [throttled, run];
}

const toOptions = (init?: number | Headers | Response | ProgressOptions): ProgressOptions =>
  typeof init == 'number'
    ? { total: init }
    : init instanceof Response || init instanceof Headers
      ? { total: contentLength(init instanceof Response ? init.headers : init) }
      : init || {};

/** Pass-through byte stream that reports progress: `res.body.pipeThrough(progress(fn, res))`. */
export function progress(
  listener: ProgressListener,
  init?: number | Headers | Response | ProgressOptions,
): TransformStream<Uint8Array, Uint8Array> {
  const options = toOptions(init);
  const reduce = reducer(options.total);
  const [emit, flush] = throttle((loaded: number) => listener(reduce(loaded)), options.throttle);
  let loaded = 0;
  return new TransformStream({
    transform(chunk, controller) {
      loaded += chunk.byteLength;
      controller.enqueue(chunk);
      emit(loaded);
    },
    flush() {
      emit(loaded);
      flush();
    },
  });
}

/** Returns a copy of the response whose body reports download progress. */
export function trackResponse(response: Response, listener: ProgressListener, options?: ProgressOptions): Response {
  if (!response.body) return response;
  const body = response.body.pipeThrough(progress(listener, { ...options, total: contentLength(response.headers) }));
  return new Response(body, response);
}

export type XhrListener = (event: ProgressEvent, raw: globalThis.ProgressEvent) => void;

export interface XhrFetchOptions {
  /** Bytes sent, from xhr.upload. These count bytes given to the network stack, not bytes the server stored. */
  onUpload?: XhrListener;
  onDownload?: XhrListener;
  throttle?: number;
}

const listen = (target: XMLHttpRequestEventTarget, listener?: XhrListener, ms?: number) => {
  if (!listener) return;
  let reduce: ReturnType<typeof reducer> | undefined;
  const [emit, flush] = throttle((e: globalThis.ProgressEvent) => {
    reduce ||= reducer(e.lengthComputable ? e.total : undefined);
    listener(reduce(e.loaded), e);
  }, ms);
  target.addEventListener('progress', emit);
  target.addEventListener('loadend', flush);
};

/** A fetch-compatible function backed by XMLHttpRequest, for real upload byte counts in browsers. */
export const xhrFetch =
  ({ onUpload, onDownload, throttle: ms }: XhrFetchOptions = {}) =>
  (url: string | URL, init: RequestInit = {}): Promise<Response> =>
    new Promise((resolve, reject) => {
      const signal = init.signal;
      if (signal?.aborted) return reject(signal.reason);
      const xhr = new XMLHttpRequest();
      xhr.open(init.method || 'GET', url);
      new Headers(init.headers).forEach((value, name) => xhr.setRequestHeader(name, value));
      xhr.withCredentials = init.credentials === 'include';
      xhr.responseType = 'blob';
      listen(xhr.upload, onUpload, ms);
      listen(xhr, onDownload, ms);
      xhr.onload = () => {
        const status = xhr.status;
        const headers = new Headers();
        for (const line of xhr.getAllResponseHeaders().split(/\r?\n/)) {
          const i = line.indexOf(':');
          if (i > 0) headers.append(line.slice(0, i).trim(), line.slice(i + 1).trim());
        }
        if (!status) return reject(new TypeError('Network Error'));
        resolve(new Response([101, 204, 205, 304].includes(status) ? null : xhr.response, { status, statusText: xhr.statusText, headers }));
      };
      xhr.onerror = xhr.ontimeout = () => reject(new TypeError('Network Error'));
      xhr.onabort = () => reject(signal?.reason || new DOMException('Aborted', 'AbortError'));
      signal?.addEventListener('abort', () => xhr.abort());
      xhr.send((init.body as XMLHttpRequestBodyInit) ?? null);
    });
