// Shared types and helpers for the differential cases.
export type Runtime = 'node' | 'bun' | 'deno' | 'jsdom' | 'browser' | 'workerd';

export interface Env {
  base: string;
  other: string;
  proxy: { host: string; port: number };
  h2: string;
  socketPath?: string;
  runtime: Runtime;
}

// Each case runs unchanged against real axios and against relaxios/axios.
export type Case = (ax: any, env: Env) => Promise<unknown>;

/** Marks a case result as a plain value to compare instead of a response. */
export const custom = (value: unknown) => ({ __custom: value });

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** True where node: built-ins resolve (Node, Bun, Deno and vitest's jsdom environment). */
export const hasNode = () => typeof process === 'object' && !!(process as any)?.versions?.node;

/** Bytes 0..255 repeated, so binary bodies are deterministic and not valid UTF-8. */
export const pattern = (size: number) => {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = i & 255;
  return bytes;
};

export interface ProgressSummary {
  count: number;
  last: Record<string, unknown> | null;
}

/** Keeps the timing independent parts of a progress event series. `relative` hides byte counts. */
export function summarizeProgress(events: any[], relative = false): ProgressSummary {
  const last = events.at(-1);
  return {
    count: events.length > 0 ? 1 : 0,
    last: last
      ? {
          loaded: relative ? (last.loaded === last.total ? 'total' : typeof last.loaded) : last.loaded,
          total: relative ? typeof last.total : last.total,
          lengthComputable: last.lengthComputable,
          progress: last.progress,
          upload: last.upload,
          download: last.download,
          event: typeof last.event,
          eventType: last.event?.type,
          keys: Object.keys(last).sort(),
        }
      : null,
  };
}

/** A ReadableStream of `chunks` byte chunks of `size` bytes, optionally paced by `delay` ms. */
export function byteStream(chunks: number, size: number, delay = 0): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (delay) await sleep(delay);
      if (sent >= chunks) return controller.close();
      controller.enqueue(new Uint8Array(size).fill(97 + (sent % 26)));
      sent++;
    },
  });
}
