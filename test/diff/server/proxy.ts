import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { connect } from 'node:net';

export interface ProxyServer {
  host: string;
  port: number;
  close(): Promise<void>;
}

/** A forward proxy: absolute-URL requests are relayed with `x-proxied: 1`, CONNECT tunnels raw bytes. */
export function startProxy(): Promise<ProxyServer> {
  const server: Server = createServer((req, res) => {
    if (!/^https?:\/\//i.test(req.url || '')) return void res.writeHead(400, { 'content-type': 'text/plain' }).end('proxy expects absolute URLs');
    const target = new URL(req.url!);
    const headers: Record<string, string | string[] | undefined> = { ...req.headers, 'x-proxied': '1' };
    if (headers['proxy-authorization']) {
      headers['x-proxy-auth'] = headers['proxy-authorization'];
      delete headers['proxy-authorization'];
    }
    delete headers['proxy-connection'];
    const upstream = httpRequest(
      { host: target.hostname, port: target.port || 80, method: req.method, path: target.pathname + target.search, headers },
      (ures) => {
        res.writeHead(ures.statusCode!, ures.statusMessage, ures.headers);
        ures.pipe(res);
      },
    );
    upstream.on('error', (e) => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('proxy error: ' + e.message);
    });
    req.pipe(upstream);
  });
  server.on('connect', (req, socket, head) => {
    const [host, port] = (req.url || '').split(':');
    const upstream = connect(+port || 443, host, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        host: '127.0.0.1',
        port: (server.address() as AddressInfo).port,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      }),
    ),
  );
}
