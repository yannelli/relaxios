import type { FetchRequest, HttpResponse, RequestConfig } from './types';

export type ErrorCode =
  | 'ERR_BAD_REQUEST'
  | 'ERR_BAD_RESPONSE'
  | 'ERR_NETWORK'
  | 'ERR_CANCELED'
  | 'ETIMEDOUT'
  | (string & {});

/** C, Q and R let wrappers (such as the axios layer) narrow the config, request and response types. */
export class HttpError<T = any, D = any, C = RequestConfig<D>, Q = FetchRequest, R = HttpResponse<T, D>> extends Error {
  declare code?: ErrorCode;
  declare config?: C;
  declare request?: Q;
  declare response?: R;
  declare status?: number;

  constructor(message?: string, code?: ErrorCode, config?: C, request?: Q, response?: R, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'HttpError';
    if (code) this.code = code;
    if (config) this.config = config;
    if (request) this.request = request;
    if (response) {
      this.response = response;
      this.status = (response as unknown as { status: number }).status;
    }
  }
}

export const isHttpError = <T = any, D = any>(error: unknown): error is HttpError<T, D> =>
  error instanceof HttpError;

/** True for errors caused by an aborted signal (not by a timeout). */
export const isCancel = (error: unknown): boolean =>
  (error as HttpError | undefined)?.code === 'ERR_CANCELED';
