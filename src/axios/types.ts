import type { AxiosError, CanceledError } from './error';
import type { AxiosHeaders } from './headers';

// Type names and shapes follow axios 1.20.0 (index.d.ts, MIT) so imports keep compiling.
type StringLiteralsOrString<Literals extends string> = Literals | (string & {});

export type AxiosHeaderValue = AxiosHeaders | string | string[] | number | boolean | null;
export type AxiosHeaderParameters = Record<string, string>;
export interface RawAxiosHeaders {
  [key: string]: AxiosHeaderValue;
}

type UppercaseMethod = 'GET' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'POST' | 'PUT' | 'PATCH' | 'PURGE' | 'LINK' | 'UNLINK' | 'QUERY';
export type Method = (UppercaseMethod | Lowercase<UppercaseMethod>) & {};
export type ResponseType = 'arraybuffer' | 'blob' | 'document' | 'json' | 'text' | 'stream' | 'formdata';

type MethodsHeaders = Partial<{ [Key in Method as Lowercase<Key>]: AxiosHeaders } & { common: AxiosHeaders }>;
type CommonRequestHeadersList = 'Accept' | 'Content-Length' | 'User-Agent' | 'Content-Encoding' | 'Authorization' | 'Location';
type ContentType =
  | AxiosHeaderValue
  | 'text/html'
  | 'text/plain'
  | 'multipart/form-data'
  | 'application/json'
  | 'application/x-www-form-urlencoded'
  | 'application/octet-stream';

export type RawAxiosRequestHeaders = Partial<
  RawAxiosHeaders & { [Key in CommonRequestHeadersList]: AxiosHeaderValue } & { 'Content-Type': ContentType }
>;
export type AxiosRequestHeaders = RawAxiosRequestHeaders & AxiosHeaders;

type CommonResponseHeadersList = 'Server' | 'Content-Type' | 'Content-Length' | 'Cache-Control' | 'Content-Encoding';
type CommonResponseHeaderKey = CommonResponseHeadersList | Lowercase<CommonResponseHeadersList>;
type RawCommonResponseHeaders = { [Key in CommonResponseHeaderKey]: AxiosHeaderValue } & { 'set-cookie': string[] };
export type RawAxiosResponseHeaders = Partial<RawAxiosHeaders & RawCommonResponseHeaders>;
export type AxiosResponseHeaders = RawAxiosResponseHeaders & AxiosHeaders;

export interface AxiosRequestTransformer {
  (this: InternalAxiosRequestConfig, data: any, headers: AxiosRequestHeaders): any;
}
export interface AxiosResponseTransformer {
  (this: InternalAxiosRequestConfig, data: any, headers: AxiosResponseHeaders, status?: number): any;
}
export interface AxiosAdapter {
  (config: InternalAxiosRequestConfig): AxiosPromise;
}
export interface AxiosBasicCredentials {
  username: string;
  password: string;
}
export interface TransitionalOptions {
  silentJSONParsing?: boolean;
  forcedJSONParsing?: boolean;
  clarifyTimeoutError?: boolean;
  legacyInterceptorReqResOrdering?: boolean;
  validateStatusUndefinedResolves?: boolean;
}
export interface GenericAbortSignal {
  readonly aborted: boolean;
  onabort?: ((...args: any) => any) | null;
  addEventListener?: (...args: any) => any;
  removeEventListener?: (...args: any) => any;
}
export interface SerializerOptions {
  dots?: boolean;
  metaTokens?: boolean;
  indexes?: boolean | null;
}
export interface FormSerializerOptions extends SerializerOptions {}
export interface ParamEncoder {
  (value: any, defaultEncoder: (value: any) => any): any;
}
export interface CustomParamsSerializer<P = Record<string, any>> {
  (params: P, options?: ParamsSerializerOptions<P>): string;
}
export interface ParamsSerializerOptions<P = Record<string, any>> extends SerializerOptions {
  encode?: ParamEncoder;
  serialize?: CustomParamsSerializer<P>;
}
export interface AxiosProgressEvent {
  loaded: number;
  total?: number;
  progress?: number;
  bytes: number;
  rate?: number;
  estimated?: number;
  upload?: boolean;
  download?: boolean;
  event?: any;
  lengthComputable: boolean;
}

