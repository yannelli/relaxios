'use strict';

import type { EventEmitter } from 'node:events';
import type AxiosError from '../../core/AxiosError';

// Mutable state shared by the steps of one http adapter dispatch. It stands in
// for the closure variables of axios's single dispatchHttpRequest function.
export interface HttpContext {
  config: any;
  own: (key: string) => any;
  transitional: any;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  data: any;
  lookup: any;
  family: any;
  http2Options: any;
  httpAgent: any;
  httpsAgent: any;
  configProxy: any;
  responseType: any;
  responseEncoding: any;
  socketPath: any;
  method: string;
  maxRedirects: any;
  maxBodyLength: any;
  maxContentLength: any;
  decompress: any;
  isHttp2: boolean;
  isDone: boolean;
  rejected: boolean;
  req: any;
  connectPhaseTimer: any;
  abortEmitter: EventEmitter;
  abort: (reason?: any) => void;
  clearConnectPhaseTimer: () => void;
  createTimeoutError: () => AxiosError;
  fullPath: string;
  parsed: URL;
  protocol: string;
  headers: any;
  onUploadProgress: any;
  onDownloadProgress: any;
  maxRate: any;
  maxUploadRate: any;
  maxDownloadRate: any;
  auth: any;
  path: string;
  options: any;
  proxyApplied: boolean;
  transport: any;
  isNativeTransport: boolean;
  transportEnforcesMaxBodyLength: boolean;
  isHttpsRequest: boolean;
}
