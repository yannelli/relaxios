'use strict';

import utils from '../utils';
import toFormData from './toFormData';
import platform from '../platform/index';

export default function toURLEncodedForm(data: any, options?: any): any {
  return toFormData(data, new platform.classes.URLSearchParams(), {
    visitor: function (this: any, value: any, key: any, path: any, helpers: any) {
      if (platform.isNode && utils.isBuffer(value)) {
        this.append(key, value.toString('base64'));
        return false;
      }

      return helpers.defaultVisitor.apply(this, arguments);
    },
    ...options,
  });
}
