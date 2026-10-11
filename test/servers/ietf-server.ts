import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

// Reference server for draft-ietf-httpbis-resumable-upload-12, for tests.
// Section numbers refer to the draft. Interop version 9 (Appendix B).
export const INTEROP = '9';
const PROBLEM = 'https://iana.org/assignments/http-problem-types#';

export interface Limits {
  'max-size'?: number;
  'min-size'?: number;
  'max-append-size'?: number;
  'min-append-size'?: number;
  'max-age'?: number;
}

export interface Fault {
  method: string;
  /** Let this many matching requests pass first. */
  skip?: number;
  /** Destroy the connection after this many body bytes were stored. */
  dropAfter?: number;
  /** Store the whole body, then destroy the connection instead of responding (lost response). */
  dropResponse?: boolean;
  /** Respond with this status before reading the body. */
  status?: number;
  retryAfter?: number;
}

interface Upload {
  id: string;
  offset: number;
  length?: number;
  complete: boolean;
  deleted: boolean;
  chunks: Buffer[];
  /** Request currently appending. A new request for the same upload terminates it (Section 4.6). */
  active?: IncomingMessage;
  final?: { status: number; body: string };
}

export interface LogEntry {
  method: string;
  path: string;
  interop?: string;
  offset?: number;
  complete?: string;
  length?: number;
  stored: number;
  status?: number;
  outcome: 'response' | 'dropped' | 'aborted';
}

export interface IetfServerOptions {
  limits?: Limits;
  /** Add Upload-Offset to 2xx append responses (optional in the draft). */
  offsetInAppendResponse?: boolean;
  /** Delay in ms after each received body chunk, to slow the transfer down. */
  readDelay?: number;
}

