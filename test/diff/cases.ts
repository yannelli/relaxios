// Each case runs unchanged against real axios and against fetchwire/axios.
// A case returns a response, a custom value, or throws; the suite normalizes and compares.
type Ax = any;
export type Case = (ax: Ax, base: string) => Promise<unknown>;

const custom = (value: unknown) => ({ __custom: value });

export const cases: Record<string, Case> = {
  'get json': (ax, b) => ax.get(b + '/json'),
  'get text': (ax, b) => ax.get(b + '/text'),
  'get json-looking text is parsed': (ax, b) => ax.get(b + '/jsontext'),
  'responseType text keeps json string': (ax, b) => ax.get(b + '/json', { responseType: 'text' }),
  'invalid json is returned as string': (ax, b) => ax.get(b + '/badjson'),
  'invalid json with responseType json throws': (ax, b) => ax.get(b + '/badjson', { responseType: 'json' }),
  'empty 204 body': (ax, b) => ax.delete(b + '/empty'),
  'head request': (ax, b) => ax.head(b + '/json'),
  'gzip response is decoded': (ax, b) => ax.get(b + '/gzip'),
  'arraybuffer response': (ax, b) => ax.get(b + '/binary', { responseType: 'arraybuffer' }),
  'stream response': (ax, b) => ax.get(b + '/text', { responseType: 'stream' }),
  'redirect is followed': (ax, b) => ax.get(b + '/redirect'),
  'maxRedirects 0': (ax, b) => ax.get(b + '/redirect', { maxRedirects: 0, validateStatus: null }),

  'params: bracket arrays, nesting, dates, nulls': (ax, b) =>
    ax.get(b + '/echo', {
      params: { ids: [1, 2], user: { name: 'a b', tags: ['x', 'y'] }, d: new Date(0), skip: null, no: undefined, s: 'a:b$c,d e&f=g/h?' },
    }),
  'params: array of objects': (ax, b) => ax.get(b + '/echo', { params: { list: [{ a: 1 }, { a: 2 }] } }),
  'params: key ending in []': (ax, b) => ax.get(b + '/echo', { params: { 'k[]': [1, 2], 'j{}': { a: 1 } } }),
  'params: indexes true': (ax, b) => ax.get(b + '/echo', { params: { a: [1, 2] }, paramsSerializer: { indexes: true } }),
  'params: indexes null': (ax, b) => ax.get(b + '/echo', { params: { a: [1, 2] }, paramsSerializer: { indexes: null } }),
  'params: custom serializer function': (ax, b) => ax.get(b + '/echo', { params: { a: 1 }, paramsSerializer: () => 'custom=1' }),
  'params: custom encode': (ax, b) =>
    ax.get(b + '/echo', { params: { a: 'x y' }, paramsSerializer: { encode: (v: string) => encodeURIComponent(v).toUpperCase() } }),
  'params: URLSearchParams': (ax, b) => ax.get(b + '/echo', { params: new URLSearchParams({ q: 'a b' }) }),
  'params: appended to existing query and hash dropped': (ax, b) => ax.get(b + '/echo?x=1#frag', { params: { y: 2 } }),
  'params: booleans and numbers': (ax, b) => ax.get(b + '/echo', { params: { t: true, f: false, n: 0 } }),

  'post object as json': (ax, b) => ax.post(b + '/echo', { a: 1, nested: { b: [1, 2] } }),
  'post array as json': (ax, b) => ax.post(b + '/echo', [1, 'two']),
  'post string body': (ax, b) => ax.post(b + '/echo', 'a=1&b=2'),
  'post string with json content-type': (ax, b) =>
    ax.post(b + '/echo', ' {"a":1} ', { headers: { 'Content-Type': 'application/json' } }),
  'post non-json string with json content-type': (ax, b) =>
    ax.post(b + '/echo', 'hello', { headers: { 'Content-Type': 'application/json' } }),
  'post number with json content-type': (ax, b) => ax.post(b + '/echo', 42, { headers: { 'content-type': 'application/json' } }),
  'post URLSearchParams': (ax, b) => ax.post(b + '/echo', new URLSearchParams({ a: '1', b: 'x y' })),
  'post object as urlencoded': (ax, b) =>
    ax.post(b + '/echo', { a: [1, 2], o: { k: 'v w' } }, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }),
  'post without data': (ax, b) => ax.post(b + '/echo'),
  'put and patch with data': async (ax, b) => [await ax.put(b + '/echo', { p: 1 }), await ax.patch(b + '/echo', { q: 2 })],
  'delete with data in config': (ax, b) => ax.delete(b + '/echo', { data: { d: 1 } }),
  'get with data in config': (ax, b) => ax.get(b + '/echo', { data: { ignored: true } }),
  'post FormData': (ax, b) => {
    const form = new FormData();
    form.append('name', 'value');
    form.append('file', new Blob(['abc'], { type: 'text/plain' }), 'a.txt');
    return ax.post(b + '/echo', form);
  },
  'postForm with object': (ax, b) => ax.postForm(b + '/echo', { a: 1, list: [1, 2], nested: { x: 'y' }, flag: true }),
  'postForm with Blob': (ax, b) => ax.postForm(b + '/echo', { file: new Blob(['zz'], { type: 'text/plain' }) }),
  'post Uint8Array': (ax, b) => ax.post(b + '/echo', new TextEncoder().encode('bytes')),
  'post Blob': (ax, b) => ax.post(b + '/echo', new Blob(['blob body'], { type: 'text/x-test' })),

  'status 404 rejects': (ax, b) => ax.get(b + '/status/404'),
  'status 500 rejects': (ax, b) => ax.get(b + '/status/500'),
  'validateStatus custom': (ax, b) => ax.get(b + '/status/404', { validateStatus: (s: number) => s < 500 }),
  'validateStatus null': (ax, b) => ax.get(b + '/status/500', { validateStatus: null }),
  'timeout': (ax, b) => ax.get(b + '/delay/300', { timeout: 50 }),
  'timeout with timeoutErrorMessage': (ax, b) => ax.get(b + '/delay/300', { timeout: 50, timeoutErrorMessage: 'too slow' }),
  'timeout with clarifyTimeoutError': (ax, b) =>
    ax.get(b + '/delay/300', { timeout: 50, transitional: { clarifyTimeoutError: true } }),
  'abort before request': (ax, b) => ax.get(b + '/json', { signal: AbortSignal.abort() }),
  'abort during request': (ax, b) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);
    return ax.get(b + '/delay/300', { signal: controller.signal });
  },
  'abort with reason': (ax, b) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error('my reason')), 30);
    return ax.get(b + '/delay/300', { signal: controller.signal });
  },
  'connection refused': (ax) => ax.get('http://127.0.0.1:1/'),
  'error toJSON keys': async (ax, b) => {
    try {
      await ax.get(b + '/status/400');
    } catch (e: any) {
      return custom({ keys: Object.keys(JSON.parse(JSON.stringify(e.toJSON()))).sort(), enumerable: Object.keys(e).sort() });
    }
  },
  'isAxiosError and isCancel helpers': async (ax, b) => {
    const e = await ax.get(b + '/status/400').catch((x: unknown) => x);
    const c = await ax.get(b + '/json', { signal: AbortSignal.abort() }).catch((x: unknown) => x);
    return custom([ax.isAxiosError(e), ax.isCancel(e), ax.isAxiosError(c), ax.isCancel(c), c instanceof ax.AxiosError, ax.isAxiosError(new Error())]);
  },

  'baseURL join with slashes': (ax, b) => ax.create({ baseURL: b + '/echo/' }).get('/x/'),
  'baseURL ignored for absolute url': (ax, b) => ax.create({ baseURL: 'http://example.invalid' }).get(b + '/echo'),
  'allowAbsoluteUrls false': (ax, b) => ax.getUri({ baseURL: b, url: 'http://other/x', allowAbsoluteUrls: false }),
  'getUri with params': async (ax, b) => custom(ax.create({ baseURL: b }).getUri({ url: '/p', params: { a: [1, 2] } })),
  'call forms': async (ax, b) => [await ax(b + '/json'), await ax({ url: b + '/echo', method: 'POST', data: { a: 1 } }), await ax.request({ url: b + '/json' })],

  'default headers: common, method and request': (ax, b) => {
    const api = ax.create({ baseURL: b });
    api.defaults.headers.common['X-Common'] = 'c';
    api.defaults.headers.common.Authorization = 'Bearer t';
    api.defaults.headers.post['X-Post-Only'] = 'p';
    return Promise.all([api.get('/echo'), api.post('/echo', {}, { headers: { authorization: 'Override', 'X-Num': 5, 'X-Bool': true } })]);
  },
  'headers removed with undefined, null and false': (ax, b) =>
    ax.create({ headers: { 'X-A': 'a', 'X-B': 'b', 'X-C': 'c' } }).get(b + '/echo', { headers: { 'X-A': undefined, 'X-B': null, 'X-C': false } }),
  'accept header override': (ax, b) => ax.get(b + '/echo', { headers: { Accept: 'text/html' } }),
  'basic auth': (ax, b) => ax.get(b + '/echo', { auth: { username: 'üser', password: 'p:ss' } }),
  'response headers dual access': async (ax, b) => {
    const r = await ax.get(b + '/headers');
    const h = r.headers;
    return custom([h['content-type'], h['x-custom'], h.get('X-Custom'), h.has('cache-control'), h['set-cookie'], h.getContentType(), typeof h.toJSON()]);
  },
  'single set-cookie header': async (ax, b) => custom((await ax.get(b + '/one-cookie')).headers['set-cookie']),

  'interceptor order': async (ax, b) => {
    const api = ax.create({ baseURL: b });
    const order: string[] = [];
    api.interceptors.request.use((c: any) => (order.push('req1'), c));
    api.interceptors.request.use((c: any) => (order.push('req2'), c));
    api.interceptors.response.use((r: any) => (order.push('res1'), r));
    api.interceptors.response.use((r: any) => (order.push('res2'), r));
    await api.get('/json');
    return custom(order);
  },
  'interceptor edits headers both ways': (ax, b) => {
    const api = ax.create({ baseURL: b });
    api.interceptors.request.use((c: any) => {
      c.headers.Authorization = 'Bearer bracket';
      c.headers.set('X-Set', 'set');
      c.headers['X-Seen-Type'] = typeof c.headers.get;
      return c;
    });
    return api.post('/echo', { a: 1 });
  },
  'interceptor sees merged config': async (ax, b) => {
    const api = ax.create({ baseURL: b, timeout: 1234, headers: { 'X-Def': 'd' } });
    let seen: any;
    api.interceptors.request.use((c: any) => ((seen = { method: c.method, url: c.url, timeout: c.timeout, def: c.headers['X-Def'], accept: c.headers.Accept }), c));
    await api.get('/json');
    return custom(seen);
  },
  'ejected interceptor and runWhen': async (ax, b) => {
    const api = ax.create({ baseURL: b });
    const order: string[] = [];
    const id = api.interceptors.request.use((c: any) => (order.push('ejected'), c));
    api.interceptors.request.use((c: any) => (order.push('skipped'), c), null, { runWhen: () => false });
    api.interceptors.request.use((c: any) => (order.push('kept'), c));
    api.interceptors.request.eject(id);
    await api.get('/json');
    return custom(order);
  },
  'response interceptor recovers error': (ax, b) => {
    const api = ax.create({ baseURL: b });
    api.interceptors.response.use(null, (e: any) => ({ recovered: e.response.status, data: e.response.data }));
    return api.get('/status/503').then((r: unknown) => custom(r));
  },
  'request interceptor throws': (ax, b) => {
    const api = ax.create({ baseURL: b });
    api.interceptors.request.use(() => {
      throw new Error('stop');
    });
    return api.get('/json');
  },
  'async request interceptor': (ax, b) => {
    const api = ax.create({ baseURL: b });
    api.interceptors.request.use(async (c: any) => {
      await new Promise((r) => setTimeout(r, 5));
      c.headers['X-Async'] = '1';
      return c;
    });
    return api.get('/echo');
  },

  'custom transformRequest appended': (ax, b) =>
    ax.post(b + '/echo', { a: 1 }, { transformRequest: [...ax.defaults.transformRequest, (d: string) => d.toUpperCase()] }),
  'custom transformRequest replaces default': (ax, b) =>
    ax.post(b + '/echo', { a: 1 }, { transformRequest: [(d: any, h: any) => (h['X-T'] = 'yes', 'raw:' + d.a)] }),
  'custom transformResponse': (ax, b) =>
    ax.get(b + '/json', { transformResponse: [(d: string, h: any, s: number) => ({ len: d.length, type: h['content-type'], s })] }),
  'transformResponse applies to error responses': (ax, b) =>
    ax.get(b + '/status/422', { transformResponse: [(d: string) => 'T:' + d] }),
  'parseReviver': (ax, b) => ax.get(b + '/json', { parseReviver: (k: string, v: unknown) => (k === 'a' ? 'revived' : v) }),

  'create inherits and isolates defaults': async (ax, b) => {
    const parent = ax.create({ baseURL: b, headers: { 'X-P': 'p' } });
    const child = parent.create({ headers: { 'X-C': 'c' } });
    parent.defaults.headers['X-Late'] = 'late';
    const r = await child.get('/echo');
    return custom({ headers: r.data.headers, parentHasChild: 'X-C' in parent.defaults.headers });
  },
  'all and spread': async (ax, b) => {
    const result = await ax.all([ax.get(b + '/json'), Promise.resolve(2)]);
    return custom(ax.spread((r: any, two: number) => [r.data, two])(result));
  },
  'withCredentials does not change node requests': (ax, b) => ax.get(b + '/echo', { withCredentials: true }),
  'xsrf header is not sent outside browsers': (ax, b) => ax.get(b + '/echo', { headers: { cookie: 'XSRF-TOKEN=t' } }),
  'custom adapter function': (ax, b) =>
    ax.get(b + '/json', {
      adapter: async (config: any) => ({ data: '{"from":"adapter"}', status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, config }),
    }),
  'blob response': async (ax, b) => {
    const r = await ax.get(b + '/text', { responseType: 'blob' });
    return custom({ type: r.data?.constructor?.name, text: typeof r.data?.text == 'function' ? await r.data.text() : String(r.data) });
  },
  'array header value': (ax, b) => ax.get(b + '/echo', { headers: { 'X-Arr': ['a', 'b'] } }),
  'custom method': (ax, b) => ax.request({ url: b + '/echo', method: 'PURGE' }),
  'relative url without baseURL': (ax) => ax.get('/relative'),
  'validateStatus explicitly undefined': (ax, b) => ax.get(b + '/status/500', { validateStatus: undefined }),
  'download progress final event': async (ax, b) => {
    const events: any[] = [];
    await ax.get(b + '/binary', { onDownloadProgress: (e: any) => events.push(e) });
    const last = events.at(-1);
    return custom(last && { loaded: last.loaded, total: last.total, progress: last.progress, download: last.download, lengthComputable: last.lengthComputable });
  },
  'upload progress outside browsers': async (ax, b) => {
    const events: any[] = [];
    await ax.post(b + '/echo', 'x'.repeat(1000), { onUploadProgress: (e: any) => events.push(e) });
    return custom(events.length > 0);
  },
  'decompress false': (ax, b) => ax.get(b + '/gzip', { decompress: false, responseType: 'arraybuffer' }),
  'maxContentLength exceeded': (ax, b) => ax.get(b + '/json', { maxContentLength: 5 }),
  'maxBodyLength exceeded': (ax, b) => ax.post(b + '/echo', 'x'.repeat(100), { maxBodyLength: 10 }),
  'post null data': (ax, b) => ax.post(b + '/echo', null),
  'post FormData with json content-type': (ax, b) => {
    const form = new FormData();
    form.append('a', '1');
    form.append('b', 'two');
    return ax.post(b + '/echo', form, { headers: { 'Content-Type': 'application/json' } });
  },
  'post Uint8Array with json content-type': (ax, b) =>
    ax.post(b + '/echo', new TextEncoder().encode('{"raw":true}'), { headers: { 'Content-Type': 'application/json' } }),
  'post null with json content-type': (ax, b) => ax.post(b + '/echo', null, { headers: { 'Content-Type': 'application/json' } }),
};
