import http, { create, HttpError, isCancel, mergeConfig, buildURL } from 'relaxios';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { echo, json, serve, type TestServer } from './helpers/server';

let server: TestServer;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  server = await serve(async (req, res, body) => {
    const path = new URL(req.url!, 'http://x').pathname;
    if (path === '/text') return void res.end('hello');
    if (path === '/bad-json') {
      res.setHeader('content-type', 'application/json');
      return void res.end('{oops');
    }
    if (path.startsWith('/status/')) return json(res, { status: +path.slice(8) }, +path.slice(8));
    if (path === '/slow') {
      await delay(300);
      return void res.end('late');
    }
    if (path === '/empty') return void res.writeHead(204).end();
    return echo(req, res, body);
  });
});
afterAll(() => server.close());

describe('core request', () => {
  it('joins baseURL, serializes params, parses JSON', async () => {
    const api = create({ baseURL: server.url + '/api/', params: { a: 1 } });
    const res = await api.get('/echo', { params: { ids: [1, 2], skip: null, d: new Date(0) } });
    expect(res.status).toBe(200);
    expect(res.data.url).toBe('/api/echo?a=1&ids=1&ids=2&d=1970-01-01T00%3A00%3A00.000Z');
    expect(res.headers).toBeInstanceOf(Headers);
    expect(res.request.method).toBe('GET');
  });

  it('keeps absolute URLs unless allowAbsoluteUrls is false', () => {
    expect(buildURL({ baseURL: 'http://a', url: 'http://b/x' })).toBe('http://b/x');
    expect(buildURL({ baseURL: 'http://a/', url: 'http://b/x', allowAbsoluteUrls: false })).toBe('http://a/http://b/x');
    expect(buildURL({ url: '/x?y=1#frag', params: { z: 2 } })).toBe('/x?y=1&z=2');
  });

  it('encodes plain objects as JSON and passes other bodies through', async () => {
    const r1 = await http.post(server.url, { a: [1] });
    expect(r1.data.headers['content-type']).toBe('application/json');
    expect(JSON.parse(r1.data.body)).toEqual({ a: [1] });

    const form = new FormData();
    form.append('f', new Blob(['xyz']), 'f.txt');
    const r2 = await http.put(server.url, form);
    expect(r2.data.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
    expect(r2.data.body).toContain('xyz');

    const r3 = await http.patch(server.url, new URLSearchParams({ q: 'a b' }));
    expect(r3.data.headers['content-type']).toMatch(/x-www-form-urlencoded/);
    expect(r3.data.body).toBe('q=a+b');

    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('streamed'));
        c.close();
      },
    });
    const r4 = await http.post(server.url, stream);
    expect(r4.data.body).toBe('streamed');
  });

  it('supports response types', async () => {
    expect((await http.get(server.url + '/text')).data).toBe('hello');
    expect((await http.get(server.url + '/text', { responseType: 'blob' })).data).toBeInstanceOf(Blob);
    const buf = (await http.get(server.url + '/text', { responseType: 'arrayBuffer' })).data;
    expect(new TextDecoder().decode(buf)).toBe('hello');
    const stream = (await http.get(server.url + '/text', { responseType: 'stream' })).data as ReadableStream;
    expect(await new Response(stream).text()).toBe('hello');
    expect((await http.get(server.url + '/empty')).data).toBe('');
    await expect(http.get(server.url + '/bad-json')).rejects.toMatchObject({ code: 'ERR_BAD_RESPONSE' });
  });

  it('rejects by validateStatus', async () => {
    const e404 = await http.get(server.url + '/status/404').catch((e) => e);
    expect(e404).toBeInstanceOf(HttpError);
    expect(e404).toMatchObject({ code: 'ERR_BAD_REQUEST', status: 404, message: 'Request failed with status code 404' });
    expect(e404.response.data).toEqual({ status: 404 });
    await expect(http.get(server.url + '/status/503')).rejects.toMatchObject({ code: 'ERR_BAD_RESPONSE' });
    expect((await http.get(server.url + '/status/500', { validateStatus: null })).status).toBe(500);
  });

  it('times out, cancels, and reports network errors', async () => {
    const t = await http.get(server.url + '/slow', { timeout: 50 }).catch((e) => e);
    expect(t).toMatchObject({ code: 'ETIMEDOUT', message: 'timeout of 50ms exceeded' });
    expect(isCancel(t)).toBe(false);

    const controller = new AbortController();
    const p = http.get(server.url + '/slow', { signal: controller.signal, timeout: 5000 });
    controller.abort();
    const c = await p.catch((e) => e);
    expect(c.code).toBe('ERR_CANCELED');
    expect(isCancel(c)).toBe(true);

    const n = await http.get('http://127.0.0.1:1/').catch((e) => e);
    expect(n).toMatchObject({ code: 'ERR_NETWORK', message: 'Network Error' });
    expect(n.request.url).toBe('http://127.0.0.1:1/');
  });
});

describe('create, defaults and interceptors', () => {
  it('merges headers case-insensitively without mutating defaults', async () => {
    const api = create({ baseURL: server.url, headers: { 'X-Token': 'a', Accept: 'text/plain' } });
    const child = api.create({ headers: { 'x-token': 'b' } });
    const res = await child.get('/', { headers: { 'X-Extra': 1, accept: null } });
    expect(res.data.headers['x-token']).toBe('b');
    expect(res.data.headers['x-extra']).toBe('1');
    expect(res.data.headers.accept).toBe('*/*');
    expect(api.defaults.headers).toEqual({ 'X-Token': 'a', Accept: 'text/plain' });
  });

  it('does not inherit url or data, and ignores undefined', () => {
    const merged = mergeConfig({ url: '/a', data: 1, timeout: 5 }, { timeout: undefined, method: 'post' });
    expect(merged).toEqual({ timeout: 5, method: 'post' });
  });

  it('runs request interceptors newest first and response interceptors oldest first', async () => {
    const api = create({ baseURL: server.url });
    const order: string[] = [];
    api.interceptors.request.use((c) => (order.push('req1'), c));
    const id = api.interceptors.request.use((c) => (order.push('ejected'), c));
    api.interceptors.request.use((c) => (order.push('req3'), c));
    api.interceptors.request.use((c) => (order.push('skipped'), c), null, { runWhen: () => false });
    api.interceptors.request.eject(id);
    api.interceptors.response.use((r) => (order.push('res1'), r));
    api.interceptors.response.use((r) => (order.push('res2'), r));
    await api.get('/');
    expect(order).toEqual(['req3', 'req1', 'res1', 'res2']);
  });

  it('lets rejected handlers recover', async () => {
    const api = create({ baseURL: server.url });
    api.interceptors.response.use(null, (e: HttpError) => ({ data: 'recovered', status: e.status }));
    const res = await api.get('/status/500');
    expect(res).toEqual({ data: 'recovered', status: 500 });
  });

  it('accepts a URL string as the first argument', async () => {
    const api = create({ baseURL: server.url });
    expect((await api('/text')).data).toBe('hello');
    expect((await api({ url: '/text', method: 'GET' })).data).toBe('hello');
  });
});
