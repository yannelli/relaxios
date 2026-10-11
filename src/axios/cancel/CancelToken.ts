'use strict';

import CanceledError from './CanceledError';

type Canceler = (message?: string, config?: any, request?: any) => void;

// A `CancelToken` is an object that can be used to request cancellation of an operation.
class CancelToken {
  declare promise: Promise<any>;
  declare reason?: CanceledError;
  declare _listeners?: Array<(reason: CanceledError) => void> | null;

  constructor(executor: (cancel: Canceler) => void) {
    if (typeof executor !== 'function') {
      throw new TypeError('executor must be a function.');
    }

    let resolvePromise!: (value: any) => void;

    this.promise = new Promise(function promiseExecutor(resolve) {
      resolvePromise = resolve;
    });

    const token = this;

    this.promise.then((cancel) => {
      if (!token._listeners) return;

      let i = token._listeners.length;

      while (i-- > 0) {
        token._listeners[i](cancel);
      }
      token._listeners = null;
    });

    (this.promise as any).then = (onfulfilled: any) => {
      let _resolve: any;
      const promise: any = new Promise((resolve) => {
        token.subscribe(resolve);
        _resolve = resolve;
      }).then(onfulfilled);

      promise.cancel = function reject() {
        token.unsubscribe(_resolve);
      };

      return promise;
    };

    executor(function cancel(message, config, request) {
      if (token.reason) {
        // Cancellation has already been requested
        return;
      }

      token.reason = new CanceledError(message, config, request);
      resolvePromise(token.reason);
    });
  }

  // Throws a `CanceledError` if cancellation has been requested.
  throwIfRequested(): void {
    if (this.reason) {
      throw this.reason;
    }
  }

  // Subscribe to the cancel signal
  subscribe(listener: (reason: CanceledError) => void): void {
    if (this.reason) {
      listener(this.reason);
      return;
    }

    if (this._listeners) {
      this._listeners.push(listener);
    } else {
      this._listeners = [listener];
    }
  }

  // Unsubscribe from the cancel signal
  unsubscribe(listener: (reason: CanceledError) => void): void {
    if (!this._listeners) {
      return;
    }
    const index = this._listeners.indexOf(listener);
    if (index !== -1) {
      this._listeners.splice(index, 1);
    }
  }

  toAbortSignal(): AbortSignal {
    const controller = new AbortController();

    const abort = (err: any) => {
      controller.abort(err);
    };

    this.subscribe(abort);

    (controller.signal as any).unsubscribe = () => this.unsubscribe(abort);

    return controller.signal;
  }

  // Returns an object that contains a new `CancelToken` and a function that cancels it.
  static source(): { token: CancelToken; cancel: Canceler } {
    let cancel: any;
    const token = new CancelToken(function executor(c) {
      cancel = c;
    });
    return {
      token,
      cancel,
    };
  }
}

export default CancelToken;
