// @vitest-environment jsdom
import { defineDiffSuite } from './harness';

// jsdom: the page origin is http://localhost:3000, so every request is cross-origin and goes through CORS.
// XMLHttpRequest is jsdom's (not native), which both clients must drive the same way.
defineDiffSuite('jsdom', [undefined, 'xhr', 'fetch', 'http']);
