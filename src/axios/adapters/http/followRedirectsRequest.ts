'use strict';

// RedirectableRequest from follow-redirects 1.16.1: a Writable wrapping the
// current native ClientRequest and re-issuing it on 3xx responses.

import url from 'node:url';
import { Writable } from 'node:stream';
import {
  MaxBodyLengthExceededError,
  RedirectionError,
  TooManyRedirectsError,
  WriteAfterEndError,
  destroyRequest,
  escapeRegex,
  eventHandlers,
  events,
  isArray,
  isBuffer,
  isFunction,
  isString,
  isSubdomain,
  parseUrl,
  removeMatchingHeaders,
  resolveUrl,
  sensitiveHeaders,
  spreadUrlObject,
} from './followRedirectsUtils';

class RedirectableRequest extends Writable {
  _options: any;
  _ended: boolean;
  _ending: boolean;
  _redirectCount: number;
  _redirects: any[];
  _requestBodyLength: number;
  _requestBodyBuffers: Array<{ data: any; encoding: any }>;
  _onNativeResponse: (response: any) => void;
  _headerFilter: RegExp;
  _currentRequest: any;
  _currentUrl: string;
  _isRedirect: boolean | undefined;
  _timeout: any;

  constructor(options: any, responseCallback?: (response: any) => void) {
    super();
    this._sanitizeOptions(options);
    this._options = options;
    this._ended = false;
    this._ending = false;
    this._redirectCount = 0;
    this._redirects = [];
    this._requestBodyLength = 0;
    this._requestBodyBuffers = [];
    this._currentUrl = '';

    // Attach a callback if passed
    if (responseCallback) {
      this.on('response', responseCallback);
    }

    // React to responses of native requests
    const self = this;
    this._onNativeResponse = function (response: any) {
      try {
        self._processResponse(response);
      } catch (cause: any) {
        self.emit(
          'error',
          cause instanceof RedirectionError ? cause : new RedirectionError({ cause: cause })
        );
      }
    };

    // Create filter for sensitive HTTP headers
    this._headerFilter = new RegExp(
      '^(?:' + sensitiveHeaders.concat(options.sensitiveHeaders).map(escapeRegex).join('|') + ')$',
      'i'
    );

    // Send the first request
    this._performRequest();
  }

  abort(): void {
    destroyRequest(this._currentRequest);
    this._currentRequest.abort();
    this.emit('abort');
  }

  destroy(error?: any): this {
    destroyRequest(this._currentRequest, error);
    super.destroy(error);
    return this;
  }

  // Writes buffered data to the current native request
  write(data: any, encoding?: any, callback?: any): any {
    // Writing is not allowed if end has been called
    if (this._ending) {
      throw new WriteAfterEndError();
    }

    // Validate input and shift parameters if necessary
    if (!isString(data) && !isBuffer(data)) {
      throw new TypeError('data should be a string, Buffer or Uint8Array');
    }
    if (isFunction(encoding)) {
      callback = encoding;
      encoding = null;
    }

    // Ignore empty buffers, since writing them doesn't invoke the callback
    // https://github.com/nodejs/node/issues/22066
    if (data.length === 0) {
      if (callback) {
        callback();
      }
      return;
    }
    // Only write when we don't exceed the maximum body length
    if (this._requestBodyLength + data.length <= this._options.maxBodyLength) {
      this._requestBodyLength += data.length;
      this._requestBodyBuffers.push({ data: data, encoding: encoding });
      this._currentRequest.write(data, encoding, callback);
    }
    // Error when we exceed the maximum body length
    else {
      this.emit('error', new MaxBodyLengthExceededError());
      this.abort();
    }
  }

  // Ends the current native request
  end(data?: any, encoding?: any, callback?: any): this {
    // Shift parameters if necessary
    if (isFunction(data)) {
      callback = data;
      data = encoding = null;
    } else if (isFunction(encoding)) {
      callback = encoding;
      encoding = null;
    }

    // Write data if needed and end
    if (!data) {
      this._ended = this._ending = true;
      this._currentRequest.end(null, null, callback);
    } else {
      const self = this;
      const currentRequest = this._currentRequest;
      this.write(data, encoding, function () {
        self._ended = true;
        currentRequest.end(null, null, callback);
      });
      this._ending = true;
    }
    return this;
  }

  // Sets a header value on the current native request
  setHeader(name: string, value: any): void {
    this._options.headers[name] = value;
    this._currentRequest.setHeader(name, value);
  }

  // Clears a header value on the current native request
  removeHeader(name: string): void {
    delete this._options.headers[name];
    this._currentRequest.removeHeader(name);
  }

