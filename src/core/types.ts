export type ResponseType = 'json' | 'text' | 'blob' | 'arrayBuffer' | 'formData' | 'stream';

export type HeaderValue = string | number | boolean | null | undefined;
export type HeadersObject = Record<string, HeaderValue>;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface RequestConfig<D = any> {
  url?: string;
  method?: string;
  baseURL?: string;
  /** When false, `url` is always joined to `baseURL`, even if absolute. Default true. */
  allowAbsoluteUrls?: boolean;
  headers?: HeadersObject | Headers;
  params?: Record<string, unknown> | URLSearchParams;
  paramsSerializer?: (params: Record<string, any>) => string;
  /** Plain objects and arrays become JSON. FormData, URLSearchParams, Blob, buffers, strings and streams pass through. */
  data?: D;
  /** Total time in ms for the request, including reading the body. 0 disables. */
  timeout?: number;
  signal?: AbortSignal;
  /** Default: parse JSON when Content-Type contains "json", else text. */
  responseType?: ResponseType;
  /** Return true to resolve. null resolves every status. Default: 2xx. */
  validateStatus?: ((status: number) => boolean) | null;
  credentials?: RequestCredentials;
  /** Extra fetch options (cache, mode, redirect, priority, ...). */
  fetchOptions?: RequestInit;
  /** Custom fetch implementation. */
  fetch?: FetchLike;
  /** Replaces the fetch adapter for this request. */
  adapter?: (config: RequestConfig) => Promise<HttpResponse>;
}

/** The fetch init used for the request, plus its final URL. */
export interface FetchRequest extends RequestInit {
  url: string;
  headers: Headers;
}

export interface HttpResponse<T = any, D = any> {
  data: T;
  status: number;
  statusText: string;
  headers: Headers;
  config: RequestConfig<D>;
  request: FetchRequest;
}

export interface InterceptorOptions<V> {
  /** Skip this interceptor when it returns false. */
  runWhen?: (config: V) => boolean;
  /** Accepted for axios parity. Interceptors always run asynchronously. */
  synchronous?: boolean;
}

export interface Interceptor<V> extends InterceptorOptions<V> {
  fulfilled?: ((value: V) => V | Promise<V>) | null;
  rejected?: ((error: any) => any) | null;
}

export interface InterceptorManager<V> {
  handlers: (Interceptor<V> | null)[];
  use(
    onFulfilled?: ((value: V) => V | Promise<V>) | null,
    onRejected?: ((error: any) => any) | null,
    options?: InterceptorOptions<V>,
  ): number;
  eject(id: number): void;
  clear(): void;
  forEach(fn: (handler: Interceptor<V>) => void): void;
}

export interface Client {
  <T = any, D = any>(config: RequestConfig<D>): Promise<HttpResponse<T, D>>;
  <T = any, D = any>(url: string, config?: RequestConfig<D>): Promise<HttpResponse<T, D>>;
  request<T = any, D = any>(config: RequestConfig<D>): Promise<HttpResponse<T, D>>;
  get<T = any, D = any>(url: string, config?: RequestConfig<D>): Promise<HttpResponse<T, D>>;
  delete<T = any, D = any>(url: string, config?: RequestConfig<D>): Promise<HttpResponse<T, D>>;
  head<T = any, D = any>(url: string, config?: RequestConfig<D>): Promise<HttpResponse<T, D>>;
  options<T = any, D = any>(url: string, config?: RequestConfig<D>): Promise<HttpResponse<T, D>>;
  post<T = any, D = any>(url: string, data?: D, config?: RequestConfig<D>): Promise<HttpResponse<T, D>>;
  put<T = any, D = any>(url: string, data?: D, config?: RequestConfig<D>): Promise<HttpResponse<T, D>>;
  patch<T = any, D = any>(url: string, data?: D, config?: RequestConfig<D>): Promise<HttpResponse<T, D>>;
  defaults: RequestConfig;
  interceptors: {
    request: InterceptorManager<RequestConfig>;
    response: InterceptorManager<HttpResponse>;
  };
  create(config?: RequestConfig): Client;
}
