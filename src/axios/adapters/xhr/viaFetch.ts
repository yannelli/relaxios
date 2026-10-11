import utils from '../../utils';
import settle from '../../core/settle';
import transitionalDefaults from '../../defaults/transitional';
import AxiosError from '../../core/AxiosError';
import CanceledError from '../../cancel/CanceledError';
import parseProtocol from '../../helpers/parseProtocol';
import platform from '../../platform/index';
import AxiosHeaders from '../../core/AxiosHeaders';
import { progressEventReducer } from '../../helpers/progressEventReducer';
import { trackStream } from '../../helpers/trackStream';
import resolveConfig from '../../helpers/resolveConfig';
import { toByteStringHeaderObject } from '../../helpers/sanitizeHeaderValue';
import { DEFAULT_CHUNK_SIZE } from '../fetch/env';
import type { FetchEnv } from '../fetch/env';
import { sendRequest, createSendState } from '../fetch/send';
import { createXHRStandin } from './standin';
import { parseMime } from './decode';

// A real XHR hands onerror a ProgressEvent; a synthetic one cannot carry a target.
const progressEvent = (type: string, init?: ProgressEventInit) =>
  typeof ProgressEvent === 'function' ? new ProgressEvent(type, init) : null;

const isEncoded = (headers: any) => {
  const encoding = headers.get('content-encoding');
  return !!encoding && encoding.trim().toLowerCase() !== 'identity';
};

const ua = () => (typeof navigator === 'object' && navigator.userAgent) || '';
const isChromium = () => /Chrome\//.test(ua());
const isGecko = () => /Firefox\//.test(ua());

// Chromium and Gecko keep URL credentials in responseURL; WebKit strips them.
const keepsURLCredentials = () => isChromium() || !/AppleWebKit\//.test(ua());

// XHR rewrites a non-UTF-8 charset on text bodies to UTF-8; Chromium also re-serializes the case.
const fixBodyCharset = (contentType: string) =>
  contentType.replace(/(charset=)"?([^;"\s]+)"?/i, (match: string, prefix: string, value: string) =>
    value.toLowerCase() === 'utf-8' && !isChromium() ? match : prefix + 'UTF-8'
  );

// Without Content-Length, Resource Timing is the only source of the encoded size; it is
// exposed same-origin or with Timing-Allow-Origin, and is 0 otherwise.
const encodedBodySize = (url: string): number | undefined => {
  if (typeof performance !== 'object' || typeof performance.getEntriesByName !== 'function') return undefined;
  const entries = performance.getEntriesByName(url, 'resource') as any[];
  const size = entries.length ? entries[entries.length - 1].encodedBodySize : 0;
  return size > 0 ? size : undefined;
};

// XMLHttpRequest.send() accepts BodyInit values and stringifies everything else.
const toXHRBody = (data: any) => {
  if (data === null || typeof data === 'string') return data;
  if (
    (typeof Blob !== 'undefined' && data instanceof Blob) ||
    utils.isArrayBuffer(data) ||
    utils.isArrayBufferView(data) ||
    utils.isFormData(data) ||
    utils.isURLSearchParams(data)
  ) {
    return data;
  }
  if (typeof Document !== 'undefined' && data instanceof Document) {
    return new XMLSerializer().serializeToString(data);
  }
  return String(data);
};

