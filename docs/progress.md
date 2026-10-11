# relaxios/progress

Progress for `fetch`. Download progress is a `TransformStream` you pipe a body through; upload
progress in browsers comes from an `XMLHttpRequest`-backed `fetch`. 1.3 kB min+gzip for every
export.

```ts
import { progress, trackResponse, xhrFetch } from 'relaxios/progress';
```

## Events

Every listener receives a `ProgressEvent`:

```ts
interface ProgressEvent {
  loaded: number;          // bytes so far, clamped to total when known
  total?: number;          // expected bytes, when known
  ratio?: number;          // loaded / total, 0..1
  rate?: number;           // bytes per second over the last 2 seconds
  estimated?: number;      // seconds remaining at the current rate
  lengthComputable: boolean;
  bytes: number;           // bytes since the previous event
}
```

`total` comes from `Content-Length` only when the response has no `Content-Encoding` (or
`identity`). A compressed response reports more decoded bytes than its `Content-Length`, so
`lengthComputable` is false and `ratio` and `estimated` are undefined. `rate` needs at least
250 ms of samples; before that it is undefined.

Events are throttled: once per animation frame in a visible page, once per 100 ms otherwise
(web workers, hidden tabs, Node). A final event is always delivered when the stream ends. Set
`throttle: 0` to get one event per chunk.

## Download progress

```ts
const res = await fetch('/big.bin');
const body = res.body!.pipeThrough(progress((e) => bar.value = e.ratio ?? 0, res));
const blob = await new Response(body).blob();
```

`progress(listener, init?)` returns a `TransformStream<Uint8Array, Uint8Array>` that counts bytes
as they pass. `init` is one of:

| `init` | Meaning |
| --- | --- |
| a number | The total. |
| a `Response` or `Headers` | The total is read from `Content-Length`, when computable. |
| `{ total?, throttle? }` | Explicit total and throttle interval in ms. |
| omitted | Unknown total. |

`trackResponse(response, listener, options?)` returns a copy of the response whose body reports
progress, for code that wants a `Response` back:

```ts
const res = trackResponse(await fetch(url), (e) => render(e));
const json = await res.json();
```

With the core client, pipe `responseType: 'stream'`:

```ts
const res = await http.get('/big.bin', { responseType: 'stream' });
const body = res.data.pipeThrough(progress(render, res.headers));
```

With `relaxios/axios`, use `onDownloadProgress`; the port implements it.

## Upload progress

`fetch` does not report upload progress. `xhrFetch()` is a fetch-compatible function backed by
`XMLHttpRequest`, so `xhr.upload` byte counts become events:

```ts
import http from 'relaxios';
import { xhrFetch } from 'relaxios/progress';

await http.post('/files', file, {
  fetch: xhrFetch({ onUpload: (e) => render(e.ratio), onDownload: (e) => log(e.loaded) }),
});
```

`xhrFetch({ onUpload?, onDownload?, throttle? })` returns `(url, init) => Promise<Response>`.
Listeners receive the reduced `ProgressEvent` and the raw DOM `ProgressEvent`. It supports
`method`, `headers`, `body` (any `XMLHttpRequestBodyInit`), `signal` and `credentials: 'include'`
(mapped to `withCredentials`). Network errors and timeouts reject with `TypeError('Network
Error')`, like `fetch`; an abort rejects with `signal.reason`. Browsers only.

These counts are bytes handed to the network stack. They do not mean the server stored the data.
For progress the server has confirmed, with pause, resume and retries, use
[`relaxios/upload`](upload.md).

## Building blocks

| Export | What it does |
| --- | --- |
| `reducer(total?)` | Returns `(loaded) => ProgressEvent`. Keeps a 2 second window of samples for `rate` and `estimated`, clamps `loaded` to `total`, computes `bytes`. |
| `throttle(fn, ms = 100)` | Returns `[throttled, flush]`. `throttled` calls `fn` with the latest arguments once per animation frame in a visible page, else once per `ms`; `flush` runs a pending call now. `ms = 0` calls through. |
| `contentLength(headers)` | `Content-Length` as a number, or undefined when it is missing, invalid or the body is content-encoded. |

These are what `progress()` and `xhrFetch()` are made of, exported for other transports: count
bytes from any source, feed them to `reducer`, and wrap the listener with `throttle`.
