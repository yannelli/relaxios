'use strict';

import utils from '../utils';

// Determines whether the payload is an error thrown by Axios
export default function isAxiosError(payload: any): boolean {
  return utils.isObject(payload) && payload.isAxiosError === true;
}
