import axios from './axios';
import type * as Types from './types';

// This module is intended to unwrap Axios default export as named.
// Keep top-level export same with static properties
// so that it can keep same with es module or cjs
const {
  Axios,
  AxiosError,
  CanceledError,
  isCancel,
  CancelToken,
  VERSION,
  all,
  Cancel,
  isAxiosError,
  spread,
  toFormData,
  AxiosHeaders,
  HttpStatusCode,
  formToJSON,
  getAdapter,
  mergeConfig,
  create,
} = axios;

// Same-name type aliases so each class-like export carries its type as well as its value.
type Axios = Types.Axios;
type AxiosError<T = unknown, D = any, P = any> = Types.AxiosError<T, D, P>;
type CanceledError<T, D = any, P = any> = Types.CanceledError<T, D, P>;
type Cancel = Types.Cancel;
type CancelToken = Types.CancelToken;
type AxiosHeaders = Types.AxiosHeaders;
type HttpStatusCode = Types.HttpStatusCode;

export {
  axios as default,
  create,
  Axios,
  AxiosError,
  CanceledError,
  isCancel,
  CancelToken,
  VERSION,
  all,
  Cancel,
  isAxiosError,
  spread,
  toFormData,
  AxiosHeaders,
  HttpStatusCode,
  formToJSON,
  getAdapter,
  mergeConfig,
};

export type * from './types';
