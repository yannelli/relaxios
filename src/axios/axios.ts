'use strict';

import utils from './utils';
import bind from './helpers/bind';
import Axios from './core/Axios';
import mergeConfig from './core/mergeConfig';
import defaults from './defaults/index';
import formDataToJSON from './helpers/formDataToJSON';
import CanceledError from './cancel/CanceledError';
import CancelToken from './cancel/CancelToken';
import isCancel from './cancel/isCancel';
import { VERSION } from './env/data';
import toFormData from './helpers/toFormData';
import AxiosError from './core/AxiosError';
import spread from './helpers/spread';
import isAxiosError from './helpers/isAxiosError';
import AxiosHeaders from './core/AxiosHeaders';
import adapters from './adapters/adapters';
import HttpStatusCode from './helpers/HttpStatusCode';
import type { AxiosStatic } from './types';

function createInstance(defaultConfig: any): any {
  const context: any = new (Axios as any)(defaultConfig);
  const instance = bind((Axios as any).prototype.request, context);

  // Copy axios.prototype to instance
  utils.extend(instance, (Axios as any).prototype, context, { allOwnKeys: true });

  // Copy context to instance
  utils.extend(instance, context, null, { allOwnKeys: true });

  // Factory for creating new instances
  instance.create = function create(instanceConfig: any) {
    return createInstance(mergeConfig(defaultConfig, instanceConfig));
  };

  return instance;
}

// Create the default instance to be exported
const axios: any = createInstance(defaults);

// Expose Axios class to allow class inheritance
axios.Axios = Axios;

// Expose Cancel & CancelToken
axios.CanceledError = CanceledError;
axios.CancelToken = CancelToken;
axios.isCancel = isCancel;
axios.VERSION = VERSION;
axios.toFormData = toFormData;

// Expose AxiosError class
axios.AxiosError = AxiosError;

// alias for CanceledError for backward compatibility
axios.Cancel = axios.CanceledError;

// Expose all/spread
axios.all = function all(promises: any) {
  return Promise.all(promises);
};

axios.spread = spread;

// Expose isAxiosError
axios.isAxiosError = isAxiosError;

// Expose mergeConfig
axios.mergeConfig = mergeConfig;

axios.AxiosHeaders = AxiosHeaders;

axios.formToJSON = (thing: any) => formDataToJSON(utils.isHTMLForm(thing) ? new FormData(thing) : thing);

axios.getAdapter = adapters.getAdapter;

axios.HttpStatusCode = HttpStatusCode;

axios.default = axios;

// this module should only have a default export
export default axios as AxiosStatic;
