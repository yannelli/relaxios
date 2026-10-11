'use strict';

import utils from '../../utils';
import AxiosError from '../../core/AxiosError';
import callbackify from '../../helpers/callbackify';

const resolveFamily = ({ address, family }: { address: any; family?: any }) => {
  if (!utils.isString(address)) {
    throw new AxiosError('address must be a string', AxiosError.ERR_BAD_OPTION_VALUE);
  }
  return {
    address,
    family: family || (address.indexOf('.') < 0 ? 6 : 4),
  };
};

const buildAddressEntry = (address: any, family?: any) =>
  resolveFamily(utils.isObject(address) ? address : { address, family });

const normalizedLookupCache = new WeakMap<any, any>();

export const normalizeLookup = (lookup: any): any => {
  let normalized = normalizedLookupCache.get(lookup);

  if (normalized) {
    return normalized;
  }

  const callbackLookup = callbackify(lookup, (value: any) =>
    utils.isArray(value) ? value : [value]
  );

  // Support opt.all, which is required by current Node.js releases.
  normalized = (hostname: string, opt: any, cb: (...args: any[]) => void) => {
    callbackLookup(hostname, opt, (err: any, arg0: any, arg1: any) => {
      if (err) {
        return cb(err);
      }

      let addresses;

      try {
        addresses = utils.isArray(arg0)
          ? arg0.map((addr: any) => buildAddressEntry(addr))
          : [buildAddressEntry(arg0, arg1)];
      } catch (error) {
        return cb(error);
      }

      opt.all ? cb(err, addresses) : cb(err, addresses[0].address, addresses[0].family);
    });
  };

  normalizedLookupCache.set(lookup, normalized);

  return normalized;
};
