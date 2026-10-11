'use strict';

import bind from '../helpers/bind';
import { hasOwnProperty } from './safe';
import {
  isArray,
  isBuffer,
  isContextDefined,
  isFunction,
  isNumber,
  isObject,
  isPlainObject,
  isSet,
  isUndefined,
} from './is';

const { getPrototypeOf } = Object;
const { iterator } = Symbol;
const { propertyIsEnumerable } = Object.prototype;

export const trim = (str: any): string => {
  return str.trim ? str.trim() : str.replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, '');
};

export function forEach(
  obj: any,
  fn: (value: any, key: any, obj: any) => any,
  { allOwnKeys = false }: { allOwnKeys?: boolean } = {}
): void {
  // Don't bother if no value provided
  if (obj === null || typeof obj === 'undefined') {
    return;
  }

  let i;
  let l;

  // Force an array if not already something iterable
  if (typeof obj !== 'object') {
    obj = [obj];
  }

  if (isArray(obj)) {
    // Iterate over array values
    for (i = 0, l = obj.length; i < l; i++) {
      fn.call(null, obj[i], i, obj);
    }
  } else {
    // Buffer check
    if (isBuffer(obj)) {
      return;
    }

    // Iterate over object keys
    const keys = allOwnKeys ? Object.getOwnPropertyNames(obj) : Object.keys(obj);
    const len = keys.length;
    let key;

    for (i = 0; i < len; i++) {
      key = keys[i];
      fn.call(null, obj[key], key, obj);
    }
  }
}

export function findKey(obj: any, key: string): string | null {
  if (isBuffer(obj)) {
    return null;
  }

  key = key.toLowerCase();
  const keys = Object.keys(obj);
  let i = keys.length;
  let _key;
  while (i-- > 0) {
    _key = keys[i];
    if (key === _key.toLowerCase()) {
      return _key;
    }
  }
  return null;
}

export function merge(this: any, ...objs: any[]): any {
  const { caseless, skipUndefined } = (isContextDefined(this) && this) || {};
  const result: any = {};
  const assignValue = (val: any, key: any) => {
    // Skip dangerous property names to prevent prototype pollution
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return;
    }

    // findKey lowercases the key, so caseless lookup only applies to strings;
    // symbol keys are identity-matched.
    const targetKey = (caseless && typeof key === 'string' && findKey(result, key)) || key;
    // Read via own-prop only so a polluted Object.prototype value cannot surface here.
    const existing = hasOwnProperty(result, targetKey) ? result[targetKey] : undefined;
    if (isPlainObject(existing) && isPlainObject(val)) {
      result[targetKey] = merge(existing, val);
    } else if (isPlainObject(val)) {
      result[targetKey] = merge({}, val);
    } else if (isArray(val)) {
      result[targetKey] = val.slice();
    } else if (!skipUndefined || !isUndefined(val)) {
      result[targetKey] = val;
    }
  };

  for (let i = 0, l = objs.length; i < l; i++) {
    const source = objs[i];
    if (!source || isBuffer(source)) {
      continue;
    }

    forEach(source, assignValue);

    if (typeof source !== 'object' || isArray(source)) {
      continue;
    }

    const symbols = Object.getOwnPropertySymbols(source);
    for (let j = 0; j < symbols.length; j++) {
      const symbol = symbols[j];
      if (propertyIsEnumerable.call(source, symbol)) {
        assignValue(source[symbol], symbol);
      }
    }
  }
  return result;
}

export const extend = (
  a: any,
  b: any,
  thisArg?: any,
  { allOwnKeys }: { allOwnKeys?: boolean } = {}
): any => {
  forEach(
    b,
    (val, key) => {
      // Null-proto descriptor so a polluted Object.prototype.get cannot
      // hijack defineProperty's accessor-vs-data resolution.
      const descriptor: any = {
        __proto__: null,
        value: thisArg && isFunction(val) ? bind(val, thisArg) : val,
        writable: true,
        enumerable: true,
        configurable: true,
      };
      Object.defineProperty(a, key, descriptor);
    },
    { allOwnKeys }
  );
  return a;
};

export const stripBOM = (content: string): string => {
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1);
  }
  return content;
};

export const inherits = (
  constructor: any,
  superConstructor: any,
  props?: any,
  descriptors?: any
): void => {
  constructor.prototype = Object.create(superConstructor.prototype, descriptors);
  const ctorDescriptor: any = {
    __proto__: null,
    value: constructor,
    writable: true,
    enumerable: false,
    configurable: true,
  };
  Object.defineProperty(constructor.prototype, 'constructor', ctorDescriptor);
  const superDescriptor: any = {
    __proto__: null,
    value: superConstructor.prototype,
  };
  Object.defineProperty(constructor, 'super', superDescriptor);
  props && Object.assign(constructor.prototype, props);
};

