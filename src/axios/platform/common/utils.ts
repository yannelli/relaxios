declare const WorkerGlobalScope: any;

const hasBrowserEnv = typeof window !== 'undefined' && typeof document !== 'undefined';

const _navigator = (typeof navigator === 'object' && navigator) || undefined;

// Standard browser env: web workers lack window/document, while react-native and
// nativescript report navigator.product as 'ReactNative', 'NativeScript' or 'NS'.
const hasStandardBrowserEnv =
  hasBrowserEnv && (!_navigator || ['ReactNative', 'NativeScript', 'NS'].indexOf(_navigator.product) < 0);

// hasStandardBrowserEnv filters out web workers, so posting FormData from a
// worker needs this separate check.
const hasStandardBrowserWebWorkerEnv = (() => {
  return (
    typeof WorkerGlobalScope !== 'undefined' &&
    self instanceof WorkerGlobalScope &&
    typeof (self as any).importScripts === 'function'
  );
})();

const origin = (hasBrowserEnv && window.location.href) || 'http://localhost';

export { hasBrowserEnv, hasStandardBrowserWebWorkerEnv, hasStandardBrowserEnv, _navigator as navigator, origin };
