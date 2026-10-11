'use strict';

import utils from '../utils';
import defaults from '../defaults/index';
import AxiosHeaders from '../core/AxiosHeaders';

// Transform the data for a request or a response
export default function transformData(this: any, fns: any, response?: any): any {
  const config = this || defaults;
  const context = response || config;
  const headers = AxiosHeaders.from(context.headers);
  let data = context.data;

  utils.forEach(fns, function transform(fn: any) {
    data = fn.call(config, data, headers.normalize(), response ? response.status : undefined);
  });

  headers.normalize();

  return data;
}