  // Global timeout for all underlying requests
  setTimeout(msecs: number, callback?: () => void): this {
    const self = this;

    // Destroys the socket on timeout
    function destroyOnTimeout(socket: any) {
      socket.setTimeout(msecs);
      socket.removeListener('timeout', socket.destroy);
      socket.addListener('timeout', socket.destroy);
    }

    // Sets up a timer to trigger a timeout event
    function startTimer(socket: any) {
      if (self._timeout) {
        clearTimeout(self._timeout);
      }
      self._timeout = setTimeout(function () {
        self.emit('timeout');
        clearTimer();
      }, msecs);
      destroyOnTimeout(socket);
    }

    // Stops a timeout from triggering
    function clearTimer() {
      // Clear the timeout
      if (self._timeout) {
        clearTimeout(self._timeout);
        self._timeout = null;
      }

      // Clean up all attached listeners
      self.removeListener('abort', clearTimer);
      self.removeListener('error', clearTimer);
      self.removeListener('response', clearTimer);
      self.removeListener('close', clearTimer);
      if (callback) {
        self.removeListener('timeout', callback);
      }
      if (!self.socket) {
        self._currentRequest.removeListener('socket', startTimer);
      }
    }

    // Attach callback if passed
    if (callback) {
      this.on('timeout', callback);
    }

    // Start the timer if or when the socket is opened
    if (this.socket) {
      startTimer(this.socket);
    } else {
      this._currentRequest.once('socket', startTimer);
    }

    // Clean up on events
    this.on('socket', destroyOnTimeout);
    this.on('abort', clearTimer);
    this.on('error', clearTimer);
    this.on('response', clearTimer);
    this.on('close', clearTimer);

    return this;
  }

  // Proxy all other public ClientRequest methods
  flushHeaders(a?: any, b?: any): any {
    return this._currentRequest.flushHeaders(a, b);
  }
  getHeader(a?: any, b?: any): any {
    return this._currentRequest.getHeader(a, b);
  }
  setNoDelay(a?: any, b?: any): any {
    return this._currentRequest.setNoDelay(a, b);
  }
  setSocketKeepAlive(a?: any, b?: any): any {
    return this._currentRequest.setSocketKeepAlive(a, b);
  }

  // Proxy all public ClientRequest properties
  get aborted(): any {
    return this._currentRequest.aborted;
  }
  get connection(): any {
    return this._currentRequest.connection;
  }
  get socket(): any {
    return this._currentRequest.socket;
  }

  _sanitizeOptions(options: any): void {
    // Headers must always be present
    if (!options.headers) {
      options.headers = {};
    }
    // Convert [header1, value1, header2, value2, ...] to object
    else if (Array.isArray(options.headers)) {
      const headerList = options.headers;
      options.headers = {};
      for (let i = 0; i < headerList.length; i += 2) {
        options.headers[headerList[i]] = headerList[i + 1];
      }
    }
    // Sensitive headers must always be present
    if (!isArray(options.sensitiveHeaders)) {
      options.sensitiveHeaders = [];
    }

    // http.request treats host as an alias of hostname, but the url module
    // reads host as hostname plus port, so drop host to avoid confusion.
    if (options.host) {
      // Use hostname if set, because it has precedence
      if (!options.hostname) {
        options.hostname = options.host;
      }
      delete options.host;
    }

    // Complete the URL object when necessary
    if (!options.pathname && options.path) {
      const searchPos = options.path.indexOf('?');
      if (searchPos < 0) {
        options.pathname = options.path;
      } else {
        options.pathname = options.path.substring(0, searchPos);
        options.search = options.path.substring(searchPos);
      }
    }
  }

  // Executes the next native request (first or redirect)
  _performRequest(): void {
    // Load the native protocol
    const protocol = this._options.protocol;
    const nativeProtocol = this._options.nativeProtocols[protocol];
    if (!nativeProtocol) {
      throw new TypeError('Unsupported protocol ' + protocol);
    }

    // If specified, use the agent corresponding to the protocol
    // (HTTP and HTTPS use different types of agents)
    if (this._options.agents) {
      const scheme = protocol.slice(0, -1);
      this._options.agent = this._options.agents[scheme];
    }

    // Create the native request and set up its event handlers
    const request = (this._currentRequest = nativeProtocol.request(
      this._options,
      this._onNativeResponse
    ));
    request._redirectable = this;
    for (const event of events) {
      request.on(event, eventHandlers[event]);
    }

    // RFC7230 5.3.1: a request to an origin server carries only the absolute
    // path; a request to a proxy carries the target URI in absolute-form.
    this._currentUrl = /^\//.test(this._options.path)
      ? url.format(this._options)
      : this._options.path;

    // End a redirected request
    // (The first request must be ended explicitly with RedirectableRequest#end)
    if (this._isRedirect) {
      // Write the request entity and end
      let i = 0;
      const self = this;
      const buffers = this._requestBodyBuffers;
      (function writeNext(error?: any) {
        // Only write if this request has not been redirected yet
        if (request === self._currentRequest) {
          // Report any write errors
          if (error) {
            self.emit('error', error);
          }
          // Write the next buffer if there are still left
          else if (i < buffers.length) {
            const buffer = buffers[i++];
            if (!request.finished) {
              request.write(buffer.data, buffer.encoding, writeNext);
            }
          }
          // End the request if `end` has been called on us
          else if (self._ended) {
            request.end();
          }
        }
      })();
    }
  }

