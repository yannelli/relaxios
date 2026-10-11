import platform from '../../platform/index';
import utils from '../../utils';
import AxiosError from '../../core/AxiosError';
import { trackStream } from '../../helpers/trackStream';
import {
  progressEventReducer,
  progressEventDecorator,
  asyncDecorator,
} from '../../helpers/progressEventReducer';
import estimateDataURLDecodedBytes from '../../helpers/estimateDataURLDecodedBytes';
import { VERSION } from '../../env/data';
import { toByteStringHeaderObject } from '../../helpers/sanitizeHeaderValue';
import type { FetchEnv } from './env';
import {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_REQUEST_OPTIONS,
  encodeUTF8,
  decodeURIComponentSafe,
  maybeWithAuthCredentials,
} from './env';

export interface SendState {
  request: any;
  composedSignal: any;
  unsubscribe: (() => void) | undefined | false;
  // AxiosError raised while the body streams, kept by identity for the catch block.
  pendingBodyError: any;
}

export const createSendState = (): SendState => ({
  request: null,
  composedSignal: undefined,
  unsubscribe: undefined,
  pendingBodyError: null,
});

// Runs the fetch for `resolved` (output of resolveConfig) and returns the raw Response.
// `asXHR` keeps the XHR adapter's rules: no config.auth rewrite, no User-Agent header.
export const sendRequest = async (
  env: FetchEnv,
  config: any,
  resolved: any,
  state: SendState,
  asXHR?: boolean
): Promise<any> => {
  const { Request } = env;
  let {
    url,
    method,
    data,
    onUploadProgress,
    headers,
    withCredentials = 'same-origin',
    fetchOptions,
    maxContentLength,
    maxBodyLength,
    maxRedirects,
  } = resolved;

  const hasMaxContentLength = utils.isNumber(maxContentLength) && maxContentLength > -1;
  const hasMaxBodyLength = utils.isNumber(maxBodyLength) && maxBodyLength > -1;
  const own = (key: string) => (utils.hasOwnProp(config, key) ? config[key] : undefined);

  const _fetch = env.envFetch || fetch;
  const { composedSignal } = state;

  let requestContentLength: number | undefined;

  const maxBodyLengthError = () =>
    new AxiosError(
      'Request body larger than maxBodyLength limit',
      AxiosError.ERR_BAD_REQUEST,
      config,
      state.request
    );

  // HTTP basic authentication
  let auth: { username: any; password: any } | undefined = undefined;
  const configAuth = asXHR ? undefined : own('auth');

  if (configAuth) {
    const username = utils.getSafeProp(configAuth, 'username') || '';
    const password = utils.getSafeProp(configAuth, 'password') || '';
    auth = {
      username,
      password,
    };
  }

  if (maybeWithAuthCredentials(url)) {
    const parsedURL = new URL(url, platform.origin);

    // XHR keeps URL credentials for a 401 challenge; it never sends them up front.
    if (!auth && (parsedURL.username || parsedURL.password) && !asXHR) {
      const urlUsername = decodeURIComponentSafe(parsedURL.username);
      const urlPassword = decodeURIComponentSafe(parsedURL.password);
      auth = {
        username: urlUsername,
        password: urlPassword,
      };
    }

    if (parsedURL.username || parsedURL.password) {
      parsedURL.username = '';
      parsedURL.password = '';
      url = parsedURL.href;
    }
  }

  if (auth) {
    headers.delete('authorization');
    headers.set(
      'Authorization',
      'Basic ' + btoa(encodeUTF8((auth.username || '') + ':' + (auth.password || '')))
    );
  }

  // Enforce maxContentLength for data: URLs up-front, like the http adapter does.
  if (hasMaxContentLength && typeof url === 'string' && url.startsWith('data:')) {
    const estimated = estimateDataURLDecodedBytes(url);
    if (estimated > maxContentLength) {
      throw new AxiosError(
        'maxContentLength size of ' + maxContentLength + ' exceeded',
        AxiosError.ERR_BAD_RESPONSE,
        config,
        state.request
      );
    }
  }

  // Enforce maxBodyLength against the body's actual size, never a declared Content-Length.
  if (hasMaxBodyLength && method !== 'get' && method !== 'head') {
    const outboundLength = await env.getBodyLength(data);
    if (typeof outboundLength === 'number' && isFinite(outboundLength)) {
      requestContentLength = outboundLength;
      if (outboundLength > maxBodyLength) {
        throw maxBodyLengthError();
      }
    }
  }

  // A streamed body under maxBodyLength is counted as fetch consumes it.
  const mustEnforceStreamBody =
    hasMaxBodyLength && (utils.isReadableStream(data) || utils.isStream(data));

  const trackRequestStream = (stream: any, onProgress?: any, flush?: any) =>
    trackStream(
      stream,
      DEFAULT_CHUNK_SIZE,
      (loadedBytes: number) => {
        if (hasMaxBodyLength && loadedBytes > maxBodyLength) {
          throw (state.pendingBodyError = maxBodyLengthError());
        }
        onProgress && onProgress(loadedBytes);
      },
      flush
    );

  if (
    env.supportsRequestStream &&
    method !== 'get' &&
    method !== 'head' &&
    (onUploadProgress || mustEnforceStreamBody)
  ) {
    requestContentLength =
      requestContentLength == null
        ? await env.resolveBodyLength(headers, data)
        : requestContentLength;

    // A declared length of 0 only skips the wrap when no stream limit is enforced.
    if (requestContentLength !== 0 || mustEnforceStreamBody) {
      const _request = new Request(url, {
        method: 'POST',
        body: data,
        duplex: 'half',
      });

      let contentTypeHeader;

      if (utils.isFormData(data) && (contentTypeHeader = _request.headers.get('content-type'))) {
        headers.setContentType(contentTypeHeader);
      }

      if (_request.body) {
        const [onProgress, flush] =
          (onUploadProgress &&
            progressEventDecorator(
              requestContentLength,
              progressEventReducer(asyncDecorator(onUploadProgress))
            )) ||
          [];

        data = trackRequestStream(_request.body, onProgress, flush);
      }
    }
  } else if (
    mustEnforceStreamBody &&
    !env.isRequestSupported &&
    env.isReadableStreamSupported &&
    method !== 'get' &&
    method !== 'head'
  ) {
    data = trackRequestStream(data);
  } else if (
    mustEnforceStreamBody &&
    env.isRequestSupported &&
    !env.supportsRequestStream &&
    method !== 'get' &&
    method !== 'head'
  ) {
    throw new AxiosError(
      'Stream request bodies are not supported by the current fetch implementation',
      AxiosError.ERR_NOT_SUPPORT,
      config,
      state.request
    );
  }

  if (!utils.isString(withCredentials)) {
    withCredentials = withCredentials ? 'include' : 'omit';
  }

  // Cloudflare Workers throws when credentials are defined (workerd#902).
  const isCredentialsSupported = env.isRequestSupported && 'credentials' in Request.prototype;

  // Drop a boundary-less multipart Content-Type so fetch sets it with the boundary.
  if (utils.isFormData(data)) {
    const contentType = headers.getContentType();
    if (
      contentType &&
      /^multipart\/form-data/i.test(contentType) &&
      !/boundary=/i.test(contentType)
    ) {
      headers.delete('content-type');
    }
  }

  // fetch defaults the User-Agent to 'node' in Node.js; XHR never sets one.
  asXHR || headers.set('User-Agent', 'axios/' + VERSION, false);

  const safeFetchOptions =
    fetchOptions == null ? fetchOptions : Object.assign(Object.create(null), fetchOptions);

  if (safeFetchOptions) {
    // Owned by axios and already reflected in the resolved Request.
    delete safeFetchOptions.body;
    delete safeFetchOptions.headers;
    delete safeFetchOptions.method;
    delete safeFetchOptions.signal;
    delete safeFetchOptions.duplex;
    delete safeFetchOptions.credentials;
  }

  const resolvedOptions = Object.assign(Object.create(null), safeFetchOptions, {
    signal: composedSignal,
    method: method.toUpperCase(),
    headers: toByteStringHeaderObject(headers.normalize()),
    body: data,
    duplex: 'half',
    credentials: isCredentialsSupported ? withCredentials : undefined,
  });

  if (env.isRequestSupported) {
    utils.forEach(DEFAULT_REQUEST_OPTIONS, (value: any, key: string) => {
      if (resolvedOptions[key] === undefined) {
        resolvedOptions[key] = value;
      }
    });

    if (resolvedOptions.signal === undefined) {
      resolvedOptions.signal = null;
    }

    if (resolvedOptions.body === undefined) {
      resolvedOptions.body = null;
    }
  }

  if (maxRedirects === 0) {
    resolvedOptions.redirect = 'manual';

    if (safeFetchOptions) {
      safeFetchOptions.redirect = 'manual';
    }
  }

  const request = (state.request = env.isRequestSupported && new Request(url, resolvedOptions));

  return await (env.isRequestSupported
    ? _fetch(request, safeFetchOptions)
    : _fetch(url, resolvedOptions));
};
