'use strict';

// In-package port of https-proxy-agent 5.0.1 (with the agent-base 6 glue it
// relied on), built on node:http Agent so Node tracks the sockets.

import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import url from 'node:url';

const kInternal = Symbol('axios.httpsProxyAgent.internal');

function isSecureEndpointFromStack(): boolean {
  const { stack } = new Error();
  if (typeof stack !== 'string') return false;
  return stack
    .split('\n')
    .some((l) => l.indexOf('(https.js:') !== -1 || l.indexOf('node:https:') !== -1);
}

function isSecureEndpoint(options: any): boolean {
  if (options) {
    if (typeof options.secureEndpoint === 'boolean') return options.secureEndpoint;
    if (typeof options.protocol === 'string') return options.protocol === 'https:';
    if (options._defaultAgent && typeof options._defaultAgent.protocol === 'string') {
      return options._defaultAgent.protocol === 'https:';
    }
  }
  return isSecureEndpointFromStack();
}

function isAgent(v: any): boolean {
  return Boolean(v) && typeof v.addRequest === 'function';
}

function resume(socket: any): void {
  socket.resume();
}

function isDefaultPort(port: any, secure: any): boolean {
  return Boolean((!secure && port === 80) || (secure && port === 443));
}

function isHTTPS(protocol: any): boolean {
  return typeof protocol === 'string' ? /^https:?$/i.test(protocol) : false;
}

function omit(obj: any, ...keys: string[]): any {
  const ret: any = {};
  let key: string;
  for (key in obj) {
    if (!keys.includes(key)) {
      ret[key] = obj[key];
    }
  }
  return ret;
}

// Buffers the proxy's reply to CONNECT so a non-200 status can be replayed
// onto the HTTP parser once the request machinery is attached.
function parseProxyResponse(socket: any): Promise<{ statusCode: number; buffered: Buffer }> {
  return new Promise((resolve, reject) => {
    let buffersLength = 0;
    const buffers: Buffer[] = [];

    function read() {
      const b = socket.read();
      if (b) ondata(b);
      else socket.once('readable', read);
    }

    function cleanup() {
      socket.removeListener('end', onend);
      socket.removeListener('error', onerror);
      socket.removeListener('close', onclose);
      socket.removeListener('readable', read);
    }

    function onclose() {}

    function onend() {}

    function onerror(err: any) {
      cleanup();
      reject(err);
    }

    function ondata(b: Buffer) {
      buffers.push(b);
      buffersLength += b.length;
      const buffered = Buffer.concat(buffers, buffersLength);
      const endOfHeaders = buffered.indexOf('\r\n\r\n');
      if (endOfHeaders === -1) {
        // keep buffering
        read();
        return;
      }

      const firstLine = buffered.toString('ascii', 0, buffered.indexOf('\r\n'));
      const statusCode = +firstLine.split(' ')[1];
      resolve({
        statusCode,
        buffered,
      });
    }

    socket.on('error', onerror);
    socket.on('close', onclose);
    socket.on('end', onend);
    read();
  });
}

class HttpsProxyAgent extends http.Agent {
  declare [kInternal]: any;
  declare options: any;
  proxy: any;
  secureProxy: boolean;
  timeout: number | null;

  constructor(_opts: any) {
    let opts: any;
    if (typeof _opts === 'string') {
      opts = url.parse(_opts);
    } else {
      opts = _opts;
    }
    if (!opts) {
      throw new Error('an HTTP(S) proxy server `host` and `port` must be specified!');
    }
    super();
    this[kInternal] = {};
    this.timeout = typeof opts.timeout === 'number' ? opts.timeout : null;
    const proxy = Object.assign({}, opts);
    // If `true`, then connect to the proxy server over TLS. Defaults to `false`.
    this.secureProxy = opts.secureProxy || isHTTPS(proxy.protocol);
    // Prefer `hostname` over `host`, and set the `port` if needed.
    proxy.host = proxy.hostname || proxy.host;
    if (typeof proxy.port === 'string') {
      proxy.port = parseInt(proxy.port, 10);
    }
    if (!proxy.port && proxy.host) {
      proxy.port = this.secureProxy ? 443 : 80;
    }
    // negotiate http/1.1 for proxy servers that support http/2 (value kept from 5.0.1)
    if (this.secureProxy && !('ALPNProtocols' in proxy)) {
      proxy.ALPNProtocols = ['http 1.1'];
    }
    if (proxy.host && proxy.path) {
      // Both `host` and `path` means a `url.parse()` result; drop the path so
      // `net.connect()` does not open it as a Unix socket file.
      delete proxy.path;
      delete proxy.pathname;
    }
    this.proxy = proxy;
  }

  // Node's Agent constructor assigns defaultPort/protocol before kInternal
  // exists; those writes are dropped so the getters stay dynamic.
  get defaultPort(): number {
    const explicit = this[kInternal] && this[kInternal].defaultPort;
    if (typeof explicit === 'number') return explicit;
    return this.protocol === 'https:' ? 443 : 80;
  }

  set defaultPort(v: number) {
    if (this[kInternal]) this[kInternal].defaultPort = v;
  }

  get protocol(): string {
    const explicit = this[kInternal] && this[kInternal].protocol;
    if (typeof explicit === 'string') return explicit;
    return isSecureEndpointFromStack() ? 'https:' : 'http:';
  }

  set protocol(v: string) {
    if (this[kInternal]) this[kInternal].protocol = v;
  }

