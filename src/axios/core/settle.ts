'use strict';

import AxiosError from './AxiosError';

// Resolve or reject a Promise based on response status.
export default function settle(
  resolve: (value: any) => void,
  reject: (reason: any) => void,
  response: any
): void {
  const validateStatus = response.config.validateStatus;
  if (!response.status || !validateStatus || validateStatus(response.status)) {
    resolve(response);
  } else {
    reject(
      new AxiosError(
        'Request failed with status code ' + response.status,
        response.status >= 400 && response.status < 500
          ? AxiosError.ERR_BAD_REQUEST
          : AxiosError.ERR_BAD_RESPONSE,
        response.config,
        response.request,
        response
      )
    );
  }
}
