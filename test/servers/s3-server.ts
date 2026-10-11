import { createHash, createHmac, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

// Fake S3 multipart API for tests: CreateMultipartUpload, UploadPart (presigned),
// CompleteMultipartUpload, AbortMultipartUpload and ListParts, with fault injection.
const SECRET = 'test-secret';
const MIN_PART = 5 * 1024 * 1024;

export const signature = (uploadId: string, partNumber: number, expires: number) =>
  createHmac('sha256', SECRET).update(`${uploadId}:${partNumber}:${expires}`).digest('hex');

export interface S3Fault {
  partNumber: number;
  /** Respond with this status before reading the body. */
  status?: number;
  /** Destroy the connection after this many bytes. */
  dropAfter?: number;
  /** Respond 200 without an ETag header (bucket CORS without ExposeHeaders). */
  noEtag?: boolean;
}

interface MultipartUpload {
  key: string;
  parts: Map<number, { data: Buffer; etag: string }>;
  aborted: boolean;
  completed: boolean;
}

const md5 = (data: Buffer) => createHash('md5').update(data).digest('hex');
const xml = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;

export async function startS3Server(options: { readDelay?: number } = {}) {
  const uploads = new Map<string, MultipartUpload>();
  const objects = new Map<string, Buffer>();
  const faults: S3Fault[] = [];
  const log: { method: string; partNumber?: number; status?: number; outcome?: string }[] = [];
  let active = 0;
  let maxActive = 0;
  let bytesReceived = 0;

  async function readBody(req: IncomingMessage, dropAfter?: number) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req as AsyncIterable<Buffer>) {
      chunks.push(chunk);
      size += chunk.length;
      bytesReceived += chunk.length;
      if (dropAfter !== undefined && size >= dropAfter) {
        req.socket?.destroy();
        return;
      }
      if (options.readDelay) await new Promise((r) => setTimeout(r, options.readDelay));
    }
    return Buffer.concat(chunks);
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://x');
    const key = decodeURIComponent(url.pathname.slice(1));
    const q = url.searchParams;
    const entry: (typeof log)[number] = { method: req.method! };
    log.push(entry);
    const send = (status: number, body = '', headers: Record<string, string> = {}) => {
      entry.status = status;
      res.writeHead(status, { 'Access-Control-Expose-Headers': 'ETag', ...headers }).end(body);
    };
    try {
      if (req.method === 'POST' && q.has('uploads')) {
        const id = randomBytes(12).toString('hex');
        uploads.set(id, { key, parts: new Map(), aborted: false, completed: false });
        return send(200, xml(`<InitiateMultipartUploadResult><Key>${key}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`));
      }
      const upload = uploads.get(q.get('uploadId') || '');
      if (!upload || upload.aborted) {
        req.resume();
        return send(404, xml('<Error><Code>NoSuchUpload</Code></Error>'));
      }
      if (req.method === 'PUT') {
        const partNumber = Number(q.get('partNumber'));
        entry.partNumber = partNumber;
        const expires = Number(q.get('X-Amz-Expires'));
        if (q.get('X-Amz-Signature') !== signature(q.get('uploadId')!, partNumber, expires) || expires < Date.now()) {
          req.resume();
          return send(403, xml('<Error><Code>AccessDenied</Code></Error>'));
        }
        const i = faults.findIndex((f) => f.partNumber === partNumber);
        const fault = i === -1 ? undefined : faults.splice(i, 1)[0];
        if (fault?.status) {
          req.resume();
          return send(fault.status);
        }
        active++;
        maxActive = Math.max(maxActive, active);
        const data = await readBody(req, fault?.dropAfter).finally(() => active--);
        if (!data) return void (entry.outcome = 'dropped');
        const etag = `"${md5(data)}"`;
        upload.parts.set(partNumber, { data, etag });
        return send(200, '', fault?.noEtag ? {} : { ETag: etag });
      }
      if (req.method === 'POST') {
        const body = (await readBody(req))!.toString();
        const listed = [...body.matchAll(/<PartNumber>(\d+)<\/PartNumber>\s*<ETag>([^<]+)<\/ETag>/g)].map((m) => [+m[1], m[2]] as const);
        const numbers = listed.map(([n]) => n);
        if (!listed.length || numbers.some((n, i) => i > 0 && n <= numbers[i - 1])) return send(400, xml('<Error><Code>InvalidPartOrder</Code></Error>'));
        for (const [n, etag] of listed) if (upload.parts.get(n)?.etag !== etag) return send(400, xml('<Error><Code>InvalidPart</Code></Error>'));
        const parts = listed.map(([n]) => upload.parts.get(n)!.data);
        if (parts.slice(0, -1).some((p) => p.length < MIN_PART)) return send(400, xml('<Error><Code>EntityTooSmall</Code></Error>'));
        const data = Buffer.concat(parts);
        objects.set(upload.key, data);
        upload.completed = true;
        const etag = `"${md5(Buffer.from(parts.map((p) => md5(p)).join(''), 'hex'))}-${parts.length}"`;
        return send(200, xml(`<CompleteMultipartUploadResult><Key>${upload.key}</Key><ETag>${etag}</ETag></CompleteMultipartUploadResult>`));
      }
      if (req.method === 'DELETE') {
        upload.aborted = true;
        upload.parts.clear();
        return send(204);
      }
      if (req.method === 'GET') {
        const items = [...upload.parts].map(([n, p]) => `<Part><PartNumber>${n}</PartNumber><ETag>${p.etag}</ETag><Size>${p.data.length}</Size></Part>`);
        return send(200, xml(`<ListPartsResult>${items.join('')}</ListPartsResult>`));
      }
      send(405);
    } catch {
      entry.outcome = 'aborted';
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  return {
    url: base,
    uploads,
    objects,
    faults,
    log,
    get maxActive() {
      return maxActive;
    },
    get bytesReceived() {
      return bytesReceived;
    },
    /** Presigned UploadPart URL, as a backend would return it. */
    presign: (key: string, uploadId: string, partNumber: number, ttl = 60_000) => {
      const expires = Date.now() + ttl;
      return `${base}/${key}?partNumber=${partNumber}&uploadId=${uploadId}&X-Amz-Expires=${expires}&X-Amz-Signature=${signature(uploadId, partNumber, expires)}`;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
