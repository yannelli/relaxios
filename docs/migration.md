# Migrating from axios

`fetchwire/axios` gives the common axios 1.x API on top of `fetch`. For most apps the switch is one line:

```ts
// before
import axios, { AxiosError, isAxiosError, type AxiosInstance } from 'axios';
// after
import axios, { AxiosError, isAxiosError, type AxiosInstance } from 'fetchwire/axios';
```

The type names (`AxiosRequestConfig`, `AxiosResponse`, `AxiosError`, `InternalAxiosRequestConfig`, `AxiosProgressEvent`, `AxiosHeaders`, and the rest) match axios 1.20.0.

## What works the same

These behaviors are checked by the differential suite (`test/diff`), which runs each case against real axios 1.20.0 and against `fetchwire/axios` and compares the results.

- `axios(config)`, `axios(url, config)`, `request`, `get`, `delete`, `head`, `options`, `post`, `put`, `patch`, `query`, `postForm`, `putForm`, `patchForm`, `getUri`, `create`, `all`, `spread`, `isAxiosError`, `isCancel`, `mergeConfig`, `toFormData`.
- `defaults`, including `defaults.headers.common` and per-method groups such as `defaults.headers.post`.
- Interceptors: request interceptors run newest first, response interceptors oldest first. `eject`, `clear`, `runWhen`, and rejected handlers that recover.
- Params in bracket format (`a[]=1&a[]=2`, `user[name]=x`), `paramsSerializer` as a function or as `{ indexes, encode, serialize }`, `URLSearchParams` params.
- Bodies: objects to JSON, `URLSearchParams`, `FormData`, objects as `multipart/form-data` or `application/x-www-form-urlencoded` (chosen by the Content-Type header), strings, buffers, Blobs.
- `transformRequest` and `transformResponse` (functions or arrays; the defaults are in `axios.defaults`), `parseReviver`, `transitional.silentJSONParsing`, `transitional.forcedJSONParsing`, `transitional.clarifyTimeoutError`.
- Errors: `AxiosError` with `code`, `status`, `config`, `request`, `response`, `toJSON()`; `ERR_BAD_REQUEST` for 4xx, `ERR_BAD_RESPONSE` for 5xx; `CanceledError` with message `canceled` and `isCancel()`; timeouts as `ECONNABORTED` with `timeout of Nms exceeded` (or `timeoutErrorMessage`).
- `validateStatus` (function, `null`, or explicit `undefined`), `auth`, `withCredentials`, `signal`, `responseType` (`json`, `text`, `arraybuffer`, `blob`, `stream`), `maxRedirects: 0`.
- `response.headers` works both ways: `headers['content-type']` and `headers.get('Content-Type')`. Methods like `getContentType()`, `has()`, `toJSON()` and `getSetCookie()` exist. `set-cookie` is an array.
- XSRF: in browsers, same-origin requests read the `XSRF-TOKEN` cookie and send `X-XSRF-TOKEN` (Laravel). `xsrfCookieName`, `xsrfHeaderName` and `withXSRFToken` work as in axios. Checked in Chromium, Firefox and WebKit against real axios.
- Custom `adapter` functions (for example axios-mock-adapter) receive the config after `transformRequest`, and their responses go through `transformResponse`.

## Transport

Requests use `fetch`. A request that sets `onUploadProgress` uses `XMLHttpRequest`, so `xhr.upload` reports real byte counts. `adapter: 'xhr'` forces XHR too. Where there is no `XMLHttpRequest` (Node, Bun, Deno, Workers), requests always use `fetch`.

Upload progress from XHR, as in axios, counts bytes handed to the network stack. A bar can reach 100% before the server stores the data. For server-confirmed progress, use `fetchwire/upload`.

## Known differences

Every difference found by the differential suite is listed here with its case name. The suite fails if a listed case starts to match axios, or if a new case differs without being listed. The reference is axios 1.20.0 on Node, which uses the `http` adapter.

