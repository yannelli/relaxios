import type { IncomingMessage, ServerResponse } from 'node:http';
import { brotliCompressSync, deflateRawSync, deflateSync, gzipSync } from 'node:zlib';

// HTTP/2 compat requests and responses expose the same members, so the handler is typed for HTTP/1.
export type Req = IncomingMessage;
export type Res = ServerResponse;
export interface RouteContext {
  base: string;
  other: string;
}

const REQUEST_HEADERS = /^(accept|content-type|authorization|cookie|x-.*|user-agent|accept-encoding|host|content-length|proxy-authorization)$/;
const EXPOSED = 'content-type, content-length, content-encoding, location, x-http-version, x-custom, cache-control, x-proxied, x-proxy-auth, etag, vary, date';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

const pattern = (size: number) => {
  const bytes = Buffer.alloc(size);
  for (let i = 0; i < size; i++) bytes[i] = i & 255;
  return bytes;
};
const LARGE = pattern(1 << 20);
const LARGE_TEXT = 'abcdefghij'.repeat((1 << 20) / 10);

export const json = (res: Res, value: unknown, status = 200, headers: Record<string, string | number> = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(value));
};

const send = (res: Res, status: number, headers: Record<string, string | number>, body?: string | Buffer) => {
  res.writeHead(status, headers);
  res.end(body);
};

async function parseMultipart(body: Buffer, type: string) {
  const form = await new Response(new Uint8Array(body), { headers: { 'content-type': type } }).formData();
  const fields: unknown[] = [];
  for (const [name, value] of form) {
    if (typeof value == 'string') fields.push([name, value]);
    else fields.push([name, { file: value.name, type: value.type, size: value.size, content: Buffer.from(await value.arrayBuffer()).toString('base64') }]);
  }
  return fields;
}

/** CORS for any origin, with credentials, exposing every header the routes send. */
export function cors(req: Req, res: Res) {
  const origin = req.headers.origin as string | undefined;
  if (!origin) return;
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('access-control-allow-credentials', 'true');
  res.setHeader('access-control-allow-headers', (req.headers['access-control-request-headers'] as string) || 'content-type, authorization');
  res.setHeader('access-control-allow-methods', (req.headers['access-control-request-method'] as string) || 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS');
  res.setHeader('access-control-expose-headers', EXPOSED);
  res.setHeader('timing-allow-origin', '*');
  if (req.headers['access-control-request-private-network']) res.setHeader('access-control-allow-private-network', 'true');
}

function multipartBody() {
  const b = 'diffboundary';
  return [`--${b}`, 'Content-Disposition: form-data; name="field"', '', 'value', `--${b}`, 'Content-Disposition: form-data; name="file"; filename="a.txt"', 'Content-Type: text/plain', '', 'file text', `--${b}--`, ''].join('\r\n');
}

async function echo(req: Req, res: Res, body: Buffer, url: URL) {
  const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => REQUEST_HEADERS.test(k)));
  const type = String(req.headers['content-type'] || '');
  const isMultipart = type.startsWith('multipart/form-data');
  let bodyLength = body.length;
  let multipart: unknown;
  if (isMultipart) {
    // Some boundaries (Gecko's) vary in length per request, so lengths are measured with the boundary replaced.
    const boundary = /boundary=([^;]+)/i.exec(type)?.[1];
    bodyLength = boundary ? body.toString('latin1').split(boundary).join('<b>').length : body.length;
    if (headers['content-length'] === String(body.length)) headers['content-length'] = String(bodyLength);
    headers['content-type'] = 'multipart/form-data; boundary=<b>';
    multipart = await parseMultipart(body, type).catch((e) => ({ parseError: String(e.message) }));
  }
  json(res, { method: req.method, path: url.pathname, query: url.search, headers, body: multipart ? undefined : body.toString(), bodyLength, multipart });
}

