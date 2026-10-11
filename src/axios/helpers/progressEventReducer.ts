import speedometer from './speedometer';
import throttle from './throttle';
import type { Throttled } from './throttle';
import utils from '../utils';

export const progressEventReducer = (
  listener: (data: any) => void,
  isDownloadStream?: boolean,
  freq = 3
): Throttled => {
  let bytesNotified = 0;
  const _speedometer = speedometer(50, 250);

  return throttle((e: any) => {
    if (!e || !utils.isNumber(e.loaded)) {
      return;
    }
    const rawLoaded = e.loaded;
    const total = e.lengthComputable ? e.total : undefined;
    const loaded = Math.max(0, total != null ? Math.min(rawLoaded, total) : rawLoaded);
    const progressBytes = Math.max(0, loaded - bytesNotified);
    const rate = _speedometer(progressBytes);

    bytesNotified = Math.max(bytesNotified, loaded);

    const data = {
      loaded,
      total,
      progress: total ? loaded / total : undefined,
      bytes: progressBytes,
      rate: rate ? rate : undefined,
      estimated: rate && total ? (total - loaded) / rate : undefined,
      event: e,
      lengthComputable: total != null,
      [isDownloadStream ? 'download' : 'upload']: true,
    };

    listener(data);
  }, freq);
};

export const progressEventDecorator = (
  total: number | undefined | null,
  throttled: Throttled
): [(loaded: number) => void, () => void] => {
  const lengthComputable = total != null;

  return [
    (loaded: number) =>
      throttled[0]({
        lengthComputable,
        total,
        loaded,
      }),
    throttled[1],
  ];
};

export const asyncDecorator =
  (fn: (...args: any[]) => any, scheduler: (cb: () => void) => void = utils.asap) =>
  (...args: any[]) =>
    scheduler(() => fn(...args));
