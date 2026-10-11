import { HttpError } from 'fetchwire';
import type { AxiosResponse, InternalAxiosRequestConfig } from './types';

const CODES =
  'ERR_FR_TOO_MANY_REDIRECTS ERR_BAD_OPTION_VALUE ERR_BAD_OPTION ERR_NETWORK ERR_DEPRECATED ERR_BAD_RESPONSE ERR_BAD_REQUEST ERR_NOT_SUPPORT ERR_INVALID_URL ERR_CANCELED ERR_FORM_DATA_DEPTH_EXCEEDED ECONNABORTED ECONNREFUSED ETIMEDOUT'.split(
    ' ',
  );

export class AxiosError<T = unknown, D = any> extends HttpError<T, D, InternalAxiosRequestConfig<D>, any, AxiosResponse<T, D>> {
  declare isAxiosError: boolean;
  declare cause?: Error;

  constructor(
    message?: string,
    code?: string,
    config?: InternalAxiosRequestConfig<D>,
    request?: any,
    response?: AxiosResponse<T, D>,
    cause?: unknown,
  ) {
    super(message, code, config, request, response, cause);
    // axios makes `message` enumerable; keep the same own-property shape.
    Object.defineProperty(this, 'message', { value: message, enumerable: true, writable: true, configurable: true });
    this.name = 'AxiosError';
    this.isAxiosError = true;
  }

  toJSON(): object {
    return { message: this.message, name: this.name, stack: this.stack, config: this.config, code: this.code, status: this.status };
  }

  static from<T = unknown, D = any>(
    error: any,
    code?: string,
    config?: InternalAxiosRequestConfig<D>,
    request?: any,
    response?: AxiosResponse<T, D>,
    customProps?: object,
  ): AxiosError<T, D> {
    const e = new AxiosError<T, D>(error.message, code || error.code, config, request, response, error);
    e.name = error.name;
    if (error.status != null && e.status == null) e.status = error.status;
    return Object.assign(e, customProps);
  }

  declare static readonly ERR_FR_TOO_MANY_REDIRECTS: 'ERR_FR_TOO_MANY_REDIRECTS';
  declare static readonly ERR_BAD_OPTION_VALUE: 'ERR_BAD_OPTION_VALUE';
  declare static readonly ERR_BAD_OPTION: 'ERR_BAD_OPTION';
  declare static readonly ERR_NETWORK: 'ERR_NETWORK';
  declare static readonly ERR_DEPRECATED: 'ERR_DEPRECATED';
  declare static readonly ERR_BAD_RESPONSE: 'ERR_BAD_RESPONSE';
  declare static readonly ERR_BAD_REQUEST: 'ERR_BAD_REQUEST';
  declare static readonly ERR_NOT_SUPPORT: 'ERR_NOT_SUPPORT';
  declare static readonly ERR_INVALID_URL: 'ERR_INVALID_URL';
  declare static readonly ERR_CANCELED: 'ERR_CANCELED';
  declare static readonly ERR_FORM_DATA_DEPTH_EXCEEDED: 'ERR_FORM_DATA_DEPTH_EXCEEDED';
  declare static readonly ECONNABORTED: 'ECONNABORTED';
  declare static readonly ECONNREFUSED: 'ECONNREFUSED';
  declare static readonly ETIMEDOUT: 'ETIMEDOUT';
}

for (const code of CODES) (AxiosError as any)[code] = code;

export class CanceledError<T = unknown, D = any> extends AxiosError<T, D> {
  declare readonly name: 'CanceledError';
  declare __CANCEL__?: boolean;

  constructor(message?: string | null, config?: InternalAxiosRequestConfig<D>, request?: any) {
    super(message == null ? 'canceled' : message, 'ERR_CANCELED', config, request);
    (this as { name: string }).name = 'CanceledError';
    this.__CANCEL__ = true;
  }
}

export const isCancel = (value: any): value is CanceledError<any> => !!value?.__CANCEL__;

export const isAxiosError = <T = any, D = any>(payload: any): payload is AxiosError<T, D> =>
  payload !== null && typeof payload == 'object' && payload.isAxiosError === true;
