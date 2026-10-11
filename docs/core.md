# relaxios: the core client

`relaxios` is a small HTTP client (1.9 kB min+gzip) with the shape of axios and the primitives of
`fetch`. Use it when you want `create`, `defaults`, interceptors, `timeout` and typed errors
without the full axios surface. If you need axios behavior exactly, use
[`relaxios/axios`](axios.md).

```ts
import http from 'relaxios';

const api = http.create({ baseURL: 'https://api.example.com', timeout: 20_000 });
const { data, status, headers } = await api.get<User>('/me');
await api.post('/users', { name: 'Ada' });
```

## Exports

| Export | What it is |
| --- | --- |
| `default` | The default client. Callable as `http(config)` or `http(url, config)`. |
| `create(config?)` | A new client whose defaults are merged over the default client's defaults. |
| `createClient(defaults?, hooks?)` | Builds a client from scratch. `hooks` lets a wrapper change the merge, prepare and dispatch steps. |
| `HttpError`, `isHttpError`, `isCancel`, `ErrorCode` | Errors, see below. |
| `Interceptors` | The interceptor manager class. |
| `fetchAdapter`, `encodeBody`, `parseBody`, `toHeaders` | The request pipeline pieces, for custom adapters. |
| `buildURL`, `serializeParams`, `isAbsoluteURL`, `mergeConfig`, `deepMerge`, `isObject` | URL and config helpers. |
| types | `RequestConfig`, `HttpResponse`, `FetchRequest`, `Client`, `ResponseType`, `HeadersObject`, `InterceptorManager`, `Interceptor`, `InterceptorOptions`, `FetchLike`, `ClientHooks`. |

## The client

A client is a function with methods.

```ts
http(config)                      // RequestConfig
http(url, config?)
http.request(config)
http.get(url, config?)            // also delete, head, options
http.post(url, data?, config?)    // also put, patch
http.defaults                     // RequestConfig, mutable
http.interceptors.request         // InterceptorManager<RequestConfig>
http.interceptors.response        // InterceptorManager<HttpResponse>
http.create(config?)              // a client with these defaults merged over its own
```

Every call resolves with an `HttpResponse`.

```ts
interface HttpResponse<T = any, D = any> {
  data: T;               // parsed body, see responseType
  status: number;
  statusText: string;
  headers: Headers;      // the fetch Headers object
  config: RequestConfig<D>;
  request: FetchRequest; // the RequestInit that was sent, plus its final url
}
```

## Request config

| Option | Default | Notes |
| --- | --- | --- |
| `url` | `''` | Joined to `baseURL` unless absolute. Not inherited from defaults. |
| `method` | `'get'` | Case-insensitive. |
| `baseURL` | | Trailing and leading slashes are collapsed on join. |
| `allowAbsoluteUrls` | `true` | `false` joins `url` to `baseURL` even when `url` is absolute. |
| `headers` | | A plain object or a `Headers`. `null`, `undefined` and `false` values are skipped, others are stringified. Merged case-insensitively over the defaults. |
| `params` | | A plain object or `URLSearchParams`. Arrays repeat the key (`ids=1&ids=2`), `Date` values become ISO strings, objects become JSON, and `null` or `undefined` values are skipped. Appended after the existing query, and the hash is dropped. |
| `paramsSerializer` | `serializeParams` | `(params) => string`, for bracket or other formats. |
| `data` | | Plain objects and arrays become JSON with `Content-Type: application/json` when no content type is set. `FormData`, `URLSearchParams`, `Blob`, `ArrayBuffer`, typed arrays, strings and `ReadableStream` pass through to `fetch` (streams send with `duplex: 'half'`). Not inherited from defaults. |
| `timeout` | none | Total time in ms, including reading the body. `0` disables. Implemented with `AbortSignal.timeout`. |
| `signal` | | Combined with the timeout through `AbortSignal.any`. |
| `responseType` | | `json`, `text`, `blob`, `arrayBuffer`, `formData` or `stream`. Unset means JSON when the `Content-Type` contains `json`, else text. `json` parses regardless of the content type, and an empty body gives `''`. `stream` returns `response.body` without reading it. |
| `validateStatus` | 2xx | `(status) => boolean`. `null` resolves every status. |
| `credentials` | | Passed to `fetch` (`omit`, `same-origin`, `include`). |
| `fetchOptions` | | Any `RequestInit` fields (`cache`, `mode`, `redirect`, `priority`, `keepalive` and so on). `url`, `method`, `headers`, `body` and `signal` from the config win. |
| `fetch` | global `fetch` | Any `(url, init) => Promise<Response>`, for example `xhrFetch()` from [`relaxios/progress`](progress.md) or a wrapper that adds auth. |
| `adapter` | `fetchAdapter` | `(config) => Promise<HttpResponse>`. Replaces the whole transport for this request. |

