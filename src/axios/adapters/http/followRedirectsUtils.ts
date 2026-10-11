'use strict';

// Helpers for the in-package port of follow-redirects 1.16.1.

import url from 'node:url';

// Whether to use the native URL object or the legacy url module
export let useNativeURL = false;
try {
  if (!new URL('')) {
    throw new Error('assertion failed');
  }
} catch (error: any) {
  useNativeURL = error.code === 'ERR_INVALID_URL';
}

// HTTP headers to drop across HTTP/HTTPS and domain boundaries
export const sensitiveHeaders = ['Authorization', 'Proxy-Authorization', 'Cookie'];

// URL fields to preserve in copy operations
export const preservedUrlFields = [
  'auth',
  'host',
  'hostname',
  'href',
  'path',
  'pathname',
  'port',
  'protocol',
  'query',
  'search',
  'hash',
];

// Create handlers that pass events from native requests
export const events = ['abort', 'aborted', 'connect', 'error', 'socket', 'timeout'];
export const eventHandlers: Record<string, (...args: any[]) => void> = Object.create(null);
events.forEach(function (event) {
  eventHandlers[event] = function (this: any, arg1: any, arg2: any, arg3: any) {
    this._redirectable.emit(event, arg1, arg2, arg3);
  };
});

export function createErrorType(code: string, message: string, baseClass?: any): any {
  // Create constructor
  function CustomError(this: any, properties?: any) {
    if (isFunction(Error.captureStackTrace)) {
      Error.captureStackTrace(this, this.constructor);
    }
    Object.assign(this, properties || {});
    this.code = code;
    this.message = this.cause ? message + ': ' + this.cause.message : message;
  }

  // Attach constructor and set default properties
  CustomError.prototype = new (baseClass || Error)();
  Object.defineProperties(CustomError.prototype, {
    constructor: {
      value: CustomError,
      enumerable: false,
    },
    name: {
      value: 'Error [' + code + ']',
      enumerable: false,
    },
  });
  return CustomError;
}

// Error types with codes
export const InvalidUrlError = createErrorType('ERR_INVALID_URL', 'Invalid URL', TypeError);
export const RedirectionError = createErrorType(
  'ERR_FR_REDIRECTION_FAILURE',
  'Redirected request failed'
);
export const TooManyRedirectsError = createErrorType(
  'ERR_FR_TOO_MANY_REDIRECTS',
  'Maximum number of redirects exceeded',
  RedirectionError
);
export const MaxBodyLengthExceededError = createErrorType(
  'ERR_FR_MAX_BODY_LENGTH_EXCEEDED',
  'Request body larger than maxBodyLength limit'
);
export const WriteAfterEndError = createErrorType('ERR_STREAM_WRITE_AFTER_END', 'write after end');

export function noop(): void {
  /* empty */
}

export function assertionError(message: string): Error {
  const err: any = new Error(message);
  err.code = 'ERR_ASSERTION';
  err.name = 'AssertionError';
  return err;
}

export function parseUrl(input: string): any {
  let parsed: any;
  if (useNativeURL) {
    parsed = new URL(input);
  } else {
    // The URL must be valid and absolute
    parsed = validateUrl(url.parse(input));
    if (!isString(parsed.protocol)) {
      throw new InvalidUrlError({ input });
    }
  }
  return parsed;
}

export function resolveUrl(relative: string, base: string): any {
  return useNativeURL ? new URL(relative, base) : parseUrl(url.resolve(base, relative));
}

export function validateUrl(input: any): any {
  if (/^\[/.test(input.hostname) && !/^\[[:0-9a-f]+\]$/i.test(input.hostname)) {
    throw new InvalidUrlError({ input: input.href || input });
  }
  if (/^\[/.test(input.host) && !/^\[[:0-9a-f]+\](:\d+)?$/i.test(input.host)) {
    throw new InvalidUrlError({ input: input.href || input });
  }
  return input;
}

export function spreadUrlObject(urlObject: any, target?: any): any {
  const spread = target || {};
  for (const key of preservedUrlFields) {
    spread[key] = urlObject[key];
  }

  // Fix IPv6 hostname
  if (spread.hostname.startsWith('[')) {
    spread.hostname = spread.hostname.slice(1, -1);
  }
  // Port must be a number
  if (spread.port !== '') {
    spread.port = Number(spread.port);
  }
  // Concatenate path
  spread.path = spread.search ? spread.pathname + spread.search : spread.pathname;

  return spread;
}

export function removeMatchingHeaders(regex: RegExp, headers: any): string | undefined {
  let lastValue: any;
  for (const header in headers) {
    if (regex.test(header)) {
      lastValue = headers[header];
      delete headers[header];
    }
  }
  return lastValue === null || typeof lastValue === 'undefined'
    ? undefined
    : String(lastValue).trim();
}

export function destroyRequest(request: any, error?: any): void {
  for (const event of events) {
    request.removeListener(event, eventHandlers[event]);
  }
  request.on('error', noop);
  request.destroy(error);
}

export function isSubdomain(subdomain: string, domain: string): boolean {
  if (!(isString(subdomain) && isString(domain))) {
    throw assertionError('The expression evaluated to a falsy value');
  }
  const dot = subdomain.length - domain.length - 1;
  return dot > 0 && subdomain[dot] === '.' && subdomain.endsWith(domain);
}

export function isArray(value: any): boolean {
  return value instanceof Array;
}

export function isString(value: any): boolean {
  return typeof value === 'string' || value instanceof String;
}

export function isFunction(value: any): boolean {
  return typeof value === 'function';
}

export function isBuffer(value: any): boolean {
  return typeof value === 'object' && 'length' in value;
}

export function isURL(value: any): boolean {
  return URL && value instanceof URL;
}

export function escapeRegex(regex: string): string {
  return regex.replace(/[[\]\\/()*+?.^$|]/g, '\\$&');
}
