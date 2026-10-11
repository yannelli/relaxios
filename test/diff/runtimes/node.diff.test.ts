import { defineDiffSuite } from './harness';

// Node: the http adapter is the default; 'xhr' is unavailable and must fail identically.
defineDiffSuite('node', [undefined, 'http', 'fetch', 'xhr']);
