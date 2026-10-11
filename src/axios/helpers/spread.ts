'use strict';

// Syntactic sugar for invoking a function and expanding an array for arguments.
export default function spread(callback: (...args: any[]) => any) {
  return function wrap(arr: any[]) {
    return callback.apply(null, arr);
  };
}
