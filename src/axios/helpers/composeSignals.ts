import CanceledError from '../cancel/CanceledError';
import AxiosError from '../core/AxiosError';
import utils from '../utils';

const composeSignals = (signals: any[] | null | undefined, timeout?: number): any => {
  let _signals: any[] | null = signals ? signals.filter(Boolean) : [];

  if (!timeout && !_signals.length) {
    return;
  }

  const controller = new AbortController();

  let aborted = false;

  const onabort = function (this: any, reason?: any) {
    if (!aborted) {
      aborted = true;
      unsubscribe();
      const err = reason instanceof Error ? reason : this.reason;
      controller.abort(
        err instanceof AxiosError
          ? err
          : new CanceledError(err instanceof Error ? err.message : err)
      );
    }
  };

  let timer: any =
    timeout &&
    setTimeout(() => {
      timer = null;
      onabort(new AxiosError(`timeout of ${timeout}ms exceeded`, AxiosError.ETIMEDOUT));
    }, timeout);

  const unsubscribe = () => {
    if (!_signals) {
      return;
    }
    timer && clearTimeout(timer);
    timer = null;
    _signals.forEach((signal: any) => {
      signal.unsubscribe
        ? signal.unsubscribe(onabort)
        : signal.removeEventListener('abort', onabort);
    });
    _signals = null;
  };

  _signals.forEach((signal: any) => {
    if (aborted) {
      return;
    }

    if (signal.aborted) {
      onabort.call(signal);
      return;
    }

    signal.addEventListener('abort', onabort, { once: true });
  });

  const signal: any = controller.signal;

  signal.unsubscribe = () => utils.asap(unsubscribe);

  return signal;
};

export default composeSignals;
