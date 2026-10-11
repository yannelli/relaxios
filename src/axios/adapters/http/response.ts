'use strict';

import stream from 'node:stream';
import zlib from 'node:zlib';
import utils from '../../utils';
import settle from '../../core/settle';
import AxiosError from '../../core/AxiosError';
import AxiosHeaders from '../../core/AxiosHeaders';
import AxiosTransformStream from '../../helpers/AxiosTransformStream';
import ZlibHeaderTransformStream from '../../helpers/ZlibHeaderTransformStream';
import {
  progressEventReducer,
  progressEventDecorator,
  asyncDecorator,
} from '../../helpers/progressEventReducer';
import {
  brotliOptions,
  flushOnFinish,
  isBrotliSupported,
  isZstdSupported,
  scheduleProgress,
  zlibOptions,
  zstdOptions,
} from './shared';
import type { HttpContext } from './context';

// Builds the transport response callback: decompression, download progress,
// maxContentLength enforcement and body collection.
export function createResponseHandler(ctx: HttpContext): (res: any) => void {
  return function handleResponse(res: any) {
    const { config, resolve, reject, method, responseType, responseEncoding, decompress } = ctx;
    const { onDownloadProgress, maxDownloadRate, maxContentLength, abortEmitter } = ctx;
    const req = ctx.req;

    ctx.clearConnectPhaseTimer();

    if (req.destroyed) return;

    const streams: any[] = [res];

    const responseLength = utils.toFiniteNumber(res.headers['content-length']);

    if (onDownloadProgress || maxDownloadRate) {
      const transformStream = new AxiosTransformStream({
        maxRate: utils.toFiniteNumber(maxDownloadRate),
      });

      onDownloadProgress &&
        transformStream.on(
          'progress',
          flushOnFinish(
            transformStream,
            progressEventDecorator(
              responseLength,
              progressEventReducer(asyncDecorator(onDownloadProgress, scheduleProgress), true, 3)
            ) as any
          )
        );

      streams.push(transformStream);
    }

    // decompress the response body transparently if required
    let responseStream: any = res;

    // return the last request in case of redirects
    const lastRequest = res.req || req;

    // if decompress disabled we should not decompress
    if (decompress !== false && res.headers['content-encoding']) {
      // if no content, but headers still say that it is encoded,
      // remove the header not confuse downstream operations
      if (method === 'HEAD' || res.statusCode === 204) {
        delete res.headers['content-encoding'];
      }

      switch ((res.headers['content-encoding'] || '').toLowerCase()) {
        case 'gzip':
        case 'x-gzip':
        case 'compress':
        case 'x-compress':
          // add the unzipper to the body stream processing pipeline
          streams.push(zlib.createUnzip(zlibOptions));

          // remove the content-encoding so downstream operations are not confused
          delete res.headers['content-encoding'];
          break;
        case 'deflate':
          streams.push(new ZlibHeaderTransformStream());

          // add the unzipper to the body stream processing pipeline
          streams.push(zlib.createUnzip(zlibOptions));

          // remove the content-encoding so downstream operations are not confused
          delete res.headers['content-encoding'];
          break;
        case 'br':
          if (isBrotliSupported) {
            streams.push(zlib.createBrotliDecompress(brotliOptions));
            delete res.headers['content-encoding'];
          }
          break;
        case 'zstd':
          if (isZstdSupported) {
            streams.push((zlib as any).createZstdDecompress(zstdOptions));
            delete res.headers['content-encoding'];
          }
          break;
      }
    }

    responseStream =
      streams.length > 1 ? stream.pipeline(streams as any, utils.noop as any) : streams[0];

    const response: any = {
      status: res.statusCode,
      statusText: res.statusMessage,
      headers: new AxiosHeaders(res.headers),
      config,
      request: lastRequest,
    };

    if (responseType === 'stream') {
      // Enforce maxContentLength on streamed responses; before this it
      // was applied only to buffered responses.
      if (maxContentLength > -1) {
        const limit = maxContentLength;
        const source = responseStream;
        async function* enforceMaxContentLength() {
          let totalResponseBytes = 0;
          for await (const chunk of source) {
            totalResponseBytes += chunk.length;
            if (totalResponseBytes > limit) {
              throw new AxiosError(
                'maxContentLength size of ' + limit + ' exceeded',
                AxiosError.ERR_BAD_RESPONSE,
                config,
                lastRequest
              );
            }
            yield chunk;
          }
        }
        responseStream = stream.Readable.from(enforceMaxContentLength(), {
          objectMode: false,
        });
      }
      response.data = responseStream;
      settle(resolve, reject, response);
    } else {
      const responseBuffer: Buffer[] = [];
      let totalResponseBytes = 0;

      responseStream.on('data', function handleStreamData(chunk: Buffer) {
        responseBuffer.push(chunk);
        totalResponseBytes += chunk.length;

        // make sure the content length is not over the maxContentLength if specified
        if (maxContentLength > -1 && totalResponseBytes > maxContentLength) {
          // stream.destroy() emit aborted event before calling reject() on Node.js v16
          ctx.rejected = true;
          responseStream.destroy();
          ctx.abort(
            new AxiosError(
              'maxContentLength size of ' + maxContentLength + ' exceeded',
              AxiosError.ERR_BAD_RESPONSE,
              config,
              lastRequest
            )
          );
        }
      });

      responseStream.on('aborted', function handlerStreamAborted() {
        if (ctx.rejected) {
          return;
        }

        const err = new AxiosError(
          'stream has been aborted',
          AxiosError.ERR_BAD_RESPONSE,
          config,
          lastRequest,
          response
        );
        responseStream.destroy(err);
        reject(err);
      });

      responseStream.on('error', function handleStreamError(err: any) {
        if (ctx.rejected) return;
        reject(AxiosError.from(err, null as any, config, lastRequest, response));
      });

      responseStream.on('end', function handleStreamEnd() {
        try {
          let responseData: any =
            responseBuffer.length === 1 ? responseBuffer[0] : Buffer.concat(responseBuffer);
          if (responseType !== 'arraybuffer') {
            responseData = responseData.toString(responseEncoding);
            if (!responseEncoding || responseEncoding === 'utf8') {
              responseData = utils.stripBOM(responseData);
            }
          }
          response.data = responseData;
        } catch (err) {
          return reject(AxiosError.from(err, null as any, config, response.request, response));
        }
        settle(resolve, reject, response);
      });
    }

    abortEmitter.once('abort', (err: any) => {
      if (!responseStream.destroyed) {
        responseStream.emit('error', err);
        responseStream.destroy();
      }
    });
  };
}
