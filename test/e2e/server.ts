import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';

// Test server for the Playwright suite. Runs with Node 23.6+ type stripping.
// The page is served from localhost:4173; 127.0.0.1:4173 is a second origin for CORS cases.
const PORT = 4173;
const root = new URL('../../', import.meta.url);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const page = `<!doctype html>
<meta charset="utf-8">
<script type="importmap">
{ "imports": {
  "relaxios": "/dist/index.js",
  "relaxios/axios": "/dist/axios.browser.js",
  "relaxios/progress": "/dist/progress.js",
  "relaxios/upload": "/dist/upload.js",
  "axios": "/vendor/axios.js"
} }
</script>
<script type="module">
  const [core, compat, progress, upload, axios] = await Promise.all(
    ['relaxios', 'relaxios/axios', 'relaxios/progress', 'relaxios/upload', 'axios'].map((m) => import(m)),
  );
  Object.assign(window, { core, compat: compat.default, progress, upload, axios: axios.default });
  window.ready = true;
</script>`;

function cors(req: IncomingMessage, res: ServerResponse) {
  if (!req.headers.origin) return;
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Encoding, ETag');
}

async function readSlowly(req: IncomingMessage, delay: number) {
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (delay) await sleep(delay);
  }
  return size;
}

createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (e) {
    // An aborted request body must not take the whole server down.
    if (!res.headersSent) res.writeHead(500);
    res.end(String(e));
  }
}).listen(PORT, () => console.log(`e2e server on http://localhost:${PORT}`));

async function route(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url!, 'http://x');
  const q = url.searchParams;
  cors(req, res);
  if (req.method === 'OPTIONS') return void res.writeHead(204).end();
  if (url.pathname === '/health') return void res.end('ok');
  if (url.pathname === '/') return void res.writeHead(200, { 'content-type': 'text/html' }).end(page);
  if (url.pathname.startsWith('/dist/') || url.pathname === '/vendor/axios.js') {
    const file = url.pathname === '/vendor/axios.js' ? 'node_modules/axios/dist/esm/axios.js' : url.pathname.slice(1);
    try {
      const body = await readFile(new URL(file, root));
      return void res.writeHead(200, { 'content-type': file.endsWith('.map') ? 'application/json' : 'text/javascript' }).end(body);
    } catch {
      return void res.writeHead(404).end();
    }
  }
  if (url.pathname === '/download') {
    const size = Number(q.get('size') || 1 << 20);
    const chunk = Number(q.get('chunk') || 1 << 16);
    const body = Buffer.alloc(size, 'x');
    if (q.get('gzip')) {
      const zipped = gzipSync(body);
      return void res.writeHead(200, { 'content-encoding': 'gzip', 'content-length': zipped.length, 'content-type': 'text/plain' }).end(zipped);
    }
    res.writeHead(200, { 'content-length': size, 'content-type': 'application/octet-stream' });
    for (let i = 0; i < size; i += chunk) {
      res.write(body.subarray(i, i + chunk));
      await sleep(Number(q.get('delay') || 0));
    }
    return void res.end();
  }
  if (url.pathname === '/xsrf/set') {
    res.setHeader('set-cookie', `${q.get('name') || 'XSRF-TOKEN'}=${encodeURIComponent(q.get('value') || 'token')}; Path=/`);
    return void res.end('ok');
  }
  if (url.pathname === '/echo') {
    await readSlowly(req, 0);
    return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ method: req.method, headers: req.headers }));
  }
  if (url.pathname === '/upload') {
    const size = await readSlowly(req, Number(q.get('delay') || 0));
    const body = JSON.stringify({ size, type: req.headers['content-type'] });
    return void res.writeHead(Number(q.get('status') || 200), { 'content-type': 'application/json' }).end(body);
  }
  res.writeHead(404).end();
}
