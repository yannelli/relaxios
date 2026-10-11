'use strict';

import { hasOwnInPrototypeChain } from './safe';

const { toString } = Object.prototype;
const { getPrototypeOf } = Object;
const { iterator, toStringTag } = Symbol;

export const kindOf = ((cache: Record<string, string>) => (thing: any): string => {
  const str = toString.call(thing);
  return cache[str] || (cache[str] = str.slice(8, -1).toLowerCase());
})(Object.create(null));

export const kindOfTest = (type: string) => {
  type = type.toLowerCase();
  return (thing: any): boolean => kindOf(thing) === type;
};

const typeOfTest = (type: string) => (thing: any): boolean => typeof thing === type;

export const { isArray } = Array;

export const isUndefined = typeOfTest('undefined');

export function isBuffer(val: any): boolean {
  return (
    val !== null &&
    !isUndefined(val) &&
    val.constructor !== null &&
    !isUndefined(val.constructor) &&
    isFunction(val.constructor.isBuffer) &&
    val.constructor.isBuffer(val)
  );
}

export const isArrayBuffer = kindOfTest('ArrayBuffer');

export function isArrayBufferView(val: any): boolean {
  let result;
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView) {
    result = ArrayBuffer.isView(val);
  } else {
    result = val && val.buffer && isArrayBuffer(val.buffer);
  }
  return result;
}

export const isString = typeOfTest('string');

export const isFunction = typeOfTest('function');

export const isNumber = typeOfTest('number');

export const isObject = (thing: any): boolean => thing !== null && typeof thing === 'object';

export const isBoolean = (thing: any): boolean => thing === true || thing === false;

export const isPlainObject = (val: any): boolean => {
  if (!isObject(val)) {
    return false;
  }

  const prototype = getPrototypeOf(val);
  return (
    (prototype === null || prototype === Object.prototype || getPrototypeOf(prototype) === null) &&
    // Safe own/inherited toStringTag or iterator members mark the value as tagged/iterable;
    // members reachable only through shared or terminal prototype boundaries are ignored.
    !hasOwnInPrototypeChain(val, toStringTag) &&
    !hasOwnInPrototypeChain(val, iterator)
  );
};

export const isEmptyObject = (val: any): boolean => {
  // Early return for non-objects or Buffers to prevent RangeError
  if (!isObject(val) || isBuffer(val)) {
    return false;
  }

  try {
    return Object.keys(val).length === 0 && Object.getPrototypeOf(val) === Object.prototype;
  } catch (e) {
    // Fallback for any other objects that might cause RangeError with Object.keys()
    return false;
  }
};

export const isDate = kindOfTest('Date');

export const isFile = kindOfTest('File');

// React Native "blob": an object with a `uri` attribute.
export const isReactNativeBlob = (value: any): boolean => {
  return !!(value && typeof value.uri !== 'undefined');
};

// ReactNative `FormData` has a non-standard `getParts()` method
export const isReactNative = (formData: any): any =>
  formData && typeof formData.getParts !== 'undefined';

export const isBlob = kindOfTest('Blob');

export const isFileList = kindOfTest('FileList');
export const isSet = kindOfTest('Set');

export const isStream = (val: any): boolean => isObject(val) && isFunction(val.pipe);

function getGlobal(): any {
  if (typeof globalThis !== 'undefined') return globalThis;
  if (typeof self !== 'undefined') return self;
  if (typeof window !== 'undefined') return window;
  if (typeof global !== 'undefined') return global;
  return {};
}

const G = getGlobal();
const FormDataCtor = typeof G.FormData !== 'undefined' ? G.FormData : undefined;

export const isFormData = (thing: any): boolean => {
  if (!thing) return false;
  if (FormDataCtor && thing instanceof FormDataCtor) return true;
  // Reject plain objects inheriting directly from Object.prototype so prototype-pollution gadgets can't spoof FormData.
  const proto = getPrototypeOf(thing);
  if (!proto || proto === Object.prototype) return false;
  if (!isFunction(thing.append)) return false;
  const kind = kindOf(thing);
  return (
    kind === 'formdata' ||
    // detect form-data instance
    (kind === 'object' && isFunction(thing.toString) && thing.toString() === '[object FormData]')
  );
};

export const isURLSearchParams = kindOfTest('URLSearchParams');

export const [isReadableStream, isRequest, isResponse, isHeaders] = [
  'ReadableStream',
  'Request',
  'Response',
  'Headers',
].map(kindOfTest);

export const _global: any = (() => {
  if (typeof globalThis !== 'undefined') return globalThis;
  return typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : global;
})();

export const isContextDefined = (context: any): boolean =>
  !isUndefined(context) && context !== _global;

export const isTypedArray = ((TypedArray: any) => {
  return (thing: any): boolean => {
    return TypedArray && thing instanceof TypedArray;
  };
})(typeof Uint8Array !== 'undefined' && getPrototypeOf(Uint8Array));

export const isHTMLForm = kindOfTest('HTMLFormElement');

export const isRegExp = kindOfTest('RegExp');

export function isSpecCompliantForm(thing: any): boolean {
  return !!(
    thing &&
    isFunction(thing.append) &&
    thing[toStringTag] === 'FormData' &&
    thing[iterator]
  );
}

export const isAsyncFn = kindOfTest('AsyncFunction');

export const isThenable = (thing: any): any =>
  thing &&
  (isObject(thing) || isFunction(thing)) &&
  isFunction(thing.then) &&
  isFunction(thing.catch);

export const isIterable = (thing: any): boolean => thing != null && isFunction(thing[iterator]);

// Iterable via an iterator that is not sourced solely from a polluted Object.prototype.
export const isSafeIterable = (thing: any): boolean =>
  thing != null && hasOwnInPrototypeChain(thing, iterator) && isIterable(thing);
