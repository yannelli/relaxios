'use strict';

export default function bind(fn: any, thisArg: any): any {
  return function wrap(this: any) {
    return fn.apply(thisArg, arguments);
  };
}
