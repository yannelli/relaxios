'use strict';

import AxiosError, { REDACTED } from './AxiosError';
import isAbsoluteURL from '../helpers/isAbsoluteURL';
import combineURLs from '../helpers/combineURLs';
import normalizeURLForProtocolCheck from '../helpers/normalizeURLForProtocolCheck';

const malformedHttpProtocol = /^https?:(?!\/\/)/i;

// Redact userinfo, query parameter values and fragment contents before a URL is
// embedded in an error message, keeping scheme, host, path and parameter names.
function redactFragment(fragment: string): string {
  if (!fragment) {
    return fragment;
  }

  return fragment.replace(
    /(^|&)([^=&]*=)?[^&]+/g,
    (match: string, separator: string, parameterName: string = '') => {
      return `${separator}${parameterName}${REDACTED}`;
    }
  );
}

function redactSensitiveURLParts(url: string): string {
  const redactedURL = url.replace(/^(https?:\/{0,2})[^/?#]*@/i, `$1${REDACTED}@`);
  const fragmentIndex = redactedURL.indexOf('#');
  const urlWithoutFragment =
    fragmentIndex === -1 ? redactedURL : redactedURL.slice(0, fragmentIndex);
  const redactedURLWithoutFragment = urlWithoutFragment.replace(
    /([?&][^=&#]*=)[^&#]*/g,
    `$1${REDACTED}`
  );

  if (fragmentIndex === -1) {
    return redactedURLWithoutFragment;
  }

  return `${redactedURLWithoutFragment}#${redactFragment(redactedURL.slice(fragmentIndex + 1))}`;
}

function assertValidHttpProtocolURL(url: any, config: any): void {
  if (typeof url === 'string') {
    const normalizedURL = normalizeURLForProtocolCheck(url);
    if (malformedHttpProtocol.test(normalizedURL)) {
      throw new AxiosError(
        `Invalid URL ${JSON.stringify(redactSensitiveURLParts(normalizedURL))}: missing "//" after protocol`,
        AxiosError.ERR_INVALID_URL,
        config
      );
    }
  }
}

// Combine baseURL with requestedURL unless requestedURL is already absolute
export default function buildFullPath(
  baseURL: any,
  requestedURL: any,
  allowAbsoluteUrls?: boolean,
  config?: any
): string {
  assertValidHttpProtocolURL(requestedURL, config);
  let isRelativeUrl = !isAbsoluteURL(requestedURL);
  if (baseURL && (isRelativeUrl || allowAbsoluteUrls === false)) {
    assertValidHttpProtocolURL(baseURL, config);
    return combineURLs(baseURL, requestedURL);
  }
  return requestedURL;
}