  // Processes a response from the current native request
  _processResponse(response: any): void {
    // Store the redirected response
    const statusCode = response.statusCode;
    if (this._options.trackRedirects) {
      this._redirects.push({
        url: this._currentUrl,
        headers: response.headers,
        statusCode: statusCode,
      });
    }

    // RFC7231 6.4: the user agent MAY automatically redirect its request to the
    // URI referenced by the Location field value, even if the status code is
    // not understood. If the response is not a redirect, return it as-is.
    const location = response.headers.location;
    if (
      !location ||
      this._options.followRedirects === false ||
      statusCode < 300 ||
      statusCode >= 400
    ) {
      response.responseUrl = this._currentUrl;
      response.redirects = this._redirects;
      this.emit('response', response);
      this._requestBodyBuffers = [];
      return;
    }

    // The response is a redirect, so abort the current request
    destroyRequest(this._currentRequest);
    // Discard the rest of the response to avoid waiting for data
    response.destroy();

    // RFC7231 6.4: A client SHOULD detect and intervene in cyclical redirections
    if (++this._redirectCount > this._options.maxRedirects) {
      throw new TooManyRedirectsError();
    }

    // Store the request headers if applicable
    let requestHeaders: any;
    const beforeRedirect = this._options.beforeRedirect;
    if (beforeRedirect) {
      requestHeaders = Object.assign(
        {
          // The Host header was set by nativeProtocol.request
          Host: response.req.getHeader('host'),
        },
        this._options.headers
      );
    }

    // RFC7231 6.4.2-3: a user agent MAY change the method from POST to GET on
    // 301/302. RFC7231 6.4.4: 303 asks for a retrieval request (GET or HEAD).
    const method = this._options.method;
    if (
      ((statusCode === 301 || statusCode === 302) && this._options.method === 'POST') ||
      (statusCode === 303 && !/^(?:GET|HEAD)$/.test(this._options.method))
    ) {
      this._options.method = 'GET';
      // Drop a possible entity and headers related to it
      this._requestBodyBuffers = [];
      removeMatchingHeaders(/^content-/i, this._options.headers);
    }

    // Drop the Host header, as the redirect might lead to a different host
    const currentHostHeader = removeMatchingHeaders(/^host$/i, this._options.headers);

    // If the redirect is relative, carry over the host of the last request
    const currentUrlParts = parseUrl(this._currentUrl);
    const currentHost = currentHostHeader || currentUrlParts.host;
    const currentUrl = /^\w+:/.test(location)
      ? this._currentUrl
      : url.format(Object.assign(currentUrlParts, { host: currentHost }));

    // Create the redirected request
    const redirectUrl = resolveUrl(location, currentUrl);
    this._isRedirect = true;
    spreadUrlObject(redirectUrl, this._options);

    // Drop confidential headers when redirecting to a less secure protocol
    // or to a different domain that is not a superdomain
    if (
      (redirectUrl.protocol !== currentUrlParts.protocol && redirectUrl.protocol !== 'https:') ||
      (redirectUrl.host !== currentHost && !isSubdomain(redirectUrl.host, currentHost))
    ) {
      removeMatchingHeaders(this._headerFilter, this._options.headers);
    }

    // Evaluate the beforeRedirect callback
    if (isFunction(beforeRedirect)) {
      const responseDetails = {
        headers: response.headers,
        statusCode: statusCode,
      };
      const requestDetails = {
        url: currentUrl,
        method: method,
        headers: requestHeaders,
      };
      beforeRedirect(this._options, responseDetails, requestDetails);
      this._sanitizeOptions(this._options);
    }

    // Send the redirected request
    this._performRequest();
  }
}

// follow-redirects builds its prototype with Object.create(Writable.prototype), so
// `req.constructor` is Writable there; keep that observable detail.
Object.defineProperty(RedirectableRequest.prototype, 'constructor', { value: Writable, writable: true, configurable: true });

export default RedirectableRequest;
