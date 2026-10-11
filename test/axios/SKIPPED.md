# Skipped tests

None. Every test of axios 1.20.0's `tests/unit` and `tests/browser` runs against the port.

Two tests needed harness support rather than a skip, both in `vitest.config.js`:

- `unit/syntaxCompat.test.js` parses every file under axios's `lib/` as ES2018. The port is
  TypeScript, so a global setup (`setup/lib-es2018.js`) builds an ES2018-lowered copy of
  `src/axios` into `.lib-es2018/` and the test's `lib/` path is rewritten to it.
- The `HTTPS CONNECT tunneling agent management` tests assert `instanceof HttpsProxyAgent`
  against the `https-proxy-agent` package class. The port ships its own tunnelling agent
  instead of depending on that package, so the import is aliased to
  `src/axios/adapters/http/HttpsProxyAgent.ts`.

For the record: `unit/regression.test.js:14` fetches `https://postman-echo.com` and needs
internet access.
