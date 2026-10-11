export type Throttled = [
  (...args: any[]) => void,
  () => void,
  (...args: any[]) => void,
];

function throttle(fn: (...args: any[]) => void, freq: number): Throttled {
  let timestamp = 0;
  const threshold = 1000 / freq;
  let lastArgs: any[] | null = null;
  let timer: any;

  const invoke = (args: any[], now = Date.now()) => {
    timestamp = now;
    lastArgs = null;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    fn(...args);
  };

  const throttled = (...args: any[]) => {
    const now = Date.now();
    const passed = now - timestamp;
    if (passed >= threshold) {
      invoke(args, now);
    } else {
      lastArgs = args;
      if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          invoke(lastArgs!);
        }, threshold - passed);
      }
    }
  };

  const flush = () => lastArgs && invoke(lastArgs);
  const flushWith = (...args: any[]) => invoke(args);

  return [throttled, flush as () => void, flushWith];
}

export default throttle;
