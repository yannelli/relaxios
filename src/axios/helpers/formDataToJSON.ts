'use strict';

import utils from '../utils';
import AxiosError from '../core/AxiosError';
import { DEFAULT_FORM_DATA_MAX_DEPTH } from './toFormData';

const MAX_DEPTH = DEFAULT_FORM_DATA_MAX_DEPTH;

function throwIfDepthExceeded(index: number): void {
  if (index > MAX_DEPTH) {
    throw new AxiosError(
      'FormData field is too deeply nested (' + index + ' levels). Max depth: ' + MAX_DEPTH,
      AxiosError.ERR_FORM_DATA_DEPTH_EXCEEDED
    );
  }
}

// foo[x][y][z] -> ['foo', 'x', 'y', 'z'] and foo.x.y.z -> ['foo', 'x', 'y', 'z'].
// A segment may contain any character except `.`, `[` and `]` (#5402), and
// excluding `[` from the bracket group keeps parsing linear in the name length.
function parsePropPath(name: string): string[] {
  const path: string[] = [];
  const pattern = /[^.[\]]+|\[([^.[\]]*)]/g;
  let match;

  while ((match = pattern.exec(name)) !== null) {
    throwIfDepthExceeded(path.length);
    path.push(match[0] === '[]' ? '' : match[1] || match[0]);
  }

  return path;
}

function arrayToObject(arr: any): Record<string, any> {
  const obj: Record<string, any> = {};
  const keys = Object.keys(arr);
  let i;
  const len = keys.length;
  let key;
  for (i = 0; i < len; i++) {
    key = keys[i];
    obj[key] = arr[key];
  }
  return obj;
}

function formDataToJSON(formData: any): Record<string, any> | null {
  function buildPath(path: any[], value: any, target: any, index: number): boolean {
    throwIfDepthExceeded(index);

    let name = path[index++];

    if (name === '__proto__') return true;

    const isNumericKey = Number.isFinite(+name);
    const isLast = index >= path.length;
    name = !name && utils.isArray(target) ? target.length : name;

    if (isLast) {
      if (utils.hasOwnProp(target, name)) {
        target[name] = utils.isArray(target[name])
          ? target[name].concat(value)
          : [target[name], value];
      } else {
        target[name] = value;
      }

      return !isNumericKey;
    }

    if (!utils.hasOwnProp(target, name) || !utils.isObject(target[name])) {
      target[name] = [];
    }

    const result = buildPath(path, value, target[name], index);

    if (result && utils.isArray(target[name])) {
      target[name] = arrayToObject(target[name]);
    }

    return !isNumericKey;
  }

  if (utils.isFormData(formData) && utils.isFunction(formData.entries)) {
    const obj = {};

    utils.forEachEntry(formData, (name: string, value: any) => {
      buildPath(parsePropPath(name), value, obj, 0);
    });

    return obj;
  }

  return null;
}

export default formDataToJSON;
