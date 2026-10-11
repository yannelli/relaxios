# Resumable uploads

`fetchwire/upload` sends a file in chunks and reports progress that the server has confirmed. It can pause, resume, retry and cancel, and it can continue an upload after a page reload.

```ts
import { upload, ietf } from 'fetchwire/upload';

const job = upload(file, { protocol: ietf({ endpoint: '/uploads' }), chunkSize: 1 << 20 });
for await (const p of job.progress) render(p.confirmed / p.total);
const result = await job; // { status, headers, data } from the server's final response
```

## The job

`upload(file, options)` returns an `UploadJob`:

| Member | What it does |
| --- | --- |
| `await job` | Resolves with the protocol result. Rejects with the error, or with the abort reason. |
| `job.progress` | Async iterable of `UploadProgress`. It ends when the job settles. A slow consumer gets the latest value and skips the ones in between. |
| `job.pause()` | Aborts the requests in flight and sends nothing until `resume()`. |
| `job.resume()` | Asks the server for its offset and continues from there. |
| `job.abort(reason?)` | Stops the upload and cancels it on the server. Resolves when the cancellation request is done. |
| `job.state` | `uploading`, `paused`, `retrying`, `done`, `failed` or `aborted`. |
| `job.signal` | Aborted when the job is aborted. |

### Progress

```ts
interface UploadProgress {
  confirmed: number; // bytes the server has acknowledged
  estimated: number; // smoothed guess, confirmed <= estimated <= confirmed + inflight
  inflight: number;  // bytes in requests that are not acknowledged yet
  total: number;
  rate?: number;     // bytes per second, measured from acknowledgements
  state: UploadState;
}
```

`confirmed` only grows when a server response says the bytes are stored. `estimated` moves between acknowledgements, using the measured rate (or real byte counts from XHR in `xhrSingle`). It never goes past `confirmed` plus the bytes in flight, so a bar driven by `estimated` cannot show data that a failed request will lose. When a request fails, `estimated` falls back to `confirmed`.

### Options

| Option | Default | Notes |
| --- | --- | --- |
| `protocol` | required | `ietf()`, `s3Multipart()`, `xhrSingle()`, or your own. |
| `chunkSize` | 4 MiB | Adapters adjust it to server limits (`ietf`) or to S3 rules (`s3Multipart`). |
| `retries` | 5 | Failures in a row allowed for one chunk. The count resets when a chunk succeeds. |
| `retryDelay(n, error)` | backoff | Exponential from 500 ms, up to 30 s, with jitter. A `Retry-After` header wins. |
| `timeout` | none | Time limit in ms for each try of a chunk. A timeout is retried. |
| `store` | shared memory store | `false` turns resuming across jobs off. |
| `key` | protocol key + name + size + lastModified | Key for the resume store. |
| `signal` | | Aborting it aborts the job. |
| `onProgress(p)` | | Called with every progress value. |
| `fetch` | global `fetch` | For auth wrappers or tests. |

Network errors, timeouts, 408, 409, 429 and 5xx are retried. Other statuses fail the job. After a failure, the next try asks the server for its offset first, so a chunk continues from the byte the server last stored.

### Resume store

The store maps a key to a resume token: the upload URL for `ietf()`, or the UploadId and part ETags for `s3Multipart()`. The default store is one in-memory map per page or process, so a new job for the same file continues a failed one. To survive reloads, pass a persistent store:

```ts
const localStore = {
  get: (key: string) => localStorage.getItem(key),
  set: (key: string, value: string) => localStorage.setItem(key, value),
  delete: (key: string) => localStorage.removeItem(key),
};
upload(file, { protocol, store: localStore });
```

The token is removed when the job finishes or is aborted. It stays when the job fails, so the next job can continue.

## `ietf()`: resumable uploads for HTTP (draft -12)

