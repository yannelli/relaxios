'use strict';

import AxiosError from '../core/AxiosError';

// A `CanceledError` is an object that is thrown when an operation is canceled.
class CanceledError extends AxiosError {
  declare __CANCEL__: boolean;

  constructor(message?: string | null, config?: any, request?: any) {
    super(message == null ? 'canceled' : message, AxiosError.ERR_CANCELED, config, request);
    this.name = 'CanceledError';
    this.__CANCEL__ = true;
  }
}

export default CanceledError;
