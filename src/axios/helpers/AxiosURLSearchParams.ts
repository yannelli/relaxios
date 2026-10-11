'use strict';

import toFormData from './toFormData';

// Percent-encodes everything outside the unreserved set, then maps a few
// characters the way application/x-www-form-urlencoded expects.
function encode(str: any): string {
  const charMap: Record<string, string> = {
    '!': '%21',
    "'": '%27',
    '(': '%28',
    ')': '%29',
    '~': '%7E',
    '%20': '+',
  };
  return encodeURIComponent(str).replace(/[!'()~]|%20/g, function replacer(match) {
    return charMap[match];
  });
}

class AxiosURLSearchParams {
  _pairs: Array<[any, any]>;

  constructor(params?: any, options?: any) {
    this._pairs = [];

    params && toFormData(params, this, options);
  }

  append(name: any, value: any): void {
    this._pairs.push([name, value]);
  }

  toString(encoder?: any): string {
    const _encode = encoder ? (value: any) => encoder.call(this, value, encode) : encode;

    return this._pairs
      .map(function each(pair) {
        return _encode(pair[0]) + '=' + _encode(pair[1]);
      }, '')
      .join('&');
  }
}

export default AxiosURLSearchParams;
