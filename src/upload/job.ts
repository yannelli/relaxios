import type { ResumeStore, Task, UploadContext, UploadJob, UploadOptions, UploadProgress, UploadState } from './types';

/** An upload request failure. `retry` overrides the default classification. */
export class UploadError extends Error {
  declare status?: number;
  declare response?: Response;
  declare retry?: boolean;
  /** Delay in ms requested by the server (Retry-After) or the adapter. */
  declare retryAfter?: number;

  constructor(message: string, props?: Partial<Pick<UploadError, 'status' | 'response' | 'retry' | 'retryAfter'>>) {
    super(message);
    this.name = 'UploadError';
    Object.assign(this, props);
  }
}

const shared = new Map<string, string>();

/** In-memory resume store. The default store is one shared instance per page or process. */
export const memoryStore = (map: Map<string, string> = shared): ResumeStore => ({
  get: (key) => map.get(key),
  set: (key, value) => map.set(key, value),
  delete: (key) => map.delete(key),
});

/** Network errors, 408, 409, 429 and 5xx are retried unless the error sets `retry`. */
const retryable = (e: any) =>
  e?.retry ?? (e instanceof TypeError || e?.name === 'TimeoutError' || e?.status >= 500 || [408, 409, 429].includes(e?.status));

const backoff = (n: number) => Math.min(30_000, 500 * 2 ** (n - 1)) * (0.5 + Math.random() / 2);

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(timer), reject(signal.reason)), { once: true });
  });

interface Flight {
  bytes: number;
  start: number;
  sent?: number;
}

export function upload<R>(file: Blob, options: UploadOptions<R>): UploadJob<R> {
  const { protocol, chunkSize = 4 << 20, retries = 5, retryDelay = backoff, onProgress, timeout } = options;
  const store = options.store === false ? undefined : options.store || memoryStore();
  const name = (file as File).name;
  const key = options.key ?? [protocol.key, name, file.size, (file as File).lastModified].join(':');
  const controller = new AbortController();
  const signal = controller.signal;
  const flights = new Set<Flight>();
  const wakers = new Set<() => void>();
  let state: UploadState = 'uploading';
  let confirmed = 0;
  let rate = 0;
  let mark = Date.now();
  let pauser = new AbortController();
  let gate: Promise<void> | undefined;
  let open: (() => void) | undefined;
  let cancel: (() => Promise<unknown>) | undefined;
  let snapshot: UploadProgress;
  let version = 0;
  let settled = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  const emit = () => {
    const now = Date.now();
    const active = [...flights].filter((f) => f.bytes);
    let inflight = 0;
    let estimated = confirmed;
    for (const f of active) {
      inflight += f.bytes;
      estimated += Math.min(f.bytes, f.sent ?? (rate * (now - f.start)) / 1000 / active.length);
    }
    snapshot = { confirmed, estimated: Math.floor(estimated), inflight, total: file.size, rate: rate || undefined, state };
    version++;
    wakers.forEach((wake) => wake());
    wakers.clear();
    onProgress?.(snapshot);
  };

  const user = options.signal;
  if (user) {
    if (user.aborted) controller.abort(user.reason);
    else user.addEventListener('abort', () => controller.abort(user.reason), { once: true });
  }
  signal.addEventListener('abort', () => {
    gate = undefined;
    open?.();
  });

  const context: UploadContext & { stored?: string } = {
    file,
    size: file.size,
    name,
    chunkSize,
    signal,
    fetch: options.fetch || ((input, init) => fetch(input, init)),
    save: (token) => (token === undefined ? store?.delete(key) : store?.set(key, token)),
    onAbort: (fn) => void (cancel = fn),
    confirm(bytes) {
      const now = Date.now();
      if (bytes > confirmed && now > mark) {
        const sample = ((bytes - confirmed) * 1000) / (now - mark);
        rate = rate ? rate * 0.7 + sample * 0.3 : sample;
      }
      mark = now;
      confirmed = bytes;
      emit();
    },
    async task<T>(fn: (task: Task) => Promise<T>): Promise<T> {
      for (let attempt = 0, failures = 0; ; attempt++) {
        while (gate) await gate;
        signal.throwIfAborted();
        const paused = pauser.signal;
        const flight: Flight = { bytes: 0, start: Date.now() };
        const before = confirmed;
        flights.add(flight);
        try {
          return await fn({
            signal: AbortSignal.any(timeout ? [signal, paused, AbortSignal.timeout(timeout)] : [signal, paused]),
            attempt,
            send(bytes) {
              if (![...flights].some((f) => f !== flight && f.bytes)) mark = Date.now();
              flight.bytes = bytes;
              flight.start = Date.now();
              flight.sent = undefined;
              timer ||= setInterval(() => rate && !gate && flights.size && emit(), 100);
              emit();
            },
            sent(bytes) {
              flight.sent = bytes;
              emit();
            },
          });
        } catch (e) {
          if (signal.aborted) throw signal.reason;
          if (paused.aborted) continue;
          if (confirmed > before) failures = 0;
          if (++failures > retries || !retryable(e)) throw e;
          state = 'retrying';
          emit();
          await sleep((e as { retryAfter?: number }).retryAfter ?? retryDelay(failures, e), signal);
          if (state === 'retrying') state = 'uploading';
        } finally {
          flights.delete(flight);
          emit();
        }
      }
    },
  };

  emit();
  const promise = (async () => {
    try {
      await null;
      context.stored = (await store?.get(key)) ?? undefined;
      const result = await protocol(context);
      confirmed = file.size;
      state = 'done';
      await store?.delete(key);
      return result;
    } catch (e) {
      if (!signal.aborted) {
        state = 'failed';
        throw e;
      }
      state = 'aborted';
      await cancel?.().catch(() => {});
      await store?.delete(key);
      throw signal.reason;
    } finally {
      settled = true;
      clearInterval(timer);
      emit();
    }
  })();

  const progress: AsyncIterable<UploadProgress> = {
    [Symbol.asyncIterator]() {
      let seen = 0;
      return {
        async next() {
          while (seen === version && !settled) await new Promise<void>((wake) => wakers.add(wake));
          if (seen === version) return { done: true, value: undefined };
          seen = version;
          return { done: false, value: snapshot };
        },
        async return() {
          return { done: true, value: undefined };
        },
      };
    },
  };

  return {
    then: (onfulfilled, onrejected) => promise.then(onfulfilled, onrejected),
    catch: (onrejected) => promise.catch(onrejected),
    finally: (onfinally) => promise.finally(onfinally),
    progress,
    signal,
    get state() {
      return state;
    },
    pause() {
      if (settled || gate) return;
      state = 'paused';
      gate = new Promise((resolve) => (open = resolve));
      pauser.abort(new DOMException('Upload paused', 'AbortError'));
      emit();
    },
    resume() {
      if (!gate) return;
      pauser = new AbortController();
      state = 'uploading';
      gate = undefined;
      open!();
      emit();
    },
    async abort(reason) {
      if (!settled) controller.abort(reason ?? new DOMException('Upload aborted', 'AbortError'));
      await promise.catch(() => {});
    },
  };
}