`ietf({ endpoint, method?, headers?, credentials? })` implements the client side of [draft-ietf-httpbis-resumable-upload-12](https://www.ietf.org/archive/id/draft-ietf-httpbis-resumable-upload-12.html). Every request carries `Upload-Draft-Interop-Version: 9`.

1. **Creation (Section 4.2, careful creation from 10.2).** `POST endpoint` with `Upload-Complete: ?0`, `Upload-Length`, `Content-Type` from the file, and `Content-Disposition: inline; filename=...`. The body is empty. The upload URL comes from the `Location` header of the final response. An empty file is sent as one creation request with `Upload-Complete: ?1`.
2. **Append (Section 4.4).** `PATCH` with `Content-Type: application/partial-upload`, `Upload-Offset`, and `Upload-Complete: ?1` on the last chunk. Chunks respect `max-append-size` and `min-append-size` from `Upload-Limit`.
3. **Offset retrieval (Section 4.3).** `HEAD` on the upload URL after a network error, a timeout, a 5xx, a pause, or when resuming from the store. A 409 response with `Upload-Offset` is used directly.
4. **Cancellation (Section 4.5).** `abort()` sends `DELETE` to the upload URL.

Other rules from the draft:

- A file larger than `max-size` is cancelled and the job fails (Section 4.1.4).
- A 413 response halves the chunk, down to `min-append-size` (Section 4.1.4).
- A server offset past the end of the file fails the job and cancels the upload (Section 4.3.1).
- A response with `Upload-Complete: ?1` is the final response. If its status is 4xx or 5xx, the job fails without resuming (Section 4.4.1).
- A stored URL that answers 404 or 410 starts a new upload.

### Server and CORS setup

Cross-origin uploads need CORS rules on the upload server, because the client sends custom headers and reads custom response headers:

```
Access-Control-Allow-Methods: POST, PATCH, HEAD, DELETE
Access-Control-Allow-Headers: Upload-Complete, Upload-Offset, Upload-Length, Upload-Draft-Interop-Version, Content-Type, Content-Disposition, Authorization
Access-Control-Expose-Headers: Location, Upload-Offset, Upload-Complete, Upload-Length, Upload-Limit
```

`test/servers/ietf-server.ts` is a reference server for draft -12, used by the tests. It handles creation, append (stores bytes as they arrive), offset retrieval, cancellation, `OPTIONS` limits, 409 problem details, length checks, and ends a stale transfer when a new request arrives (Section 4.6).

### Notes on draft -12

These parts of the draft were unclear, or need something `fetch` cannot do:

- **104 responses are invisible to fetch** (and to XHR). The client cannot use optimistic creation (Section 10.1), cannot read upload URLs or offsets from interim responses, and cannot check that `Location` stays the same across interim responses (Section 4.2.2). It uses careful creation (Section 10.2), which costs one extra round trip per upload.
- **Interop version checks on 104 responses** (Appendix B) cannot be done for the same reason. The client still sends the header on every request.
- **Append success responses** do not have to carry `Upload-Offset` (the example in Section 4.4.3 has none). The client takes a 2xx response to mean the whole chunk was stored and adds the chunk length. If `Upload-Offset` is present, the client uses it.
- **A 2xx response to a completing append without `Upload-Complete`.** Section 4.4.2 requires `Upload-Complete: ?1` on that response. The client treats a 2xx without the header as final, and a 2xx with `Upload-Complete: ?0` as "not finished yet".
- **`max-age`** has no client rule beyond "SHOULD NOT access". The client does not expire stored URLs. A 404 or 410 on resume starts over.
- **413 without known limits.** Section 4.1.4 suggests an `OPTIONS` request to learn limits. The client halves the chunk.
- **`min-size`.** If the server does not create an upload resource (no `Location`), the job fails. The client does not fall back to a plain upload.
- **Lost final response.** Section 4.4.2 lets a server replay the final response. After `HEAD` reports the full offset, the client sends an empty `PATCH` with `Upload-Complete: ?1`; the job succeeds only if the server replays.
- **Structured fields.** `Upload-Limit` is parsed with a small Dictionary parser: known keys with non-integer values make the client ignore the field (Section 4.1.4), parameters are dropped. String members that contain commas are not handled.
- **CORS** is not covered by the draft. Browsers cannot read `Location`, `Upload-Offset` or `Upload-Limit` cross-origin unless the server exposes them.
- **`Incremental` header** (Section 11) is not sent. Chunks are Blob slices with a known length.

## `s3Multipart()`

`s3Multipart({ create, signPart, complete, abort, concurrency? })` uploads to S3 (or any S3-compatible store) with presigned part URLs. Your backend does the signed calls; the adapter only needs four functions:

| Function | Calls |
| --- | --- |
| `create(file, signal)` | CreateMultipartUpload. Return `{ uploadId, ...anything your signer needs }`. |
| `signPart(upload, partNumber, signal)` | Return a presigned UploadPart URL, or `{ url, headers }`. Called again for each retry, so expired URLs are replaced. |
| `complete(upload, parts, signal)` | CompleteMultipartUpload with `[{ PartNumber, ETag }]` in order. Its return value is the job result. |
| `abort(upload)` | AbortMultipartUpload. Runs on `job.abort()`. |

- Parts are at least 5 MiB (the last part can be smaller) and at most 10,000. For large files the part size grows to `ceil(size / 10000)`. Files that would need parts larger than 5 GiB are rejected.
- Up to `concurrency` parts (default 4) upload in parallel. `pause()` aborts all of them; `resume()` uploads them again.
- A failed part is retried on its own. A 403 is retried too, because it usually means the presigned URL expired.
- The resume store keeps the UploadId and the ETag of each finished part. A new job sends only the missing parts.

**The bucket CORS rules must expose `ETag`.** Browsers hide the `ETag` header of the part response unless it is listed in `ExposeHeaders`, and the job then fails with a message that says so:

```json
[
  {
    "AllowedOrigins": ["https://app.example.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"]
  }
]
```

## `xhrSingle()`

`xhrSingle({ url, method?, headers?, field?, withCredentials? })` sends the whole file in one XHR request, for servers without chunk support. `estimated` follows `xhr.upload` byte counts and `confirmed` jumps to the total when the server responds. Retries and resume send the whole file again. With `field`, the file is sent as `multipart/form-data`. Browsers only.

## Custom protocols

A protocol is a function `(ctx: UploadContext) => Promise<Result>`, with an optional `key` property for the resume store. Wrap every request in `ctx.task(fn)`: it handles pause, retries, backoff and timeouts, and gives `fn` a `Task`:

- `task.signal`: pass it to fetch. It aborts on pause, abort and timeout.
- `task.attempt`: above 0 after a failure or a pause. Read the server state before sending again.
- `task.send(bytes)`: declares the bytes this request carries (they count as in flight).
- `task.sent(bytes)`: optional real byte count from the transport.

Call `ctx.confirm(bytes)` when the server acknowledges data, `ctx.save(token)` to store the resume token, and `ctx.onAbort(fn)` to register server-side cancellation.

## Vue

```ts
import { useUpload } from 'fetchwire/vue';

const { start, progress, result, error, pause, resume, abort } = useUpload({ protocol: ietf({ endpoint: '/uploads' }) });
start(file);
// progress is a readonly ref with the latest job.progress value
```

The job is aborted when the component's scope is disposed. `vue` is an optional peer dependency.
