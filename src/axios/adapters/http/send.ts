'use strict';

import stream from 'node:stream';
import utils from '../../utils';
import AxiosError from '../../core/AxiosError';
import CanceledError from '../../cancel/CanceledError';
import { handleSocketError, kAxiosCurrentReq, kAxiosSocketListener } from './shared';
import type { HttpContext } from './context';

// Wires abort, error, socket, close and timeout handling onto the created
// request. Returns false when the timeout option could not be parsed.
export function attachRequestHandlers(ctx: HttpContext): boolean {
  const { config, own, reject, abortEmitter, req, isNativeTransport, transitional } = ctx;

  abortEmitter.once('abort', (err: any) => {
    if (req.close) {
      req.close();
    } else {
      req.destroy(err);
    }
  });

  // Handle errors
  req.on('error', function handleRequestError(err: any) {
    reject(AxiosError.from(err, null as any, config, req));
  });

  // set tcp keep alive to prevent drop connection by peer
  // Track every socket bound to this outer request so one 'close' listener can
  // release ownership on all of them; follow-redirects re-emits 'socket' per hop.
  const boundSockets = new Set<any>();

  req.on('socket', function handleRequestSocket(socket: any) {
    // default interval of sending ack packet is 1 minute
    // proxy agents (e.g. agent-base) may return a generic Duplex stream
    // that doesn't have setKeepAlive, so guard before calling
    if (typeof socket.setKeepAlive === 'function') {
      socket.setKeepAlive(true, 1000 * 60);
    }

    // Install one shared 'error' listener per socket. The symbol follows the
    // currently-active request as pooled sockets are reassigned (issue #10780).
    if (!socket[kAxiosSocketListener]) {
      socket.on('error', handleSocketError);
      socket[kAxiosSocketListener] = true;
    }

    socket[kAxiosCurrentReq] = req;
    boundSockets.add(socket);
  });

  req.once('close', function clearCurrentReq() {
    ctx.clearConnectPhaseTimer();

    for (const socket of boundSockets) {
      if (socket[kAxiosCurrentReq] === req) {
        socket[kAxiosCurrentReq] = null;
      }
    }
    boundSockets.clear();
  });

  // Handle request timeout
  if (own('timeout')) {
    // This is forcing a int timeout to avoid problems if the `req` interface doesn't handle other types.
    const timeout = parseInt(own('timeout'), 10);

    if (Number.isNaN(timeout)) {
      ctx.abort(
        new AxiosError(
          'error trying to parse `config.timeout` to int',
          AxiosError.ERR_BAD_OPTION_VALUE,
          config,
          req
        )
      );

      return false;
    }

    const handleTimeout = function handleTimeout() {
      if (ctx.isDone) return;
      ctx.abort(ctx.createTimeoutError());
    };

    if (isNativeTransport && timeout > 0) {
      // Native ClientRequest#setTimeout starts from the socket lifecycle and
      // may not fire while TCP connect is still pending. Mirror the
      // follow-redirects wall-clock timer for the maxRedirects === 0 path.
      ctx.connectPhaseTimer = setTimeout(handleTimeout, timeout);
    }

    // A slow response may never fire 'connect', and aborting before connection
    // gives "socket hang up" (ECONNRESET) and leaks sockets under load.
    // ClientRequest.setTimeout makes sure abort() fires only after connect.
    req.setTimeout(timeout, handleTimeout);
  } else {
    // explicitly reset the socket timeout value for a possible `keep-alive` request
    req.setTimeout(0);
  }

  void transitional;
  return true;
}

// Writes the request body: pipes streams (with maxBodyLength enforcement where
// the transport does not apply it) or writes the buffer and ends the request.
export function sendRequestBody(ctx: HttpContext): void {
  const { config, req, data, maxBodyLength, transportEnforcesMaxBodyLength } = ctx;

  if (utils.isStream(data)) {
    let ended = false;
    let errored = false;

    data.on('end', () => {
      ended = true;
    });

    data.once('error', (err: any) => {
      errored = true;
      req.destroy(err);
    });

    data.on('close', () => {
      if (!ended && !errored) {
        ctx.abort(new CanceledError('Request stream has been aborted', config, req));
      }
    });

    // Enforce maxBodyLength for streamed uploads on every transport that
    // does not apply options.maxBodyLength itself (native http/https, http2,
    // and user-supplied custom transports).
    let uploadStream: any = data;
    if (maxBodyLength > -1 && !transportEnforcesMaxBodyLength) {
      const limit = maxBodyLength;
      let bytesSent = 0;
      uploadStream = stream.pipeline(
        [
          data,
          new stream.Transform({
            transform(chunk: any, _enc: any, cb: (err?: any, chunk?: any) => void) {
              bytesSent += chunk.length;
              if (bytesSent > limit) {
                return cb(
                  new AxiosError(
                    'Request body larger than maxBodyLength limit',
                    AxiosError.ERR_BAD_REQUEST,
                    config,
                    req
                  )
                );
              }
              cb(null, chunk);
            },
          }),
        ] as any,
        utils.noop as any
      );
      uploadStream.on('error', (err: any) => {
        if (!req.destroyed) req.destroy(err);
      });
    }

    uploadStream.pipe(req);
  } else {
    data && req.write(data);
    req.end();
  }
}