/** Every route the differential cases use; shared by the main, second, HTTP/2 and unix socket listeners. */
export async function handle(req: Req, res: Res, body: Buffer, ctx: RouteContext): Promise<void> {
  const url = new URL(req.url!, 'http://x');
  const path = url.pathname;
  const q = url.searchParams;
  res.setHeader('x-http-version', req.httpVersion);
  if (path === '/echo' || path.startsWith('/echo/')) return echo(req, res, body, url);
  if (path === '/json') return json(res, { a: 1, list: [1, 2] });
  if (path === '/text') return send(res, 200, { 'content-type': 'text/plain' }, 'plain text');
  if (path === '/jsontext') return send(res, 200, { 'content-type': 'text/plain' }, '{"a":1}');
  if (path === '/badjson') return send(res, 200, { 'content-type': 'application/json' }, '{bad');
  if (path.startsWith('/status/')) return json(res, { error: +path.slice(8) }, +path.slice(8));
  if (path === '/empty') return send(res, 204, {});
  if (path.startsWith('/delay/')) {
    await sleep(+path.slice(7));
    return send(res, 200, { 'content-type': 'text/plain' }, 'done');
  }
  if (path === '/headers') {
    res.setHeader('set-cookie', ['a=1; Path=/', 'b=2; Path=/']);
    return json(res, {}, +(q.get('status') || 200), { 'x-custom': 'yes', 'cache-control': 'no-store' });
  }
  if (path === '/one-cookie') {
    res.setHeader('set-cookie', 'a=1; Path=/');
    return json(res, {});
  }
  if (path === '/redirect') return send(res, 302, { location: '/json' });
  if (path === '/redirect-to') return send(res, +(q.get('status') || 302), { location: q.get('to') || '/json' });
  if (path === '/redirect-cross') return send(res, +(q.get('status') || 302), { location: ctx.other + '/echo' });
  if (path === '/redirect-absolute') return send(res, 302, { location: ctx.base + '/json' });
  if (path.startsWith('/hops/')) {
    const n = +path.slice(6);
    return n > 0 ? send(res, 302, { location: `/hops/${n - 1}` }) : json(res, { hops: 'done' });
  }
  if (path === '/gzip') return send(res, 200, { 'content-type': 'application/json', 'content-encoding': 'gzip' }, gzipSync('{"zipped":true}'));
  if (path === '/gzip-text') {
    const zipped = gzipSync('gzipped text body');
    return send(res, 200, { 'content-type': 'text/plain', 'content-encoding': 'gzip', 'content-length': zipped.length }, zipped);
  }
  if (path === '/brotli') return send(res, 200, { 'content-type': 'application/json', 'content-encoding': 'br' }, brotliCompressSync('{"br":true}'));
  if (path === '/deflate') return send(res, 200, { 'content-type': 'application/json', 'content-encoding': 'deflate' }, deflateSync('{"deflate":true}'));
  if (path === '/deflate-raw') return send(res, 200, { 'content-type': 'application/json', 'content-encoding': 'deflate' }, deflateRawSync('{"raw":true}'));
  if (path === '/head-gzip') {
    const zipped = gzipSync('head body');
    return send(res, 200, { 'content-type': 'text/plain', 'content-encoding': 'gzip', 'content-length': zipped.length }, req.method === 'HEAD' ? undefined : zipped);
  }
  if (path === '/empty-gzip') return send(res, 204, { 'content-encoding': 'gzip' });
  if (path === '/bad-encoding') return send(res, 200, { 'content-type': 'text/plain', 'content-encoding': 'unknownenc' }, 'plain despite header');
  if (path === '/corrupt-gzip') return send(res, 200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' }, 'not gzip at all');
  if (path === '/binary') return send(res, 200, { 'content-type': 'application/octet-stream' }, Buffer.from([0, 1, 2, 254, 255]));
  if (path === '/large') return send(res, 200, { 'content-type': 'application/octet-stream', 'content-length': LARGE.length }, LARGE);
  if (path === '/large-text') return send(res, 200, { 'content-type': 'text/plain', 'content-length': LARGE_TEXT.length }, LARGE_TEXT);
  if (path === '/chunked') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    for (const part of ['chunk-1,', 'chunk-2,', 'chunk-3']) {
      res.write(part);
      await sleep(5);
    }
    return void res.end();
  }
  if (path === '/slow') {
    const chunks = +(q.get('chunks') || 5);
    const size = +(q.get('size') || 100);
    const delay = +(q.get('delay') || 50);
    await sleep(+(q.get('first') || 0));
    res.writeHead(200, { 'content-type': 'text/plain', 'content-length': chunks * size });
    for (let i = 0; i < chunks; i++) {
      res.write(Buffer.alloc(size, 97 + (i % 26)));
      await sleep(delay);
    }
    return void res.end();
  }
  if (path === '/latin1') return send(res, 200, { 'content-type': 'text/plain; charset=iso-8859-1' }, Buffer.from('café ñ', 'latin1'));
  if (path === '/utf8') return send(res, 200, { 'content-type': 'text/plain; charset=utf-8' }, 'héllo ✓ 日本');
  if (path === '/bom') return send(res, 200, { 'content-type': 'application/json' }, Buffer.concat([BOM, Buffer.from('{"bom":true}')]));
  if (path === '/html') return send(res, 200, { 'content-type': 'text/html' }, '<!doctype html><html><head><title>t</title></head><body><p id="p">hi</p></body></html>');
  if (path === '/xml') return send(res, 200, { 'content-type': 'application/xml' }, '<?xml version="1.0"?><root><item id="1">x</item></root>');
  if (path === '/multipart') return send(res, 200, { 'content-type': 'multipart/form-data; boundary=diffboundary' }, multipartBody());
  if (path === '/no-type') return send(res, 200, {}, 'raw text');
  if (path === '/cookie/set') {
    res.setHeader('set-cookie', `${q.get('name') || 'diff'}=1; Path=/; Max-Age=3600`);
    return json(res, { set: q.get('name') || 'diff' });
  }
  if (path === '/cookie/echo') return json(res, { cookie: req.headers.cookie ?? null });
  send(res, 404, { 'content-type': 'text/plain' }, 'not found: ' + path);
}
