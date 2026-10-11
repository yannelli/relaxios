import { upload, type UploadJob, type UploadOptions, type UploadProgress } from 'fetchwire/upload';
import { getCurrentScope, onScopeDispose, readonly, shallowRef, type Ref } from 'vue';

export interface UseUpload<R> {
  /** The latest `job.progress` value. */
  progress: Readonly<Ref<UploadProgress | undefined>>;
  job: Readonly<Ref<UploadJob<R> | undefined>>;
  result: Readonly<Ref<R | undefined>>;
  error: Readonly<Ref<unknown>>;
  /** Starts an upload. Options are merged over the composable's defaults. */
  start(file: Blob, options?: Partial<UploadOptions<R>>): UploadJob<R>;
  pause(): void;
  resume(): void;
  abort(reason?: unknown): Promise<void>;
}

/** Vue composable around upload(). The running job is aborted when the component scope is disposed. */
export function useUpload<R = unknown>(defaults: Partial<UploadOptions<R>> = {}): UseUpload<R> {
  const progress = shallowRef<UploadProgress>();
  const job = shallowRef<UploadJob<R>>();
  const result = shallowRef<R>();
  const error = shallowRef<unknown>();

  const start = (file: Blob, options?: Partial<UploadOptions<R>>) => {
    void job.value?.abort();
    const current = upload(file, { ...defaults, ...options } as UploadOptions<R>);
    job.value = current;
    result.value = error.value = progress.value = undefined;
    void (async () => {
      for await (const p of current.progress) if (job.value === current) progress.value = p;
    })();
    current.then(
      (value) => job.value === current && (result.value = value),
      (reason) => job.value === current && (error.value = reason),
    );
    return current;
  };

  if (getCurrentScope()) onScopeDispose(() => void job.value?.abort());

  return {
    progress: readonly(progress),
    job: readonly(job),
    result: readonly(result) as Readonly<Ref<R | undefined>>,
    error: readonly(error),
    start,
    pause: () => job.value?.pause(),
    resume: () => job.value?.resume(),
    abort: async (reason) => job.value?.abort(reason),
  };
}
