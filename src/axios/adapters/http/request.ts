'use strict';

import { EventEmitter } from 'node:events';
import stream from 'node:stream';
import { resolve as resolvePath } from 'node:path';
import utils from '../../utils';
import buildFullPath from '../../core/buildFullPath';
import buildURL from '../../helpers/buildURL';
import { VERSION } from '../../env/data';
import transitionalDefaults from '../../defaults/transitional';
import AxiosError from '../../core/AxiosError';
import CanceledError from '../../cancel/CanceledError';
import platform from '../../platform/index';
import AxiosHeaders from '../../core/AxiosHeaders';
import { toByteStringHeaderObject } from '../../helpers/sanitizeHeaderValue';
import { normalizeLookup } from './lookup';
import { setProxy } from './proxy';
import { dispatchBeforeRedirect } from './redirects';
import { handleDataURL } from './dataUri';
import { prepareRequestBody } from './body';
import { selectTransport } from './transport';
import { createResponseHandler } from './response';
import { attachRequestHandlers, sendRequestBody } from './send';
import {
  ACCEPT_ENCODING,
  ACCEPT_ENCODING_WITH_ZSTD,
  decodeURIComponentSafe,
  supportedProtocols,
} from './shared';
import type { OnDoneHandler } from './shared';
import type { HttpContext } from './context';