type AxiosAdapterName = StringLiteralsOrString<'xhr' | 'http' | 'fetch'>;
type AxiosAdapterConfig = AxiosAdapter | AxiosAdapterName;

export interface AxiosRequestConfig<D = any, P = any> {
  url?: string;
  method?: StringLiteralsOrString<Method>;
  baseURL?: string;
  allowAbsoluteUrls?: boolean;
  transformRequest?: AxiosRequestTransformer | AxiosRequestTransformer[];
  transformResponse?: AxiosResponseTransformer | AxiosResponseTransformer[];
  headers?: (RawAxiosRequestHeaders & MethodsHeaders) | AxiosHeaders;
  params?: P;
  paramsSerializer?:
    | ParamsSerializerOptions<unknown extends P ? Record<string, any> : P>
    | CustomParamsSerializer<unknown extends P ? Record<string, any> : P>;
  data?: D;
  timeout?: number;
  timeoutErrorMessage?: string;
  withCredentials?: boolean;
  /** 'xhr' forces the XHR transport. Functions replace the transport. Other names use fetch. */
  adapter?: AxiosAdapterConfig | AxiosAdapterConfig[];
  auth?: AxiosBasicCredentials;
  responseType?: ResponseType;
  /** Ignored: responses are decoded as UTF-8. */
  responseEncoding?: string;
  xsrfCookieName?: string;
  xsrfHeaderName?: string;
  /** Uses the XHR transport when XMLHttpRequest exists, so counts come from xhr.upload. */
  onUploadProgress?: (progressEvent: AxiosProgressEvent) => void;
  onDownloadProgress?: (progressEvent: AxiosProgressEvent) => void;
  /** Ignored. */
  maxContentLength?: number;
  validateStatus?: ((status: number) => boolean) | null;
  /** Ignored. */
  maxBodyLength?: number;
  /** 0 maps to fetch `redirect: 'manual'`. Other values are ignored. */
  maxRedirects?: number;
  /** Ignored. */
  decompress?: boolean;
  transitional?: TransitionalOptions;
  signal?: GenericAbortSignal;
  formSerializer?: FormSerializerOptions;
  withXSRFToken?: boolean | ((config: InternalAxiosRequestConfig<D, P>) => boolean | undefined);
  parseReviver?: (this: any, key: string, value: any) => any;
  fetchOptions?: Omit<RequestInit, 'body' | 'headers' | 'method' | 'signal'> | Record<string, any>;
}

export type RawAxiosRequestConfig<D = any, P = any> = AxiosRequestConfig<D, P>;

export interface InternalAxiosRequestConfig<D = any, P = any> extends AxiosRequestConfig<D, P> {
  headers: AxiosRequestHeaders;
}

export interface HeadersDefaults {
  common: RawAxiosRequestHeaders;
  delete: RawAxiosRequestHeaders;
  get: RawAxiosRequestHeaders;
  head: RawAxiosRequestHeaders;
  post: RawAxiosRequestHeaders;
  put: RawAxiosRequestHeaders;
  patch: RawAxiosRequestHeaders;
  options?: RawAxiosRequestHeaders;
  purge?: RawAxiosRequestHeaders;
  link?: RawAxiosRequestHeaders;
  unlink?: RawAxiosRequestHeaders;
  query?: RawAxiosRequestHeaders;
}

export interface AxiosDefaults<D = any, P = any> extends Omit<AxiosRequestConfig<D, P>, 'headers'> {
  headers: HeadersDefaults;
}

export interface CreateAxiosDefaults<D = any, P = any> extends Omit<AxiosRequestConfig<D, P>, 'headers'> {
  headers?: RawAxiosRequestHeaders | AxiosHeaders | Partial<HeadersDefaults>;
}

export interface AxiosResponse<T = any, D = any, H = {}, P = any> {
  data: T;
  status: number;
  statusText: string;
  headers: (H & RawAxiosResponseHeaders) | AxiosResponseHeaders;
  config: InternalAxiosRequestConfig<D, P>;
  request?: any;
}

declare const axiosResponseDefault: unique symbol;
type AxiosResponseDefault = typeof axiosResponseDefault;
type AxiosResponseResult<T, R, D, P> = R extends AxiosResponseDefault ? AxiosResponse<T, D, {}, P> : R;

