import utils from '../utils';
import httpAdapter from './http';
import xhrAdapter from './xhr';
import * as fetchAdapter from './fetch';
import AxiosError from '../core/AxiosError';

// Known adapters: `http` for Node.js, `xhr` for browsers, `fetch` for the fetch API.
const knownAdapters: Record<string, any> = {
  http: httpAdapter,
  xhr: xhrAdapter,
  fetch: {
    get: fetchAdapter.getFetch,
  },
};

// Assign adapter names for easier debugging and identification
utils.forEach(knownAdapters, (fn: any, value: string) => {
  if (fn) {
    try {
      // Null-proto descriptors so a polluted Object.prototype.get cannot turn
      // these data descriptors into accessor descriptors on the way in.
      Object.defineProperty(fn, 'name', { __proto__: null, value } as PropertyDescriptor);
    } catch (e) {
      // eslint-disable-next-line no-empty
    }
    Object.defineProperty(fn, 'adapterName', { __proto__: null, value } as PropertyDescriptor);
  }
});

const renderReason = (reason: string): string => `- ${reason}`;

const isResolvedHandle = (adapter: any): boolean =>
  utils.isFunction(adapter) || adapter === null || adapter === false;

// Tries each adapter in order until a supported one is found, else throws an AxiosError.
function getAdapter(adapters: any, config?: any): any {
  adapters = utils.isArray(adapters) ? adapters : [adapters];

  const { length } = adapters;
  let nameOrAdapter;
  let adapter;

  const rejectedReasons: Record<string, any> = {};

  for (let i = 0; i < length; i++) {
    nameOrAdapter = adapters[i];
    let id;

    adapter = nameOrAdapter;

    if (!isResolvedHandle(nameOrAdapter)) {
      adapter = knownAdapters[(id = String(nameOrAdapter)).toLowerCase()];

      if (adapter === undefined) {
        throw new AxiosError(`Unknown adapter '${id}'`);
      }
    }

    if (adapter && (utils.isFunction(adapter) || (adapter = adapter.get(config)))) {
      break;
    }

    rejectedReasons[id || '#' + i] = adapter;
  }

  if (!adapter) {
    const reasons = Object.entries(rejectedReasons).map(
      ([id, state]) =>
        `adapter ${id} ` + (state === false ? 'is not supported by the environment' : 'is not available in the build')
    );

    let s = length
      ? reasons.length > 1
        ? 'since :\n' + reasons.map(renderReason).join('\n')
        : ' ' + renderReason(reasons[0])
      : 'as no adapter specified';

    throw new AxiosError(`There is no suitable adapter to dispatch the request ` + s, AxiosError.ERR_NOT_SUPPORT);
  }

  return adapter;
}

export default {
  getAdapter,
  adapters: knownAdapters,
};
