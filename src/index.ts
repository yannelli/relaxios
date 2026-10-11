import { createClient } from './core/client';
import type { Client, RequestConfig } from './core/types';

export { createClient, Interceptors, type ClientHooks } from './core/client';
export { HttpError, isHttpError, isCancel, type ErrorCode } from './core/error';
export { fetchAdapter, encodeBody, parseBody, toHeaders } from './core/fetch';
export { buildURL, deepMerge, isAbsoluteURL, isObject, mergeConfig, serializeParams } from './core/util';
export type * from './core/types';

const http: Client = /* @__PURE__ */ createClient();

/** Creates an independent client. Its defaults are merged over the default client's defaults. */
export const create = (config?: RequestConfig): Client => http.create(config);

export default http;
