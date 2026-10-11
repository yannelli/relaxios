'use strict';

import utils from '../utils';
import AxiosURLSearchParams from './AxiosURLSearchParams';

// Replaces the URL-encoded forms of `:`, `$`, `,` and space with `:`, `$`, `,` and `+`.
export function encode(val: any): string {
  return encodeURIComponent(val)
    .replace(/%3A/gi, ':')
    .replace(/%24/g, '$')
    .replace(/%2C/gi, ',')
    .replace(/%20/g, '+');
}

export default function buildURL(url: any, params?: any, options?: any): string {
  if (!params) {
    return url;
  }
  url = url || '';

  const _options = utils.isFunction(options)
    ? {
        serialize: options,
      }
    : options;

  // Read serializer options pollution-safely: own properties and methods on a
  // class/template prototype are honored, but values injected onto a polluted
  // Object.prototype are ignored.
  const _encode = utils.getSafeProp(_options, 'encode') || encode;
  const serializeFn = utils.getSafeProp(_options, 'serialize');

  let serializedParams;

  if (serializeFn) {
    serializedParams = serializeFn(params, _options);
  } else {
    serializedParams = utils.isURLSearchParams(params)
      ? params.toString()
      : new AxiosURLSearchParams(params, _options).toString(_encode);
  }

  if (serializedParams) {
    const hashmarkIndex = url.indexOf('#');

    if (hashmarkIndex !== -1) {
      url = url.slice(0, hashmarkIndex);
    }
    url += (url.indexOf('?') === -1 ? '?' : '&') + serializedParams;
  }

  return url;
}
