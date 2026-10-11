import type { AxiosHeaderValue, AxiosHeaders } from './headers';
import type {
  AxiosAdapter,
  AxiosAdapterConfig,
  AxiosDefaults,
  AxiosRequestConfig,
  AxiosResponse,
  CreateAxiosDefaults,
  FormSerializerOptions,
  GenericFormData,
  GenericHTMLFormElement,
  HeadersDefaults,
  InternalAxiosRequestConfig,
} from './config';
import type { AxiosError, CanceledError, CancelTokenStatic } from './cancel';
import type { HttpStatusCode } from './status';

export interface AxiosInterceptorOptions {
  synchronous?: boolean;
  runWhen?: ((config: InternalAxiosRequestConfig) => boolean) | null;
}

export type AxiosInterceptorFulfilled<T> = (value: T) => T | Promise<T>;
export type AxiosInterceptorRejected = (error: any) => any;

export type AxiosRequestInterceptorUse<T> = (
  onFulfilled?: AxiosInterceptorFulfilled<T> | null,
  onRejected?: AxiosInterceptorRejected | null,
  options?: AxiosInterceptorOptions
) => number;

export type AxiosResponseInterceptorUse<T> = (
  onFulfilled?: AxiosInterceptorFulfilled<T> | null,
  onRejected?: AxiosInterceptorRejected | null
) => number;

export interface AxiosInterceptorHandler<T> {
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

export declare const axiosResponseDefault: unique symbol;

export type AxiosResponseDefault = typeof axiosResponseDefault;

export type AxiosResponseResult<T, R, D, P> = R extends AxiosResponseDefault ? AxiosResponse<T, D, {}, P> : R;

export declare class Axios {
  constructor(config?: AxiosRequestConfig);
  defaults: AxiosDefaults;
  interceptors: {
    request: AxiosInterceptorManager<InternalAxiosRequestConfig>;
    response: AxiosInterceptorManager<AxiosResponse>;
  };
  getUri(config?: AxiosRequestConfig): string;
  request<T = any, R = AxiosResponseDefault, D = any, P = any>(
    config: AxiosRequestConfig<D, P>
  ): Promise<AxiosResponseResult<T, R, D, P>>;
  get<T = any, R = AxiosResponseDefault, D = any, P = any>(
    url: string,
    config?: AxiosRequestConfig<D, P>
  ): Promise<AxiosResponseResult<T, R, D, P>>;
  delete<T = any, R = AxiosResponseDefault, D = any, P = any>(
    url: string,
    config?: AxiosRequestConfig<D, P>
  ): Promise<AxiosResponseResult<T, R, D, P>>;
  head<T = any, R = AxiosResponseDefault, D = any, P = any>(
    url: string,
    config?: AxiosRequestConfig<D, P>
  ): Promise<AxiosResponseResult<T, R, D, P>>;
  options<T = any, R = AxiosResponseDefault, D = any, P = any>(
    url: string,
    config?: AxiosRequestConfig<D, P>
  ): Promise<AxiosResponseResult<T, R, D, P>>;
  post<T = any, R = AxiosResponseDefault, D = any, P = any>(
    url: string,
    data?: D,
    config?: AxiosRequestConfig<D, P>
  ): Promise<AxiosResponseResult<T, R, D, P>>;
  put<T = any, R = AxiosResponseDefault, D = any, P = any>(
    url: string,
    data?: D,
    config?: AxiosRequestConfig<D, P>
  ): Promise<AxiosResponseResult<T, R, D, P>>;
  patch<T = any, R = AxiosResponseDefault, D = any, P = any>(
    url: string,
    data?: D,
    config?: AxiosRequestConfig<D, P>
  ): Promise<AxiosResponseResult<T, R, D, P>>;
  postForm<T = any, R = AxiosResponseDefault, D = any, P = any>(
    url: string,
    data?: D,
    config?: AxiosRequestConfig<D, P>
  ): Promise<AxiosResponseResult<T, R, D, P>>;
  putForm<T = any, R = AxiosResponseDefault, D = any, P = any>(
    url: string,
    data?: D,
    config?: AxiosRequestConfig<D, P>
  ): Promise<AxiosResponseResult<T, R, D, P>>;
  patchForm<T = any, R = AxiosResponseDefault, D = any, P = any>(
    url: string,
    data?: D,
    config?: AxiosRequestConfig<D, P>
  ): Promise<AxiosResponseResult<T, R, D, P>>;
  query<T = any, R = AxiosResponseDefault, D = any, P = any>(
    url: string,
    data?: D,
    config?: AxiosRequestConfig<D, P>
  ): Promise<AxiosResponseResult<T, R, D, P>>;
}

export interface AxiosInstance extends Axios {
  <T = any, R = AxiosResponseDefault, D = any, P = any>(
    config: AxiosRequestConfig<D, P>
  ): Promise<AxiosResponseResult<T, R, D, P>>;
  <T = any, R = AxiosResponseDefault, D = any, P = any>(
    url: string,
    config?: AxiosRequestConfig<D, P>
  ): Promise<AxiosResponseResult<T, R, D, P>>;

  create(config?: CreateAxiosDefaults): AxiosInstance;
  defaults: Omit<AxiosDefaults, 'headers'> & {
    headers: HeadersDefaults & {
      [key: string]: AxiosHeaderValue;
    };
  };
}

// Function signatures of the named exports (index.d.ts declares them as functions).
export type GetAdapterFn = (adapters: AxiosAdapterConfig | AxiosAdapterConfig[] | undefined) => AxiosAdapter;

export type ToFormDataFn = (
  sourceObj: object,
  targetFormData?: GenericFormData,
  options?: FormSerializerOptions
) => GenericFormData;

export type FormToJSONFn = (form: GenericFormData | GenericHTMLFormElement) => object;

export type IsAxiosErrorFn = <T = any, D = any, P = any>(payload: any) => payload is AxiosError<T, D, P>;

export type SpreadFn = <T, R>(callback: (...args: T[]) => R) => (array: T[]) => R;

export type IsCancelFn = <T = any, D = any, P = any>(value: any) => value is CanceledError<T, D, P>;

export type AllFn = <T>(values: Array<T | Promise<T>>) => Promise<T[]>;

export type MergeConfigFn = <D = any, P = any>(
  config1: AxiosRequestConfig<D, P>,
  config2: AxiosRequestConfig<D, P>
) => AxiosRequestConfig<D, P>;

export type CreateFn = (config?: CreateAxiosDefaults) => AxiosInstance;

export interface AxiosStatic extends AxiosInstance {
  Cancel: typeof CanceledError;
  CancelToken: CancelTokenStatic;
  Axios: typeof Axios;
  AxiosError: typeof AxiosError;
  HttpStatusCode: typeof HttpStatusCode;
  readonly VERSION: string;
  isCancel: IsCancelFn;
  all: AllFn;
  spread: SpreadFn;
  isAxiosError: IsAxiosErrorFn;
  toFormData: ToFormDataFn;
  formToJSON: FormToJSONFn;
  getAdapter: GetAdapterFn;
  CanceledError: typeof CanceledError;
  AxiosHeaders: typeof AxiosHeaders;
  mergeConfig: MergeConfigFn;
}