// The XHR transport over fetch: same request shaping, errors and result shape as the
// XMLHttpRequest transport, with an XMLHttpRequest stand-in as `request`.
export default function fetchXhrRequest(env: FetchEnv, config: any): Promise<any> {
  return new Promise(function dispatchXhrRequest(resolve, reject) {
    const _config = resolveConfig(config);
    const requestData = _config.data;
    const requestHeaders = AxiosHeaders.from(_config.headers).normalize();
    const { responseType, onDownloadProgress } = _config;
    const method = String(_config.method).toUpperCase();
    const protocol = parseProtocol(_config.url);
    let onCanceled: any;
    let flushDownload: any;
    let timer: any;

    // An unsent XMLHttpRequest validates the URL, method, headers and options exactly
    // like the real transport would, and throws the engine's own exceptions.
    const probe = new XMLHttpRequest();
    probe.open(method, _config.url, true);
    probe.timeout = _config.timeout;

    const requestURL = new URL(_config.url, platform.origin);
    const hasURLCredentials = !!(requestURL.username || requestURL.password);
    const strippedURL = new URL(requestURL.href);
    strippedURL.username = '';
    strippedURL.password = '';

    const controller = new AbortController();
    const state = createSendState();
    state.composedSignal = controller.signal;

    let request: any;
    let standin: ReturnType<typeof createXHRStandin>;

    function done() {
      flushDownload && flushDownload(); // flush events

      _config.cancelToken && _config.cancelToken.unsubscribe(onCanceled);

      _config.signal && _config.signal.removeEventListener('abort', onCanceled);

      timer && clearTimeout(timer);
      timer = null;
    }

    // Handle timeout
    function handleTimeout() {
      if (!request) {
        return;
      }
      let timeoutErrorMessage = _config.timeout
        ? 'timeout of ' + _config.timeout + 'ms exceeded'
        : 'timeout exceeded';
      const transitional = _config.transitional || transitionalDefaults;
      if (_config.timeoutErrorMessage) {
        timeoutErrorMessage = _config.timeoutErrorMessage;
      }
      standin.fail();
      reject(
        new AxiosError(
          timeoutErrorMessage,
          transitional.clarifyTimeoutError ? AxiosError.ETIMEDOUT : AxiosError.ECONNABORTED,
          config,
          request
        )
      );
      done();
      request = null;
      controller.abort();
    }

    // Handle low level network errors
    function handleError() {
      standin.fail();
      const err: any = new AxiosError('Network Error', AxiosError.ERR_NETWORK, config, request);
      err.event = progressEvent('error');
      reject(err);
      done();
      request = null;
    }

    function handleFailure(err: any) {
      if (!request) {
        return;
      }
      if (err instanceof AxiosError) {
        !err.request && (err.request = request);
      } else if (err && err.name === 'TypeError' && state.request === null) {
        // Request construction failed: a real XHR throws from open()/setRequestHeader().
        err = new DOMException(err.message, 'SyntaxError');
      } else if (err && err.name === 'TypeError') {
        return handleError();
      } else {
        err = AxiosError.from(err, err && err.code, config, request);
      }
      reject(err);
      done();
      request = null;
    }

    async function run() {
      let response = await sendRequest(env, config, resolvedForFetch, state, true);

      if (!request) {
        return;
      }

      // Gecko's XHR exposes no Content-Length for data: URLs; its fetch does.
      if (isGecko() && protocol === 'data') {
        const headers = new Headers(response.headers);
        headers.delete('content-length');
        response = new env.Response(response.body, { status: response.status, statusText: response.statusText, headers });
      }

      // Gecko's fetch reports no url for data: responses; its XHR gives the data URL back.
      const keepCredentials = hasURLCredentials && keepsURLCredentials();
      standin.receive(
        response,
        keepCredentials && response.url === strippedURL.href
          ? requestURL.href
          : protocol === 'data' && !response.url
            ? requestURL.href
            : undefined
      );

      const nullBody = env.supportsResponseStream ? response.body == null : false;
      const mime = parseMime(response.headers.get('content-type'));
      const finalURL = response.url;
      let flushLoadend: (() => void) | undefined;

      if (onDownloadProgress && env.supportsResponseStream && response.body) {
        // Decoded bytes can exceed Content-Length, so an encoded body is not computable.
        const contentLength = utils.toFiniteNumber(response.headers.get('content-length'));
        const encoded = isEncoded(response.headers);
        // Gecko counts encoded bytes against Content-Length; fetch only sees decoded ones, so
        // the count is capped at Content-Length and reaches it on loadend.
        const encodedCap = encoded && isGecko() ? contentLength : undefined;
        const total = encoded && encodedCap == null ? undefined : contentLength;
        const lengthComputable = total != null;
        let last: ProgressEventInit = { lengthComputable, loaded: 0, total: total || 0 };

        const [downloadThrottled, flush, flushWithEvent] = progressEventReducer(
          onDownloadProgress,
          true
        );

        flushDownload = flush;
        flushLoadend = () => {
          const encodedSize = encodedCap != null ? encodedCap : encoded && isGecko() ? encodedBodySize(finalURL) : undefined;
          encodedSize != null && (last = { ...last, loaded: encodedSize });
          flushWithEvent(progressEvent('loadend', last));
        };

        response = new env.Response(
          trackStream(
            response.body,
            DEFAULT_CHUNK_SIZE,
            (loaded: number) => {
              encodedCap != null && (loaded = Math.min(loaded, encodedCap));
              last = { lengthComputable, loaded, total: total || 0 };
              downloadThrottled(progressEvent('progress', last));
            },
            () => flush()
          ),
          { status: response.status, statusText: response.statusText, headers: response.headers }
        );
      }

      standin.loading();

      // Chrome and Firefox type an XHR blob by the MIME essence (text/xml without a Content-Type).
      const buffer = await response.arrayBuffer();
      const body =
        request.responseType === 'blob'
          ? { blob: new Blob([buffer], { type: mime.essence }), nullBody }
          : { buffer, nullBody };

      if (!request) {
        return;
      }

      standin.load(body);

      // loadend gives progress listeners a final delivery with a live event.
      flushLoadend && flushLoadend();

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
      const result = {
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
        result
      );

      // Clean up request
      request = null;
    }

    // Remove Content-Type if data is undefined
    requestData === undefined && requestHeaders.setContentType(null);

    // Add headers to the request
    utils.forEach(toByteStringHeaderObject(requestHeaders), function setRequestHeader(val: any, key: string) {
      probe.setRequestHeader(key, val);
    });

    // Add withCredentials to request if needed
    if (!utils.isUndefined(_config.withCredentials)) {
      probe.withCredentials = !!_config.withCredentials;
    }

    // Add responseType to request if needed
    if (responseType && responseType !== 'json') {
      probe.responseType = _config.responseType;
    }

    const bodyForFetch = method === 'GET' || method === 'HEAD' ? null : toXHRBody(requestData || null);
    const contentType = requestHeaders.getContentType();
    if (contentType && (typeof bodyForFetch === 'string' || utils.isURLSearchParams(bodyForFetch))) {
      requestHeaders.setContentType(fixBodyCharset(String(contentType)), true);
    }

    standin = createXHRStandin({
      responseType: probe.responseType,
      timeout: probe.timeout,
      withCredentials: probe.withCredentials,
      probe,
      onAbort: () => controller.abort(),
    });
    request = standin.request;

    // What XMLHttpRequest cannot express is left out; cookies always go same-origin.
    const resolvedForFetch = Object.assign({}, _config, {
      headers: requestHeaders,
      data: bodyForFetch,
      withCredentials: probe.withCredentials ? 'include' : 'same-origin',
      signal: undefined,
      cancelToken: undefined,
      timeout: undefined,
      onUploadProgress: undefined,
      onDownloadProgress: undefined,
      fetchOptions: undefined,
      maxContentLength: undefined,
      maxBodyLength: undefined,
      maxRedirects: undefined,
    });

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

    if (!request) {
      return;
    }

    if (probe.timeout > 0) {
      timer = setTimeout(handleTimeout, probe.timeout);
    }

    // Send the request
    standin.start();
    run().catch(handleFailure);
  });
}
