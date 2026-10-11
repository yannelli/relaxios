# relaxios/axios: the axios port

`relaxios/axios` is a TypeScript port of axios 1.20.0. It is the axios code base, file by file
(`lib/` and `index.js`), typed and built on the platform's own APIs, and it has no dependencies.
For most apps the switch is one line.

```ts
// before
import axios, { AxiosError, isAxiosError, type AxiosInstance } from 'axios';
// after
import axios, { AxiosError, isAxiosError, type AxiosInstance } from 'relaxios/axios';
```

Everything in the [axios documentation](https://axios-http.com/docs/intro) applies. This page
covers what the port exports, how it chooses a transport, how it is built, and what was done to
make it behave the same as axios in every runtime.

## Exports

Every export of axios 1.20.0 exists with the same name and type. That includes the default
instance, `create`, `Axios`, `AxiosError`, `CanceledError`, `Cancel`, `CancelToken`, `isCancel`,
`isAxiosError`, `AxiosHeaders`, `HttpStatusCode`, `VERSION`, `all`, `spread`, `toFormData`,
`formToJSON`, `getAdapter`, `mergeConfig`, and the type names from axios's `index.d.ts`
(`AxiosInstance`, `AxiosRequestConfig`, `InternalAxiosRequestConfig`, `AxiosResponse`,
`AxiosStatic`, `AxiosAdapter`, `AxiosProgressEvent`, `RawAxiosRequestHeaders` and the rest).
`VERSION` is `1.20.0`, the axios API version the port implements, so the `User-Agent` header and
warning messages match.

A CommonJS build is included, and `require('relaxios/axios')` returns the callable default
instance just as `require('axios')` does.

## Config options

The port carries the full config surface. Every option behaves as in axios 1.20.0, including the
ones that are easy to leave out of a reimplementation.

- Serialization. `params`, `paramsSerializer` (bracket format by default), `formSerializer`,
  `transformRequest`, `transformResponse`, and `toFormData` with nested objects and `Blob` values.
- Headers. `AxiosHeaders` with case-insensitive access, `headers.common` and per-method defaults,
  `xsrfCookieName`, `xsrfHeaderName`, `withXSRFToken`, `auth`.
- Lifecycle. Interceptors with `runWhen` and `synchronous`, `validateStatus`, `timeout`,
  `timeoutErrorMessage`, `signal`, `CancelToken`, `maxContentLength`, `maxBodyLength`.
- Progress. `onUploadProgress` and `onDownloadProgress` with `loaded`, `total`, `progress`,
  `bytes`, `rate`, `estimated`, `upload`/`download`, `event` and `lengthComputable`.
- Browser. `withCredentials`, `responseType` (`json`, `text`, `blob`, `arraybuffer`, `document`,
  `stream`, `formdata`), `responseEncoding`, `fetchOptions`.
- Node. `httpAgent`, `httpsAgent`, `proxy` and the `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`
  environment variables, `maxRedirects`, `beforeRedirect`, `socketPath`, `lookup`, `family`,
  `decompress`, `maxRate`, `insecureHTTPParser`, `transport`, `responseType: 'stream'` with
  Node streams, and `data` as a stream, a `Buffer` or a `form-data` instance.

## Adapters and transports

Adapter selection is the axios logic. The default is `['xhr', 'http', 'fetch']` and the first one
the runtime supports is used. `adapter` accepts a name, an array of names, or a function, and
function adapters are called directly with the config, so libraries such as axios-mock-adapter
work as they do with axios.

| Adapter | Selected when | Transport in relaxios |
| --- | --- | --- |
| `xhr` | `XMLHttpRequest` exists (browsers, web workers, jsdom, happy-dom) | `fetch`, with an `XMLHttpRequest` stand-in as `request`. A real `XMLHttpRequest` is used when `adapter: 'xhr'` is set explicitly, when `onUploadProgress` is set, when the global `XMLHttpRequest` is not the native one (a mock or an instrumented wrapper), or when `fetch` is missing, so test doubles and monitoring tools see the same requests as with axios. |
| `http` | `process` exists with the `[object process]` tag (Node, Bun, Deno) | `node:http`, `node:https` and `node:http2`, a port of the axios http adapter including redirects, proxies, agents, `socketPath`, `lookup`, `decompress`, `maxRate` and the Node error objects. The behavior of follow-redirects, proxy-from-env, https-proxy-agent and form-data is reimplemented inside the package. |
| `fetch` | neither of the above (Cloudflare Workers and other edge runtimes), or `adapter: 'fetch'` | `fetch`, with the `Request` object as `request`. |

The transport decides the shape of `response.data` and `response.request`, exactly as the
adapter does in axios. With the xhr profile `data` for `responseType: 'arraybuffer'` is an
`ArrayBuffer` and `request` is an `XMLHttpRequest`. With the http profile `data` is a `Buffer`
and `request` is a `ClientRequest`. With the fetch profile `request` is a `Request`.

### The XMLHttpRequest stand-in

In browsers the xhr profile runs over `fetch`, which can use streams, `Request` bodies and
`AbortSignal` directly and read the response body without buffering it twice. The `request`
object it hands back is created with `Object.create(XMLHttpRequest.prototype)`, so `instanceof
XMLHttpRequest` is true, and it owns every readable member (`readyState`, `status`, `statusText`,
`responseURL`, `response`, `responseText`, `responseXML`, `responseType`, `timeout`,
`withCredentials`, `upload`, `getAllResponseHeaders()`, `getResponseHeader()`, `abort()` and the
`on*` slots) with the values a real `XMLHttpRequest` holds after the same request, including
after network errors and timeouts.

The stand-in also reproduces what each engine's `XMLHttpRequest` reports. An unsent real
`XMLHttpRequest` validates the URL, method, headers and options, so invalid values throw the
engine's own exceptions. `timeout` and `responseType` take the coerced values the engine keeps.
Text is decoded by BOM and `charset`, and Chromium rewrites the charset of text bodies to
`UTF-8`. Chromium and Firefox keep URL credentials in `responseURL` but WebKit strips them.
Firefox counts encoded bytes in download progress for compressed responses, and for that case
without a `Content-Length` the count comes from Resource Timing, which browsers expose for
same-origin responses and for cross-origin ones that send `Timing-Allow-Origin`. Without it the
final count is the decoded size.

## Builds and runtimes

The package ships the same export conditions as axios. `browser` and `react-native` resolve to
`dist/axios.browser.js` (ESM) or `dist/axios.browser.cjs` (`require`), and `bun` and `default`
resolve to `dist/axios.node.js` or `dist/axios.node.cjs`. The `browser` field maps the Node files
to the browser files for older bundlers. Only the Node build imports Node built-ins, and in the
browser build `adapter: 'http'` fails with the same "not available in the build" error as axios.

| Runtime | Build | Default adapter | Notes |
| --- | --- | --- | --- |
| Browsers, web workers | browser | `xhr` (over `fetch`) | `adapter: 'fetch'` gives the fetch profile with a `Request` as `request`. |
| Node 20.3+ | node | `http` | `adapter: 'fetch'` works on the global `fetch`. `adapter: 'xhr'` fails as in axios. |
| Bun | node (`bun` condition) | `http` | Through Bun's `node:http`. |
| Deno | node | `http` | Through Deno's `node:http`. |
| Cloudflare Workers, workerd | browser (`browser` condition in wrangler) | `fetch` | Do not set `credentials` or `withCredentials`, which workerd rejects. |
| jsdom, happy-dom, sinon fake XHR | node (tests) or browser | `xhr` with the real mock XHR | The global `XMLHttpRequest` is not native, so the port uses it, as axios would. |
| React Native | browser (`react-native` condition) | `xhr` | |

## Mocking and the axios ecosystem

- axios-mock-adapter 2.1.0's own test suite runs unchanged against the port
  (`test/mock-adapter`). Pass the port's instance to `new MockAdapter(axios)` as usual.
- Function adapters are called with the config and must return a promise of a response, as in
  axios. `getAdapter` is exported for libraries that wrap the default adapter.
- Test doubles that replace `globalThis.XMLHttpRequest` (sinon's fake XHR, msw's XHR
  interceptor) are detected and used, because the port only goes over `fetch` when the global
  `XMLHttpRequest` is the engine's own. msw's fetch interceptor works too, since `fetch` is what
  the xhr profile calls.
- Node interceptors such as nock and msw/node see `node:http` requests, as with axios.

## How parity is checked

The differential suite in `test/diff` runs 445 cases against real axios 1.20.0 and against
`relaxios/axios` and compares the observations deeply. It looks at status, headers, the type and
value of `data`, the type and readable properties of `request`, error codes and messages, and
whether `error.request` is present. It runs in Node, Bun, Deno, Node with jsdom, Chromium,
Firefox, WebKit and workerd (through Miniflare), with `adapter` unset and with each explicit
adapter value the runtime supports. The suite requires 0 differences in every runtime, and
`npm test` fails otherwise.

axios's own test suite (`tests/unit` and `tests/browser` of the 1.20.0 tag) runs unchanged against
the port in `test/axios` with no skipped tests, and the axios-mock-adapter 2.1.0 suite runs
unchanged in `test/mock-adapter`. Commands and the runtime matrix are in [testing.md](testing.md).

## Known differences

None. The differential suite found 0 differences in every runtime it covers. If you find one,
add a case to `test/diff/cases/` and the suite fails until the port matches axios.

## Sizes

min+gzip, the browser build is 22.73 kB (budget 23 kB) and the Node build 39.12 kB with Node
built-ins external. axios 1.20.0's browser build measures 18.8 kB the same way, and the
difference is the `XMLHttpRequest` stand-in and the fetch transport for the xhr profile. The Node
build includes the reimplemented follow-redirects, proxy handling, CONNECT tunnelling and
form-data code that axios installs as dependencies.
