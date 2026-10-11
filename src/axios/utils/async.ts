'use strict';

import { _global, isFunction } from './is';

// original code
// https://github.com/DigitalBrainJS/AxiosPromise/blob/16deab13710ec09779922131f3fa5954320f83ab/lib/utils.js#L11-L34

// Cross-platform setImmediate: native when available, else postMessage, else setTimeout.
export const _setImmediate: (cb: (...args: any[]) => void) => any = ((
  setImmediateSupported: boolean,
  postMessageSupported: boolean
) => {
  if (setImmediateSupported) {
    return setImmediate;
  }

  return postMessageSupported
    ? ((token: string, callbacks: Array<() => void>) => {
        _global.addEventListener(
          'message',
          ({ source, data }: any) => {
            if (source === _global && data === token) {
              callbacks.length && callbacks.shift()!();
            }
          },
          false
        );

        return (cb: () => void) => {
          callbacks.push(cb);
          _global.postMessage(token, '*');
        };
      })(`axios@${Math.random()}`, [])
    : (cb: () => void) => setTimeout(cb);
})(typeof setImmediate === 'function', isFunction(_global.postMessage));

// Schedules a microtask or asynchronous callback as soon as possible.
export const asap: (cb: (...args: any[]) => void) => any =
  typeof queueMicrotask !== 'undefined'
    ? queueMicrotask.bind(_global)
    : (typeof process !== 'undefined' && process.nextTick) || _setImmediate;
