# fetchwire

A small HTTP client built only on web APIs: `fetch`, Web Streams, `AbortController`, and `XMLHttpRequest` for one upload-progress path. It gives the common axios API, so most apps can switch by changing the import. Progress is a separate module, and uploads get server-confirmed, resumable progress through chunked uploads.

> `fetchwire` is a working name. Rename it in `package.json`, `tsconfig.json` (`paths`), `vitest.config.ts`, `tsdown.config.ts` and the docs.

## Modules

| Import | What it is |
| --- | --- |
| `fetchwire` | Core client: `request()`, method helpers, `create()`, `defaults`, interceptors, errors, timeout and abort. |
| `fetchwire/axios` | axios-compatible default export and types. See [docs/migration.md](docs/migration.md). |
| `fetchwire/progress` | Progress `TransformStream`, event reducer, throttle, and an XHR-backed `fetch` for upload byte counts. |
| `fetchwire/upload` | Resumable chunked uploads: `upload()`, `ietf()`, `s3Multipart()`, `xhrSingle()`. See [docs/upload.md](docs/upload.md). |
| `fetchwire/vue` | `useUpload()` composable. |

Each subpath is a separate entry. An app that does not import `fetchwire/upload` ships none of its code.

## Core

```ts
import http from 'fetchwire';

const api = http.create({ baseURL: '/api', timeout: 20_000 });
api.interceptors.request.use((config) => config);
const { data } = await api.get<User>('/me', { params: { ids: [1, 2] }, signal });
```

- Request interceptors run newest first, response interceptors oldest first (axios order).
- `timeout` and `signal` are combined with `AbortSignal.any`. Errors are `HttpError` with `code` `ETIMEDOUT`, `ERR_CANCELED`, `ERR_NETWORK`, `ERR_BAD_REQUEST` (4xx) or `ERR_BAD_RESPONSE` (5xx and bad JSON).
- Bodies: plain objects and arrays become JSON. `FormData`, `URLSearchParams`, `Blob`, buffers, strings and `ReadableStream` pass through.
- `responseType`: `json`, `text`, `blob`, `arrayBuffer`, `formData`, `stream`. By default JSON is parsed when the Content-Type says so.
- Params repeat keys for arrays (`ids=1&ids=2`). Pass `paramsSerializer` for other formats, or use `fetchwire/axios` for bracket format.
- `fetch` option: any fetch-compatible function, for example `xhrFetch()` from `fetchwire/progress`.

## Progress

```ts
import { progress, trackResponse } from 'fetchwire/progress';

const res = await fetch('/big.bin');
const body = res.body!.pipeThrough(progress((e) => render(e.ratio), res));
```

Events have `loaded`, `total`, `ratio`, `rate` (bytes/s), `estimated` (seconds left), `lengthComputable` and `bytes`. When `Content-Encoding` is set and is not `identity`, `lengthComputable` is false, because decoded bytes can be more than `Content-Length`. `loaded` is clamped to `total`. Events are throttled to animation frames in visible pages and to 100 ms elsewhere.

For upload byte counts in browsers, `xhrFetch({ onUpload })` is a fetch-compatible function backed by XHR:

```ts
await http.post('/files', file, { fetch: xhrFetch({ onUpload: (e) => render(e.ratio) }) });
```

These counts are bytes given to the network stack. For progress the server has confirmed, use `fetchwire/upload`.

## Uploads

```ts
import { upload, ietf } from 'fetchwire/upload';

const job = upload(file, { protocol: ietf({ endpoint: '/uploads' }), chunkSize: 1 << 20 });
for await (const p of job.progress) render(p.confirmed / p.total);
const result = await job;
```

`confirmed` counts bytes the server acknowledged. `estimated` is smoothed from the measured rate and never goes past `confirmed` plus the chunk in flight. Jobs pause, resume, retry with backoff, continue from the server offset after errors, and cancel on the server on `abort()`. Details, server setup and CORS rules: [docs/upload.md](docs/upload.md).

## Sizes

min+gzip, measured by `npm run size` (size-limit with rolldown). "Own code" excludes the other fetchwire modules it imports.

| Module | Size | Budget |
| --- | ---: | ---: |
| core (`import http from 'fetchwire'`) | 1.91 kB | 3 kB |
| axios compat, own code (with XHR transport wiring) | 4.06 kB | 2.5 kB, **over** |
| progress, all exports | 1.31 kB | 1.5 kB |
| upload core (`upload()`) | 1.46 kB | 3 kB |
| `ietf()` added to upload core | 1.45 kB | 1 kB, **over** |
| `s3Multipart()` added to upload core | 0.83 kB | 1 kB |
| `xhrSingle()` added to upload core (plus `xhrFetch` from progress) | 0.48 kB | 1 kB |
| vue adapter, own code | 0.31 kB | |
| **Total for an axios-compat app** (core + compat + progress parts) | 6.32 kB | axios 1.20.0 browser build: 18.8 kB |
| Total for upload with all adapters and progress | 4.50 kB | |

Runtime dependencies: none. `vue` is an optional peer dependency of `fetchwire/vue`.

## Runtimes

Chrome, Firefox and Safari from the last two years, Node 20.3+ (for `AbortSignal.any`), Bun, Deno, Cloudflare Workers and Capacitor webviews. Browsers without Web Streams are out of scope. In Cloudflare Workers, do not set `credentials` or `withCredentials`.

## Development

```sh
npm install
npm run build        # tsdown -> dist/
npm run typecheck
npm test             # vitest: unit, differential (vs axios 1.20.0), upload servers
npm run size         # size-limit plus per-adapter budgets
npx playwright install --with-deps
npm run test:e2e     # Chromium, Firefox, WebKit (run the build first)
node scripts/smoke.mjs   # also: bun scripts/smoke.mjs, deno run -A scripts/smoke.mjs
```

The toolchain (vitest, tsdown, size-limit) needs Node 22.12+. The package itself runs on Node 20.3+, which CI checks with the smoke script.

## License

MIT. Parts of `fetchwire/axios` follow axios 1.20.0 behavior and type definitions (MIT); see [NOTICE](NOTICE).
