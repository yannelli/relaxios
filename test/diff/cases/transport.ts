import { custom, type Case } from './shared';

// Node transport options: proxies, agents, DNS, HTTP/2, custom transports and unix sockets.
// Other runtimes still run these; whatever axios does there (ignore, throw) is what we must match.
// Where node:http does not exist (browsers, workerd) the case still runs with the option left
// out, so both clients are compared on what the runtime can express.
const nodeHttp = () => import(/* @vite-ignore */ 'node:http').catch(() => null);

export const transportCases: Record<string, Case> = {
  'proxy http target': (ax, { base, proxy }) => ax.get(base + '/echo', { proxy }),
  'proxy with auth': (ax, { base, proxy }) => ax.get(base + '/echo', { proxy: { ...proxy, auth: { username: 'pu', password: 'pp' } } }),
  'proxy with protocol': (ax, { base, proxy }) => ax.get(base + '/echo', { proxy: { ...proxy, protocol: 'http' } }),
  'proxy with invalid auth object': (ax, { base, proxy }) => ax.get(base + '/echo', { proxy: { ...proxy, auth: {} } }),
  'proxy post through': (ax, { base, proxy }) => ax.post(base + '/echo', { via: 'proxy' }, { proxy }),
  'proxy with redirect': (ax, { base, proxy }) => ax.get(base + '/redirect', { proxy }),
  'proxy to other origin': (ax, { other, proxy }) => ax.get(other + '/echo', { proxy }),
  'proxy with params and auth': (ax, { base, proxy }) => ax.get(base + '/echo', { proxy, params: { p: 1 }, auth: { username: 'u', password: 'p' } }),
  'proxy false': (ax, { base }) => ax.get(base + '/echo', { proxy: false }),
  'proxy unreachable': (ax, { base }) => ax.get(base + '/echo', { proxy: { host: '127.0.0.1', port: 1 } }),
  'proxy with httpVersion 2': (ax, { base, proxy }) => ax.get(base + '/echo', { proxy, httpVersion: 2 }),

  'httpAgent keepAlive': async (ax, { base }) => {
    const http = await nodeHttp();
    const agent = http ? new http.Agent({ keepAlive: true, maxSockets: 1 }) : undefined;
    try {
      return [await ax.get(base + '/json', { httpAgent: agent }), await ax.get(base + '/json', { httpAgent: agent })];
    } finally {
      agent && agent.destroy();
    }
  },
  'httpAgent plain object ignored': (ax, { base }) => ax.get(base + '/json', { httpAgent: { keepAlive: true } }),
  'transport passthrough': async (ax, { base }) => {
    const http = await nodeHttp();
    const seen: unknown[] = [];
    const transport = http && {
      request(options: any, cb: any) {
        seen.push([options.method, options.path, typeof options.headers, options.protocol]);
        return http.request(options, cb);
      },
    };
    const r = await ax.post(base + '/echo', { t: 1 }, { transport });
    return custom({ seen, data: r.data });
  },
  'transport throwing': (ax, { base }) =>
    ax.get(base + '/json', {
      transport: {
        request() {
          throw new Error('custom transport called');
        },
      },
    }),
  'transport with maxRedirects 0': (ax, { base }) =>
    ax.get(base + '/json', {
      maxRedirects: 0,
      transport: {
        request() {
          throw new Error('transport wins over native');
        },
      },
    }),

  'lookup custom': (ax, { base }) =>
    ax.get(base.replace('127.0.0.1', 'diff-lookup.invalid') + '/echo', { lookup: (_host: string, _opts: unknown, cb: any) => cb(null, '127.0.0.1', 4) }),
  'lookup returning array entries': (ax, { base }) =>
    ax.get(base.replace('127.0.0.1', 'diff-lookup.invalid') + '/echo', {
      lookup: (_host: string, _opts: unknown, cb: any) => cb(null, [{ address: '127.0.0.1', family: 4 }]),
    }),
  'lookup async function': (ax, { base }) =>
    ax.get(base.replace('127.0.0.1', 'diff-lookup.invalid') + '/echo', { lookup: async () => ['127.0.0.1', 4] }),
  'lookup error': (ax, { base }) =>
    ax.get(base.replace('127.0.0.1', 'diff-lookup.invalid') + '/echo', { lookup: (_h: string, _o: unknown, cb: any) => cb(new Error('dns down')) }),
  'lookup bad address': (ax, { base }) =>
    ax.get(base.replace('127.0.0.1', 'diff-lookup.invalid') + '/echo', { lookup: (_h: string, _o: unknown, cb: any) => cb(null, 42, 4) }),
  'unresolvable host': (ax) => ax.get('http://diff-unresolvable.invalid/x'),
  'family 4': (ax, { base }) => ax.get(base + '/echo', { family: 4 }),
  'family 6 on ipv4 target': (ax, { base }) => ax.get(base + '/echo', { family: 6 }),

  'httpVersion 2': (ax, { h2 }) => ax.get(h2 + '/json', { httpVersion: 2 }),
  'httpVersion 2 echo post': (ax, { h2 }) => ax.post(h2 + '/echo', { h2: true }, { httpVersion: 2, headers: { 'X-Two': '2' } }),
  'httpVersion 2 arraybuffer': (ax, { h2 }) => ax.get(h2 + '/binary', { httpVersion: 2, responseType: 'arraybuffer' }),
  'httpVersion 2 stream': (ax, { h2 }) => ax.get(h2 + '/text', { httpVersion: 2, responseType: 'stream' }),
  'httpVersion 2 error status': (ax, { h2 }) => ax.get(h2 + '/status/404', { httpVersion: 2 }),
  'httpVersion 2 gzip': (ax, { h2 }) => ax.get(h2 + '/gzip', { httpVersion: 2 }),
  'httpVersion 2 timeout': (ax, { h2 }) => ax.get(h2 + '/delay/300', { httpVersion: 2, timeout: 50 }),
  'httpVersion 2 abort': (ax, { h2 }) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);
    return ax.get(h2 + '/delay/300', { httpVersion: 2, signal: controller.signal });
  },
  'httpVersion 2 with progress': async (ax, { h2 }) => {
    const up: any[] = [];
    const down: any[] = [];
    const r = await ax.post(h2 + '/echo', 'h'.repeat(5000), { httpVersion: 2, onUploadProgress: (e: any) => up.push(e), onDownloadProgress: (e: any) => down.push(e) });
    return custom({ up: up.length > 0, down: down.length > 0, bodyLength: r.data?.bodyLength });
  },
  'httpVersion 2 FormData': (ax, { h2 }) => {
    const form = new FormData();
    form.append('a', '1');
    return ax.post(h2 + '/echo', form, { httpVersion: 2 });
  },
  'httpVersion 2 redirect': (ax, { h2 }) => ax.get(h2 + '/redirect', { httpVersion: 2 }),
  'httpVersion 2 maxBodyLength': (ax, { h2 }) => ax.post(h2 + '/echo', 'x'.repeat(100), { httpVersion: 2, maxBodyLength: 10 }),
  'httpVersion 2 maxContentLength': (ax, { h2 }) => ax.get(h2 + '/json', { httpVersion: 2, maxContentLength: 5 }),
  'httpVersion 1 to h2c listener': (ax, { h2 }) => ax.get(h2 + '/json'),
  'http2Options with lookup': (ax, { h2 }) =>
    ax.get(h2.replace('127.0.0.1', 'diff-lookup.invalid') + '/json', { httpVersion: 2, lookup: (_h: string, _o: unknown, cb: any) => cb(null, '127.0.0.1', 4) }),

  'socketPath': (ax, { socketPath }) => (socketPath ? ax.get('/json', { socketPath }) : Promise.resolve(custom('no socketPath in env'))),
  'socketPath with absolute url': (ax, { socketPath }) =>
    socketPath ? ax.post('http://ignored.invalid/echo', { s: 1 }, { socketPath }) : Promise.resolve(custom('no socketPath in env')),
  'socketPath not a string': (ax, { base }) => ax.get(base + '/json', { socketPath: 42 }),
  'socketPath missing file': (ax) => ax.get('/json', { socketPath: '/nonexistent/diff.sock' }),
  'allowedSocketPaths mismatch': (ax, { socketPath }) =>
    socketPath ? ax.get('/json', { socketPath, allowedSocketPaths: ['/other.sock'] }) : Promise.resolve(custom('no socketPath in env')),
  'allowedSocketPaths match': (ax, { socketPath }) =>
    socketPath ? ax.get('/json', { socketPath, allowedSocketPaths: socketPath }) : Promise.resolve(custom('no socketPath in env')),
};
