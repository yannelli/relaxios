'use strict';

const urlParserControlCharacters = /[\t\n\r]/g;

// Match WHATWG URL preprocessing before checking a URL's protocol.
export default function normalizeURLForProtocolCheck(url: any): any {
  if (typeof url !== 'string') {
    return url;
  }

  let start = 0;

  while (start < url.length && url.charCodeAt(start) <= 0x20) {
    start++;
  }

  return url.slice(start).replace(urlParserControlCharacters, '');
}