  createSocket(req: any, _opts: any, cb: (err: any, socket?: any) => void): void {
    const opts: any = Object.assign({}, _opts);
    if (typeof opts.secureEndpoint !== 'boolean') {
      opts.secureEndpoint = isSecureEndpoint(opts);
    }
    if (opts.host == null) {
      opts.host = 'localhost';
    }
    if (opts.port == null) {
      opts.port = opts.secureEndpoint ? 443 : 80;
    }
    if (opts.protocol == null) {
      opts.protocol = opts.secureEndpoint ? 'https:' : 'http:';
    }
    if (opts.host && opts.path) {
      delete opts.path;
    }
    delete opts.agent;
    delete opts.hostname;
    delete opts._defaultAgent;
    delete opts.defaultPort;
    delete opts.createConnection;
    // Hint to use "Connection: close"
    req._last = true;
    req.shouldKeepAlive = false;

    let timedOut = false;
    let timeoutId: any = null;
    const timeoutMs = opts.timeout || this.timeout;

    const ontimeout = () => {
      timeoutId = null;
      timedOut = true;
      const err: any = new Error(
        `A "socket" was not created for HTTP request before ${timeoutMs}ms`
      );
      err.code = 'ETIMEOUT';
      cb(err);
    };

    const callbackError = (err: any) => {
      if (timedOut) return;
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      cb(err);
    };

    const onsocket = (socket: any) => {
      if (timedOut) return;
      if (timeoutId != null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (isAgent(socket)) {
        // The callback returned another Agent instance; hand the request over.
        socket.addRequest(req, opts);
        return;
      }
      if (socket) {
        this[kInternal].currentSocket = socket;
        (http.Agent.prototype as any).createSocket.call(this, req, _opts, cb);
        return;
      }
      cb(new Error(`no Duplex stream was returned to agent-base for \`${req.method} ${req.path}\``));
    };

    if (typeof this.callback !== 'function') {
      cb(new Error('`callback` is not defined'));
      return;
    }

    if (typeof timeoutMs === 'number' && timeoutMs > 0) {
      timeoutId = setTimeout(ontimeout, timeoutMs);
    }

    if ('port' in opts && typeof opts.port !== 'number') {
      opts.port = Number(opts.port);
    }

    try {
      Promise.resolve(this.callback(req, opts)).then(onsocket, callbackError);
    } catch (err) {
      Promise.reject(err).catch(callbackError);
    }
  }

  createConnection(): any {
    const socket = this[kInternal].currentSocket;
    this[kInternal].currentSocket = undefined;
    if (!socket) {
      throw new Error('No socket was returned in the `connect()` function');
    }
    return socket;
  }

  // Called for every new request: CONNECT through the proxy, then upgrade to
  // TLS when the endpoint is https. axios patches this in getTunnelingAgent.
  async callback(req: any, opts: any): Promise<any> {
    const { proxy, secureProxy } = this;

    // Create a socket connection to the proxy server.
    let socket: any;
    if (secureProxy) {
      socket = tls.connect(proxy);
    } else {
      socket = net.connect(proxy);
    }

    const headers: any = Object.assign({}, proxy.headers);
    const hostname = `${opts.host}:${opts.port}`;
    let payload = `CONNECT ${hostname} HTTP/1.1\r\n`;

    // Inject the `Proxy-Authorization` header if necessary.
    if (proxy.auth) {
      headers['Proxy-Authorization'] = `Basic ${Buffer.from(proxy.auth).toString('base64')}`;
    }

    // The `Host` header should only include the port number when it is not the default port.
    let { host, port, secureEndpoint } = opts;
    if (!isDefaultPort(port, secureEndpoint)) {
      host += `:${port}`;
    }
    headers.Host = host;

    headers.Connection = 'close';
    for (const name of Object.keys(headers)) {
      payload += `${name}: ${headers[name]}\r\n`;
    }

    const proxyResponsePromise = parseProxyResponse(socket);

    socket.write(`${payload}\r\n`);

    const { statusCode, buffered } = await proxyResponsePromise;

    if (statusCode === 200) {
      req.once('socket', resume);

      if (opts.secureEndpoint) {
        // The proxy is connecting to a TLS server, so upgrade this socket connection to TLS.
        const servername = opts.servername || opts.host;
        return tls.connect({
          ...omit(opts, 'host', 'hostname', 'path', 'port'),
          socket,
          servername,
        });
      }

      return socket;
    }

    // Close the original socket and return a fake one so the proxy never sees
    // the real request; the buffered CONNECT reply is replayed into the parser
    // once the HTTP machinery is attached (hackerone.com/reports/541502).
    socket.destroy();

    const fakeSocket: any = new net.Socket({ writable: false });
    fakeSocket.readable = true;

    // Need to wait for the "socket" event to re-play the "data" events.
    req.once('socket', (s: any) => {
      s.push(buffered);
      s.push(null);
    });

    return fakeSocket;
  }
}

// Duck-typed stand-in for `instanceof HttpsProxyAgent`; matches this class and
// the real https-proxy-agent package (v5 and v7) by constructor name.
export function isHttpsProxyAgent(agent: any): boolean {
  if (!agent || typeof agent !== 'object' || typeof agent.addRequest !== 'function') {
    return false;
  }
  if (agent instanceof HttpsProxyAgent) {
    return true;
  }
  let proto = Object.getPrototypeOf(agent);
  while (proto && proto !== Object.prototype) {
    const ctor = Object.prototype.hasOwnProperty.call(proto, 'constructor') && proto.constructor;
    if (ctor && ctor.name === 'HttpsProxyAgent') {
      return true;
    }
    proto = Object.getPrototypeOf(proto);
  }
  return false;
}

export default HttpsProxyAgent;
