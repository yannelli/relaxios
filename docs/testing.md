# Testing and parity checks

This page describes how the repository checks that `relaxios/axios` behaves like axios 1.20.0,
and how the other entries are tested.

## Commands

| Command | What it runs | Needs |
| --- | --- | --- |
| `npm test` | Unit tests for every entry, the upload servers, and the differential suite in Node, Node with jsdom, Bun, Deno and workerd. | `npm run build` for the external runtimes. `bun` and `deno` on the PATH (or `BUN` / `DENO`). Missing runtimes are skipped locally, and CI has all of them. |
| `npm run test:diff` | Only the differential suite (`test/diff/runtimes`). | same |
| `npm run test:e2e` | Playwright in Chromium, Firefox and WebKit. Download progress, XSRF, XHR uploads and the differential suite in each browser. | `npm run build`, `npx playwright install --with-deps`. |
| `npm run test:axios-suite` | axios 1.20.0's `tests/unit` against the port. | `npm --prefix test/axios ci`. |
| `npm --prefix test/axios run test:browser` | axios 1.20.0's `tests/browser` in the three browsers. | same, plus Playwright browsers. |
| `npm --prefix test/mock-adapter test` | axios-mock-adapter 2.1.0's suite against `dist/axios.node.cjs`. | `npm run build`, `npm --prefix test/mock-adapter ci`. |
| `npm run size` | Size table and budgets. | `npm run build`. |
| `node scripts/smoke.mjs` | Imports the build and runs one request, one progress stream and one upload. Also runs under `bun` and `deno run -A`. | `npm run build`, `node_modules/relaxios -> ..` (CI creates it). |

CI (`.github/workflows/ci.yml`) runs all of them. `test` runs on Node 22 and 24, then `size`,
`e2e`, `axios-suite`, `mock-adapter`, and `smoke` on Node 20, Bun and Deno.

## Layout

```
test/
  core.test.ts, progress.test.ts, upload-*.test.ts, vue.test.ts, docs.test.ts
  servers/        reference servers used by the upload tests. ietf-server.ts (draft -12), s3-server.ts
  helpers/
  e2e/            Playwright specs and the test page server (import map to dist/)
  diff/           the differential suite
    cases/        445 cases in bodies.ts, core.ts, options.ts, responses.ts, transport.ts
    observe.ts    turns a response or error into a comparable observation
    run.ts        runs cases against one client with one adapter list
    report.ts     DIFF_REPORT writer
    server.ts, server/   the target server with echo routes, a second origin, a forward proxy, h2c and a unix socket
    runtimes/     node, jsdom, external (bun, deno, workerd) harnesses and the browser entry
    browser.diff.spec.ts  the browser harness, run by Playwright
  axios/          axios 1.20.0's tests/unit and tests/browser, verbatim, with their own package.json
  mock-adapter/   axios-mock-adapter 2.1.0's src/ and test/, verbatim
```

## The differential suite

Each case is a function `(ax, env) => Promise<unknown>` that makes a request with whichever
client it is given. The harness runs every case against real axios 1.20.0 and against
`relaxios/axios`, once per adapter value, and compares the observations with `toEqual`.

An observation is built by `observe.ts` from the resolved response or the rejected error. It
holds the status and status text, the headers (with per-run values such as dates and boundaries
normalized), the type and value of `data` (buffers as byte arrays, streams read to the end,
objects as JSON), the class name and readable properties of `request`, the error name, code and
message, and whether `error.request` and `error.response` exist. A case can return
`custom(value)` to compare a plain value instead, for example a summary of progress events.

| Runtime | Harness | Adapter values |
| --- | --- | --- |
| Node | `runtimes/node.diff.test.ts` | unset, `http`, `fetch`, `xhr` |
| Node with jsdom | `runtimes/jsdom.diff.test.ts` | unset, `xhr`, `fetch`, `http` |
| Bun | `runtimes/external.diff.test.ts`, child process | unset, `http`, `fetch` |
| Deno | same, `deno run -A --node-modules-dir=manual --unstable-sloppy-imports` | unset, `http`, `fetch` |
| workerd | same, Miniflare with a rolldown bundle | unset, `fetch` |
| Chromium, Firefox, WebKit | `browser.diff.spec.ts` through the e2e page | unset, `xhr`, `fetch`, `http` |

Where an adapter is listed but the runtime cannot support it (`xhr` in Node, `http` in a
browser), both clients are expected to fail the same way, and that failure is compared too.

The target server (`server.ts`) starts on random ports and gives the cases an `env` with the
base origin, a second origin for CORS and redirects, a forward proxy, an h2c origin and, on
platforms that have them, a unix socket path. Responses carry `Timing-Allow-Origin: *` so the
browser runs can read encoded byte counts from Resource Timing.

### Environment variables

| Variable | Effect |
| --- | --- |
| `DIFF_REPORT=<path>` | Writes `<path>.<runtime>.json` with every observation of both clients and a `differences` count, for inspecting a failure. |
| `DIFF_SELF=1` | Compares real axios against itself, to check that the observer is stable (timing, ports, boundaries). |
| `BUN`, `DENO` | Paths to the runtimes when they are not on the PATH. |

### Adding a case

Add an entry to the matching file in `test/diff/cases/`.

```ts
'post JSON with custom header': (ax, { base }) =>
  ax.post(base + '/echo', { a: 1 }, { headers: { 'X-Test': '1' } }),
```

The case runs in every runtime and with every adapter value on the next `npm test` and
`npm run test:e2e`. `SKIPS` in `test/diff/cases.ts` exists for cases that cannot be expressed in a
runtime at all, and it is empty. The `/echo` route returns the request method, URL, headers and
body, so the comparison covers what was sent as well as what came back.

## The ported axios suites

`test/axios` holds axios 1.20.0's `tests/unit`, `tests/browser` and `tests/setup` as published,
with a `vitest.config.js` that maps the tests' `lib/...js` and `index.js` imports to `src/axios`.
No test is skipped. `test/axios/SKIPPED.md` records the two cases that needed harness support
(the ES2018 syntax check gets a lowered build of the port, and the `https-proxy-agent` import is
aliased to the port's own tunnelling agent class). `unit/regression.test.js` fetches
`postman-echo.com` and needs network access.

`test/mock-adapter` holds axios-mock-adapter 2.1.0's `src/` and `test/`. `run.mjs` points its
`axios` import at `dist/axios.node.cjs` and runs the suite with mocha, where 132 tests pass.

## Other entries

- `relaxios`: `test/core.test.ts` covers the pipeline, merging, interceptors, errors, timeouts and
  cancellation against a local server.
- `relaxios/progress`: `test/progress.test.ts` for the reducer, throttle and stream, and
  `test/e2e/download-progress.spec.ts` compares byte counts in the browsers.
- `relaxios/upload`: `test/upload-ietf.test.ts` against the draft -12 reference server in
  `test/servers/ietf-server.ts`, `test/upload-s3.test.ts` against a fake S3, and
  `test/e2e/xhr-upload.spec.ts` for `xhrSingle` in browsers.
- `relaxios/vue`: `test/vue.test.ts`.
- `test/docs.test.ts` fails if `docs/axios.md` stops saying there are no known differences.
