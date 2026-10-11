'use strict';

import utils from '../utils';
import AxiosHeaders from './AxiosHeaders';

const headersToObject = (thing: any) => (thing instanceof AxiosHeaders ? { ...thing } : thing);

const ownEnumerableKeys = (thing: any): (string | symbol)[] => {
  if (Object.getOwnPropertySymbols && Object.getOwnPropertyDescriptor) {
    return (Object.keys(thing) as (string | symbol)[]).concat(
      Object.getOwnPropertySymbols(thing).filter(
        (symbol) => Object.getOwnPropertyDescriptor(thing, symbol)!.enumerable
      )
    );
  }
  return Object.keys(thing);
};

type MergeFn = (a: any, b: any, prop?: any, caseless?: boolean) => any;

// Config-specific merge-function which creates a new config-object
// by merging two configuration objects together.
export default function mergeConfig(config1: any, config2: any): any {
  config1 = config1 || {};
  config2 = config2 || {};

  // Null-prototype object so downstream reads such as `config.auth` cannot inherit
  // polluted values; `hasOwnProperty` is restored as a non-enumerable own slot.
  const config = Object.create(null);
  const hasOwnDescriptor: any = {
    __proto__: null,
    value: Object.prototype.hasOwnProperty,
    enumerable: false,
    writable: true,
    configurable: true,
  };
  Object.defineProperty(config, 'hasOwnProperty', hasOwnDescriptor);

  function getMergedValue(target: any, source: any, prop?: any, caseless?: boolean): any {
    if (utils.isPlainObject(target) && utils.isPlainObject(source)) {
      return utils.merge.call({ caseless }, target, source);
    } else if (utils.isPlainObject(source)) {
      return utils.merge({}, source);
    } else if (utils.isArray(source)) {
      return source.slice();
    }
    return source;
  }

  function mergeDeepProperties(a: any, b: any, prop?: any, caseless?: boolean): any {
    if (!utils.isUndefined(b)) {
      return getMergedValue(a, b, prop, caseless);
    } else if (!utils.isUndefined(a)) {
      return getMergedValue(undefined, a, prop, caseless);
    }
  }

  function valueFromConfig2(a: any, b: any): any {
    if (!utils.isUndefined(b)) {
      return getMergedValue(undefined, b);
    }
  }

  function defaultToConfig2(a: any, b: any): any {
    if (!utils.isUndefined(b)) {
      return getMergedValue(undefined, b);
    } else if (!utils.isUndefined(a)) {
      return getMergedValue(undefined, a);
    }
  }

  function getMergedTransitionalOption(prop: string): any {
    const transitional2 = utils.hasOwnProp(config2, 'transitional')
      ? config2.transitional
      : undefined;

    if (!utils.isUndefined(transitional2)) {
      if (utils.isPlainObject(transitional2)) {
        if (utils.hasOwnProp(transitional2, prop)) {
          return transitional2[prop];
        }
      } else {
        return undefined;
      }
    }

    const transitional1 = utils.hasOwnProp(config1, 'transitional')
      ? config1.transitional
      : undefined;

    if (utils.isPlainObject(transitional1) && utils.hasOwnProp(transitional1, prop)) {
      return transitional1[prop];
    }

    return undefined;
  }

  function mergeDirectKeys(a: any, b: any, prop?: any): any {
    if (utils.hasOwnProp(config2, prop)) {
      return getMergedValue(a, b);
    } else if (utils.hasOwnProp(config1, prop)) {
      return getMergedValue(undefined, a);
    }
  }

  const mergeMap: Record<string, MergeFn> = {
    url: valueFromConfig2,
    method: valueFromConfig2,
    data: valueFromConfig2,
    baseURL: defaultToConfig2,
    transformRequest: defaultToConfig2,
    transformResponse: defaultToConfig2,
    paramsSerializer: defaultToConfig2,
    timeout: defaultToConfig2,
    timeoutErrorMessage: defaultToConfig2,
    withCredentials: defaultToConfig2,
    withXSRFToken: defaultToConfig2,
    adapter: defaultToConfig2,
    responseType: defaultToConfig2,
    xsrfCookieName: defaultToConfig2,
    xsrfHeaderName: defaultToConfig2,
    onUploadProgress: defaultToConfig2,
    onDownloadProgress: defaultToConfig2,
    decompress: defaultToConfig2,
    maxContentLength: defaultToConfig2,
    maxBodyLength: defaultToConfig2,
    beforeRedirect: defaultToConfig2,
    transport: defaultToConfig2,
    httpAgent: defaultToConfig2,
    httpsAgent: defaultToConfig2,
    cancelToken: defaultToConfig2,
    socketPath: defaultToConfig2,
    allowedSocketPaths: defaultToConfig2,
    responseEncoding: defaultToConfig2,
    validateStatus: mergeDirectKeys,
    headers: (a: any, b: any, prop?: any) =>
      mergeDeepProperties(headersToObject(a), headersToObject(b), prop, true),
  };

  utils.forEach(ownEnumerableKeys({ ...config1, ...config2 }), function computeConfigValue(prop: any) {
    if (prop === '__proto__' || prop === 'constructor' || prop === 'prototype') return;
    const merge: MergeFn = utils.hasOwnProp(mergeMap, prop) ? mergeMap[prop] : mergeDeepProperties;
    const a = utils.hasOwnProp(config1, prop) ? config1[prop] : undefined;
    const b = utils.hasOwnProp(config2, prop) ? config2[prop] : undefined;
    const configValue = merge(a, b, prop);
    (utils.isUndefined(configValue) && merge !== mergeDirectKeys) || (config[prop] = configValue);
  });

  if (
    utils.hasOwnProp(config2, 'validateStatus') &&
    utils.isUndefined(config2.validateStatus) &&
    getMergedTransitionalOption('validateStatusUndefinedResolves') === false
  ) {
    if (utils.hasOwnProp(config1, 'validateStatus')) {
      config.validateStatus = getMergedValue(undefined, config1.validateStatus);
    } else {
      delete config.validateStatus;
    }
  }

  return config;
}