| Case | Difference |
| --- | --- |
| `arraybuffer response` | Returns an `ArrayBuffer`, as browser axios does. axios on Node returns a `Buffer`. |
| `stream response` | Returns a web `ReadableStream`. axios on Node returns a Node `stream.Readable`. |
| `blob response` | Returns a `Blob`. axios on Node returns a string. |
| `get with data in config` | GET and HEAD bodies are dropped, as `XMLHttpRequest` does. The Node `http` adapter sends them. |
| `postForm with Blob` | Blob values work in `postForm` and `toFormData`. axios on Node rejects them. |
| `connection refused` | Network failures have code `ERR_NETWORK` and message `Network Error`, as in browser axios. axios on Node uses the system code, such as `ECONNREFUSED`. The system error is in `error.cause`. |
| `relative url without baseURL` | On servers, a relative URL fails with `ERR_NETWORK`. axios throws a `TypeError` with code `ERR_INVALID_URL`. |
| `upload progress outside browsers` | `onUploadProgress` fires only where `XMLHttpRequest` exists. axios on Node reports bytes written to the socket. |
| `decompress false` | Ignored. `fetch` always decodes `Content-Encoding`. |
| `maxContentLength exceeded` | Ignored. There is no response size limit. |
| `maxBodyLength exceeded` | Ignored. There is no request size limit. |

### Differences in browsers

The Node suite cannot see these. They come from the browser tests and from reading the axios XHR adapter.

- **Blob and File bodies** get `Content-Type: blob.type`, or `application/octet-stream` when the Blob has no type. Browser axios sends `application/x-www-form-urlencoded` unless you set a type. axios on Node does the same as fetchwire. Checked in `test/e2e/xhr-upload.spec.ts`.
- **`response.request` and `error.request`** hold the fetch init object (with `url`, `method`, `headers`, `body`, `signal`). axios puts the `XMLHttpRequest` there. Code that checks `if (error.request)` to detect "no response" still works.
- **Download progress** on the fetch path comes from the response stream. Events have the axios fields, but `event` is undefined. On the XHR path, `event` is the XHR `ProgressEvent`.
- **Progress throttling** runs once per animation frame in visible pages and every 100 ms elsewhere. axios sends at most 3 events per second.
- **`responseType: 'document'`** is not supported and returns text.
- **`responseEncoding`** is ignored. Text is decoded as UTF-8.

### Differences in the API surface

- Not exported: `CancelToken` (deprecated in axios), the `Axios` class, `HttpStatusCode`, `formToJSON`, `getAdapter`. `isCancel` and `CanceledError` (also as `Cancel`) are exported.
- `VERSION` holds the fetchwire version (for example `0.1.0`).
- `adapter` accepts functions, `'xhr'` and `'fetch'`. Other names (`'http'`) use fetch.
- Ignored options: `proxy`, `httpAgent`, `httpsAgent`, `socketPath`, `allowedSocketPaths`, `transport`, `maxRate`, `beforeRedirect`, `lookup`, `family`, `insecureHTTPParser`, `env`, `formDataHeaderPolicy`, `redact`, `sensitiveHeaders`, `httpVersion`, `http2Options`, and `maxRedirects` other than 0. fetch follows redirects up to its own limit.
- `transitional.legacyInterceptorReqResOrdering: false` is ignored. Request interceptors always run newest first.
- The `synchronous` interceptor option is accepted but interceptors always run asynchronously.
- `signal` must be a real `AbortSignal`. Objects that only look like one do not work, because timeouts are combined with `AbortSignal.any`.
- `timeout` covers the whole request, including reading the body, as in the XHR adapter. The axios Node adapter uses a socket idle timeout.
- `AxiosHeaders` has no raw header string parsing (`new AxiosHeaders('a: b')`), no token parser in `get(name, true)`, and ignores matcher arguments to `has`, `delete` and `clear`. The `accessor()` and `parseParameters()` statics are missing. `get(name, regexp)` and `get(name, fn)` work.
- `AxiosError.toJSON()` omits the browser-specific keys (`description`, `number`, `fileName`, `lineNumber`, `columnNumber`). In practice they are undefined in axios too. `AxiosError` extends fetchwire's `HttpError`.
- `FormData` sent with `Content-Type: application/json` becomes a flat JSON object. Bracket keys such as `a[b]` stay as they are; axios expands them into nested objects.
- A top-level `Date` body is sent as `String(date)`. axios sends it as a JSON string.
- Params: class instances are walked like plain objects, and Blobs become strings. axios appends `[object Object]` for class instances and throws for Blobs.
- Node `stream.Readable` request bodies are not supported. Use a web `ReadableStream`. In Chromium, streaming request bodies need HTTP/2.
- No `User-Agent: axios/...` header is added on servers.
- With `withCredentials: true`, the request uses `credentials: 'include'`. Cloudflare Workers reject the `credentials` option, so do not set `withCredentials` there.
- The package is ESM only. Node 20.19+ and 22.12+ can `require()` it.
