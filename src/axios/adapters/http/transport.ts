'use strict';

import http from 'node:http';
import https from 'node:https';
import utils from '../../utils';
import AxiosError from '../../core/AxiosError';
import followRedirects from './followRedirects';
import { http2Transport } from './http2';
import { isSameOriginRedirect, stripMatchingHeaders } from './redirects';
import { isHttps } from './shared';
import type { HttpContext } from './context';

const { http: httpFollow, https: httpsFollow } = followRedirects;

// Picks the transport (http2, config.transport, native http/https or the
// follow-redirects wrapper) and configures redirect hooks. Returns false once rejected.
export function selectTransport(ctx: HttpContext): boolean {
  const { config, own, reject, options, isHttp2, proxyApplied, maxRedirects, auth, parsed } = ctx;
  const { httpAgent, httpsAgent } = ctx;
  let transport: any;
  let isNativeTransport = false;
  // True only for the follow-redirects transport, which applies
  // options.maxBodyLength itself. Every other transport needs the explicit
  // byte-counting pipeline to enforce maxBodyLength on streamed uploads.
  let transportEnforcesMaxBodyLength = false;
  const isHttpsRequest = isHttps.test(options.protocol);
  // Don't clobber a CONNECT-tunneling agent installed by setProxy() for an
  // HTTPS target.
  if (options.agent == null) {
    options.agent = isHttpsRequest ? httpsAgent : httpAgent;
  }

  if (isHttp2) {
    if (proxyApplied) {
      reject(
        new AxiosError(
          'HTTP/2 requests with a proxy are not supported',
          AxiosError.ERR_NOT_SUPPORT,
          config
        )
      );
      return false;
    }

    transport = http2Transport;
  } else {
    const configTransport = own('transport');
    if (configTransport) {
      transport = configTransport;
    } else if (maxRedirects === 0) {
      transport = isHttpsRequest ? https : http;
      isNativeTransport = true;
    } else {
      transportEnforcesMaxBodyLength = true;
      options.sensitiveHeaders = [];
      if (maxRedirects) {
        options.maxRedirects = maxRedirects;
      }
      const configBeforeRedirect = own('beforeRedirect');
      if (configBeforeRedirect) {
        options.beforeRedirects.config = configBeforeRedirect;
      }
      if (auth) {
        // Restore HTTP Basic credentials on same-origin redirects only.
        // follow-redirects >= 1.15.8 strips Authorization on every redirect (see #6929);
        // cross-origin stripping is deliberately preserved by not restoring on origin change.
        const requestOrigin = parsed.origin;
        const authToRestore = auth;
        options.beforeRedirects.auth = function beforeRedirectAuth(redirectOptions: any) {
          try {
            if (new URL(redirectOptions.href).origin === requestOrigin) {
              redirectOptions.auth = authToRestore;
            }
          } catch (e) {
            // ignore malformed URL: leaving auth stripped is fail-safe
          }
        };
      }
      const sensitiveHeaders = own('sensitiveHeaders');
      if (sensitiveHeaders != null) {
        if (!utils.isArray(sensitiveHeaders)) {
          reject(
            new AxiosError(
              'sensitiveHeaders must be an array of strings',
              AxiosError.ERR_BAD_OPTION_VALUE,
              config
            )
          );
          return false;
        }

        const sensitiveSet = new Set<string>();
        for (const header of sensitiveHeaders) {
          if (!utils.isString(header)) {
            reject(
              new AxiosError(
                'sensitiveHeaders must be an array of strings',
                AxiosError.ERR_BAD_OPTION_VALUE,
                config
              )
            );
            return false;
          }

          sensitiveSet.add(header.toLowerCase());
        }

        if (sensitiveSet.size) {
          options.sensitiveHeaders = Array.from(sensitiveSet);
          options.beforeRedirects.sensitiveHeaders = function beforeRedirectSensitiveHeaders(
            redirectOptions: any,
            requestDetails: any
          ) {
            if (!isSameOriginRedirect(redirectOptions, requestDetails)) {
              stripMatchingHeaders(redirectOptions.headers, sensitiveSet);
            }
          };
        }
      }
      transport = isHttpsRequest ? httpsFollow : httpFollow;
    }
  }

  ctx.transport = transport;
  ctx.isNativeTransport = isNativeTransport;
  ctx.transportEnforcesMaxBodyLength = transportEnforcesMaxBodyLength;
  ctx.isHttpsRequest = isHttpsRequest;
  return true;
}
