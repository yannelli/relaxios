import { unlinkSync } from 'node:fs';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createHttp2Server, type Http2Server, type ServerHttp2Session } from 'node:http2';
import { createServer as createNetServer, type AddressInfo, type Server as NetServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Duplex } from 'node:stream';
import { startProxy } from './server/proxy';
import { cors, handle, type Req, type Res, type RouteContext } from './server/routes';

export interface ServerEnv {
  base: string;
  other: string;
  proxy: { host: string; port: number };
  h2: string;
  socketPath?: string;
}

export interface DiffServer {
  env: ServerEnv;
  close(): Promise<void>;
}

function makeHandler(ctx: RouteContext) {
  return async (req: Req, res: Res) => {
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of req as AsyncIterable<Buffer>) chunks.push(chunk);
    } catch {
      return void res.destroy();
    }
    cors(req, res);
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();
    try {
      await handle(req, res, Buffer.concat(chunks), ctx);
    } catch (e) {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(String(e));
    }
  };
}

const listen = (server: Server | NetServer, where: number | string) =>
  new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    if (typeof where === 'string') server.listen(where, resolve);
    else server.listen(where, '127.0.0.1', resolve);
  });

const origin = (server: Server | NetServer) => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const closeServer = (server: Server | Http2Server | NetServer | undefined) =>
  new Promise<void>((resolve) => {
    if (!server) return resolve();
    if ('closeAllConnections' in server) server.closeAllConnections();
    server.close(() => resolve());
  });

// The HTTP/2 server reads its socket natively and would miss unshifted bytes, so the sniffed
// preface is replayed through a Duplex that forwards the rest of the socket.
function replay(socket: Socket, first: Buffer): Duplex {
  const duplex = new Duplex({
    read: () => void socket.resume(),
    write: (chunk, encoding, cb) => void socket.write(chunk, encoding, cb),
    final: (cb) => void socket.end(cb),
    destroy: (err, cb) => (socket.destroy(), cb(err)),
  });
  duplex.push(first);
  socket.on('data', (chunk) => void (duplex.push(chunk) || socket.pause()));
  socket.on('end', () => void duplex.push(null));
  socket.on('error', (e) => void duplex.destroy(e));
  socket.on('close', () => void duplex.destroy());
  return duplex;
}

// Cleartext HTTP/2 has no ALPN, so the h2c port sniffs the connection preface and hands the socket
// to an HTTP/2 or an HTTP/1.1 server. Browsers and fetch then reach the same routes over HTTP/1.1.
function startH2c(handler: (req: Req, res: Res) => Promise<void>) {
  const h2 = createHttp2Server(handler as any);
  const h1 = createHttpServer(handler);
  const sessions = new Set<ServerHttp2Session>();
  h2.on('session', (session) => {
    sessions.add(session);
    session.once('close', () => sessions.delete(session));
  });
  const mux = createNetServer((socket: Socket) => {
    socket.once('data', (chunk: Buffer) => {
      socket.pause();
      if (chunk.subarray(0, 3).toString() === 'PRI') h2.emit('connection', replay(socket, chunk));
      else {
        socket.unshift(chunk);
        h1.emit('connection', socket);
      }
      socket.resume();
    });
    socket.on('error', () => {});
  });
  return {
    mux,
    close: async () => {
      for (const session of sessions) session.destroy();
      await Promise.all([closeServer(h1), closeServer(h2), closeServer(mux)]);
    },
  };
}

/** Starts the main server, a second origin, a forward proxy, an h2c listener and (on Node) a unix socket. */
export async function startDiffServer(): Promise<DiffServer> {
  const ctx: RouteContext = { base: '', other: '' };
  const handler = makeHandler(ctx);
  const main = createHttpServer(handler);
  const other = createHttpServer(handler);
  const h2c = startH2c(handler);
  await Promise.all([listen(main, 0), listen(other, 0), listen(h2c.mux, 0)]);
  ctx.base = origin(main);
  ctx.other = origin(other);

  let socketPath: string | undefined;
  let socketServer: Server | undefined;
  if (process.platform !== 'win32') {
    socketPath = join(tmpdir(), `relaxios-diff-${process.pid}-${Date.now()}.sock`);
    socketServer = createHttpServer(handler);
    await listen(socketServer, socketPath).catch(() => {
      socketPath = undefined;
      socketServer = undefined;
    });
  }
  const proxy = await startProxy();

  return {
    env: { base: ctx.base, other: ctx.other, proxy: { host: proxy.host, port: proxy.port }, h2: origin(h2c.mux), socketPath },
    close: async () => {
      await Promise.all([closeServer(main), closeServer(other), h2c.close(), closeServer(socketServer), proxy.close()]);
      if (socketPath) {
        try {
          unlinkSync(socketPath);
        } catch {}
      }
    },
  };
}
