'use strict';

// If the proxy, auth, sensitive header, or config beforeRedirects functions are
// defined, call them with the options object.
export function dispatchBeforeRedirect(options: any, responseDetails: any, requestDetails: any): void {
  if (options.beforeRedirects.proxy) {
    options.beforeRedirects.proxy(options);
  }
  if (options.beforeRedirects.auth) {
    options.beforeRedirects.auth(options);
  }
  if (options.beforeRedirects.sensitiveHeaders) {
    options.beforeRedirects.sensitiveHeaders(options, requestDetails);
  }
  if (options.beforeRedirects.config) {
    options.beforeRedirects.config(options, responseDetails, requestDetails);
  }
}

export function stripMatchingHeaders(headers: any, sensitiveSet: Set<string>): void {
  if (!headers) {
    return;
  }

  Object.keys(headers).forEach((header) => {
    if (sensitiveSet.has(header.toLowerCase())) {
      delete headers[header];
    }
  });
}

export function isSameOriginRedirect(redirectOptions: any, requestDetails: any): boolean {
  if (!requestDetails) {
    return false;
  }

  try {
    return new URL(requestDetails.url).origin === new URL(redirectOptions.href).origin;
  } catch (e) {
    // If origin comparison fails, treat the redirect as unsafe.
    return false;
  }
}
