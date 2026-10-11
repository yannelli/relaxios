'use strict';

const { getPrototypeOf } = Object;

// Creating a function that will check if an object has a property.
export const hasOwnProperty = (
  ({ hasOwnProperty }: { hasOwnProperty: (v: PropertyKey) => boolean }) =>
  (obj: any, prop: PropertyKey): boolean =>
    hasOwnProperty.call(obj, prop)
)(Object.prototype);

export const isUnsafeObjectKey = (prop: any): boolean =>
  typeof prop === 'string' &&
  (prop === '__proto__' || prop === 'constructor' || prop === 'prototype');

// A foreign Object.prototype cannot be told apart from an app null-proto object,
// so every inherited terminal prototype is treated as a fail-closed boundary.
export const isPrototypeBoundary = (obj: any, prototype: any, source: boolean): boolean =>
  obj === Object.prototype || (!source && prototype === null);

export const isSafeAndFullyMutable = (obj: any): boolean => {
  if (!Object.isExtensible(obj)) {
    return false;
  }

  const props: (string | symbol)[] = Object.getOwnPropertyNames(obj);

  if (Object.getOwnPropertySymbols) {
    props.push(...Object.getOwnPropertySymbols(obj));
  }

  return props.every((prop) => {
    if (isUnsafeObjectKey(prop)) {
      return false;
    }

    const descriptor = Object.getOwnPropertyDescriptor(obj, prop);

    return !!descriptor && descriptor.configurable === true && descriptor.writable === true;
  });
};

// Walk the prototype chain (excluding Object.prototype) looking for an own `prop`,
// so members injected via Object.prototype pollution are never matched.
export const hasOwnInPrototypeChain = (thing: any, prop: PropertyKey): boolean => {
  let obj = thing;
  const seen: any[] = [];

  while (obj != null) {
    if (seen.indexOf(obj) !== -1) {
      return false;
    }
    seen.push(obj);

    const prototype = getPrototypeOf(obj);

    if (isPrototypeBoundary(obj, prototype, obj === thing)) {
      return false;
    }

    if (hasOwnProperty(obj, prop)) {
      return true;
    }
    obj = prototype;
  }
  return false;
};

export const getSafeProp = (obj: any, prop: PropertyKey): any =>
  obj != null && hasOwnInPrototypeChain(obj, prop) ? obj[prop as any] : undefined;

// Flatten an object and its application-defined prototype chain into a
// null-prototype object, excluding members inherited only from Object.prototype.
export const toSafeFlatObject = (thing: any): any => {
  if (thing == null || (typeof thing !== 'object' && typeof thing !== 'function')) {
    return thing;
  }

  const sourcePrototype = getPrototypeOf(thing);

  if (sourcePrototype === null && isSafeAndFullyMutable(thing)) {
    return thing;
  }

  const result: any = Object.create(null);
  const merged: any = Object.create(null);
  const seen: any[] = [];
  let current = thing;

  while (current != null) {
    if (seen.indexOf(current) !== -1) {
      break;
    }

    seen.push(current);

    const prototype = current === thing ? sourcePrototype : getPrototypeOf(current);

    if (isPrototypeBoundary(current, prototype, current === thing)) {
      break;
    }

    const props: (string | symbol)[] = Object.getOwnPropertyNames(current);

    if (Object.getOwnPropertySymbols) {
      props.push(...Object.getOwnPropertySymbols(current));
    }

    for (const prop of props) {
      if (isUnsafeObjectKey(prop)) {
        continue;
      }

      if (!hasOwnProperty(merged, prop)) {
        result[prop] = thing[prop];
        merged[prop] = true;
      }
    }

    current = prototype;
  }

  return result;
};
