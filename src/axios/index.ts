import { createClient } from 'fetchwire';
import { buildFullURL, defaults, dispatch, merge, prepare } from './dispatch';
import { AxiosError, CanceledError, isAxiosError, isCancel } from './error';
import { AxiosHeaders } from './headers';
import { toFormData } from './params';
import type { AxiosInstance, AxiosStatic, CreateAxiosDefaults } from './types';

export const VERSION = '0.1.0';

function createInstance(config: object): AxiosInstance {
  const instance: any = createClient(config, { prepare, dispatch, merge });
  for (const method of ['post', 'put', 'patch']) {
    instance[method + 'Form'] = (url: string, data?: unknown, config?: object) =>
      instance.request(merge(config, { method, url, data, headers: { 'Content-Type': 'multipart/form-data' } }));
  }
  instance.query = (url: string, data?: unknown, config?: object) => instance.request({ ...config, method: 'query', url, data });
  instance.getUri = (config?: object) => buildFullURL(merge(instance.defaults, config));
  instance.create = (config?: CreateAxiosDefaults) => createInstance(merge(instance.defaults, config));
  return instance;
}

export const all = <T>(values: Array<T | Promise<T>>): Promise<T[]> => Promise.all(values);
export const spread =
  <T, R>(callback: (...args: T[]) => R) =>
  (array: T[]): R =>
    callback(...array);
export const mergeConfig = merge as AxiosStatic['mergeConfig'];
export const create = (config?: CreateAxiosDefaults): AxiosInstance => axios.create(config);

const axios = createInstance(defaults) as AxiosStatic;
Object.assign(axios, {
  AxiosError,
  CanceledError,
  Cancel: CanceledError,
  AxiosHeaders,
  VERSION,
  isCancel,
  isAxiosError,
  all,
  spread,
  toFormData,
  mergeConfig,
  default: axios,
});

export { AxiosError, AxiosHeaders, CanceledError, CanceledError as Cancel, isAxiosError, isCancel, toFormData };
export type * from './types';
export default axios;
