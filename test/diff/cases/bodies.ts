import { byteStream, custom, pattern, type Case } from './shared';

class Bytes extends Uint8Array {}

// Request bodies: binary, Blob, File, FormData, streams, form serialization and size limits.
export const bodyCases: Record<string, Case> = {
  'post File': (ax, { base }) => ax.post(base + '/echo', new File(['file body'], 'f.txt', { type: 'text/csv' })),
  'post Blob without type': (ax, { base }) => ax.post(base + '/echo', new Blob(['no type'])),
  'post empty Blob': (ax, { base }) => ax.post(base + '/echo', new Blob([], { type: 'text/plain' })),
  'post Blob with content-type header': (ax, { base }) =>
    ax.post(base + '/echo', new Blob(['typed'], { type: 'text/plain' }), { headers: { 'Content-Type': 'application/custom' } }),
  'post ArrayBuffer': (ax, { base }) => ax.post(base + '/echo', pattern(8).buffer),
  'post ArrayBuffer with content-type': (ax, { base }) =>
    ax.post(base + '/echo', new TextEncoder().encode('buf').buffer, { headers: { 'Content-Type': 'text/plain' } }),
  'post DataView': (ax, { base }) => ax.post(base + '/echo', new DataView(new TextEncoder().encode('view').buffer)),
  'post Uint16Array': (ax, { base }) => ax.post(base + '/echo', new Uint16Array([97, 98])),
  'post Uint8Array subarray': (ax, { base }) => ax.post(base + '/echo', new TextEncoder().encode('xxhelloxx').subarray(2, 7)),
  'post Uint8Array subclass': (ax, { base }) => ax.post(base + '/echo', Bytes.from(new TextEncoder().encode('sub'))),
  'post binary Uint8Array': (ax, { base }) => ax.post(base + '/echo', pattern(300)),
  'post ReadableStream': (ax, { base }) => ax.post(base + '/echo', byteStream(3, 10)),
  'post ReadableStream with content-type': (ax, { base }) =>
    ax.post(base + '/echo', byteStream(2, 5), { headers: { 'Content-Type': 'application/octet-stream' } }),
  'post ReadableStream with upload progress': async (ax, { base }) => {
    const events: any[] = [];
    const r = await ax.post(base + '/echo', byteStream(4, 1000), { onUploadProgress: (e: any) => events.push(e) }).catch((e: any) => e);
    return custom({ data: r.data ?? null, code: r.code, events: events.length > 0 });
  },
  'post Response object': (ax, { base }) => ax.post(base + '/echo', new Response('from response')),
  'post Date': (ax, { base }) => ax.post(base + '/echo', new Date(0)),
  'post boolean': (ax, { base }) => ax.post(base + '/echo', true),
  'post Map': (ax, { base }) => ax.post(base + '/echo', new Map([['a', 1]])),
  'post object with toJSON': (ax, { base }) => ax.post(base + '/echo', { toJSON: () => ({ serialized: true }) }),
  'post string with text/plain': (ax, { base }) => ax.post(base + '/echo', 'plain', { headers: { 'Content-Type': 'text/plain' } }),
  'post json with charset content-type': (ax, { base }) =>
    ax.post(base + '/echo', { a: 1 }, { headers: { 'Content-Type': 'application/json; charset=utf-8' } }),
  'post URLSearchParams with custom type': (ax, { base }) =>
    ax.post(base + '/echo', new URLSearchParams({ a: '1' }), { headers: { 'Content-Type': 'text/plain' } }),
  'post unicode string': (ax, { base }) => ax.post(base + '/echo', 'héllo ✓ 日本'),
  'post unicode json': (ax, { base }) => ax.post(base + '/echo', { s: 'héllo ✓ 日本' }),
  'post empty string': (ax, { base }) => ax.post(base + '/echo', ''),
  'post zero': (ax, { base }) => ax.post(base + '/echo', 0),
  'post undefined with content-type': (ax, { base }) => ax.post(base + '/echo', undefined, { headers: { 'Content-Type': 'text/plain' } }),

  'post FormData with File': (ax, { base }) => {
    const form = new FormData();
    form.append('f', new File(['file content'], 'name.txt', { type: 'text/plain' }));
    return ax.post(base + '/echo', form);
  },
  'post FormData files and fields': (ax, { base }) => {
    const form = new FormData();
    form.append('a', '1');
    form.append('a', '2');
    form.append('text', 'line1\nline2');
    form.append('bin', new Blob([pattern(16)], { type: 'application/octet-stream' }), 'bin.dat');
    form.append('renamed', new File(['x'], 'orig.txt'), 'new.txt');
    return ax.post(base + '/echo', form);
  },
  'post FormData with custom boundary header': (ax, { base }) => {
    const form = new FormData();
    form.append('a', '1');
    return ax.post(base + '/echo', form, { headers: { 'Content-Type': 'multipart/form-data; boundary=diff-boundary-0123456789' } });
  },
  'post FormData with multipart header without boundary': (ax, { base }) => {
    const form = new FormData();
    form.append('a', '1');
    return ax.post(base + '/echo', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  'post FormData quoted names': (ax, { base }) => {
    const form = new FormData();
    form.append('na"me', 'v');
    form.append('nested[a][b]', 'deep');
    return ax.post(base + '/echo', form);
  },
  'post empty FormData': (ax, { base }) => ax.post(base + '/echo', new FormData()),
  'put FormData': (ax, { base }) => {
    const form = new FormData();
    form.append('m', 'put');
    return ax.put(base + '/echo', form);
  },
  'postForm nested with dots': (ax, { base }) =>
    ax.postForm(base + '/echo', { a: { b: { c: 1 } }, list: [1, 2] }, { formSerializer: { dots: true } }),
  'postForm indexes true': (ax, { base }) => ax.postForm(base + '/echo', { list: [1, 2], obj: { arr: ['x'] } }, { formSerializer: { indexes: true } }),
  'postForm indexes null': (ax, { base }) => ax.postForm(base + '/echo', { list: [1, 2] }, { formSerializer: { indexes: null } }),
  'postForm metaTokens false': (ax, { base }) => ax.postForm(base + '/echo', { 'list{}': [1, 2], 'a{}': { b: 1 } }, { formSerializer: { metaTokens: false } }),
  'postForm metaTokens default': (ax, { base }) => ax.postForm(base + '/echo', { 'list{}': [1, 2] }),
  'postForm with custom visitor': (ax, { base }) =>
    ax.postForm(base + '/echo', { a: 1, b: 'x' }, { formSerializer: { visitor: (value: unknown, key: string, path: unknown, helpers: any) => (helpers.defaultVisitor.call(helpers, String(value).toUpperCase(), key + '_v', path, helpers), false) } }),
  'postForm with File': (ax, { base }) => ax.postForm(base + '/echo', { file: new File(['ff'], 'ff.txt', { type: 'text/plain' }), name: 'n' }),
  'postForm with Date, null and booleans': (ax, { base }) => ax.postForm(base + '/echo', { d: new Date(0), n: null, t: true, f: false, u: undefined }),
  'postForm with Uint8Array': (ax, { base }) => ax.postForm(base + '/echo', { bytes: new TextEncoder().encode('ab') }),
  'postForm with array of Blobs': (ax, { base }) => ax.postForm(base + '/echo', { files: [new Blob(['1']), new Blob(['2'])] }),
  'postForm with FormData instance': (ax, { base }) => {
    const form = new FormData();
    form.append('direct', 'yes');
    return ax.postForm(base + '/echo', form);
  },
  'postForm with string': (ax, { base }) => ax.postForm(base + '/echo', 'just a string'),
  'putForm and patchForm': async (ax, { base }) => [await ax.putForm(base + '/echo', { p: 1 }), await ax.patchForm(base + '/echo', { q: 2 })],
  'urlencoded with formSerializer dots': (ax, { base }) =>
    ax.post(base + '/echo', { a: { b: [1, 2] } }, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, formSerializer: { dots: true, indexes: true } }),
  'urlencoded nested default': (ax, { base }) =>
    ax.post(base + '/echo', { a: { b: [1, 2] }, d: new Date(0), n: null }, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }),
  'env.FormData custom class': async (ax, { base }) => {
    let constructed = 0;
    class TaggedFormData extends FormData {
      constructor() {
        super();
        constructed++;
      }
    }
    const r = await ax.postForm(base + '/echo', { a: 1, b: [2, 3] }, { env: { FormData: TaggedFormData } });
    return custom({ constructed, data: r.data });
  },
  'toFormData static': async (ax) => {
    const form = ax.toFormData({ a: 1, b: [1, 2], c: { d: 'e' }, f: new Blob(['x']) }, new FormData(), { dots: true, indexes: true });
    const entries: unknown[] = [];
    for (const [k, v] of form as any) entries.push([k, typeof v === 'string' ? v : { size: v.size, name: v.name, type: v.type }]);
    return custom(entries);
  },
  'toFormData with HTML form unavailable': async (ax) => custom(typeof ax.toFormData),
  'formToJSON static': async (ax) => {
    const form = new FormData();
    form.append('a[b]', '1');
    form.append('list[]', 'x');
    form.append('list[]', 'y');
    return custom(ax.formToJSON(form));
  },

  'content-length override matching': (ax, { base }) => ax.post(base + '/echo', 'hello', { headers: { 'Content-Length': '5' } }),
  'content-length header on get': (ax, { base }) => ax.get(base + '/echo', { headers: { 'Content-Length': '0' } }),
  'content-length header with FormData': (ax, { base }) => {
    const form = new FormData();
    form.append('a', '1');
    return ax.post(base + '/echo', form, { headers: { 'Content-Length': '999' } });
  },
  'maxRate array': (ax, { base }) => ax.post(base + '/echo', 'r'.repeat(20_000), { maxRate: [1_000_000, 1_000_000] }),
  'maxRate number with download': (ax, { base }) => ax.get(base + '/binary', { maxRate: 1_000_000 }),
  'maxRate with upload progress': async (ax, { base }) => {
    const events: any[] = [];
    const r = await ax.post(base + '/echo', 'r'.repeat(20_000), { maxRate: 2_000_000, onUploadProgress: (e: any) => events.push(e) });
    return custom({ events: events.length > 0, bodyLength: r.data.bodyLength });
  },
  'maxBodyLength stream body': (ax, { base }) => ax.post(base + '/echo', byteStream(10, 100), { maxBodyLength: 10 }),
  'maxBodyLength exact': (ax, { base }) => ax.post(base + '/echo', 'x'.repeat(10), { maxBodyLength: 10 }),
  'maxBodyLength Blob': (ax, { base }) => ax.post(base + '/echo', new Blob(['x'.repeat(100)]), { maxBodyLength: 10 }),
  'maxBodyLength FormData': (ax, { base }) => {
    const form = new FormData();
    form.append('a', 'x'.repeat(100));
    return ax.post(base + '/echo', form, { maxBodyLength: 10 });
  },
  'maxBodyLength json': (ax, { base }) => ax.post(base + '/echo', { big: 'x'.repeat(100) }, { maxBodyLength: 10 }),
  'maxBodyLength on get': (ax, { base }) => ax.get(base + '/echo', { maxBodyLength: 1 }),
  'maxBodyLength with redirect': (ax, { base }) => ax.post(base + '/redirect-to?status=307&to=/echo', 'x'.repeat(100), { maxBodyLength: 10 }),
  'maxBodyLength Uint8Array': (ax, { base }) => ax.post(base + '/echo', pattern(100), { maxBodyLength: 10 }),
  'transformRequest returning Blob': (ax, { base }) =>
    ax.post(base + '/echo', { a: 1 }, { transformRequest: [(d: any) => new Blob([JSON.stringify(d)], { type: 'application/json' })] }),
  'transformRequest returning object': (ax, { base }) => ax.post(base + '/echo', 'x', { transformRequest: [() => ({ obj: true })] }),
  'transformResponse receiving stream': (ax, { base }) =>
    ax.get(base + '/text', {
      responseType: 'stream',
      transformResponse: [
        (d: any) => ({
          ctor: d?.constructor?.name,
          readable: typeof ReadableStream !== 'undefined' && d instanceof ReadableStream,
          pipe: typeof d?.pipe,
        }),
      ],
    }),
  'query method': (ax, { base }) => ax.query(base + '/echo', { q: 1 }),
  'query method with FormData': (ax, { base }) => {
    const form = new FormData();
    form.append('q', '1');
    return ax.query(base + '/echo', form);
  },
};
