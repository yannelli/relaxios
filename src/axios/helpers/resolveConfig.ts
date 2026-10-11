import platform from '../platform/index';
import utils from '../utils';
import AxiosError from '../core/AxiosError';
import isURLSameOrigin from './isURLSameOrigin';
import cookies from './cookies';
import buildFullPath from '../core/buildFullPath';
import mergeConfig from '../core/mergeConfig';
import AxiosHeaders from '../core/AxiosHeaders';
import setFormDataHeaders from '../core/setFormDataHeaders';
import buildURL from './buildURL';

// Encode a UTF-8 string to a Latin-1 byte string for use with btoa(), replacing
// the deprecated unescape(encodeURIComponent(str)) pattern.
const encodeUTF8 = (str: string): string =>
  encodeURIComponent(str).replace(/%([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

function resolveConfig(config: any): any {
  const newConfig: any = mergeConfig({}, config);

  // Read only own properties to prevent prototype pollution gadgets
  // (e.g. Object.prototype.baseURL = 'https://evil.com').
  const own = (key: string): any => (utils.hasOwnProp(newConfig, key) ? newConfig[key] : undefined);

  const data = own('data');
  let withXSRFToken = own('withXSRFToken');
  const xsrfHeaderName = own('xsrfHeaderName');
  const xsrfCookieName = own('xsrfCookieName');
  let headers = own('headers');
  const auth = own('auth');
  const baseURL = own('baseURL');
  const allowAbsoluteUrls = own('allowAbsoluteUrls');
  const url = own('url');

  newConfig.headers = headers = AxiosHeaders.from(headers);

  newConfig.url = buildURL(
    buildFullPath(baseURL, url, allowAbsoluteUrls, newConfig),
    own('params'),
    own('paramsSerializer')
  );

  // HTTP basic authentication
  if (auth) {
    const username = utils.getSafeProp(auth, 'username') || '';
    const password = utils.getSafeProp(auth, 'password') || '';

    try {
      headers.set('Authorization', 'Basic ' + btoa(username + ':' + (password ? encodeUTF8(password) : '')));
    } catch (e) {
      throw AxiosError.from(e, AxiosError.ERR_BAD_OPTION_VALUE, config);
    }
  }

  if (utils.isFormData(data)) {
    const getHeaders = utils.getSafeProp(data, 'getHeaders');

    if (platform.hasStandardBrowserEnv || platform.hasStandardBrowserWebWorkerEnv || utils.isReactNative(data)) {
      headers.setContentType(undefined); // browser/web worker/RN handles it
    } else if (utils.isFunction(getHeaders)) {
      // Node.js FormData (like form-data package)
      setFormDataHeaders(headers, getHeaders.call(data), own('formDataHeaderPolicy'));
    }
  }

  // Add xsrf header. This is only done in a standard browser environment,
  // specifically not in a web worker or react-native.
  if (platform.hasStandardBrowserEnv) {
    if (utils.isFunction(withXSRFToken)) {
      withXSRFToken = withXSRFToken(newConfig);
    }

    // Strict boolean check: a proto-pollution gadget (Object.prototype.withXSRFToken = 1) or a
    // misconfiguration ("false") must not skip the same-origin check and leak the token cross-origin.
    const shouldSendXSRF = withXSRFToken === true || (withXSRFToken == null && isURLSameOrigin(newConfig.url));

    if (shouldSendXSRF) {
      const xsrfValue = xsrfHeaderName && xsrfCookieName && cookies.read(xsrfCookieName);

      if (xsrfValue) {
        headers.set(xsrfHeaderName, xsrfValue);
      }
    }
  }

  return newConfig;
}

export default resolveConfig;
