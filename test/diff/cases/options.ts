import { describeData } from '../observe';
import { custom, type Case } from './shared';

// How many of the 12 chunks of 100 bytes arrive before a stream is cut depends on scheduling,
// so the bytes are reduced to whether the body was partial. The read error is still compared.
async function partialStream(request: Promise<any>) {
  const res = await request;
  const { base64, ...data } = (await describeData(res.data)) as { base64?: string };
  return custom({ status: res.status, data, partial: base64 !== undefined && atob(base64).length < 1200 });
}

// Adapter selection, errors raised before and after the request is sent, cancellation and headers.
export const optionCases: Record<string, Case> = {
  'unknown adapter name': (ax, { base }) => ax.get(base + '/json', { adapter: 'nope' }),
  'adapter array with unknown last': (ax, { base }) => ax.get(base + '/json', { adapter: ['xhr', 'nope'] }),
  'adapter xhr explicit': (ax, { base }) => ax.get(base + '/json', { adapter: 'xhr' }),
  'adapter http explicit': (ax, { base }) => ax.get(base + '/json', { adapter: 'http' }),
  'adapter fetch explicit': (ax, { base }) => ax.get(base + '/json', { adapter: 'fetch' }),
  'adapter array xhr then http': (ax, { base }) => ax.get(base + '/json', { adapter: ['xhr', 'http'] }),
  'adapter array fetch first': (ax, { base }) => ax.get(base + '/echo', { adapter: ['fetch', 'xhr', 'http'] }),
  'adapter uppercase name': (ax, { base }) => ax.get(base + '/json', { adapter: 'HTTP' }),
  'adapter empty array': (ax, { base }) => ax.get(base + '/json', { adapter: [] }),
  'adapter null': (ax, { base }) => ax.get(base + '/json', { adapter: null }),
  'getAdapter static': async (ax) => {
    const probe = (name: string) => {
      try {
        const a = ax.getAdapter(name);
        return [typeof a, a?.adapterName ?? a?.name];
      } catch (e: any) {
        return ['error', e.code, e.message];
      }
    };
    return custom({ xhr: probe('xhr'), http: probe('http'), fetch: probe('fetch'), list: probe(['xhr', 'http', 'fetch'] as any), defaults: ax.defaults.adapter });
  },
  'adapter returning promise of plain object': (ax, { base }) =>
    ax.get(base + '/json', { adapter: () => Promise.resolve({ data: { adapted: true }, status: 201, statusText: 'Made', headers: {}, config: {} }) }),

  'unsupported protocol ftp': (ax) => ax.get('ftp://x/file'),
  'unsupported protocol with adapter fetch option': (ax) => ax.get('gopher://x/'),
  'malformed url http:/x': (ax) => ax.get('http:/x'),
  'blob protocol': (ax) => ax.get('blob:http://localhost/abc'),
  'file protocol': (ax) => ax.get('file:///nonexistent/diff.txt'),
  'url with spaces': (ax, { base }) => ax.get(base + '/echo?q=a b'),
  'url with unicode path': (ax, { base }) => ax.get(base + '/echo/日本'),
  'url with encoded path': (ax, { base }) => ax.get(base + '/echo/a%20b'),
  'url with hash only': (ax, { base }) => ax.get(base + '/echo#hash'),
  'url with trailing question mark': (ax, { base }) => ax.get(base + '/echo?'),
  'url credentials': (ax, { base }) => ax.get(base.replace('://', '://u:p@') + '/echo'),
  'url credentials encoded': (ax, { base }) => ax.get(base.replace('://', '://my%40mail:p%3Ass@') + '/echo'),
  'url credentials with auth config': (ax, { base }) => ax.get(base.replace('://', '://u:p@') + '/echo', { auth: { username: 'cfg', password: 'x' } }),
  'url credentials with authorization header': (ax, { base }) => ax.get(base.replace('://', '://u:p@') + '/echo', { headers: { Authorization: 'Bearer h' } }),
  'url username only': (ax, { base }) => ax.get(base.replace('://', '://only@') + '/echo'),
  'auth with unicode password': (ax, { base }) => ax.get(base + '/echo', { auth: { username: 'ü', password: 'pässwörd' } }),
  'auth with empty password': (ax, { base }) => ax.get(base + '/echo', { auth: { username: 'u' } }),
  'auth overrides authorization header': (ax, { base }) => ax.get(base + '/echo', { auth: { username: 'a', password: 'b' }, headers: { Authorization: 'Bearer h' } }),

  'signal aborted with string reason': (ax, { base }) => ax.get(base + '/json', { signal: AbortSignal.abort('stop') }),
  'signal aborted with error reason': (ax, { base }) => ax.get(base + '/json', { signal: AbortSignal.abort(new Error('pre')) }),
  'signal timeout helper': (ax, { base }) => ax.get(base + '/delay/300', { signal: AbortSignal.timeout(30) }),
  'signal abort after response': async (ax, { base }) => {
    const controller = new AbortController();
    const r = await ax.get(base + '/json', { signal: controller.signal });
    controller.abort();
    return r;
  },
  'signal and timeout together': (ax, { base }) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    return ax.get(base + '/delay/300', { signal: controller.signal, timeout: 50 });
  },
  'cancel token before request': (ax, { base }) => {
    const source = ax.CancelToken.source();
    source.cancel('bye');
    return ax.get(base + '/json', { cancelToken: source.token });
  },
  'cancel token during request': (ax, { base }) => {
    const source = ax.CancelToken.source();
    setTimeout(() => source.cancel('later'), 30);
    return ax.get(base + '/delay/300', { cancelToken: source.token });
  },
  'cancel token without message': (ax, { base }) => {
    const source = ax.CancelToken.source();
    setTimeout(() => source.cancel(), 30);
    return ax.get(base + '/delay/300', { cancelToken: source.token });
  },
  'cancel token executor': (ax, { base }) => {
    let cancel: any;
    const token = new ax.CancelToken((c: any) => (cancel = c));
    setTimeout(() => cancel('exec'), 30);
    return ax.get(base + '/delay/300', { cancelToken: token });
  },
  'cancel token and signal': (ax, { base }) => {
    const source = ax.CancelToken.source();
    const controller = new AbortController();
    setTimeout(() => source.cancel('token first'), 30);
    setTimeout(() => controller.abort(), 60);
    return ax.get(base + '/delay/300', { cancelToken: source.token, signal: controller.signal });
  },
  'cancel token throwIfRequested': async (ax) => {
    const source = ax.CancelToken.source();
    source.cancel('x');
    try {
      source.token.throwIfRequested();
      return custom('no throw');
    } catch (e: any) {
      return custom([e.name, e.message, e.code, ax.isCancel(e), e instanceof ax.CanceledError, e instanceof ax.Cancel]);
    }
  },
  'cancel token reason and promise': async (ax) => {
    const source = ax.CancelToken.source();
    source.cancel('why');
    const reason = await source.token.promise;
    return custom([reason.message, reason.code, source.token.reason === reason, typeof source.token.toAbortSignal]);
  },
  'timeout during slow body': (ax, { base }) => ax.get(base + '/slow?chunks=12&delay=50&size=100', { timeout: 400 }),
  'timeout during slow body stream': (ax, { base }) =>
    partialStream(ax.get(base + '/slow?chunks=12&delay=50&size=100', { timeout: 400, responseType: 'stream' })),
  'timeout before first byte': (ax, { base }) => ax.get(base + '/slow?first=400&chunks=2&delay=10&size=10', { timeout: 150 }),
  'timeout longer than body': (ax, { base }) => ax.get(base + '/slow?chunks=3&delay=20&size=10', { timeout: 2000 }),
  'abort during slow body': (ax, { base }) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    return ax.get(base + '/slow?chunks=12&delay=50&size=100', { signal: controller.signal });
  },
  'abort during slow body stream': (ax, { base }) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    return partialStream(ax.get(base + '/slow?chunks=12&delay=50&size=100', { signal: controller.signal, responseType: 'stream' }));
  },
  'cancel token during slow body': (ax, { base }) => {
    const source = ax.CancelToken.source();
    setTimeout(() => source.cancel('mid'), 200);
    return ax.get(base + '/slow?chunks=12&delay=50&size=100', { cancelToken: source.token });
  },
  'timeout NaN': (ax, { base }) => ax.get(base + '/delay/300', { timeout: 'abc' }),
  'timeout numeric string': (ax, { base }) => ax.get(base + '/delay/300', { timeout: '50' }),
  'timeout zero': (ax, { base }) => ax.get(base + '/delay/50', { timeout: 0 }),

  'invalid httpVersion string': (ax, { base }) => ax.get(base + '/json', { httpVersion: 'abc' }),
  'invalid httpVersion 3': (ax, { base }) => ax.get(base + '/json', { httpVersion: 3 }),
  'httpVersion 1 explicit': (ax, { base }) => ax.get(base + '/json', { httpVersion: 1 }),
  'httpVersion numeric string 1': (ax, { base }) => ax.get(base + '/json', { httpVersion: '1' }),
  'transitional unknown option': (ax, { base }) => ax.get(base + '/json', { transitional: { nope: true } }),
  'transitional bad value': (ax, { base }) => ax.get(base + '/json', { transitional: { silentJSONParsing: 'yes' } }),
  'transitional forcedJSONParsing false': (ax, { base }) => ax.get(base + '/json', { transitional: { forcedJSONParsing: false } }),
  'transitional silentJSONParsing false with bad json': (ax, { base }) =>
    ax.get(base + '/badjson', { responseType: 'json', transitional: { silentJSONParsing: false } }),
  'transitional legacyInterceptorReqResOrdering false': async (ax, { base }) => {
    const api = ax.create({ baseURL: base, transitional: { legacyInterceptorReqResOrdering: false } });
    const order: string[] = [];
    api.interceptors.request.use((c: any) => (order.push('req1'), c));
    api.interceptors.request.use((c: any) => (order.push('req2'), c));
    await api.get('/json');
    return custom(order);
  },
  'paramsSerializer bad option': (ax, { base }) => ax.get(base + '/json', { paramsSerializer: { nope: true } }),
  'paramsSerializer non-function encode': (ax, { base }) => ax.get(base + '/json', { paramsSerializer: { encode: 'x' } }),
  'baseUrl misspelling': (ax, { base }) => ax.get(base + '/json', { baseUrl: base }),
  'withXsrfToken misspelling': (ax, { base }) => ax.get(base + '/json', { withXsrfToken: true }),
  'validateStatus undefined no resolve': (ax, { base }) =>
    ax.get(base + '/status/500', { validateStatus: undefined, transitional: { validateStatusUndefinedResolves: false } }),
  'validateStatus undefined resolves default': (ax, { base }) =>
    ax.get(base + '/status/500', { validateStatus: undefined, transitional: { validateStatusUndefinedResolves: true } }),
  'method uppercase in config': (ax, { base }) => ax.request({ url: base + '/echo', method: 'Post', data: { m: 1 } }),
  'method missing uses default get': (ax, { base }) => ax.request({ url: base + '/echo' }),
  'instance default method': (ax, { base }) => ax.create({ method: 'put' }).request({ url: base + '/echo', data: 'd' }),
  'options method': (ax, { base }) => ax.options(base + '/echo'),
  'head returns no data': (ax, { base }) => ax.head(base + '/echo'),
  'insecureHTTPParser': (ax, { base }) => ax.get(base + '/json', { insecureHTTPParser: true }),
  'fetchOptions passthrough': (ax, { base }) => ax.get(base + '/echo', { fetchOptions: { cache: 'no-store', headers: { 'X-Ignored': '1' }, method: 'DELETE' } }),
  'fetchOptions redirect manual': (ax, { base }) => ax.get(base + '/redirect', { fetchOptions: { redirect: 'manual' }, validateStatus: null }),
  'withCredentials string value': (ax, { base }) => ax.get(base + '/echo', { withCredentials: 'yes' }),

  'headers unicode value': (ax, { base }) => ax.get(base + '/echo', { headers: { 'X-Uni': 'héllo ✓ 日本' } }),
  'headers crlf value': (ax, { base }) => ax.get(base + '/echo', { headers: { 'X-Crlf': 'a\r\nb\nc\rd' } }),
  'headers whitespace trimmed': (ax, { base }) => ax.get(base + '/echo', { headers: { 'X-Space': '  padded \t' } }),
  'headers control chars': (ax, { base }) => ax.get(base + '/echo', { headers: { 'X-Ctl': 'a\u0000b\u0007c\u007fd' } }),
  'headers latin1 value': (ax, { base }) => ax.get(base + '/echo', { headers: { 'X-Latin': 'café' } }),
  'headers numeric and boolean': (ax, { base }) => ax.get(base + '/echo', { headers: { 'X-Num': 0, 'X-False': false, 'X-True': true } }),
  'headers empty string value': (ax, { base }) => ax.get(base + '/echo', { headers: { 'X-Empty': '' } }),
  'headers object value': (ax, { base }) => ax.get(base + '/echo', { headers: { 'X-Obj': { a: 1 } } }),
  'headers invalid name': (ax, { base }) => ax.get(base + '/echo', { headers: { 'X Bad Name': 'v' } }),
  'headers AxiosHeaders instance': (ax, { base }) => ax.get(base + '/echo', { headers: new ax.AxiosHeaders({ 'X-Inst': 'i' }) }),
  'headers Headers instance': (ax, { base }) => ax.get(base + '/echo', { headers: new Headers({ 'X-Web': 'w' }) }),
  'headers raw string': (ax, { base }) => ax.get(base + '/echo', { headers: 'X-Raw: r\nX-Raw2: s' }),
  'headers set-cookie parsing': async (ax, { base }) => {
    const h = ax.AxiosHeaders.from('set-cookie: a=1\nset-cookie: b=2\nx-one: 1');
    return custom([h['set-cookie'], h.get('x-one'), Object.keys(h.toJSON()).sort()]);
  },
  'user-agent default': (ax, { base }) => ax.get(base + '/echo'),
  'user-agent custom': (ax, { base }) => ax.get(base + '/echo', { headers: { 'User-Agent': 'diff/1.0' } }),
  'user-agent removed': (ax, { base }) => ax.get(base + '/echo', { headers: { 'User-Agent': null } }),
  'accept-encoding custom': (ax, { base }) => ax.get(base + '/gzip', { headers: { 'Accept-Encoding': 'identity' } }),
  'accept-encoding gzip only': (ax, { base }) => ax.get(base + '/echo', { headers: { 'Accept-Encoding': 'gzip' } }),
  'advertiseZstdAcceptEncoding': (ax, { base }) => ax.get(base + '/echo', { transitional: { advertiseZstdAcceptEncoding: true } }),
  'host header override': (ax, { base }) => ax.get(base + '/echo', { headers: { Host: 'diff.example' } }),
  'accept header removed': (ax, { base }) => ax.get(base + '/echo', { headers: { Accept: null } }),
  'content-type on get without body': (ax, { base }) => ax.get(base + '/echo', { headers: { 'Content-Type': 'application/json' } }),
  'content-type on delete with body': (ax, { base }) => ax.delete(base + '/echo', { data: 'body', headers: { 'Content-Type': 'text/plain' } }),
  'HttpStatusCode static': async (ax) => custom([ax.HttpStatusCode?.NotFound, ax.HttpStatusCode?.[200]]),
  'VERSION and statics': async (ax) =>
    custom([typeof ax.VERSION, typeof ax.Axios, typeof ax.AxiosHeaders, typeof ax.mergeConfig, typeof ax.isCancel, typeof ax.Cancel, typeof ax.formToJSON, typeof ax.getAdapter, typeof ax.toFormData, typeof ax.spread, typeof ax.all]),
  'mergeConfig static': async (ax) =>
    custom(ax.mergeConfig({ headers: { A: '1' }, timeout: 1, params: { a: 1 } }, { headers: { B: '2' }, params: { b: 2 }, url: '/x' })),
  'getUri static': async (ax, { base }) => custom([ax.getUri({ url: base + '/p?x=1', params: { y: [1, 2] } }), ax.getUri({ baseURL: base, url: 'p', params: {} })]),
  'getUri with paramsSerializer': async (ax, { base }) => custom(ax.getUri({ url: base + '/p', params: { a: 1 }, paramsSerializer: { serialize: () => 'z=9' } })),
};