export default async function dispatchHttpRequest(
  config: any,
  resolve: (value: any) => void,
  reject: (reason: any) => void,
  onDone: (handler: OnDoneHandler) => void
): Promise<void> {
  // Read config pollution-safely: own properties and members inherited from a
  // non-Object.prototype source are honored, but values injected onto a
  // polluted Object.prototype are ignored. All behavior-affecting reads use own().
  const own = (key: string) => utils.getSafeProp(config, key);
  const transitional = own('transitional') || transitionalDefaults;
  const data = own('data');
  let lookup = own('lookup');
  const family = own('family');
  let httpVersion = own('httpVersion');
  if (httpVersion === undefined) httpVersion = 1;
  const rawHttpVersion = httpVersion;
  let http2Options = own('http2Options');
  const httpAgent = own('httpAgent');
  const httpsAgent = own('httpsAgent');
  const configProxy = own('proxy');
  const responseType = own('responseType');
  const responseEncoding = own('responseEncoding');
  const socketPath = own('socketPath');
  const method = own('method').toUpperCase();
  const maxRedirects = own('maxRedirects');
  const maxBodyLength = own('maxBodyLength');
  const maxContentLength = own('maxContentLength');
  const decompress = own('decompress');

  try {
    httpVersion = +httpVersion;
  } catch (err) {
    throw new AxiosError(
      'Invalid protocol version: value is not a number',
      AxiosError.ERR_BAD_OPTION_VALUE,
      config
    );
  }

  if (Number.isNaN(httpVersion)) {
    throw new AxiosError(
      `Invalid protocol version: '${rawHttpVersion}' is not a number`,
      AxiosError.ERR_BAD_OPTION_VALUE,
      config
    );
  }

  if (httpVersion !== 1 && httpVersion !== 2) {
    throw new AxiosError(
      `Unsupported protocol version '${httpVersion}'`,
      AxiosError.ERR_BAD_OPTION_VALUE,
      config
    );
  }

  const isHttp2 = httpVersion === 2;

  if (lookup) {
    lookup = normalizeLookup(lookup);
  }

  const abortEmitter = new EventEmitter();

  const ctx: HttpContext = {
    config,
    own,
    transitional,
    resolve,
    reject,
    data,
    lookup,
    family,
    http2Options,
    httpAgent,
    httpsAgent,
    configProxy,
    responseType,
    responseEncoding,
    socketPath,
    method,
    maxRedirects,
    maxBodyLength,
    maxContentLength,
    decompress,
    isHttp2,
    isDone: false,
    rejected: false,
    req: undefined,
    connectPhaseTimer: undefined,
    abortEmitter,
    abort,
    clearConnectPhaseTimer,
    createTimeoutError,
    fullPath: '',
    parsed: undefined as any,
    protocol: '',
    headers: undefined,
    onUploadProgress: undefined,
    onDownloadProgress: undefined,
    maxRate: undefined,
    maxUploadRate: undefined,
    maxDownloadRate: undefined,
    auth: undefined,
    path: '',
    options: undefined,
    proxyApplied: false,
    transport: undefined,
    isNativeTransport: false,
    transportEnforcesMaxBodyLength: false,
    isHttpsRequest: false,
  };

  function abort(reason?: any) {
    try {
      abortEmitter.emit(
        'abort',
        !reason || reason.type ? new CanceledError(null as any, config, ctx.req) : reason
      );
    } catch (err) {
      // ignore emit errors
    }
  }

  function clearConnectPhaseTimer() {
    if (ctx.connectPhaseTimer) {
      clearTimeout(ctx.connectPhaseTimer);
      ctx.connectPhaseTimer = null;
    }
  }

  function createTimeoutError() {
    const configTimeout = own('timeout');
    let timeoutErrorMessage = configTimeout
      ? 'timeout of ' + configTimeout + 'ms exceeded'
      : 'timeout exceeded';
    const configTimeoutErrorMessage = own('timeoutErrorMessage');
    if (configTimeoutErrorMessage) {
      timeoutErrorMessage = configTimeoutErrorMessage;
    }
    return new AxiosError(
      timeoutErrorMessage,
      transitional.clarifyTimeoutError ? AxiosError.ETIMEDOUT : AxiosError.ECONNABORTED,
      config,
      ctx.req
    );
  }

  abortEmitter.once('abort', reject);

  const onFinished = () => {
    clearConnectPhaseTimer();

    if (config.cancelToken) {
      config.cancelToken.unsubscribe(abort);
    }

    if (config.signal) {
      config.signal.removeEventListener('abort', abort);
    }

    abortEmitter.removeAllListeners();
  };

  if (config.cancelToken || config.signal) {
    config.cancelToken && config.cancelToken.subscribe(abort);
    if (config.signal) {
      config.signal.aborted ? abort() : config.signal.addEventListener('abort', abort);
    }
  }

  onDone((response: any, isRejected?: boolean) => {
    ctx.isDone = true;
    clearConnectPhaseTimer();

    if (isRejected) {
      ctx.rejected = true;
      onFinished();
      return;
    }

    const { data } = response;

    if (data instanceof stream.Readable || data instanceof stream.Duplex) {
      const offListeners = stream.finished(data, () => {
        offListeners();
        onFinished();
      });
    } else {
      onFinished();
    }
  });

  // Parse url
  const fullPath = buildFullPath(own('baseURL'), own('url'), own('allowAbsoluteUrls'), config);
  // Unix-socket requests (own socketPath) commonly pass a path-only url like
  // '/foo'; supply a synthetic base so new URL() can still parse it. Use the
  // own-property value so a polluted prototype cannot influence base selection.
  const urlBase = socketPath
    ? 'http://localhost'
    : platform.hasBrowserEnv
      ? platform.origin
      : undefined;
  const parsed = new URL(fullPath, urlBase);
  const protocol = parsed.protocol || supportedProtocols[0];

  ctx.fullPath = fullPath;
  ctx.parsed = parsed;
  ctx.protocol = protocol;

  if (protocol === 'data:') {
    handleDataURL(ctx);
    return;
  }

  if (supportedProtocols.indexOf(protocol) === -1) {
    return reject(
      new AxiosError('Unsupported protocol ' + protocol, AxiosError.ERR_BAD_REQUEST, config)
    );
  }

  const headers: any = AxiosHeaders.from(config.headers).normalize();

  // Set User-Agent (required by some servers); only when not set in config.
  // See https://github.com/axios/axios/issues/69
  headers.set('User-Agent', 'axios/' + VERSION, false);

  const { onUploadProgress, onDownloadProgress } = config;
  const maxRate = config.maxRate;

  ctx.headers = headers;
  ctx.onUploadProgress = onUploadProgress;
  ctx.onDownloadProgress = onDownloadProgress;
  ctx.maxRate = maxRate;

  if (!(await prepareRequestBody(ctx))) {
    return;
  }

  // HTTP basic authentication
  let auth: any = undefined;
  const configAuth = own('auth');
  if (configAuth) {
    const username = utils.getSafeProp(configAuth, 'username') || '';
    const password = utils.getSafeProp(configAuth, 'password') || '';
    auth = username + ':' + password;
  }

  if (!auth && (parsed.username || parsed.password)) {
    const urlUsername = decodeURIComponentSafe(parsed.username);
    const urlPassword = decodeURIComponentSafe(parsed.password);
    auth = urlUsername + ':' + urlPassword;
  }

  auth && headers.delete('authorization');

  let path: string;

  try {
    path = buildURL(parsed.pathname + parsed.search, own('params'), own('paramsSerializer')).replace(
      /^\?/,
      ''
    );
  } catch (err) {
    return reject(
      AxiosError.from(err, AxiosError.ERR_BAD_REQUEST, config, null, null, {
        url: own('url'),
        exists: true,
      })
    );
  }

  headers.set(
    'Accept-Encoding',
    utils.hasOwnProp(transitional, 'advertiseZstdAcceptEncoding') &&
      transitional.advertiseZstdAcceptEncoding === true
      ? ACCEPT_ENCODING_WITH_ZSTD
      : ACCEPT_ENCODING,
    false
  );

  if (isHttp2 && lookup) {
    http2Options = Object.assign(Object.create(null), http2Options, { lookup });
  }

  // Null-prototype to block prototype pollution gadgets on properties read
  // directly by Node's http.request (e.g. insecureHTTPParser, lookup).
  const options: any = Object.assign(Object.create(null), {
    path,
    method: method,
    headers: toByteStringHeaderObject(headers),
    agents: { http: httpAgent, https: httpsAgent },
    auth,
    protocol,
    family,
    beforeRedirect: dispatchBeforeRedirect,
    beforeRedirects: Object.create(null),
    http2Options,
    createConnection: undefined,
  });

  // cacheable-lookup integration hotfix
  !utils.isUndefined(lookup) && (options.lookup = lookup);

  let proxyApplied = false;

  if (socketPath) {
    if (typeof socketPath !== 'string') {
      return reject(
        new AxiosError('socketPath must be a string', AxiosError.ERR_BAD_OPTION_VALUE, config)
      );
    }

    const allowedSocketPaths = own('allowedSocketPaths');
    if (allowedSocketPaths != null) {
      const allowed = Array.isArray(allowedSocketPaths) ? allowedSocketPaths : [allowedSocketPaths];

      const resolvedSocket = resolvePath(socketPath);
      const isAllowed = allowed.some(
        (entry: any) => typeof entry === 'string' && resolvePath(entry) === resolvedSocket
      );

      if (!isAllowed) {
        return reject(
          new AxiosError(
            `socketPath "${socketPath}" is not permitted by allowedSocketPaths`,
            AxiosError.ERR_BAD_OPTION_VALUE,
            config
          )
        );
      }
    }

    options.socketPath = socketPath;
  } else {
    options.hostname = parsed.hostname.startsWith('[')
      ? parsed.hostname.slice(1, -1)
      : parsed.hostname;
    options.port = parsed.port;
    proxyApplied = setProxy(
      options,
      configProxy,
      protocol + '//' + parsed.hostname + (parsed.port ? ':' + parsed.port : '') + options.path,
      false,
      httpsAgent,
      httpAgent,
      // The HTTP/2 transport connects independently of HTTP/1 agents, so it
      // cannot apply either axios-resolved or agent-local environment proxies.
      // Explicit proxy config is still processed and rejected below.
      !isHttp2
    );
  }

  ctx.auth = auth;
  ctx.path = path;
  ctx.options = options;
  ctx.proxyApplied = proxyApplied;

  if (!selectTransport(ctx)) {
    return;
  }

  // Set an explicit maxBodyLength option for transports that read it.
  // When maxBodyLength is -1 (default/unlimited), use Infinity so
  // follow-redirects does not fall back to its own 10MB default.
  if (maxBodyLength > -1) {
    options.maxBodyLength = maxBodyLength;
  } else {
    options.maxBodyLength = Infinity;
  }

  // Always set an explicit own value so a polluted
  // Object.prototype.insecureHTTPParser cannot enable the lenient parser
  // through Node's internal options copy
  options.insecureHTTPParser = Boolean(own('insecureHTTPParser'));

  // Create the request
  ctx.req = ctx.transport.request(options, createResponseHandler(ctx));

  if (!attachRequestHandlers(ctx)) {
    return;
  }

  // Send the request
  sendRequestBody(ctx);
}
