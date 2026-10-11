'use strict';

import zlib from 'node:zlib';
import utils from '../../utils';
import platform from '../../platform/index';

export const zlibOptions = {
  flush: zlib.constants.Z_SYNC_FLUSH,
  finishFlush: zlib.constants.Z_SYNC_FLUSH,
};

export const brotliOptions = {
  flush: zlib.constants.BROTLI_OPERATION_FLUSH,
  finishFlush: zlib.constants.BROTLI_OPERATION_FLUSH,
};

export const zstdOptions = {
  flush: (zlib.constants as any).ZSTD_e_flush,
  finishFlush: (zlib.constants as any).ZSTD_e_flush,
};

export const isBrotliSupported = utils.isFunction(zlib.createBrotliDecompress);
export const isZstdSupported = utils.isFunction((zlib as any).createZstdDecompress);
export const ACCEPT_ENCODING = 'gzip, compress, deflate' + (isBrotliSupported ? ', br' : '');
export const ACCEPT_ENCODING_WITH_ZSTD = ACCEPT_ENCODING + (isZstdSupported ? ', zstd' : '');
export const scheduleProgress: (fn: () => void) => void =
  typeof process !== 'undefined' && process.nextTick ? process.nextTick.bind(process) : utils.asap;

export const isHttps = /https:?/;

// Symbols used to bind a single 'error' listener to a pooled socket and track
// the request currently owning that socket across keep-alive reuse (issue #10780).
export const kAxiosSocketListener = Symbol('axios.http.socketListener');
export const kAxiosCurrentReq = Symbol('axios.http.currentReq');

// A shared listener avoids retaining an adapter context for the lifetime of a
// pooled socket. EventEmitter invokes listeners with `this` set to the emitter.
export function handleSocketError(this: any, err: any): void {
  const current = this[kAxiosCurrentReq];
  if (current && !current.destroyed) {
    current.destroy(err);
  }
}

// Tags HttpsProxyAgent instances installed by setProxy() so the redirect path
// can strip them without clobbering a user-supplied agent that happens to be
// an HttpsProxyAgent.
export const kAxiosInstalledTunnel = Symbol('axios.http.installedTunnel');

export const supportedProtocols = platform.protocols.map((protocol) => {
  return protocol + ':';
});

// Node's WHATWG URL parser returns `username` and `password` percent-encoded.
// Decode before composing the `auth` option so `my%40email.com:pass` is sent
// as `my@email.com:pass`. Falls back to the original value for malformed input.
export const decodeURIComponentSafe = (value: any): any => {
  if (!utils.isString(value)) {
    return value;
  }

  try {
    return decodeURIComponent(value);
  } catch (error) {
    return value;
  }
};

export const flushOnFinish = (stream: any, [throttled, flush]: [any, any]): any => {
  stream.on('end', flush).on('error', flush);

  return throttled;
};

export type OnDoneHandler = (value: any, isRejected?: boolean) => void;

export type AsyncExecutor = (
  resolve: (value: any) => void,
  reject: (reason: any) => void,
  onDone: (handler: OnDoneHandler) => void
) => Promise<any>;

// temporary hotfix
export const wrapAsync = (asyncExecutor: AsyncExecutor): Promise<any> => {
  return new Promise((resolve, reject) => {
    let onDone: OnDoneHandler | undefined;
    let isDone: boolean | undefined;

    const done = (value: any, isRejected?: boolean) => {
      if (isDone) return;
      isDone = true;
      onDone && onDone(value, isRejected);
    };

    const _resolve = (value: any) => {
      done(value);
      resolve(value);
    };

    const _reject = (reason: any) => {
      done(reason, true);
      reject(reason);
    };

    asyncExecutor(_resolve, _reject, (onDoneHandler) => (onDone = onDoneHandler)).catch(_reject);
  });
};