### Merging

`mergeConfig(defaults, config)` builds the config of each request. Plain objects merge deeply and
other values are replaced. `undefined` never overrides a default, headers merge
case-insensitively, and `url` and `data` are never taken from defaults. `create(config)` applies
the same merge once to produce the new client's defaults.

## Interceptors

```ts
const id = api.interceptors.request.use(
  (config) => ({ ...config, headers: { ...config.headers, authorization: `Bearer ${token}` } }),
  (error) => Promise.reject(error),
  { runWhen: (config) => config.method !== 'get' },
);
api.interceptors.response.use((response) => response.data);
api.interceptors.request.eject(id);
api.interceptors.response.clear();
```

Request interceptors run newest first and response interceptors oldest first, the axios order. A
request interceptor receives the merged config and returns a config (or a promise of one). A
response interceptor receives the `HttpResponse` and may return anything, which becomes the
resolved value. `runWhen` skips a request interceptor when it returns false. `synchronous` is
accepted for parity but ignored, because interceptors always run through promises.

## Errors

Every failure rejects with an `HttpError`.

```ts
class HttpError<T = any, D = any> extends Error {
  name: 'HttpError';
  code?: ErrorCode;
  config?: RequestConfig<D>;
  request?: FetchRequest;        // what was sent, also on network errors
  response?: HttpResponse<T, D>; // set for status errors and bad JSON
  status?: number;               // response.status when there is a response
  cause?: unknown;               // the fetch error, SyntaxError or abort reason
}
```

| `code` | When |
| --- | --- |
| `ERR_BAD_REQUEST` | `validateStatus` rejected a 4xx status. |
| `ERR_BAD_RESPONSE` | `validateStatus` rejected any other status, or the body was not valid JSON. |
| `ETIMEDOUT` | `timeout` elapsed. The message is `timeout of <ms>ms exceeded`. |
| `ERR_CANCELED` | `signal` aborted. `cause` is `signal.reason` and `isCancel(error)` is true. |
| `ERR_NETWORK` | `fetch` rejected for any other reason (DNS, TLS, CORS, offline). `cause` is the original error. |

`isHttpError(e)` narrows `unknown` to `HttpError`. Custom adapters may use other `code` strings.

## Custom adapters and transports

`fetchAdapter(config)` is the default pipeline. It builds headers, encodes the body, joins the
URL, combines signals, calls `config.fetch || fetch`, parses the body and validates the status.
The pieces are exported so an adapter can reuse them.

```ts
import { fetchAdapter, buildURL, type RequestConfig } from 'relaxios';

const logging = async (config: RequestConfig) => {
  console.log(config.method, buildURL(config));
  return fetchAdapter(config);
};
await http.get('/x', { adapter: logging });
```

`createClient(defaults, hooks)` goes one level deeper. `hooks.merge` replaces `mergeConfig`,
`hooks.prepare` runs on the merged config before the request interceptors, and `hooks.dispatch`
replaces `config.adapter || fetchAdapter`. A wrapper with a different config schema can reuse the
client, the method helpers and the interceptor chain this way.

## Differences from axios

The core client is a different, smaller API. Beyond the option list above, the main differences
are these.

- `headers` on the response is a `Headers` object.
- Arrays in `params` repeat the key, while axios uses `ids[]=1&ids[]=2`.
- `responseType` names follow the `Response` methods (`arrayBuffer`, `formData`), and there is no
  `document` type.
- `transformRequest`, `transformResponse`, `CancelToken`, `AxiosHeaders`, XSRF headers, `auth`,
  progress callbacks and the Node options do not exist. Progress lives in
  [`relaxios/progress`](progress.md), and everything else is in [`relaxios/axios`](axios.md).
