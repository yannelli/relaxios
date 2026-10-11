import { fetchAdapter } from './fetch';
import type { Client, Interceptor, InterceptorManager, InterceptorOptions, RequestConfig } from './types';
import { mergeConfig } from './util';

export class Interceptors<V> implements InterceptorManager<V> {
  handlers: (Interceptor<V> | null)[] = [];

  use(
    fulfilled?: Interceptor<V>['fulfilled'],
    rejected?: Interceptor<V>['rejected'],
    options?: InterceptorOptions<V>,
  ): number {
    return this.handlers.push({ fulfilled, rejected, ...options }) - 1;
  }

  eject(id: number): void {
    if (this.handlers[id]) this.handlers[id] = null;
  }

  clear(): void {
    this.handlers = [];
  }

  forEach(fn: (handler: Interceptor<V>) => void): void {
    this.handlers.forEach((h) => h && fn(h));
  }
}

export interface ClientHooks {
  /** Runs after the config merge and before request interceptors. */
  prepare?: (config: any) => any;
  /** Sends the request. Default: `config.adapter || fetchAdapter`. */
  dispatch?: (config: any) => Promise<any>;
  /** Merges defaults and request config. Default: `mergeConfig`. */
  merge?: (defaults: any, config: any) => any;
}

const defaultDispatch = (config: RequestConfig) => (config.adapter || fetchAdapter)(config);

/** Builds a callable client. Request interceptors run newest first, response interceptors oldest first. */
export function createClient(defaults: RequestConfig = {}, hooks: ClientHooks = {}): Client {
  const { prepare, dispatch = defaultDispatch, merge = mergeConfig } = hooks;
  const request = (input: string | RequestConfig, extra?: RequestConfig) => {
    let config = merge(client.defaults, typeof input === 'string' ? { ...extra, url: input } : input);
    config.method = (config.method || 'get').toLowerCase();
    if (prepare) config = prepare(config);
    const chain: unknown[] = [dispatch, undefined];
    client.interceptors.request.forEach(
      (h: Interceptor<any>) => (!h.runWhen || h.runWhen(config)) && chain.unshift(h.fulfilled, h.rejected),
    );
    client.interceptors.response.forEach((h: Interceptor<any>) => chain.push(h.fulfilled, h.rejected));
    let promise = Promise.resolve(config);
    for (let i = 0; i < chain.length; ) promise = promise.then(chain[i++] as any, chain[i++] as any);
    return promise;
  };
  const client: any = Object.assign(request, {
    request,
    defaults,
    interceptors: { request: new Interceptors(), response: new Interceptors() },
    create: (config?: RequestConfig) => createClient(merge(client.defaults, config), hooks),
  });
  for (const method of ['get', 'delete', 'head', 'options']) {
    client[method] = (url: string, config?: RequestConfig) => request({ ...config, method, url });
  }
  for (const method of ['post', 'put', 'patch']) {
    client[method] = (url: string, data?: unknown, config?: RequestConfig) =>
      request({ ...config, method, url, data });
  }
  return client;
}
