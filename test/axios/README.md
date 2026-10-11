# axios test suites against the port

`unit/`, `browser/` and `setup/` are verbatim copies of axios 1.20.0's `tests/unit`, `tests/browser`
and `tests/setup`. `vitest.config.js` aliases their relative imports (`../../index.js`,
`../../lib/<path>.js`) to `src/axios/index.ts` and `src/axios/<path>.ts`, and rewrites the two
fixture-directory expressions that assume axios's `tests/unit/adapters` layout.

This is a private nested package with its own `node_modules`; the root package gains no dependencies.

```sh
npm install                       # once, in this directory
npm test                          # unit project (node), same as `npm run test:axios-suite` at the root
npm run test:browser              # browser project: chromium, firefox and webkit, headless
npx vitest run --project "browser (chromium)"   # a single browser
```

WebKit on this machine needs a GStreamer library that is not installed system-wide:

```sh
LD_PRELOAD=/tmp/claude-1000/-home-ubuntu-workspace-axios-new/f35e4b28-70b2-4b03-b9ef-dff10aecbe34/scratchpad/debs/root/usr/lib/aarch64-linux-gnu/libgstcodecparsers-1.0.so.0 npx vitest run --project "browser (webkit)"
```

Skips are listed in `SKIPPED.md`. Do not edit the test files beyond the `it.skip(` lines recorded there.
