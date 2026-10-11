'use strict';

import utils from '../utils';
import AxiosError from '../core/AxiosError';
// temporary hotfix to avoid circular references until AxiosURLSearchParams is refactored
import PlatformFormData from '../platform/node/classes/FormData';
import PlatformBuffer from '../platform/node/classes/Buffer';

// Default nesting limit shared with the inverse transform (formDataToJSON) so
// the FormData <-> JSON round-trip stays symmetric.
export const DEFAULT_FORM_DATA_MAX_DEPTH = 100;

function isVisitable(thing: any): boolean {
  return utils.isPlainObject(thing) || utils.isArray(thing);
}

function removeBrackets(key: any): any {
  return utils.endsWith(key, '[]') ? key.slice(0, -2) : key;
}

function renderKey(path: any, key: any, dots: any): string {
  if (!path) return key;
  return path
    .concat(key)
    .map(function each(token: any, i: number) {
      token = removeBrackets(token);
      return !dots && i ? '[' + token + ']' : token;
    })
    .join(dots ? '.' : '');
}

function isFlatArray(arr: any): boolean {
  return utils.isArray(arr) && !arr.some(isVisitable);
}

const predicates = utils.toFlatObject(utils, {}, null, function filter(prop: string) {
  return /^is[A-Z]/.test(prop);
});

function toFormData(obj: any, formData?: any, options?: any): any {
  if (!utils.isObject(obj)) {
    throw new TypeError('target must be an object');
  }

  formData = formData || new ((PlatformFormData as any) || FormData)();

  const option = (name: string, fallback?: any): any => {
    const value = utils.getSafeProp(options, name);
    return utils.isUndefined(value) ? fallback : value;
  };

  const metaTokens = option('metaTokens', true);
  const visitor = option('visitor') || defaultVisitor;
  const dots = option('dots', false);
  const indexes = option('indexes', false);
  const _Blob = option('Blob') || (typeof Blob !== 'undefined' && Blob);
  const maxDepth = option('maxDepth', DEFAULT_FORM_DATA_MAX_DEPTH);
  const useBlob = _Blob && utils.isSpecCompliantForm(formData);
  const stack: any[] = [];

  if (!utils.isFunction(visitor)) {
    throw new TypeError('visitor must be a function');
  }

  function convertValue(value: any): any {
    if (value === null) return '';

    if (utils.isDate(value)) {
      return value.toISOString();
    }

    if (utils.isBoolean(value)) {
      return value.toString();
    }

    if (!useBlob && utils.isBlob(value)) {
      throw new AxiosError('Blob is not supported. Use a Buffer instead.');
    }

    if (utils.isArrayBuffer(value) || utils.isTypedArray(value)) {
      if (useBlob && typeof _Blob === 'function') {
        return new _Blob([value]);
      }
      if (PlatformBuffer && PlatformBuffer.isBufferAvailable()) {
        return PlatformBuffer.from(value);
      }
      throw new AxiosError('Blob is not supported. Use a Buffer instead.', AxiosError.ERR_NOT_SUPPORT);
    }

    return value;
  }

  function throwIfMaxDepthExceeded(depth: number): void {
    if (depth > maxDepth) {
      throw new AxiosError(
        'Object is too deeply nested (' + depth + ' levels). Max depth: ' + maxDepth,
        AxiosError.ERR_FORM_DATA_DEPTH_EXCEEDED
      );
    }
  }

  function stringifyWithDepthLimit(value: any, depth: number): string {
    if (maxDepth === Infinity) {
      return JSON.stringify(value);
    }

    const ancestors: any[] = [];

    return JSON.stringify(value, function limitDepth(this: any, _key: string, currentValue: any) {
      if (!utils.isObject(currentValue)) {
        return currentValue;
      }

      while (ancestors.length && ancestors[ancestors.length - 1] !== this) {
        ancestors.pop();
      }

      ancestors.push(currentValue);
      throwIfMaxDepthExceeded(depth + ancestors.length - 1);

      return currentValue;
    });
  }

  // Default visitor; returns true to visit each prop of the value recursively.
  function defaultVisitor(this: any, value: any, key: any, path: any): boolean {
    let arr = value;

    if (utils.isReactNative(formData) && utils.isReactNativeBlob(value)) {
      formData.append(renderKey(path, key, dots), convertValue(value));
      return false;
    }

    if (value && !path && typeof value === 'object') {
      if (utils.endsWith(key, '{}')) {
        key = metaTokens ? key : key.slice(0, -2);
        value = stringifyWithDepthLimit(value, 1);
      } else if (
        (utils.isArray(value) && isFlatArray(value)) ||
        ((utils.isFileList(value) || utils.endsWith(key, '[]')) && (arr = utils.toArray(value)))
      ) {
        key = removeBrackets(key);

        arr.forEach(function each(el: any, index: number) {
          !(utils.isUndefined(el) || el === null) &&
            formData.append(
              indexes === true ? renderKey([key], index, dots) : indexes === null ? key : key + '[]',
              convertValue(el)
            );
        });
        return false;
      }
    }

    if (isVisitable(value)) {
      return true;
    }

    formData.append(renderKey(path, key, dots), convertValue(value));

    return false;
  }

  const exposedHelpers = Object.assign(predicates, {
    defaultVisitor,
    convertValue,
    isVisitable,
  });

  function build(value: any, path?: any, depth = 0): void {
    if (utils.isUndefined(value)) return;

    throwIfMaxDepthExceeded(depth);

    if (stack.indexOf(value) !== -1) {
      throw new Error('Circular reference detected in ' + path.join('.'));
    }

    stack.push(value);

    utils.forEach(value, function each(el: any, key: any) {
      const result =
        !(utils.isUndefined(el) || el === null) &&
        visitor.call(formData, el, utils.isString(key) ? key.trim() : key, path, exposedHelpers);

      if (result === true) {
        build(el, path ? path.concat(key) : [key], depth + 1);
      }
    });

    stack.pop();
  }

  if (!utils.isObject(obj)) {
    throw new TypeError('data must be an object');
  }

  build(obj);

  return formData;
}

export default toFormData;
