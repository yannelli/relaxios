'use strict';

import transformData from './transformData';
import isCancel from '../cancel/isCancel';
import defaults from '../defaults/index';
import CanceledError from '../cancel/CanceledError';
import AxiosHeaders from '../core/AxiosHeaders';
import adapters from '../adapters/adapters';
import utils from '../utils';

// Throws a `CanceledError` if cancellation has been requested.
function throwIfCancellationRequested(config: any): void {
  if (config.cancelToken) {
    config.cancelToken.throwIfRequested();
  }

  if (config.signal && config.signal.aborted) {
    throw new CanceledError(null, config);
  }
}

// Dispatch a request to the server using the configured adapter.
export default function dispatchRequest(_config: any): Promise<any> {
  // Interceptors may replace the merged config with an ordinary object. Flatten it at
  // the dispatch boundary so shared prototype members cannot become request behavior.
  const config = utils.toSafeFlatObject(_config);

  throwIfCancellationRequested(config);

  config.headers = AxiosHeaders.from(utils.getSafeProp(config, 'headers'));

  // Transform request data
  config.data = transformData.call(config, config.transformRequest);

  if (['post', 'put', 'patch'].indexOf(config.method) !== -1) {
    config.headers.setContentType('application/x-www-form-urlencoded', false);
  }

  const adapter = adapters.getAdapter(config.adapter || defaults.adapter, config);

  return adapter(config).then(
    function onAdapterResolution(response: any) {
      throwIfCancellationRequested(config);

      // Expose the current response on config so that transformResponse can attach it
      // to any AxiosError it throws (e.g. on JSON parse failure); cleaned up afterwards.
      config.response = response;
      try {
        response.data = transformData.call(config, config.transformResponse, response);
      } finally {
        delete config.response;
      }

      response.headers = AxiosHeaders.from(response.headers);

      return response;
    },
    function onAdapterRejection(reason: any) {
      if (!isCancel(reason)) {
        throwIfCancellationRequested(config);

        // Transform response data
        if (reason && reason.response) {
          config.response = reason.response;
          try {
            reason.response.data = transformData.call(
              config,
              config.transformResponse,
              reason.response
            );
          } finally {
            delete config.response;
          }
          reason.response.headers = AxiosHeaders.from(reason.response.headers);
        }
      }

      return Promise.reject(reason);
    }
  );
}
