import platform from '../../platform/index';
import utils from '../../utils';
import AxiosError from '../../core/AxiosError';

export const DEFAULT_CHUNK_SIZE = 64 * 1024;

export const DEFAULT_REQUEST_OPTIONS: Record<string, any> = {
  cache: 'default',
  redirect: 'follow',
  referrer: 'about:client',
  referrerPolicy: '',
  mode: 'cors',
  integrity: '',
  keepalive: false,
  priority: 'auto',
  window: null,
};

const { isFunction } = utils;

// Latin-1 byte string of the UTF-8 encoding, for btoa().
export const encodeUTF8 = (str: string) =>
  encodeURIComponent(str).replace(/%([0-9A-F]{2})/gi, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );

// WHATWG URL exposes username/password percent-encoded; decode, falling back on bad input.
export const decodeURIComponentSafe = (value: any) => {
  if (!utils.isString(value)) {
    return value;
  }

  try {
    return decodeURIComponent(value);
  } catch (error) {
    return value;
  }
};

const test = (fn: (...args: any[]) => any, ...args: any[]) => {
  try {
    return !!fn(...args);
  } catch (e) {
    return false;
  }
};

export const maybeWithAuthCredentials = (url: string) => {
  const protocolIndex = url.indexOf('://');
  let urlToCheck = url;
  if (protocolIndex !== -1) {
    urlToCheck = urlToCheck.slice(protocolIndex + 3);
  }
  return urlToCheck.includes('@') || urlToCheck.includes(':');
};

export interface FetchEnv {
  envFetch: any;
  Request: any;
  Response: any;
  TextEncoder: any;
  isRequestSupported: boolean;
  isResponseSupported: boolean;
  isReadableStreamSupported: boolean;
  supportsRequestStream: boolean;
  supportsResponseStream: boolean;
  resolvers: Record<string, any>;
  getBodyLength: (body: any) => Promise<number | undefined>;
  resolveBodyLength: (headers: any, body: any) => Promise<number | undefined>;
}

export const createFetchEnv = (env: any): FetchEnv | false => {
  const globalObject: any =
    utils.global !== undefined && utils.global !== null ? utils.global : globalThis;
  const { ReadableStream, TextEncoder } = globalObject;

  env = utils.merge.call(
    {
      skipUndefined: true,
    },
    {
      Request: globalObject.Request,
      Response: globalObject.Response,
    },
    env
  );

  const { fetch: envFetch, Request, Response } = env;
  const isFetchSupported = envFetch ? isFunction(envFetch) : typeof fetch === 'function';
  const isRequestSupported = isFunction(Request);
  const isResponseSupported = isFunction(Response);

  if (!isFetchSupported) {
    return false;
  }

  const isReadableStreamSupported = isFetchSupported && isFunction(ReadableStream);

  const encodeText: (str: string) => any =
    typeof TextEncoder === 'function'
      ? ((encoder: any) => (str: string) => encoder.encode(str))(new TextEncoder())
      : async (str: string) => new Uint8Array(await new Request(str).arrayBuffer());

  const supportsRequestStream =
    isRequestSupported &&
    isReadableStreamSupported &&
    test(() => {
      let duplexAccessed = false;

      const request = new Request(platform.origin, {
        body: new ReadableStream(),
        method: 'POST',
        get duplex() {
          duplexAccessed = true;
          return 'half';
        },
      });

      const hasContentType = request.headers.has('Content-Type');

      if (request.body != null) {
        request.body.cancel();
      }

      return duplexAccessed && !hasContentType;
    });

  const supportsResponseStream =
    isResponseSupported &&
    isReadableStreamSupported &&
    test(() => utils.isReadableStream(new Response('').body));

  const resolvers: Record<string, any> = {
    stream: supportsResponseStream && ((res: any) => res.body),
  };

  ['text', 'arrayBuffer', 'blob', 'formData', 'stream'].forEach((type) => {
    !resolvers[type] &&
      (resolvers[type] = (res: any, config: any) => {
        const method = res && res[type];

        if (method) {
          return method.call(res);
        }

        throw new AxiosError(
          `Response type '${type}' is not supported`,
          AxiosError.ERR_NOT_SUPPORT,
          config
        );
      });
  });

  const getBodyLength = async (body: any): Promise<number | undefined> => {
    if (body == null) {
      return 0;
    }

    if (utils.isBlob(body)) {
      return body.size;
    }

    if (utils.isSpecCompliantForm(body)) {
      const _request = new Request(platform.origin, {
        method: 'POST',
        body,
      });
      return (await _request.arrayBuffer()).byteLength;
    }

    if (utils.isArrayBufferView(body) || utils.isArrayBuffer(body)) {
      return body.byteLength;
    }

    if (utils.isURLSearchParams(body)) {
      body = body + '';
    }

    if (utils.isString(body)) {
      return (await encodeText(body)).byteLength;
    }
  };

  const resolveBodyLength = async (headers: any, body: any) => {
    const length = utils.toFiniteNumber(headers.getContentLength());

    return length == null ? getBodyLength(body) : length;
  };

  return {
    envFetch,
    Request,
    Response,
    TextEncoder,
    isRequestSupported,
    isResponseSupported,
    isReadableStreamSupported,
    supportsRequestStream,
    supportsResponseStream,
    resolvers,
    getBodyLength,
    resolveBodyLength,
  };
};
