'use strict';

// In-package port of follow-redirects 1.16.1, exposed as
// `{ http: { request, get }, https: { request, get } }` plus `wrap`.

import http from 'node:http';
import https from 'node:https';
import RedirectableRequest from './followRedirectsRequest';
import {
  InvalidUrlError,
  assertionError,
  isFunction,
  isString,
  isURL,
  parseUrl,
  spreadUrlObject,
  validateUrl,
} from './followRedirectsUtils';

// Wraps the key/value object of protocols with redirect functionality
export function wrap(protocols: Record<string, any>): any {
  // Default settings
  const exports: any = {
    maxRedirects: 21,
    maxBodyLength: 10 * 1024 * 1024,
  };

  // Wrap each protocol
  const nativeProtocols: Record<string, any> = {};
  Object.keys(protocols).forEach(function (scheme) {
    const protocol = scheme + ':';
    const nativeProtocol = (nativeProtocols[protocol] = protocols[scheme]);
    const wrappedProtocol = (exports[scheme] = Object.create(nativeProtocol));

    // Executes a request, following redirects
    function request(input: any, options?: any, callback?: any): RedirectableRequest {
      // Parse parameters, making sure that input is an object
      if (isURL(input)) {
        input = spreadUrlObject(input);
      } else if (isString(input)) {
        input = spreadUrlObject(parseUrl(input));
      } else {
        callback = options;
        options = validateUrl(input);
        input = { protocol: protocol };
      }
      if (isFunction(options)) {
        callback = options;
        options = null;
      }

      // Set defaults
      options = Object.assign(
        {
          maxRedirects: exports.maxRedirects,
          maxBodyLength: exports.maxBodyLength,
        },
        input,
        options
      );
      options.nativeProtocols = nativeProtocols;
      if (!isString(options.host) && !isString(options.hostname)) {
        options.hostname = '::1';
      }

      if (options.protocol != protocol) {
        throw assertionError('protocol mismatch');
      }
      return new RedirectableRequest(options, callback);
    }

    // Executes a GET request, following redirects
    function get(input: any, options?: any, callback?: any): RedirectableRequest {
      const wrappedRequest = wrappedProtocol.request(input, options, callback);
      wrappedRequest.end();
      return wrappedRequest;
    }

    // Expose the properties on the wrapped protocol
    Object.defineProperties(wrappedProtocol, {
      request: { value: request, configurable: true, enumerable: true, writable: true },
      get: { value: get, configurable: true, enumerable: true, writable: true },
    });
  });
  return exports;
}

export { RedirectableRequest, InvalidUrlError };

const followRedirects = wrap({ http: http, https: https });

export default followRedirects;
