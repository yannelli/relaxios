import { custom, pattern, summarizeProgress, type Case } from './shared';

const RESPONSE_TYPES = ['json', 'text', 'arraybuffer', 'blob', 'document', 'stream', 'formdata', undefined] as const;
const ROUTES = { json: '/json', text: '/text', binary: '/binary' };

// Every responseType on a JSON, a text and a binary route: the output shape differs per adapter.
export const responseCases: Record<string, Case> = {};
for (const type of RESPONSE_TYPES) {
  for (const [label, route] of Object.entries(ROUTES)) {
    responseCases[`responseType ${type ?? 'unset'} on ${label}`] = (ax, { base }) =>
      ax.get(base + route, type === undefined ? {} : { responseType: type });
  }
}

// Events seen before a transport failure are timing dependent, so they only count after a status.
const progress = async (ax: any, promise: Promise<unknown>, events: any[], relative = false) => {
  const result = await promise.then((r: any) => ({ status: r.status, bytes: r.data?.byteLength ?? r.data?.length }), (e: any) => ({ error: e.code, status: e.status }));
  const settled = !('error' in result) || result.status !== undefined;
  return custom({ ...(settled ? summarizeProgress(events, relative) : { events: 'not compared: request failed before a response' }), result });
};

const moreResponseCases: Record<string, Case> = {
  'responseType formdata on multipart': (ax, { base }) => ax.get(base + '/multipart', { responseType: 'formdata' }),
  'responseType document on html': (ax, { base }) => ax.get(base + '/html', { responseType: 'document' }),
  'responseType document on xml': (ax, { base }) => ax.get(base + '/xml', { responseType: 'document' }),
  'responseType stream on large': (ax, { base }) => ax.get(base + '/large', { responseType: 'stream' }),
  'responseType blob on gzip': (ax, { base }) => ax.get(base + '/gzip', { responseType: 'blob' }),
  'responseType unknown value': (ax, { base }) => ax.get(base + '/json', { responseType: 'nonsense' }),
  'responseType json on error status': (ax, { base }) => ax.get(base + '/status/404', { responseType: 'json' }),
  'responseType arraybuffer on error status': (ax, { base }) => ax.get(base + '/status/404', { responseType: 'arraybuffer' }),
  'responseType text with transformResponse': (ax, { base }) =>
    ax.get(base + '/json', { responseType: 'text', transformResponse: [(d: unknown) => ({ kind: typeof d, len: (d as string).length })] }),
  'xml response as text': (ax, { base }) => ax.get(base + '/xml'),
  'html response default': (ax, { base }) => ax.get(base + '/html'),
  'no content-type response': (ax, { base }) => ax.get(base + '/no-type'),
  'utf8 text': (ax, { base }) => ax.get(base + '/utf8'),

  'download progress on large': (ax, { base }) => {
    const events: any[] = [];
    return progress(ax, ax.get(base + '/large', { responseType: 'arraybuffer', onDownloadProgress: (e: any) => events.push(e) }), events);
  },
  'download progress without content-length': (ax, { base }) => {
    const events: any[] = [];
    return progress(ax, ax.get(base + '/chunked', { onDownloadProgress: (e: any) => events.push(e) }), events);
  },
  'download progress on json': (ax, { base }) => {
    const events: any[] = [];
    return progress(ax, ax.get(base + '/json', { onDownloadProgress: (e: any) => events.push(e) }), events);
  },
  'download progress on error status': (ax, { base }) => {
    const events: any[] = [];
    return progress(ax, ax.get(base + '/status/500', { onDownloadProgress: (e: any) => events.push(e) }), events);
  },
  'download progress with gzip': (ax, { base }) => {
    const events: any[] = [];
    return progress(ax, ax.get(base + '/gzip', { onDownloadProgress: (e: any) => events.push(e) }), events);
  },
  'upload progress string body': (ax, { base }) => {
    const events: any[] = [];
    return progress(ax, ax.post(base + '/echo', 'x'.repeat(64 * 1024), { onUploadProgress: (e: any) => events.push(e) }), events);
  },
  'upload progress Blob body': (ax, { base }) => {
    const events: any[] = [];
    const blob = new Blob([pattern(64 * 1024)], { type: 'application/octet-stream' });
    return progress(ax, ax.post(base + '/echo', blob, { onUploadProgress: (e: any) => events.push(e) }), events);
  },
  'upload progress FormData body': (ax, { base }) => {
    const events: any[] = [];
    const form = new FormData();
    form.append('f', new Blob([pattern(32 * 1024)]), 'f.bin');
    // Multipart sizes vary with the boundary (Gecko's is variable length), so only completion is compared.
    return progress(ax, ax.post(base + '/echo', form, { onUploadProgress: (e: any) => events.push(e) }), events, true);
  },
  'upload progress json body': (ax, { base }) => {
    const events: any[] = [];
    return progress(ax, ax.post(base + '/echo', { big: 'y'.repeat(50_000) }, { onUploadProgress: (e: any) => events.push(e) }), events);
  },
  'upload progress without body': (ax, { base }) => {
    const events: any[] = [];
    return progress(ax, ax.get(base + '/json', { onUploadProgress: (e: any) => events.push(e) }), events);
  },
  'upload and download progress together': async (ax, { base }) => {
    const up: any[] = [];
    const down: any[] = [];
    const r = await ax.post(base + '/echo', 'z'.repeat(10_000), { onUploadProgress: (e: any) => up.push(e), onDownloadProgress: (e: any) => down.push(e) });
    return custom({ up: summarizeProgress(up), down: summarizeProgress(down), status: r.status });
  },

  'data url get text': (ax) => ax.get('data:text/plain;base64,aGVsbG8gd29ybGQ='),
  'data url responseType text': (ax) => ax.get('data:text/plain;base64,aGVsbG8gd29ybGQ=', { responseType: 'text' }),
  'data url arraybuffer': (ax) => ax.get('data:application/octet-stream;base64,AAEC/v8=', { responseType: 'arraybuffer' }),
  'data url blob': (ax) => ax.get('data:text/plain;base64,aGVsbG8=', { responseType: 'blob' }),
  'data url stream': (ax) => ax.get('data:text/plain;base64,aGVsbG8=', { responseType: 'stream' }),
  'data url json': (ax) => ax.get('data:application/json,%7B%22a%22%3A1%7D'),
  'data url json responseType json': (ax) => ax.get('data:application/json,%7B%22a%22%3A1%7D', { responseType: 'json' }),
  'data url plain without mediatype': (ax) => ax.get('data:,hi%20there'),
  'data url with charset': (ax) => ax.get('data:text/plain;charset=utf-8,caf%C3%A9'),
  'data url post': (ax) => ax.post('data:text/plain,hi', { a: 1 }),
  'data url head': (ax) => ax.head('data:text/plain,hi'),
  'data url invalid': (ax) => ax.get('data:nope'),
  'data url maxContentLength exceeded': (ax) => ax.get('data:text/plain;base64,aGVsbG8gd29ybGQ=', { maxContentLength: 3 }),
  'data url maxContentLength ok': (ax) => ax.get('data:text/plain;base64,aGVsbG8=', { maxContentLength: 100 }),
  'data url with params': (ax) => ax.get('data:text/plain,hi', { params: { a: 1 } }),

  'gzip text': (ax, { base }) => ax.get(base + '/gzip-text'),
  'brotli response': (ax, { base }) => ax.get(base + '/brotli'),
  'deflate response': (ax, { base }) => ax.get(base + '/deflate'),
  'deflate raw response': (ax, { base }) => ax.get(base + '/deflate-raw'),
  'decompress false gzip text': (ax, { base }) => ax.get(base + '/gzip-text', { decompress: false }),
  'decompress false stream': (ax, { base }) => ax.get(base + '/gzip', { decompress: false, responseType: 'stream' }),
  'decompress false on plain response': (ax, { base }) => ax.get(base + '/json', { decompress: false }),
  'head with content-encoding': (ax, { base }) => ax.head(base + '/head-gzip'),
  '204 with content-encoding': (ax, { base }) => ax.get(base + '/empty-gzip'),
  'head large': (ax, { base }) => ax.head(base + '/large'),
  'unknown content-encoding': (ax, { base }) => ax.get(base + '/bad-encoding'),
  'corrupt gzip body': (ax, { base }) => ax.get(base + '/corrupt-gzip'),

  'maxContentLength exceeded stream': (ax, { base }) => ax.get(base + '/large', { maxContentLength: 1000, responseType: 'stream' }),
  'maxContentLength exceeded chunked': (ax, { base }) => ax.get(base + '/chunked', { maxContentLength: 5 }),
  'maxContentLength exceeded arraybuffer': (ax, { base }) => ax.get(base + '/large', { maxContentLength: 1000, responseType: 'arraybuffer' }),
  'maxContentLength ok': (ax, { base }) => ax.get(base + '/json', { maxContentLength: 1000 }),
  'maxContentLength exact': async (ax, { base }) => {
    const r = await ax.get(base + '/text');
    return ax.get(base + '/text', { maxContentLength: r.data.length });
  },
  'maxContentLength with gzip': (ax, { base }) => ax.get(base + '/gzip-text', { maxContentLength: 50 }),

  'latin1 charset default': (ax, { base }) => ax.get(base + '/latin1'),
  'responseEncoding latin1': (ax, { base }) => ax.get(base + '/latin1', { responseEncoding: 'latin1' }),
  'responseEncoding latin1 arraybuffer': (ax, { base }) => ax.get(base + '/latin1', { responseEncoding: 'latin1', responseType: 'arraybuffer' }),
  'responseEncoding latin1 on utf8': (ax, { base }) => ax.get(base + '/utf8', { responseEncoding: 'latin1' }),
  'responseEncoding base64': (ax, { base }) => ax.get(base + '/binary', { responseEncoding: 'base64' }),
  'responseEncoding hex on json': (ax, { base }) => ax.get(base + '/json', { responseEncoding: 'hex' }),
  'bom json': (ax, { base }) => ax.get(base + '/bom'),
  'bom text': (ax, { base }) => ax.get(base + '/bom', { responseType: 'text' }),
  'bom arraybuffer': (ax, { base }) => ax.get(base + '/bom', { responseType: 'arraybuffer' }),
  'bom with responseEncoding latin1': (ax, { base }) => ax.get(base + '/bom', { responseEncoding: 'latin1' }),

  'large response default': (ax, { base }) => ax.get(base + '/large'),
  'large response arraybuffer': (ax, { base }) => ax.get(base + '/large', { responseType: 'arraybuffer' }),
  'large response blob': (ax, { base }) => ax.get(base + '/large', { responseType: 'blob' }),
  'large text response': (ax, { base }) => ax.get(base + '/large-text'),

  'redirect 3 hops': (ax, { base }) => ax.get(base + '/hops/3'),
  'redirect maxRedirects 1 exceeded': (ax, { base }) => ax.get(base + '/hops/3', { maxRedirects: 1 }),
  'redirect maxRedirects 3 exact': (ax, { base }) => ax.get(base + '/hops/3', { maxRedirects: 3 }),
  'redirect 301 post drops body': (ax, { base }) => ax.post(base + '/redirect-to?status=301&to=/echo', { a: 1 }),
  'redirect 302 post drops body': (ax, { base }) => ax.post(base + '/redirect-to?status=302&to=/echo', 'text body'),
  'redirect 303 put becomes get': (ax, { base }) => ax.put(base + '/redirect-to?status=303&to=/echo', { a: 1 }),
  'redirect 307 keeps body': (ax, { base }) => ax.post(base + '/redirect-to?status=307&to=/echo', { a: 1 }),
  'redirect 308 keeps put body': (ax, { base }) => ax.put(base + '/redirect-to?status=308&to=/echo', 'kept'),
  'redirect 302 get keeps headers': (ax, { base }) => ax.get(base + '/redirect-to?status=302&to=/echo', { headers: { 'X-Keep': '1', Authorization: 'Bearer same' } }),
  'redirect with query': (ax, { base }) => ax.get(base + '/redirect-to?status=302&to=/echo%3Fq%3D1', { params: { p: 2 } }),
  'redirect cross origin strips authorization': (ax, { base }) =>
    ax.get(base + '/redirect-cross', { headers: { Authorization: 'Bearer secret', 'X-Custom': 'kept', Cookie: 'c=1' } }),
  'redirect cross origin with auth config': (ax, { base }) => ax.get(base + '/redirect-cross', { auth: { username: 'u', password: 'p' } }),
  'redirect same origin with auth config': (ax, { base }) => ax.get(base + '/redirect-to?status=302&to=/echo', { auth: { username: 'u', password: 'p' } }),
  'redirect cross origin post 307': (ax, { base }) => ax.post(base + '/redirect-cross?status=307', { a: 1 }),
  'redirect maxRedirects 0 on post': (ax, { base }) => ax.post(base + '/redirect-to?status=307&to=/echo', { a: 1 }, { maxRedirects: 0 }),
  'redirect maxRedirects 0 rejects by status': (ax, { base }) => ax.get(base + '/redirect', { maxRedirects: 0 }),
  'redirect to absolute url': (ax, { base }) => ax.get(base + '/redirect-absolute'),
  'redirect loop': (ax, { base }) => ax.get(base + '/hops/30', { maxRedirects: 5 }),
  'beforeRedirect hook': async (ax, { base }) => {
    const seen: unknown[] = [];
    const r = await ax.get(base + '/hops/3', {
      beforeRedirect: (options: any, details: any) => seen.push([typeof options, typeof options?.headers, details?.statusCode, typeof details?.headers]),
    });
    return custom({ seen, status: r.status, data: r.data });
  },
  'beforeRedirect hook sets header': (ax, { base }) =>
    ax.get(base + '/redirect-to?status=302&to=/echo', { beforeRedirect: (options: any) => void (options.headers['x-hooked'] = '1') }),
  'sensitiveHeaders cross origin': (ax, { base }) =>
    ax.get(base + '/redirect-cross', { sensitiveHeaders: ['X-Secret'], headers: { 'X-Secret': 's', 'X-Open': 'o' } }),
  'sensitiveHeaders same origin': (ax, { base }) =>
    ax.get(base + '/redirect-to?status=302&to=/echo', { sensitiveHeaders: ['X-Secret'], headers: { 'X-Secret': 's' } }),
  'sensitiveHeaders invalid': (ax, { base }) => ax.get(base + '/json', { sensitiveHeaders: 'nope' }),
  'sensitiveHeaders invalid entry': (ax, { base }) => ax.get(base + '/json', { sensitiveHeaders: [1] }),

  'cookie set and echo withCredentials true': async (ax, { base }) => {
    await ax.get(base + '/cookie/set?name=diffA', { withCredentials: true });
    return ax.get(base + '/cookie/echo', { withCredentials: true });
  },
  'cookie set and echo withCredentials false': async (ax, { base }) => {
    await ax.get(base + '/cookie/set?name=diffB', { withCredentials: false });
    return ax.get(base + '/cookie/echo', { withCredentials: false });
  },
  'cookie set and echo withCredentials unset': async (ax, { base }) => {
    await ax.get(base + '/cookie/set?name=diffC');
    return ax.get(base + '/cookie/echo');
  },
  'cookie manual header': (ax, { base }) => ax.get(base + '/cookie/echo', { headers: { Cookie: 'manual=1' } }),
  'xsrf with withXSRFToken true': (ax, { base }) => {
    if (typeof document !== 'undefined') document.cookie = 'XSRF-TOKEN=tok; Path=/';
    return ax.get(base + '/echo', { withXSRFToken: true });
  },
  'xsrf default cross origin': (ax, { base }) => {
    if (typeof document !== 'undefined') document.cookie = 'XSRF-TOKEN=tok; Path=/';
    return ax.get(base + '/echo');
  },
  'xsrf custom names': (ax, { base }) => {
    if (typeof document !== 'undefined') document.cookie = 'MY-XSRF=mine; Path=/';
    return ax.get(base + '/echo', { withXSRFToken: true, xsrfCookieName: 'MY-XSRF', xsrfHeaderName: 'X-My-Xsrf' });
  },
  'xsrf withXSRFToken function': (ax, { base }) => {
    if (typeof document !== 'undefined') document.cookie = 'XSRF-TOKEN=tok; Path=/';
    return ax.get(base + '/echo', { withXSRFToken: (config: any) => typeof config.url === 'string' });
  },
  'many set-cookie headers': (ax, { base }) => ax.get(base + '/headers'),
  'set-cookie as array on error': (ax, { base }) => ax.get(base + '/headers?status=418'),
};
Object.assign(responseCases, moreResponseCases);
