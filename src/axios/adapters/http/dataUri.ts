'use strict';

import stream from 'node:stream';
import utils from '../../utils';
import settle from '../../core/settle';
import AxiosError from '../../core/AxiosError';
import AxiosHeaders from '../../core/AxiosHeaders';
import fromDataURI from '../../helpers/fromDataURI';
import { estimateDataURLBufferAllocation } from '../../helpers/estimateDataURLDecodedBytes';
import type { HttpContext } from './context';

// Serves a data: URL without a network round trip. Returns true once the
// request has been settled or rejected.
export function handleDataURL(ctx: HttpContext): boolean {
  const { config, own, resolve, reject, method, responseType, responseEncoding, fullPath } = ctx;
  const maxContentLength = ctx.maxContentLength;

  // Apply the same semantics as HTTP: only enforce if a finite, non-negative cap is set.
  if (maxContentLength > -1) {
    // Use the exact string passed to fromDataURI (the configured url); fall back to fullPath if needed.
    const dataUrl = String(own('url') || fullPath || '');
    const estimated = estimateDataURLBufferAllocation(dataUrl);

    if (estimated > maxContentLength) {
      reject(
        new AxiosError(
          'maxContentLength size of ' + maxContentLength + ' exceeded',
          AxiosError.ERR_BAD_RESPONSE,
          config
        )
      );
      return true;
    }
  }

  let convertedData: any;

  if (method !== 'GET') {
    settle(resolve, reject, {
      status: 405,
      statusText: 'method not allowed',
      headers: {},
      config,
    });
    return true;
  }

  try {
    convertedData = fromDataURI(own('url'), responseType === 'blob', {
      Blob: config.env && config.env.Blob,
    });
  } catch (err) {
    throw AxiosError.from(err, AxiosError.ERR_BAD_REQUEST, config);
  }

  if (responseType === 'text') {
    convertedData = convertedData.toString(responseEncoding);

    if (!responseEncoding || responseEncoding === 'utf8') {
      convertedData = utils.stripBOM(convertedData);
    }
  } else if (responseType === 'stream') {
    convertedData = stream.Readable.from(convertedData);
  }

  settle(resolve, reject, {
    data: convertedData,
    status: 200,
    statusText: 'OK',
    headers: new AxiosHeaders(),
    config,
  });
  return true;
}
