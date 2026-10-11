import utils from '../../utils';
import settle from '../../core/settle';
import transitionalDefaults from '../../defaults/transitional';
import AxiosError from '../../core/AxiosError';
import CanceledError from '../../cancel/CanceledError';
import normalizeURLForProtocolCheck from '../../helpers/normalizeURLForProtocolCheck';
import parseProtocol from '../../helpers/parseProtocol';
import platform from '../../platform/index';
import AxiosHeaders from '../../core/AxiosHeaders';
import { progressEventReducer } from '../../helpers/progressEventReducer';
import resolveConfig from '../../helpers/resolveConfig';
import { toByteStringHeaderObject } from '../../helpers/sanitizeHeaderValue';

// The real XMLHttpRequest transport: a line-for-line port of axios's lib/adapters/xhr.js.
export default function nativeXhrRequest(config: any): Promise<any> {
  return new Promise(function dispatchXhrRequest(resolve, reject) {
    const _config = resolveConfig(config);
    const requestData = _config.data;
    const requestHeaders = AxiosHeaders.from(_config.headers).normalize();
    const { responseType, onUploadProgress, onDownloadProgress } = _config;
    let onCanceled: any;
    let uploadThrottled: any, downloadThrottled: any;
    let flushUpload: any, flushDownload: any, flushDownloadWithEvent: any;

    function done() {
      flushUpload && flushUpload(); // flush events
      flushDownload && flushDownload(); // flush events

      _config.cancelToken && _config.cancelToken.unsubscribe(onCanceled);

      _config.signal && _config.signal.removeEventListener('abort', onCanceled);
    }

    let request: any = new XMLHttpRequest();

    request.open(_config.method.toUpperCase(), _config.url, true);

    // Set the request timeout in MS
    request.timeout = _config.timeout;

    function onloadend(event?: any) {
      if (!request) {
        return;
      }

      // Status 0 is a request that never got a response. Firefox 152 fires only
      // readystatechange and loadend for navigation-canceled requests (bugzilla 1505389),
      // so reject before settle() resolves them. Reads over file: may report 0 on success.
      if (
        request.status === 0 &&
        (parseProtocol(normalizeURLForProtocolCheck(_config.url)) ||
          parseProtocol(platform.origin)) !== 'file' &&
        !(request.responseURL && request.responseURL.startsWith('file:'))
      ) {
        reject(new AxiosError('Request aborted', AxiosError.ECONNABORTED, config, request));
        done();

        // Clean up request
        request = null;
        return;
      }

      // Flush with the live loadend event when there is one; the ready-state fallback has
      // none, so replay the pending progress. A throwing listener must not block settlement.
      try {
        if (event) {
          flushDownloadWithEvent && flushDownloadWithEvent(event);
        } else {
          flushDownload && flushDownload();
        }
      } catch (err) {
        setTimeout(() => {
          throw err;
        });
      }

      // A final progress callback can cancel the request synchronously.
      if (!request) {
        return;
      }

      // Prepare the response
      const responseHeaders = AxiosHeaders.from(
        'getAllResponseHeaders' in request && request.getAllResponseHeaders()
      );
      const responseData =
        !responseType || responseType === 'text' || responseType === 'json'
          ? request.responseText
          : request.response;
      const response = {
        data: responseData,
        status: request.status,
        statusText: request.statusText,
        headers: responseHeaders,
        config,
        request,
      };

      settle(
        function _resolve(value: any) {
          resolve(value);
          done();
        },
        function _reject(err: any) {
          reject(err);
          done();
        },
        response
      );

      // Clean up request
      request = null;
    }

    if ('onloadend' in request) {
      // Use onloadend if available
      request.onloadend = onloadend;
    } else {
      // Listen for ready state to emulate onloadend
      request.onreadystatechange = function handleLoad() {
        if (!request || request.readyState !== 4) {
          return;
        }

        // Status 0 without a response is handled by onerror, except over file:,
        // where most browsers report 0 for a successful request.
        if (
          request.status === 0 &&
          !(request.responseURL && request.responseURL.startsWith('file:'))
        ) {
          return;
        }
        // readystate fires before onerror or ontimeout, so run onloadend on the next tick
        setTimeout(onloadend);
      };
    }

    // Handle browser request cancellation (as opposed to a manual cancellation)
    request.onabort = function handleAbort() {
      if (!request) {
        return;
      }

      reject(new AxiosError('Request aborted', AxiosError.ECONNABORTED, config, request));
      done();

      // Clean up request
      request = null;
    };

    // Handle low level network errors
    request.onerror = function handleError(event: any) {
      // Browsers deliver a ProgressEvent in XHR onerror; surface a message when present.
      const msg = event && event.message ? event.message : 'Network Error';
      const err: any = new AxiosError(msg, AxiosError.ERR_NETWORK, config, request);
      // attach the underlying event for consumers who want details
      err.event = event || null;
      reject(err);
      done();
      request = null;
    };

    // Handle timeout
    request.ontimeout = function handleTimeout() {
      let timeoutErrorMessage = _config.timeout
        ? 'timeout of ' + _config.timeout + 'ms exceeded'
        : 'timeout exceeded';
      const transitional = _config.transitional || transitionalDefaults;
      if (_config.timeoutErrorMessage) {
        timeoutErrorMessage = _config.timeoutErrorMessage;
      }
      reject(
        new AxiosError(
          timeoutErrorMessage,
          transitional.clarifyTimeoutError ? AxiosError.ETIMEDOUT : AxiosError.ECONNABORTED,
          config,
          request
        )
      );
      done();

      // Clean up request
      request = null;
    };

    // Remove Content-Type if data is undefined
    requestData === undefined && requestHeaders.setContentType(null);

    // Add headers to the request
    if ('setRequestHeader' in request) {
      utils.forEach(
        toByteStringHeaderObject(requestHeaders),
        function setRequestHeader(val: any, key: string) {
          request.setRequestHeader(key, val);
        }
      );
    }

    // Add withCredentials to request if needed
    if (!utils.isUndefined(_config.withCredentials)) {
      request.withCredentials = !!_config.withCredentials;
    }

    // Add responseType to request if needed
    if (responseType && responseType !== 'json') {
      request.responseType = _config.responseType;
    }

    // Handle progress if needed
    if (onDownloadProgress) {
      [downloadThrottled, flushDownload, flushDownloadWithEvent] = progressEventReducer(
        onDownloadProgress,
        true
      );
      request.addEventListener('progress', downloadThrottled);
    }

    // Not all browsers support upload events
    if (onUploadProgress && request.upload) {
      [uploadThrottled, flushUpload] = progressEventReducer(onUploadProgress);

      request.upload.addEventListener('progress', uploadThrottled);

      request.upload.addEventListener('loadend', flushUpload);
    }

    if (_config.cancelToken || _config.signal) {
      // Handle cancellation
      onCanceled = (cancel?: any) => {
        if (!request) {
          return;
        }
        reject(!cancel || cancel.type ? new CanceledError(null, config, request) : cancel);
        request.abort();
        done();
        request = null;
      };

      _config.cancelToken && _config.cancelToken.subscribe(onCanceled);
      if (_config.signal) {
        _config.signal.aborted
          ? onCanceled()
          : _config.signal.addEventListener('abort', onCanceled);
      }
    }

    const protocol = parseProtocol(_config.url);

    if (protocol && !platform.protocols.includes(protocol)) {
      reject(
        new AxiosError(
          'Unsupported protocol ' + protocol + ':',
          AxiosError.ERR_BAD_REQUEST,
          config
        )
      );
      done();
      return;
    }

    // Send the request
    request.send(requestData || null);
  });
}
