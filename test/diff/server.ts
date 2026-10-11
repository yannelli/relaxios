import { gzipSync } from 'node:zlib';
import { json, serve, type TestServer } from '../helpers/server';

const REQUEST_HEADERS = /^(accept|content-type|authorization|cookie|x-.*)$/;

async function parseMultipart(body: Buffer, type: string) {
  const form = await new Response(new Uint8Array(body), { headers: { 'content-type': type } }).formData();
  const fields: unknown[] = [];
  for (const [name, value] of form) {
    fields.push([name, typeof value == 'string' ? value : { file: value.name, type: value.type, size: value.size }]);
  }
  return fields;
}

/** Routes used by the differential suite. /echo returns what the server received. */
export function startDiffServer(): Promise<TestServer> {
  return serve(async (req, res, body) => {
    const url = new URL(req.url!, 'http://x');
    const path = url.pathname;
    if (path === '/echo' || path.startsWith('/echo/')) {
      const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => REQUEST_HEADERS.test(k)));
      const type = String(req.headers['content-type'] || '');
      if (type.startsWith('multipart/form-data')) headers['content-type'] = 'multipart/form-data; boundary=<b>';
      const multipart = type.startsWith('multipart/form-data') ? await parseMultipart(body, type) : undefined;
      return json(res, { method: req.method, path, query: url.search, headers, body: multipart ? undefined : body.toString(), multipart });
    }
    if (path === '/json') return json(res, { a: 1, list: [1, 2] });
    if (path === '/text') return void res.writeHead(200, { 'content-type': 'text/plain' }).end('plain text');
    if (path === '/jsontext') return void res.writeHead(200, { 'content-type': 'text/plain' }).end('{"a":1}');
    if (path === '/badjson') return void res.writeHead(200, { 'content-type': 'application/json' }).end('{bad');
    if (path.startsWith('/status/')) return json(res, { error: +path.slice(8) }, +path.slice(8));
    if (path === '/empty') return void res.writeHead(204).end();
    if (path.startsWith('/delay/')) {
      await new Promise((r) => setTimeout(r, +path.slice(7)));
      return void res.end('done');
    }
    if (path === '/headers') {
      res.setHeader('set-cookie', ['a=1; Path=/', 'b=2; Path=/']);
      return json(res, {}, 200, { 'x-custom': 'yes', 'cache-control': 'no-store' });
    }
    if (path === '/one-cookie') {
      res.setHeader('set-cookie', 'a=1; Path=/');
      return json(res, {});
    }
    if (path === '/redirect') return void res.writeHead(302, { location: '/json' }).end();
    if (path === '/gzip') {
      return void res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' }).end(gzipSync('{"zipped":true}'));
    }
    if (path === '/binary') return void res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(Buffer.from([0, 1, 2, 254, 255]));
    res.writeHead(404).end();
  });
}