export type AxiosPromise<T = any, D = any, P = any> = Promise<AxiosResponse<T, D, {}, P>>;

export interface AxiosInterceptorOptions {
  synchronous?: boolean;
  runWhen?: ((config: InternalAxiosRequestConfig) => boolean) | null;
}
type AxiosInterceptorFulfilled<T> = (value: T) => T | Promise<T>;
type AxiosInterceptorRejected = (error: any) => any;
type AxiosRequestInterceptorUse<T> = (
  onFulfilled?: AxiosInterceptorFulfilled<T> | null,
  onRejected?: AxiosInterceptorRejected | null,
  options?: AxiosInterceptorOptions,
) => number;
type AxiosResponseInterceptorUse<T> = (
  onFulfilled?: AxiosInterceptorFulfilled<T> | null,
  onRejected?: AxiosInterceptorRejected | null,
) => number;
interface AxiosInterceptorHandler<T> {
  fulfilled: AxiosInterceptorFulfilled<T>;
  rejected?: AxiosInterceptorRejected;
  synchronous: boolean;
  runWhen?: ((config: InternalAxiosRequestConfig) => boolean) | null;
}
export interface AxiosInterceptorManager<V> {
  use: V extends AxiosResponse ? AxiosResponseInterceptorUse<V> : AxiosRequestInterceptorUse<V>;
  eject(id: number): void;
  clear(): void;
  handlers?: Array<AxiosInterceptorHandler<V>>;
}

type Call<T, R, D, P> = Promise<AxiosResponseResult<T, R, D, P>>;
type NoData = <T = any, R = AxiosResponseDefault, D = any, P = any>(url: string, config?: AxiosRequestConfig<D, P>) => Call<T, R, D, P>;
type WithData = <T = any, R = AxiosResponseDefault, D = any, P = any>(
  url: string,
  data?: D,
  config?: AxiosRequestConfig<D, P>,
) => Call<T, R, D, P>;

export interface Axios {
  defaults: AxiosDefaults;
  interceptors: {
    request: AxiosInterceptorManager<InternalAxiosRequestConfig>;
    response: AxiosInterceptorManager<AxiosResponse>;
  };
  getUri(config?: AxiosRequestConfig): string;
  request<T = any, R = AxiosResponseDefault, D = any, P = any>(config: AxiosRequestConfig<D, P>): Call<T, R, D, P>;
  get: NoData;
  delete: NoData;
  head: NoData;
  options: NoData;
  post: WithData;
  put: WithData;
  patch: WithData;
  postForm: WithData;
  putForm: WithData;
  patchForm: WithData;
  query: WithData;
}

export interface AxiosInstance extends Axios {
  <T = any, R = AxiosResponseDefault, D = any, P = any>(config: AxiosRequestConfig<D, P>): Call<T, R, D, P>;
  <T = any, R = AxiosResponseDefault, D = any, P = any>(url: string, config?: AxiosRequestConfig<D, P>): Call<T, R, D, P>;
  create(config?: CreateAxiosDefaults): AxiosInstance;
  defaults: Omit<AxiosDefaults, 'headers'> & {
    headers: HeadersDefaults & { [key: string]: AxiosHeaderValue };
  };
}

export interface GenericFormData {
  append(name: string, value: any, options?: any): any;
}

export interface AxiosStatic extends AxiosInstance {
  Cancel: typeof CanceledError;
  AxiosError: typeof AxiosError;
  CanceledError: typeof CanceledError;
  AxiosHeaders: typeof AxiosHeaders;
  readonly VERSION: string;
  isCancel(value: any): value is CanceledError<any>;
  isAxiosError<T = any, D = any>(payload: any): payload is AxiosError<T, D>;
  all<T>(values: Array<T | Promise<T>>): Promise<T[]>;
  spread<T, R>(callback: (...args: T[]) => R): (array: T[]) => R;
  toFormData(sourceObj: object, targetFormData?: GenericFormData, options?: FormSerializerOptions): GenericFormData;
  mergeConfig<D = any>(config1: AxiosRequestConfig<D>, config2: AxiosRequestConfig<D>): AxiosRequestConfig<D>;
}
