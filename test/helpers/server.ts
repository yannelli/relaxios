import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type Handler = (req: IncomingMessage, res: ServerResponse, body: Buffer) => void | Promise<void>;

export interface TestServer {
  url: string;
  close(): Promise<void>;
}

/** Starts an HTTP server on a random port. The handler gets the fully read body. */
export async function serve(handler: Handler, options: { readBody?: boolean } = {}): Promise<TestServer> {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    if (options.readBody !== false) for await (const chunk of req) chunks.push(chunk);
    try {
      await handler(req, res, Buffer.concat(chunks));
    } catch (e) {
      res.statusCode = 500;
      res.end(String(e));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export const json = (res: ServerResponse, value: unknown, status = 200, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(value));
};

/** Echo handler: replies with method, url, headers and body as JSON. */
export const echo: Handler = (req, res, body) =>
  json(res, { method: req.method, url: req.url, headers: req.headers, body: body.toString('latin1') });
