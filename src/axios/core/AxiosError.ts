'use strict';

import utils from '../utils';
import AxiosHeaders from './AxiosHeaders';

export const REDACTED = '[REDACTED ****]';

function hasOwnOrPrototypeToJSON(source: any): boolean {
  if (utils.hasOwnProp(source, 'toJSON')) {
    return true;
  }

  let prototype = Object.getPrototypeOf(source);

  while (prototype && prototype !== Object.prototype) {
    if (utils.hasOwnProp(prototype, 'toJSON')) {
      return true;
    }

    prototype = Object.getPrototypeOf(prototype);
  }

  return false;
}

// Build a plain-object snapshot of `config` and replace the value of any key
// (case-insensitive) listed in `redactKeys` with REDACTED. Walks through arrays
// and AxiosHeaders, and short-circuits on circular references.
function redactConfig(config: any, redactKeys: any[]): any {
  const lowerKeys = new Set(redactKeys.map((k) => String(k).toLowerCase()));
  const seen: any[] = [];

  const visit = (source: any): any => {
    if (source === null || typeof source !== 'object') return source;
    if (utils.isBuffer(source)) return source;
    if (seen.indexOf(source) !== -1) return undefined;

    if (source instanceof AxiosHeaders) {
      source = source.toJSON();
    }

    seen.push(source);

    let result: any;
    if (utils.isArray(source)) {
      result = [];
      source.forEach((v: any, i: number) => {
        const reducedValue = visit(v);
        if (!utils.isUndefined(reducedValue)) {
          result[i] = reducedValue;
        }
      });
    } else {
      if (!utils.isPlainObject(source) && hasOwnOrPrototypeToJSON(source)) {
        seen.pop();
        return source;
      }

      result = Object.create(null);
      for (const [key, value] of Object.entries(source)) {
        const reducedValue = lowerKeys.has(key.toLowerCase()) ? REDACTED : visit(value);
        if (!utils.isUndefined(reducedValue)) {
          result[key] = reducedValue;
        }
      }
    }

    seen.pop();
    return result;
  };

  return visit(config);
}

function stringifySafely(value: any): string {
  try {
    return String(value);
  } catch (err) {
    return '';
  }
}

function aggregateErrorMessage(error: any): string {
  const message = error.errors
    .map((entry: any) => {
      try {
        return entry && entry.message ? stringifySafely(entry.message) : stringifySafely(entry);
      } catch (err) {
        return '';
      }
    })
    .filter(Boolean)
    .join('; ');

  return message || error.name || 'AggregateError';
}

class AxiosError extends Error {
  declare isAxiosError: boolean;
  declare code?: string;
  declare config?: any;
  declare request?: any;
  declare response?: any;
  declare status?: number;
  declare description?: any;
  declare number?: any;
  declare fileName?: any;
  declare lineNumber?: any;
  declare columnNumber?: any;

  static from(
    error: any,
    code?: string,
    config?: any,
    request?: any,
    response?: any,
    customProps?: any
  ): AxiosError {
    // `AggregateError` (Node dual-stack connection failures) has an empty `message`;
    // its detail lives in `errors[]` (see #6721).
    let message = error.message;
    if (!message && utils.isArray(error.errors) && error.errors.length) {
      message = aggregateErrorMessage(error);
    }

    const axiosError = new AxiosError(message, code || error.code, config, request, response);
    // Match native `Error` `cause` semantics: non-enumerable, so circular internals
    // on the wrapped error do not break structured loggers (#6982, #7205).
    const causeDescriptor: any = {
      __proto__: null,
      value: error,
      writable: true,
      enumerable: false,
      configurable: true,
    };
    Object.defineProperty(axiosError, 'cause', causeDescriptor);
    axiosError.name = error.name;

    // Preserve status from the original error if not already set from response
    if (error.status != null && axiosError.status == null) {
      axiosError.status = error.status;
    }

    customProps && Object.assign(axiosError, customProps);
    return axiosError;
  }

  constructor(message?: string, code?: string, config?: any, request?: any, response?: any) {
    super(message);

    // Make message enumerable to maintain backward compatibility: the native Error
    // constructor sets message as non-enumerable, but axios < v1.13.3 had it enumerable.
    const messageDescriptor: any = {
      __proto__: null,
      value: message,
      enumerable: true,
      writable: true,
      configurable: true,
    };
    Object.defineProperty(this, 'message', messageDescriptor);

    this.name = 'AxiosError';
    this.isAxiosError = true;
    code && (this.code = code);
    config && (this.config = config);
    request && (this.request = request);
    if (response) {
      this.response = response;
      this.status = response.status;
    }
  }

  toJSON(): Record<string, any> {
    // Opt-in redaction: when the request config carries a `redact` array, matching keys
    // (case-insensitive, at any depth) are replaced with REDACTED in the snapshot.
    const config = this.config;
    const redactKeys = config && utils.hasOwnProp(config, 'redact') ? config.redact : undefined;
    const serializedConfig =
      utils.isArray(redactKeys) && redactKeys.length > 0
        ? redactConfig(config, redactKeys)
        : utils.toJSONObject(config);

    return {
      // Standard
      message: this.message,
      name: this.name,
      // Microsoft
      description: this.description,
      number: this.number,
      // Mozilla
      fileName: this.fileName,
      lineNumber: this.lineNumber,
      columnNumber: this.columnNumber,
      stack: this.stack,
      // Axios
      config: serializedConfig,
      code: this.code,
      status: this.status,
    };
  }

  static ERR_BAD_OPTION_VALUE = 'ERR_BAD_OPTION_VALUE';
  static ERR_BAD_OPTION = 'ERR_BAD_OPTION';
  static ECONNABORTED = 'ECONNABORTED';
  static ETIMEDOUT = 'ETIMEDOUT';
  static ECONNREFUSED = 'ECONNREFUSED';
  static ERR_NETWORK = 'ERR_NETWORK';
  static ERR_FR_TOO_MANY_REDIRECTS = 'ERR_FR_TOO_MANY_REDIRECTS';
  static ERR_DEPRECATED = 'ERR_DEPRECATED';
  static ERR_BAD_RESPONSE = 'ERR_BAD_RESPONSE';
  static ERR_BAD_REQUEST = 'ERR_BAD_REQUEST';
  static ERR_CANCELED = 'ERR_CANCELED';
  static ERR_NOT_SUPPORT = 'ERR_NOT_SUPPORT';
  static ERR_INVALID_URL = 'ERR_INVALID_URL';
  static ERR_FORM_DATA_DEPTH_EXCEEDED = 'ERR_FORM_DATA_DEPTH_EXCEEDED';
}

export default AxiosError;
