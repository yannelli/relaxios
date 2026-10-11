import utils from '../utils';
import AxiosError from '../core/AxiosError';
import composeSignals from '../helpers/composeSignals';
import { trackStream } from '../helpers/trackStream';
import AxiosHeaders from '../core/AxiosHeaders';
import {
  progressEventReducer,
  progressEventDecorator,
  asyncDecorator,
} from '../helpers/progressEventReducer';
import resolveConfig from '../helpers/resolveConfig';
import settle from '../core/settle';
import { DEFAULT_CHUNK_SIZE, createFetchEnv } from './fetch/env';
import type { FetchEnv } from './fetch/env';
import { sendRequest, createSendState } from './fetch/send';

// Non-enumerable like a native Error `cause`, so loggers do not recurse into fetch internals.
export const defineCause = (err: any, cause: any) => {
  const descriptor: PropertyDescriptor = Object.create(null);
  descriptor.value = cause;
  descriptor.writable = true;
  descriptor.enumerable = false;
  descriptor.configurable = true;
  Object.defineProperty(err, 'cause', descriptor);
};

const maxContentLengthError = (maxContentLength: number, config: any, request: any) =>
  new AxiosError(
    'maxContentLength size of ' + maxContentLength + ' exceeded',
    AxiosError.ERR_BAD_RESPONSE,
    config,
    request
  );

const createAdapter = (env: FetchEnv) => async (config: any) => {
  const resolved = resolveConfig(config);
  let { responseType } = resolved;
  const { signal, cancelToken, timeout, onDownloadProgress, maxContentLength } = resolved;
  const { Response, TextEncoder } = env;

  const hasMaxContentLength = utils.isNumber(maxContentLength) && maxContentLength > -1;

  responseType = responseType ? (responseType + '').toLowerCase() : 'text';

  const state = createSendState();
  const composedSignal = (state.composedSignal = composeSignals(
    [signal, cancelToken && cancelToken.toAbortSignal()],
    timeout
  ));

  const unsubscribe = (state.unsubscribe =
    composedSignal &&
    composedSignal.unsubscribe &&
    (() => {
      composedSignal.unsubscribe();
    }));

  try {
    let response = await sendRequest(env, config, resolved, state);
    const request = state.request;

    const responseHeaders = AxiosHeaders.from(response.headers);

    // Reject up-front when the declared content-length already exceeds the cap.
    if (hasMaxContentLength) {
      const declaredLength = utils.toFiniteNumber(responseHeaders.getContentLength());
      if (declaredLength != null && declaredLength > maxContentLength) {
        throw maxContentLengthError(maxContentLength, config, request);
      }
    }

    const isStreamResponse =
      env.supportsResponseStream && (responseType === 'stream' || responseType === 'response');

    if (
      env.supportsResponseStream &&
      response.body &&
      (onDownloadProgress || hasMaxContentLength || (isStreamResponse && unsubscribe))
    ) {
      const options: Record<string, any> = {};

      ['status', 'statusText', 'headers'].forEach((prop) => {
        options[prop] = response[prop];
      });

      const responseContentLength = utils.toFiniteNumber(responseHeaders.getContentLength());

      const [onProgress, flush] =
        (onDownloadProgress &&
          progressEventDecorator(
            responseContentLength,
            progressEventReducer(asyncDecorator(onDownloadProgress), true)
          )) ||
        [];

      let bytesRead = 0;
      const onChunkProgress = (loadedBytes: number) => {
        if (hasMaxContentLength) {
          bytesRead = loadedBytes;
          if (bytesRead > maxContentLength) {
            throw maxContentLengthError(maxContentLength, config, request);
          }
        }
        onProgress && onProgress(loadedBytes);
      };

      response = new Response(
        trackStream(response.body, DEFAULT_CHUNK_SIZE, onChunkProgress, () => {
          flush && flush();
          unsubscribe && unsubscribe();
        }),
        options
      );
    }

    responseType = responseType || 'text';

    const responseData = await env.resolvers[utils.findKey(env.resolvers, responseType) || 'text'](
      response,
      config
    );

    // Fallback enforcement for runtimes without ReadableStream: measure the materialized output.
    if (hasMaxContentLength && !env.supportsResponseStream && !isStreamResponse) {
      let materializedSize;
      if (responseData != null) {
        if (typeof responseData.byteLength === 'number') {
          materializedSize = responseData.byteLength;
        } else if (typeof responseData.size === 'number') {
          materializedSize = responseData.size;
        } else if (typeof responseData === 'string') {
          materializedSize =
            typeof TextEncoder === 'function'
              ? new TextEncoder().encode(responseData).byteLength
              : responseData.length;
        }
      }
      if (typeof materializedSize === 'number' && materializedSize > maxContentLength) {
        throw maxContentLengthError(maxContentLength, config, request);
      }
    }

    !isStreamResponse && unsubscribe && unsubscribe();

    return await new Promise((resolve, reject) => {
      settle(resolve, reject, {
        data: responseData,
        headers: AxiosHeaders.from(response.headers),
        status: response.status,
        statusText: response.statusText,
        config,
        request,
      });
    });
  } catch (err: any) {
    const request = state.request;
    unsubscribe && unsubscribe();

    // Safari may surface aborts as DOMException-like objects whose getters throw;
    // read our composed signal reason first to keep timeout vs cancellation apart.
    if (composedSignal && composedSignal.aborted && composedSignal.reason instanceof AxiosError) {
      const canceledError = composedSignal.reason;
      canceledError.config = config;
      request && (canceledError.request = request);
      if (err !== canceledError) {
        defineCause(canceledError, err);
      }
      throw canceledError;
    }

    // A maxBodyLength violation raised while the body streamed, matched by identity.
    if (state.pendingBodyError) {
      request && !state.pendingBodyError.request && (state.pendingBodyError.request = request);
      throw state.pendingBodyError;
    }

    if (err instanceof AxiosError) {
      request && !err.request && (err.request = request);
      throw err;
    }

    if (err && err.name === 'TypeError' && /Load failed|fetch/i.test(err.message)) {
      const networkError = new AxiosError(
        'Network Error',
        AxiosError.ERR_NETWORK,
        config,
        request,
        err && err.response
      );
      defineCause(networkError, err.cause || err);
      throw networkError;
    }

    throw AxiosError.from(err, err && err.code, config, request, err && err.response);
  }
};

interface SeedEntry {
  env: FetchEnv | false;
  adapter: any;
}

const createEntry = (env: any): SeedEntry => {
  const fetchEnv = createFetchEnv(env);
  return { env: fetchEnv, adapter: fetchEnv && createAdapter(fetchEnv) };
};

const seedCache = new Map();

const lookup = (config?: any): SeedEntry => {
  const env = (config && config.env) || {};
  const { fetch, Request, Response } = env;
  const seeds = [Request, Response, fetch];

  const len = seeds.length;
  let i = len,
    seed,
    target,
    map = seedCache;

  while (i--) {
    seed = seeds[i];
    target = map.get(seed);

    target === undefined && map.set(seed, (target = i ? new Map() : createEntry(env)));

    map = target;
  }

  return target;
};

export const getFetch = (config?: any) => lookup(config).adapter;

// The probed fetch environment for `config.env`, shared with the xhr adapter's fetch transport.
export const getFetchEnv = (config?: any) => lookup(config).env;

const adapter = getFetch();

export default adapter;
