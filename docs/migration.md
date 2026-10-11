# Migrating from axios

`fetchwire/axios` is a TypeScript port of axios 1.20.0. For most apps the switch is one line:

```ts
// before
import axios, { AxiosError, isAxiosError, type AxiosInstance } from 'axios';
// after
import axios, { AxiosError, isAxiosError, type AxiosInstance } from 'fetchwire/axios';
```

Every export of axios 1.20.0 exists with the same name and type: the default instance, `create`,
`Axios`, `AxiosError`, `CanceledError`, `Cancel`, `CancelToken`, `isCancel`, `isAxiosError`,
`AxiosHeaders`, `HttpStatusCode`, `VERSION`, `all`, `spread`, `toFormData`, `formToJSON`,
`getAdapter`, `mergeConfig`, and the type names from `index.d.ts`. `VERSION` is `1.20.0`, the
axios API version the port implements, so the `User-Agent` header and warning messages match.

## How parity is checked

The differential suite in `test/diff` runs the same cases against real axios 1.20.0 and against
`fetchwire/axios` and compares the observations deeply: status, headers, the type and value of
`data`, the type and readable properties of `request`, error codes, and whether `error.request`
is present. It runs in Node, Bun, Deno, Node with jsdom, Chromium, Firefox, WebKit and workerd
(through Miniflare), with `adapter` unset and with each explicit adapter value the runtime
supports. The suite requires 0 differences in every runtime; `npm test` fails otherwise.

axios's own test suite (`tests/unit` and `tests/browser` of the 1.20.0 tag) runs unchanged against
the port in `test/axios` with no skipped tests, and the axios-mock-adapter 2.1.0 suite runs
unchanged in `test/mock-adapter`.

## Adapters and transports

Adapter selection is the axios logic: the default is `['xhr', 'http', 'fetch']` and the first one
the runtime supports is used. `adapter` accepts a name, an array of names, or a function, and
function adapters are called directly, so libraries such as axios-mock-adapter work as they do
with axios.

| Adapter | Selected when | Transport in fetchwire |
| --- | --- | --- |
| `xhr` | `XMLHttpRequest` exists (browsers, web workers, jsdom, happy-dom) | `fetch`, with an `XMLHttpRequest` stand-in as `request`. A real `XMLHttpRequest` is used when `adapter: 'xhr'` is set explicitly, when `onUploadProgress` is set, or when the global `XMLHttpRequest` is not the native one (a mock or an instrumented wrapper), so test doubles and monitoring tools see the same requests as with axios. |
| `http` | `process` exists with the `[object process]` tag (Node, Bun, Deno) | `node:http`, `node:https` and `node:http2`, a port of the axios http adapter including redirects, proxies, agents, `socketPath`, `lookup`, `decompress`, `maxRate` and the Node error objects. The package has no dependencies: the behavior of follow-redirects, proxy-from-env, https-proxy-agent and form-data is reimplemented inside it. |
| `fetch` | neither of the above (Cloudflare Workers and other edge runtimes), or `adapter: 'fetch'` | `fetch`, with the `Request` object as `request`. |

The XHR stand-in is created with `Object.create(XMLHttpRequest.prototype)`, so `instanceof
XMLHttpRequest` is true, and it owns every readable member (`readyState`, `status`, `statusText`,
`responseURL`, `response`, `responseText`, `responseXML`, `responseType`, `timeout`,
`withCredentials`, `upload`, `getAllResponseHeaders()`, `getResponseHeader()`, `abort()` and the
`on*` slots) with the values a real `XMLHttpRequest` holds after the same request, including
after network errors and timeouts.

## Builds

The package ships the same export conditions as axios: `browser` and `react-native` resolve to
`dist/axios.browser.js` (ESM) or `dist/axios.browser.cjs` (`require`), and `bun` and `default`
resolve to `dist/axios.node.js` or `dist/axios.node.cjs`. The `browser` field maps the Node files
to the browser files for older bundlers. Only the Node build imports Node built-ins. In the
browser build `adapter: 'http'` fails with the same "not available in the build" error as axios.

## Engine details the stand-in copies

The xhr profile over `fetch` reproduces what each engine's `XMLHttpRequest` reports: an unsent
real `XMLHttpRequest` validates the URL, method, headers and options, so invalid values throw
the engine's own exceptions; `timeout` and `responseType` take the coerced values the engine
keeps; text is decoded by BOM and `charset`; Chromium rewrites the charset of text bodies to
`UTF-8`; Chromium and Firefox keep URL credentials in `responseURL` and WebKit strips them; and
Firefox counts encoded bytes in download progress for compressed responses. For that last case
without a `Content-Length`, the count comes from Resource Timing, which browsers expose for
same-origin responses and for cross-origin ones that send `Timing-Allow-Origin`; without it
the final count is the decoded size.

## Known differences

None. The differential suite found 0 differences in every runtime it covers. If you find one,
add a case to `test/diff/cases.ts`; the suite fails until the port matches axios.
