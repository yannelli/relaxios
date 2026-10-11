import { getFetchEnv } from './fetch';
import nativeXhrRequest from './xhr/native';
import fetchXhrRequest from './xhr/viaFetch';

const isXHRAdapterSupported = typeof XMLHttpRequest !== 'undefined';

const DEFAULT_ADAPTERS = ['xhr', 'http', 'fetch'];

const lower = (value: any) => (typeof value === 'string' ? value.toLowerCase() : value);

const isDefaultAdapterList = (list: any[]) =>
  list.length === DEFAULT_ADAPTERS.length &&
  list.every((item, i) => lower(item) === DEFAULT_ADAPTERS[i]);

// The config asks for xhr by name, unless it is just the default ['xhr', 'http', 'fetch'].
const asksForXHR = (adapter: any) => {
  if (typeof adapter === 'string') {
    return adapter.toLowerCase() === 'xhr';
  }
  return Array.isArray(adapter) && lower(adapter[0]) === 'xhr' && !isDefaultAdapterList(adapter);
};

// jsdom, happy-dom, sinon fake XHR and instrumentation wrappers are not native.
const isNativeXHR = () => {
  try {
    return /\[native code\]/.test(Function.prototype.toString.call(XMLHttpRequest));
  } catch (e) {
    return false;
  }
};

export const useRealXHR = (config: any): boolean => {
  if (config && asksForXHR(config.adapter)) {
    return true;
  }
  if (config && config.onUploadProgress) {
    return true;
  }
  if (!isNativeXHR()) {
    return true;
  }
  return typeof fetch !== 'function';
};

export default isXHRAdapterSupported &&
  function (config: any): Promise<any> {
    if (useRealXHR(config)) {
      return nativeXhrRequest(config);
    }
    const env = getFetchEnv(config);
    return env ? fetchXhrRequest(env, config) : nativeXhrRequest(config);
  };
