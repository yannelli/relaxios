import type { AxiosRequestConfig, AxiosResponse, BrowserProgressEvent, InternalAxiosRequestConfig } from './config';

export declare class AxiosError<T = unknown, D = any, P = any> extends Error {
  constructor(
    message?: string,
    code?: string,
    config?: InternalAxiosRequestConfig<D, P>,
    request?: any,
    response?: AxiosResponse<T, D, {}, P>
  );

  config?: InternalAxiosRequestConfig<D, P>;
  code?: string;
  request?: any;
  response?: AxiosResponse<T, D, {}, P>;
  isAxiosError: boolean;
  status?: number;
  toJSON: () => object;
  cause?: Error;
  event?: BrowserProgressEvent;
  static from<T = unknown, D = any, P = any>(
    error: Error | unknown,
    code?: string,
    config?: InternalAxiosRequestConfig<D, P>,
    request?: any,
    response?: AxiosResponse<T, D, {}, P>,
    customProps?: object
  ): AxiosError<T, D, P>;
  static readonly ERR_FR_TOO_MANY_REDIRECTS: 'ERR_FR_TOO_MANY_REDIRECTS';
  static readonly ERR_BAD_OPTION_VALUE: 'ERR_BAD_OPTION_VALUE';
  static readonly ERR_BAD_OPTION: 'ERR_BAD_OPTION';
  static readonly ERR_NETWORK: 'ERR_NETWORK';
  static readonly ERR_DEPRECATED: 'ERR_DEPRECATED';
  static readonly ERR_BAD_RESPONSE: 'ERR_BAD_RESPONSE';
  static readonly ERR_BAD_REQUEST: 'ERR_BAD_REQUEST';
  static readonly ERR_NOT_SUPPORT: 'ERR_NOT_SUPPORT';
  static readonly ERR_INVALID_URL: 'ERR_INVALID_URL';
  static readonly ERR_CANCELED: 'ERR_CANCELED';
  static readonly ERR_FORM_DATA_DEPTH_EXCEEDED: 'ERR_FORM_DATA_DEPTH_EXCEEDED';
  static readonly ECONNABORTED: 'ECONNABORTED';
  static readonly ECONNREFUSED: 'ECONNREFUSED';
  static readonly ETIMEDOUT: 'ETIMEDOUT';
}

export declare class CanceledError<T, D = any, P = any> extends AxiosError<T, D, P> {
  constructor(message?: string, config?: InternalAxiosRequestConfig<D, P>, request?: any);
  readonly name: 'CanceledError';
  __CANCEL__?: boolean;
}

export interface CancelStatic {
  new (message?: string): Cancel;
}

export interface Cancel {
  message: string | undefined;
}

export interface Canceler {
  (message?: string, config?: AxiosRequestConfig, request?: any): void;
}

export interface CancelTokenStatic {
  new (executor: (cancel: Canceler) => void): CancelToken;
  source(): CancelTokenSource;
}

export interface CancelToken {
  promise: Promise<Cancel>;
  reason?: Cancel;
  throwIfRequested(): void;
  subscribe(listener: (cancel: Cancel | any) => void): void;
  unsubscribe(listener: (cancel: Cancel | any) => void): void;
  toAbortSignal(): AbortSignal;
}

export interface CancelTokenSource {
  token: CancelToken;
  cancel: Canceler;
}
