// Runtime smoke test against dist/: `node scripts/smoke.mjs`, `bun scripts/smoke.mjs`, `deno run -A scripts/smoke.mjs`.
// Plain JS so it also runs on Node 20, where the dev toolchain (vitest, tsdown) does not.
import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import process from 'node:process';
import http, { create } from 'relaxios';
import axios from 'relaxios/axios';
import { progress } from 'relaxios/progress';
import { ietf, upload } from 'relaxios/upload';

const uploads = new Map();
const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/echo') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ method: req.method, url: req.url, body: body.toString(), type: req.headers['content-type'] }));
  }
  if (url.pathname === '/download') {
    res.writeHead(200, { 'content-length': 100000 });
    return res.end(Buffer.alloc(100000, 1));
  }
  // Minimal draft-12 upload resource: creation, append, offset retrieval.
  if (url.pathname === '/uploads' && req.method === 'POST') {
    const id = String(uploads.size + 1);
    uploads.set(id, []);
    res.writeHead(201, { location: '/uploads/' + id, 'upload-complete': '?0' });
    return res.end();
  }
  const parts = uploads.get(url.pathname.split('/')[2]);
  if (req.method === 'PATCH' && parts) {
    parts.push(body);
    const done = req.headers['upload-complete'] === '?1';
    const size = parts.reduce((n, p) => n + p.length, 0);
    res.writeHead(done ? 200 : 204, { 'upload-complete': done ? '?1' : '?0', 'content-type': 'application/json' });
    return res.end(done ? JSON.stringify({ size }) : undefined);
  }
  res.writeHead(404).end();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const check = (name, ok) => {
  if (!ok) throw new Error('smoke check failed: ' + name);
  console.log('ok', name);
};

try {
  const r1 = await http.post(base + '/echo', { a: 1 }, { params: { ids: [1, 2] } });
  check('core json + params', r1.data.body === '{"a":1}' && r1.data.url === '/echo?ids=1&ids=2');
  const t = await create({ timeout: 1 }).get('http://10.255.255.1/').catch((e) => e.code);
  check('core timeout or network error', t === 'ETIMEDOUT' || t === 'ERR_NETWORK');

  const r2 = await axios.get(base + '/echo', { params: { a: [1, 2] } });
  check('axios compat bracket params', r2.data.url === '/echo?a%5B%5D=1&a%5B%5D=2' && r2.headers.get('content-type') === r2.headers['content-type']);
  const c = await axios.get(base + '/echo', { signal: AbortSignal.abort() }).catch((e) => axios.isCancel(e));
  check('axios compat cancel', c === true);

  let last;
  const res = await fetch(base + '/download');
  await new Response(res.body.pipeThrough(progress((e) => (last = e), res))).arrayBuffer();
  check('download progress', last.loaded === 100000 && last.ratio === 1);

  const file = new Blob([new Uint8Array(300000)]);
  const result = await upload(file, { protocol: ietf({ endpoint: base + '/uploads' }), chunkSize: 100000, store: false });
  check('ietf upload', result.data.size === 300000);
} finally {
  server.close();
}
console.log('smoke passed on', globalThis.Bun ? 'bun ' + Bun.version : globalThis.Deno ? 'deno ' + Deno.version.deno : 'node ' + process.version);
process.exit(0);