const item = (req: IncomingMessage, name: string) => String(req.headers[name] ?? '').split(';')[0].trim() || undefined;
const integer = (value?: string) => (value && /^\d{1,15}$/.test(value) ? +value : undefined);
const bool = (value?: string) => (value === '?1' ? true : value === '?0' ? false : undefined);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function startIetfServer(options: IetfServerOptions = {}) {
  const uploads = new Map<string, Upload>();
  const faults: Fault[] = [];
  const log: LogEntry[] = [];
  let bytesReceived = 0;
  const limitHeader = () =>
    Object.entries(options.limits ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join(', ') || 'min-size=0';

  const takeFault = (method: string) => {
    const i = faults.findIndex((f) => f.method === method);
    if (i === -1) return;
    if (faults[i].skip) return void faults[i].skip!--;
    return faults.splice(i, 1)[0];
  };

  /** Appends the request body as it arrives, so an interrupted transfer keeps its data (Section 4.4.2). */
  async function append(req: IncomingMessage, upload: Upload, entry: LogEntry, fault?: Fault) {
    try {
      return await read(req, upload, entry, fault);
    } catch {
      return false; // the client went away; the stored bytes stay
    }
  }

  async function read(req: IncomingMessage, upload: Upload, entry: LogEntry, fault?: Fault) {
    for await (const chunk of req as AsyncIterable<Buffer>) {
      if (upload.active !== req || upload.deleted) return false;
      let data = chunk;
      if (fault?.dropAfter !== undefined) data = data.subarray(0, Math.max(0, fault.dropAfter - entry.stored));
      if (upload.length !== undefined && upload.offset + data.length > upload.length) return 'overflow';
      upload.chunks.push(data);
      upload.offset += data.length;
      entry.stored += data.length;
      bytesReceived += data.length;
      if (fault?.dropAfter !== undefined && entry.stored >= fault.dropAfter) {
        req.socket?.destroy();
        entry.outcome = 'dropped';
        return false;
      }
      if (options.readDelay) await sleep(options.readDelay);
    }
    return upload.active === req && !upload.deleted;
  }

  function respond(res: ServerResponse, entry: LogEntry, status: number, headers: Record<string, string | number> = {}, body?: string) {
    entry.status = status;
    res.writeHead(status, headers);
    res.end(body);
  }

  function processed(upload: Upload) {
    const data = Buffer.concat(upload.chunks);
    const body = JSON.stringify({ id: upload.id, size: data.length, sha256: createHash('sha256').update(data).digest('hex') });
    upload.final = { status: 200, body };
    return upload.final;
  }

  /** Shared by creation and append once the body is fully read. */
  function finish(req: IncomingMessage, res: ServerResponse, upload: Upload, entry: LogEntry, created: boolean) {
    if (bool(item(req, 'upload-complete'))) {
      if (upload.length !== undefined && upload.length !== upload.offset) {
        upload.deleted = true;
        const problem = JSON.stringify({ type: PROBLEM + 'inconsistent-upload-length' });
        return respond(res, entry, 400, { 'Content-Type': 'application/problem+json', 'Upload-Complete': '?0' }, problem);
      }
      upload.complete = true;
      upload.length = upload.offset;
      const final = processed(upload);
      return respond(res, entry, final.status, { 'Content-Type': 'application/json', 'Upload-Complete': '?1' }, final.body);
    }
    const headers: Record<string, string | number> = { 'Upload-Complete': '?0' };
    if (created) {
      headers.Location = `/uploads/${upload.id}`;
      headers['Upload-Limit'] = limitHeader();
    }
    if (options.offsetInAppendResponse) headers['Upload-Offset'] = upload.offset;
    respond(res, entry, created ? 201 : 204, headers);
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://x');
    const entry: LogEntry = { method: req.method!, path: url.pathname, interop: item(req, 'upload-draft-interop-version'), stored: 0, outcome: 'response' };
    entry.offset = integer(item(req, 'upload-offset'));
    entry.complete = item(req, 'upload-complete');
    entry.length = integer(item(req, 'upload-length'));
    log.push(entry);
    req.on('close', () => {
      if (!res.writableEnded && !res.headersSent && entry.outcome === "response" && req.readableAborted) entry.outcome = "aborted";
    });

    const fault = takeFault(req.method!);
    if (fault?.status) {
      req.resume();
      return respond(res, entry, fault.status, fault.retryAfter !== undefined ? { 'Retry-After': fault.retryAfter } : {});
    }

    if (url.pathname === '/uploads') {
      // Section 4.1.4: OPTIONS without Upload-Complete reports the limits.
      if (req.method === 'OPTIONS') return respond(res, entry, 204, { 'Upload-Limit': limitHeader() });
      if (req.method !== 'POST') return respond(res, entry, 405);
      // Section 4.2.2: creation.
      const complete = bool(item(req, 'upload-complete'));
      if (complete === undefined) return respond(res, entry, 400);
      const length = integer(item(req, 'upload-length'));
      const max = options.limits?.['max-size'];
      if (max !== undefined && length !== undefined && length > max) {
        req.resume();
        return respond(res, entry, 413, { 'Upload-Limit': limitHeader() });
      }
      const upload: Upload = { id: randomBytes(9).toString('base64url'), offset: 0, length, complete: false, deleted: false, chunks: [] };
      uploads.set(upload.id, upload);
      upload.active = req;
      const ok = await append(req, upload, entry, fault);
      if (ok !== true) return void (ok === 'overflow' && respond(res, entry, 400, { 'Upload-Complete': '?0' }));
      upload.active = undefined;
      return finish(req, res, upload, entry, true);
    }

    const upload = uploads.get(url.pathname.replace(/^\/uploads\//, ''));
    if (!upload || upload.deleted) {
      req.resume();
      return respond(res, entry, 404);
    }
    // Section 4.6: terminate a transfer still in progress for this upload before handling the new request.
    if (upload.active && upload.active !== req) upload.active.socket?.destroy();
    upload.active = undefined;

    if (req.method === 'HEAD') {
      // Section 4.3.2: offset retrieval.
      const headers: Record<string, string | number> = {
        'Upload-Offset': upload.offset,
        'Upload-Complete': upload.complete ? '?1' : '?0',
        'Upload-Limit': limitHeader(),
        'Cache-Control': 'no-store',
      };
      if (upload.length !== undefined) headers['Upload-Length'] = upload.length;
      return respond(res, entry, 204, headers);
    }
    if (req.method === 'DELETE') {
      // Section 4.5.2: cancellation.
      upload.deleted = true;
      return respond(res, entry, 204);
    }
    if (req.method !== 'PATCH') return respond(res, entry, 405);

    // Section 4.4.2: append.
    if (item(req, 'content-type') !== 'application/partial-upload') {
      req.resume();
      return respond(res, entry, 415);
    }
    const offset = integer(item(req, 'upload-offset'));
    const complete = bool(item(req, 'upload-complete'));
    const declared = integer(String(req.headers['content-length'] ?? ''));
    if (offset === undefined || complete === undefined) {
      req.resume();
      return respond(res, entry, 400);
    }
    if (upload.complete) {
      req.resume();
      // The final response was lost: replay it for a valid empty completing append.
      if (complete && offset === upload.offset && !declared && upload.final) {
        return respond(res, entry, upload.final.status, { 'Content-Type': 'application/json', 'Upload-Complete': '?1' }, upload.final.body);
      }
      return respond(res, entry, 400, { 'Upload-Complete': '?0' });
    }
    if (offset !== upload.offset) {
      req.resume();
      const problem = { type: PROBLEM + 'mismatching-upload-offset', 'expected-offset': upload.offset, 'provided-offset': offset };
      const headers = { 'Content-Type': 'application/problem+json', 'Upload-Offset': upload.offset, 'Upload-Complete': '?0' };
      return respond(res, entry, 409, headers, JSON.stringify(problem));
    }
    const maxAppend = options.limits?.['max-append-size'];
    if (maxAppend !== undefined && declared !== undefined && declared > maxAppend) {
      req.resume();
      return respond(res, entry, 413, { 'Upload-Limit': limitHeader(), 'Upload-Complete': '?0' });
    }
    upload.active = req;
    const ok = await append(req, upload, entry, fault);
    if (ok === 'overflow') {
      upload.deleted = true;
      return respond(res, entry, 400, { 'Upload-Complete': '?0' });
    }
    if (!ok) return;
    upload.active = undefined;
    if (fault?.dropResponse) {
      entry.outcome = 'dropped';
      return void req.socket?.destroy();
    }
    finish(req, res, upload, entry, false);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    uploads,
    faults,
    log,
    get bytesReceived() {
      return bytesReceived;
    },
    data: (id: string) => Buffer.concat(uploads.get(id)!.chunks),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