export const toFlatObject = (
  sourceObj: any,
  destObj?: any,
  filter?: any,
  propFilter?: any
): any => {
  let props;
  let i;
  let prop;
  const merged: any = {};

  destObj = destObj || {};
  if (sourceObj == null) return destObj;

  do {
    props = Object.getOwnPropertyNames(sourceObj);
    i = props.length;
    while (i-- > 0) {
      prop = props[i];
      if ((!propFilter || propFilter(prop, sourceObj, destObj)) && !merged[prop]) {
        destObj[prop] = sourceObj[prop];
        merged[prop] = true;
      }
    }
    sourceObj = filter !== false && getPrototypeOf(sourceObj);
  } while (sourceObj && (!filter || filter(sourceObj, destObj)) && sourceObj !== Object.prototype);

  return destObj;
};

export const endsWith = (str: any, searchString: string, position?: number): boolean => {
  str = String(str);
  if (position === undefined || position > str.length) {
    position = str.length;
  }
  position! -= searchString.length;
  const lastIndex = str.indexOf(searchString, position);
  return lastIndex !== -1 && lastIndex === position;
};

export const toArray = (thing: any): any[] | null => {
  if (!thing) return null;
  if (isArray(thing)) return thing;
  let i = thing.length;
  if (!isNumber(i)) return null;
  const arr = new Array(i);
  while (i-- > 0) {
    arr[i] = thing[i];
  }
  return arr;
};

export const forEachEntry = (obj: any, fn: (key: any, value: any) => any): void => {
  const generator = obj && obj[iterator];

  const _iterator = generator.call(obj);

  let result;

  while ((result = _iterator.next()) && !result.done) {
    const pair = result.value;
    fn.call(obj, pair[0], pair[1]);
  }
};

export const matchAll = (regExp: RegExp, str: string): RegExpExecArray[] => {
  let matches;
  const arr: RegExpExecArray[] = [];

  while ((matches = regExp.exec(str)) !== null) {
    arr.push(matches);
  }

  return arr;
};

export const toCamelCase = (str: string): string => {
  return str.toLowerCase().replace(/[-_\s]([a-z\d])(\w*)/g, function replacer(m, p1, p2) {
    return p1.toUpperCase() + p2;
  });
};

export const reduceDescriptors = (
  obj: any,
  reducer: (descriptor: PropertyDescriptor, name: string, obj: any) => any
): void => {
  const descriptors = Object.getOwnPropertyDescriptors(obj);
  const reducedDescriptors: PropertyDescriptorMap = {};

  forEach(descriptors, (descriptor, name) => {
    let ret;
    if ((ret = reducer(descriptor, name, obj)) !== false) {
      reducedDescriptors[name] = ret || descriptor;
    }
  });

  Object.defineProperties(obj, reducedDescriptors);
};

// Makes all methods read-only
export const freezeMethods = (obj: any): void => {
  reduceDescriptors(obj, (descriptor, name) => {
    // skip restricted props in strict mode
    if (isFunction(obj) && ['arguments', 'caller', 'callee'].includes(name)) {
      return false;
    }

    const value = obj[name];

    if (!isFunction(value)) return;

    descriptor.enumerable = false;

    if ('writable' in descriptor) {
      descriptor.writable = false;
      return;
    }

    if (!descriptor.set) {
      descriptor.set = () => {
        throw Error("Can not rewrite read-only method '" + name + "'");
      };
    }
  });
};

export const toObjectSet = (arrayOrString: any, delimiter?: string): Record<string, boolean> => {
  const obj: Record<string, boolean> = {};

  const define = (arr: any[]) => {
    arr.forEach((value) => {
      obj[value] = true;
    });
  };

  isArray(arrayOrString)
    ? define(arrayOrString)
    : define(String(arrayOrString).split(delimiter as string));

  return obj;
};

export const noop = (): void => {};

export const toFiniteNumber = (value: any, defaultValue?: any): any => {
  return value != null && Number.isFinite((value = +value)) ? value : defaultValue;
};

// Recursively converts an object to a JSON-compatible object, handling circular references and Buffers.
export const toJSONObject = (obj: any): any => {
  const visited = new WeakSet();

  const visit = (source: any): any => {
    if (isObject(source)) {
      if (visited.has(source)) {
        return;
      }

      //Buffer check
      if (isBuffer(source)) {
        return source;
      }

      if (!('toJSON' in source)) {
        // add-on descent / delete-on-ascent: preserves path semantics, so DAG nodes serialise at every occurrence (see #7230).
        visited.add(source);

        let target: any;

        if (isSet(source)) {
          target = [];
          for (const value of source) {
            const reducedValue = visit(value);
            !isUndefined(reducedValue) && target.push(reducedValue);
          }
        } else {
          target = isArray(source) ? [] : {};

          forEach(source, (value, key) => {
            const reducedValue = visit(value);
            !isUndefined(reducedValue) && (target[key] = reducedValue);
          });
        }

        visited.delete(source);

        return target;
      }
    }

    return source;
  };

  return visit(obj);
};
