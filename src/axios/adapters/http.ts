'use strict';

import utils from '../utils';
import { wrapAsync } from './http/shared';
import dispatchHttpRequest from './http/request';
import { isNodeEnvProxyEnabled, setProxy } from './http/proxy';
import { isSameOriginRedirect } from './http/redirects';

const isHttpAdapterSupported =
  typeof process !== 'undefined' && utils.kindOf(process) === 'process';

export default isHttpAdapterSupported &&
  function httpAdapter(config: any): Promise<any> {
    return wrapAsync((resolve, reject, onDone) =>
      dispatchHttpRequest(config, resolve, reject, onDone)
    );
  };

export const __setProxy = setProxy;
export const __isNodeEnvProxyEnabled = isNodeEnvProxyEnabled;
export const __isSameOriginRedirect = isSameOriginRedirect;
