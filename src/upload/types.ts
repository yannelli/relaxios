export type UploadState = 'uploading' | 'paused' | 'retrying' | 'done' | 'failed' | 'aborted';

export interface UploadProgress {
  /** Bytes the server has acknowledged. Never counts data that could still be lost. */
  confirmed: number;
  /** Smoothed guess of bytes received, from the measured rate. Always within [confirmed, confirmed + inflight]. */
  estimated: number;
  /** Bytes in requests that the server has not acknowledged yet. */
  inflight: number;
  total: number;
  /** Bytes per second, measured from acknowledgements. */
  rate?: number;
  state: UploadState;
}

/** Persists the resume token (an upload URL or adapter state) between page loads. */
export interface ResumeStore {
  get(key: string): string | null | undefined | Promise<string | null | undefined>;
  set(key: string, value: string): unknown;
  delete(key: string): unknown;
}

/** One retryable unit of network work. */
export interface Task {
  /** Aborted on pause and on abort. Pass it to every request. */
  signal: AbortSignal;
  /** 0 on the first try. Above 0 after a failure or a pause: re-read the server state first. */
  attempt: number;
  /** Declares the bytes this request carries. They count as in flight until the task ends. */
  send(bytes: number): void;
  /** Optional real byte count from the transport (XHR). Used for `estimated` only. */
  sent(bytes: number): void;
}

export interface UploadContext {
  readonly file: Blob;
  readonly size: number;
  readonly name?: string;
  readonly chunkSize: number;
  /** Aborted when the job is aborted. Not aborted by pause. */
  readonly signal: AbortSignal;
  readonly fetch: typeof fetch;
  /** Token from the resume store, if any. */
  readonly stored?: string;
  /** Saves the resume token. undefined removes it. */
  save(token: string | undefined): unknown;
  /** Registers the server-side cancellation that abort() runs. */
  onAbort(cancel: () => Promise<unknown>): void;
  /** Sets the number of bytes the server has acknowledged. */
  confirm(bytes: number): void;
  /** Runs fn with retry, backoff and pause handling. */
  task<T>(fn: (task: Task) => Promise<T>): Promise<T>;
}

export interface Protocol<R> {
  (context: UploadContext): Promise<R>;
  /** Prefix for resume store keys. */
  key?: string;
}

export interface UploadOptions<R> {
  protocol: Protocol<R>;
  /** Bytes per request. Default 4 MiB. Adapters may raise or lower it to fit server limits. */
  chunkSize?: number;
  /** Consecutive failures allowed per chunk. Default 5. */
  retries?: number;
  /** Delay in ms before the nth retry (n starts at 1). Default: exponential backoff with jitter, max 30 s. */
  retryDelay?: (n: number, error: unknown) => number;
  /** Default: a shared in-memory store. false disables resuming across jobs. */
  store?: ResumeStore | false;
  /** Resume key. Default: protocol key + name + size + lastModified. */
  key?: string;
  signal?: AbortSignal;
  /** Time limit in ms for each try of a task (one chunk). A timeout counts as a retryable failure. Default: none. */
  timeout?: number;
  onProgress?: (progress: UploadProgress) => void;
  fetch?: typeof fetch;
}

export interface UploadJob<R> extends PromiseLike<R> {
  /** Yields the latest progress until the job settles. Slow consumers skip intermediate values. */
  readonly progress: AsyncIterable<UploadProgress>;
  readonly state: UploadState;
  readonly signal: AbortSignal;
  /** Aborts in-flight requests and sends nothing until resume(). */
  pause(): void;
  resume(): void;
  /** Stops the upload and cancels it on the server. Resolves when cancellation is done. */
  abort(reason?: unknown): Promise<void>;
  catch<T = never>(onrejected?: ((reason: any) => T | PromiseLike<T>) | null): Promise<R | T>;
  finally(onfinally?: (() => void) | null): Promise<R>;
}

export interface UploadResult<T = unknown> {
  status: number;
  headers: Headers;
  data: T;
}
